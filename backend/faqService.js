import axios from "axios";
import mongoose from "mongoose";

// --- FAQ Model ---
const faqSchema = new mongoose.Schema({
  question: String,
  answer: String,
  domain: String,
  embedding: [Number],
}, { collection: 'faqs' });

// Use existing model if already compiled (prevents OverwriteModelError)
const Faq = mongoose.models.Faq || mongoose.model("Faq", faqSchema);

// --- Get embedding from Gemini ---
async function getEmbedding(text) {
  try {
    const response = await axios.post(
      `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${process.env.GEMINI_API_KEY}`,
      { content: { parts: [{ text }] } },
      { headers: { "Content-Type": "application/json" } }
    );
    return response.data.embedding.values;
  } catch (err) {
    console.error("Embedding error:", err.message);
    throw new Error("Failed to get embedding");
  }
}

// --- Cosine similarity ---
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  const magA = Math.sqrt(a.reduce((sum, val) => sum + val * val, 0));
  const magB = Math.sqrt(b.reduce((sum, val) => sum + val * val, 0));
  return dot / (magA * magB);
}

// --- Initialize FAQs ---
async function initFaqs(faqCollections) {
  for (const collection of faqCollections) {
    for (const faq of collection.faqs) {
      const existing = await Faq.findOne({ question: faq.question, domain: faq.domain });
      if (!existing) {
        const embedding = await getEmbedding(faq.question);
        await new Faq({ ...faq, embedding }).save();
        console.log(`Added FAQ: ${faq.question} for domain: ${faq.domain}`);
      }
    }
  }
}

// --- Check user query against FAQs ---
async function checkFaq(message) {
  try {
    const queryEmbedding = await getEmbedding(message);
    const faqs = await Faq.find({});
    let maxSim = 0;
    let bestAnswer = null;

    for (const faq of faqs) {
      const sim = cosineSimilarity(queryEmbedding, faq.embedding);
      if (sim > maxSim) {
        maxSim = sim;
        bestAnswer = faq.answer;
      }
    }

    if (maxSim > 0.8) return bestAnswer; // Threshold for similarity
    return null;
  } catch (err) {
    console.error("Check FAQ error:", err.message);
    return null;
  }
}

// Export all necessary functions and models
export { initFaqs, checkFaq, getEmbedding, Faq };