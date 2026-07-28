import { useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import styles from "./Login.module.css";

import API from "../services/api";


// =====================================================================
// LoginRobot — chunky brand-red SVG mascot used in the walk-in animation.
// Kept as an inline SVG (no external assets, works offline).
// =====================================================================
function LoginRobot() {
  return (
    <svg
      viewBox="0 0 200 240"
      xmlns="http://www.w3.org/2000/svg"
      className={styles.robotSvg}
      aria-hidden="true"
    >
      {/* subtle shadow under feet */}
      <ellipse cx="100" cy="230" rx="60" ry="6" fill="rgba(0,0,0,0.15)" />

      {/* Body */}
      <motion.g
        animate={{ y: [0, -3, 0] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
      >
        {/* Head */}
        <ellipse cx="100" cy="60" rx="58" ry="52" fill="#dc2626" />
        <ellipse cx="100" cy="55" rx="50" ry="44" fill="#ef4444" />

        {/* Visor / face screen */}
        <rect x="55" y="45" width="90" height="42" rx="20" fill="#0f172a" />
        {/* Eyes */}
        <circle cx="82" cy="66" r="6" fill="#38bdf8" />
        <circle cx="118" cy="66" r="6" fill="#38bdf8" />
        <circle cx="82" cy="64" r="2" fill="#ffffff" />
        <circle cx="118" cy="64" r="2" fill="#ffffff" />

        {/* Highlight on head */}
        <ellipse cx="82" cy="34" rx="18" ry="8" fill="rgba(255,255,255,0.35)" />

        {/* Side ear/speaker */}
        <circle cx="42" cy="60" r="10" fill="#b91c1c" />
        <circle cx="42" cy="60" r="5" fill="#fbbf24" />

        {/* Neck / body */}
        <rect x="72" y="108" width="56" height="16" rx="6" fill="#1f2937" />

        {/* Torso */}
        <path
          d="M60 122 L140 122 L148 178 Q100 190 52 178 Z"
          fill="#dc2626"
        />
        <path
          d="M60 122 L140 122 L145 155 Q100 165 55 155 Z"
          fill="#ef4444"
        />
        {/* Chest badge */}
        <circle cx="100" cy="150" r="9" fill="#fbbf24" />
        <circle cx="100" cy="150" r="4" fill="#1f2937" />
      </motion.g>

      {/* Left arm (front — pushes the panel) */}
      <motion.g
        animate={{ rotate: [-8, 8, -8] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "62px 130px" }}
      >
        <rect x="52" y="128" width="18" height="46" rx="8" fill="#1f2937" />
        <circle cx="60" cy="180" r="12" fill="#dc2626" />
      </motion.g>

      {/* Right arm (back) */}
      <motion.g
        animate={{ rotate: [8, -8, 8] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
        style={{ transformOrigin: "138px 130px" }}
      >
        <rect x="130" y="128" width="18" height="46" rx="8" fill="#1f2937" />
        <circle cx="140" cy="180" r="12" fill="#dc2626" />
      </motion.g>

      {/* Legs — bob together */}
      <motion.g
        animate={{ y: [0, 2, 0] }}
        transition={{ duration: 0.6, repeat: Infinity, ease: "easeInOut" }}
      >
        <rect x="78" y="188" width="16" height="34" rx="6" fill="#1f2937" />
        <rect x="106" y="188" width="16" height="34" rx="6" fill="#1f2937" />
        <ellipse cx="86" cy="224" rx="14" ry="6" fill="#dc2626" />
        <ellipse cx="114" cy="224" rx="14" ry="6" fill="#dc2626" />
      </motion.g>
    </svg>
  );
}


// =====================================================================
// AnimatedWelcomePanel — the cinematic left-panel sequence.
// Phases:
//   0.0-1.0s  robot walks in from off-screen right → toward the center
//   0.8-2.0s  robot "pushes" the red panel — panel slides in from left
//   2.0-2.7s  robot walks past the panel and exits stage right
//   2.4-3.4s  the 3 text lines fade in in sequence
// After the first play (per session) we skip to the end state so
// returning users don't wait.
// =====================================================================
function AnimatedWelcomePanel() {
  // Play the animation on EVERY fresh mount of the login page. Users
  // don't refresh /login often, so a 4s intro on each visit is a
  // signature moment, not annoying.
  const [robotDone, setRobotDone] = useState(false);

  useEffect(() => {
    // Remove any legacy session flag from earlier builds
    try { sessionStorage.removeItem("login_intro_played"); } catch { /* ignore */ }
    // Hide the robot after the walk-out is complete
    const t = setTimeout(() => setRobotDone(true), 4200);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.welcomeWrap}>

      {/* Red panel — slides in from off-screen left */}
      <motion.div
        className={styles.panel}
        initial={{ x: "-105%" }}
        animate={{ x: 0 }}
        transition={{
          delay: 1.0,
          duration: 1.5,
          ease: [0.22, 0.9, 0.28, 1],
        }}
      >
        <div className={styles.ringA} />
        <div className={styles.ringB} />

        <motion.img
          src="/logo.webp"
          alt="Bharath Vending Corporation"
          className={styles.brandLogo}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2.8, duration: 0.6 }}
        />

        <motion.h1
          className={styles.welcomeTitle}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.0, duration: 0.55 }}
        >
          Welcome Back
        </motion.h1>

        <motion.p
          className={styles.welcomeSub}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.3, duration: 0.55 }}
        >
          Access your ERP dashboard.
        </motion.p>

        <motion.p
          className={styles.tagline}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 3.6, duration: 0.55 }}
        >
          Automate. Optimize. <span className={styles.taglineAccent}>Accelerate with AI.</span>
        </motion.p>

        <div className={styles.brandSpacer} />

        <motion.p
          className={styles.brandName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 3.9, duration: 0.5 }}
        >
          Bharath Vending Corporation
        </motion.p>
      </motion.div>

      {/* Robot — walks in from right, pushes panel, exits left */}
      <AnimatePresence>
        {!robotDone && (
          <motion.div
            className={styles.robotHolder}
            initial={{ x: "220%", y: 0 }}
            animate={{
              x: ["220%", "80%", "35%", "-20%", "-180%"],
              y: [0, -6, -3, -6, 0],
            }}
            transition={{
              times:    [0, 0.25, 0.55, 0.80, 1],
              duration: 4.0,
              ease:     "easeInOut",
            }}
            exit={{ opacity: 0, transition: { duration: 0.4 } }}
          >
            <LoginRobot />
          </motion.div>
        )}
      </AnimatePresence>
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
