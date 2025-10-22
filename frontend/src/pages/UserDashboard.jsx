import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import ReactMarkdown from "react-markdown";
import "../styles/UserDashboard.css";

export default function UserDashboard() {
  const { id } = useParams();
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [user, setUser] = useState(null);
  const [userCases, setUserCases] = useState([]);
  const [error, setError] = useState(null);
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(null);
  const [selectedDomain, setSelectedDomain] = useState(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const chatBoxRef = useRef(null);

  // Define domains for display
  const domains = [
    { name: "E-commerce", icon: "🛒", description: "Manage your online shopping orders and support cases." },
    { name: "Travel", icon: "✈️", description: "Track travel bookings and resolve travel-related issues." },
    { name: "Telecommunications", icon: "📱", description: "Handle mobile plans, billing, and service queries." },
    { name: "Banking Services", icon: "🏦", description: "Monitor accounts, transactions, and banking support." },
  ];

  // Fetch user cases with cache busting
  const fetchUserCases = useCallback(async () => {
    if (!id || !selectedDomain) return;
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      console.log(`Fetching cases for user ${id}, domain: ${selectedDomain}`);
      const res = await axios.get(`http://localhost:5000/api/user/${id}/cases?domain=${selectedDomain}&_t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      setUserCases(res.data.cases || []);
      console.log(`Found ${res.data.cases.length} cases for domain ${selectedDomain}`);
      setError(null);
    } catch (err) {
      console.error("Failed to fetch user cases:", err);
      setError(err.response?.data?.error || "Failed to fetch cases.");
    } finally {
      setLoading(false);
    }
  }, [id, selectedDomain]);

  // Fetch user data on mount
  useEffect(() => {
    const fetchUser = async () => {
      setLoading(true);
      setError(null);
      try {
        const token = localStorage.getItem("token");
        if (!token) {
          setError("No authentication token found. Please log in.");
          navigate("/");
          return;
        }

        const source = axios.CancelToken.source();
        const timeout = setTimeout(() => {
          source.cancel("Request timed out");
        }, 10000);

        const res = await axios.get(`http://localhost:5000/api/user/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
          cancelToken: source.token,
        });

        clearTimeout(timeout);
        if (res.data) {
          setUser(res.data);
          console.log("User data fetched:", res.data);
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
      } finally {
        setLoading(false);
      }
    };
    fetchUser();
  }, [id, navigate]);

  // Fetch cases when domain is selected
  useEffect(() => {
    if (selectedDomain) {
      console.log(`Selected domain changed to: ${selectedDomain}`);
      fetchUserCases();
    }
  }, [selectedDomain, fetchUserCases]);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    if (chatBoxRef.current && isChatOpen) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight;
    }
  }, [messages, isChatOpen]);

  // Handle domain selection
  const handleDomainClick = (domain) => {
    setSelectedDomain(domain.name);
    setSelectedProduct(null);
    setIsChatOpen(false);
    setMessages([]);
    console.log(`Domain selected: ${domain.name}`);
  };

  // Handle product selection
  const handleProductClick = async (product) => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      console.log(`Selecting product: ${product.name}`);
      await axios.post(
        "http://localhost:5000/api/select-product",
        { orderId: product.orderId, productIndex: product.productIndex },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSelectedProduct(product);
      setIsChatOpen(true);
      setMessages([]);
      setError(null);
    } catch (err) {
      console.error("Failed to select product:", err);
      setError("Failed to select product for chat.");
    } finally {
      setLoading(false);
    }
  };

  // Handle sending chat message
  const handleSend = async () => {
    const messageToSend = input.trim();
    if (!messageToSend || !selectedProduct) return;

    // Add user message
    const userMsg = {
      text: messageToSend,
      sender: "user",
      senderName: user?.name || "User",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMsg]);

    // Handle messages with backend API
    setLoading(true);
    setError(null);

    try {
      const token = localStorage.getItem("token");
      if (!token) {
        setError("No authentication token found. Please log in.");
        navigate("/");
        return;
      }

      const res = await axios.post(
        "http://localhost:5000/api/chat",
        { message: messageToSend },
        { headers: { Authorization: `Bearer ${token}` } }
      );

      const botMsg = {
        text: res.data.reply,
        sender: "bot",
        senderName: "Support Bot",
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, botMsg]);

      // Refresh cases after a delay to allow backend to process
      setTimeout(fetchUserCases, 1000);
      setError(null);
    } catch (err) {
      console.error("Chat error:", err);
      setError(err.response?.data?.error || "Failed to send message.");
    } finally {
      setLoading(false);
      setInput(""); // Clear input after sending
    }
  };

  // Handle closing chat
  const handleCloseChat = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      await axios.post(
        "http://localhost:5000/api/clear-selected-product",
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setSelectedProduct(null);
      setMessages([]);
      setIsChatOpen(false);
      setError(null);
    } catch (err) {
      console.error("Failed to clear selected product:", err);
      setError("Failed to clear selected product.");
    } finally {
      setLoading(false);
    }
  };

  // Handle logout
  const handleLogout = async () => {
    setLoading(true);
    setError(null);
    try {
      const token = localStorage.getItem("token");
      if (token) {
        await axios.post(
          "http://localhost:5000/api/logout",
          {},
          { headers: { Authorization: `Bearer ${token}` } }
        );
      }
      localStorage.removeItem("token");
      navigate("/");
    } catch (err) {
      console.error("Logout error:", err);
      setError("Logout failed.");
    } finally {
      setLoading(false);
    }
  };

  // Handle enter key for sending messages
  const handleKeyPress = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (error) {
    return (
      <div className="user-dashboard">
        <h2>Error</h2>
        <p className="error-message">{error}</p>
        <button onClick={() => navigate("/")} className="logout-btn">
          Back to Login
        </button>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="user-dashboard">
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
  ).filter((product) => !selectedDomain || product.domain === selectedDomain);

  return (
    <div className="user-dashboard">
      <button onClick={handleLogout} className="logout-btn">
        Logout
      </button>
      <h2>Welcome, {user.name}</h2>

      <div className="domain-section">
        <h3>Your Domains</h3>
        <div className="domain-grid">
          {domains.map((domain, index) => (
            <div
              key={index}
              className={`domain-card ${selectedDomain === domain.name ? "selected" : ""}`}
              onClick={() => handleDomainClick(domain)}
            >
              <span className="domain-icon">{domain.icon}</span>
              <h4>{domain.name}</h4>
              <p>{domain.description}</p>
            </div>
          ))}
        </div>
      </div>

      {selectedDomain && (
        <>
          <div className="product-list">
            <h3>{selectedDomain} Products</h3>
            {loading && <div className="loading">Loading...</div>}
            {allProducts.length > 0 ? (
              <div className="product-grid">
                {allProducts.map((product, index) => {
                  const hasCase = userCases.some(
                    (c) => c.orderId === product.orderId && c.productIndex === product.productIndex
                  );
                  const isSelected =
                    selectedProduct &&
                    selectedProduct.orderId === product.orderId &&
                    selectedProduct.productIndex === product.productIndex;
                  return (
                    <div
                      key={index}
                      className={`product-card ${isSelected ? "selected" : ""}`}
                      onClick={() => handleProductClick(product)}
                    >
                      <h4>{product.name}</h4>
                      <p>Quantity: {product.quantity}</p>
                      <p>Price: ₹{product.price}</p>
                      <p>Order ID: {product.orderId}</p>
                      <p>Order Date: {new Date(product.orderDate).toLocaleDateString()}</p>
                      <p>Status: {product.status}</p>
                      {hasCase && <span className="ticket-badge">Ticket Created</span>}
                    </div>
                  );
                })}
              </div>
            ) : (
              <p>No products ordered in {selectedDomain} yet.</p>
            )}
          </div>

          <div className="cases-section">
            <h3>Your {selectedDomain} Cases</h3>
            {loading && <div className="loading">Loading...</div>}
            {userCases.length > 0 ? (
              <div className="cases-list">
                {userCases.map((caseItem) => (
                  <div key={caseItem._id} className="case-card">
                    <h4>Case ID: {caseItem._id}</h4>
                    <p>
                      <strong>Order ID:</strong> {caseItem.orderId}
                    </p>
                    <p>
                      <strong>Product Index:</strong> {caseItem.productIndex}
                    </p>
                    <p>
                      <strong>Description:</strong> {caseItem.description}
                    </p>
                    <p>
                      <strong>Priority:</strong> {caseItem.priority}
                    </p>
                    <p>
                      <strong>Status:</strong> {caseItem.status}
                    </p>
                    <p>
                      <strong>Created:</strong> {new Date(caseItem.createdAt).toLocaleString()}
                    </p>
                    <p>
                      <strong>Updated:</strong> {new Date(caseItem.updatedAt).toLocaleString()}
                    </p>
                    <h5>Responses:</h5>
                    <div className="response">
                      {caseItem.responses.length > 0 ? (
                        caseItem.responses.map((response, index) => (
                          <div key={index} className="admin-msg">
                            <div className="sender-info">{response.adminId?.name || "Support Bot"}</div>
                            <div className="message-text">
                              <ReactMarkdown>{response.message}</ReactMarkdown>
                            </div>
                            <div className="timestamp">
                              {new Date(response.timestamp).toLocaleString()}
                            </div>
                          </div>
                        ))
                      ) : (
                        <p>
                          <small>No responses yet.</small>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p>No cases found for {selectedDomain}.</p>
            )}
          </div>
        </>
      )}

      {isChatOpen && (
        <div className="chat-container">
          <div className="chat-header">
            <h3>
              {selectedProduct ? `Chat for ${selectedProduct.name}` : "Support Chat"}
            </h3>
            <button className="close-chat" onClick={handleCloseChat}>
              &times;
            </button>
          </div>
          <div className="chat-box" ref={chatBoxRef}>
            {messages.length === 0 ? (
              <h3><b>💬Start a conversation with our AI Assistant 🤖 for instant support.</b></h3>
            ) : (
              messages.map((msg, index) => (
                <div key={index} className={msg.sender === "user" ? "user-msg" : "bot-msg"}>
                  <div className="sender-info">{msg.senderName}</div>
                  <div className="message-text">
                    <ReactMarkdown>{msg.text}</ReactMarkdown>
                  </div>
                  <div className="timestamp">{new Date(msg.timestamp).toLocaleString()}</div>
                </div>
              ))
            )}
          </div>
          <div className="chat-input">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              placeholder="Type your message..."
              disabled={loading}
            />
            <button onClick={() => handleSend()} disabled={loading}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                width="24"
                height="24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
