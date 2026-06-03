import { useEffect, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";


function LiveClock() {

  const [now, setNow] = useState(() => new Date());

  useEffect(() => {

    const id = setInterval(() => setNow(new Date()), 1000);

    return () => clearInterval(id);
  }, []);

  const time = now.toLocaleTimeString("en-IN", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });

  const date = now.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  });

  return (

    <div
      style={{
        marginTop: 18,
        paddingTop: 14,
        borderTop: "1px solid rgba(255,255,255,0.12)",
        textAlign: "center",
        color: "rgba(255,255,255,0.85)",
        fontFamily:
          "ui-monospace, SFMono-Regular, Menlo, monospace"
      }}
    >
      <div
        style={{
          fontSize: 18,
          fontWeight: 600,
          letterSpacing: 1
        }}
      >
        🕒 {time}{" "}
        <span style={{ opacity: 0.7, fontSize: 12 }}>IST</span>
      </div>
      <div
        style={{
          fontSize: 11,
          opacity: 0.7,
          marginTop: 4,
          letterSpacing: 0.3
        }}
      >
        {date}
      </div>
    </div>
  );
}

const VENDING_IMAGES = [
  "/vending/vending-1.jpg",
  "/vending/vending-2.jpg",
  "/vending/vending-3.jpg",
  "/vending/vending-4.jpg",
  "/vending/vending-5.jpg",
  "/vending/vending-6.jpg",
  "/vending/vending-7.jpg",
  "/vending/vending-8.jpg",
  "/vending/vending-9.jpg"
];

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

  const isEmployee = mode === "employee";

  const renderMachineRow = (keyPrefix) =>
    VENDING_IMAGES.map((src, i) => (
      <img
        key={`${keyPrefix}-${i}`}
        src={src}
        alt=""
        className="vending-machine"
        loading="eager"
        draggable="false"
      />
    ));

  return (

    <div className="login-page">

      <div className="vending-marquee" aria-hidden="true">
        <div className="vending-track">
          {renderMachineRow("a")}
        </div>
        <div className="vending-track">
          {renderMachineRow("b")}
        </div>
      </div>

      <form
        className="login-box"
        onSubmit={handleLogin}
      >

        <img
          src="/bharath-logo.png"
          alt="Bharath Vending Corporation"
          className="login-logo-img"
        />

        <h1>Bharath Vending Corporation</h1>

        <p>Manufacturing Management System</p>

        <div className="login-tabs">

          {!onboardingToken && (
            <button
              type="button"
              className={
                "login-tab" +
                (mode === "admin"
                  ? " login-tab-active"
                  : "")
              }
              onClick={() => switchMode("admin")}
            >
              Admin
            </button>
          )}

          <button
            type="button"
            className={
              "login-tab" +
              (mode === "employee"
                ? " login-tab-active"
                : "")
            }
            onClick={() => switchMode("employee")}
          >
            Employee
          </button>

        </div>

        {
          onboardingToken && (
            <div
              style={{
                background: "rgba(200, 16, 46, 0.12)",
                border: "1px solid rgba(200, 16, 46, 0.45)",
                color: "#ffb4b4",
                padding: "8px 12px",
                borderRadius: 8,
                fontSize: 13,
                margin: "10px 0",
                textAlign: "center"
              }}
            >
              🔑 Completing your onboarding registration
            </div>
          )
        }

        {
          error && (
            <div className="login-error">
              {error}
            </div>
          )
        }

        <label className="login-label">
          {isEmployee ? "Employee ID" : "Admin Code"}
        </label>

        <div className="login-input-wrap">

          <span className="login-icon">
            {isEmployee ? "🆔" : "👤"}
          </span>

          <input
            type="text"
            placeholder={
              isEmployee
                ? "e.g. EMP001"
                : "Admin code (e.g. ADMIN)"
            }
            value={username}
            onChange={(e) =>
              setUsername(e.target.value)
            }
            autoComplete="username"
          />

        </div>

        <label className="login-label">Password</label>

        <div className="login-input-wrap">

          <span className="login-icon">🔒</span>

          <input
            type={showPassword ? "text" : "password"}
            placeholder="Enter password"
            value={password}
            onChange={(e) =>
              setPassword(e.target.value)
            }
            autoComplete="current-password"
          />

          <button
            type="button"
            className="login-eye"
            onClick={() =>
              setShowPassword(!showPassword)
            }
          >
            {showPassword ? "🌻" : "👁"}
          </button>

        </div>

        <button
          type="submit"
          disabled={loading}
        >
          {loading ? "Signing in…" : "Sign In"}
        </button>

        {
          onboardingToken && (
            <div
              style={{
                textAlign: "center",
                marginTop: 8
              }}
            >
              <a
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  cancelOnboarding();
                }}
                style={{
                  fontSize: 11,
                  color: "rgba(255,255,255,0.6)",
                  textDecoration: "underline"
                }}
              >
                Cancel onboarding
              </a>
            </div>
          )
        }

        <FingerprintButton />

        <LiveClock />

      </form>

    </div>
  );
}

function FingerprintButton() {

  const [showModal, setShowModal] = useState(false);

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          margin: "18px 0 12px"
        }}
      >
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(255,255,255,0.15)"
          }}
        />
        <span
          style={{
            fontSize: 11,
            color: "rgba(255,255,255,0.55)",
            letterSpacing: 1,
            textTransform: "uppercase"
          }}
        >
          or
        </span>
        <div
          style={{
            flex: 1,
            height: 1,
            background: "rgba(255,255,255,0.15)"
          }}
        />
      </div>

      <div style={{ display: "flex", justifyContent: "center" }}>
        <button
          type="button"
          onClick={() => setShowModal(true)}
          title="Sign in with fingerprint (coming soon)"
          aria-label="Sign in with fingerprint"
          style={{
            position: "relative",
            width: 72,
            height: 72,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background:
              "linear-gradient(135deg, #C8102E 0%, #8B0B1F 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow:
              "0 8px 24px rgba(37, 99, 235, 0.45), " +
              "0 0 0 0 rgba(37, 99, 235, 0.6)",
            animation: "fp-pulse 2s infinite",
            transition: "transform 0.15s"
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = "scale(1.06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = "scale(1)";
          }}
        >
          <FingerprintIcon />
        </button>
      </div>

      <p
        style={{
          textAlign: "center",
          fontSize: 11,
          color: "rgba(255,255,255,0.55)",
          marginTop: 8,
          marginBottom: 0
        }}
      >
        Tap to scan fingerprint
      </p>

      {/* Keyframes injected once via <style> tag */}
      <style>{`
        @keyframes fp-pulse {
          0%   { box-shadow: 0 8px 24px rgba(37, 99, 235, 0.45), 0 0 0 0   rgba(37, 99, 235, 0.55); }
          70%  { box-shadow: 0 8px 24px rgba(37, 99, 235, 0.45), 0 0 0 16px rgba(37, 99, 235, 0.0);  }
          100% { box-shadow: 0 8px 24px rgba(37, 99, 235, 0.45), 0 0 0 0   rgba(37, 99, 235, 0.0);  }
        }
      `}</style>

      {showModal && (
        <FingerprintModal onClose={() => setShowModal(false)} />
      )}
    </>
  );
}


function FingerprintModal({ onClose }) {

  return (

    <div
      onClick={(e) => e.target === e.currentTarget && onClose()}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.7)",
        zIndex: 2000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20
      }}
    >
      <div
        style={{
          background: "#fff",
          borderRadius: 14,
          padding: 28,
          width: "min(420px, 100%)",
          textAlign: "center",
          boxShadow: "0 20px 60px rgba(0,0,0,0.3)"
        }}
      >
        <div
          style={{
            width: 80,
            height: 80,
            borderRadius: "50%",
            background:
              "linear-gradient(135deg, #C8102E 0%, #8B0B1F 100%)",
            color: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            margin: "0 auto 16px",
            animation: "fp-pulse 2s infinite"
          }}
        >
          <FingerprintIcon size={42} />
        </div>

        <h2
          style={{
            margin: "0 0 8px 0",
            fontSize: 19,
            color: "#0f172a"
          }}
        >
          Fingerprint Login
        </h2>

        <p
          style={{
            margin: "0 0 18px 0",
            color: "#475569",
            fontSize: 14,
            lineHeight: 1.6
          }}
        >
          Biometric sign-in is coming soon. We'll be
          integrating fingerprint scanners here so
          employees can clock in and access their
          dashboard with a single touch.
        </p>

        <div
          style={{
            background: "#f1f5f9",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            padding: "10px 12px",
            fontSize: 12,
            color: "#64748b",
            marginBottom: 18,
            textAlign: "left"
          }}
        >
          <strong style={{ color: "#0f172a" }}>
            Planned support:
          </strong>
          <ul
            style={{
              margin: "6px 0 0 0",
              paddingLeft: 18
            }}
          >
            <li>USB fingerprint readers (Digital Persona, ZKTeco, Mantra)</li>
            <li>Windows Hello / Touch ID for desktop users</li>
            <li>Mobile biometric for the mobile app</li>
          </ul>
        </div>

        <button
          type="button"
          onClick={onClose}
          style={{
            width: "100%",
            padding: "10px 16px",
            background: "#2563eb",
            color: "#fff",
            border: "none",
            borderRadius: 8,
            fontSize: 14,
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Got it
        </button>
      </div>
    </div>
  );
}


function FingerprintIcon({ size = 30 }) {

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {/* Outer dome — top of the print */}
      <path d="M2 12a10 10 0 0 1 18-6" />

      {/* Outer ridge bottom-left */}
      <path d="M2 16h.01" />

      {/* Outer ridge right */}
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />

      {/* Mid ridge left going down */}
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />

      {/* Inner upper-right arc */}
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />

      {/* Mid ridge bottom */}
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />

      {/* Innermost loop */}
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />

      {/* Central whorl line */}
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />

      {/* Short top center line */}
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
    </svg>
  );
}


export default Login;
