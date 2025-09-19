// server.js - Fixed Regex, Enhanced Prompt, and Robust Fallback
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { createClient } from "redis";

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
const GEMINI_MODELS = ["gemini-1.5-pro", "gemini-1.5-flash", "gemini-1.0"];

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
  priority: { type: Number, default: 1, enum: [1, 2, 3] },
  status: { type: String, default: "open", enum: ["open", "in-progress", "resolved"] },
  productChanges: {
    name: String,
    price: Number,
    quantity: Number,
  },
  responses: [
    {
      adminId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      message: String,
      timestamp: { type: Date, default: Date.now },
    },
  ],
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
});
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
// Add this endpoint after the existing admin cases endpoint
app.get("/api/admin/orders", authMiddleware, async (req, res) => {
  if (req.userRole !== "admin") {
    return res.status(403).json({ error: "Admin access required" });
  }
  try {
    const users = await User.find({}, "name email orders").lean();
    const orders = users.flatMap(user => 
      user.orders.map(order => ({
        ...order,
        userId: user._id,
        userName: user.name,
        userEmail: user.email
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

    // Sync product changes to user's orders if productChanges provided
    if (updates.productChanges) {
      const user = await User.findById(updatedCase.userId._id);
      const order = user.orders.find((o) => o.orderId === updatedCase.orderId);
      if (order && order.products[updatedCase.productIndex]) {
        const product = order.products[updatedCase.productIndex];
        if (updates.productChanges.name !== undefined) product.name = updates.productChanges.name;
        if (updates.productChanges.price !== undefined) product.price = updates.productChanges.price;
        if (updates.productChanges.quantity !== undefined) product.quantity = updates.productChanges.quantity;

        // Recalculate totalAmount if price changed
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

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const userData = { ...user };
    delete userData.password;

    await redisClient.set(`user:${user._id}`, JSON.stringify(userData), { EX: 3600 });
    await redisClient.del(`chat:${user._id}`);

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
    console.log(`User ${userId} session and chat history cleared`);
    res.json({ message: "Logout successful" });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).json({ error: "Logout failed" });
  }
});

// --- Chat - Fixed Regex and Enhanced Prompt ---
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

    const chatHistory = (await redisClient.lRange(`chat:${userId}`, 0, -1)).map(JSON.parse);

    // Build concise order text with clear indices
    let orderText = "User Orders:\n";
    if (user.orders && user.orders.length > 0) {
      user.orders.forEach((o, orderIdx) => {
        orderText += `Order ${o.orderId} (Status: ${o.status}, Date: ${new Date(o.orderDate).toLocaleDateString()}):\n`;
        o.products.forEach((p, prodIdx) => {
          orderText += `  Product Index ${prodIdx}: ${p.name} (Qty: ${p.quantity}, Price: ₹${p.price})\n`;
        });
        orderText += "\n";
      });
    } else {
      orderText += "No orders found.\n";
    }

    // Improved, structured prompt
    let prompt = `You are a helpful e-commerce assistant. Always use the provided user data below when answering questions about orders, products, or creating support cases.

USER DATA:
Name: ${user.name}
Email: ${user.email}
Role: ${user.role}

${orderText}

INSTRUCTIONS:
- If the user asks about their products or orders (e.g., "what are my products", "show my orders"), list them directly from the USER DATA above in a clear, bulleted format. Do not say you have no access.
- If the user wants to create a support case/ticket (keywords: "create case", "report issue", "problem with", "complaint", "refund", "return", "defective", "delivery issue"), identify the relevant orderId and productIndex from USER DATA by matching the product name case-insensitively. If multiple products match, choose the first match. Then, respond helpfully (e.g., "I've created a support case for your [product]...") and end your response with exactly this JSON on a new line, without wrapping in code blocks, backticks, or extra text: {"createCase": true, "orderId": "exact_order_id", "productIndex": exact_number, "description": "brief_summary_of_issue"}
- If no product match is found or the query is ambiguous (e.g., no specific product mentioned), respond with: "Please specify the product and order for your issue." and do not include JSON.
- For other queries, answer normally using the USER DATA if relevant.
- Ensure responses are concise, helpful, and strictly follow the JSON format for case creation.

Chat History:
${chatHistory.length > 0 ? chatHistory.slice(-5).map(c => `Q: ${c.prompt}\nA: ${c.reply}`).join("\n\n") : "No history."}

User Query: "${message}"

Your Response:`;

    console.log("Full prompt sent to Gemini:", prompt.substring(0, 500) + "..."); // Log truncated prompt for debugging

    const reply = await callGemini(prompt);

    console.log("Gemini reply:", reply); // Log full reply for debugging

    // Parse for case creation JSON, handling Markdown code blocks
    let caseData = null;
    try {
      // Remove Markdown code block markers if present
      const cleanReply = reply.replace(/```(?:json)?\n|\n```/g, "").trim();
      console.log("Cleaned reply for JSON parsing:", cleanReply);
      // Match JSON at the end or standalone
      const jsonMatch = cleanReply.match(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?=\s*$)/);
      if (jsonMatch) {
        caseData = JSON.parse(jsonMatch[0]);
        console.log("Parsed case data:", caseData);
        if (caseData.createCase) {
          // Verify orderId and productIndex exist
          const userWithOrders = await User.findById(userId).select("orders");
          const order = userWithOrders.orders.find(o => o.orderId === caseData.orderId);
          const productIndexValid = order && caseData.productIndex >= 0 && caseData.productIndex < order.products.length;

          if (order && productIndexValid) {
            const existingCase = await Case.findOne({
              userId,
              orderId: caseData.orderId,
              productIndex: caseData.productIndex,
            });
            if (!existingCase) {
              const newCase = new Case({
                userId,
                orderId: caseData.orderId,
                productIndex: caseData.productIndex,
                description: caseData.description || message,
              });
              await newCase.save();
              console.log(`Auto-created case for user ${userId}: ${newCase._id} for order ${caseData.orderId}, product index ${caseData.productIndex}`);
            } else {
              console.log(`Case already exists for user ${userId}, order ${caseData.orderId}, product index ${caseData.productIndex}`);
            }
          } else {
            console.log(`Invalid orderId or productIndex in case data: orderId=${caseData.orderId}, productIndex=${caseData.productIndex}`);
          }
        }
      } else {
        console.log("No JSON found in cleaned reply");
      }
    } catch (parseErr) {
      console.error("Failed to parse case JSON from reply:", parseErr, "Reply:", reply);
    }

    // Fallback case creation for keywords if no JSON
    if (!caseData) {
      const caseKeywords = ["create case", "report issue", "problem with", "complaint", "refund", "return", "defective", "delivery issue"];
      const lowerMessage = message.toLowerCase();
      if (caseKeywords.some(keyword => lowerMessage.includes(keyword))) {
        // Try to match product name
        const userWithOrders = await User.findById(userId).select("orders");
        let matchedOrder = null;
        let matchedProductIndex = null;
        for (const order of userWithOrders.orders) {
          for (let i = 0; i < order.products.length; i++) {
            if (lowerMessage.includes(order.products[i].name.toLowerCase())) {
              matchedOrder = order;
              matchedProductIndex = i;
              break;
            }
          }
          if (matchedOrder) break;
        }
        if (matchedOrder && matchedProductIndex !== null) {
          const existingCase = await Case.findOne({
            userId,
            orderId: matchedOrder.orderId,
            productIndex: matchedProductIndex,
          });
          if (!existingCase) {
            const newCase = new Case({
              userId,
              orderId: matchedOrder.orderId,
              productIndex: matchedProductIndex,
              description: message,
            });
            await newCase.save();
            console.log(`Fallback: Auto-created case for user ${userId}: ${newCase._id} for order ${matchedOrder.orderId}, product index ${matchedProductIndex}`);
          } else {
            console.log(`Fallback: Case already exists for user ${userId}, order ${matchedOrder.orderId}, product index ${matchedProductIndex}`);
          }
        } else {
          console.log("Fallback: No product match found for case creation");
        }
      }
    }

    // Clean reply by removing JSON (including Markdown) if present
    const cleanReply = reply.replace(/```(?:json)?\n|\n```|\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}(?=\s*$)/g, "").trim();

    await redisClient.rPush(`chat:${userId}`, JSON.stringify({ prompt: message, reply: cleanReply }));
    await redisClient.expire(`chat:${userId}`, 86400);

    res.json({ reply: cleanReply });
  } catch (err) {
    console.error("Chat error:", err.response?.data || err.message);
    res.status(500).json({ error: "Chat failed" });
  }
});

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
  .then(() => console.log(`✅ MongoDB Connected in ${Date.now() - start}ms`))
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