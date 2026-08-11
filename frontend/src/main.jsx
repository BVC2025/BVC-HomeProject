import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "react-toastify/dist/ReactToastify.css";

import App from "./App";
import ThemedToastContainer from "./components/ThemedToastContainer";
import { AuthProvider } from "./context/AuthContext";
import "./tailwind.css";
import "./App.css";

// Apply the saved theme (light | dark) BEFORE the app renders so
// the correct palette is present on the very first paint — no flash
// of light content when a dark-mode user reloads.
try {
  const saved = localStorage.getItem("theme");
  if (saved === "dark" || saved === "light") {
    document.documentElement.setAttribute("data-theme", saved);
  }
} catch { /* private mode / SSR safety */ }

ReactDOM.createRoot(
  document.getElementById("root")
).render(

  <BrowserRouter>
    <AuthProvider>
      <App />
      <ThemedToastContainer />
    </AuthProvider>
  </BrowserRouter>
);