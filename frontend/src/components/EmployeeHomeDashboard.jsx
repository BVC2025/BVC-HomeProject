// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// Clean, Zoho People-style landing. No mascot, no cartoon anything —
// just a professional welcome card + a minimal "here's how to
// navigate" panel. Every module lives in the side menu.
//
// Content only, no ornamentation. Framer-motion is used solely for
// a subtle fade/rise on first paint; everything else is static.
// =====================================================================

import { useMemo } from "react";
import { motion } from "framer-motion";

import { API_BASE_URL } from "../services/api";
import styles from "./EmployeeHomeDashboard.module.css";


// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

function formatCheckIn(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit", minute: "2-digit", hour12: true,
    });
  } catch {
    return String(value);
  }
}

// localStorage.setItem coerces `null` to the STRING "null", so a
// naive filter(Boolean) leaves it in and subtitles read "null · X".
function clean(v) {
  const s = (v || "").trim();
  if (!s || s === "null" || s === "undefined") return "";
  return s;
}

function statusInfo(raw) {
  const s = (raw || "").toUpperCase();
  if (s === "PRESENT" || s === "CHECKED_IN") return { tone: "success", label: "Present" };
  if (s === "LATE")                           return { tone: "warning", label: "Late" };
  if (s === "ABSENT")                         return { tone: "danger",  label: "Absent" };
  if (s === "ON_LEAVE" || s === "LEAVE")      return { tone: "info",    label: "On leave" };
  if (!s)                                     return { tone: "muted",   label: "Not checked in" };
  return {
    tone: "muted",
    label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}


// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------

export default function EmployeeHomeDashboard({
  portal,
  attendanceStatus,
  loginTime,
}) {

  // ---- Identity ----
  const identity = useMemo(() => {
    const name  = clean(localStorage.getItem("employee_name")) || "there";
    const first = name.split(/\s+/)[0];
    const cachedPhoto = clean(localStorage.getItem("employee_photo"));
    const portalPhoto = portal?.employee?.PHOTO_URL
                     || portal?.PHOTO_URL
                     || "";
    const photo = cachedPhoto || portalPhoto;
    const dept  = clean(localStorage.getItem("employee_department"))
               || clean(localStorage.getItem("department"));
    const desig = clean(localStorage.getItem("employee_designation"));
    const code  = clean(localStorage.getItem("employee_code"))
               || clean(localStorage.getItem("employee_id"));
    return { name, first, photo, dept, desig, code };
  }, [portal]);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
        ? identity.photo
        : `${API_BASE_URL}${identity.photo}`)
    : null;

  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const status = statusInfo(attendanceStatus);
  const checkInText = formatCheckIn(loginTime);

  const subtitle = [identity.desig, identity.dept, identity.code]
    .filter(Boolean)
    .join(" · ") || "Employee";

  // Subtle rise-and-fade on mount, nothing more.
  const rise = {
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.35, ease: "easeOut" },
  };

  return (
    <div className={styles.home}>

      {/* ============ WELCOME CARD ============ */}
      <motion.section className={styles.welcome} {...rise}>

        <div className={styles.welcomeMain}>
          <div className={styles.avatar}>
            {photoUrl
              ? <img src={photoUrl} alt="" />
              : <span>{(identity.first || "?").charAt(0).toUpperCase()}</span>}
          </div>

          <div className={styles.welcomeText}>
            <div className={styles.welcomeDate}>{dateLabel}</div>
            <h1 className={styles.welcomeTitle}>
              Welcome back, <span>{identity.first}</span>
            </h1>
            <div className={styles.welcomeSubtitle}>{subtitle}</div>
          </div>
        </div>

        <div className={styles.welcomeMeta}>
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Status</span>
            <span className={`${styles.chip} ${styles[`chip_${status.tone}`]}`}>
              <span className={styles.chipDot} />
              {status.label}
            </span>
          </div>

          {checkInText && (
            <div className={styles.metaItem}>
              <span className={styles.metaLabel}>Check-in</span>
              <span className={styles.metaValue}>{checkInText}</span>
            </div>
          )}
        </div>
      </motion.section>

    </div>
  );
}
