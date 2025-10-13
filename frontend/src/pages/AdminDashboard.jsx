import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import "../styles/AdminDashboard.css";

export default function AdminDashboard() {
  const [token] = useState(localStorage.getItem("token") || "");
  const [allCases, setAllCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [activeTab, setActiveTab] = useState("new");

  // Fetch all cases with retry
  const fetchCases = useCallback(async (retryCount = 0) => {
    setLoading(true);
    setError("");
    try {
      const response = await axios.get(`http://localhost:5000/api/admin/cases?_t=${Date.now()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cases = response.data.cases || [];
      const sortedCases = cases.sort((a, b) => {
        if (a.priority === "high" && b.priority !== "high") return -1;
        if (a.priority !== "high" && b.priority === "high") return 1;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      setAllCases(sortedCases);
    } catch (err) {
      if (retryCount < 2) {
        console.warn(`Retrying fetchCases, attempt ${retryCount + 1}`);
        setTimeout(() => fetchCases(retryCount + 1), 1000);
      } else {
        setError(err.response?.data?.error || "Failed to fetch cases");
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Update case status (toggle switch)
  const updateCaseStatus = async (caseId, newStatus) => {
    setLoading(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await axios.put(
        `http://localhost:5000/api/case/${caseId}`,
        { status: newStatus },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAllCases(allCases.map((c) => (c._id === caseId ? response.data.case : c)));
      if (selectedCase?._id === caseId) {
        setSelectedCase(response.data.case);
      }
      setSuccessMessage(`Case ${newStatus === "resolved" ? "closed" : "reopened"} successfully`);
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update case status");
    } finally {
      setLoading(false);
    }
  };

  // Add response to case
  const addResponse = async (caseId) => {
    if (!responseMessage.trim()) {
      setError("Response message cannot be empty");
      return;
    }
    setLoading(true);
    setError("");
    setSuccessMessage("");
    try {
      const response = await axios.post(
        `http://localhost:5000/api/case/${caseId}/response`,
        { message: responseMessage },
        { headers: { Authorization: `Bearer ${token}` } }
      );
      setAllCases(allCases.map((c) => (c._id === caseId ? response.data.case : c)));
      if (selectedCase?._id === caseId) {
        setSelectedCase(response.data.case);
      }
      setResponseMessage("");
      setSuccessMessage("Response sent successfully");
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add response");
    } finally {
      setLoading(false);
    }
  };

  // Logout
  const handleLogout = async () => {
    setLoading(true);
    setError("");
    try {
      await axios.post(
        "http://localhost:5000/api/logout",
        {},
        { headers: { Authorization: `Bearer ${token}` } }
      );
      localStorage.removeItem("token");
      window.location.href = "/";
    } catch (err) {
      setError(err.response?.data?.error || "Logout failed");
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on mount if token exists
  useEffect(() => {
    if (token) {
      fetchCases();
    } else {
      setError("No authentication token found. Please log in.");
      window.location.href = "/";
    }
  }, [token, fetchCases]);

  // Categorize cases
  const newCases = allCases.filter(
    (c) => !c.responses.some((r) => r.adminId !== null)
  );
  const pendingCases = allCases.filter(
    (c) => c.responses.some((r) => r.adminId !== null) && c.status !== "resolved"
  );
  const closedCases = allCases.filter((c) => c.status === "resolved");

  const displayedCases =
    activeTab === "new"
      ? newCases
      : activeTab === "pending"
      ? pendingCases
      : closedCases;

  // Handle key press for sending response
  const handleKeyPress = (e, caseId) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      addResponse(caseId);
    }
  };

  return (
    <div className="admin-dashboard">
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>

      {loading && <div className="loading">Loading...</div>}
      {error && <div className="error-message">{error}</div>}
      {successMessage && <div className="success-message">{successMessage}</div>}

      <div className="cases-nav">
        <button
          className={`nav-tab ${activeTab === "new" ? "active" : ""}`}
          onClick={() => setActiveTab("new")}
        >
          New ({newCases.length})
        </button>
        <button
          className={`nav-tab ${activeTab === "pending" ? "active" : ""}`}
          onClick={() => setActiveTab("pending")}
        >
          Pending ({pendingCases.length})
        </button>
        <button
          className={`nav-tab ${activeTab === "closed" ? "active" : ""}`}
          onClick={() => setActiveTab("closed")}
        >
          Closed ({closedCases.length})
        </button>
      </div>

      <div className="cases-section">
        <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Cases</h2>
        <div className="cases-list">
          {displayedCases.length === 0 ? (
            <p className="no-cases">
              No {activeTab} cases found.
            </p>
          ) : (
            displayedCases.map((c) => (
              <div
                key={c._id}
                className={`case-card ${c.priority === "high" ? "high-priority" : ""}`}
                onClick={() => setSelectedCase(c)}
              >
                <p><strong>Case ID:</strong> {c._id.slice(-6)}</p>
                <p><strong>User:</strong> {c.userId?.name || "Unknown"}</p>
                <p><strong>Description:</strong> {c.description}</p>
                <p><strong>Priority:</strong> {c.priority}</p>
              </div>
            ))
          )}
        </div>
      </div>

      {selectedCase && (
        <div className="case-popup">
          <div className="case-popup-content">
            <div className="case-popup-header">
              <h3>Case #{selectedCase._id.slice(-6)}</h3>
              <button className="close-popup" onClick={() => setSelectedCase(null)}>
                &times;
              </button>
            </div>
            <div className="case-details">
              <p><strong>User:</strong> {selectedCase.userId?.name || "Unknown"} ({selectedCase.userId?.email || "N/A"})</p>
              <p><strong>Order ID:</strong> {selectedCase.orderId}</p>
              <p><strong>Product Index:</strong> {selectedCase.productIndex}</p>
              <p><strong>Description:</strong> {selectedCase.description}</p>
              <p><strong>Priority:</strong> {selectedCase.priority}</p>
              <p><strong>Status:</strong> {selectedCase.status}</p>
              <p><strong>Created:</strong> {new Date(selectedCase.createdAt).toLocaleString()}</p>
              <p><strong>Updated:</strong> {new Date(selectedCase.updatedAt).toLocaleString()}</p>
            </div>
            <div className="chat-history">
              {selectedCase.responses.length === 0 ? (
                <p>No chat history available.</p>
              ) : (
                selectedCase.responses.map((r, i) => (
                  <div
                    key={i}
                    className={r.adminId ? "admin-message" : "user-message"}
                  >
                    <p>
                      <strong>{r.adminId?.name || "System"}</strong> ({new Date(r.timestamp).toLocaleString()}):
                      <br />
                      {r.message}
                    </p>
                  </div>
                ))
              )}
            </div>
            <div className="response-section">
              <textarea
                value={responseMessage}
                onChange={(e) => setResponseMessage(e.target.value)}
                onKeyPress={(e) => handleKeyPress(e, selectedCase._id)}
                placeholder="Type your response..."
                className="response-textarea"
              />
              <button
                onClick={() => addResponse(selectedCase._id)}
                className="response-button"
              >
                Send
              </button>
            </div>
            <div className="status-toggle">
              <label>
                Case Status:
                <input
                  type="checkbox"
                  checked={selectedCase.status === "resolved"}
                  onChange={() =>
                    updateCaseStatus(
                      selectedCase._id,
                      selectedCase.status === "resolved" ? "open" : "resolved"
                    )
                  }
                />
                <span className="toggle-switch"></span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}