import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";


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

  const { token } = useParams();

  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);

  const [meta, setMeta] = useState(null);

  const [mode, setMode] = useState("register"); // 'register' | 'login'

  const [form, setForm] = useState({
    USERNAME: "",
    PASSWORD: "",
    CONFIRM_PASSWORD: ""
  });

  const [error, setError] = useState("");

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

          // already finished — bounce to the read-only chat view
          // so the customer sees a confirmation
          navigate(`/portal/onboarding/${token}/chat`, { replace: true });

          return;
        }

        // If a session key is already in localStorage AND the customer
        // had registered/logged-in before, jump straight to chat.
        const cached = localStorage.getItem(portalKeyFor(token));

        if (cached && res.data?.HAS_ACCOUNT) {

          navigate(`/portal/onboarding/${token}/chat`, { replace: true });

          return;
        }

        setMode(res.data?.HAS_ACCOUNT ? "login" : "register");
      })
      .catch((err) => {

        setError(
          err?.response?.data?.detail ||
            "This invitation link is invalid or has expired."
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

        setError("Please fill in all fields.");

        return;
      }

      if (form.PASSWORD !== form.CONFIRM_PASSWORD) {

        setError("Password and confirm password do not match.");

        return;
      }

      if (form.PASSWORD.length < 6) {

        setError("Password must be at least 6 characters.");

        return;
      }
    } else {

      if (!form.USERNAME.trim() || !form.PASSWORD) {

        setError("Please enter your username and password.");

        return;
      }
    }

    setSubmitting(true);

    try {

      const url = `/onboarding/${token}/${mode}`;

      const body =
        mode === "register"
          ? {
              USERNAME: form.USERNAME.trim(),
              PASSWORD: form.PASSWORD,
              CONFIRM_PASSWORD: form.CONFIRM_PASSWORD
            }
          : {
              USERNAME: form.USERNAME.trim(),
              PASSWORD: form.PASSWORD
            };

      const res = await portal.post(url, body);

      const key = res.data?.session_key;

      if (!key) {

        throw new Error("Server did not return a session key.");
      }

      localStorage.setItem(portalKeyFor(token), key);

      localStorage.setItem(`${portalKeyFor(token)}_user`, res.data?.username || "");

      navigate(`/portal/onboarding/${token}/chat`, { replace: true });

    } catch (err) {

      const detail = err?.response?.data?.detail;

      setError(
        typeof detail === "string"
          ? detail
          : err?.message || "Something went wrong. Please try again."
      );

    } finally {

      setSubmitting(false);
    }
  };

  if (loading) {

    return (
      <Shell>
        <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>
          Loading your invitation…
        </div>
      </Shell>
    );
  }

  if (!meta) {

    return (
      <Shell>
        <div style={{
          padding: 28,
          background: "#fef2f2",
          border: "1px solid #fecaca",
          borderRadius: 10,
          color: "#991b1b",
          textAlign: "center"
        }}>
          ⚠ {error || "Invitation link not found."}
        </div>
      </Shell>
    );
  }

  return (
    <Shell>

      <div style={{ textAlign: "center", marginBottom: 22 }}>

        <div style={{
          fontSize: 11,
          fontWeight: 800,
          letterSpacing: 2,
          color: "#C8102E",
          marginBottom: 6
        }}>
          BVC24 · CUSTOMER ONBOARDING
        </div>

        <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>
          {mode === "register"
            ? "Create your portal account"
            : "Welcome back"}
        </h1>

        <p style={{
          margin: "10px 0 0",
          color: "#64748b",
          fontSize: 14
        }}>
          {meta.NAME_HINT && (
            <>
              For: <b style={{ color: "#0f172a" }}>{meta.NAME_HINT}</b>
              <br />
            </>
          )}
          {mode === "register"
            ? "Set a username and password to start your guided onboarding chat."
            : "Sign in to resume your onboarding from where you left off."}
        </p>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          border: "1px solid #fecaca",
          color: "#991b1b",
          borderRadius: 8,
          marginBottom: 14,
          fontSize: 13
        }}>
          {error}
        </div>
      )}

      <form onSubmit={submit}>

        <Field label="Username">
          <input
            type="text"
            value={form.USERNAME}
            onChange={(e) => setForm({ ...form, USERNAME: e.target.value })}
            placeholder="e.g. apollo_procurement"
            style={inputStyle()}
            autoFocus
          />
        </Field>

        <Field label="Password">
          <input
            type="password"
            value={form.PASSWORD}
            onChange={(e) => setForm({ ...form, PASSWORD: e.target.value })}
            placeholder="At least 6 characters"
            style={inputStyle()}
          />
        </Field>

        {mode === "register" && (
          <Field label="Confirm Password">
            <input
              type="password"
              value={form.CONFIRM_PASSWORD}
              onChange={(e) =>
                setForm({ ...form, CONFIRM_PASSWORD: e.target.value })
              }
              placeholder="Re-enter password"
              style={inputStyle()}
            />
          </Field>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "12px 16px",
            background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
            color: "white",
            border: "none",
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 14,
            cursor: submitting ? "wait" : "pointer",
            marginTop: 12,
            boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
          }}
        >
          {submitting
            ? "Please wait…"
            : mode === "register"
              ? "Create Account → Start Chat"
              : "Sign In → Resume"}
        </button>
      </form>

      <div style={{
        textAlign: "center",
        marginTop: 18,
        fontSize: 12,
        color: "#64748b"
      }}>
        {mode === "register" ? (
          meta.HAS_ACCOUNT && (
            <>
              Already registered?{" "}
              <span
                style={{ color: "#C8102E", cursor: "pointer", fontWeight: 700 }}
                onClick={() => { setMode("login"); setError(""); }}
              >
                Sign in
              </span>
            </>
          )
        ) : (
          <>
            New customer?{" "}
            <span
              style={{ color: "#C8102E", cursor: "pointer", fontWeight: 700 }}
              onClick={() => { setMode("register"); setError(""); }}
            >
              Create an account
            </span>
          </>
        )}
      </div>

    </Shell>
  );
}


// ----------------------------------------------------------------
// Visual shell — BVC red banner + centred card
// ----------------------------------------------------------------

function Shell({ children }) {

  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1A0508, #4A0E18 60%, #8B0B1F)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily:
        "Segoe UI, system-ui, -apple-system, Arial, sans-serif"
    }}>

      <div style={{
        width: "min(480px, 100%)",
        background: "white",
        borderRadius: 16,
        padding: 32,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
      }}>
        <div style={{
          textAlign: "center",
          marginBottom: 24,
          paddingBottom: 18,
          borderBottom: "2px solid #fef2f2"
        }}>
          <div style={{
            display: "inline-block",
            width: 64,
            height: 64,
            background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
            borderRadius: 16,
            color: "white",
            fontSize: 28,
            fontWeight: 900,
            lineHeight: "64px",
            letterSpacing: 1,
            boxShadow: "0 8px 22px rgba(200,16,46,0.35)"
          }}>
            BVC
          </div>
          <div style={{
            marginTop: 8,
            fontSize: 13,
            color: "#64748b",
            fontWeight: 600
          }}>
            Bharath Vending Corporation
          </div>
        </div>

        {children}

        <div style={{
          textAlign: "center",
          marginTop: 26,
          fontSize: 10,
          color: "#94a3b8",
          letterSpacing: 0.6
        }}>
          © Bharath Vending Corporation · www.bvc24.in
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }) {

  return (
    <div style={{ marginBottom: 12 }}>
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#475569",
        letterSpacing: 0.5,
        marginBottom: 5
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function inputStyle() {

  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    background: "white",
    boxSizing: "border-box"
  };
}


export default OnboardingPortal;
