import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import App from "./App";
import { reportWebVitals } from "./lib/webVitals";
import "./styles.css";

reportWebVitals();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/app" element={<Navigate to="/app/select" replace />} />
        <Route path="/app/select" element={<App />} />
        <Route path="/app/professor/:id" element={<App />} />
        <Route path="/app/plan/:id" element={<App />} />
        <Route path="/saved" element={<App />} />
        <Route path="/" element={<Navigate to="/app/select" replace />} />
        <Route path="*" element={<Navigate to="/app/select" replace />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>
);
