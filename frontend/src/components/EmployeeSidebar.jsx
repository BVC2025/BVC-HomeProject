// =====================================================================
// EmployeeSidebar
// ---------------------------------------------------------------------
// Left-rail navigation for the Employee Self-Service portal.
// Renders inside EmployeeDashboard.jsx's .zShell — reuses the existing
// .zSidebar* CSS classes so the visual language stays consistent with
// the admin side. SVG icons only (no emojis, per brand rule).
// =====================================================================

import { useMemo } from "react";
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
  home: svg(<><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></>),
  profile: svg(<><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" /></>),
  clock: svg(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>),
  leave: svg(<><path d="M12 2C8 2 5 5 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-4-3-7-7-7z" /><circle cx="12" cy="9" r="2.5" /></>),
  payroll: svg(<><path d="M6 3h12" /><path d="M6 8h12" /><path d="M6 13l8.5 8" /><path d="M6 13h3a5 5 0 0 0 0-10" /></>),
  docs: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 12h8M8 16h5" /></>),
  laptop: svg(<><rect x="3" y="4" width="18" height="12" rx="2" /><path d="M2 20h20" /></>),
  chart: svg(<><path d="M3 3v18h18" /><path d="M7 15l4-6 4 3 4-8" /></>),
  book: svg(<><path d="M4 4h12a4 4 0 0 1 4 4v12H8a4 4 0 0 1-4-4V4z" /><path d="M4 16a4 4 0 0 1 4-4h12" /></>),
  calendar: svg(<><rect x="3" y="4" width="18" height="17" rx="3" /><path d="M3 9h18" /><path d="M8 2v4M16 2v4" /></>),
  megaphone: svg(<><path d="M3 11v2l14 6V5L3 11z" /><path d="M17 8v8" /><path d="M6 13v4a3 3 0 0 0 6 0v-1" /></>),
  bell: svg(<><path d="M18 16v-5a6 6 0 1 0-12 0v5l-2 2h16z" /><path d="M10 21h4" /></>),
  ticket: svg(<><path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v3a2 2 0 0 0 0 4v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3a2 2 0 0 0 0-4V8z" /><path d="M13 6v12" /></>),
  gear: svg(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1c.5.5 1.2.6 1.8.3.6-.2 1-.8 1-1.5V3a2 2 0 1 1 4 0v.1c0 .7.4 1.3 1 1.5.6.3 1.3.2 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1c-.5.5-.6 1.2-.3 1.8.2.6.8 1 1.5 1H21a2 2 0 1 1 0 4h-.1c-.7 0-1.3.4-1.5 1z" /></>),
  logout: svg(<><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" /><path d="M10 17l-5-5 5-5" /><path d="M5 12h12" /></>),
  users: svg(<><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></>),
  tree: svg(<><rect x="9" y="2" width="6" height="4" rx="1" /><rect x="3" y="18" width="6" height="4" rx="1" /><rect x="9" y="18" width="6" height="4" rx="1" /><rect x="15" y="18" width="6" height="4" rx="1" /><path d="M12 6v6M6 18v-3h12v3M12 12v3" /></>),
  memo: svg(<><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h5" /></>),
  task: svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /><path d="M15.5 14.5l1.5 1.5 3-3" /></>),
  sparkle: svg(<><path d="M12 2l1.9 5.3L19 9l-5.1 1.7L12 16l-1.9-5.3L5 9l5.1-1.7L12 2z" /></>),
};


// -----------------------------------------------------------------
// Nav items — the group headings mirror the spec's ordering.
// A `soon: true` flag routes to the "Coming soon" placeholder tab.
// -----------------------------------------------------------------
// ────────────────────────────────────────────────────────────────
// RBAC gating — Option B (baseline + role additions)
// ────────────────────────────────────────────────────────────────
// Items without a `permission` field are BASELINE — every logged-in
// employee sees them (viewing own attendance / own payslip / own leave
// is a right, not a permission).
//
// Items with a `permission` field are GATED — they only render when
// the employee's role grants that code (checked against the array
// stored in localStorage.permissions on login).
//
// Admin-side RBAC UI (Manage Jenkins → RBAC page) is where these
// codes get granted to specific roles.
// ────────────────────────────────────────────────────────────────

const NAV_GROUPS = [
  {
    label: "Overview",
    items: [

      { key: "home", label: "Dashboard", icon: ICONS.home },
      { key: "profile", label: "My Profile", icon: ICONS.profile },
    ],
  },
  {
    label: "Work",
    items: [
      { key: "attendance", label: "Attendance", icon: ICONS.clock },
      { key: "tasks", label: "Tasks", icon: ICONS.task },
      { key: "leave", label: "Leave", icon: ICONS.leave },
      { key: "permission", label: "Permission", icon: ICONS.clock },
    ],
  },
  {
    label: "Compensation",
    items: [
      { key: "payslips", label: "Salary", icon: ICONS.payroll },
      { key: "allowance", label: "Allowance", icon: ICONS.payroll },
    ],
  },
  {
    label: "Company",
    items: [
      // Announcements covers both directive memos and general HR
      // notices — we don't need two rows for the same idea.
      // Per-employee memos — warning letters, appreciations, notices.
      { key: "memos", label: "Memo", icon: ICONS.memo },
      // Company-wide announcements — holiday, notice, meeting, event, birthday.
      { key: "announcements", label: "Announcements", icon: ICONS.megaphone },
      { key: "documents", label: "Documents", icon: ICONS.docs },
      // "Notifications" removed — the topbar bell already opens
      // this list and shows the unread count.
    ],
  },
  {
    label: "Growth",
    items: [
      { key: "performance", label: "Performance", icon: ICONS.chart },
      { key: "training", label: "Training", icon: ICONS.book, soon: true },
      { key: "orgchart", label: "Org Chart", icon: ICONS.tree },
      // My Team is manager-only — needs `team.view` or `team.manage`
      {
        key: "myteam", label: "My Team", icon: ICONS.users, soon: true,
        permission: ["team.view", "team.manage"]
      },
    ],
  },
  {
    label: "Support",
    items: [
      // HRMS AI Assistant — Gemini-powered Q&A grounded on the HRMS
      // knowledge base. Read-only. Multi-language.
      { key: "hrms_ai", label: "HRMS Assistant", icon: ICONS.sparkle },
      { key: "assets", label: "My Assets", icon: ICONS.laptop },
      { key: "helpdesk", label: "Help Desk", icon: ICONS.ticket },
      { key: "settings", label: "Settings", icon: ICONS.gear },
    ],
  },
];


// -----------------------------------------------------------------
// RBAC helper — read permissions from localStorage safely.
// Returns a Set for O(1) lookups. Handles empty/malformed data.
// -----------------------------------------------------------------
function getPermissionSet() {
  try {
    const raw = localStorage.getItem("permissions") || "[]";
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.map((p) => String(p).toLowerCase()));
  } catch {
    return new Set();
  }
}

/**
 * Decide whether an item should render for the current user.
 * - No `permission` field → baseline, always visible
 * - `permission: "code"` → visible if the code is in the user's set
 * - `permission: ["a","b"]` → visible if ANY code matches (OR-logic)
 */
function hasAccess(item, permSet) {
  if (!item.permission) return true;         // baseline
  const needed = Array.isArray(item.permission)
    ? item.permission
    : [item.permission];
  return needed.some((code) => permSet.has(String(code).toLowerCase()));
}


// -----------------------------------------------------------------
// Component
// -----------------------------------------------------------------
// RBAC role names that sometimes leak into localStorage.employee_id
// when the person logs in through the admin path. The sidebar footer
// is supposed to show a real employee code (BVC008, EMP-021 etc.) —
// never a role name — so we filter these out.
const ROLE_NAME_BLOCKLIST = new Set([
  "ADMIN", "SUPER_ADMIN", "SUPERADMIN", "HR", "MANAGER",
  "OWNER", "SYSTEM_ADMINISTRATOR",
]);

export default function EmployeeSidebar({
  activeTab, onSelect, onLogout, unreadCount = 0,
  open = false, onClose, profile,
}) {

  // Employee identity for the footer card.
  //
  // Preference order for the code shown under the name:
  //   1. `profile.employee_code` — from /portal-dashboard (authoritative,
  //      always the linked EMPLOYEE.EMPLOYEE_CODE, e.g. BVC008)
  //   2. localStorage.employee_code
  //   3. localStorage.employee_id — LAST resort, and only if it doesn't
  //      look like a role name (ADMIN / HR / MANAGER), which the
  //      admin-login path writes here.
  //
  // We deliberately don't surface the RBAC role name in the sidebar
  // — this is the ESS sidebar, everyone using it is acting as an
  // employee, so their employee code is what matters.
  const identity = useMemo(() => {
    const lsName = (localStorage.getItem("employee_name") || "").trim();
    const name = (profile?.name || lsName || "Employee").trim();

    const fromProfile = (profile?.employee_code || "").trim();
    const lsCode = (localStorage.getItem("employee_code") || "").trim();
    const lsId = (localStorage.getItem("employee_id") || "").trim();

    const looksLikeRole = (v) => !!v && ROLE_NAME_BLOCKLIST.has(v.toUpperCase());

    let code = "";
    if (fromProfile && !looksLikeRole(fromProfile)) {
      code = fromProfile;
    } else if (lsCode && !looksLikeRole(lsCode)) {
      code = lsCode;
    } else if (lsId && !looksLikeRole(lsId)) {
      code = lsId;
    }

    const photo = profile?.photo_url || localStorage.getItem("employee_photo") || "";
    const initials = name.split(/\s+/).slice(0, 2)
      .map((s) => s.charAt(0).toUpperCase())
      .join("");
    return { name, code, photo, initials };
  }, [profile?.employee_code, profile?.name, profile?.photo_url]);

  // RBAC — read the permission codes stored on login and use them
  // to hide sidebar items this employee isn't authorised to see.
  // Memoised so we don't hit localStorage on every render.
  const permSet = useMemo(() => getPermissionSet(), []);

  const photoUrl = identity.photo
    ? (identity.photo.startsWith("http")
      ? identity.photo
      : `${API_BASE_URL}${identity.photo}`)
    : null;

  const handleClick = (item) => {
    // Profile now renders inline on the dashboard as its own tab —
    // no route navigation needed. All tabs go through onSelect.
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

        {/* ---------- Nav (RBAC-filtered) ---------- */}
        <nav className={styles.zSidebarNav}>
          {NAV_GROUPS.map((group) => {
            // Filter items the current user is allowed to see.
            const visibleItems = group.items.filter((item) => hasAccess(item, permSet));
            // Hide the whole group if RBAC removed every item in it.
            if (visibleItems.length === 0) return null;

            return (
              <div key={group.label}>
                <div className={styles.zSidebarGroupLabel}>{group.label}</div>
                {visibleItems.map((item) => {
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
            );
          })}
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
            {/* {ICONS.logout} */}
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}
