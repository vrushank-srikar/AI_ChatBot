import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { createClient } from "redis";
import { initFaqs, checkFaq } from "./faqservice.js";

dotenv.config();

// Validate environment variables
const requiredEnv = ["MONGO_URI", "JWT_SECRET", "GEMINI_API_KEY"];
requiredEnv.forEach((key) => {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
});

const app = express();
app.use(express.json());
app.use(cors());

// --- Redis Client ---
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
  },
});
redisClient.on("error", (err) => console.error("Redis Error:", err));
await redisClient.connect();

// --- Gemini Models ---
const GEMINI_MODELS = ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.0"];

// --- Helper: Call Gemini with fallback ---
async function callGemini(prompt) {
  for (let model of GEMINI_MODELS) {
    try {
      const response = await axios.post(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
        { contents: [{ parts: [{ text: prompt }] }] },
        { headers: { "Content-Type": "application/json" } }
      );
      return response.data.candidates?.[0]?.content?.parts?.[0]?.text || "No response";
    } catch (err) {
      const code = err.response?.data?.error?.code;
      if (code === 429) {
        console.warn(`Model ${model} quota exhausted, trying next model...`);
        continue;
      } else if (code === 400) {
        console.error(`Bad request for ${model}: ${err.response?.data?.error?.message}`);
        throw new Error(`Invalid request to Gemini API: ${err.response?.data?.error?.message}`);
      } else if (code === 401) {
        console.error(`Authentication error for ${model}: ${err.response?.data?.error?.message}`);
        throw new Error("Gemini API authentication failed");
      } else {
        console.error(`Error with ${model}: ${err.message}`);
        throw err;
      }
    }
  }
  throw new Error("All Gemini models exhausted or failed.");
}

// --- Helper: Determine Case Priority ---
function determinePriority(description) {
  const paymentKeywords = ["payment", "refund", "billing", "charge", "transaction"];
  const orderKeywords = ["order", "delivery", "product", "item", "cancel", "undo"];
  const lowerDesc = description.toLowerCase();

  if (paymentKeywords.some((keyword) => lowerDesc.includes(keyword))) {
    return "high";
  } else if (orderKeywords.some((keyword) => lowerDesc.includes(keyword))) {
    return "low";
  }
  return "low";
}

// --- User Schema ---
const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true },
  password: String,
  role: { type: String, enum: ["user", "admin"], default: "user" },
  orders: [
    {
      orderId: String,
      status: String,
      totalAmount: Number,
      paymentMethod: String,
      orderDate: Date,
      delivery: {
        address: String,
        pincode: String,
        expectedDeliveryDate: Date,
      },
      products: [
        {
          name: String,
          quantity: Number,
          price: Number,
          domain: {
            type: String,
            enum: ["E-commerce", "Travel", "Telecommunications", "Banking Services"],
            required: true,
          },
        },
      ],
    },
  ],
});
userSchema.index({ email: 1 }, { unique: true });
const User = mongoose.model("User", userSchema);

// --- Case Schema ---
const caseSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  orderId: { type: String, required: true },
  productIndex: { type: Number, required: true },
  description: { type: String, required: true },
  priority: { type: String, default: "low", enum: ["high", "low"] },
  status: { type: String, default: "open", enum: ["open", "in-progress", "resolved"] },
  productChanges: {
    name: String,
    price: Number,
    quantity: Number,
  },
  responses: [
    {
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null },
      message: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
caseSchema.index({ userId: 1, orderId: 1, productIndex: 1 }, { unique: true });
const Case = mongoose.model("Case", caseSchema);



// --- Middleware: Auth ---
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized, token missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userRole = decoded.role;
    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// --- Select Product Endpoint ---
app.post("/api/select-product", authMiddleware, async (req, res) => {
  try {
    const { orderId, productIndex } = req.body;
    const userId = req.userId;

    const user = await User.findById(userId).select("orders");
    if (!user) return res.status(404).json({ error: "User not found" });

    const order = user.orders.find((o) => o.orderId === orderId);
    if (!order || productIndex < 0 || productIndex >= order.products.length) {
      return res.status(400).json({ error: "Invalid order or product index" });
    }

    const product = order.products[productIndex];
    const selectedProduct = {
      orderId,
      productIndex,
      name: product.name,
      quantity: product.quantity,
      price: product.price,
      orderDate: order.orderDate,
      status: order.status,
    };

    // Clear existing chat history and selected product
    await redisClient.del(`chat:${userId}`);
    await redisClient.del(`selected-product:${userId}`);
    await redisClient.set(`selected-product:${userId}`, JSON.stringify(selectedProduct), { EX: 3600 });
    res.json({ message: "Product selected successfully" });
  } catch (err) {
    console.error("Select product error:", err);
    res.status(500).json({ error: "Failed to select product" });
  }
});

// --- Clear Selected Product Endpoint ---
app.post("/api/clear-selected-product", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    await redisClient.del(`selected-product:${userId}`);
    res.json({ message: "Selected product cleared successfully" });
  } catch (err) {
    console.error("Clear selected product error:", err);
    res.status(500).json({ error: "Failed to clear selected product" });
  }
});

// --- Create Case Endpoint ---
app.post("/api/case", authMiddleware, async (req, res) => {
  try {
    const { orderId, productIndex, description } = req.body;
    const userId = req.userId;

    if (!orderId || productIndex === undefined || !description) {
      return res.status(400).json({ error: "Order ID, product index, and description are required" });
    }

    const user = await User.findById(userId).select("orders");
    if (!user) return res.status(404).json({ error: "User not found" });

    const order = user.orders.find((o) => o.orderId === orderId);
    if (!order || productIndex < 0 || productIndex >= order.products.length) {
      return res.status(400).json({ error: "Invalid order or product index" });
    }

    const priority = determinePriority(description);
    let newCase;

    const existingCase = await Case.findOne({ userId, orderId, productIndex });
    if (existingCase) {
      // Update existing case
      existingCase.description = description;
      existingCase.priority = priority;
      existingCase.updatedAt = new Date();
      await existingCase.save();
      newCase = existingCase;
    } else {
      // Create new case
      newCase = new Case({
        userId,
        orderId,
        productIndex,
        description,
        priority,
      });
      await newCase.save();
    }

    const populatedCase = await Case.findById(newCase._id)
      .populate("userId", "name email")
      .populate("responses.adminId", "name")
      .lean();

    res.json({ message: "Case processed successfully", case: populatedCase });
  } catch (err) {
    console.error("Create case error:", err);
    res.status(500).json({ error: "Failed to process case" });
  }
});

// --- User Fetch ---
app.get("/api/user/:id", authMiddleware, async (req, res) => {
  try {
    const start = Date.now();
    const user = await User.findById(req.params.id).lean();
    console.log(`User.findById took ${Date.now() - start}ms for ID: ${req.params.id}`);
    if (!user) {
      console.log(`User not found for ID: ${req.params.id}`);
      return res.status(404).json({ error: "User not found" });
    }
    if (req.userId !== req.params.id && req.userRole !== "admin") {
      console.log(`Unauthorized access attempt by user ${req.userId} for ID: ${req.params.id}`);
      return res.status(403).json({ error: "Unauthorized access" });
    }
    delete user.password;
    res.json(user);
  } catch (err) {
    console.error("User fetch error:", {
      message: err.message,
      name: err.name,
      code: err.code,
      stack: err.stack,
    });
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

// --- Get User Cases ---
app.get("/api/user/:id/cases", authMiddleware, async (req, res) => {
  if (req.userRole !== "user") {
    return res.status(403).json({ error: "User access required" });
  }
  try {
    const cases = await Case.find({ userId: req.params.id })
      .populate("userId", "name email")
      .populate("responses.adminId", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ cases });
  } catch (err) {
    console.error("User cases error:", err);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

// --- Get All Cases (Admin) ---
app.get("/api/admin/cases", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const cases = await Case.find()
      .populate("userId", "name email")
      .populate("responses.adminId", "name")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ cases });
  } catch (err) {
    console.error("Admin cases error:", err);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

// --- Get All Orders (Admin) ---
app.get("/api/admin/orders", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const users = await User.find({}, "name email orders").lean();
    const orders = users.flatMap((user) =>
      user.orders.map((order) => ({
        ...order,
        userId: user._id,
        userName: user.name,
        userEmail: user.email,
      }))
    );
    res.json({ orders });
  } catch (err) {
    console.error("Admin orders error:", err);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// --- Update Case Response (Admin) ---
app.post("/api/case/:id/response", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const { message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "Message required" });
    }
    const updatedCase = await Case.findByIdAndUpdate(
      req.params.id,
      {
        $push: { responses: { adminId: req.userId, message } },
        updatedAt: new Date(),
        status: "in-progress", // Set to in-progress when admin responds
      },
      { new: true }
    )
      .populate("userId", "name email")
      .populate("responses.adminId", "name")
      .lean();

    if (!updatedCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    res.json({ message: "Response added successfully", case: updatedCase });
  } catch (err) {
    console.error("Add response error:", err);
    res.status(500).json({ error: "Failed to add response" });
  }
});

// --- Update Case (Admin Only - Priority/Status/Product Changes) ---
app.put("/api/case/:id", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const caseId = req.params.id;
    const updates = req.body;

    // Validate priority if provided
    if (updates.priority && !["high", "low"].includes(updates.priority)) {
      return res.status(400).json({ error: "Invalid priority value" });
    }

    const updatedCase = await Case.findByIdAndUpdate(
      caseId,
      { ...updates, updatedAt: new Date() },
      { new: true }
    )
      .populate("userId", "name email orders")
      .populate("responses.adminId", "name")
      .lean();

    if (!updatedCase) {
      return res.status(404).json({ error: "Case not found" });
    }

    if (updates.productChanges) {
      const user = await User.findById(updatedCase.userId._id);
      const order = user.orders.find((o) => o.orderId === updatedCase.orderId);
      if (order && order.products[updatedCase.productIndex]) {
        const product = order.products[updatedCase.productIndex];
        if (updates.productChanges.name !== undefined) product.name = updates.productChanges.name;
        if (updates.productChanges.price !== undefined) product.price = updates.productChanges.price;
        if (updates.productChanges.quantity !== undefined) product.quantity = updates.productChanges.quantity;

        if (updates.productChanges.price !== undefined) {
          order.totalAmount = order.products.reduce((sum, p) => sum + (p.price * p.quantity), 0);
        }

        await user.save();
      }
    }

    res.json({ message: "Case updated successfully", case: updatedCase });
  } catch (err) {
    console.error("Update case error:", err);
    res.status(500).json({ error: "Failed to update case" });
  }
});

// --- Signup ---
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, role });
    await user.save();
    res.json({ message: "Signup successful" });
  } catch (err) {
    console.error("Signup error:", err);
    res.status(400).json({ error: "Signup failed" });
  }
});

// --- Login ---
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const start = Date.now();
    const user = await User.findOne({ email }, "name email password role orders").lean();
    console.log(`User.findOne took ${Date.now() - start}ms`);
    if (!user) return res.status(400).json({ error: "Invalid email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, {
      expiresIn: "1h",
    });

    const userData = { ...user };
    delete userData.password;

    await redisClient.set(`user:${user._id}`, JSON.stringify(userData), { EX: 3600 });
    await redisClient.del(`chat:${user._id}`);
    await redisClient.del(`selected-product:${user._id}`);

    res.json({ token, role: user.role });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ error: "Login failed" });
  }
});

// --- Logout ---
app.post("/api/logout", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    await redisClient.del(`user:${userId}`);
    await redisClient.del(`chat:${userId}`);
    await redisClient.del(`selected-product:${userId}`);
    console.log(`User ${userId} session, chat history, and selected product cleared`);
    res.json({ message: "Logout successful" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Logout failed" });
  }
});

// --- Chat ---
app.post("/api/chat", authMiddleware, async (req, res) => {
  try {
    const userId = req.userId;
    const { message } = req.body;

    let userData = await redisClient.get(`user:${userId}`);
    if (!userData) {
      const start = Date.now();
      const user = await User.findById(userId, "name email role orders").lean();
      console.log(`User.findById took ${Date.now() - start}ms`);
      if (!user) return res.status(404).json({ error: "User not found" });
      delete user.password;
      delete user.__v;
      userData = JSON.stringify(user);
      await redisClient.set(`user:${userId}`, userData, { EX: 3600 });
    }
    const user = JSON.parse(userData);

    const selectedProductData = await redisClient.get(`selected-product:${userId}`);
    if (!selectedProductData) {
      return res.status(400).json({ error: "No product selected. Please select a product to chat." });
    }
    const selectedProduct = JSON.parse(selectedProductData);

    // Check for FAQ match
    const faqAnswer = await checkFaq(message);
    if (faqAnswer) {
      const cleanReply = faqAnswer;
      await redisClient.rPush(
        `chat:${userId}`,
        JSON.stringify({
          prompt: message,
          reply: cleanReply,
          orderId: selectedProduct.orderId,
          productIndex: selectedProduct.productIndex,
          caseId: null,
        })
      );
      await redisClient.expire(`chat:${userId}`, 86400);

      return res.json({ reply: cleanReply });
    }

    const chatHistory = (await redisClient.lRange(`chat:${userId}`, 0, -1)).map(JSON.parse);

    let productText = `Selected Product:\nOrder ${selectedProduct.orderId} (Status: ${selectedProduct.status}, Date: ${new Date(
      selectedProduct.orderDate
    ).toLocaleDateString()}):\n  Product Index ${selectedProduct.productIndex}: ${selectedProduct.name} (Qty: ${
      selectedProduct.quantity
    }, Price: ₹${selectedProduct.price})\n`;

    let prompt = `You are a helpful e-commerce assistant. Use the provided user data and selected product to answer questions or create support cases.

USER DATA:
Name: ${user.name}
Email: ${user.email}
Role: ${user.role}

${productText}

INSTRUCTIONS:
- Focus responses on the selected product unless the user specifies otherwise.
- If the user wants to create a support case/ticket (keywords: "create case", "report issue", "problem with", "complaint", "refund", "return", "defective", "delivery issue", "cancel", "undo"), use the selected product's orderId and productIndex. Determine priority based on the issue: "high" for payment-related issues (e.g., payment, refund, billing, charge, transaction), "low" for order-related or other issues (e.g., order, delivery, product, item, cancel, undo). Respond helpfully (e.g., "I've created a support case for your [product]...") and end your response with exactly this JSON on a new line: {"createCase": true, "orderId": "exact_order_id", "productIndex": exact_number, "description": "brief_summary_of_issue", "priority": "high_or_low"}
- For other queries, answer normally using the selected product or user data if relevant.
- Ensure responses are concise, helpful, and strictly follow the JSON format for case creation.

Chat History:
${chatHistory.length > 0 ? chatHistory.slice(-5).map((c) => `Q: ${c.prompt}\nA: ${c.reply}`).join("\n\n") : "No history."}

User Query: "${message}"

Your Response:`;

    console.log("Full prompt sent to Gemini:", prompt.substring(0, 500) + "...");

    const reply = await callGemini(prompt);

    console.log("Gemini reply:", reply);

    let caseData = null;
    try {
      const cleanReply = reply.replace(/```(?:json)?\n|\n```/g, "").trim();
      console.log("Cleaned reply for JSON parsing:", cleanReply);
      const jsonMatch = cleanReply.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?=\s*$)/);
      if (jsonMatch) {
        caseData = JSON.parse(jsonMatch[0]);
        console.log("Parsed case data:", caseData);
        if (caseData.createCase) {
          const priority = caseData.priority || determinePriority(caseData.description || message);
          // Filter chat history for unsaved messages related to this product
          const caseResponses = chatHistory
            .filter(
              (chat) =>
                chat.orderId === caseData.orderId &&
                chat.productIndex === caseData.productIndex &&
                chat.caseId === null
            )
            .flatMap((chat) => [
              { adminId: null, message: `User: ${chat.prompt}`, timestamp: new Date() },
              { adminId: null, message: `Bot: ${chat.reply}`, timestamp: new Date() },
            ]);
          // Add the current message and reply
          caseResponses.push(
            { adminId: null, message: `User: ${message}`, timestamp: new Date() },
            { adminId: null, message: `Bot: ${cleanReply}`, timestamp: new Date() }
          );

          // Check for existing case
          const existingCase = await Case.findOne({
            userId,
            orderId: caseData.orderId,
            productIndex: caseData.productIndex,
          });

          let newCase;
          if (existingCase) {
            // Update existing case
            existingCase.description = caseData.description || message;
            existingCase.priority = priority;
            existingCase.responses.push(...caseResponses);
            existingCase.updatedAt = new Date();
            await existingCase.save();
            newCase = existingCase;
            console.log(`Updated case ${newCase._id} for user ${userId}: order ${caseData.orderId}, product index ${caseData.productIndex}, priority ${priority}`);
          } else {
            // Create new case
            newCase = new Case({
              userId,
              orderId: caseData.orderId,
              productIndex: caseData.productIndex,
              description: caseData.description || message,
              priority,
              responses: caseResponses,
            });
            await newCase.save();
            console.log(`Created case ${newCase._id} for user ${userId}: order ${caseData.orderId}, product index ${caseData.productIndex}, priority ${priority}`);
          }
          console.log(`Case responses included:`, caseResponses);

          // Update Redis chat history with caseId
          const updatedChatHistory = chatHistory.map((chat) => {
            if (
              chat.orderId === caseData.orderId &&
              chat.productIndex === caseData.productIndex &&
              chat.caseId === null
            ) {
              return { ...chat, caseId: newCase._id.toString() };
            }
            return chat;
          });
          // Replace Redis chat history
          await redisClient.del(`chat:${userId}`);
          for (const chat of updatedChatHistory) {
            await redisClient.rPush(`chat:${userId}`, JSON.stringify(chat));
          }
          await redisClient.expire(`chat:${userId}`, 86400);
        }
      }
    } catch (parseErr) {
      console.error("Failed to parse case JSON from reply:", parseErr, "Reply:", reply);
    }

    const cleanReply = reply.replace(/```(?:json)?\n|\n```|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?=\s*$)/g, "").trim();

    // Store current message in Redis with orderId, productIndex, and caseId: null
    await redisClient.rPush(
      `chat:${userId}`,
      JSON.stringify({
        prompt: message,
        reply: cleanReply,
        orderId: selectedProduct.orderId,
        productIndex: selectedProduct.productIndex,
        caseId: null,
      })
    );
    await redisClient.expire(`chat:${userId}`, 86400);

    res.json({ reply: cleanReply });
  } catch (err) {
    console.error("Chat error:", err.response?.data || err.message);
    res.status(500).json({ error: "Chat failed" });
  }
});

// --- MongoDB Connection ---

// --- MongoDB Connection ---
const start = Date.now();
mongoose.set("debug", true);
mongoose
  .connect(process.env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    maxPoolSize: 10,
    minPoolSize: 2,
    connectTimeoutMS: 10000,
    socketTimeoutMS: 45000,
  })
  .then(async () => {
    console.log(`✅ MongoDB Connected in ${Date.now() - start}ms`);
    // Optionally initialize FAQs with an empty array or new data if needed
    // await initFaqs([]);
  })
  .catch((err) => {
    console.error("MongoDB connection error:", {
      message: err.message,
      name: err.name,
      code: err.code,
      stack: err.stack,
    });
    process.exit(1);
  });
// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));