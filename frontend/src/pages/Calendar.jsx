import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";
import { hasPermission } from "../utils/rbac";

/*  M1 · CRM Calendar workspace.

    Three views (Day / Week / Month) with a collapsible left sidebar
    (mini calendar + view chooser). Working-hours overlay, current-time
    indicator, click-a-slot-to-create, drag-drop rescheduling on the
    day/week grids. Reuses the existing /calendar/* endpoints — no
    backend change in M1.

    Times are the browser's local time. Server stores naïve DATETIME
    matching the rest of the ERP (IST for BVC24).                       */

const EVENT_TYPES = ["MEETING", "CALL", "FOLLOW_UP", "DEMO", "TASK", "OTHER"];

const EVENT_COLORS = {
  MEETING:   "#dc2626",
  CALL:      "#2563eb",
  FOLLOW_UP: "#d97706",
  DEMO:      "#9333ea",
  TASK:      "#059669",
  OTHER:     "#6b7280",
};

// Working-hours overlay — hard-coded for M1. M4 will read employee
// SHIFT_START / SHIFT_END and honour per-user schedules.
const WORK_START_HR = 9;
const WORK_END_HR   = 18;
const SLOT_MINUTES  = 30;         // grid resolution on Day/Week
const HOUR_PX       = 44;         // vertical pixels per hour
const SLOT_PX       = HOUR_PX / (60 / SLOT_MINUTES);
const MONDAY_FIRST  = true;       // Indian week convention


// ─── date helpers ─────────────────────────────────────────────────────

function pad(n) { return String(n).padStart(2, "0"); }
function fmtLocalDateTime(dt) {
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}` +
         `T${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
}
function keyOf(d) { return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; }
function sameDay(a, b) { return keyOf(a) === keyOf(b); }
function startOfDay(d) { const c = new Date(d); c.setHours(0,0,0,0); return c; }
function endOfDay(d)   { const c = new Date(d); c.setHours(23,59,59,999); return c; }
function addDays(d, n) { const c = new Date(d); c.setDate(c.getDate() + n); return c; }
function startOfWeek(d) {
  const c = startOfDay(d);
  const dow = (c.getDay() + (MONDAY_FIRST ? 6 : 0)) % 7;
  return addDays(c, -dow);
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth()+1, 0, 23, 59, 59); }
function minutesBetween(a, b) { return Math.round((b - a) / 60000); }
function monthGridDates(anchor) {
  const first = startOfMonth(anchor);
  const dow = (first.getDay() + (MONDAY_FIRST ? 6 : 0)) % 7;
  const gridStart = addDays(first, -dow);
  return Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
}
function weekDates(anchor) {
  const s = startOfWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => addDays(s, i));
}


// ─── component ────────────────────────────────────────────────────────

export default function Calendar() {

  const canManage  = hasPermission("calendar.manage");
  const canSeeTeam = hasPermission("calendar.team_view");

  const [view, setView]         = useState(() => localStorage.getItem("cal_view") || "month");
  const [anchor, setAnchor]     = useState(new Date());
  const [selectedDay, setSelDay] = useState(new Date());
  const [events, setEvents]     = useState([]);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing]   = useState(null);
  const [prefill, setPrefill]   = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [nowTick, setNowTick] = useState(new Date());

  // Persist view choice
  useEffect(() => { try { localStorage.setItem("cal_view", view); } catch {} }, [view]);

  // Retick "now" every 60s so the red current-time line moves
  useEffect(() => {
    const id = setInterval(() => setNowTick(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Date range for fetch depends on active view
  const [rangeFrom, rangeTo] = useMemo(() => {
    if (view === "day")   return [startOfDay(anchor), endOfDay(anchor)];
    if (view === "week")  { const s = startOfWeek(anchor); return [s, endOfDay(addDays(s, 6))]; }
    /* month */
    return [startOfMonth(anchor), endOfMonth(anchor)];
  }, [view, anchor]);

  const fetchEvents = () => {
    setLoading(true); setError("");
    API.get("/calendar/events", {
      params: { from: rangeFrom.toISOString(), to: rangeTo.toISOString(), limit: 500 },
    })
      .then((r) => setEvents(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };
  useEffect(fetchEvents, [rangeFrom.getTime(), rangeTo.getTime()]);

  // Group events by day for quick lookup
  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d = new Date(ev.start_at);
      (map[keyOf(d)] = map[keyOf(d)] || []).push(ev);
    }
    for (const k in map) map[k].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
    return map;
  }, [events]);

  // Navigation
  const goPrev = () => setAnchor(a =>
    view === "day"  ? addDays(a, -1) :
    view === "week" ? addDays(a, -7) :
                      new Date(a.getFullYear(), a.getMonth() - 1, 1)
  );
  const goNext = () => setAnchor(a =>
    view === "day"  ? addDays(a, 1) :
    view === "week" ? addDays(a, 7) :
                      new Date(a.getFullYear(), a.getMonth() + 1, 1)
  );
  const goToday = () => { const t = new Date(); setAnchor(t); setSelDay(t); };

  const headerLabel = useMemo(() => {
    if (view === "day")  return anchor.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
    if (view === "week") {
      const s = startOfWeek(anchor), e = addDays(s, 6);
      const same = s.getMonth() === e.getMonth();
      return same
        ? `${s.getDate()}–${e.getDate()} ${e.toLocaleString("en-IN",{month:"long",year:"numeric"})}`
        : `${s.toLocaleString("en-IN",{day:"numeric",month:"short"})} – ${e.toLocaleString("en-IN",{day:"numeric",month:"short",year:"numeric"})}`;
    }
    return anchor.toLocaleString("en-IN", { month: "long", year: "numeric" });
  }, [view, anchor]);

  // Quick-create when a slot is clicked
  const quickCreate = (dt, endDt = null) => {
    if (!canManage) return;
    const end = endDt || (() => { const c = new Date(dt); c.setMinutes(c.getMinutes() + 30); return c; })();
    setPrefill({ start_at: dt, end_at: end });
    setEditing(null);
    setShowModal(true);
  };

  // Drag-drop reschedule
  const rescheduleEvent = (ev, newStart) => {
    const start = new Date(ev.start_at);
    const end   = new Date(ev.end_at);
    const durMin = minutesBetween(start, end);
    const newEnd = new Date(newStart); newEnd.setMinutes(newEnd.getMinutes() + durMin);
    // Optimistic UI
    setEvents(prev => prev.map(e => e.id === ev.id ? { ...e, start_at: newStart.toISOString(), end_at: newEnd.toISOString() } : e));
    API.patch(`/calendar/events/${ev.id}`, {
      start_at: newStart.toISOString(),
      end_at:   newEnd.toISOString(),
    }).catch((e) => {
      // Rollback + reload on error
      fetchEvents();
      alert(e?.response?.data?.detail || "Reschedule failed");
    });
  };

  const todaysEvents = (eventsByDay[keyOf(selectedDay)] || []);

  return (
    <div style={S.page}>
      <div style={S.headerBar}>
        <button style={S.iconBtn} onClick={() => setSidebarOpen(s => !s)} title="Toggle sidebar" aria-label="Toggle sidebar">☰</button>
        <div style={S.title}>Calendar</div>
        <div style={S.headerCenter}>
          <button style={S.navBtn} onClick={goPrev} aria-label="Previous">‹</button>
          <button style={S.todayBtn} onClick={goToday}>Today</button>
          <button style={S.navBtn} onClick={goNext} aria-label="Next">›</button>
          <div style={S.headerLabel}>{headerLabel}</div>
        </div>
        <div style={S.viewSwitcher}>
          {["day","week","month"].map(v => (
            <button key={v} onClick={() => setView(v)} style={{ ...S.viewBtn, ...(view === v ? S.viewBtnActive : {}) }}>
              {v[0].toUpperCase() + v.slice(1)}
            </button>
          ))}
        </div>
        {canManage && (
          <button style={S.createBtn} onClick={() => { setPrefill(null); setEditing(null); setShowModal(true); }}>+ Create</button>
        )}
      </div>

      {error && <div style={S.errorBar}>{error}</div>}

      <div style={{ ...S.body, gridTemplateColumns: sidebarOpen ? "260px 1fr" : "0 1fr" }}>
        {sidebarOpen && (
          <CalendarSidebar
            anchor={anchor}
            onPick={(d) => { setAnchor(d); setSelDay(d); if (view === "month") { /* stay */ } }}
            selectedDay={selectedDay}
            canSeeTeam={canSeeTeam}
          />
        )}

        <div style={S.viewport}>
          {loading && <div style={S.muted}>Loading events…</div>}
          {!loading && view === "day"   && <DayView   date={anchor} events={eventsByDay[keyOf(anchor)] || []} now={nowTick} canManage={canManage} onSlotClick={quickCreate} onEventClick={(ev) => { setEditing(ev); setShowModal(true); }} onDrop={rescheduleEvent} />}
          {!loading && view === "week"  && <WeekView  anchor={anchor} eventsByDay={eventsByDay} now={nowTick} canManage={canManage} onSlotClick={quickCreate} onEventClick={(ev) => { setEditing(ev); setShowModal(true); }} onDrop={rescheduleEvent} />}
          {!loading && view === "month" && <MonthView anchor={anchor} eventsByDay={eventsByDay} selectedDay={selectedDay} onSelectDay={setSelDay} onEventClick={(ev) => { setEditing(ev); setShowModal(true); }} onSlotClick={(d) => quickCreate(new Date(d.setHours(10,0,0,0)))} todaysEvents={todaysEvents} canManage={canManage} onEdit={(ev) => { setEditing(ev); setShowModal(true); }} onChanged={fetchEvents} />}
        </div>
      </div>

      {showModal && (
        <EventModal
          initial={editing}
          prefill={prefill}
          canManage={canManage}
          onClose={() => { setShowModal(false); setEditing(null); setPrefill(null); }}
          onSaved={() => { setShowModal(false); setEditing(null); setPrefill(null); fetchEvents(); }}
        />
      )}
    </div>
  );
}


// ─── Left sidebar (mini calendar) ─────────────────────────────────────

function CalendarSidebar({ anchor, onPick, selectedDay, canSeeTeam }) {

  const [miniAnchor, setMiniAnchor] = useState(anchor);
  useEffect(() => { setMiniAnchor(anchor); }, [anchor.getTime()]);

  const grid = useMemo(() => monthGridDates(miniAnchor), [miniAnchor]);
  const monthLabel = miniAnchor.toLocaleString("en-IN", { month: "long", year: "numeric" });

  return (
    <aside style={S.side}>
      <div style={S.sideBlock}>
        <div style={S.miniHead}>
          <button style={S.miniNav} onClick={() => setMiniAnchor(new Date(miniAnchor.getFullYear(), miniAnchor.getMonth() - 1, 1))} aria-label="Previous month">‹</button>
          <div style={S.miniLabel}>{monthLabel}</div>
          <button style={S.miniNav} onClick={() => setMiniAnchor(new Date(miniAnchor.getFullYear(), miniAnchor.getMonth() + 1, 1))} aria-label="Next month">›</button>
        </div>
        <div style={S.miniWeekRow}>
          {["M","T","W","T","F","S","S"].map((d, i) => <div key={i} style={S.miniWeekCell}>{d}</div>)}
        </div>
        <div style={S.miniGrid}>
          {grid.map((d, i) => {
            const dim = d.getMonth() !== miniAnchor.getMonth();
            const isToday = sameDay(d, new Date());
            const isSel   = sameDay(d, selectedDay);
            return (
              <button
                key={i}
                onClick={() => onPick(d)}
                style={{
                  ...S.miniDay,
                  color: dim ? "#cbd5e1" : "#111827",
                  background: isSel ? "#7A1022" : (isToday ? "#fef2f2" : "transparent"),
                  color: isSel ? "#fff" : (dim ? "#cbd5e1" : (isToday ? "#7A1022" : "#111827")),
                  fontWeight: isToday || isSel ? 800 : 500,
                }}
              >
                {d.getDate()}
              </button>
            );
          })}
        </div>
      </div>

      <div style={S.sideBlock}>
        <div style={S.sideHead}>MY CALENDAR</div>
        <div style={S.calRow}><span style={{ ...S.calDot, background: "#7A1022" }} /> My Events</div>
      </div>

      {canSeeTeam && (
        <div style={S.sideBlock}>
          <div style={S.sideHead}>TEAM CALENDARS</div>
          <div style={{ ...S.calRow, color: "#94a3b8", fontStyle: "italic", fontSize: 12 }}>
            Coming in M5 — saved views (User / Group / Shared).
          </div>
        </div>
      )}

      <div style={S.sideBlock}>
        <div style={S.sideHead}>LEGEND</div>
        {EVENT_TYPES.map(t => (
          <div key={t} style={S.calRow}>
            <span style={{ ...S.calDot, background: EVENT_COLORS[t] }} />
            {t.replace("_", " ")}
          </div>
        ))}
      </div>
    </aside>
  );
}


// ─── Month view (kept from Phase 1, tightened) ────────────────────────

function MonthView({ anchor, eventsByDay, selectedDay, onSelectDay, onEventClick, onSlotClick, todaysEvents, canManage, onEdit, onChanged }) {
  const grid = useMemo(() => monthGridDates(anchor), [anchor]);

  return (
    <div style={S.monthWrap}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={S.weekRow}>
          {(MONDAY_FIRST ? ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"] : ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]).map(d => (
            <div key={d} style={S.weekCell}>{d}</div>
          ))}
        </div>
        <div style={S.dayGrid}>
          {grid.map((d, i) => {
            const key = keyOf(d);
            const dayEvents = eventsByDay[key] || [];
            const dim = d.getMonth() !== anchor.getMonth();
            const isToday = sameDay(d, new Date());
            const isSel = sameDay(d, selectedDay);
            return (
              <div
                key={i}
                onClick={() => onSelectDay(d)}
                onDoubleClick={() => onSlotClick(new Date(d))}
                style={{
                  ...S.dayCell,
                  background: isSel ? "#fef2f2" : (dim ? "#fafafa" : "#ffffff"),
                  borderColor: isToday ? "#dc2626" : "#e5e7eb",
                  borderWidth: isToday ? 2 : 1,
                  color: dim ? "#9ca3af" : "#111827",
                }}
                title={canManage ? "Double-click to create at 10:00" : ""}
              >
                <div style={S.dayNum}>{d.getDate()}</div>
                <div style={S.dayEvents}>
                  {dayEvents.slice(0, 3).map(ev => (
                    <div
                      key={ev.id}
                      onClick={(e) => { e.stopPropagation(); onEventClick(ev); }}
                      title={`${ev.title} · ${new Date(ev.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                      style={{
                        ...S.eventChip,
                        background: EVENT_COLORS[ev.event_type] || "#6b7280",
                        textDecoration: ev.status === "CANCELLED" ? "line-through" : "none",
                        opacity: ev.status === "COMPLETED" ? 0.55 : 1,
                      }}
                    >
                      {new Date(ev.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} {ev.title}
                    </div>
                  ))}
                  {dayEvents.length > 3 && (
                    <div style={S.moreLink}>+{dayEvents.length - 3} more</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <aside style={S.monthSide}>
        <div style={S.sideHeader}>
          {selectedDay.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
        </div>
        {todaysEvents.length === 0 && <div style={S.muted}>No events on this day.</div>}
        {todaysEvents.map(ev => (
          <EventRowMini key={ev.id} ev={ev} onEdit={() => onEdit(ev)} onChanged={onChanged} canManage={canManage} />
        ))}
      </aside>
    </div>
  );
}


// ─── Day view (24-hr timeline with drag-drop + current-time line) ─────

function DayView({ date, events, now, canManage, onSlotClick, onEventClick, onDrop }) {
  return <TimelineGrid columns={[date]} events={events.reduce((m, e) => { const k = keyOf(new Date(e.start_at)); (m[k] = m[k] || []).push(e); return m; }, {})} now={now} canManage={canManage} onSlotClick={onSlotClick} onEventClick={onEventClick} onDrop={onDrop} />;
}


// ─── Week view ────────────────────────────────────────────────────────

function WeekView({ anchor, eventsByDay, now, canManage, onSlotClick, onEventClick, onDrop }) {
  const days = weekDates(anchor);
  return <TimelineGrid columns={days} events={eventsByDay} now={now} canManage={canManage} onSlotClick={onSlotClick} onEventClick={onEventClick} onDrop={onDrop} />;
}


// ─── Shared 24-hour timeline (used by Day + Week) ─────────────────────
//
// One column per date in `columns`. Each column is a vertical stack of
// 48 half-hour slots. Events are absolutely-positioned within their
// column based on start_at + duration. Working hours (9-18) get a
// subtle background tint; the current time gets a red horizontal line
// on today's column.
//
// Drag-drop: chips are HTML5-draggable; hour slots are drop targets.
// On drop we compute the new start_at from the target slot + column,
// keep the original duration, and PATCH the event.

function TimelineGrid({ columns, events, now, canManage, onSlotClick, onEventClick, onDrop }) {
  const [dragging, setDragging] = useState(null);
  const [dragOver, setDragOver] = useState(null); // {colIdx, slotIdx}
  const slotsPerCol = (24 * 60) / SLOT_MINUTES;
  const slotIdxs = Array.from({ length: slotsPerCol }, (_, i) => i);

  const nowTop = (now && columns.some(d => sameDay(d, now)))
    ? (now.getHours() + now.getMinutes() / 60) * HOUR_PX
    : null;

  return (
    <div style={S.tlWrap}>
      {/* Header — day names */}
      <div style={S.tlHeader}>
        <div style={S.tlTimeCol} />
        {columns.map((d, i) => {
          const isToday = sameDay(d, now);
          return (
            <div key={i} style={{ ...S.tlDayHead, color: isToday ? "#dc2626" : "#334155" }}>
              <div style={S.tlDayName}>{d.toLocaleDateString("en-IN", { weekday: "short" })}</div>
              <div style={{ ...S.tlDayNum, background: isToday ? "#dc2626" : "transparent", color: isToday ? "#fff" : "#111827" }}>
                {d.getDate()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Body — scrollable time grid */}
      <div style={S.tlBody}>
        {/* Time gutter */}
        <div style={S.tlTimeCol}>
          {Array.from({ length: 24 }, (_, h) => (
            <div key={h} style={{ height: HOUR_PX, borderTop: "1px solid #f1f5f9", position: "relative" }}>
              <div style={S.tlHourLabel}>{pad(h)}:00</div>
            </div>
          ))}
        </div>

        {columns.map((d, colIdx) => {
          const dayKey = keyOf(d);
          const dayEvents = events[dayKey] || [];
          const isToday = sameDay(d, now);

          return (
            <div key={colIdx} style={S.tlCol}>
              {/* Slot cells (drop targets + click-to-create) */}
              {slotIdxs.map(si => {
                const totalMin = si * SLOT_MINUTES;
                const hr = Math.floor(totalMin / 60);
                const isWorking = hr >= WORK_START_HR && hr < WORK_END_HR;
                const isDropTarget = dragOver?.colIdx === colIdx && dragOver?.slotIdx === si;
                return (
                  <div
                    key={si}
                    onClick={() => {
                      if (!canManage) return;
                      const dt = new Date(d); dt.setHours(hr, totalMin % 60, 0, 0);
                      onSlotClick(dt);
                    }}
                    onDragOver={(e) => { e.preventDefault(); setDragOver({ colIdx, slotIdx: si }); }}
                    onDragLeave={() => setDragOver(prev => (prev?.colIdx === colIdx && prev?.slotIdx === si) ? null : prev)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setDragOver(null);
                      if (!dragging) return;
                      const dt = new Date(d); dt.setHours(hr, totalMin % 60, 0, 0);
                      onDrop(dragging, dt);
                      setDragging(null);
                    }}
                    style={{
                      height: SLOT_PX,
                      borderTop: (totalMin % 60 === 0) ? "1px solid #f1f5f9" : "1px dashed #f8fafc",
                      background: isDropTarget ? "#fecaca"
                              : (isWorking ? "#ffffff" : "#fafafa"),
                      cursor: canManage ? "pointer" : "default",
                    }}
                  />
                );
              })}

              {/* Events absolutely-positioned inside this column */}
              {dayEvents.map(ev => {
                const s = new Date(ev.start_at);
                const e = new Date(ev.end_at);
                const top    = (s.getHours() + s.getMinutes() / 60) * HOUR_PX;
                const height = Math.max(20, ((e - s) / 3600000) * HOUR_PX);
                const clr = EVENT_COLORS[ev.event_type] || "#6b7280";
                return (
                  <div
                    key={ev.id}
                    draggable={canManage && ev.status === "SCHEDULED"}
                    onDragStart={(dragE) => {
                      setDragging(ev);
                      dragE.dataTransfer.effectAllowed = "move";
                      // Firefox requires setData
                      try { dragE.dataTransfer.setData("text/plain", ev.id); } catch {}
                    }}
                    onDragEnd={() => { setDragging(null); setDragOver(null); }}
                    onClick={(e2) => { e2.stopPropagation(); onEventClick(ev); }}
                    title={`${ev.title} · ${s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} – ${e.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${ev.location ? ' · ' + ev.location : ''}`}
                    style={{
                      position: "absolute",
                      top, left: 2, right: 2, height,
                      background: clr,
                      borderRadius: 5,
                      color: "#fff",
                      padding: "3px 6px",
                      fontSize: 11,
                      fontWeight: 700,
                      overflow: "hidden",
                      textDecoration: ev.status === "CANCELLED" ? "line-through" : "none",
                      opacity: ev.status === "COMPLETED" ? 0.55 : (dragging?.id === ev.id ? 0.5 : 0.95),
                      cursor: canManage && ev.status === "SCHEDULED" ? "grab" : "pointer",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.08)",
                    }}
                  >
                    <div style={{ fontSize: 10, opacity: 0.85 }}>
                      {s.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                    </div>
                    <div style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {ev.title}
                    </div>
                  </div>
                );
              })}

              {/* Current-time indicator on today's column */}
              {isToday && nowTop !== null && (
                <div
                  style={{
                    position: "absolute", left: 0, right: 0, top: nowTop,
                    borderTop: "2px solid #dc2626", pointerEvents: "none", zIndex: 3,
                  }}
                >
                  <div style={{ position: "absolute", left: -4, top: -5, width: 8, height: 8, borderRadius: "50%", background: "#dc2626" }} />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ─── Row card + edit modal — mostly kept from Phase 1 ─────────────────

function EventRowMini({ ev, onEdit, onChanged, canManage }) {
  const complete = () => {
    const notes = window.prompt("Outcome notes (optional):", "");
    if (notes === null) return;
    API.post(`/calendar/events/${ev.id}/complete`, { outcome_notes: notes || null })
      .then(onChanged).catch((e) => alert(e?.response?.data?.detail || "Failed"));
  };
  const cancel = () => {
    if (!window.confirm("Cancel this event?")) return;
    API.delete(`/calendar/events/${ev.id}`).then(onChanged).catch((e) => alert(e?.response?.data?.detail || "Failed"));
  };
  return (
    <div style={{ ...S.rowCard, borderLeftColor: EVENT_COLORS[ev.event_type] || "#6b7280" }}>
      <div style={S.rowTitle}>
        {ev.title}
        <span style={{ ...S.badge, background: EVENT_COLORS[ev.event_type] || "#6b7280" }}>
          {ev.event_type}
        </span>
      </div>
      <div style={S.rowMeta}>
        {new Date(ev.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {" – "}
        {new Date(ev.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {ev.location && <> · {ev.location}</>}
      </div>
      {canManage && ev.status === "SCHEDULED" && (
        <div style={S.rowActions}>
          <button style={S.smBtn} onClick={onEdit}>Edit</button>
          <button style={{ ...S.smBtn, background: "#16a34a", color: "#fff", borderColor: "#16a34a" }} onClick={complete}>Complete</button>
          <button style={{ ...S.smBtn, background: "#fff", color: "#b91c1c", borderColor: "#fca5a5" }} onClick={cancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}


function EventModal({ initial, prefill, canManage, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);
  const seedStart = initial?.start_at ? new Date(initial.start_at) : (prefill?.start_at || (() => { const d = new Date(); d.setHours(10,0,0,0); return d; })());
  const seedEnd = initial?.end_at ? new Date(initial.end_at) : (prefill?.end_at || (() => { const d = new Date(seedStart); d.setMinutes(d.getMinutes() + 30); return d; })());

  const [form, setForm] = useState({
    title:            initial?.title || "",
    description:      initial?.description || "",
    event_type:       initial?.event_type || "MEETING",
    location:         initial?.location || "",
    start_at:         fmtLocalDateTime(seedStart),
    end_at:           fmtLocalDateTime(seedEnd),
    all_day:          !!initial?.all_day,
    lead_id:          initial?.lead_id || "",
    customer_id:      initial?.customer_id || "",
    reminder_minutes: initial?.reminder_minutes ?? 15,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const change = (k) => (e) => setForm(s => ({ ...s, [k]: e.target.value }));

  const submit = (e) => {
    e.preventDefault();
    if (!form.title.trim()) return setErr("Title is required");
    if (form.end_at < form.start_at) return setErr("End must be after start");
    const body = {
      title:            form.title.trim(),
      description:      form.description.trim() || null,
      event_type:       form.event_type,
      location:         form.location.trim() || null,
      start_at:         new Date(form.start_at).toISOString(),
      end_at:           new Date(form.end_at).toISOString(),
      all_day:          !!form.all_day,
      lead_id:          form.lead_id.trim() || null,
      customer_id:      form.customer_id.trim() || null,
      reminder_minutes: Number(form.reminder_minutes) || 0,
    };
    setSaving(true); setErr("");
    const req = isEdit
      ? API.patch(`/calendar/events/${initial.id}`, body)
      : API.post(`/calendar/events`, body);
    req.then(onSaved).catch((e) => setErr(e?.response?.data?.detail || "Save failed")).finally(() => setSaving(false));
  };

  return (
    <div style={S.modalBackdrop} onClick={onClose}>
      <div style={S.modal} onClick={(e) => e.stopPropagation()}>
        <div style={S.modalHeader}>
          <div>{isEdit ? "Edit event" : "New event"}</div>
          <button style={S.closeX} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={submit} style={{ padding: 16 }}>
          <label style={S.lbl}>Title *</label>
          <input style={S.inp} value={form.title} onChange={change("title")} autoFocus disabled={!canManage} />
          <div style={S.grid2}>
            <div>
              <label style={S.lbl}>Type</label>
              <select style={S.inp} value={form.event_type} onChange={change("event_type")} disabled={!canManage}>
                {EVENT_TYPES.map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label style={S.lbl}>Reminder (min before)</label>
              <input type="number" min={0} style={S.inp} value={form.reminder_minutes} onChange={change("reminder_minutes")} disabled={!canManage} />
            </div>
          </div>
          <div style={S.grid2}>
            <div>
              <label style={S.lbl}>Start</label>
              <input type="datetime-local" style={S.inp} value={form.start_at} onChange={change("start_at")} disabled={!canManage} />
            </div>
            <div>
              <label style={S.lbl}>End</label>
              <input type="datetime-local" style={S.inp} value={form.end_at} onChange={change("end_at")} disabled={!canManage} />
            </div>
          </div>
          <label style={S.lbl}>Location / meeting link</label>
          <input style={S.inp} value={form.location} onChange={change("location")} disabled={!canManage} />
          <div style={S.grid2}>
            <div>
              <label style={S.lbl}>Lead ID (optional)</label>
              <input style={S.inp} value={form.lead_id} onChange={change("lead_id")} disabled={!canManage} placeholder="lead UUID" />
            </div>
            <div>
              <label style={S.lbl}>Customer ID (optional)</label>
              <input style={S.inp} value={form.customer_id} onChange={change("customer_id")} disabled={!canManage} placeholder="customer UUID" />
            </div>
          </div>
          <label style={S.lbl}>Notes</label>
          <textarea style={{ ...S.inp, minHeight: 70 }} value={form.description} onChange={change("description")} disabled={!canManage} />
          {err && <div style={S.errorBar}>{err}</div>}
          <div style={S.modalActions}>
            <button type="button" style={S.smBtn} onClick={onClose}>Cancel</button>
            {canManage && (
              <button type="submit" style={S.createBtn} disabled={saving}>
                {saving ? "Saving…" : (isEdit ? "Save changes" : "Create event")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}


// ─── styles ───────────────────────────────────────────────────────────

const S = {
  page: { display: "flex", flexDirection: "column", height: "calc(100vh - 60px)", background: "var(--surface, #fafafa)" },

  headerBar:  { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", background: "#fff", borderBottom: "1px solid #e5e7eb", flexWrap: "wrap" },
  iconBtn:    { background: "transparent", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontSize: 14 },
  title:      { fontSize: 18, fontWeight: 800, color: "#0f172a" },
  headerCenter:{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 },
  navBtn:     { background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 10px", cursor: "pointer", fontWeight: 700 },
  todayBtn:   { background: "#fff", border: "1px solid #d1d5db", borderRadius: 6, padding: "6px 12px", cursor: "pointer", fontWeight: 700, fontSize: 12 },
  headerLabel:{ fontWeight: 700, marginLeft: 8, minWidth: 200, color: "#0f172a" },
  viewSwitcher:{ display: "flex", background: "#f1f5f9", borderRadius: 6, padding: 2, marginLeft: "auto" },
  viewBtn:    { padding: "6px 14px", background: "transparent", border: "none", borderRadius: 4, cursor: "pointer", fontWeight: 700, fontSize: 12, color: "#475569" },
  viewBtnActive:{ background: "#fff", color: "#0f172a", boxShadow: "0 1px 2px rgba(0,0,0,0.06)" },
  createBtn:  { padding: "8px 14px", background: "#7A1022", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" },

  errorBar:   { padding: "8px 14px", background: "#fef2f2", color: "#b91c1c", borderBottom: "1px solid #fecaca", fontSize: 13 },

  body:       { flex: 1, display: "grid", overflow: "hidden", transition: "grid-template-columns 0.15s ease" },
  viewport:   { overflow: "auto", padding: 12, minHeight: 0 },
  muted:      { fontSize: 13, color: "#94a3b8", padding: "12px 0" },

  // Sidebar
  side:       { borderRight: "1px solid #e5e7eb", background: "#fff", padding: 12, overflowY: "auto" },
  sideBlock:  { marginBottom: 16 },
  sideHead:   { fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#64748b", marginBottom: 6 },
  calRow:     { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#334155", padding: "3px 0" },
  calDot:     { width: 10, height: 10, borderRadius: 3, display: "inline-block" },

  // Mini calendar
  miniHead:   { display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  miniNav:    { background: "transparent", border: "none", cursor: "pointer", fontWeight: 700, color: "#475569", fontSize: 15, padding: "0 6px" },
  miniLabel:  { fontSize: 12, fontWeight: 700, color: "#0f172a" },
  miniWeekRow:{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1, marginBottom: 2 },
  miniWeekCell:{ fontSize: 10, color: "#94a3b8", textAlign: "center", padding: "2px 0", fontWeight: 700 },
  miniGrid:   { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 1 },
  miniDay:    { width: "100%", height: 26, border: "none", borderRadius: 4, fontSize: 11, cursor: "pointer" },

  // Month grid
  monthWrap:  { display: "flex", gap: 12, height: "100%" },
  weekRow:    { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 },
  weekCell:   { textAlign: "center", fontSize: 12, fontWeight: 600, color: "#64748b", padding: "6px 0" },
  dayGrid:    { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  dayCell:    { minHeight: 96, border: "1px solid #e5e7eb", borderRadius: 6, padding: 4, cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" },
  dayNum:     { fontSize: 12, fontWeight: 700, textAlign: "right" },
  dayEvents:  { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  eventChip:  { color: "#fff", fontSize: 11, padding: "2px 5px", borderRadius: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" },
  moreLink:   { fontSize: 10, color: "#64748b" },
  monthSide:  { width: 320, background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, overflowY: "auto", maxHeight: "78vh", flexShrink: 0 },
  sideHeader: { fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#111827" },

  rowCard:    { padding: 10, borderRadius: 8, background: "#fafafa", border: "1px solid #e5e7eb", borderLeft: "3px solid #6b7280", marginBottom: 8 },
  rowTitle:   { fontWeight: 700, fontSize: 13, color: "#111827", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 4 },
  rowMeta:    { fontSize: 12, color: "#4b5563", marginBottom: 2 },
  rowActions: { display: "flex", gap: 6, marginTop: 8 },
  smBtn:      { padding: "4px 10px", fontSize: 12, border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  badge:      { fontSize: 10, fontWeight: 700, color: "#fff", padding: "2px 6px", borderRadius: 4 },

  // Timeline (Day+Week)
  tlWrap:     { display: "flex", flexDirection: "column", background: "#fff", border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", height: "100%" },
  tlHeader:   { display: "flex", borderBottom: "1px solid #e5e7eb", background: "#f8fafc", position: "sticky", top: 0, zIndex: 2 },
  tlTimeCol:  { width: 60, flexShrink: 0, borderRight: "1px solid #e5e7eb", background: "#f8fafc" },
  tlDayHead:  { flex: 1, textAlign: "center", padding: "8px 4px", borderRight: "1px solid #e5e7eb", fontSize: 12, fontWeight: 700 },
  tlDayName:  { fontSize: 10, letterSpacing: 1, textTransform: "uppercase", color: "#64748b" },
  tlDayNum:   { display: "inline-block", padding: "2px 8px", borderRadius: 999, marginTop: 2, minWidth: 20, fontWeight: 800 },
  tlBody:     { flex: 1, display: "flex", overflow: "auto" },
  tlCol:      { flex: 1, position: "relative", borderRight: "1px solid #e5e7eb", minWidth: 100 },
  tlHourLabel:{ position: "absolute", left: 4, top: -6, fontSize: 10, color: "#94a3b8", background: "#f8fafc", padding: "0 2px" },

  // Modal
  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modal:      { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" },
  modalHeader:{ padding: "14px 18px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 15 },
  closeX:     { background: "transparent", border: "none", fontSize: 20, cursor: "pointer", padding: 0 },
  lbl:        { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", margin: "8px 0 4px" },
  inp:        { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box", background: "#fff" },
  grid2:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  modalActions:{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 14 },
};
