// server.js
import express from "express";
import mongoose from "mongoose";
import dotenv from "dotenv";
import cors from "cors";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import axios from "axios";
import { createClient } from "redis";

dotenv.config();

const app = express();
app.use(express.json());
app.use(cors());

// --- Redis Client ---
const redisClient = createClient({
  url: process.env.REDIS_URL || "redis://localhost:6379",
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
const User = mongoose.model("User", userSchema);

// --- Middleware: Auth ---
async function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized, token missing" });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.userId = decoded.id;
    req.userRole = decoded.role; // Add role to req
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}
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
// --- Signup ---
app.post("/api/signup", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const user = new User({ name, email, password: hashed, role });
    await user.save();
    res.json({ message: "Signup successful" });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: "Signup failed" });
  }
});

// --- Login ---
app.post("/api/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: "Invalid email" });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ error: "Invalid password" });

    const token = jwt.sign({ id: user._id, role: user.role }, process.env.JWT_SECRET, { expiresIn: "1h" });

    const userData = { ...user.toObject() };
    delete userData.password;

    // Save user session in Redis
    await redisClient.set(`user:${user._id}`, JSON.stringify(userData), { EX: 3600 });
    await redisClient.del(`chat:${user._id}`);

    res.json({ token, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Login failed" });
  }
});

// --- Logout ---
app.post("/api/logout", async (req, res) => {
  try {
    // Delete all Redis data
    await redisClient.flushAll();
    console.log("All Redis data cleared");
    res.json({ message: "Logout successful, Redis memory cleared (all keys)" });
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

    // --- Get user data from Redis ---
    let userData = await redisClient.get(`user:${userId}`);
    if (!userData) {
      const user = await User.findById(userId).lean();
      if (!user) return res.status(404).json({ error: "User not found" });
      delete user.password;
      delete user.__v;
      userData = JSON.stringify(user);
      await redisClient.set(`user:${userId}`, userData, { EX: 3600 });
    }
    const user = JSON.parse(userData);

    // --- Chat history ---
    const chatHistory = (await redisClient.lRange(`chat:${userId}`, 0, -1)).map(JSON.parse);

    // --- Build prompt ---
    let prompt = "You are a helpful assistant.\n";
    const lowerMsg = message.toLowerCase();
    if (lowerMsg.includes("order") || lowerMsg.includes("status") || lowerMsg.includes("delivery")) {
      const orderText = user.orders.map(o => `**Order ID:** ${o.orderId}
- **Status:** ${o.status}
- **Total Amount:** ₹${o.totalAmount}
- **Payment Method:** ${o.paymentMethod}
- **Order Date:** ${new Date(o.orderDate).toLocaleString()}
- **Expected Delivery:** ${o.delivery.expectedDeliveryDate}
- **Delivery Address:** ${o.delivery.address}, Pincode: ${o.delivery.pincode}
- **Products:**
${o.products.map(p => `  - ${p.name} (Qty: ${p.quantity}, Price: ₹${p.price})`).join("\n")}`).join("\n\n");

      prompt += `User Data:\nName: ${user.name}\nEmail: ${user.email}\nRole: ${user.role}\n\nOrders:\n${orderText}\n`;
    }

    if (chatHistory.length > 0) {
      prompt += "\nChat History:\n" + chatHistory.map(c => `Q: ${c.prompt}\nA: ${c.reply}`).join("\n\n");
    }

    prompt += `\nUser Query: "${message}"\nAnswer based only on the user's data and orders.`;

    // --- Call Gemini ---
    const reply = await callGemini(prompt);

    // --- Save chat in Redis ---
    await redisClient.rPush(`chat:${userId}`, JSON.stringify({ prompt: message, reply }));
    await redisClient.expire(`chat:${userId}`, 86400);

    res.json({ reply });
  } catch (err) {
    console.error("Chat error:", err.response?.data || err.message);
    res.status(500).json({ error: "Chat failed" });
  }
});

// --- MongoDB ---
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ MongoDB Connected"))
  .catch((err) => console.error(err));

// --- Start Server ---
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
