// =====================================================================
// EmployeeHomeDashboard
// ---------------------------------------------------------------------
// A quiet welcome page — every module lives in the side menu, so the
// home is just a welcome band + an animated original mascot that
// walks in from the left, stops in a "ta-da" pose, and presents the
// "Open Menu" button.
//
// The mascot is an ORIGINAL character — kerchief-hooded folk-style
// girl in BVC red + gold + white. Deliberately not modeled on any
// existing character; safe for commercial use.
//
// Motion: framer-motion. All animation is variant-driven, so the
// phase state ("walking" → "posing" → "idle" → "happy") propagates
// through the SVG tree without prop-drilling. A reduced-motion guard
// collapses the entire walk-in and starts at the idle pose.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";

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

// localStorage.setItem coerces `null` to the STRING "null", so a naive
// filter(Boolean) leaves that in. Strip literal null/undefined here.
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


// ==================================================================
// MASCOT — original kerchief-hooded folk girl. Colors follow BVC's
// red + white + gold brand so she reads as "our mascot", not "a
// generic cartoon". Layered bottom-to-top so the head paints over
// the collar cleanly.
// ==================================================================

function Mascot({ armLeftV, armRightV, legLeftV, legRightV }) {
  return (
    <svg viewBox="0 0 260 340" width="240" height="300" role="img"
         aria-label="BVC helper mascot">

      {/* Ground shadow */}
      <ellipse cx="130" cy="328" rx="60" ry="7"
               fill="#0f172a" opacity="0.14" />

      {/* ---------- LEGS ---------- */}
      {/* Each leg pivots at the hip; walk cycle swings them
          opposite to each other. Boots in BVC red. */}
      <motion.g
        variants={legLeftV}
        style={{ transformOrigin: "108px 232px", transformBox: "fill-box" }}
      >
        {/* leg (skin tone) */}
        <path d="M104 232 Q102 270 100 300"
              stroke="#fbcfe8" strokeWidth="16"
              strokeLinecap="round" fill="none" />
        {/* boot */}
        <path d="M88 300 L112 300 L116 320 L86 320 Z" fill="#7f1d1d" />
        <ellipse cx="101" cy="320" rx="16" ry="4" fill="#450a0a" />
      </motion.g>

      <motion.g
        variants={legRightV}
        style={{ transformOrigin: "152px 232px", transformBox: "fill-box" }}
      >
        <path d="M156 232 Q158 270 160 300"
              stroke="#fbcfe8" strokeWidth="16"
              strokeLinecap="round" fill="none" />
        <path d="M148 300 L172 300 L174 320 L144 320 Z" fill="#7f1d1d" />
        <ellipse cx="159" cy="320" rx="16" ry="4" fill="#450a0a" />
      </motion.g>


      {/* ---------- DRESS ---------- */}
      {/* Bell-shaped skirt in BVC red with white polka dots and a
          gold border trim at the hem — folk-style, not Masha-style. */}
      <path d="M78 195
               Q64 258 96 268
               L164 268
               Q196 258 182 195
               Q168 178 130 178
               Q92 178 78 195 Z"
            fill="#dc2626" />

      {/* Gold hem trim */}
      <path d="M96 268 L164 268"
            stroke="#facc15" strokeWidth="6"
            fill="none" strokeLinecap="round" />
      {/* Little diamond pattern in the gold trim — differentiates
          from Masha's plain gold band */}
      <g fill="#dc2626" opacity="0.55">
        <path d="M108 268 l4 -3 l4 3 l-4 3 z" />
        <path d="M128 268 l4 -3 l4 3 l-4 3 z" />
        <path d="M148 268 l4 -3 l4 3 l-4 3 z" />
      </g>

      {/* Polka dots on the dress */}
      <g fill="#ffffff">
        <circle cx="102" cy="212" r="6" />
        <circle cx="146" cy="204" r="6" />
        <circle cx="122" cy="236" r="6" />
        <circle cx="164" cy="230" r="5" />
        <circle cx="88"  cy="248" r="5" />
        <circle cx="140" cy="256" r="5" />
      </g>


      {/* ---------- LEFT ARM ---------- */}
      {/* Swings during walk, drops during pose, waves during idle. */}
      <motion.g
        variants={armLeftV}
        style={{ transformOrigin: "84px 188px", transformBox: "fill-box" }}
      >
        <path d="M84 188 Q60 210 52 232"
              stroke="#fbcfe8" strokeWidth="14"
              strokeLinecap="round" fill="none" />
        <circle cx="52" cy="236" r="10"
                fill="#fbcfe8" stroke="#be185d" strokeWidth="1.6" />
      </motion.g>


      {/* ---------- RIGHT ARM ---------- */}
      {/* Opposite swing during walk. In pose, extends outward toward
          the button — the "here it is!" gesture. */}
      <motion.g
        variants={armRightV}
        style={{ transformOrigin: "176px 188px", transformBox: "fill-box" }}
      >
        <path d="M176 188 Q200 210 208 232"
              stroke="#fbcfe8" strokeWidth="14"
              strokeLinecap="round" fill="none" />
        <circle cx="208" cy="236" r="10"
                fill="#fbcfe8" stroke="#be185d" strokeWidth="1.6" />
      </motion.g>


      {/* ---------- HEAD ---------- */}

      {/* Face — round, warm skin tone with a soft outline */}
      <circle cx="130" cy="108" r="54"
              fill="#ffe4e6" stroke="#f9a8d4" strokeWidth="2" />

      {/* Hair — golden bangs peeking from under the kerchief. Kept
          asymmetric and choppy so it doesn't read as Masha's neat
          center-parted bob. */}
      <path d="M84 92
               Q90 74 108 74
               L108 96
               Q98 96 84 92 Z"
            fill="#f59e0b" />
      <path d="M108 74 Q118 66 126 76 L118 96 Q112 96 108 96 Z"
            fill="#facc15" />
      <path d="M126 76 Q136 68 148 78 L142 96 Q132 96 126 96 Z"
            fill="#f59e0b" />
      <path d="M148 78 Q160 74 170 88 L166 100 Q156 100 148 100 Z"
            fill="#facc15" />

      {/* Freckles across the nose */}
      <g fill="#c2410c" opacity="0.6">
        <circle cx="118" cy="118" r="1.4" />
        <circle cx="124" cy="121" r="1.2" />
        <circle cx="130" cy="118" r="1.4" />
        <circle cx="136" cy="121" r="1.2" />
        <circle cx="142" cy="118" r="1.4" />
      </g>

      {/* Cheek blush */}
      <ellipse cx="98"  cy="120" rx="9" ry="5" fill="#fda4af" opacity="0.7" />
      <ellipse cx="162" cy="120" rx="9" ry="5" fill="#fda4af" opacity="0.7" />

      {/* Eyes — tall ovals, green iris with a highlight sparkle */}
      <g className={styles.eyes}>
        <ellipse cx="112" cy="104" rx="9"  ry="12" fill="#ffffff" />
        <ellipse cx="148" cy="104" rx="9"  ry="12" fill="#ffffff" />
        <circle  cx="112" cy="106" r="7"   fill="#065f46" />
        <circle  cx="148" cy="106" r="7"   fill="#065f46" />
        <circle  cx="112" cy="107" r="3.5" fill="#0f172a" />
        <circle  cx="148" cy="107" r="3.5" fill="#0f172a" />
        <circle  cx="114" cy="103" r="2"   fill="#ffffff" />
        <circle  cx="150" cy="103" r="2"   fill="#ffffff" />
      </g>

      {/* Nose — tiny curve */}
      <path d="M128 128 Q130 132 132 128"
            stroke="#be185d" strokeWidth="1.6"
            fill="none" strokeLinecap="round" />

      {/* Smile */}
      <path d="M114 138 Q130 152 146 138"
            stroke="#be185d" strokeWidth="2.6"
            fill="#f9a8d4" strokeLinecap="round" />


      {/* ---------- KERCHIEF ---------- */}
      {/* Sits high on the head, wraps around, tied on TOP with two
          bunny-ear tips — different from Masha's chin-tie. Red with
          white polka dots + a gold hem line matching the dress. */}
      <path d="M76 116
               Q66 44 130 42
               Q194 44 184 116
               Q182 132 172 138
               L88 138
               Q78 132 76 116 Z"
            fill="#dc2626" />

      {/* Kerchief top-knot ears */}
      <path d="M108 48 Q100 26 88 30 Q92 44 108 52 Z"  fill="#dc2626" />
      <path d="M152 48 Q160 26 172 30 Q168 44 152 52 Z" fill="#dc2626" />

      {/* Polka dots on the kerchief */}
      <g fill="#ffffff">
        <circle cx="92"  cy="76"  r="5" />
        <circle cx="118" cy="60"  r="5" />
        <circle cx="146" cy="60"  r="5" />
        <circle cx="170" cy="76"  r="5" />
        <circle cx="80"  cy="106" r="4" />
        <circle cx="180" cy="106" r="4" />
        <circle cx="102" cy="130" r="4" />
        <circle cx="158" cy="130" r="4" />
        {/* Dots on the ears */}
        <circle cx="96"  cy="42"  r="3" />
        <circle cx="164" cy="42"  r="3" />
      </g>

      {/* Gold rim along the front edge of the kerchief */}
      <path d="M78 130 Q130 148 182 130"
            stroke="#facc15" strokeWidth="3"
            fill="none" strokeLinecap="round" />
    </svg>
  );
}


// ==================================================================
// Component
// ==================================================================

export default function EmployeeHomeDashboard({
  portal,
  attendanceStatus,
  loginTime,
  onOpenMenu,
}) {

  const reduce = useReducedMotion();

  // ---- Phase state ----
  //   "walking" → mascot strides in from off-screen left
  //   "posing"  → mascot lands center, arms out (ta-da)
  //   "idle"    → gentle bob + subtle arm sway
  //   "happy"   → click reaction: hop with arms up
  const initialPhase = reduce ? "idle" : "walking";
  const [phase, setPhase] = useState(initialPhase);

  useEffect(() => {
    if (reduce) return;
    const t1 = window.setTimeout(() => setPhase("posing"), 1650);
    const t2 = window.setTimeout(() => setPhase("idle"),   2050);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [reduce]);

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

  const handleOpen = () => {
    if (reduce) {
      onOpenMenu?.();
      return;
    }
    setPhase("happy");
    window.setTimeout(() => {
      setPhase("idle");
      onOpenMenu?.();
    }, 420);
  };


  // ---- Variants ----
  // Container translates x during walk-in, then bobs during idle,
  // hops during happy. Children (arms, legs) declare their own
  // matching variants so a single `animate={phase}` on the parent
  // propagates through the entire mascot.
  const containerV = {
    walking: {
      x: [-320, 0],
      transition: { duration: 1.6, ease: "linear" },
    },
    posing: {
      x: 0,
      transition: { duration: 0.3 },
    },
    idle: {
      x: 0,
      y: [0, -4, 0],
      transition: { y: { duration: 3.2, repeat: Infinity, ease: "easeInOut" } },
    },
    happy: {
      x: 0,
      y: -28,
      transition: { type: "spring", stiffness: 400, damping: 10 },
    },
  };

  // Legs swing opposite to each other during walk. Frozen at 0 in
  // pose/idle. Splayed slightly during happy hop for a landing feel.
  const legLeftV = {
    walking: { rotate: [15, -15, 15],
               transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" } },
    posing:  { rotate: 0, transition: { duration: 0.25 } },
    idle:    { rotate: 0 },
    happy:   { rotate: 18, transition: { type: "spring", stiffness: 260, damping: 10 } },
  };
  const legRightV = {
    walking: { rotate: [-15, 15, -15],
               transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" } },
    posing:  { rotate: 0, transition: { duration: 0.25 } },
    idle:    { rotate: 0 },
    happy:   { rotate: -18, transition: { type: "spring", stiffness: 260, damping: 10 } },
  };

  // Arms swing while walking (opposite phase to same-side leg), then
  // raise into a "ta-da" pose. Small sway during idle. Full raise on
  // happy hop.
  const armLeftV = {
    walking: { rotate: [-15, 15, -15],
               transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" } },
    posing:  { rotate: -40,
               transition: { type: "spring", stiffness: 220, damping: 12 } },
    idle:    { rotate: [-40, -32, -40],
               transition: { duration: 3, repeat: Infinity, ease: "easeInOut" } },
    happy:   { rotate: -75,
               transition: { type: "spring", stiffness: 260, damping: 10 } },
  };
  const armRightV = {
    walking: { rotate: [15, -15, 15],
               transition: { duration: 0.5, repeat: Infinity, ease: "easeInOut" } },
    posing:  { rotate: 40,
               transition: { type: "spring", stiffness: 220, damping: 12 } },
    idle:    { rotate: [40, 32, 40],
               transition: { duration: 3, repeat: Infinity, ease: "easeInOut" } },
    happy:   { rotate: 75,
               transition: { type: "spring", stiffness: 260, damping: 10 } },
  };

  // Button pops into view AFTER the character finishes posing.
  const buttonV = {
    hidden: { scale: 0.5, opacity: 0, y: 12 },
    show:   { scale: 1, opacity: 1, y: 0,
              transition: { delay: reduce ? 0 : 2.15,
                            type: "spring", stiffness: 240, damping: 14 } },
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
          {/* Soft red halo */}
          <motion.span
            className={styles.halo}
            initial={{ scale: 0.4, opacity: 0 }}
            animate={reduce
              ? { scale: 1, opacity: 1 }
              : { scale: [1, 1.06, 1], opacity: [0.85, 1, 0.85] }}
            transition={reduce
              ? { duration: 0 }
              : { duration: 3.5, repeat: Infinity, ease: "easeInOut", delay: 1.8 }}
          />

          {/* Landing dust puff — fires once when she stops */}
          <motion.span
            className={styles.dust}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.2, 0], opacity: [0, 0.55, 0] }}
            transition={reduce
              ? { duration: 0 }
              : { duration: 0.7, delay: 1.55, ease: "easeOut" }}
          />

          {/* Character */}
          <motion.div
            className={styles.mascotWrap}
            variants={containerV}
            initial={reduce ? "idle" : "walking"}
            animate={phase}
          >
            <Mascot
              armLeftV={armLeftV}
              armRightV={armRightV}
              legLeftV={legLeftV}
              legRightV={legRightV}
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
              variants={buttonV}
              initial="hidden"
              animate="show"
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
