import React, { useState } from "react";
import axios from "axios";
import "../styles/dashboard.css";
import ReactMarkdown from "react-markdown";

export default function UserDashboard() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = { text: input, sender: "user" };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const token = localStorage.getItem("token");
      const res = await axios.post(
        "http://localhost:5000/api/chat",
        { message: input },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const botMsg = { text: res.data.reply, sender: "bot" };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error(err);
    }
    setInput("");
  };

  const handleLogout = async () => {
    try {
      const token = localStorage.getItem("token");
      if (token) {
        await axios.post(
          "http://localhost:5000/api/logout",
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
    } catch (err) {
      console.error("Logout error:", err);
    }

    localStorage.removeItem("token");
    window.location.href = "/"; // back to login
  };

  return (
    <div className="dashboard">
      <div className="chat-container">
        <div className="chat-box">
          {messages.map((msg, i) => (
            <div key={i} className={msg.sender === "user" ? "user-msg" : "bot-msg"}>
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          ))}
        </div>

        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message..."
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button onClick={handleSend}>➤</button>
        </div>

        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>
    </div>
  );
}
