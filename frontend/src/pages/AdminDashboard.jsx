import React, { useEffect, useState } from "react";
import axios from "axios";
import "../styles/dashboard.css";

export default function AdminDashboard() {
  const [token] = useState(localStorage.getItem("token") || "");
  const [setOrders] = useState([]);
  const [allCases, setAllCases] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);
  const [responseMessage, setResponseMessage] = useState("");
  const [setError] = useState("");
  const [setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("new"); // New, Pending, or Closed

  // Fetch all orders
  const fetchOrders = async () => {
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:5000/api/admin/orders", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setOrders(response.data.orders);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  };

  // Fetch all cases
  const fetchCases = async () => {
    setLoading(true);
    try {
      const response = await axios.get("http://localhost:5000/api/admin/cases", {
        headers: { Authorization: `Bearer ${token}` },
      });
      setAllCases(response.data.cases);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to fetch cases");
    } finally {
      setLoading(false);
    }
  };

  // Update case status
  const updateCaseStatus = async (caseId, newStatus) => {
    setLoading(true);
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
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add response");
    } finally {
      setLoading(false);
    }
  };


  // Logout
  const handleLogout = async () => {
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
    }
  };

  // Fetch data on mount if token exists
  useEffect(() => {
    if (token) {
      fetchOrders();
      fetchCases();
    } else {
      window.location.href = "/"; // Redirect to login if no token
    }
  }, [token]);

  // Categorize cases
  const newCases = allCases.filter((c) => c.responses.length === 0);
  const pendingCases = allCases.filter(
    (c) => c.responses.length > 0 && (c.status === "open" || c.status === "in-progress")
  );
  const closedCases = allCases.filter((c) => c.status === "resolved");
  const displayedCases =
    activeTab === "new" ? newCases : activeTab === "pending" ? pendingCases : closedCases;

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <h1>Admin Dashboard</h1>
        <button onClick={handleLogout} className="logout-btn">
          Logout
        </button>
      </div>


      {/* Navigation Bar */}
      <div className="cases-nav">
        <button
          className={`nav-tab ${activeTab === "new" ? "active" : ""}`}
          onClick={() => setActiveTab("new")}
        >
          New Cases ({newCases.length})
        </button>
        <button
          className={`nav-tab ${activeTab === "pending" ? "active" : ""}`}
          onClick={() => setActiveTab("pending")}
        >
          Pending Cases ({pendingCases.length})
        </button>
        <button
          className={`nav-tab ${activeTab === "closed" ? "active" : ""}`}
          onClick={() => setActiveTab("closed")}
        >
          Closed Cases ({closedCases.length})
        </button>
      </div>

    

      {/* Cases Section */}
      <div className="cases-section">
        <h2>
          {activeTab === "new" ? "New Cases" : activeTab === "pending" ? "Pending Cases" : "Closed Cases"}
        </h2>
        <div className="cases-card">
          {displayedCases.length === 0 ? (
            <p className="no-cases">
              No {activeTab === "new" ? "new" : activeTab === "pending" ? "pending" : "closed"} cases found.
            </p>
          ) : (
            <div className="cases-list">
              {displayedCases.map((c) => (
                <div
                  key={c._id}
                  className="case-card"
                  onClick={() => setSelectedCase(c)}
                >
                  <p>
                    <strong>Case ID:</strong> {c._id}
                  </p>
                  <p>
                    <strong>User:</strong> {c.userId.name} ({c.userId.email})
                  </p>
                  <p>
                    <strong>Order ID:</strong> {c.orderId}
                  </p>
                  <p>
                    <strong>Product Index:</strong> {c.productIndex}
                  </p>
                  <p>
                    <strong>Description:</strong> {c.description}
                  </p>
                  <p>
                    <strong>Status:</strong> {c.status}
                  </p>
                  <p>
                    <strong>Created:</strong> {new Date(c.createdAt).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Case Details and Actions */}
      {selectedCase && (
        <div className="case-details">
          <h2>Case Details</h2>
          <p>
            <strong>Case ID:</strong> {selectedCase._id}
          </p>
          <p>
            <strong>User:</strong> {selectedCase.userId.name} ({selectedCase.userId.email})
          </p>
          <p>
            <strong>Order ID:</strong> {selectedCase.orderId}
          </p>
          <p>
            <strong>Product Index:</strong> {selectedCase.productIndex}
          </p>
          <p>
            <strong>Description:</strong> {selectedCase.description}
          </p>
          <p>
            <strong>Status:</strong> {selectedCase.status}
          </p>
          <p>
            <strong>Created:</strong> {new Date(selectedCase.createdAt).toLocaleString()}
          </p>

          {/* Case Responses */}
          <div className="responses-section">
            <h3>Responses</h3>
            {selectedCase.responses.length === 0 ? (
              <p className="no-responses">No responses yet.</p>
            ) : (
              <div className="responses-list">
                {selectedCase.responses.map((r, i) => (
                  <p key={i}>
                    <strong>
                      {r.adminId?.name || "Admin"} (
                      {new Date(r.timestamp).toLocaleString()}):
                    </strong>{" "}
                    {r.message}
                  </p>
                ))}
              </div>
            )}
          </div>

          {/* Add Response */}
          <div className="mt-4">
            <textarea
              value={responseMessage}
              onChange={(e) => setResponseMessage(e.target.value)}
              placeholder="Add a response..."
              className="response-textarea"
            />
            <button
              onClick={() => addResponse(selectedCase._id)}
              className="response-button"
            >
              Add Response
            </button>
          </div>

          {/* Update Status */}
          <div className="status-section">
            <h3>Update Status</h3>
            <select
              onChange={(e) => updateCaseStatus(selectedCase._id, e.target.value)}
              value={selectedCase.status}
              className="status-select"
            >
              <option value="open">Open</option>
              <option value="in-progress">In Progress</option>
              <option value="resolved">Resolved</option>
            </select>
          </div>
        </div>
      )}


      
        
    </div>
  );
}