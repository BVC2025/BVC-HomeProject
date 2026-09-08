import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { motion } from "framer-motion";

import styles from "./Login.module.css";
import API from "../services/api";

function ResetPassword() {

  const navigate = useNavigate();

  const [searchParams] = useSearchParams();

  const token = searchParams.get("token") || "";

  const [next, setNext] = useState("");

  const [confirm, setConfirm] = useState("");

  const [showPw, setShowPw] = useState(false);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [done, setDone] = useState(false);

  const submit = async (e) => {

    e.preventDefault();

    setError("");

    if (!token) {

      setError("This reset link is missing its token — please use the link from your email.");

      return;
    }

    if (next.length < 6) {

      setError("New password must be at least 6 characters.");

      return;
    }

    if (next !== confirm) {

      setError("Passwords don't match.");

      return;
    }

    setLoading(true);

    try {

      await API.post(`/reset-password/${token}`, { NEW_PASSWORD: next });

      setDone(true);

      setTimeout(() => navigate("/login", { replace: true }), 2500);

    } catch (err) {

      setError(err?.response?.data?.detail || "Could not reset the password.");

    } finally {

      setLoading(false);
    }
  };

  return (
    <div className={styles.page}>
      <form className={styles.card} onSubmit={submit}>

        <div className={styles.left}>
          <div className={styles.welcomeWrap}>
            <motion.div
              className={styles.panel}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
            >
              <div className={styles.ringA} />
              <div className={styles.ringB} />
              <img src="/logo.webp" alt="Bharath Vending Corporation" className={styles.brandLogo} />
              <h1 className={styles.welcomeTitle}>Set New Password</h1>
              <p className={styles.welcomeSub}>Almost done</p>
              <div className={styles.brandSpacer} />
              <p className={styles.brandName}>Bharath Vending Corporation</p>
            </motion.div>
          </div>
        </div>

        <div className={styles.right}>

          <h2 className={styles.formHeading}>Choose a new password</h2>
          <p className={styles.formSubheading}>
            At least 6 characters. You'll be logged out of any existing session.
          </p>

          {error && <div className={styles.error}>{error}</div>}

          {done ? (
            <div className={styles.onboardingBanner}>
              Password reset. Taking you to login…
            </div>
          ) : (
            <>
              <label className={styles.label}>New password</label>
              <div className={styles.inputWrap}>
                <span className={styles.icon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <input
                  type={showPw ? "text" : "password"}
                  className={styles.input}
                  placeholder="Enter new password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoFocus
                />
                <button
                  type="button"
                  className={styles.eye}
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? "Hide password" : "Show password"}
                >
                  {showPw ? (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 3l18 18" />
                      <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                      <path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c5 0 9.3 3 11 8a14 14 0 0 1-3.4 4.8" />
                      <path d="M6.3 6.3A14 14 0 0 0 1 12c1.7 5 6 8 11 8 1.7 0 3.3-.3 4.7-.9" />
                    </svg>
                  ) : (
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.8"
                      strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>

              <label className={styles.label}>Confirm password</label>
              <div className={styles.inputWrap}>
                <span className={styles.icon}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round">
                    <rect x="4" y="10" width="16" height="11" rx="2" />
                    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
                  </svg>
                </span>
                <input
                  type={showPw ? "text" : "password"}
                  className={styles.input}
                  placeholder="Re-enter new password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                />
              </div>

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? "Resetting…" : "Reset Password"}
              </button>
            </>
          )}

          <div className={styles.cancelWrap}>
            <Link to="/login" className={styles.cancelLink}>
              Back to login
            </Link>
          </div>

        </div>

      </form>
    </div>
  );
}

export default ResetPassword;
