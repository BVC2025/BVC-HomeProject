// =====================================================================
// ComingSoonPanel — placeholder used by the sidebar for modules whose
// backend hasn't been wired yet (Assets, Training, Help Desk, Org Chart,
// My Team, Performance, Documents, Holidays, Notifications,
// Announcements, Settings).
// Purpose: give the sidebar a real destination and let the user see the
// module in the roadmap without a dead end.
// =====================================================================

import styles from "./ComingSoonPanel.module.css";


const svg = (children, size = 26) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none"
       stroke="currentColor" strokeWidth="1.6"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);


// A small palette of thematic icons — sidebar passes an iconKey.
const ICONS = {
  laptop:    svg(<><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></>),
  book:      svg(<><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/></>),
  ticket:    svg(<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V8z"/><path d="M13 6v12"/></>),
  chart:     svg(<><path d="M3 3v18h18"/><path d="M7 15l4-6 4 3 4-8"/></>),
  tree:      svg(<><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="3" y="18" width="6" height="4" rx="1"/><rect x="9" y="18" width="6" height="4" rx="1"/><rect x="15" y="18" width="6" height="4" rx="1"/><path d="M12 6v6M6 18v-3h12v3M12 12v3"/></>),
  users:     svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>),
  gear:      svg(<><circle cx="12" cy="12" r="3"/><path d="M19 12l2 1-2 1M5 12l-2 1 2 1M12 5l1-2 1 2M12 19l1 2 1-2"/></>),
  docs:      svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 12h8M8 16h5"/></>),
  bell:      svg(<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z"/><path d="M10 21h4"/></>),
  megaphone: svg(<><path d="M3 11v2l14 6V5L3 11z"/><path d="M17 8v8"/><path d="M6 13v4a3 3 0 0 0 6 0v-1"/></>),
  calendar:  svg(<><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></>),
};


export default function ComingSoonPanel({ title, iconKey = "gear", description, bullets = [] }) {

  const icon = ICONS[iconKey] || ICONS.gear;

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.iconRing}>
          <span className={styles.iconInner}>{icon}</span>
        </div>
        <div className={styles.eyebrow}>Roadmap</div>
        <h2 className={styles.title}>{title}</h2>
        {description && <p className={styles.desc}>{description}</p>}
        {bullets.length > 0 && (
          <ul className={styles.bullets}>
            {bullets.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        )}
        <div className={styles.footer}>Coming in an upcoming release.</div>
      </div>
    </div>
  );
}
