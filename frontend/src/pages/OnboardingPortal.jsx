import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";
import styles from "./OnboardingPortal.module.css";


// ----------------------------------------------------------------
// Portal-specific axios — does NOT attach the admin JWT. The
// onboarding endpoints use their own SESSION_KEY (returned by
// /register or /login) as the Authorization bearer.
// ----------------------------------------------------------------

const portal = axios.create({ baseURL: API_BASE_URL });

const portalKeyFor = (token) => `portal_session_${token}`;


// ----------------------------------------------------------------
// Customer Onboarding Portal — landing page.
//   - Looks up the invitation token (public GET).
//   - If no portal account exists, shows the registration form.
//   - If one exists, shows the login form (resume).
//   - On success → navigates to /portal/onboarding/<token>/chat
// ----------------------------------------------------------------

function OnboardingPortal() {

  const { token }  = useParams();
  const navigate   = useNavigate();
  const [loading, setLoading]     = useState(true);
  const [meta, setMeta]           = useState(null);
  const [mode, setMode]           = useState("register");
  const [form, setForm]           = useState({ USERNAME: "", PASSWORD: "", CONFIRM_PASSWORD: "" });
  const [error, setError]         = useState("");
  const [submitting, setSubmitting] = useState(false);

  // ---- 1. Fetch public session info ----
  useEffect(() => {
    setLoading(true);
    setError("");

    portal
      .get(`/onboarding/${token}`)
      .then((res) => {
        setMeta(res.data);
        if (res.data?.SUBMITTED) {
          navigate(`/portal/onboarding/${token}/chat`, { replace: true });
          return;
        }
        const cached = localStorage.getItem(portalKeyFor(token));
        if (cached && res.data?.HAS_ACCOUNT) {
          navigate(`/portal/onboarding/${token}/chat`, { replace: true });
          return;
        }
        setMode(res.data?.HAS_ACCOUNT ? "login" : "register");
      })
      .catch((err) => {
        setError(
          err?.response?.data?.detail || "This invitation link is invalid or has expired."
        );
      })
      .finally(() => setLoading(false));
  }, [token, navigate]);

  // ---- 2. Submit registration or login ----
  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");

    if (mode === "register") {
      if (!form.USERNAME.trim() || !form.PASSWORD || !form.CONFIRM_PASSWORD) {
        setError("Please fill in all fields."); return;
      }
      if (form.PASSWORD !== form.CONFIRM_PASSWORD) {
        setError("Password and confirm password do not match."); return;
      }
      if (form.PASSWORD.length < 6) {
        setError("Password must be at least 6 characters."); return;
      }
    } else {
      if (!form.USERNAME.trim() || !form.PASSWORD) {
        setError("Please enter your username and password."); return;
      }
    }

    setSubmitting(true);
    try {
      const url = `/onboarding/${token}/${mode}`;
      const body = mode === "register"
        ? { USERNAME: form.USERNAME.trim(), PASSWORD: form.PASSWORD, CONFIRM_PASSWORD: form.CONFIRM_PASSWORD }
        : { USERNAME: form.USERNAME.trim(), PASSWORD: form.PASSWORD };

      const res = await portal.post(url, body);
      const key = res.data?.session_key;
      if (!key) throw new Error("Server did not return a session key.");

      localStorage.setItem(portalKeyFor(token), key);
      localStorage.setItem(`${portalKeyFor(token)}_user`, res.data?.username || "");
      navigate(`/portal/onboarding/${token}/chat`, { replace: true });
    } catch (err) {
      const detail = err?.response?.data?.detail;
      setError(typeof detail === "string" ? detail : err?.message || "Something went wrong. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <Shell>
        <div className={styles.loadingText}>Loading your invitation…</div>
      </Shell>
    );
  }

  if (!meta) {
    return (
      <Shell>
        <div className={styles.notFoundBanner}>
          ⚠ {error || "Invitation link not found."}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>

      <div className={styles.headingArea}>
        <div className={styles.eyebrow}>BVC24 · CUSTOMER ONBOARDING</div>
        <h1 className={styles.heading}>
          {mode === "register" ? "Create your portal account" : "Welcome back"}
        </h1>
        <p className={styles.subtext}>
          {meta.NAME_HINT && (
            <>For: <b className={styles.nameHint}>{meta.NAME_HINT}</b><br /></>
          )}
          {mode === "register"
            ? "Set a username and password to start your guided onboarding chat."
            : "Sign in to resume your onboarding from where you left off."}
        </p>
      </div>

      {error && (
        <div className={styles.errorBanner}>{error}</div>
      )}

      <form onSubmit={submit}>
        <Field label="Username">
          <input
            type="text"
            value={form.USERNAME}
            onChange={(e) => setForm({ ...form, USERNAME: e.target.value })}
            placeholder="e.g. apollo_procurement"
            className={styles.input}
            autoFocus
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={form.PASSWORD}
            onChange={(e) => setForm({ ...form, PASSWORD: e.target.value })}
            placeholder="At least 6 characters"
            className={styles.input}
          />
        </Field>

        {mode === "register" && (
          <Field label="Confirm Password">
            <input
              type="password"
              value={form.CONFIRM_PASSWORD}
              onChange={(e) => setForm({ ...form, CONFIRM_PASSWORD: e.target.value })}
              placeholder="Re-enter password"
              className={styles.input}
            />
          </Field>
        )}

        <button type="submit" disabled={submitting} className={styles.submitBtn}>
          {submitting
            ? "Please wait…"
            : mode === "register"
              ? "Create Account → Start Chat"
              : "Sign In → Resume"}
        </button>
      </form>

      <div className={styles.modeToggle}>
        {mode === "register" ? (
          meta.HAS_ACCOUNT && (
            <>
              Already registered?{" "}
              <span className={styles.modeLink} onClick={() => { setMode("login"); setError(""); }}>
                Sign in
              </span>
            </>
          )
        ) : (
          <>
            New customer?{" "}
            <span className={styles.modeLink} onClick={() => { setMode("register"); setError(""); }}>
              Create an account
            </span>
          </>
        )}
      </div>

    </Shell>
  );
}


// ----------------------------------------------------------------
// Visual shell — solid red background + centred white card
// ----------------------------------------------------------------

function Shell({ children }) {
  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.brandBlock}>
          <div className={styles.logo}>BVC</div>
          <div className={styles.logoSubtext}>Bharath Vending Corporation</div>
        </div>

        {children}

        <div className={styles.brandFooter}>
          © Bharath Vending Corporation · www.bvc24.in
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }) {
  return (
    <div className={styles.fieldWrap}>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}


export default OnboardingPortal;
