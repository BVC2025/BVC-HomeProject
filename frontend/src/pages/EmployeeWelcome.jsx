/*
 * EmployeeWelcome
 * ----------------
 * Full-screen landing shown once after an employee logs in. Acts as
 * the "home" tile board — each of the six feature cards is a direct
 * link into its own section of the employee portal.
 *
 * There is no "Continue" button and no sidebar on the destination
 * pages: this page IS the navigation.
 */

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./EmployeeWelcome.module.css";


// -----------------------------------------------------------------------
// Feature cards. `tab` maps 1:1 to EmployeeDashboardBody's `mainTab`
// state — the dashboard reads location.state.tab on mount and opens
// the matching section.
// -----------------------------------------------------------------------

const FEATURES = [
  {
    key: "attendance",
    tab: "attendance",
    title: "Attendance",
    desc: "View your daily attendance and work hours.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="3" y="4" width="18" height="17" rx="3" />
        <path d="M3 9h18" />
        <path d="M8 2v4M16 2v4" />
        <path d="M12 14l2 2 4-4" />
      </svg>
    ),
  },
  {
    key: "tasks",
    tab: "tasks",
    title: "Tasks",
    desc: "View today's tasks and update their status.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
        <path d="M15.5 14.5l1.5 1.5 3-3" />
      </svg>
    ),
  },
  {
    key: "leave",
    tab: "leave",
    title: "Leave",
    desc: "Apply and track leave requests.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z" />
        <circle cx="12" cy="9" r="2.5" />
      </svg>
    ),
  },
  {
    key: "permission",
    tab: "permission",
    title: "Permission",
    desc: "Request short permissions online.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    ),
  },
  {
    key: "memo",
    tab: "memos",
    title: "Memo",
    desc: "View company memos and notices.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 12h8M8 16h5" />
      </svg>
    ),
  },
  {
    key: "payslip",
    tab: "payslips",
    title: "Payslip",
    desc: "Download your monthly salary payslip instantly.",
    icon: (
      <svg viewBox="0 0 24 24" width="28" height="28" fill="none"
           stroke="currentColor" strokeWidth="1.8"
           strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <rect x="4" y="3" width="16" height="18" rx="2" />
        <path d="M8 8h8M8 12h8M8 16h5" />
      </svg>
    ),
  },
];


const QUOTES = [
  "Success comes from dedication and consistency. Have a productive day!",
  "Great things are built one focused day at a time.",
  "Small daily improvements add up to remarkable results.",
  "Do the work. Own the outcome. Enjoy the win.",
  "Discipline beats motivation. You've got this.",
];


// -----------------------------------------------------------------------
// Component
// -----------------------------------------------------------------------

export default function EmployeeWelcome() {

  const navigate = useNavigate();

  const [now, setNow] = useState(new Date());

  // Live clock, updated every second so the seconds tick
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Employee name from localStorage (populated by Login.jsx on employee login)
  const employeeName = useMemo(() => {
    const raw = (localStorage.getItem("employee_name") || "").trim();
    if (!raw) return "there";
    return raw.split(/\s+/)[0];
  }, []);

  // Pick a stable quote for this session (doesn't shuffle on every render)
  const quote = useMemo(() => {
    const idx = new Date().getDate() % QUOTES.length;
    return QUOTES[idx];
  }, []);

  const dateLabel = now.toLocaleDateString("en-IN", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });

  const timeLabel = now.toLocaleTimeString("en-IN", {
    hour: "numeric", minute: "2-digit", hour12: true,
  });

  // Card click — navigate to "/" with the target dashboard tab in
  // location.state so the dashboard can open the matching section.
  const openFeature = (feature) => {
    navigate("/", { state: { tab: feature.tab } });
  };

  return (
    <div className={styles.stage}>

      {/* Main content */}
      <div className={styles.content}>

        {/* Logo — real BVC brand mark */}
        <div className={styles.logoWrap}>
          <div className={styles.logoTile}>
            <img
              src="/logo.webp"
              alt="Bharath Vending Corporation"
              className={styles.logoImg}
              onError={(e) => {
                // Graceful fallback if /logo.webp is missing — swap in
                // the initials tile the design used before.
                e.currentTarget.style.display = "none";
                e.currentTarget.parentElement?.classList.add(styles.logoFallback);
              }}
            />
          </div>
          <div className={styles.brandName}>Bharath Vending Corporation</div>
        </div>

        {/* Hero */}
        <div className={styles.hero}>
          <div className={styles.dateChip}>
            {dateLabel} · {timeLabel}
          </div>
          <h1 className={styles.title}>Welcome to BVC</h1>
          <p className={styles.subtitle}>
            Your Employee Self-Service Portal
          </p>
          <p className={styles.tagline}>
            Tap a card to open its page.
          </p>
          <div className={styles.greet}>
            <span className={styles.greetIcon} aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" strokeWidth="2"
                   strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
              </svg>
            </span>
            <span>Welcome, <b>{employeeName}</b></span>
          </div>
        </div>

        {/* Feature cards — each opens its own page */}
        <div className={styles.cards}>
          {FEATURES.map((f) => (
            <button
              key={f.key}
              type="button"
              className={styles.card}
              onClick={() => openFeature(f)}
              aria-label={`Open ${f.title}`}
            >
              <div className={styles.cardIconWrap}>
                <span className={styles.cardIcon}>{f.icon}</span>
              </div>
              <div className={styles.cardTitle}>{f.title}</div>
              <div className={styles.cardDesc}>{f.desc}</div>
              <span className={styles.cardArrow} aria-hidden="true">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2.4"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" />
                  <path d="M13 5l7 7-7 7" />
                </svg>
              </span>
            </button>
          ))}
        </div>

        {/* Quote */}
        <div className={styles.quote}>
          <span className={styles.quoteMark}>“</span>
          <span>{quote}</span>
          <span className={styles.quoteMark}>”</span>
        </div>

        <div className={styles.footer}>
          Bharath Vending Corporation · Employee Portal
        </div>
      </div>
    </div>
  );
}
