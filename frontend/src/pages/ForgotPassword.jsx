import { useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";

import styles from "./Login.module.css";
import API from "../services/api";

function ForgotPassword() {

  const [identifier, setIdentifier] = useState("");

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [sent, setSent] = useState(false);

  const submit = async (e) => {

    e.preventDefault();

    setError("");

    if (!identifier.trim()) {

      setError("Please enter your User ID or email.");

      return;
    }

    setLoading(true);

    try {

      await API.post("/forgot-password", { IDENTIFIER: identifier.trim() });

      setSent(true);

    } catch (err) {

      setError(err?.response?.data?.detail || "Something went wrong. Please try again.");

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
              <h1 className={styles.welcomeTitle}>Forgot Password</h1>
              <p className={styles.welcomeSub}>We'll email you a reset link</p>
              <div className={styles.brandSpacer} />
              <p className={styles.brandName}>Bharath Vending Corporation</p>
            </motion.div>
          </div>
        </div>

        <div className={styles.right}>

          <h2 className={styles.formHeading}>Reset your password</h2>
          <p className={styles.formSubheading}>
            Enter your User ID or email — we'll send a reset link if an account exists.
          </p>

          {error && <div className={styles.error}>{error}</div>}

          {sent ? (
            <div className={styles.onboardingBanner}>
              If an account exists for that ID, a reset link has been sent to its
              registered email. Check your inbox (and spam folder).
            </div>
          ) : (
            <>
              <label className={styles.label}>User ID or Email</label>

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
                  placeholder="Enter your User ID or email"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  autoFocus
                />
              </div>

              <button type="submit" className={styles.submit} disabled={loading}>
                {loading ? "Sending…" : "Send Reset Link"}
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

export default ForgotPassword;
