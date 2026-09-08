import { useEffect, useMemo, useState } from "react";
import API from "../services/api";
import { hasPermission } from "../utils/rbac";

/*  CRM Calendar page.

    Month grid + right-side "today / upcoming" panel + create-event modal.
    Filters: my events, team (if calendar.team_view), by lead, by customer.

    All times are shown in the browser's local timezone. Server stores
    the naïve datetime the client sent, matching the rest of the ERP.
*/

const EVENT_TYPES = ["MEETING", "CALL", "FOLLOW_UP", "DEMO", "TASK", "OTHER"];

const EVENT_COLORS = {
  MEETING:   "#dc2626",
  CALL:      "#2563eb",
  FOLLOW_UP: "#d97706",
  DEMO:      "#9333ea",
  TASK:      "#059669",
  OTHER:     "#6b7280",
};


function fmtLocalDateTime(dt) {
  // "YYYY-MM-DDTHH:mm" — <input type="datetime-local"> compatible
  const p = (n) => String(n).padStart(2, "0");
  return (
    `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}` +
    `T${p(dt.getHours())}:${p(dt.getMinutes())}`
  );
}

function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59); }
function addDays(d, n)   { const c = new Date(d); c.setDate(c.getDate() + n); return c; }

function monthGrid(anchor) {
  // 6 rows × 7 cols starting on Monday (Indian week convention).
  const first = startOfMonth(anchor);
  const startDow = (first.getDay() + 6) % 7; // Mon=0 ... Sun=6
  const gridStart = addDays(first, -startDow);
  const cells = [];
  for (let i = 0; i < 42; i++) cells.push(addDays(gridStart, i));
  return cells;
}


export default function Calendar() {

  const canManage    = hasPermission("calendar.manage");
  const canSeeTeam   = hasPermission("calendar.team_view");

  const [anchor, setAnchor]       = useState(new Date());
  const [events, setEvents]       = useState([]);
  const [selectedDay, setSelected] = useState(new Date());
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing]     = useState(null);

  const grid = useMemo(() => monthGrid(anchor), [anchor]);

  const fetchMonth = () => {
    setLoading(true);
    setError("");
    const from = startOfMonth(anchor).toISOString();
    const to   = endOfMonth(anchor).toISOString();
    API.get("/calendar/events", { params: { from, to, limit: 500 } })
      .then((r) => setEvents(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load events"))
      .finally(() => setLoading(false));
  };

  useEffect(fetchMonth, [anchor]);

  const eventsByDay = useMemo(() => {
    const map = {};
    for (const ev of events) {
      const d = new Date(ev.start_at);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      (map[key] = map[key] || []).push(ev);
    }
    return map;
  }, [events]);

  const keyOf = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  const todaysEvents = useMemo(() => {
    const k = keyOf(selectedDay);
    return (eventsByDay[k] || []).slice().sort(
      (a, b) => new Date(a.start_at) - new Date(b.start_at)
    );
  }, [eventsByDay, selectedDay]);

  const isSameMonth = (d) =>
    d.getMonth() === anchor.getMonth() && d.getFullYear() === anchor.getFullYear();
  const isToday = (d) => keyOf(d) === keyOf(new Date());
  const isSelected = (d) => keyOf(d) === keyOf(selectedDay);

  const monthLabel = anchor.toLocaleString("en-IN", { month: "long", year: "numeric" });

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={S.title}>Calendar</div>
          <div style={S.subtitle}>
            Meetings, calls and follow-ups
            {canSeeTeam ? " · team view available" : ""}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button style={S.navBtn} onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1))}>‹</button>
          <div style={S.monthLabel}>{monthLabel}</div>
          <button style={S.navBtn} onClick={() => setAnchor(new Date(anchor.getFullYear(), anchor.getMonth() + 1, 1))}>›</button>
          <button style={S.navBtn} onClick={() => setAnchor(new Date())} title="Today">Today</button>
          {canManage && (
            <button style={S.newBtn} onClick={() => { setEditing(null); setShowCreate(true); }}>
              + New event
            </button>
          )}
        </div>
      </div>

      {error && <div style={S.errorBar}>{error}</div>}

      <div style={S.mainGrid}>
        {/* Month grid */}
        <div style={S.calendarWrap}>
          <div style={S.weekRow}>
            {["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((d) => (
              <div key={d} style={S.weekCell}>{d}</div>
            ))}
          </div>
          <div style={S.dayGrid}>
            {grid.map((d, i) => {
              const key = keyOf(d);
              const dayEvents = eventsByDay[key] || [];
              const dim = !isSameMonth(d);
              return (
                <div
                  key={i}
                  onClick={() => setSelected(d)}
                  style={{
                    ...S.dayCell,
                    background: isSelected(d) ? "#fef2f2" : (dim ? "#fafafa" : "#ffffff"),
                    borderColor: isToday(d) ? "#dc2626" : "#e5e7eb",
                    borderWidth: isToday(d) ? 2 : 1,
                    color: dim ? "#9ca3af" : "#111827",
                  }}
                >
                  <div style={S.dayNum}>{d.getDate()}</div>
                  <div style={S.dayEvents}>
                    {dayEvents.slice(0, 3).map((ev) => (
                      <div
                        key={ev.id}
                        title={`${ev.title} · ${new Date(ev.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`}
                        style={{
                          ...S.eventChip,
                          background: EVENT_COLORS[ev.event_type] || "#6b7280",
                          textDecoration: ev.status === "CANCELLED" ? "line-through" : "none",
                          opacity: ev.status === "COMPLETED" ? 0.55 : 1,
                        }}
                        onClick={(e) => { e.stopPropagation(); setEditing(ev); setShowCreate(true); }}
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

        {/* Side panel — selected day + upcoming */}
        <aside style={S.side}>
          <div style={S.sideHeader}>
            {selectedDay.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
          </div>
          {loading && <div style={S.muted}>Loading…</div>}
          {!loading && todaysEvents.length === 0 && (
            <div style={S.muted}>No events on this day.</div>
          )}
          {todaysEvents.map((ev) => (
            <EventRow
              key={ev.id}
              ev={ev}
              canManage={canManage}
              onEdit={() => { setEditing(ev); setShowCreate(true); }}
              onChanged={fetchMonth}
            />
          ))}
        </aside>
      </div>

      {showCreate && (
        <EventModal
          initial={editing}
          canManage={canManage}
          defaultDate={selectedDay}
          onClose={() => { setShowCreate(false); setEditing(null); }}
          onSaved={() => { setShowCreate(false); setEditing(null); fetchMonth(); }}
        />
      )}
    </div>
  );
}


function EventRow({ ev, canManage, onEdit, onChanged }) {
  const complete = () => {
    const notes = window.prompt("Outcome notes (optional):", "");
    if (notes === null) return;
    API.post(`/calendar/events/${ev.id}/complete`, { outcome_notes: notes || null })
      .then(onChanged)
      .catch((e) => alert(e?.response?.data?.detail || "Failed"));
  };
  const cancel = () => {
    if (!window.confirm("Cancel this event?")) return;
    API.delete(`/calendar/events/${ev.id}`)
      .then(onChanged)
      .catch((e) => alert(e?.response?.data?.detail || "Failed"));
  };
  return (
    <div style={{ ...S.rowCard, borderLeftColor: EVENT_COLORS[ev.event_type] || "#6b7280" }}>
      <div style={S.rowTitle}>
        {ev.title}
        <span style={{ ...S.badge, background: EVENT_COLORS[ev.event_type] || "#6b7280" }}>
          {ev.event_type}
        </span>
        {ev.status !== "SCHEDULED" && (
          <span style={{ ...S.badge, background: ev.status === "COMPLETED" ? "#16a34a" : "#6b7280" }}>
            {ev.status}
          </span>
        )}
      </div>
      <div style={S.rowMeta}>
        {new Date(ev.start_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {" – "}
        {new Date(ev.end_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        {ev.location && <> · {ev.location}</>}
      </div>
      {(ev.owner_name || ev.lead_name || ev.customer_name) && (
        <div style={S.rowMeta}>
          {ev.owner_name && <>👤 {ev.owner_name}</>}
          {ev.lead_name && <>  ·  🎯 {ev.lead_name}</>}
          {ev.customer_name && <>  ·  🏢 {ev.customer_name}</>}
        </div>
      )}
      {ev.description && <div style={S.rowDesc}>{ev.description}</div>}
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


function EventModal({ initial, canManage, defaultDate, onClose, onSaved }) {
  const isEdit = Boolean(initial?.id);

  const seedStart = initial?.start_at
    ? new Date(initial.start_at)
    : (() => { const d = new Date(defaultDate); d.setHours(10, 0, 0, 0); return d; })();
  const seedEnd = initial?.end_at
    ? new Date(initial.end_at)
    : (() => { const d = new Date(seedStart); d.setMinutes(d.getMinutes() + 30); return d; })();

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
  const [err, setErr]       = useState("");

  const change = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

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
      customer_id:      form.customer_id ? Number(form.customer_id) : null,
      reminder_minutes: Number(form.reminder_minutes) || 0,
    };
    setSaving(true);
    setErr("");
    const req = isEdit
      ? API.patch(`/calendar/events/${initial.id}`, body)
      : API.post(`/calendar/events`, body);
    req.then(onSaved)
       .catch((e) => setErr(e?.response?.data?.detail || "Save failed"))
       .finally(() => setSaving(false));
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
                {EVENT_TYPES.map((t) => <option key={t}>{t}</option>)}
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
              <input type="number" style={S.inp} value={form.customer_id} onChange={change("customer_id")} disabled={!canManage} placeholder="customer numeric id" />
            </div>
          </div>

          <label style={S.lbl}>Notes</label>
          <textarea style={{ ...S.inp, minHeight: 70 }} value={form.description} onChange={change("description")} disabled={!canManage} />

          {err && <div style={S.errorBar}>{err}</div>}

          <div style={S.modalActions}>
            <button type="button" style={S.smBtn} onClick={onClose}>Cancel</button>
            {canManage && (
              <button type="submit" style={S.newBtn} disabled={saving}>
                {saving ? "Saving…" : (isEdit ? "Save changes" : "Create event")}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}


const S = {
  page:       { padding: 20, background: "var(--surface, #fafafa)", minHeight: "calc(100vh - 60px)" },
  header:     { display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12, marginBottom: 16 },
  title:      { fontSize: 22, fontWeight: 700, color: "#111827" },
  subtitle:   { fontSize: 13, color: "#6b7280" },
  navBtn:     { padding: "6px 12px", border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  monthLabel: { minWidth: 160, textAlign: "center", fontWeight: 700, fontSize: 15 },
  newBtn:     { padding: "8px 14px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 6, fontWeight: 700, cursor: "pointer" },
  errorBar:   { padding: "8px 12px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 6, marginBottom: 12 },
  mainGrid:   { display: "grid", gridTemplateColumns: "minmax(0,1fr) 340px", gap: 16 },
  calendarWrap: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 8 },
  weekRow:    { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4, marginBottom: 4 },
  weekCell:   { textAlign: "center", fontSize: 12, fontWeight: 600, color: "#6b7280", padding: "6px 0" },
  dayGrid:    { display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 },
  dayCell:    { minHeight: 96, border: "1px solid #e5e7eb", borderRadius: 6, padding: 4, cursor: "pointer", display: "flex", flexDirection: "column", gap: 3, overflow: "hidden" },
  dayNum:     { fontSize: 12, fontWeight: 700, textAlign: "right" },
  dayEvents:  { display: "flex", flexDirection: "column", gap: 2, flex: 1 },
  eventChip:  { color: "#fff", fontSize: 11, padding: "2px 5px", borderRadius: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", cursor: "pointer" },
  moreLink:   { fontSize: 10, color: "#6b7280" },
  side:       { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, overflowY: "auto", maxHeight: 640 },
  sideHeader: { fontWeight: 700, fontSize: 14, marginBottom: 10, color: "#111827" },
  muted:      { fontSize: 13, color: "#6b7280", padding: "12px 0" },
  rowCard:    { padding: 10, borderRadius: 8, background: "#fafafa", border: "1px solid #e5e7eb", borderLeft: "3px solid #6b7280", marginBottom: 8 },
  rowTitle:   { fontWeight: 700, fontSize: 13, color: "#111827", display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 4 },
  rowMeta:    { fontSize: 12, color: "#4b5563", marginBottom: 2 },
  rowDesc:    { fontSize: 12, color: "#6b7280", marginTop: 4, whiteSpace: "pre-wrap" },
  rowActions: { display: "flex", gap: 6, marginTop: 8 },
  smBtn:      { padding: "4px 10px", fontSize: 12, border: "1px solid #d1d5db", background: "#fff", borderRadius: 6, cursor: "pointer", fontWeight: 600 },
  badge:      { fontSize: 10, fontWeight: 700, color: "#fff", padding: "2px 6px", borderRadius: 4, letterSpacing: 0.3 },

  modalBackdrop: { position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 },
  modal:      { background: "#fff", borderRadius: 12, width: "100%", maxWidth: 560, maxHeight: "90vh", overflow: "auto" },
  modalHeader:{ padding: "14px 18px", borderBottom: "1px solid #e5e7eb", display: "flex", justifyContent: "space-between", alignItems: "center", fontWeight: 700, fontSize: 15 },
  closeX:     { background: "transparent", border: "none", fontSize: 20, cursor: "pointer", padding: 0 },
  lbl:        { display: "block", fontSize: 12, fontWeight: 600, color: "#374151", margin: "8px 0 4px" },
  inp:        { width: "100%", padding: "8px 10px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 14, boxSizing: "border-box", background: "#fff" },
  grid2:      { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 },
  modalActions:{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 14 },
};
