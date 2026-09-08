import { useEffect, useState } from "react";
import API from "../services/api";

/*  Small "Upcoming Activities" widget you can drop onto a Lead drawer,
    a Customer profile, an Opportunity page — anywhere you want to
    show the next calendar events attached to that entity.

    Props:
      leadId      — filter to events attached to this lead
      customerId  — filter to events attached to this customer
      ownerId     — filter to events owned by this employee (dashboards)
      limit       — default 5

    Also exposes an "Add" button (calendar.manage) that hands off to
    the /calendar page pre-populated with this entity's ID.
*/

const TYPE_ICON = {
  MEETING:   "🤝",
  CALL:      "📞",
  FOLLOW_UP: "🔁",
  DEMO:      "🎬",
  TASK:      "✅",
  OTHER:     "•",
};


export default function UpcomingActivities({
  leadId, customerId, ownerId,
  limit = 5,
  showAddLink = true,
}) {

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const params = { limit };
    if (leadId)     params.lead_id     = leadId;
    if (customerId) params.customer_id = customerId;
    if (ownerId)    params.owner_id    = ownerId;
    // Only future / today's events
    params.from = new Date().toISOString();

    setLoading(true);
    API.get("/calendar/events", { params })
      .then((r) => setItems(r.data || []))
      .catch((e) => setError(e?.response?.data?.detail || "Failed"))
      .finally(() => setLoading(false));
  }, [leadId, customerId, ownerId, limit]);

  const addHref = () => {
    // The /calendar page picks up these query params to pre-fill the modal.
    const q = new URLSearchParams();
    if (leadId)     q.set("lead_id",     leadId);
    if (customerId) q.set("customer_id", String(customerId));
    q.set("new", "1");
    return `/calendar?${q.toString()}`;
  };

  return (
    <div style={S.wrap}>
      <div style={S.header}>
        <div style={S.title}>Upcoming activities</div>
        {showAddLink && (
          <a href={addHref()} style={S.addLink}>+ Add</a>
        )}
      </div>

      {loading && <div style={S.muted}>Loading…</div>}
      {!loading && error && <div style={S.err}>{error}</div>}
      {!loading && !error && items.length === 0 && (
        <div style={S.muted}>No upcoming activities.</div>
      )}

      {items.map((ev) => {
        const d = new Date(ev.start_at);
        const dLabel = d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
        const tLabel = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        return (
          <div key={ev.id} style={S.row}>
            <div style={S.rowIcon}>{TYPE_ICON[ev.event_type] || "•"}</div>
            <div style={S.rowBody}>
              <div style={S.rowTitle}>{ev.title}</div>
              <div style={S.rowMeta}>
                {dLabel} · {tLabel}
                {ev.owner_name && <> · {ev.owner_name}</>}
              </div>
              {ev.location && <div style={S.rowMeta}>{ev.location}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}


const S = {
  wrap:    { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 10, padding: 12 },
  header:  { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  title:   { fontWeight: 700, fontSize: 13, color: "#111827" },
  addLink: { fontSize: 12, color: "#dc2626", textDecoration: "none", fontWeight: 600 },
  muted:   { fontSize: 12, color: "#6b7280", padding: "8px 0" },
  err:     { fontSize: 12, color: "#b91c1c" },
  row:     { display: "flex", gap: 10, padding: "8px 0", borderTop: "1px solid #f1f5f9" },
  rowIcon: { fontSize: 18, lineHeight: 1 },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle:{ fontWeight: 600, fontSize: 13, color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
  rowMeta: { fontSize: 11, color: "#6b7280" },
};
