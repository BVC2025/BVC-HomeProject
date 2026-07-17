// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// A deliberately quiet landing page. Every module lives in the side
// menu, so the home is a welcome band + a friendly animated mascot
// that peeks in from the left, jumps into view, and hands the user
// the "Open Menu" button.
//
// Motion: framer-motion (already in package.json). All animation is
// declarative — no useEffect timers, so it can't leak. A
// prefers-reduced-motion guard collapses everything to a static pose.
// =====================================================================

import { useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

import { API_BASE_URL } from "../services/api";
import styles from "./EmployeeHomeDashboard.module.css";


// ------------------------------------------------------------------
// Utilities
// ------------------------------------------------------------------

// The login response gives us an ISO string like
// "2026-07-17T10:03:25.040Z". Show it as "10:03 AM" instead.
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

// localStorage.setItem(...) coerces `null` to the STRING "null", so a
// naive filter(Boolean) would leave it in and the subtitle reads
// "null · BVC008". Strip those two literal strings here.
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
// Mascot — an original friendly character. Round head, red suit,
// tie, two little arms; one arm extends toward the "Open Menu"
// button so the character reads as pointing at it. Pure SVG so it
// scales cleanly and inherits currentColor.
// ------------------------------------------------------------------
function Mascot({ waving, wavingArm }) {
  return (
    <svg viewBox="0 0 240 260" width="220" height="240" role="img"
         aria-label="BVC helper mascot">
      {/* Ground shadow */}
      <ellipse cx="120" cy="242" rx="66" ry="9"
               fill="#0f172a" opacity="0.10" />

      {/* Body — rounded shield shape */}
      <path d="M62 148
               Q62 118 90 108
               Q120 100 150 108
               Q178 118 178 148
               L178 220
               Q178 236 162 236
               L78 236
               Q62 236 62 220 Z"
            fill="#ef4444" />

      {/* Tie — subtle formal touch */}
      <path d="M114 108 L126 108 L130 128 L122 148 L118 148 L110 128 Z"
            fill="#facc15" />
      <rect x="116" y="102" width="8" height="10" rx="2" fill="#dc2626" />

      {/* Left arm — resting */}
      <path d="M62 152 Q40 158 42 190 Q44 208 60 200 L74 178 Z"
            fill="#ef4444" />
      <circle cx="46" cy="200" r="12" fill="#fecaca" stroke="#dc2626" strokeWidth="2" />

      {/* Right arm — this is the one that waves / points. We wrap
          the group in a motion.g at render time so it can be
          animated independently of the body. */}
      {wavingArm}

      {/* Head */}
      <g>
        {/* Hair / cap band */}
        <path d="M76 74 Q76 40 120 40 Q164 40 164 74 L164 82 L76 82 Z"
              fill="#7f1d1d" />
        {/* Face */}
        <circle cx="120" cy="76" r="38" fill="#fee2e2"
                stroke="#dc2626" strokeWidth="2" />
        {/* Cheek blush */}
        <circle cx="94"  cy="90" r="4" fill="#fca5a5" opacity="0.75" />
        <circle cx="146" cy="90" r="4" fill="#fca5a5" opacity="0.75" />
        {/* Eyes — round with tiny highlights, blink via CSS */}
        <g className={styles.eyes}>
          <circle cx="106" cy="76" r="4" fill="#0f172a" />
          <circle cx="134" cy="76" r="4" fill="#0f172a" />
          <circle cx="107" cy="75" r="1.2" fill="#ffffff" />
          <circle cx="135" cy="75" r="1.2" fill="#ffffff" />
        </g>
        {/* Smile — bigger when waving */}
        <path d={waving
                 ? "M104 92 Q120 108 136 92"
                 : "M106 92 Q120 102 134 92"}
              stroke="#0f172a" strokeWidth="2.6"
              fill="none" strokeLinecap="round" />
      </g>
    </svg>
  );
}


// ------------------------------------------------------------------
// Component
// ------------------------------------------------------------------
export default function EmployeeHomeDashboard({
  portal,
  attendanceStatus,
  loginTime,
  onOpenMenu,
}) {

  const reduce = useReducedMotion();
  const [clicked, setClicked] = useState(false);

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

  // ---- Menu-open sequence ----
  // Character does a happy jump, then we open the drawer. If the
  // user has reduced-motion enabled, skip the delay and open at once.
  const handleOpen = () => {
    if (reduce) {
      onOpenMenu?.();
      return;
    }
    setClicked(true);
    window.setTimeout(() => {
      setClicked(false);
      onOpenMenu?.();
    }, 380);
  };

  // ---- Motion variants ----
  // Character enters from the left edge (peek → jump-in) then holds
  // an idle bob. `happy` fires on button click.
  const bodyVariants = {
    hidden:  { x: -220, y: 20, rotate: -14, opacity: 0 },
    peek:    { x: -110, y: 10, rotate:  -6, opacity: 1,
               transition: { duration: 0.5, ease: "easeOut" } },
    enter:   { x: 0,    y: 0,  rotate:   0, opacity: 1,
               transition: { type: "spring", stiffness: 140, damping: 11, delay: 0.5 } },
    idle:    { y: [0, -6, 0],
               transition: { duration: 3.2, repeat: Infinity, ease: "easeInOut", delay: 1.2 } },
    happy:   { y: -22, rotate: 4,
               transition: { type: "spring", stiffness: 300, damping: 10 } },
  };

  // Right arm waves during idle, then reaches up during the click
  // reaction. transform-origin set on the g so it pivots at shoulder.
  const armVariants = {
    idle: reduce
      ? { rotate: 0 }
      : { rotate: [0, -18, -4, -14, 0],
          transition: { duration: 1.8, repeat: Infinity, ease: "easeInOut", delay: 1.4 } },
    happy: { rotate: -40,
             transition: { type: "spring", stiffness: 260, damping: 12 } },
  };

  // The "Open Menu" button pops in AFTER the character lands, and
  // gently pulses to invite the click.
  const buttonVariants = {
    hidden: { scale: 0.6, opacity: 0, y: 10 },
    show:   { scale: 1,   opacity: 1, y: 0,
              transition: { delay: 1.15, type: "spring", stiffness: 220, damping: 14 } },
    pulse:  { boxShadow: [
                "0 6px 18px rgba(220,38,38,0.30)",
                "0 12px 28px rgba(220,38,38,0.50)",
                "0 6px 18px rgba(220,38,38,0.30)",
              ],
              transition: { duration: 2.2, repeat: Infinity, ease: "easeInOut", delay: 1.6 } },
  };

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
          <h1 className={styles.heroTitle}>Welcome back, {identity.first}</h1>
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

      {/* ============ MASCOT + MENU NUDGE ============ */}
      <section className={styles.callout}>

        <div className={styles.stage} aria-hidden="true">
          {/* Soft red halo behind the character */}
          <motion.span
            className={styles.halo}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: [1, 1.08, 1], opacity: [0.9, 1, 0.9] }}
            transition={reduce
              ? { duration: 0 }
              : { duration: 3.5, repeat: Infinity, ease: "easeInOut" }}
          />

          {/* Ground puff cloud — reveal after the jump-in landing */}
          <motion.span
            className={styles.dust}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.15, 0], opacity: [0, 0.6, 0] }}
            transition={reduce
              ? { duration: 0 }
              : { duration: 0.65, delay: 0.9, ease: "easeOut" }}
          />

          {/* Character body — peek, jump-in, idle. `clicked` swaps to happy. */}
          <motion.div
            className={styles.mascotWrap}
            variants={bodyVariants}
            initial="hidden"
            animate={reduce
              ? "enter"
              : (clicked ? "happy" : ["peek", "enter", "idle"])}
          >
            <Mascot
              waving={!clicked}
              wavingArm={
                <motion.g
                  style={{ transformOrigin: "178px 152px", transformBox: "fill-box" }}
                  variants={armVariants}
                  animate={clicked ? "happy" : "idle"}
                >
                  <path d="M178 150 Q206 152 208 128 Q210 108 194 108 L182 138 Z"
                        fill="#ef4444" />
                  <circle cx="200" cy="118" r="12"
                          fill="#fecaca" stroke="#dc2626" strokeWidth="2" />
                </motion.g>
              }
            />
          </motion.div>
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
            <motion.button
              type="button"
              className={styles.calloutBtn}
              variants={buttonVariants}
              initial="hidden"
              animate={reduce ? "show" : ["show", "pulse"]}
              whileHover={{ scale: 1.03 }}
              whileTap={{ scale: 0.97 }}
              onClick={handleOpen}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round"
                   aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
              Open Menu
            </motion.button>
          )}
        </div>
      </section>

    </div>
  );
}
