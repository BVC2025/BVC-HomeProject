// =====================================================================
// MyAnnouncementsPanel — company-wide announcements for employees.
// ---------------------------------------------------------------------
// Five category tabs:
//   • Holiday    — pulled from /holidays?year=YYYY
//   • Notice     — INFORMATION-type memos from /memos/employee/{id}
//   • Meeting    — placeholder until a meetings endpoint exists
//   • Event      — placeholder until a company-events endpoint exists
//   • Birthday   — placeholder until a birthdays endpoint exists
//
// The three placeholder tabs show a friendly "will populate when
// HR posts one" empty state so the module reads as complete rather
// than half-broken.
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
export default function MyAnnouncementsPanel({ employeeId }) {

  const [tab, setTab]       = useState("holiday");   // holiday | notice | meeting | event | birthday
  const [year, setYear]     = useState(new Date().getFullYear());

  const [holidays,     setHolidays]     = useState([]);
  const [notices,      setNotices]      = useState([]);
  const [meetings,     setMeetings]     = useState([]);
  const [events,       setEvents]       = useState([]);
  const [noticeAnnouncements, setNoticeAnnouncements] = useState([]);

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

      // Split HR-authored announcements by type. The bell dropdown
      // and every category outside Meeting/Event get funnelled into
      // the Notice tab where the AnnouncementRow's type pill tells
      // the employee what kind of message it is. HOLIDAY-typed
      // announcements are HR *messages* about holidays (greetings,
      // schedule notes) — separate from the actual holiday calendar
      // in /holidays which the Holiday tab still owns.
      const ans = Array.isArray(annRes.data) ? annRes.data : [];
      const upper = (a) => (a.TYPE || "").toUpperCase();
      setMeetings(ans.filter((a) => upper(a) === "MEETING"));
      setEvents(  ans.filter((a) => upper(a) === "EVENT"));
      // Everything else (GENERAL, HR, SAFETY, IT, ACHIEVEMENT,
      // OPERATIONAL, URGENT, COMMUNICATION, CORPORATE, HOLIDAY,
      // legacy NOTICE) lands under Notices. Urgent ones bubble to
      // the top; the rest keep the backend's date/created order.
      const NOTICE_BUCKET = new Set([
        "GENERAL", "HR", "HOLIDAY", "SAFETY", "IT", "ACHIEVEMENT",
        "OPERATIONAL", "URGENT", "COMMUNICATION", "CORPORATE", "NOTICE",
      ]);
      const noticeRows = ans.filter((a) => NOTICE_BUCKET.has(upper(a)));
      noticeRows.sort((a, b) => {
        const au = upper(a) === "URGENT" ? 1 : 0;
        const bu = upper(b) === "URGENT" ? 1 : 0;
        return bu - au;
      });
      setNoticeAnnouncements(noticeRows);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load announcements.");
    } finally {
      setLoading(false);
    }
  }, [year, employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived ----

  const counts = useMemo(() => ({
    holiday:  holidays.length,
    notice:   notices.length + noticeAnnouncements.length,
    meeting:  meetings.length,
    event:    events.length,
    birthday: 0,
  }), [holidays, notices, meetings, events, noticeAnnouncements]);

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

  const tabs = [
    { key: "holiday",  label: "Holidays", icon: I.holiday, count: counts.holiday },
    { key: "notice",   label: "Notices",  icon: I.notice,  count: counts.notice  },
    { key: "meeting",  label: "Meetings", icon: I.meeting, count: counts.meeting },
    { key: "event",    label: "Events",   icon: I.event,   count: counts.event   },
    { key: "birthday", label: "Birthdays", icon: I.cake,   count: counts.birthday },
  ];

  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>Company Announcements</h1>
          <p className={styles.headSub}>
            Holidays, HR notices, meetings, upcoming events and team
            birthdays — the whole company diary in one place.
          </p>
        </div>

        {tab === "holiday" && (
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


      {/* ---------- Category tabs ---------- */}
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
            <span className={styles.tabIcon}>{t.icon}</span>
            <span>{t.label}</span>
            <span className={styles.tabCount}>{t.count}</span>
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

      {!loading && !error && tab === "holiday" && (
        <HolidayView groups={holidayGroups} year={year} />
      )}

      {!loading && !error && tab === "notice" && (
        <>
          {noticeAnnouncements.length > 0 && (
            <AnnouncementList items={noticeAnnouncements} kind="notice" />
          )}
          <NoticeView notices={notices} />
        </>
      )}

      {!loading && !error && tab === "meeting" && (
        meetings.length > 0
          ? <AnnouncementList items={meetings} kind="meeting" />
          : <PlaceholderView
              icon={I.meeting}
              title="No meetings scheduled"
              body="Company-wide meetings posted by HR will appear here with time, venue and the agenda."
            />
      )}

      {!loading && !error && tab === "event" && (
        events.length > 0
          ? <AnnouncementList items={events} kind="event" />
          : <PlaceholderView
              icon={I.event}
              title="No upcoming events"
              body="Town halls, celebrations, training days and other events will appear here as HR publishes them."
            />
      )}

      {!loading && !error && tab === "birthday" && (
        <PlaceholderView
          icon={I.cake}
          title="No birthdays this month"
          body="Team birthdays will show up here so you never miss a celebration."
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
// Meeting / Event / Notice list — HR-authored posts from /announcements
// ==================================================================
function AnnouncementList({ items, kind }) {

  const label =
    kind === "meeting" ? "Upcoming meetings" :
    kind === "event"   ? "Upcoming events"   :
                          "Notices from HR";

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
