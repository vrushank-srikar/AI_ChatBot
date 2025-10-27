
// import React, { useEffect, useState, useCallback, useRef } from "react";
// import axios from "axios";
// import {
//   Chart as ChartJS,
//   CategoryScale,
//   LinearScale,
//   BarElement,
//   Title,
//   Tooltip,
//   Legend,
//   ArcElement,
//   PointElement,
//   LineElement,
// } from 'chart.js';
// import { Bar, Doughnut, Line } from 'react-chartjs-2';
// import { io } from "socket.io-client";
// import "../styles/AdminDashboard.css";

// // Register Chart.js components
// ChartJS.register(
//   CategoryScale,
//   LinearScale,
//   BarElement,
//   Title,
//   Tooltip,
//   Legend,
//   ArcElement,
//   PointElement,
//   LineElement
// );

// export default function AdminDashboard() {
//   const [token] = useState(localStorage.getItem("token") || "");
//   const [allCases, setAllCases] = useState([]);
//   const [orders, setOrders] = useState([]);
//   const [selectedCase, setSelectedCase] = useState(null);

//   // NEW: a separate messages state that shows unified (user/bot + agent)
//   const [threadMessages, setThreadMessages] = useState([]);
//   const chatBottomRef = useRef(null);
//   const socketRef = useRef(null);

//   const [responseMessage, setResponseMessage] = useState("");
//   const [error, setError] = useState("");
//   const [loading, setLoading] = useState(false);
//   const [successMessage, setSuccessMessage] = useState("");
//   const [activeTab, setActiveTab] = useState("new");
//   const [trendChartData, setTrendChartData] = useState({
//     labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
//     datasets: [
//       { label: 'New Cases', data: [0,0,0,0,0,0,0], borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4 },
//       { label: 'Resolved Cases', data: [0,0,0,0,0,0,0], borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4 },
//     ],
//   });

//   // ---------------- Socket.IO: connect as admin ----------------
//   useEffect(() => {
//     if (!token) return;

//     const s = io("http://localhost:5000", {
//       transports: ["websocket"],
//       auth: { token },
//     });

//     s.on("connect_error", (e) => console.warn("socket connect_error:", e?.message || e));
//     s.on("disconnect", (r) => console.log("socket disconnected:", r));

//     // Any chat replies (user/bot/agent mirrored to agents room)
//     s.on("chat:reply", (payload) => {
//       // only append if it belongs to the selected case
//       if (!selectedCase) return;
//       const { caseId, message, source, timestamp, orderId, productIndex } = payload || {};
//       if (
//         caseId === selectedCase._id ||
//         (orderId === selectedCase.orderId && Number(productIndex) === Number(selectedCase.productIndex))
//       ) {
//         setThreadMessages((prev) => [
//           ...prev,
//           {
//             source: source || "bot",
//             sender: source === "agent" ? "agent" : "bot",
//             message,
//             timestamp: timestamp || Date.now(),
//             caseId: caseId || selectedCase._id
//           }
//         ]);
//       }
//     });

//     // Optional: when a case message/status arrives specifically for this case
//     s.on("case:message", (payload) => {
//       if (!selectedCase) return;
//       if (payload?.caseId === selectedCase._id) {
//         setThreadMessages((prev) => [
//           ...prev,
//           { source: "agent", sender: payload.sender || "agent", message: payload.message, timestamp: payload.timestamp || Date.now(), caseId: payload.caseId }
//         ]);
//       }
//     });

//     socketRef.current = s;
//     return () => {
//       try { s.disconnect(); } catch {}
//       socketRef.current = null;
//     };
//   }, [token, selectedCase]);

//   // scroll to bottom on new messages
//   useEffect(() => {
//     chatBottomRef.current?.scrollIntoView({ behavior: "smooth" });
//   }, [threadMessages]);

//   // ---------------- Data fetchers ----------------
//   const fetchCases = useCallback(async (retryCount = 0) => {
//     setLoading(true);
//     setError("");
//     try {
//       const response = await axios.get(`http://localhost:5000/api/admin/cases?_t=${Date.now()}`, {
//         headers: { Authorization: `Bearer ${token}` },
//       });
//       const cases = response.data.cases || [];
//       const sorted = cases.sort((a, b) => {
//         if (a.priority === "high" && b.priority !== "high") return -1;
//         if (a.priority !== "high" && b.priority === "high") return 1;
//         return new Date(b.createdAt) - new Date(a.createdAt);
//       });
//       setAllCases(sorted);
//     } catch (err) {
//       if (retryCount < 2) setTimeout(() => fetchCases(retryCount + 1), 1000);
//       else setError(err.response?.data?.error || "Failed to fetch cases");
//     } finally {
//       setLoading(false);
//     }
//   }, [token]);

//   const fetchOrders = useCallback(async (retryCount = 0) => {
//     try {
//       const resp = await axios.get(`http://localhost:5000/api/admin/orders?_t=${Date.now()}`, {
//         headers: { Authorization: `Bearer ${token}` },
//       });
//       setOrders(resp.data.orders || []);
//     } catch (err) {
//       if (retryCount < 2) setTimeout(() => fetchOrders(retryCount + 1), 1000);
//       else console.warn("Failed to fetch orders:", err.response?.data || err.message);
//     }
//   }, [token]);

//   // NEW: fetch unified thread for selected case
//   const fetchUnifiedThread = useCallback(async (caseId) => {
//     if (!caseId) return;
//     try {
//       const { data } = await axios.get(`http://localhost:5000/api/admin/case/${caseId}/unified-thread?_t=${Date.now()}`, {
//         headers: { Authorization: `Bearer ${token}` },
//       });
//       setThreadMessages(data.thread || []);
//       // join the case room for tighter realtime
//       socketRef.current?.emit("join_case", { caseId });
//     } catch (e) {
//       console.warn("Failed to load thread:", e?.response?.data || e?.message);
//       setThreadMessages([]);
//     }
//   }, [token]);

//   // mount
//   useEffect(() => {
//     if (token) {
//       fetchCases();
//       fetchOrders();
//     } else {
//       setError("No authentication token found. Please log in.");
//       window.location.href = "/";
//     }
//   }, [token, fetchCases, fetchOrders]);

//   // when user clicks a case, load its conversation
//   const handleSelectCase = (c) => {
//     setSelectedCase(c);
//     setThreadMessages([]);
//     fetchUnifiedThread(c._id);
//   };

//   // --------------- Case status & responses (same as yours, with tiny tweaks) ---------------
//   const updateCaseStatus = async (caseId, newStatus) => {
//     setLoading(true);
//     setError("");
//     setSuccessMessage("");
//     try {
//       const response = await axios.put(
//         `http://localhost:5000/api/case/${caseId}`,
//         { status: newStatus },
//         { headers: { Authorization: `Bearer ${token}` } }
//       );
//       await fetchCases();
//       if (selectedCase?._id === caseId) {
//         setSelectedCase(response.data.case);
//       }
//       setSuccessMessage(`Case ${newStatus === "resolved" ? "closed" : "reopened"} successfully`);
//       setTimeout(() => setSuccessMessage(""), 3000);
//     } catch (err) {
//       setError(err.response?.data?.error || "Failed to update case status");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const addResponse = async (caseId) => {
//     if (!responseMessage.trim()) {
//       setError("Response message cannot be empty");
//       return;
//     }
//     setLoading(true);
//     setError("");
//     setSuccessMessage("");
//     try {
//       const response = await axios.post(
//         `http://localhost:5000/api/case/${caseId}/response`,
//         { message: responseMessage },
//         { headers: { Authorization: `Bearer ${token}` } }
//       );
//       await fetchCases();
//       if (selectedCase?._id === caseId) {
//         setSelectedCase(response.data.case);
//       }
//       // Optimistically add to chat list
//       setThreadMessages((prev) => [
//         ...prev,
//         { source: "agent", sender: "agent", message: responseMessage, timestamp: Date.now(), caseId }
//       ]);
//       setResponseMessage("");
//       setSuccessMessage("Response sent successfully");
//       setTimeout(() => setSuccessMessage(""), 3000);
//     } catch (err) {
//       setError(err.response?.data?.error || "Failed to add response");
//     } finally {
//       setLoading(false);
//     }
//   };

//   const handleLogout = async () => {
//     setLoading(true);
//     setError("");
//     try {
//       await axios.post(
//         "http://localhost:5000/api/logout",
//         {},
//         { headers: { Authorization: `Bearer ${token}` } }
//       );
//       localStorage.removeItem("token");
//       window.location.href = "/";
//     } catch (err) {
//       setError(err.response?.data?.error || "Logout failed");
//     } finally {
//       setLoading(false);
//     }
//   };

//   useEffect(() => {
//     if (allCases.length > 0) {
//       const newByDay = new Array(7).fill(0);
//       const resolvedByDay = new Array(7).fill(0);
//       allCases.forEach((c) => {
//         const createdDay = new Date(c.createdAt).getDay();
//         newByDay[createdDay]++;
//         if (c.status === "resolved") {
//           const updatedDay = new Date(c.updatedAt).getDay();
//           resolvedByDay[updatedDay]++;
//         }
//       });
//       const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
//       const newData = [newByDay[1],newByDay[2],newByDay[3],newByDay[4],newByDay[5],newByDay[6],newByDay[0]];
//       const resolvedData = [resolvedByDay[1],resolvedByDay[2],resolvedByDay[3],resolvedByDay[4],resolvedByDay[5],resolvedByDay[6],resolvedByDay[0]];
//       setTrendChartData({
//         labels: days,
//         datasets: [
//           { label: 'New Cases', data: newData, borderColor: 'rgba(59,130,246,1)', backgroundColor: 'rgba(59,130,246,0.1)', tension: 0.4 },
//           { label: 'Resolved Cases', data: resolvedData, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(16,185,129,0.1)', tension: 0.4 },
//         ],
//       });
//     }
//   }, [allCases]);

//   const newCases = allCases.filter((c) => !c.responses.some((r) => r.adminId !== null));
//   const pendingCases = allCases.filter((c) => c.responses.some((r) => r.adminId !== null) && c.status !== "resolved");
//   const closedCases = allCases.filter((c) => c.status === "resolved");

//   const displayedCases =
//     activeTab === "new" ? newCases : activeTab === "pending" ? pendingCases : closedCases;

//   const handleKeyPress = (e, caseId) => {
//     if (e.key === "Enter" && !e.shiftKey) {
//       e.preventDefault();
//       addResponse(caseId);
//     }
//   };

//   const totalCases = allCases.length;
//   const highPriorityCases = allCases.filter(c => c.priority === "high").length;
//   const resolutionRate = totalCases > 0 ? Math.round((closedCases.length / totalCases) * 100) : 0;

//   const statusChartData = {
//     labels: ['New Cases','Pending Cases','Closed Cases'],
//     datasets: [{ data: [newCases.length,pendingCases.length,closedCases.length],
//       backgroundColor: ['rgba(59,130,246,0.8)','rgba(245,158,11,0.8)','rgba(16,185,129,0.8)'],
//       borderColor: ['rgba(59,130,246,1)','rgba(245,158,11,1)','rgba(16,185,129,1)'], borderWidth: 2 }]
//   };

//   const possibleDomains = ["E-commerce","Travel","Telecommunications","Banking Services"];
//   const domainCounts = possibleDomains.map(d => allCases.filter(c => c.domain === d).length);
//   const domainChartData = {
//     labels: possibleDomains,
//     datasets: [{ label: 'Cases by Domain', data: domainCounts,
//       backgroundColor: ['rgba(139,92,246,0.8)','rgba(59,130,246,0.8)','rgba(16,185,129,0.8)','rgba(245,158,11,0.8)'],
//       borderColor: ['rgba(139,92,246,1)','rgba(59,130,246,1)','rgba(16,185,129,1)','rgba(245,158,11,1)'], borderWidth: 2 }]
//   };

//   const priorityChartData = {
//     labels: ['High Priority','Low Priority'],
//     datasets: [{ data: [highPriorityCases, totalCases - highPriorityCases],
//       backgroundColor: ['rgba(239,68,68,0.8)','rgba(34,197,94,0.8)'],
//       borderColor: ['rgba(239,68,68,1)','rgba(34,197,94,1)'], borderWidth: 2 }]
//   };

//   const chartOptions = {
//     responsive: true, maintainAspectRatio: false,
//     plugins: { legend: { position: 'bottom', labels: { padding: 20, usePointStyle: true } } },
//   };

//   return (
//     <div className="admin-dashboard">
//       <div className="dashboard-header">
//         <h1>Admin Dashboard</h1>
//         <button onClick={handleLogout} className="logout-btn">Logout</button>
//       </div>

//       {loading && <div className="loading">Loading...</div>}
//       {error && <div className="error-message">{error}</div>}
//       {successMessage && <div className="success-message">{successMessage}</div>}

//       {/* Stats */}
//       <div className="stats-grid">
//         <div className="stat-card"><h3>Total Cases</h3><div className="stat-number">{totalCases}</div><div className="stat-change neutral">All time</div></div>
//         <div className="stat-card"><h3>High Priority</h3><div className="stat-number">{highPriorityCases}</div><div className="stat-change negative">Needs attention</div></div>
//         <div className="stat-card"><h3>Resolution Rate</h3><div className="stat-number">{resolutionRate}%</div><div className="stat-change positive">+5% from last week</div></div>
//         <div className="stat-card"><h3>Total Orders</h3><div className="stat-number">{orders.length}</div><div className="stat-change neutral">From users</div></div>
//       </div>

//       {/* Charts */}
//       <div className="charts-section">
//         <div className="chart-card"><h3>Case Status Distribution</h3><div className="chart-container"><Doughnut data={statusChartData} options={chartOptions} /></div></div>
//         <div className="chart-card"><h3>Priority Distribution</h3><div className="chart-container"><Doughnut data={priorityChartData} options={chartOptions} /></div></div>
//         <div className="chart-card"><h3>Cases by Domain</h3><div className="chart-container"><Bar data={domainChartData} options={chartOptions} /></div></div>
//         <div className="chart-card"><h3>Weekly Trend</h3><div className="chart-container"><Line data={trendChartData} options={chartOptions} /></div></div>
//       </div>

//       {/* Case list */}
//       <div className="cases-nav">
//         <button className={`nav-tab ${activeTab === "new" ? "active" : ""}`} onClick={() => setActiveTab("new")}>New ({newCases.length})</button>
//         <button className={`nav-tab ${activeTab === "pending" ? "active" : ""}`} onClick={() => setActiveTab("pending")}>Pending ({pendingCases.length})</button>
//         <button className={`nav-tab ${activeTab === "closed" ? "active" : ""}`} onClick={() => setActiveTab("closed")}>Closed ({closedCases.length})</button>
//       </div>

//       <div className="cases-section">
//         <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Cases</h2>
//         <div className="cases-list">
//           {displayedCases.length === 0 ? (
//             <p className="no-cases">No {activeTab} cases found.</p>
//           ) : (
//             displayedCases.map((c) => (
//               <div
//                 key={c._id}
//                 className={`case-card ${c.priority === "high" ? "high-priority" : ""}`}
//                 onClick={() => handleSelectCase(c)}
//               >
//                 <p><strong>Case ID:</strong> {c._id.slice(-6)}</p>
//                 <p><strong>User:</strong> {c.userId?.name || "Unknown"}</p>
//                 <p><strong>Description:</strong> {c.description}</p>
//                 <p><strong>Priority:</strong> {c.priority}</p>
//                 <p><strong>Domain:</strong> {c.domain || "N/A"}</p>
//               </div>
//             ))
//           )}
//         </div>
//       </div>

//       {/* Case popup with REAL chat */}
//       {selectedCase && (
//         <div className="case-popup">
//           <div className="case-popup-content">
//             <div className="case-popup-header">
//               <h3>Case #{selectedCase._id.slice(-6)}</h3>
//               <button className="close-popup" onClick={() => {
//                 socketRef.current?.emit("leave_case", { caseId: selectedCase._id });
//                 setSelectedCase(null);
//                 setThreadMessages([]);
//               }}>
//                 &times;
//               </button>
//             </div>

//             <div className="case-details">
//               <p><strong>User:</strong> {selectedCase.userId?.name || "Unknown"} ({selectedCase.userId?.email || "N/A"})</p>
//               <p><strong>Order ID:</strong> {selectedCase.orderId}</p>
//               <p><strong>Product Index:</strong> {selectedCase.productIndex}</p>
//               <p><strong>Description:</strong> {selectedCase.description}</p>
//               <p><strong>Priority:</strong> {selectedCase.priority}</p>
//               <p><strong>Status:</strong> {selectedCase.status}</p>
//               <p><strong>Domain:</strong> {selectedCase.domain || "N/A"}</p>
//               <p><strong>Created:</strong> {new Date(selectedCase.createdAt).toLocaleString()}</p>
//               <p><strong>Updated:</strong> {new Date(selectedCase.updatedAt).toLocaleString()}</p>
//             </div>

//             {/* NEW chat history viewer */}
//             <div className="chat-history">
//               {threadMessages.length === 0 ? (
//                 <p>No chat history available.</p>
//               ) : (
//                 threadMessages.map((m, i) => (
//                   <div key={i} className={m.sender === "agent" ? "admin-message" : "user-message"}>
//                     <p>
//                       <strong>{m.sender === "agent" ? "Agent" : (m.source === "faq" ? "FAQ" : m.source === "case-memory" ? "Smart Suggestion" : m.source === "refund" ? "System" : "User/Bot")}</strong>
//                       {" "}
//                       ({new Date(m.timestamp).toLocaleString()}):
//                       <br />
//                       {m.message}
//                       {m.prompt ? (
//                         <>
//                           <br /><em style={{ opacity: 0.7 }}>User: {m.prompt}</em>
//                         </>
//                       ) : null}
//                     </p>
//                   </div>
//                 ))
//               )}
//               <div ref={chatBottomRef} />
//             </div>

//             <div className="response-section">
//               <textarea
//                 value={responseMessage}
//                 onChange={(e) => setResponseMessage(e.target.value)}
//                 onKeyDown={(e) => handleKeyPress(e, selectedCase._id)}
//                 placeholder="Type your response..."
//                 className="response-textarea"
//               />
//               <button
//                 onClick={() => addResponse(selectedCase._id)}
//                 className="response-button"
//                 disabled={loading}
//               >
//                 Send Response
//               </button>
//             </div>

//             <div className="status-toggle">
//               <label>
//                 Case Status:
//                 <input
//                   type="checkbox"
//                   checked={selectedCase.status === "resolved"}
//                   onChange={() =>
//                     updateCaseStatus(
//                       selectedCase._id,
//                       selectedCase.status === "resolved" ? "open" : "resolved"
//                     )
//                   }
//                   disabled={loading}
//                 />
//                 <span className="toggle-switch"></span>
//               </label>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// }













import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { io } from "socket.io-client";
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
} from "chart.js";
import { Bar, Doughnut, Line } from "react-chartjs-2";
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
  const [orders, setOrders] = useState([]);
  const [selectedCase, setSelectedCase] = useState(null);

  // NEW: unified, live-updating thread for the selected case
  const [threadMessages, setThreadMessages] = useState([]);

  const [responseMessage, setResponseMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [activeTab, setActiveTab] = useState("new");

  const [trendChartData, setTrendChartData] = useState({
    labels: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
    datasets: [
      {
        label: "New Cases",
        data: [0, 0, 0, 0, 0, 0, 0],
        borderColor: "rgba(59, 130, 246, 1)",
        backgroundColor: "rgba(59, 130, 246, 0.1)",
        tension: 0.4,
      },
      {
        label: "Resolved Cases",
        data: [0, 0, 0, 0, 0, 0, 0],
        borderColor: "rgba(16, 185, 129, 1)",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        tension: 0.4,
      },
    ],
  });

  // Socket reference
  const socketRef = useRef(null);
  const currentCaseIdRef = useRef(null);

  /* ========================= Helpers ========================= */
  const appendToThread = useCallback((msg) => {
    setThreadMessages((prev) => [...prev, msg]);
  }, []);

  const caseMatchesPayload = useCallback(
    (payload) => {
      if (!selectedCase) return false;
      const { caseId, orderId, productIndex } = payload || {};
      if (caseId && selectedCase._id && caseId === selectedCase._id) return true;
      if (
        orderId === selectedCase.orderId &&
        Number(productIndex) === Number(selectedCase.productIndex)
      )
        return true;
      return false;
    },
    [selectedCase]
  );

  /* ========================= Data Fetching ========================= */
  const fetchCases = useCallback(
    async (retryCount = 0) => {
      setLoading(true);
      setError("");
      try {
        const response = await axios.get(
          `http://localhost:5000/api/admin/cases?_t=${Date.now()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
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
    },
    [token]
  );

  const fetchOrders = useCallback(
    async (retryCount = 0) => {
      try {
        const resp = await axios.get(
          `http://localhost:5000/api/admin/orders?_t=${Date.now()}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setOrders(resp.data.orders || []);
      } catch (err) {
        if (retryCount < 2) {
          setTimeout(() => fetchOrders(retryCount + 1), 1000);
        } else {
          console.warn("Failed to fetch orders:", err.response?.data || err.message);
        }
      }
    },
    [token]
  );

  // Open a case: fetch unified thread (server endpoint already added)
  const openCase = useCallback(
    async (c) => {
      try {
        setSelectedCase(null);
        setThreadMessages([]);
        // Leave previous room (if any)
        if (socketRef.current && currentCaseIdRef.current) {
          socketRef.current.emit("leave_case", { caseId: currentCaseIdRef.current });
          currentCaseIdRef.current = null;
        }

        const resp = await axios.get(
          `http://localhost:5000/api/admin/case/${c._id}/unified-thread`,
          { headers: { Authorization: `Bearer ${token}` } }
        );

        const openedCase = resp.data.case; // {_id, userId, orderId, productIndex, ...}
        const thread = resp.data.thread || [];

        setSelectedCase({
          ...c,
          // ensure presence of keys from admin endpoint
          orderId: openedCase.orderId,
          productIndex: openedCase.productIndex,
          status: openedCase.status,
          priority: openedCase.priority,
          domain: openedCase.domain,
        });
        setThreadMessages(
          thread.map((t) => ({
            source: t.source || (t.sender === "agent" ? "agent" : "user"),
            sender: t.sender,
            message: t.message || t.reply || "",
            timestamp: t.timestamp || Date.now(),
            caseId: t.caseId || openedCase._id,
          }))
        );

        // Join case room for live updates
        if (socketRef.current && openedCase._id) {
          socketRef.current.emit("join_case", { caseId: openedCase._id });
          currentCaseIdRef.current = openedCase._id;
        }
      } catch (err) {
        console.error("Failed to open case:", err);
        setError("Failed to open case thread");
      }
    },
    [token]
  );

  /* ========================= Mutations ========================= */
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
      await fetchCases();
      if (selectedCase?._id === caseId) {
        setSelectedCase((prev) => ({ ...prev, ...response.data.case }));
      }
      setSuccessMessage(
        `Case ${newStatus === "resolved" ? "closed" : "reopened"} successfully`
      );
      setTimeout(() => setSuccessMessage(""), 3000);
    } catch (err) {
      setError(err.response?.data?.error || "Failed to update case status");
    } finally {
      setLoading(false);
    }
  };

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
      // Fetch updated list (counts, status, etc.)
      await fetchCases();
      // Optimistic clear; actual message will also arrive via socket "chat:reply"
      setResponseMessage("");
      setSuccessMessage("Response sent successfully");
      setTimeout(() => setSuccessMessage(""), 3000);

      // If we want instant echo (optional; socket will also bring it)
      if (selectedCase?._id === caseId) {
        appendToThread({
          source: "agent",
          sender: "agent",
          message: responseMessage,
          timestamp: Date.now(),
          caseId,
        });
      }
    } catch (err) {
      setError(err.response?.data?.error || "Failed to add response");
    } finally {
      setLoading(false);
    }
  };

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

  /* ========================= Effects ========================= */
  // Initial data + socket connection
  useEffect(() => {
    if (!token) {
      setError("No authentication token found. Please log in.");
      window.location.href = "/";
      return;
    }
    fetchCases();
    fetchOrders();

    // Connect socket once
    const s = io("http://localhost:5000", {
      auth: { token },
      transports: ["websocket"],
    });
    socketRef.current = s;

    // Live: customer typed a message (server emits chat:user during agent-only)
    const onChatUser = (payload) => {
      if (!payload) return;
      if (!caseMatchesPayload(payload)) return;
      appendToThread({
        source: "user",
        sender: "user",
        message: payload.message,
        timestamp: payload.timestamp || Date.now(),
        caseId: payload.caseId,
      });
    };

    // Live: any reply shown to user (agent, faq, llm, refund, case-memory)
    const onChatReply = (payload) => {
      if (!payload) return;
      if (!caseMatchesPayload(payload)) return;
      appendToThread({
        source: payload.source || "bot",
        sender: payload.source === "agent" ? "agent" : "bot",
        message: payload.message,
        timestamp: payload.timestamp || Date.now(),
        caseId: payload.caseId,
      });
    };

    // Live: case messages (status/system/agent message scoped to case room)
    const onCaseMessage = (payload) => {
      if (!payload) return;
      if (!caseMatchesPayload(payload)) return;
      appendToThread({
        source: payload.sender || "system",
        sender: payload.sender || "system",
        message: payload.message,
        timestamp: payload.timestamp || Date.now(),
        caseId: payload.caseId,
      });
    };

    // Live: status updates
    const onCaseStatus = (payload) => {
      if (!payload) return;
      if (!selectedCase) return;
      if (payload.caseId !== selectedCase._id) return;
      setSelectedCase((prev) => (prev ? { ...prev, status: payload.status } : prev));
    };

    s.on("chat:user", onChatUser);
    s.on("chat:reply", onChatReply);
    s.on("case:message", onCaseMessage);
    s.on("case:status", onCaseStatus);

    return () => {
      try {
        s.off("chat:user", onChatUser);
        s.off("chat:reply", onChatReply);
        s.off("case:message", onCaseMessage);
        s.off("case:status", onCaseStatus);
        if (currentCaseIdRef.current) {
          s.emit("leave_case", { caseId: currentCaseIdRef.current });
          currentCaseIdRef.current = null;
        }
        s.disconnect();
      } catch (_) {}
      socketRef.current = null;
    };
  }, [token, fetchCases, fetchOrders, appendToThread, caseMatchesPayload, selectedCase]);

  // Weekly trend recompute from allCases
  useEffect(() => {
    if (allCases.length > 0) {
      const newByDay = new Array(7).fill(0); // 0=Sun, ... 6=Sat
      const resolvedByDay = new Array(7).fill(0);
      allCases.forEach((c) => {
        const createdDay = new Date(c.createdAt).getDay();
        newByDay[createdDay]++;
        if (c.status === "resolved") {
          const updatedDay = new Date(c.updatedAt).getDay();
          resolvedByDay[updatedDay]++;
        }
      });
      const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      const newData = [
        newByDay[1],
        newByDay[2],
        newByDay[3],
        newByDay[4],
        newByDay[5],
        newByDay[6],
        newByDay[0],
      ];
      const resolvedData = [
        resolvedByDay[1],
        resolvedByDay[2],
        resolvedByDay[3],
        resolvedByDay[4],
        resolvedByDay[5],
        resolvedByDay[6],
        resolvedByDay[0],
      ];
      setTrendChartData({
        labels: days,
        datasets: [
          {
            label: "New Cases",
            data: newData,
            borderColor: "rgba(59, 130, 246, 1)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            tension: 0.4,
          },
          {
            label: "Resolved Cases",
            data: resolvedData,
            borderColor: "rgba(16, 185, 129, 1)",
            backgroundColor: "rgba(16, 185, 129, 0.1)",
            tension: 0.4,
          },
        ],
      });
    }
  }, [allCases]);

  /* ========================= Derived ========================= */
  const newCases = allCases.filter((c) => !c.responses.some((r) => r.adminId !== null));
  const pendingCases = allCases.filter(
    (c) => c.responses.some((r) => r.adminId !== null) && c.status !== "resolved"
  );
  const closedCases = allCases.filter((c) => c.status === "resolved");

  const displayedCases =
    activeTab === "new" ? newCases : activeTab === "pending" ? pendingCases : closedCases;

  const totalCases = allCases.length;
  const highPriorityCases = allCases.filter((c) => c.priority === "high").length;
  const resolutionRate =
    totalCases > 0 ? Math.round((closedCases.length / totalCases) * 100) : 0;

  const statusChartData = {
    labels: ["New Cases", "Pending Cases", "Closed Cases"],
    datasets: [
      {
        data: [newCases.length, pendingCases.length, closedCases.length],
        backgroundColor: [
          "rgba(59, 130, 246, 0.8)",
          "rgba(245, 158, 11, 0.8)",
          "rgba(16, 185, 129, 0.8)",
        ],
        borderColor: [
          "rgba(59, 130, 246, 1)",
          "rgba(245, 158, 11, 1)",
          "rgba(16, 185, 129, 1)",
        ],
        borderWidth: 2,
      },
    ],
  };

  const possibleDomains = ["E-commerce", "Travel", "Telecommunications", "Banking Services"];
  const domainCounts = possibleDomains.map(
    (domain) => allCases.filter((c) => c.domain === domain).length
  );

  const domainChartData = {
    labels: possibleDomains,
    datasets: [
      {
        label: "Cases by Domain",
        data: domainCounts,
        backgroundColor: [
          "rgba(139, 92, 246, 0.8)",
          "rgba(59, 130, 246, 0.8)",
          "rgba(16, 185, 129, 0.8)",
          "rgba(245, 158, 11, 0.8)",
        ],
        borderColor: [
          "rgba(139, 92, 246, 1)",
          "rgba(59, 130, 246, 1)",
          "rgba(16, 185, 129, 1)",
          "rgba(245, 158, 11, 1)",
        ],
        borderWidth: 2,
      },
    ],
  };

  const lowPriorityCases = totalCases - highPriorityCases;
  const priorityChartData = {
    labels: ["High Priority", "Low Priority"],
    datasets: [
      {
        data: [highPriorityCases, lowPriorityCases],
        backgroundColor: ["rgba(239, 68, 68, 0.8)", "rgba(34, 197, 94, 0.8)"],
        borderColor: ["rgba(239, 68, 68, 1)", "rgba(34, 197, 94, 1)"],
        borderWidth: 2,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          padding: 20,
          usePointStyle: true,
        },
      },
    },
  };

  /* ========================= UI ========================= */
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
          <h3>Total Orders</h3>
          <div className="stat-number">{orders.length}</div>
          <div className="stat-change neutral">From users</div>
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

      {/* Tabs */}
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

      {/* Case list */}
      <div className="cases-section">
        <h2>{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} Cases</h2>
        <div className="cases-list">
          {displayedCases.length === 0 ? (
            <p className="no-cases">No {activeTab} cases found.</p>
          ) : (
            displayedCases.map((c) => (
              <div
                key={c._id}
                className={`case-card ${c.priority === "high" ? "high-priority" : ""}`}
                onClick={() => openCase(c)}
              >
                <p>
                  <strong>Case ID:</strong> {c._id.slice(-6)}
                </p>
                <p>
                  <strong>User:</strong> {c.userId?.name || "Unknown"}
                </p>
                <p>
                  <strong>Description:</strong> {c.description}
                </p>
                <p>
                  <strong>Priority:</strong> {c.priority}
                </p>
                <p>
                  <strong>Domain:</strong> {c.domain || "N/A"}
                </p>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Case popup with live chat */}
      {selectedCase && (
        <div className="case-popup">
          <div className="case-popup-content">
            <div className="case-popup-header">
              <h3>Case #{selectedCase._id.slice(-6)}</h3>
              <button
                className="close-popup"
                onClick={() => {
                  if (socketRef.current && currentCaseIdRef.current) {
                    socketRef.current.emit("leave_case", {
                      caseId: currentCaseIdRef.current,
                    });
                    currentCaseIdRef.current = null;
                  }
                  setSelectedCase(null);
                  setThreadMessages([]);
                }}
              >
                &times;
              </button>
            </div>

            <div className="case-details">
              <p>
                <strong>User:</strong> {selectedCase.userId?.name || "Unknown"} (
                {selectedCase.userId?.email || "N/A"})
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
                <strong>Priority:</strong> {selectedCase.priority}
              </p>
              <p>
                <strong>Status:</strong> {selectedCase.status}
              </p>
              <p>
                <strong>Domain:</strong> {selectedCase.domain || "N/A"}
              </p>
              <p>
                <strong>Created:</strong>{" "}
                {new Date(selectedCase.createdAt).toLocaleString()}
              </p>
              <p>
                <strong>Updated:</strong>{" "}
                {new Date(selectedCase.updatedAt).toLocaleString()}
              </p>
            </div>

            <div className="chat-history">
              {threadMessages.length === 0 ? (
                <p>No chat history available.</p>
              ) : (
                threadMessages.map((m, i) => {
                  const cls =
                    m.sender === "agent" || m.source === "agent"
                      ? "admin-message"
                      : "user-message";
                  return (
                    <div key={i} className={cls}>
                      <p>
                        <strong>
                          {m.sender === "agent" || m.source === "agent" ? "Agent" : "User"}
                        </strong>{" "}
                        ({new Date(m.timestamp).toLocaleString()}):
                        <br />
                        {m.message}
                      </p>
                    </div>
                  );
                })
              )}
            </div>

            <div className="response-section">
              <textarea
                value={responseMessage}
                onChange={(e) => setResponseMessage(e.target.value)}
                onKeyDown={(e) => handleKeyPress(e, selectedCase._id)}
                placeholder="Type your response..."
                className="response-textarea"
              />
              <button
                onClick={() => addResponse(selectedCase._id)}
                className="response-button"
                disabled={loading}
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
                  disabled={loading}
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
