import { useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";

import styles from "./Login.module.css";

import API from "../services/api";



// =====================================================================
// AnimatedWelcomePanel — plays the user-provided AI-generated video
// (/robot-login.mp4) once, then cross-fades to the static red panel
// with the welcome text.
//
// The video shows the full robot-pushing-panel sequence. When it ends
// we fade in the real panel content on top, so the transition to the
// static state feels seamless.
// =====================================================================
function AnimatedWelcomePanel() {
  const [videoDone, setVideoDone] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const videoRef = useRef(null);

  useEffect(() => {
    // Fallback: if the video can't play for any reason (missing file,
    // codec issue on this browser, autoplay blocked), skip to the final
    // state after 8s so the user isn't stuck staring at a black rectangle.
    const t = setTimeout(() => {
      if (!videoDone) setVideoDone(true);
    }, 8000);
    return () => clearTimeout(t);
  }, [videoDone]);

  return (
    <div className={styles.welcomeWrap}>

      {/* Intro video — plays once, muted (browser autoplay requirement) */}
      {!videoError && (
        <motion.video
          ref={videoRef}
          className={styles.introVideo}
          src="/robot-login.mp4"
          autoPlay
          muted
          playsInline
          preload="auto"
          onEnded={() => setVideoDone(true)}
          onError={() => { setVideoError(true); setVideoDone(true); }}
          animate={{ opacity: videoDone ? 0 : 1 }}
          initial={{ opacity: 1 }}
          transition={{ duration: 0.6 }}
        />
      )}

      {/* Final red panel — fades in when the video ends */}
      <motion.div
        className={styles.panel}
        initial={{ opacity: 0 }}
        animate={{ opacity: videoDone ? 1 : 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      >
        <div className={styles.ringA} />
        <div className={styles.ringB} />

        <motion.img
          src="/logo.webp"
          alt="Bharath Vending Corporation"
          className={styles.brandLogo}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: videoDone ? 1 : 0, y: videoDone ? 0 : 10 }}
          transition={{ delay: videoDone ? 0.2 : 0, duration: 0.55 }}
        />

        <motion.h1
          className={styles.welcomeTitle}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: videoDone ? 1 : 0, y: videoDone ? 0 : 12 }}
          transition={{ delay: videoDone ? 0.35 : 0, duration: 0.55 }}
        >
          Welcome Back
        </motion.h1>

        <motion.p
          className={styles.welcomeSub}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: videoDone ? 1 : 0, y: videoDone ? 0 : 10 }}
          transition={{ delay: videoDone ? 0.55 : 0, duration: 0.55 }}
        >
          Access your ERP dashboard.
        </motion.p>

        <motion.p
          className={styles.tagline}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: videoDone ? 1 : 0, y: videoDone ? 0 : 10 }}
          transition={{ delay: videoDone ? 0.75 : 0, duration: 0.55 }}
        >
          Automate. Optimize. <span className={styles.taglineAccent}>Accelerate with AI.</span>
        </motion.p>

        <div className={styles.brandSpacer} />

        <motion.p
          className={styles.brandName}
          initial={{ opacity: 0 }}
          animate={{ opacity: videoDone ? 1 : 0 }}
          transition={{ delay: videoDone ? 0.95 : 0, duration: 0.5 }}
        >
          Bharath Vending Corporation
        </motion.p>
      </motion.div>
    </div>
  );
}



function Login() {

  const navigate = useNavigate();

  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);

  const [onboardingToken, setOnboardingToken] = useState(null);

  useEffect(() => {

    const tok = sessionStorage.getItem("pending_onboarding_token");

    if (tok) {

      setOnboardingToken(tok);
    }
  }, []);

  const cancelOnboarding = () => {

    sessionStorage.removeItem("pending_onboarding_token");

    setOnboardingToken(null);

    setError("");
  };

  const handleOnboardingLogin = async () => {

    try {

      const res = await API.post(
        `/employee-onboarding/${onboardingToken}/login`,
        {
          EMPLOYEE_CODE: username.trim().toUpperCase(),
          PASSWORD: password
        }
      );

      console.log("Onboarding login successful:", res.data);

      localStorage.setItem(
        "employee_onboarding_session_" + onboardingToken,
        JSON.stringify(res.data)
      );

      sessionStorage.removeItem("pending_onboarding_token");

      navigate("/employee-onboarding/" + onboardingToken);

    } catch (err) {

      const detail =
        err?.response?.data?.detail ||
        "Invalid Employee ID or Password";

      setError(detail);
    }
  };

  const handleUnifiedLogin = async () => {

    try {

      const res = await API.post("/login", {
        EMPLOYEE_CODE: username.trim().toUpperCase(),
        PASSWORD: password
      });

      const d = res.data;

      const isAdmin = !!d.is_admin;

      // Common state — shared by both admin and employee portals.
      localStorage.setItem("auth", "true");
      localStorage.setItem("role", isAdmin ? "admin" : "employee");
      localStorage.setItem("token", d.access_token || "");
      localStorage.setItem("backend_role", d.role || "");
      localStorage.setItem(
        "permissions",
        JSON.stringify(d.permissions || [])
      );
      localStorage.setItem(
        "username",
        d.EMPLOYEE_NAME || d.name || username
      );

      if (isAdmin) {

        // Admin uses the UUID as employee_id (legacy contract) and
        // stores employee_code separately for display.
        localStorage.setItem("employee_id", d.employee_id);
        localStorage.setItem("employee_code", d.code || "");
        localStorage.setItem(
          "loginTime",
          new Date().toISOString()
        );

        // Clean up any employee-only leftovers from a prior session.
        localStorage.removeItem("employee_uuid");
        localStorage.removeItem("employee_name");
        localStorage.removeItem("department");
        localStorage.removeItem("employee_role");
        localStorage.removeItem("attendance_status");
        localStorage.removeItem("pending_yesterday");

      } else {

        // Employee side keeps CODE in employee_id (BVC008) and the
        // internal UUID in employee_uuid — photo/document endpoints
        // take the UUID, not the code.
        localStorage.setItem(
          "employee_id",
          d.EMPLOYEE_ID || d.code || ""
        );
        localStorage.setItem("employee_uuid", d.employee_id || "");
        localStorage.setItem(
          "employee_name",
          d.EMPLOYEE_NAME || d.name || ""
        );
        localStorage.setItem("department", d.DEPARTMENT || "");
        localStorage.setItem("employee_role", d.role || "");
        localStorage.setItem(
          "loginTime",
          d.LOGIN_TIME || new Date().toISOString()
        );
        localStorage.setItem(
          "attendance_status",
          d.ATTENDANCE_STATUS || "PRESENT"
        );

        if (d.HAS_PENDING_FROM_YESTERDAY) {

          localStorage.setItem(
            "pending_yesterday",
            JSON.stringify(d.PENDING_FROM_YESTERDAY || [])
          );

        } else {

          localStorage.removeItem("pending_yesterday");
        }
      }

      // RoleBasedLanding routes to the correct portal based on
      // localStorage.role — admin → admin dashboard, employee →
      // EmployeeDashboard (mainTab="home").
      navigate("/", { replace: true });

    } catch (err) {

      const detail =
        err?.response?.data?.detail ||
        "Invalid credentials";

      setError(detail);
    }
  };

  const handleLogin = async (e) => {

    if (e) e.preventDefault();

    setError("");

    if (!username.trim() || !password.trim()) {

      setError("Please enter both fields");

      return;
    }

    setLoading(true);

    try {

      if (onboardingToken) {

        // Onboarding-token login — POSTs to the per-token endpoint
        // and forwards to /employee-onboarding/<token> on success.
        await handleOnboardingLogin();

      } else {

        await handleUnifiedLogin();
      }

    } finally {

      setLoading(false);
    }
  };

  return (

    <div className={styles.page}>

      <form
        className={styles.card}
        onSubmit={handleLogin}
      >

        {/* Left — animated welcome panel (robot pushes it in) */}
        <div className={styles.left}>
          <AnimatedWelcomePanel />
        </div>

        {/* Right — credentials form */}
        <div className={styles.right}>

          <h2 className={styles.formHeading}>
            Enter your credentials to continue.
          </h2>

          <p className={styles.formSubheading}>
            Sign in to your Bharath Vending Corporation account.
          </p>

          {
            error && (
              <div className={styles.error}>
                {error}
              </div>
            )
          }

          <label className={styles.label}>
            User ID
          </label>

          <div className={styles.inputWrap}>

            <span className={styles.icon}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            </span>

            <input
              type="text"
              className={styles.input}
              placeholder="Enter your User ID"
              value={username}
              onChange={(e) =>
                setUsername(e.target.value)
              }
              autoComplete="username"
            />

          </div>

          <label className={styles.label}>Password</label>

          <div className={styles.inputWrap}>

            <span className={styles.icon}>
              {/* Padlock icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                stroke="currentColor" strokeWidth="1.8"
                strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="10" width="16" height="11" rx="2" />
                <path d="M8 10V7a4 4 0 0 1 8 0v3" />
              </svg>
            </span>

            <input
              type={showPassword ? "text" : "password"}
              className={styles.input}
              placeholder="Enter password"
              value={password}
              onChange={(e) =>
                setPassword(e.target.value)
              }
              autoComplete="current-password"
            />

            <button
              type="button"
              className={styles.eye}
              onClick={() =>
                setShowPassword(!showPassword)
              }
              aria-label={showPassword ? "Hide password" : "Show password"}
              title={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? (
                /* eye-off — currently visible, click to hide */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3l18 18" />
                  <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                  <path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c5 0 9.3 3 11 8a14 14 0 0 1-3.4 4.8" />
                  <path d="M6.3 6.3A14 14 0 0 0 1 12c1.7 5 6 8 11 8 1.7 0 3.3-.3 4.7-.9" />
                </svg>
              ) : (
                /* eye — currently hidden, click to show */
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>

          </div>

          <button
            type="submit"
            className={styles.submit}
            disabled={loading}
          >
            {loading ? "Signing in…" : "Sign In"}
          </button>

          {
            onboardingToken && (
              <div className={styles.cancelWrap}>
                <a
                  href="#"
                  className={styles.cancelLink}
                  onClick={(e) => {
                    e.preventDefault();
                    cancelOnboarding();
                  }}
                >
                  Cancel onboarding
                </a>
              </div>
            )
          }

        </div>

      </form>

    </div>
  );
}


export default Login;
