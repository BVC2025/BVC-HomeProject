// =====================================================================
// EmployeeSidebar
// ---------------------------------------------------------------------
// Left-rail navigation for the Employee Self-Service portal.
// Renders inside EmployeeDashboard.jsx's .zShell — reuses the existing
// .zSidebar* CSS classes so the visual language stays consistent with
// the admin side. SVG icons only (no emojis, per brand rule).
// =====================================================================

import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import styles from "../pages/EmployeeDashboard.module.css";
import { API_BASE_URL } from "../services/api";


// -----------------------------------------------------------------
// SVG icon primitives. Kept inline so this file has no external
// icon-library dependency and the sidebar loads with the app shell.
// -----------------------------------------------------------------
const svg = (children) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none"
       stroke="currentColor" strokeWidth="1.8"
       strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {children}
  </svg>
);

const ICONS = {
  home:      svg(<><path d="M3 12l9-9 9 9"/><path d="M5 10v10h14V10"/></>),
  profile:   svg(<><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8"/></>),
  clock:     svg(<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>),
  leave:     svg(<><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></>),
  payroll:   svg(<><path d="M6 3h12"/><path d="M6 8h12"/><path d="M6 13l8.5 8"/><path d="M6 13h3a5 5 0 0 0 0-10"/></>),
  docs:      svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 12h8M8 16h5"/></>),
  laptop:    svg(<><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M2 20h20"/></>),
  chart:     svg(<><path d="M3 3v18h18"/><path d="M7 15l4-6 4 3 4-8"/></>),
  book:      svg(<><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z"/><path d="M4 16a4 4 0 0 1 4-4h12"/></>),
  calendar:  svg(<><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M3 9h18"/><path d="M8 2v4M16 2v4"/></>),
  megaphone: svg(<><path d="M3 11v2l14 6V5L3 11z"/><path d="M17 8v8"/><path d="M6 13v4a3 3 0 0 0 6 0v-1"/></>),
  bell:      svg(<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z"/><path d="M10 21h4"/></>),
  ticket:    svg(<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V8z"/><path d="M13 6v12"/></>),
  gear:      svg(<><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1c.5.5 1.2.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 1 1 4 0v.1c0 .7.4 1.3 1 1.5.6.3 1.3.2 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1c-.5.5-.6 1.2-.3 1.8.2.6.8 1 1.5 1H21a2 2 0 1 1 0 4h-.1c-.7 0-1.3.4-1.5 1z"/></>),
  logout:    svg(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="M10 17l-5-5 5-5"/><path d="M5 12h12"/></>),
  users:     svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></>),
  tree:      svg(<><rect x="9" y="2" width="6" height="4" rx="1"/><rect x="3" y="18" width="6" height="4" rx="1"/><rect x="9" y="18" width="6" height="4" rx="1"/><rect x="15" y="18" width="6" height="4" rx="1"/><path d="M12 6v6M6 18v-3h12v3M12 12v3"/></>),
  memo:      svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></>),
  task:      svg(<><rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><path d="M15.5 14.5l1.5 1.5 3-3"/></>),
};


// -----------------------------------------------------------------
// Nav items — the group headings mirror the spec's ordering.
// A `soon: true` flag routes to the "Coming soon" placeholder tab.
// -----------------------------------------------------------------
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { key: "home",       label: "Dashboard",     icon: ICONS.home },
      { key: "profile",    label: "My Profile",    icon: ICONS.profile,   soon: true },
    ],
  },
  {
    label: "Work",
    items: [
      { key: "attendance", label: "Attendance",    icon: ICONS.clock },
      { key: "tasks",      label: "Tasks",         icon: ICONS.task },
      { key: "leave",      label: "Leave",         icon: ICONS.leave },
      { key: "permission", label: "Permission",    icon: ICONS.clock },
    ],
  },
  {
    label: "Compensation",
    items: [
      { key: "payslips",   label: "Payroll",       icon: ICONS.payroll },
      { key: "allowance",  label: "Allowance",     icon: ICONS.payroll },
    ],
  },
  {
    label: "Company",
    items: [
      { key: "memos",      label: "Memos",         icon: ICONS.memo },
      { key: "announcements", label: "Announcements", icon: ICONS.megaphone, soon: true },
      { key: "holidays",   label: "Holidays",      icon: ICONS.calendar,  soon: true },
      { key: "documents",  label: "Documents",     icon: ICONS.docs,      soon: true },
      { key: "notifications", label: "Notifications", icon: ICONS.bell,   soon: true },
    ],
  },
  {
    label: "Growth",
    items: [
      { key: "performance", label: "Performance",  icon: ICONS.chart,     soon: true },
      { key: "training",    label: "Training",     icon: ICONS.book,      soon: true },
      { key: "orgchart",    label: "Org Chart",    icon: ICONS.tree,      soon: true },
      { key: "myteam",      label: "My Team",      icon: ICONS.users,     soon: true },
    ],
  },
  {
    label: "Support",
    items: [
      { key: "assets",      label: "My Assets",    icon: ICONS.laptop,    soon: true },
      { key: "helpdesk",    label: "Help Desk",    icon: ICONS.ticket,    soon: true },
      { key: "settings",    label: "Settings",     icon: ICONS.gear,      soon: true },
    ],
  },
];


// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------
export default function EmployeeSidebar({
  activeTab, onSelect, onLogout, unreadCount = 0,
  open = false, onClose,
}) {

  const navigate = useNavigate();

  // Employee identity for the footer card.
  // NOTE: Login.jsx on this branch only writes `employee_id` (the
  // CODE), not `employee_code`, so we fall back to it. We also
  // deliberately don't surface the RBAC role name (ADMIN / HR /
  // MANAGER) here — this is the ESS sidebar, everyone using it is
  // acting as an employee.
  const identity = useMemo(() => {
    const name  = (localStorage.getItem("employee_name") || "").trim() || "Employee";
    const code  = (localStorage.getItem("employee_code") || "").trim()
               || (localStorage.getItem("employee_id")   || "").trim();
    const photo = localStorage.getItem("employee_photo") || "";
    const initials = name.split(/\s+/).slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");
    return { name, code, photo, initials };
  }, []);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
        ? identity.photo
        : `${API_BASE_URL}${identity.photo}`)
    : null;

  const handleClick = (item) => {
    if (item.key === "profile") {
      // Profile has its own route already
      navigate("/employee-profile");
      onClose?.();
      return;
    }
    onSelect?.(item.key, { soon: !!item.soon });
    // On mobile the sidebar is a drawer — close it after picking a tab
    onClose?.();
  };

  return (
    <>
      {/* Backdrop — only visible on mobile when drawer is open */}
      {open && (
        <div
          className={styles.zSidebarOverlay}
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside className={
        open
          ? `${styles.zSidebar} ${styles.zSidebarOpen}`
          : styles.zSidebar
      }>

      {/* ---------- Brand ---------- */}
      <div className={styles.zSidebarBrand}>
        <div className={styles.zSidebarBrandLogo}>
          <img
            src="/logo.webp"
            alt=""
            style={{ width: "100%", height: "100%", objectFit: "contain" }}
            onError={(e) => { e.currentTarget.style.display = "none"; }}
          />
        </div>
        <div>
          <div className={styles.zSidebarBrandText}>BVC</div>
          <div className={styles.zSidebarBrandSub}>Employee Portal</div>
        </div>
      </div>

      {/* ---------- Nav ---------- */}
      <nav className={styles.zSidebarNav}>
        {NAV_GROUPS.map((group) => (
          <div key={group.label}>
            <div className={styles.zSidebarGroupLabel}>{group.label}</div>
            {group.items.map((item) => {
              const active = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => handleClick(item)}
                  className={
                    active
                      ? `${styles.zSidebarItem} ${styles.zSidebarItemActive}`
                      : styles.zSidebarItem
                  }
                  aria-current={active ? "page" : undefined}
                >
                  <span className={styles.zSidebarItemIcon}>{item.icon}</span>
                  <span className={styles.zSidebarItemLabel}>{item.label}</span>
                  {item.key === "notifications" && unreadCount > 0 && (
                    <span className={styles.zSidebarItemBadge}>{unreadCount}</span>
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* ---------- Footer: user card + logout ---------- */}
      <div className={styles.zSidebarFooter}>
        <div className={styles.zSidebarUserCard}>
          <div className={styles.zSidebarUserAvatar}>
            {photoUrl ? (
              <img src={photoUrl} alt="" />
            ) : (
              identity.initials || "—"
            )}
          </div>
          <div className={styles.zSidebarUserInfo}>
            <div className={styles.zSidebarUserName}>{identity.name}</div>
            <div className={styles.zSidebarUserMeta}>
              {identity.code
                ? `Employee · ${identity.code}`
                : "Employee"}
            </div>
          </div>
        </div>
        <button
          type="button"
          className={styles.zSidebarLogout}
          onClick={onLogout}
        >
          {ICONS.logout}
          <span>Log out</span>
        </button>
      </div>
    </aside>
    </>
  );
}
