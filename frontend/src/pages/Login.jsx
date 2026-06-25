import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import styles from "./Login.module.css";

import API from "../services/api";


function Login() {

  const navigate = useNavigate();

  const [mode, setMode] = useState("admin");

  const [username, setUsername] = useState("");

  const [password, setPassword] = useState("");

  const [showPassword, setShowPassword] = useState(false);

  const [error, setError] = useState("");

  const [loading, setLoading] = useState(false);

  const [onboardingToken, setOnboardingToken] = useState(null);

  // On mount, check whether the onboarding page stashed a token.
  // If so, force the Employee tab and lock the tab switcher — we
  // are completing an onboarding registration, not a normal login.
  useEffect(() => {

    const tok = sessionStorage.getItem("pending_onboarding_token");

    if (tok) {

      setOnboardingToken(tok);

      setMode("employee");
    }
  }, []);

  const switchMode = (next) => {

    // While an onboarding is in progress, the tab is locked to
    // "employee" — silently ignore attempts to switch to admin.
    if (onboardingToken) return;

    setMode(next);

    setUsername("");

    setPassword("");

    setError("");
  };

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

  const handleAdminLogin = async () => {

    try {

      const res = await API.post("/admin-login", {
        EMPLOYEE_CODE: username.trim().toUpperCase(),
        PASSWORD: password
      });

      const d = res.data;

      localStorage.setItem("auth", "true");

      localStorage.setItem("role", "admin");

      localStorage.setItem("token", d.access_token || "");

      localStorage.setItem("employee_id", d.employee_id);

      localStorage.setItem("employee_code", d.code || "");

      localStorage.setItem("backend_role", d.role || "");

      localStorage.setItem(
        "permissions",
        JSON.stringify(d.permissions || [])
      );

      localStorage.setItem("username", d.name || username);

      localStorage.setItem(
        "loginTime",
        new Date().toISOString()
      );

      // Admin lands directly on the dashboard.
      navigate("/");

    } catch (err) {

      const detail =
        err?.response?.data?.detail ||
        "Invalid admin credentials";

      setError(detail);
    }
  };

  const handleEmployeeLogin = async () => {

    try {

      const res = await API.post("/employee-login", {
        EMPLOYEE_ID: username.trim().toUpperCase(),
        PASSWORD: password
      });

      const d = res.data;

      localStorage.setItem("auth", "true");

      localStorage.setItem("role", "employee");

      localStorage.setItem("token", d.access_token || "");

      localStorage.setItem("employee_id", d.EMPLOYEE_ID);

      localStorage.setItem("employee_name", d.EMPLOYEE_NAME);

      localStorage.setItem("department", d.DEPARTMENT);

      localStorage.setItem("employee_role", d.ROLE || "");

      localStorage.setItem("username", d.EMPLOYEE_NAME);

      localStorage.setItem(
        "loginTime",
        d.LOGIN_TIME || new Date().toISOString()
      );

      localStorage.setItem(
        "attendance_status",
        d.ATTENDANCE_STATUS || "PRESENT"
      );

      // Stash pending-yesterday flag so dashboard can show
      // the "You still have pending tasks from yesterday."
      // notification immediately on first render.
      if (d.HAS_PENDING_FROM_YESTERDAY) {

        localStorage.setItem(
          "pending_yesterday",
          JSON.stringify(d.PENDING_FROM_YESTERDAY || [])
        );

      } else {

        localStorage.removeItem("pending_yesterday");
      }

      // Employee landing: RoleBasedLanding at "/" gates on profile
      // completion → renders the EmployeeProfileForm on first login
      // and the Leave & Permission page on every subsequent login.
      navigate("/");

    } catch (err) {

      const detail =
        err?.response?.data?.detail ||
        "Login failed";

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

      } else if (mode === "admin") {

        await handleAdminLogin();

      } else {

        await handleEmployeeLogin();
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

        {/* Left — welcome panel */}
        <div className={styles.left}>
          <img
            src="/logo.webp"
            alt="Bharath Vending Corporation"
            className={styles.brandLogo}
          />

          <h1 className={styles.welcomeTitle}>Welcome Back</h1>

          <p className={styles.welcomeSub}>
            Sign in to access your ERP dashboard
          </p>

          <div className={styles.brandSpacer} />

          <p className={styles.brandName}>
            Bharath Vending Corporation
          </p>

        </div>

        {/* Right — credentials form */}
        <div className={styles.right}>

          <h2 className={styles.formHeading}>
            Enter your credentials to continue.
          </h2>

          <p className={styles.formSubheading}>
            Sign in to your Bharath Vending Corporation account.
          </p>

          {/* Tabs only appear for normal login. During onboarding,
              the user is completing their own registration — they
              don't need to pick a role. */}
          {!onboardingToken && (
            <div className={styles.tabs}>

              <button
                type="button"
                className={
                  styles.tab +
                  (mode === "admin"
                    ? " " + styles.tabActive
                    : "")
                }
                onClick={() => switchMode("admin")}
              >
                Admin
              </button>

              <button
                type="button"
                className={
                  styles.tab +
                  (mode === "employee"
                    ? " " + styles.tabActive
                    : "")
                }
                onClick={() => switchMode("employee")}
              >
                Employee
              </button>

            </div>
          )}

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
