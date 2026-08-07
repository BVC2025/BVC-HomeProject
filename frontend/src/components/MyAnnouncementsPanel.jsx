// =====================================================================
// MyAnnouncementsPanel — company-wide announcements for employees.
// ---------------------------------------------------------------------
// Tabs mirror the HR-side filter chips 1:1 so both sides speak the
// same taxonomy:
//
//   ALL · GENERAL · HR · MEETING · EVENT · HOLIDAY · SAFETY & SECURITY
//   IT & TECHNOLOGY · ACHIEVEMENT · OPERATIONAL · URGENT
//   COMMUNICATION · CORPORATE
//
// Two tabs merge data from more than one source:
//   • HOLIDAY combines HR-authored HOLIDAY announcements with the
//             /holidays?year= calendar.
//   • GENERAL combines HR-authored GENERAL announcements with the
//             legacy memo-derived notices (INFORMATION memos), so
//             notices HR historically posted via memos stay visible.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyAnnouncementsPanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  holiday: icon(<>
    <rect x="3" y="4" width="18" height="17" rx="3" />
    <path d="M3 9h18M8 2v4M16 2v4" />
    <circle cx="12" cy="14" r="2" fill="currentColor" />
  </>),
  notice:  icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M9 13h6M9 17h4" />
  </>),
  meeting: icon(<>
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </>),
  event:   icon(<path d="M12 2l2.4 6.9L22 10l-6 4.7L18 22l-6-4-6 4 2-7.3L2 10l7.6-1.1z" />),
  cake:    icon(<>
    <path d="M20 21H4v-6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
    <path d="M4 15h16" />
    <path d="M8 13V9M12 13V9M16 13V9" />
    <path d="M8 6v1M12 4v3M16 6v1" />
  </>),
  megaphone: icon(<>
    <path d="M3 11v2l14 6V5L3 11z" />
    <path d="M17 8v8" />
    <path d="M6 13v4a3 3 0 0 0 6 0v-1" />
  </>, 30),
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const MONTH_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];
const DAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];


function parseDateSafe(value) {
  if (!value) return null;
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDateFull(value) {
  const d = parseDateSafe(value);
  if (!d) return "—";
  return `${DAY_SHORT[d.getDay()]}, ${d.getDate()} ${MONTH_LONG[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtDateShort(value) {
  const d = parseDateSafe(value);
  if (!d) return "—";
  return `${d.getDate()} ${MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`;
}

function daysUntil(value) {
  const d = parseDateSafe(value);
  if (!d) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  d.setHours(0, 0, 0, 0);
  return Math.round((d - today) / 86_400_000);
}

function relativeLabel(value) {
  const n = daysUntil(value);
  if (n == null) return "";
  if (n === 0)  return "Today";
  if (n === 1)  return "Tomorrow";
  if (n === -1) return "Yesterday";
  if (n > 0)    return `in ${n} days`;
  return `${Math.abs(n)} days ago`;
}


// ==================================================================
// Component
// ==================================================================
// Tab list mirrors the HR filter chips 1:1 so employees see the same
// taxonomy on their side. 'ALL' surfaces every announcement + memo
// notice + holiday together; 'HOLIDAY' merges the HR-authored
// announcements with the /holidays calendar; 'GENERAL' includes
// INFORMATION-type memos alongside GENERAL-type announcements so
// nothing HR historically posted via memos vanishes.
const ESS_TABS = [
  { key: "ALL",           label: "All" },
  { key: "GENERAL",       label: "General" },
  { key: "HR",            label: "HR" },
  { key: "MEETING",       label: "Meeting" },
  { key: "EVENT",         label: "Event" },
  { key: "HOLIDAY",       label: "Holiday" },
  { key: "SAFETY",        label: "Safety & Security" },
  { key: "IT",            label: "IT & Technology" },
  { key: "ACHIEVEMENT",   label: "Achievement" },
  { key: "OPERATIONAL",   label: "Operational" },
  { key: "URGENT",        label: "Urgent" },
  { key: "COMMUNICATION", label: "Communication" },
  { key: "CORPORATE",     label: "Corporate" },
];


export default function MyAnnouncementsPanel({ employeeId }) {

  // Selected tab — one of the ESS_TABS keys above.
  const [tab, setTab]       = useState("ALL");
  const [year, setYear]     = useState(new Date().getFullYear());

  const [holidays,      setHolidays]      = useState([]);
  const [notices,       setNotices]       = useState([]);
  const [announcements, setAnnouncements] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState("");


  // ---- Fetch ----
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      // Kick off all requests in parallel; each is independently
      // resilient — a failure on one side doesn't blank the whole page.
      const [holRes, memRes, annRes] = await Promise.all([
        API.get(`/holidays?year=${encodeURIComponent(year)}`)
          .catch(() => ({ data: null })),
        employeeId
          ? API.get(`/memos/employee/${encodeURIComponent(employeeId)}`)
              .catch(() => ({ data: [] }))
          : Promise.resolve({ data: [] }),
        API.get("/announcements").catch(() => ({ data: [] })),
      ]);

      const hs = Array.isArray(holRes.data?.holidays) ? holRes.data.holidays : [];
      setHolidays(hs);

      // Filter memos to notices only (INFORMATION type)
      const ms = Array.isArray(memRes.data) ? memRes.data : [];
      setNotices(
        ms.filter((m) => {
          const t = (m.MEMO_TYPE || "").toUpperCase();
          return t === "INFORMATION" || t === "NOTICE" || t === "SHOW_CAUSE_NOTICE";
        })
      );

      // Keep the full announcement list in one bucket; the tab
      // switcher filters against it below. Urgent items float to
      // the top no matter which tab you're on.
      const ans = Array.isArray(annRes.data) ? annRes.data : [];
      ans.sort((a, b) => {
        const au = (a.TYPE || "").toUpperCase() === "URGENT" ? 1 : 0;
        const bu = (b.TYPE || "").toUpperCase() === "URGENT" ? 1 : 0;
        return bu - au;
      });
      setAnnouncements(ans);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, [year, employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived ----

  // Count per tab. ALL = total across every source (announcements +
  // memos-as-notices + holidays). HOLIDAY = the count of HR-authored
  // HOLIDAY announcements plus rows from /holidays. GENERAL rolls in
  // the memo-derived notices so nothing HR historically posted via
  // memos disappears from view.
  const counts = useMemo(() => {
    const byType = {};
    for (const a of announcements) {
      const t = (a.TYPE || "").toUpperCase();
      const key = t === "NOTICE" ? "GENERAL" : t;   // legacy alias
      byType[key] = (byType[key] || 0) + 1;
    }
    return {
      ALL:           announcements.length + notices.length + holidays.length,
      GENERAL:       (byType.GENERAL || 0) + notices.length,
      HR:             byType.HR            || 0,
      MEETING:        byType.MEETING       || 0,
      EVENT:          byType.EVENT         || 0,
      HOLIDAY:       (byType.HOLIDAY || 0) + holidays.length,
      SAFETY:         byType.SAFETY        || 0,
      IT:             byType.IT            || 0,
      ACHIEVEMENT:    byType.ACHIEVEMENT   || 0,
      OPERATIONAL:    byType.OPERATIONAL   || 0,
      URGENT:         byType.URGENT        || 0,
      COMMUNICATION:  byType.COMMUNICATION || 0,
      CORPORATE:      byType.CORPORATE     || 0,
    };
  }, [announcements, notices, holidays]);

  // Rows to render inside the selected tab. Filtered on TYPE, with
  // legacy NOTICE folded into GENERAL. Holiday/general also merge
  // their sibling data sources (see Render section).
  const tabRows = useMemo(() => {
    if (tab === "ALL") return announcements;
    return announcements.filter((a) => {
      const t = (a.TYPE || "").toUpperCase();
      const normalized = t === "NOTICE" ? "GENERAL" : t;
      return normalized === tab;
    });
  }, [tab, announcements]);

  // Split holidays into upcoming vs past for cleaner scanning
  const holidayGroups = useMemo(() => {
    const upcoming = [];
    const past = [];
    for (const h of holidays) {
      const d = daysUntil(h.HOLIDAY_DATE);
      if (d != null && d < 0) past.push(h);
      else upcoming.push(h);
    }
    return { upcoming, past };
  }, [holidays]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    return [now + 1, now, now - 1, now - 2];
  }, []);


  // ==================================================================
  // Render
  // ==================================================================

  // Build the tab list from ESS_TABS + live counts so counts stay
  // consistent with what actually renders below.
  const tabs = ESS_TABS.map((t) => ({
    ...t,
    count: counts[t.key] ?? 0,
  }));

  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>Company Announcements</h1>
          <p className={styles.headSub}>
            Meetings, events, holidays, HR updates, safety notices —
            everything HR posts, one tab per category.
          </p>
        </div>

        {tab === "HOLIDAY" && (
          <div className={styles.yearPicker}>
            <span className={styles.yearLabel}>Year</span>
            <div className={styles.yearChips}>
              {years.map((y) => (
                <button
                  key={y}
                  type="button"
                  className={`${styles.yearChip} ${year === y ? styles.yearChip_active : ""}`}
                  onClick={() => setYear(y)}
                >
                  {y}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>


      {/* ---------- Category tabs — matches the HR filter chips ---------- */}
      <div className={styles.tabs} role="tablist">
        {tabs.map((t) => (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={tab === t.key}
            className={`${styles.tab} ${tab === t.key ? styles.tab_active : ""}`}
            onClick={() => setTab(t.key)}
          >
            <span>{t.label}</span>
            {t.count > 0 && (
              <span className={styles.tabCount}>{t.count}</span>
            )}
          </button>
        ))}
      </div>


      {/* ---------- Content ---------- */}
      {loading && (
        <div className={styles.loading}>Loading announcements…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && (
        <TabView
          tab={tab}
          rows={tabRows}
          notices={notices}
          holidayGroups={holidayGroups}
          year={year}
          announcements={announcements}
        />
      )}

    </div>
  );
}


// ==================================================================
// Holiday view
// ==================================================================
function HolidayView({ groups, year }) {

  if (groups.upcoming.length === 0 && groups.past.length === 0) {
    return (
      <PlaceholderView
        icon={I.holiday}
        title={`No holidays configured for ${year}`}
        body="HR maintains the calendar. Once holidays are added, they'll appear here."
      />
    );
  }

  return (
    <>
      {groups.upcoming.length > 0 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Upcoming</div>
            <div className={styles.cardSub}>{groups.upcoming.length} in {year}</div>
          </div>
          <ul className={styles.list}>
            {groups.upcoming.map((h) => (
              <HolidayRow key={h.ID} holiday={h} />
            ))}
          </ul>
        </section>
      )}

      {groups.past.length > 0 && (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.cardTitle}>Past</div>
            <div className={styles.cardSub}>{groups.past.length} already observed</div>
          </div>
          <ul className={`${styles.list} ${styles.list_muted}`}>
            {groups.past.map((h) => (
              <HolidayRow key={h.ID} holiday={h} muted />
            ))}
          </ul>
        </section>
      )}
    </>
  );
}


function HolidayRow({ holiday, muted = false }) {
  const d = parseDateSafe(holiday.HOLIDAY_DATE);
  const rel = relativeLabel(holiday.HOLIDAY_DATE);
  const isOptional = !!holiday.IS_OPTIONAL;
  const type = (holiday.TYPE || "").toUpperCase();

  return (
    <li className={`${styles.holRow} ${muted ? styles.holRow_muted : ""}`}>
      <div className={styles.dateTile}>
        <div className={styles.dateTileDay}>{d ? d.getDate() : "—"}</div>
        <div className={styles.dateTileMon}>{d ? MONTH_SHORT[d.getMonth()].toUpperCase() : ""}</div>
      </div>

      <div className={styles.holBody}>
        <div className={styles.holTitle}>
          {holiday.NAME || "Holiday"}
          {isOptional && (
            <span className={`${styles.tinyPill} ${styles.tinyPill_amber}`}>Optional</span>
          )}
          {!isOptional && type && (
            <span className={`${styles.tinyPill} ${styles.tinyPill_slate}`}>
              {type.replace(/_/g, " ")}
            </span>
          )}
        </div>
        <div className={styles.holMeta}>
          <span>{d ? `${DAY_SHORT[d.getDay()]}, ${fmtDateShort(holiday.HOLIDAY_DATE)}` : "—"}</span>
          {rel && !muted && (
            <>
              <span className={styles.dot}>·</span>
              <span className={styles.rel}>{rel}</span>
            </>
          )}
        </div>
        {holiday.NOTES && (
          <div className={styles.holNotes}>{holiday.NOTES}</div>
        )}
      </div>
    </li>
  );
}


// ==================================================================
// Notice view
// ==================================================================
// ==================================================================
// TabView — one component that knows how to render each of the 13
// category tabs (ALL + 12 types), including the two special tabs:
//   • HOLIDAY  merges HR-authored HOLIDAY announcements with the
//              /holidays calendar (upcoming + past groups).
//   • GENERAL  merges HR-authored GENERAL announcements with the
//              legacy memo-derived notices, so notices HR still
//              posts as INFORMATION-type memos remain visible.
// Everything else is a straight filter on TYPE.
// ==================================================================
const EMPTY_STATES = {
  ALL:           { icon: I.megaphone, title: "Nothing to show yet", body: "As HR posts announcements, holidays or notices, they'll all appear here." },
  GENERAL:       { icon: I.notice,   title: "No general announcements", body: "Office updates, policies and reminders posted by HR will appear here." },
  HR:            { icon: I.notice,   title: "No HR announcements",     body: "New hires, promotions and benefit updates will land here." },
  MEETING:       { icon: I.meeting,  title: "No meetings scheduled",   body: "Company-wide meetings posted by HR will appear here with time, venue and the agenda." },
  EVENT:         { icon: I.event,    title: "No upcoming events",      body: "Town halls, celebrations, training days and other events will appear here as HR publishes them." },
  HOLIDAY:       { icon: I.holiday,  title: "No holidays configured",  body: "Holiday closures and greetings from HR will show up here." },
  SAFETY:        { icon: I.notice,   title: "No safety notices",       body: "Emergency procedures and safety drills will land here." },
  IT:            { icon: I.notice,   title: "No IT notices",           body: "Maintenance windows, software updates and downtime notices will appear here." },
  ACHIEVEMENT:   { icon: I.notice,   title: "No achievements yet",     body: "Company milestones, awards and recognitions will surface here." },
  OPERATIONAL:   { icon: I.notice,   title: "No operational updates",  body: "Process changes, relocations and new equipment notices will appear here." },
  URGENT:        { icon: I.notice,   title: "Nothing urgent",          body: "Emergency notices and immediate-action items will surface here." },
  COMMUNICATION: { icon: I.notice,   title: "No campaigns yet",        body: "Surveys, feedback requests and internal campaigns will appear here." },
  CORPORATE:     { icon: I.notice,   title: "No corporate news",       body: "Strategy updates, leadership changes and major business news will appear here." },
};

function TabView({ tab, rows, notices, holidayGroups, year, announcements }) {

  // ALL — show everything grouped by source, so the employee gets
  // one comprehensive scan of the entire announcement surface.
  if (tab === "ALL") {
    const hasContent =
      announcements.length > 0 || notices.length > 0 ||
      holidayGroups.upcoming.length > 0 || holidayGroups.past.length > 0;
    if (!hasContent) {
      return (
        <PlaceholderView
          icon={EMPTY_STATES.ALL.icon}
          title={EMPTY_STATES.ALL.title}
          body={EMPTY_STATES.ALL.body}
        />
      );
    }
    return (
      <>
        {announcements.length > 0 && (
          <AnnouncementList items={announcements} kind="all" />
        )}
        {notices.length > 0 && (
          <NoticeView notices={notices} />
        )}
        {(holidayGroups.upcoming.length > 0 || holidayGroups.past.length > 0) && (
          <HolidayView groups={holidayGroups} year={year} />
        )}
      </>
    );
  }

  // HOLIDAY — announcements + the /holidays calendar side-by-side.
  if (tab === "HOLIDAY") {
    const noRows = rows.length === 0
      && holidayGroups.upcoming.length === 0
      && holidayGroups.past.length === 0;
    if (noRows) {
      return (
        <PlaceholderView
          icon={EMPTY_STATES.HOLIDAY.icon}
          title={`No holidays for ${year}`}
          body="HR maintains the calendar. Once holidays are added or announcements posted, they'll appear here."
        />
      );
    }
    return (
      <>
        {rows.length > 0 && <AnnouncementList items={rows} kind="notice" />}
        <HolidayView groups={holidayGroups} year={year} />
      </>
    );
  }

  // GENERAL — announcements + memo-derived notices merged.
  if (tab === "GENERAL") {
    if (rows.length === 0 && notices.length === 0) {
      const s = EMPTY_STATES.GENERAL;
      return <PlaceholderView icon={s.icon} title={s.title} body={s.body} />;
    }
    return (
      <>
        {rows.length > 0 && <AnnouncementList items={rows} kind="notice" />}
        {notices.length > 0 && <NoticeView notices={notices} />}
      </>
    );
  }

  // Every remaining tab — straight filter on TYPE.
  if (rows.length === 0) {
    const s = EMPTY_STATES[tab] || EMPTY_STATES.ALL;
    return <PlaceholderView icon={s.icon} title={s.title} body={s.body} />;
  }

  // Map the tab key to the kind the AnnouncementList expects for its
  // section label. Anything outside meeting/event/notice gets the
  // generic 'notice' label because that's the closest match.
  const kind =
    tab === "MEETING" ? "meeting" :
    tab === "EVENT"   ? "event"   :
                         "notice";
  return <AnnouncementList items={rows} kind={kind} />;
}


// ==================================================================
// Meeting / Event / Notice list — HR-authored posts from /announcements
// ==================================================================
function AnnouncementList({ items, kind }) {

  const label =
    kind === "meeting" ? "Upcoming meetings" :
    kind === "event"   ? "Upcoming events"   :
    kind === "all"     ? "All announcements" :
                          "Announcements from HR";

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>{label}</div>
        <div className={styles.cardSub}>{items.length} posted</div>
      </div>
      <ul className={styles.list}>
        {items.map((a) => (
          <AnnouncementRow key={a.ID} item={a} />
        ))}
      </ul>
    </section>
  );
}


// Inline pill palette — kept in sync with the HR page's TYPE_PILLS
// so the same category reads visually the same on both sides.
const ESS_PILL_COLOR = {
  GENERAL:       { bg: "#f1f5f9", fg: "#334155", label: "General" },
  HR:            { bg: "#eff6ff", fg: "#1d4ed8", label: "HR" },
  MEETING:       { bg: "#eef2ff", fg: "#4338ca", label: "Meeting" },
  EVENT:         { bg: "#f5f3ff", fg: "#6d28d9", label: "Event" },
  HOLIDAY:       { bg: "#fffbeb", fg: "#b45309", label: "Holiday" },
  SAFETY:        { bg: "#fef2f2", fg: "#b91c1c", label: "Safety" },
  IT:            { bg: "#ecfeff", fg: "#0e7490", label: "IT" },
  ACHIEVEMENT:   { bg: "#ecfdf5", fg: "#047857", label: "Achievement" },
  OPERATIONAL:   { bg: "#f0fdfa", fg: "#0f766e", label: "Operational" },
  URGENT:        { bg: "#dc2626", fg: "#ffffff", label: "Urgent" },
  COMMUNICATION: { bg: "#f0f9ff", fg: "#0369a1", label: "Communication" },
  CORPORATE:     { bg: "#faf5ff", fg: "#7e22ce", label: "Corporate" },
  NOTICE:        { bg: "#f1f5f9", fg: "#334155", label: "General" },  // legacy
};

function AnnouncementRow({ item }) {

  const d = parseDateSafe(item.EVENT_DATE);
  const rel = item.EVENT_DATE ? relativeLabel(item.EVENT_DATE) : "";
  const type = (item.TYPE || "").toUpperCase();
  const pill = ESS_PILL_COLOR[type] || { bg: "#f1f5f9", fg: "#334155", label: type || "Notice" };
  const isUrgent = type === "URGENT";

  return (
    <li className={styles.holRow} style={
      isUrgent ? { borderLeft: "3px solid #dc2626", paddingLeft: 9 } : undefined
    }>
      {d ? (
        <div className={styles.dateTile}>
          <div className={styles.dateTileDay}>{d.getDate()}</div>
          <div className={styles.dateTileMon}>{MONTH_SHORT[d.getMonth()].toUpperCase()}</div>
        </div>
      ) : (
        <div className={styles.dateTile} style={{ opacity: 0.5 }}>
          <div className={styles.dateTileMon} style={{ fontSize: 9 }}>NOTE</div>
        </div>
      )}

      <div className={styles.holBody}>
        <div className={styles.holTitle}>
          {item.TITLE || "Announcement"}
          <span style={{
            display: "inline-block",
            marginLeft: 8,
            padding: "2px 8px",
            background: pill.bg,
            color: pill.fg,
            borderRadius: 999,
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}>
            {pill.label}
          </span>
        </div>
        <div className={styles.holMeta}>
          {d && <span>{fmtDateFull(item.EVENT_DATE)}</span>}
          {item.EVENT_TIME && (
            <>
              {d && <span className={styles.dot}>·</span>}
              <span>{item.EVENT_TIME}</span>
            </>
          )}
          {rel && (
            <>
              <span className={styles.dot}>·</span>
              <span className={styles.rel}>{rel}</span>
            </>
          )}
          {item.LOCATION && (
            <>
              <span className={styles.dot}>·</span>
              <span>{item.LOCATION}</span>
            </>
          )}
        </div>
        {item.DESCRIPTION && (
          <div className={styles.holNotes}>{item.DESCRIPTION}</div>
        )}
      </div>
    </li>
  );
}


function NoticeView({ notices }) {

  if (notices.length === 0) {
    return (
      <PlaceholderView
        icon={I.notice}
        title="No notices yet"
        body="HR notices, policy updates and information circulars will appear here."
      />
    );
  }

  return (
    <section className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.cardTitle}>Recent notices</div>
        <div className={styles.cardSub}>{notices.length} in total</div>
      </div>
      <ul className={styles.list}>
        {notices.map((n) => (
          <li key={n.ID} className={styles.noticeRow}>
            <div className={styles.noticeIcon}>{I.notice}</div>
            <div className={styles.noticeBody}>
              <div className={styles.noticeTitle}>
                {n.SUBJECT || "(no subject)"}
              </div>
              <div className={styles.noticeMeta}>
                <span>{fmtDateFull(n.ISSUE_DATE || n.CREATED_AT)}</span>
                {n.ISSUED_BY && (
                  <>
                    <span className={styles.dot}>·</span>
                    <span>{n.ISSUED_BY}</span>
                  </>
                )}
              </div>
              {n.DESCRIPTION && (
                <div className={styles.noticeDesc}>{n.DESCRIPTION}</div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}


// ==================================================================
// Placeholder view — shown for tabs we don't have a backend for yet.
// ==================================================================
function PlaceholderView({ icon, title, body }) {
  return (
    <div className={styles.empty}>
      <span className={styles.emptyIcon}>{icon || I.megaphone}</span>
      <div>
        <div className={styles.emptyTitle}>{title}</div>
        <div className={styles.emptyBody}>{body}</div>
      </div>
    </div>
  );
}
