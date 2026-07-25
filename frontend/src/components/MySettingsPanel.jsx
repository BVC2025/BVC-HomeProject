// =====================================================================
// MySettingsPanel — four stacked sections for employee self-service:
//   1. Dark mode              — localStorage.theme (light | dark)
//   2. Language               — localStorage.language (english for now)
//   3. Notifications          — voice alerts + email + in-app toggles
//   4. Device login history   — GET /me/login-history (attendance-based)
//
// Password change was intentionally removed — employees never rotate
// their own password in this deployment; admin resets it via the
// admin-only /employees/{id}/reset-password endpoint.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import {
  isVoiceEnabled,
  setVoiceEnabled,
  isVoiceSupported,
  stopSpeaking,
} from "../services/voiceAlerts";
import styles from "./MySettingsPanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  lock:    icon(<>
    <rect x="4" y="10" width="16" height="11" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </>),
  moon:    icon(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />),
  sun:     icon(<>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </>),
  globe:   icon(<>
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18" />
  </>),
  bell:    icon(<>
    <path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z" />
    <path d="M10 21h4" />
  </>),
  device:  icon(<>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
    <rect x="9" y="16" width="6" height="4" rx="0.5" />
  </>),
  eye:     icon(<>
    <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" />
    <circle cx="12" cy="12" r="3" />
  </>, 16),
  eyeOff:  icon(<>
    <path d="M3 3l18 18" />
    <path d="M10.6 10.6a2 2 0 0 0 2.8 2.8" />
    <path d="M9.9 4.2A9.5 9.5 0 0 1 12 4c5 0 9.3 3 11 8a14 14 0 0 1-3.4 4.8" />
    <path d="M6.3 6.3A14 14 0 0 0 1 12c1.7 5 6 8 11 8 1.7 0 3.3-.3 4.7-.9" />
  </>, 16),
  check:   icon(<path d="M4 12l6 6L20 6" />, 16),
  phone:   icon(<>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M11 18h2" />
  </>, 16),
  laptop:  icon(<>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
  </>, 16),
};


// ------------------------------------------------------------------
// Local preference helpers — kept simple and framework-free.
// ------------------------------------------------------------------

const LS_KEYS = {
  theme:            "theme",
  language:         "language",
  emailDigest:      "notif_email_digest",
  inAppPopups:      "notif_in_app_popups",
};

function getLS(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? fallback : v;
  } catch { return fallback; }
}

function setLS(key, value) {
  try { localStorage.setItem(key, value); } catch { /* private mode */ }
}


// Apply theme by stamping data-theme on the root element. Any page
// that ships dark-mode CSS variables will pick it up automatically.
function applyTheme(theme) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-theme", theme);
}


// ------------------------------------------------------------------
// Language options — English is the working translation; others
// stub so the preference persists ahead of full i18n support.
// ------------------------------------------------------------------
const LANGUAGES = [
  { code: "en",    label: "English",  status: "active" },
  { code: "ta",    label: "தமிழ் (Tamil)", status: "beta" },
  { code: "hi",    label: "हिन्दी (Hindi)", status: "beta" },
];


// ------------------------------------------------------------------
// Device sniff for the login-history row icons
// ------------------------------------------------------------------
function sniffDevice(ua) {
  if (!ua) return { kind: "web", label: "Web" };
  const s = String(ua).toLowerCase();
  if (/essl|x2008|biometric|zk|fingerprint/.test(s)) return { kind: "device", label: "Biometric" };
  if (/mobile|android|iphone|ipad/.test(s))         return { kind: "phone", label: "Mobile" };
  return { kind: "laptop", label: "Web" };
}


// ------------------------------------------------------------------
// Formatting helpers
// ------------------------------------------------------------------

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return String(value); }
}

function fmtTime(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch { return String(value); }
}


// ==================================================================
// Component
// ==================================================================
export default function MySettingsPanel() {

  return (
    <div className={styles.wrap}>

      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>Settings</h1>
          <p className={styles.headSub}>
            Manage your password, appearance, language, notification
            preferences and review recent login activity.
          </p>
        </div>
      </header>

      <DarkModeSection />
      <LanguageSection />
      <NotificationsSection />
      <LoginHistorySection />

    </div>
  );
}


// (Password change section removed — employees don't rotate their
// own password in this deployment. Admin resets via the admin app.)
// The block below is intentionally unreachable dead code to keep the
// diff small; the compiler tree-shakes it since PasswordSection is
// no longer referenced anywhere.
function _RemovedPasswordSection_UNUSED() {

  const [current, setCurrent] = useState("");
  const [next, setNext]       = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPw, setShowPw]   = useState(false);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState("");
  const [success, setSuccess] = useState("");

  // Simple client-side strength meter
  const strength = useMemo(() => {
    const p = next;
    let score = 0;
    if (!p) return { score: 0, label: "—", tone: "muted" };
    if (p.length >= 6)  score++;
    if (p.length >= 10) score++;
    if (/[A-Z]/.test(p) && /[a-z]/.test(p)) score++;
    if (/\d/.test(p))   score++;
    if (/[^A-Za-z0-9]/.test(p)) score++;
    const map = ["Very weak", "Weak", "Fair", "Good", "Strong", "Very strong"];
    const toneMap = ["red", "red", "amber", "amber", "green", "green"];
    return { score, label: map[score], tone: toneMap[score] };
  }, [next]);

  useEffect(() => {
    if (!success) return undefined;
    const id = window.setTimeout(() => setSuccess(""), 3500);
    return () => window.clearTimeout(id);
  }, [success]);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    if (!current)            { setError("Enter your current password."); return; }
    if (next.length < 6)     { setError("New password must be at least 6 characters."); return; }
    if (next !== confirm)    { setError("Confirm password doesn't match."); return; }
    if (next === current)    { setError("New password must be different from the current one."); return; }

    setSaving(true);
    try {
      await API.post("/me/change-password", {
        CURRENT_PASSWORD: current,
        NEW_PASSWORD:     next,
      });
      setSuccess("Password updated. Use your new password the next time you log in.");
      setCurrent(""); setNext(""); setConfirm("");
    } catch (err) {
      const raw = err?.response?.data?.detail;
      const msg = typeof raw === "string" && raw
        ? raw
        : Array.isArray(raw) && raw.length
          ? raw.map((e) => e?.msg || "").filter(Boolean).join(" · ")
          : "Could not update the password. Please try again.";
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      icon={I.lock}
      tone="red"
      title="Change password"
      subtitle="Use a password that's at least 6 characters, mixing letters, numbers and symbols."
    >
      <form className={styles.form} onSubmit={submit}>

        {error   && <div className={styles.error}>{error}</div>}
        {success && <div className={styles.success}>{success}</div>}

        <div className={styles.field}>
          <label className={styles.label}>Current password</label>
          <div className={styles.pwWrap}>
            <input
              type={showPw ? "text" : "password"}
              className={styles.input}
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
            <button
              type="button"
              className={styles.pwToggle}
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "Hide" : "Show"}
              tabIndex={-1}
            >
              {showPw ? I.eyeOff : I.eye}
            </button>
          </div>
        </div>

        <div className={styles.grid2}>
          <div className={styles.field}>
            <label className={styles.label}>New password</label>
            <input
              type={showPw ? "text" : "password"}
              className={styles.input}
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            {next && (
              <div className={styles.strengthWrap}>
                <div className={styles.strengthTrack}>
                  <div
                    className={`${styles.strengthFill} ${styles[`fill_${strength.tone}`]}`}
                    style={{ width: `${(strength.score / 5) * 100}%` }}
                  />
                </div>
                <div className={`${styles.strengthLabel} ${styles[`fg_${strength.tone}`]}`}>
                  {strength.label}
                </div>
              </div>
            )}
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Confirm new password</label>
            <input
              type={showPw ? "text" : "password"}
              className={styles.input}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
            />
            {confirm && next && confirm !== next && (
              <div className={styles.hint} style={{ color: "#b91c1c" }}>
                Passwords don't match yet.
              </div>
            )}
          </div>
        </div>

        <div className={styles.submitRow}>
          <button type="submit" className={styles.btnPrimary} disabled={saving}>
            {saving ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </Section>
  );
}


// ==================================================================
// 2. Dark mode
// ==================================================================
function DarkModeSection() {

  const [theme, setTheme] = useState(getLS(LS_KEYS.theme, "light"));

  useEffect(() => { applyTheme(theme); }, [theme]);

  const flip = (value) => {
    setTheme(value);
    setLS(LS_KEYS.theme, value);
    applyTheme(value);
  };

  return (
    <Section
      icon={theme === "dark" ? I.moon : I.sun}
      tone={theme === "dark" ? "amber" : "blue"}
      title="Appearance"
      subtitle="Switch between the default light theme and a dark theme for low-light work."
    >
      <div className={styles.optionRow}>
        <ThemeCard
          active={theme === "light"}
          onClick={() => flip("light")}
          icon={I.sun}
          label="Light"
          hint="Default — high contrast, best for daytime"
        />
        <ThemeCard
          active={theme === "dark"}
          onClick={() => flip("dark")}
          icon={I.moon}
          label="Dark"
          hint="Softer surfaces — best for late-evening work"
        />
      </div>
      <div className={styles.hintFoot}>
        Your preference is saved to this browser. Some pages are still
        being adapted for the dark theme — colours may look inconsistent
        until the visual refresh completes.
      </div>
    </Section>
  );
}

function ThemeCard({ active, onClick, icon, label, hint }) {
  return (
    <button
      type="button"
      className={`${styles.themeCard} ${active ? styles.themeCard_active : ""}`}
      onClick={onClick}
    >
      <span className={styles.themeCardIcon}>{icon}</span>
      <span className={styles.themeCardBody}>
        <span className={styles.themeCardLabel}>{label}</span>
        <span className={styles.themeCardHint}>{hint}</span>
      </span>
      {active && <span className={styles.themeCardCheck}>{I.check}</span>}
    </button>
  );
}


// ==================================================================
// 3. Language
// ==================================================================
function LanguageSection() {

  const [lang, setLang] = useState(getLS(LS_KEYS.language, "en"));

  const pick = (code) => {
    setLang(code);
    setLS(LS_KEYS.language, code);
  };

  return (
    <Section
      icon={I.globe}
      tone="green"
      title="Language"
      subtitle="Full multi-language support is being rolled out. English is fully supported today."
    >
      <div className={styles.langList}>
        {LANGUAGES.map((l) => (
          <button
            key={l.code}
            type="button"
            className={`${styles.langRow} ${lang === l.code ? styles.langRow_active : ""}`}
            onClick={() => pick(l.code)}
          >
            <span className={styles.langLabel}>{l.label}</span>
            {l.status === "beta" && (
              <span className={styles.langBadge}>Beta</span>
            )}
            {l.status === "active" && (
              <span className={`${styles.langBadge} ${styles.langBadge_ok}`}>Ready</span>
            )}
            {lang === l.code && (
              <span className={styles.langCheck}>{I.check}</span>
            )}
          </button>
        ))}
      </div>
    </Section>
  );
}


// ==================================================================
// 4. Notifications
// ==================================================================
function NotificationsSection() {

  const [voiceOn, setVoiceOn] = useState(isVoiceEnabled());
  const [emailDigest, setEmailDigest] = useState(
    getLS(LS_KEYS.emailDigest, "true") === "true"
  );
  const [inAppPopups, setInAppPopups] = useState(
    getLS(LS_KEYS.inAppPopups, "true") === "true"
  );

  const voiceSupported = isVoiceSupported();

  const toggleVoice = () => {
    const next = !voiceOn;
    setVoiceOn(next);
    setVoiceEnabled(next);
    if (!next) stopSpeaking();
  };

  const toggleEmail = () => {
    const next = !emailDigest;
    setEmailDigest(next);
    setLS(LS_KEYS.emailDigest, next ? "true" : "false");
  };

  const toggleInApp = () => {
    const next = !inAppPopups;
    setInAppPopups(next);
    setLS(LS_KEYS.inAppPopups, next ? "true" : "false");
  };

  return (
    <Section
      icon={I.bell}
      tone="amber"
      title="Notifications"
      subtitle="Choose how you want to hear from the ERP — voice alerts, email digests, in-app popups."
    >
      <div className={styles.toggleList}>
        <ToggleRow
          title="Voice alerts"
          hint={
            voiceSupported
              ? "Read critical alerts aloud using your browser's speech synthesis."
              : "Your browser doesn't support speech synthesis, so voice alerts are unavailable here."
          }
          checked={voiceOn && voiceSupported}
          disabled={!voiceSupported}
          onChange={toggleVoice}
        />
        <ToggleRow
          title="Email digest"
          hint="Get a daily rollup of your leave status, tasks and payslip changes to your registered email."
          checked={emailDigest}
          onChange={toggleEmail}
        />
        <ToggleRow
          title="In-app popups"
          hint="Show toasts inside the ERP when a task updates, memo lands, or a leave request is approved."
          checked={inAppPopups}
          onChange={toggleInApp}
        />
      </div>
    </Section>
  );
}


function ToggleRow({ title, hint, checked, onChange, disabled }) {
  return (
    <label className={`${styles.toggleRow} ${disabled ? styles.toggleRow_disabled : ""}`}>
      <span className={styles.toggleBody}>
        <span className={styles.toggleTitle}>{title}</span>
        <span className={styles.toggleHint}>{hint}</span>
      </span>
      <span className={`${styles.toggle} ${checked ? styles.toggle_on : ""}`}>
        <input
          type="checkbox"
          checked={!!checked}
          disabled={disabled}
          onChange={onChange}
          className={styles.toggleInput}
        />
        <span className={styles.toggleThumb} />
      </span>
    </label>
  );
}


// ==================================================================
// 5. Device login history
// ==================================================================
function LoginHistorySection() {

  const [rows, setRows]     = useState([]);
  const [loading, setLoad]  = useState(true);
  const [error, setError]   = useState("");

  const load = useCallback(async () => {
    setLoad(true);
    setError("");
    try {
      const res = await API.get("/me/login-history?days=60");
      setRows(Array.isArray(res.data?.history) ? res.data.history : []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load login history.");
    } finally {
      setLoad(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  return (
    <Section
      icon={I.device}
      tone="blue"
      title="Device login history"
      subtitle="Where and when you've been active recently. Anything that doesn't look like you? Change your password immediately."
    >
      {loading && (
        <div className={styles.loading}>Loading history…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className={styles.empty}>
          No login activity recorded in the last 60 days.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className={styles.historyList}>
          {rows.map((r) => {
            const dev = sniffDevice(r.device_info);
            const status = (r.status || "").toUpperCase();
            const statusClass = status === "PRESENT" || status === "CHECKED_IN"
              ? "chip_success"
              : status === "LATE"
                ? "chip_warn"
                : status === "ABSENT"
                  ? "chip_danger"
                  : "chip_muted";
            return (
              <li key={r.id} className={styles.historyRow}>
                <span className={`${styles.deviceIcon} ${styles[`tint_${dev.kind}`]}`}>
                  {dev.kind === "phone" ? I.phone
                    : dev.kind === "device" ? I.device
                    : I.laptop}
                </span>
                <div className={styles.historyBody}>
                  <div className={styles.historyTitle}>
                    {fmtDate(r.date)}
                    <span className={styles.historyTime}>
                      {r.check_in ? `· ${fmtTime(r.check_in)}` : ""}
                    </span>
                  </div>
                  <div className={styles.historyMeta}>
                    <span className={styles.deviceLabel}>{dev.label}</span>
                    {r.device_info && (
                      <>
                        <span className={styles.dot}>·</span>
                        <span className={styles.deviceInfo} title={r.device_info}>
                          {r.device_info}
                        </span>
                      </>
                    )}
                    {r.late_minutes > 0 && (
                      <>
                        <span className={styles.dot}>·</span>
                        <span className={styles.lateNote}>
                          Late by {r.late_minutes}m
                        </span>
                      </>
                    )}
                  </div>
                </div>
                <span className={`${styles.chip} ${styles[statusClass]}`}>
                  {status ? status.replace(/_/g, " ") : "—"}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}


// ==================================================================
// Section wrapper — shared shell for all five settings groups
// ==================================================================
function Section({ icon, tone, title, subtitle, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={`${styles.sectionIcon} ${styles[`tint_${tone}`]}`}>
          {icon}
        </span>
        <div>
          <h2 className={styles.sectionTitle}>{title}</h2>
          <p className={styles.sectionSub}>{subtitle}</p>
        </div>
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}
