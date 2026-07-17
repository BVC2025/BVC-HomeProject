// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// A deliberately quiet landing page. All modules already have their
// own homes in the side menu, so this page is a welcome band + a
// friendly nudge pointing at the menu instead of a wall of KPIs the
// employee doesn't need at 9am.
//
// Reads:
//   • employee_name / employee_photo / employee_code / department
//     from localStorage (populated at login)
//   • loginTime (raw ISO from the login response) + attendanceStatus
//     as props from EmployeeDashboard
//   • optional portal.employee.PHOTO_URL as fallback if the photo
//     wasn't cached in localStorage yet
//
// Emits:
//   • onOpenMenu() when the "Open menu" CTA is tapped on mobile —
//     wired to setSidebarOpen(true) by the parent so the drawer opens.
// =====================================================================

import { useMemo } from "react";

import { API_BASE_URL } from "../services/api";
import styles from "./EmployeeHomeDashboard.module.css";


// ------------------------------------------------------------------
// Time formatting — the login response gives us an ISO string like
// "2026-07-17T10:03:25.040Z". Show it as "10:03 AM" instead.
// ------------------------------------------------------------------
function formatCheckIn(value) {
  if (!value) return "";
  try {
    const d = new Date(value);
    if (isNaN(d.getTime())) return String(value);
    return d.toLocaleTimeString("en-IN", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return String(value);
  }
}


// ------------------------------------------------------------------
// Attendance status → visual tone. `PRESENT` is green, `LATE` amber,
// `ABSENT` red, `ON_LEAVE` blue, empty = neutral grey.
// ------------------------------------------------------------------
function statusInfo(raw) {
  const s = (raw || "").toUpperCase();
  if (s === "PRESENT" || s === "CHECKED_IN") {
    return { tone: "success", label: "Present" };
  }
  if (s === "LATE") return { tone: "warning", label: "Late" };
  if (s === "ABSENT") return { tone: "danger", label: "Absent" };
  if (s === "ON_LEAVE" || s === "LEAVE") return { tone: "info", label: "On leave" };
  if (!s) return { tone: "muted", label: "Not checked in" };
  return {
    tone: "muted",
    label: s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
  };
}


export default function EmployeeHomeDashboard({
  portal,
  attendanceStatus,
  loginTime,
  onOpenMenu,
}) {

  // ---- Identity ----
  const identity = useMemo(() => {
    const name = (localStorage.getItem("employee_name") || "there").trim();
    const first = name.split(/\s+/)[0];
    // Photo cached at profile upload; fall back to portal payload
    // in case the upload happened in a different browser session.
    const cachedPhoto = localStorage.getItem("employee_photo") || "";
    const portalPhoto = portal?.employee?.PHOTO_URL
                     || portal?.PHOTO_URL
                     || "";
    const photo = cachedPhoto || portalPhoto;
    const dept  = localStorage.getItem("employee_department")
               || localStorage.getItem("department") || "";
    const desig = localStorage.getItem("employee_designation") || "";
    const code  = localStorage.getItem("employee_code")
               || localStorage.getItem("employee_id") || "";
    return { name, first, photo, dept, desig, code };
  }, [portal]);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
        ? identity.photo
        : `${API_BASE_URL}${identity.photo}`)
    : null;

  // ---- Today's date, status, check-in ----
  const dateLabel = new Date().toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const status = statusInfo(attendanceStatus);
  const checkInText = formatCheckIn(loginTime);

  const subtitle = [identity.desig, identity.dept, identity.code]
    .filter(Boolean)
    .join(" · ") || "Employee";

  return (
    <div className={styles.home}>

      {/* ============ WELCOME BAND ============ */}
      <section className={styles.hero}>
        <div className={styles.heroAvatar}>
          {photoUrl
            ? <img src={photoUrl} alt="" />
            : <span>{(identity.first || "?").charAt(0).toUpperCase()}</span>}
        </div>

        <div className={styles.heroText}>
          <div className={styles.heroDate}>{dateLabel}</div>
          <h1 className={styles.heroTitle}>
            Welcome back, {identity.first}
          </h1>
          <div className={styles.heroSubtitle}>{subtitle}</div>

          <div className={styles.heroFooter}>
            <span className={`${styles.pill} ${styles[`pill_${status.tone}`]}`}>
              <span className={styles.pillDot} />
              {status.label}
            </span>
            {checkInText && (
              <span className={styles.checkin}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round"
                     aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                Check-in {checkInText}
              </span>
            )}
          </div>
        </div>
      </section>

      {/* ============ MENU NUDGE ============ */}
      {/* All modules live in the side menu; this card tells first-time
          employees where to go instead of dumping a KPI grid on them. */}
      <section className={styles.callout}>

        <div className={styles.calloutArt} aria-hidden="true">
          {/* Soft red halo */}
          <span className={styles.halo} />

          {/* Friendly mascot — round face + waving hand, pure SVG.
              The whole group is styled to gently wave. */}
          <svg
            className={styles.mascot}
            viewBox="0 0 200 200"
            width="200" height="200"
            role="img"
          >
            {/* Body */}
            <ellipse cx="100" cy="170" rx="60" ry="16" fill="#fecaca" opacity="0.5" />
            <path d="M60 150 Q60 110 100 110 Q140 110 140 150 L140 170 L60 170 Z"
                  fill="#ef4444" />
            {/* Head */}
            <circle cx="100" cy="80" r="34" fill="#fca5a5" stroke="#ef4444" strokeWidth="2" />
            {/* Eyes */}
            <circle cx="88"  cy="78" r="3" fill="#0f172a" />
            <circle cx="112" cy="78" r="3" fill="#0f172a" />
            {/* Smile */}
            <path d="M87 92 Q100 102 113 92" stroke="#0f172a" strokeWidth="2.4"
                  fill="none" strokeLinecap="round" />
            {/* Cheek blush */}
            <circle cx="82"  cy="90" r="3" fill="#f87171" opacity="0.6" />
            <circle cx="118" cy="90" r="3" fill="#f87171" opacity="0.6" />
            {/* Waving arm (this group animates) */}
            <g className={styles.wavingArm}>
              <path d="M138 130 L168 100 L172 108 L146 138 Z" fill="#ef4444" />
              <circle cx="170" cy="102" r="10" fill="#fca5a5" stroke="#ef4444" strokeWidth="2" />
            </g>
          </svg>

          {/* Animated left-pointing arrow — draws the eye toward the
              hamburger / sidebar. */}
          <svg
            className={styles.pointer}
            viewBox="0 0 80 40"
            width="80" height="40"
            aria-hidden="true"
          >
            <path d="M75 20 H12" stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round" fill="none" />
            <path d="M20 10 L8 20 L20 30" stroke="currentColor" strokeWidth="3"
                  strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
        </div>

        <div className={styles.calloutText}>
          <h2 className={styles.calloutTitle}>
            Everything you need is in the side menu.
          </h2>
          <p className={styles.calloutBody}>
            Attendance, leave, payslips, tasks, allowances, memos and
            more — pick a module from the menu to get started.
          </p>

          {onOpenMenu && (
            <button
              type="button"
              className={styles.calloutBtn}
              onClick={onOpenMenu}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round"
                   aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
              Open Menu
            </button>
          )}
        </div>
      </section>

    </div>
  );
}
