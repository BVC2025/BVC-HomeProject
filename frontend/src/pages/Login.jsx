import { useEffect, useRef, useState } from "react";

import { useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";

import styles from "./Login.module.css";

import API from "../services/api";


// =====================================================================
// LoginRobot — white/cyan SVG mascot matching user's reference.
// Single unit — no per-limb loops. The parent handles walk-cycle motion
// via translateX + rotation + a subtle vertical bob so it reads as one
// person walking, not a baby waving hands.
// =====================================================================
function LoginRobot() {
  return (
    <svg
      viewBox="0 0 220 280"
      xmlns="http://www.w3.org/2000/svg"
      className={styles.robotSvg}
      aria-hidden="true"
    >
      {/* Ground shadow — subtle contact indication */}
      <ellipse cx="110" cy="272" rx="62" ry="6" fill="rgba(0,0,0,0.18)" />

      {/* ==================== Legs ==================== */}
      {/* Left leg (behind — back foot) */}
      <g>
        {/* thigh */}
        <rect x="72" y="205" width="24" height="34" rx="10" fill="#e5e7eb" />
        {/* shin */}
        <rect x="74" y="235" width="22" height="30" rx="9" fill="#f3f4f6" />
        {/* foot */}
        <ellipse cx="82" cy="266" rx="20" ry="9" fill="#374151" />
        {/* knee joint */}
        <circle cx="84" cy="236" r="4" fill="#22d3ee" opacity="0.7" />
      </g>
      {/* Right leg (front) */}
      <g>
        <rect x="124" y="205" width="24" height="34" rx="10" fill="#e5e7eb" />
        <rect x="126" y="235" width="22" height="30" rx="9" fill="#f3f4f6" />
        <ellipse cx="134" cy="266" rx="20" ry="9" fill="#374151" />
        <circle cx="136" cy="236" r="4" fill="#22d3ee" opacity="0.7" />
      </g>

      {/* ==================== Body ==================== */}
      {/* Pelvis pad — dark accent */}
      <rect x="70" y="196" width="80" height="16" rx="8" fill="#374151" />

      {/* Torso */}
      <path
        d="M 60 130
           Q 60 122 68 122
           L 152 122
           Q 160 122 160 130
           L 156 196
           Q 156 202 150 202
           L 70 202
           Q 64 202 64 196 Z"
        fill="#f9fafb"
      />
      {/* Chest details */}
      <ellipse cx="110" cy="145" rx="18" ry="4" fill="#374151" />
      <circle cx="110" cy="165" r="9" fill="#e5e7eb" stroke="#22d3ee" strokeWidth="1.5" />
      <circle cx="110" cy="165" r="4" fill="#22d3ee" opacity="0.6" />
      {/* Ribbed accordion between torso and pelvis */}
      <path d="M 96 180 L 96 200 M 104 180 L 104 200 M 112 180 L 112 200 M 120 180 L 120 200 M 128 180 L 128 200"
            stroke="#9ca3af" strokeWidth="1.5" strokeLinecap="round" />

      {/* ==================== Arms ==================== */}
      {/* Left arm (front — hands press against panel) */}
      <g>
        {/* shoulder */}
        <circle cx="60" cy="140" r="14" fill="#e5e7eb" />
        {/* upper arm */}
        <rect x="52" y="146" width="18" height="40" rx="8" fill="#374151" />
        {/* forearm — angled slightly forward as if pushing */}
        <rect x="46" y="180" width="18" height="34" rx="8" fill="#f3f4f6" transform="rotate(-8 55 197)" />
        {/* elbow joint */}
        <circle cx="61" cy="184" r="4" fill="#22d3ee" opacity="0.7" />
        {/* hand — small white paddle */}
        <ellipse cx="42" cy="215" rx="11" ry="8" fill="#f9fafb" stroke="#9ca3af" strokeWidth="1" />
      </g>
      {/* Right arm (mirror) */}
      <g>
        <circle cx="160" cy="140" r="14" fill="#e5e7eb" />
        <rect x="150" y="146" width="18" height="40" rx="8" fill="#374151" />
        <rect x="156" y="180" width="18" height="34" rx="8" fill="#f3f4f6" transform="rotate(8 165 197)" />
        <circle cx="159" cy="184" r="4" fill="#22d3ee" opacity="0.7" />
        <ellipse cx="178" cy="215" rx="11" ry="8" fill="#f9fafb" stroke="#9ca3af" strokeWidth="1" />
      </g>

      {/* ==================== Head ==================== */}
      {/* antennas — cyan tips */}
      <line x1="72" y1="30" x2="66" y2="14" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" />
      <circle cx="66" cy="14" r="6" fill="#22d3ee" opacity="0.85" />
      <line x1="148" y1="30" x2="154" y2="14" stroke="#9ca3af" strokeWidth="3" strokeLinecap="round" />
      <circle cx="154" cy="14" r="6" fill="#22d3ee" opacity="0.85" />

      {/* Head dome */}
      <ellipse cx="110" cy="70" rx="66" ry="56" fill="#f9fafb" />
      {/* Highlight arc */}
      <path d="M 60 42 Q 90 22 130 30" stroke="rgba(255,255,255,0.9)" strokeWidth="3" fill="none" strokeLinecap="round" />

      {/* Ear circles / speakers */}
      <circle cx="46" cy="72" r="11" fill="#e5e7eb" />
      <circle cx="46" cy="72" r="6" fill="#22d3ee" opacity="0.7" />
      <circle cx="174" cy="72" r="11" fill="#e5e7eb" />
      <circle cx="174" cy="72" r="6" fill="#22d3ee" opacity="0.7" />

      {/* Face screen (dark visor) */}
      <path
        d="M 62 60
           Q 62 52 72 52
           L 148 52
           Q 158 52 158 60
           L 158 100
           Q 158 108 148 108
           L 72 108
           Q 62 108 62 100 Z"
        fill="#111827"
      />
      {/* Screen bezel highlight */}
      <path
        d="M 68 58 L 152 58"
        stroke="rgba(255,255,255,0.15)"
        strokeWidth="2"
        strokeLinecap="round"
      />

      {/* Eyes — cyan glow rectangles */}
      <rect x="80" y="70" width="14" height="20" rx="4" fill="#22d3ee" />
      <rect x="126" y="70" width="14" height="20" rx="4" fill="#22d3ee" />
      {/* eye highlights */}
      <rect x="82" y="72" width="4" height="8" rx="2" fill="rgba(255,255,255,0.6)" />
      <rect x="128" y="72" width="4" height="8" rx="2" fill="rgba(255,255,255,0.6)" />

      {/* Small smile curve */}
      <path
        d="M 100 96 Q 110 102 120 96"
        stroke="#22d3ee"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
        opacity="0.85"
      />

      {/* Neck */}
      <rect x="94" y="120" width="32" height="10" rx="4" fill="#9ca3af" />
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
// ---------------------------------------------------------------------
// Cinematic timing (all seconds)
//
//   0.0 – 2.2   Robot walks in from off-screen right, still in white area.
//               Panel is off-screen left. Body bobs (gait) + slight sway.
//   2.2 – 4.4   Robot's hands make contact with the panel. Robot leans
//               forward slightly. From here on, robot AND panel translate
//               together at the SAME rate — as if the robot is pushing.
//   4.4 – 4.9   Robot stops, hands release the panel (small settle).
//               Panel does a tiny elastic settle.
//   4.9 – 5.6   Robot walks off-screen left.
//   4.9 – 6.4   Welcome text lines fade in sequentially.
// ---------------------------------------------------------------------
function AnimatedWelcomePanel() {
  const [robotDone, setRobotDone] = useState(false);

  useEffect(() => {
    try { sessionStorage.removeItem("login_intro_played"); } catch { /* ignore */ }
    // Robot walk-out lasts ~5.6s from mount
    const t = setTimeout(() => setRobotDone(true), 5700);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className={styles.welcomeWrap}>

      {/* Red panel — starts fully off-screen left. Sync'd with robot from
          2.2s onwards. Total travel: -105% -> 0. */}
      <motion.div
        className={styles.panel}
        initial={{ x: "-105%" }}
        animate={{ x: ["-105%", "-105%", "-30%", "0%", "-1%", "0%"] }}
        transition={{
          times:    [0,       0.35,     0.60,    0.75,   0.78,   0.82],
          duration: 6.4,
          ease:     "easeInOut",
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
          transition={{ delay: 5.0, duration: 0.6 }}
        />

        <motion.h1
          className={styles.welcomeTitle}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 5.2, duration: 0.55 }}
        >
          Welcome Back
        </motion.h1>

        <motion.p
          className={styles.welcomeSub}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 5.5, duration: 0.55 }}
        >
          Access your ERP dashboard.
        </motion.p>

        <motion.p
          className={styles.tagline}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 5.8, duration: 0.55 }}
        >
          Automate. Optimize. <span className={styles.taglineAccent}>Accelerate with AI.</span>
        </motion.p>

        <div className={styles.brandSpacer} />

        <motion.p
          className={styles.brandName}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 6.1, duration: 0.5 }}
        >
          Bharath Vending Corporation
        </motion.p>
      </motion.div>

      {/* Robot walk cycle
          x: off-screen right -> approach panel edge -> pushing zone ->
             exit off-screen left. Y bob is subtle 4px "gait".
          rotate: 0 (walking) -> 3deg forward lean while pushing -> 0. */}
      <AnimatePresence>
        {!robotDone && (
          <motion.div
            className={styles.robotHolder}
            initial={{ x: "260%", y: 0, rotate: 0 }}
            animate={{
              // 0.00 spawn far right of viewport
              // 0.35 approaches, still in the white area
              // 0.60 contact — robot's left hand touches panel edge
              // 0.75 push phase — moves left in sync with panel
              // 0.82 settle — brief pause at final position
              // 1.00 exit off-screen left
              x:      ["260%", "150%", "80%",  "30%", "20%",  "-150%"],
              y:      [0,      -4,     -3,     -5,    0,      0],
              rotate: [0,       0,     0,      3,     0,      0],
            }}
            transition={{
              times:    [0,     0.35,   0.60,   0.75,  0.82,   1],
              duration: 6.4,
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
