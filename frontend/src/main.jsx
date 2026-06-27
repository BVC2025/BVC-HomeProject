import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

import App from "./App";
import "./App.css";

ReactDOM.createRoot(
  document.getElementById("root")
).render(

  <BrowserRouter>
    <App />
    <ToastContainer
      position="top-right"
      autoClose={3500}
      hideProgressBar={false}
      closeOnClick
      pauseOnHover
      draggable
      theme="light"
    />
  </BrowserRouter>
);