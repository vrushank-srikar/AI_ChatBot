import React, { useEffect, useState } from "react";
import axios from "axios";
import "../styles/dashboard.css";

export default function AdminDashboard() {
  const [message, setMessage] = useState("");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const token = localStorage.getItem("token");
        const res = await axios.get("http://localhost:5000/api/dashboard", {
          headers: { Authorization: `Bearer ${token}` },
        });
        setMessage(res.data.message);
      } catch (err) {
        console.error(err);
      }
    };
    fetchData();
  }, []);

  const handleLogout = () => {
    localStorage.removeItem("token");
    window.location.href = "/"; // back to login
  };

  return (
    <div className="dashboard">
      <div className="chat-container">
        <h1>{message}</h1>
        {/* 🚪 Logout button */}
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </div>
    </div>
  );
}
