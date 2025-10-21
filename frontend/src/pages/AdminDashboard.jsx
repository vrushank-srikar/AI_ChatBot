import React, { useEffect, useState, useCallback } from "react";
import axios from "axios";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement,
} from 'chart.js';
import { Bar, Doughnut, Line } from 'react-chartjs-2';
import "../styles/AdminDashboard.css";

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
  ArcElement,
  PointElement,
  LineElement
);

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

  // Calculate statistics
  const totalCases = allCases.length;
  const highPriorityCases = allCases.filter(c => c.priority === "high").length;
  const avgResponseTime = "2.4h"; // This would be calculated from actual data
  const resolutionRate = totalCases > 0 ? Math.round((closedCases.length / totalCases) * 100) : 0;

  // Chart data
  const statusChartData = {
    labels: ['New Cases', 'Pending Cases', 'Closed Cases'],
    datasets: [
      {
        data: [newCases.length, pendingCases.length, closedCases.length],
        backgroundColor: [
          'rgba(59, 130, 246, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(16, 185, 129, 0.8)',
        ],
        borderColor: [
          'rgba(59, 130, 246, 1)',
          'rgba(245, 158, 11, 1)',
          'rgba(16, 185, 129, 1)',
        ],
        borderWidth: 2,
      },
    ],
  };

  const priorityChartData = {
    labels: ['High Priority', 'Medium Priority', 'Low Priority'],
    datasets: [
      {
        data: [
          allCases.filter(c => c.priority === "high").length,
          allCases.filter(c => c.priority === "medium").length,
          allCases.filter(c => c.priority === "low").length,
        ],
        backgroundColor: [
          'rgba(239, 68, 68, 0.8)',
          'rgba(245, 158, 11, 0.8)',
          'rgba(34, 197, 94, 0.8)',
        ],
        borderColor: [
          'rgba(239, 68, 68, 1)',
          'rgba(245, 158, 11, 1)',
          'rgba(34, 197, 94, 1)',
        ],
        borderWidth: 2,
      },
    ],
  };

  // Domain distribution
  const domainData = allCases.reduce((acc, case_) => {
    const domain = case_.domain || 'Unknown';
    acc[domain] = (acc[domain] || 0) + 1;
    return acc;
  }, {});

  const domainChartData = {
    labels: Object.keys(domainData),
    datasets: [
      {
        label: 'Cases by Domain',
        data: Object.values(domainData),
        backgroundColor: [
          'rgba(139, 92, 246, 0.8)',
          'rgba(59, 130, 246, 0.8)',
          'rgba(16, 185, 129, 0.8)',
          'rgba(245, 158, 11, 0.8)',
        ],
        borderColor: [
          'rgba(139, 92, 246, 1)',
          'rgba(59, 130, 246, 1)',
          'rgba(16, 185, 129, 1)',
          'rgba(245, 158, 11, 1)',
        ],
        borderWidth: 2,
      },
    ],
  };

  // Trend data (mock data for demonstration)
  const trendChartData = {
    labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    datasets: [
      {
        label: 'New Cases',
        data: [12, 19, 8, 15, 22, 13, 7],
        borderColor: 'rgba(59, 130, 246, 1)',
        backgroundColor: 'rgba(59, 130, 246, 0.1)',
        tension: 0.4,
      },
      {
        label: 'Resolved Cases',
        data: [8, 15, 12, 18, 20, 16, 9],
        borderColor: 'rgba(16, 185, 129, 1)',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        tension: 0.4,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: 'bottom',
        labels: {
          padding: 20,
          usePointStyle: true,
        },
      },
    },
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

      {/* Statistics Cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <h3>Total Cases</h3>
          <div className="stat-number">{totalCases}</div>
          <div className="stat-change neutral">All time</div>
        </div>
        <div className="stat-card">
          <h3>High Priority</h3>
          <div className="stat-number">{highPriorityCases}</div>
          <div className="stat-change negative">Needs attention</div>
        </div>
        <div className="stat-card">
          <h3>Resolution Rate</h3>
          <div className="stat-number">{resolutionRate}%</div>
          <div className="stat-change positive">+5% from last week</div>
        </div>
        <div className="stat-card">
          <h3>Avg Response Time</h3>
          <div className="stat-number">{avgResponseTime}</div>
          <div className="stat-change positive">-30min from last week</div>
        </div>
      </div>

      {/* Charts Section */}
      <div className="charts-section">
        <div className="chart-card">
          <h3>Case Status Distribution</h3>
          <div className="chart-container">
            <Doughnut data={statusChartData} options={chartOptions} />
          </div>
        </div>
        <div className="chart-card">
          <h3>Priority Distribution</h3>
          <div className="chart-container">
            <Doughnut data={priorityChartData} options={chartOptions} />
          </div>
        </div>
        <div className="chart-card">
          <h3>Cases by Domain</h3>
          <div className="chart-container">
            <Bar data={domainChartData} options={chartOptions} />
          </div>
        </div>
        <div className="chart-card">
          <h3>Weekly Trend</h3>
          <div className="chart-container">
            <Line data={trendChartData} options={chartOptions} />
          </div>
        </div>
      </div>

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
                <p><strong>Domain:</strong> {c.domain || "N/A"}</p>
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
              <p><strong>Domain:</strong> {selectedCase.domain || "N/A"}</p>
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
                Send Response
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