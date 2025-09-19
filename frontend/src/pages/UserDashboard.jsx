// Updated UserDashboard.js - Show User Cases
import React, { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import "../styles/dashboard.css";

export default function UserDashboard() {
  const { id } = useParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState(null);
  const [userCases, setUserCases] = useState([]);
  const [error, setError] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const navigate = useNavigate();
  const chatBoxRef = useRef(null);

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const token = localStorage.getItem("token");
        console.log("Token:", token);
        if (!token) {
          setError("No authentication token found. Please log in.");
          navigate("/");
          return;
        }

        console.log("Fetching user with ID:", id);
        const source = axios.CancelToken.source();
        const timeout = setTimeout(() => {
          source.cancel("Request timed out");
        }, 10000);

        const res = await axios.get(`http://localhost:5000/api/user/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cancelToken: source.token,
        });

        clearTimeout(timeout);
        console.log("User data received:", res.data);
        if (res.data) {
          setUser(res.data);
        } else {
          setError("No user data returned from the server.");
        }
      } catch (err) {
        console.error("Failed to fetch user:", err);
        if (axios.isCancel(err)) {
          setError("Request to fetch user data timed out. Please try again.");
        } else {
          setError(err.response?.data?.error || "Failed to load user data.");
          if (err.response?.status === 401) {
            localStorage.removeItem("token");
            navigate("/");
          }
        }
      }
    };
    fetchUser();
  }, [id, navigate]);

  // Fetch user cases
  useEffect(() => {
    const fetchUserCases = async () => {
      if (!id) return;
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get(`http://localhost:5000/api/user/${id}/cases`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        setUserCases(res.data.cases);
      } catch (err) {
        console.error("Failed to fetch user cases:", err);
      }
    };
    fetchUserCases();
  }, [id]);

  useEffect(() => {
    if (chatBoxRef.current && isChatOpen) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, isChatOpen]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMsg = { text: input, sender: "user" };
    setMessages((prev) => [...prev, userMsg]);

    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setError("No authentication token found. Please log in.");
        navigate("/");
        return;
      }

      const res = await axios.post(
        "http://localhost:5000/api/chat",
        { message: input },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const botMsg = { text: res.data.reply, sender: "bot" };
      setMessages((prev) => [...prev, botMsg]);
    } catch (err) {
      console.error("Chat error:", err);
      setError(err.response?.data?.error || "Failed to send message.");
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
    navigate("/");
  };

  const toggleChat = () => {
    setIsChatOpen((prev) => !prev);
  };

  if (error) {
    return (
      <div className="dashboard">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <button onClick={() => navigate("/")}>Back to Login</button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="dashboard">
        <div className="loading">Loading user data...</div>
      </div>
    );
  }

  const allProducts = user.orders.flatMap((order) =>
    order.products.map((product, index) => ({
      ...product,
      orderId: order.orderId,
      orderDate: order.orderDate,
      status: order.status,
      productIndex: index,
    }))
  );

  return (
    <div className="dashboard">
      <h2>Welcome, {user.name}</h2>

      <div className="product-list">
        <h3>Your Ordered Products</h3>
        {allProducts.length > 0 ? (
          <div className="product-grid">
            {allProducts.map((product, index) => (
              <div key={index} className="product-card">
                <h4>{product.name}</h4>
                <p>Quantity: {product.quantity}</p>
                <p>Price: ₹{product.price}</p>
                <p>Order ID: {product.orderId}</p>
                <p>Order Date: {new Date(product.orderDate).toLocaleDateString()}</p>
                <p>Status: {product.status}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No products ordered yet.</p>
        )}
      </div>

      {/* User Cases Section */}
      <div className="cases-section">
        <h3>Your Cases</h3>
        {userCases.length > 0 ? (
          <div className="cases-list">
            {userCases.map((caseItem) => (
              <div key={caseItem._id} className="case-card">
                <h4>Case ID: {caseItem._id}</h4>
                <p><strong>Order ID:</strong> {caseItem.orderId}</p>
                <p><strong>Description:</strong> {caseItem.description}</p>
                <p><strong>Status:</strong> {caseItem.status}</p>
                <p><strong>Priority:</strong> {caseItem.priority}</p>
                {caseItem.responses && caseItem.responses.length > 0 && (
                  <div>
                    <h5>Admin Responses:</h5>
                    {caseItem.responses.map((response, idx) => (
                      <p key={idx}><strong>{response.adminId?.name}:</strong> {response.message}</p>
                    ))}
                  </div>
                )}
                <small>Created: {new Date(caseItem.createdAt).toLocaleString()}</small>
              </div>
            ))}
          </div>
        ) : (
          <p>No cases created yet. Chat with the assistant about any product issues to create one automatically.</p>
        )}
      </div>

      <button className="chatbot-icon" onClick={toggleChat}>
        💬
      </button>

      <div className={`chat-container ${isChatOpen ? "open" : "closed"}`}>
        <div className="chat-header">
          <h3>Chat with Assistant</h3>
          <button className="close-chat" onClick={toggleChat}>
            ×
          </button>
        </div>
        <div className="chat-box" ref={chatBoxRef}>
          {messages.map((msg, i) => (
            <div
              key={i}
              className={msg.sender === "user" ? "user-msg" : "bot-msg"}
            >
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          ))}
        </div>
        <div className="chat-input">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type your message... (e.g., 'I have a problem with my order product')"
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button onClick={handleSend}>➤</button>
        </div>
      </div>

      <button className="logout-btn" onClick={handleLogout}>
        Logout
      </button>
    </div>
  );
}