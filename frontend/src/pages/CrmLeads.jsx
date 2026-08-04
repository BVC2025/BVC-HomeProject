import { useEffect, useMemo, useState } from "react";

import API from "../services/api";

import styles from "./CrmLeads.module.css";


// ===================================================================
// CRM Leads — the pre-customer pipeline (Phase 1 of the CRM & Sales
// redesign). NEW -> ASSIGNED -> CONTACTED -> QUALIFIED ->
// REQUIREMENT_DISCUSSION -> PROPOSAL_NEEDED -> QUOTATION_REQUESTED ->
// QUOTATION_GENERATED -> NEGOTIATION -> WON / LOST / CANCELLED.
//
// A lead only ever becomes a Customer via the "Convert to Customer"
// action (POST /crm/leads/{id}/convert) — this page never writes to
// the Customer table directly.
// ===================================================================


const STATUS_PIPELINE = [
  "NEW", "ASSIGNED", "CONTACTED", "QUALIFIED", "REQUIREMENT_DISCUSSION",
  "PROPOSAL_NEEDED", "QUOTATION_REQUESTED", "QUOTATION_GENERATED",
  "NEGOTIATION", "WON", "LOST", "CANCELLED"
];

const STATUS_LABEL = {
  NEW: "New",
  ASSIGNED: "Assigned",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  REQUIREMENT_DISCUSSION: "Requirement Discussion",
  PROPOSAL_NEEDED: "Proposal Needed",
  QUOTATION_REQUESTED: "Quotation Requested",
  QUOTATION_GENERATED: "Quotation Generated",
  NEGOTIATION: "Negotiation",
  WON: "Won",
  LOST: "Lost",
  CANCELLED: "Cancelled"
};

const STATUS_THEMES = {
  NEW: { bg: "#e0e7ff", fg: "#3730a3", color: "#4f46e5" },
  ASSIGNED: { bg: "#dbeafe", fg: "#1e40af", color: "#1d4ed8" },
  CONTACTED: { bg: "#cffafe", fg: "#0e7490", color: "#0891b2" },
  QUALIFIED: { bg: "#dcfce7", fg: "#166534", color: "#16a34a" },
  REQUIREMENT_DISCUSSION: { bg: "#fef9c3", fg: "#854d0e", color: "#ca8a04" },
  PROPOSAL_NEEDED: { bg: "#fef3c7", fg: "#92400e", color: "#d97706" },
  QUOTATION_REQUESTED: { bg: "#ffedd5", fg: "#9a3412", color: "#ea580c" },
  QUOTATION_GENERATED: { bg: "#fce7f3", fg: "#9d174d", color: "#db2777" },
  NEGOTIATION: { bg: "#f3e8ff", fg: "#6b21a8", color: "#9333ea" },
  WON: { bg: "#dcfce7", fg: "#166534", color: "#059669" },
  LOST: { bg: "#fee2e2", fg: "#991b1b", color: "#dc2626" },
  CANCELLED: { bg: "#f1f5f9", fg: "#475569", color: "#94a3b8" }
};

const ACTIVE_STATUSES = STATUS_PIPELINE.filter(
  (s) => !["WON", "LOST", "CANCELLED"].includes(s)
);

const SOURCES = [
  "WEBSITE", "PORTAL", "PHONE", "WHATSAPP", "EMAIL", "EXCEL_IMPORT",
  "INDIAMART", "REFERRAL", "TRADE_FAIR", "SOCIAL_MEDIA", "COLD_CALL",
  "MANUAL", "OTHER"
];


const Icon = {
  search: (p) => (
    <svg width={p?.size || 16} height={p?.size || 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  funnel: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h16l-6 8v7l-4-2v-5z" />
    </svg>
  ),
  inbox: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 12h-6l-2 3h-4l-2-3H2" />
      <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  ),
  trophy: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />
      <path d="M7 5H4a1 1 0 0 0-1 1 4 4 0 0 0 4 4M17 5h3a1 1 0 0 1 1 1 4 4 0 0 1-4 4" />
    </svg>
  ),
  clock: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
    </svg>
  ),
  user: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  phone: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  mail: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  plus: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
  close: (p) => (
    <svg width={p?.size || 16} height={p?.size || 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  ),
};


function StatTile({ label, value, sub, color, icon }) {
  return (
    <div className={styles.statTile}>
      <div className={styles.statTileIconWrap} style={{ background: `${color}1a`, color }}>
        {icon}
      </div>
      <div className={styles.statTileLabel}>{label}</div>
      <div className={styles.statTileValue}>{value}</div>
      {sub && <div className={styles.statTileSub}>{sub}</div>}
    </div>
  );
}


function StatusPill({ status }) {
  const t = STATUS_THEMES[status] || STATUS_THEMES.NEW;
  return (
    <span className={styles.statusPill} style={{ background: t.bg, color: t.fg }}>
      {STATUS_LABEL[status] || status}
    </span>
  );
}


function LeadCard({ lead, onOpen }) {
  const theme = STATUS_THEMES[lead.STATUS] || STATUS_THEMES.NEW;

  return (
    <div onClick={() => onOpen(lead)} className={styles.card}>
      <div className={styles.cardAccentBar} style={{ background: theme.color }} />

      <div className={styles.cardHeader}>
        <div className={styles.cardAvatar} style={{ background: theme.color }}>
          {(lead.COMPANY_NAME || "?").charAt(0).toUpperCase()}
        </div>
        <div className={styles.cardMeta}>
          <div className={styles.cardCode}>{lead.LEAD_CODE || "—"}</div>
          <div className={styles.cardName}>{lead.COMPANY_NAME}</div>
          <div className={styles.cardBadgeRow}>
            <StatusPill status={lead.STATUS} />
            {lead.PRIORITY === "HIGH" && (
              <span className={styles.highPriorityBadge}>HIGH PRIORITY</span>
            )}
          </div>
        </div>
      </div>

      {lead.ASSIGNED_SALES_NAME && (
        <div className={styles.salesOwnerBanner}>
          Sales owner: <strong>{lead.ASSIGNED_SALES_NAME}</strong>
        </div>
      )}

      <div className={styles.contactList}>
        {lead.CONTACT_PERSON && (
          <div className={styles.contactListRow}>
            <Icon.user />
            <span>{lead.CONTACT_PERSON}</span>
          </div>
        )}
        <div className={styles.contactListRow}>
          <Icon.phone />
          <span>{lead.PHONE || "—"}</span>
        </div>
        <div className={`${styles.contactListRow} ${styles.contactListRowTruncate}`}>
          <Icon.mail />
          <span>{lead.EMAIL || "—"}</span>
        </div>
      </div>

      <div className={styles.tagRow}>
        <span className={styles.tagSource}>via {lead.SOURCE || "MANUAL"}</span>
        {(lead.CITY || lead.STATE) && (
          <span className={styles.tagLocation}>
            {[lead.CITY, lead.STATE].filter(Boolean).join(", ")}
          </span>
        )}
      </div>

      <div className={styles.cardFooter}>
        Open lead
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="9 6 15 12 9 18" />
        </svg>
      </div>
    </div>
  );
}


function NewLeadModal({ onClose, onSaved }) {
  const [form, setForm] = useState({
    COMPANY_NAME: "", CONTACT_PERSON: "", PHONE: "", EMAIL: "",
    CITY: "", STATE: "", SOURCE: "MANUAL", PRIORITY: "MEDIUM",
    REQUIREMENT_NOTES: ""
  });
  const [saving, setSaving] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.COMPANY_NAME.trim()) {
      alert("Company / lead name is required");
      return;
    }
    setSaving(true);
    try {
      await API.post("/crm/leads", { ...form, VENDOR_ID: 1 });
      onSaved();
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to save lead");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.editorOverlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.editorPanel}>
        <div className={styles.editorHeader}>
          <div className={styles.editorHeaderTitle}>New Lead</div>
          <button onClick={onClose} className={styles.editorCloseBtn}>
            <Icon.close />
          </button>
        </div>

        <form onSubmit={submit} className={styles.editorForm}>
          <label className={styles.fieldLabel}>Company / Lead Name *</label>
          <input value={form.COMPANY_NAME} onChange={set("COMPANY_NAME")} className={styles.input} placeholder="Chennai Metro Rail Ltd" />

          <div className={styles.grid2}>
            <div>
              <label className={styles.fieldLabel}>Contact Person</label>
              <input value={form.CONTACT_PERSON} onChange={set("CONTACT_PERSON")} className={styles.input} />
            </div>
            <div>
              <label className={styles.fieldLabel}>Priority</label>
              <select value={form.PRIORITY} onChange={set("PRIORITY")} className={styles.input}>
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </div>
            <div>
              <label className={styles.fieldLabel}>Phone</label>
              <input value={form.PHONE} onChange={set("PHONE")} className={styles.input} placeholder="9876543210" />
            </div>
            <div>
              <label className={styles.fieldLabel}>Email</label>
              <input type="email" value={form.EMAIL} onChange={set("EMAIL")} className={styles.input} />
            </div>
            <div>
              <label className={styles.fieldLabel}>City</label>
              <input value={form.CITY} onChange={set("CITY")} className={styles.input} />
            </div>
            <div>
              <label className={styles.fieldLabel}>Source</label>
              <select value={form.SOURCE} onChange={set("SOURCE")} className={styles.input}>
                {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>

          <label className={styles.fieldLabel}>Requirement Notes</label>
          <textarea rows={3} value={form.REQUIREMENT_NOTES} onChange={set("REQUIREMENT_NOTES")} className={styles.input} placeholder="What are they asking about?" />

          <div className={styles.editorActions}>
            <button type="button" onClick={onClose} className={styles.cancelBtn}>Cancel</button>
            <button type="submit" disabled={saving} className={styles.saveBtn}>
              {saving ? "Saving…" : "Create Lead"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


function LeadDrawer({ lead, onClose, onChanged }) {
  const [current, setCurrent] = useState(lead);
  const [activities, setActivities] = useState([]);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [noteType, setNoteType] = useState("CALL");
  const [noteText, setNoteText] = useState("");
  const [busy, setBusy] = useState(false);

  const loadActivities = () => {
    setLoadingActivities(true);
    API.get(`/crm/leads/${lead.ID}/activities`)
      .then((r) => setActivities(r.data || []))
      .catch(() => setActivities([]))
      .finally(() => setLoadingActivities(false));
  };

  useEffect(() => { loadActivities(); }, [lead.ID]);

  const changeStatus = async (status) => {
    setBusy(true);
    try {
      const r = await API.patch(`/crm/leads/${current.ID}`, { STATUS: status });
      setCurrent(r.data);
      loadActivities();
      onChanged();
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to update status");
    } finally {
      setBusy(false);
    }
  };

  const logActivity = async () => {
    if (!noteText.trim()) return;
    setBusy(true);
    try {
      await API.post(`/crm/leads/${current.ID}/activities`, {
        EVENT_TYPE: noteType,
        EVENT_DETAIL: noteText.trim()
      });
      setNoteText("");
      loadActivities();
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to log activity");
    } finally {
      setBusy(false);
    }
  };

  const convert = async () => {
    if (!window.confirm(
      `Convert "${current.COMPANY_NAME}" to a Customer?\n\n` +
      `This creates a real Customer master record and marks this lead Won. ` +
      `You'll be able to create a Quotation right after.`
    )) return;

    setBusy(true);
    try {
      const r = await API.post(`/crm/leads/${current.ID}/convert`);
      alert(`Converted! Customer ${r.data.customer_code} created — find them on the Customers page.`);
      onChanged();
      onClose();
    } catch (err) {
      alert(err?.response?.data?.detail || "Failed to convert");
    } finally {
      setBusy(false);
    }
  };

  const isConverted = !!current.CONVERTED_CUSTOMER_ID;
  const isFinal = ["WON", "LOST", "CANCELLED"].includes(current.STATUS);

  return (
    <div className={styles.editorOverlay} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className={styles.drawerPanel}>
        <div className={styles.editorHeader}>
          <div>
            <div className={styles.editorHeaderLabel}>{current.LEAD_CODE}</div>
            <div className={styles.editorHeaderTitle}>{current.COMPANY_NAME}</div>
          </div>
          <button onClick={onClose} className={styles.editorCloseBtn}>
            <Icon.close />
          </button>
        </div>

        <div className={styles.drawerBody}>
          <div className={styles.drawerSection}>
            <StatusPill status={current.STATUS} />
            {isConverted && (
              <span className={styles.convertedNote}>
                Converted to customer #{current.CONVERTED_CUSTOMER_ID}
              </span>
            )}
          </div>

          {!isConverted && (
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Move to</div>
              <div className={styles.statusChipRow}>
                {ACTIVE_STATUSES.map((s) => (
                  <button
                    key={s}
                    disabled={busy || s === current.STATUS}
                    onClick={() => changeStatus(s)}
                    className={`${styles.statusChip}${s === current.STATUS ? ` ${styles.statusChipActive}` : ""}`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
                ))}
                <button
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt("Reason for marking this lead Lost?") || "";
                    API.patch(`/crm/leads/${current.ID}`, { LOST_REASON: reason }).then(() =>
                      changeStatus("LOST")
                    );
                  }}
                  className={`${styles.statusChip} ${styles.statusChipDanger}`}
                >
                  Lost
                </button>
              </div>

              <button disabled={busy} onClick={convert} className={styles.convertBtn}>
                <Icon.trophy size={15} /> Convert to Customer
              </button>
            </div>
          )}

          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionTitle}>Contact</div>
            <div className={styles.detailGrid}>
              <div><span className={styles.detailLabel}>Contact</span>{current.CONTACT_PERSON || "—"}</div>
              <div><span className={styles.detailLabel}>Phone</span>{current.PHONE || "—"}</div>
              <div><span className={styles.detailLabel}>Email</span>{current.EMAIL || "—"}</div>
              <div><span className={styles.detailLabel}>Location</span>{[current.CITY, current.STATE].filter(Boolean).join(", ") || "—"}</div>
              <div><span className={styles.detailLabel}>Source</span>{current.SOURCE || "—"}</div>
              <div><span className={styles.detailLabel}>Sales owner</span>{current.ASSIGNED_SALES_NAME || "Unassigned"}</div>
            </div>
            {current.REQUIREMENT_NOTES && (
              <div className={styles.reqNotes}>{current.REQUIREMENT_NOTES}</div>
            )}
          </div>

          {!isFinal && (
            <div className={styles.drawerSection}>
              <div className={styles.drawerSectionTitle}>Log an activity</div>
              <div className={styles.activityForm}>
                <select value={noteType} onChange={(e) => setNoteType(e.target.value)} className={styles.input}>
                  <option value="CALL">Call</option>
                  <option value="MEETING">Meeting</option>
                  <option value="EMAIL">Email</option>
                  <option value="WHATSAPP">WhatsApp</option>
                  <option value="NOTE">Note</option>
                </select>
                <input
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="What happened?"
                  className={styles.input}
                  onKeyDown={(e) => e.key === "Enter" && logActivity()}
                />
                <button disabled={busy} onClick={logActivity} className={styles.logBtn}>Log</button>
              </div>
            </div>
          )}

          <div className={styles.drawerSection}>
            <div className={styles.drawerSectionTitle}>Timeline</div>
            {loadingActivities && <div className={styles.loadingMsg}>Loading…</div>}
            {!loadingActivities && activities.length === 0 && (
              <div className={styles.loadingMsg}>No activity yet.</div>
            )}
            <div className={styles.timeline}>
              {activities.map((a) => (
                <div key={a.ID} className={styles.timelineRow}>
                  <div className={styles.timelineDot} />
                  <div>
                    <div className={styles.timelineEvent}>
                      {a.EVENT_TYPE.replace(/_/g, " ")}
                      {a.ACTOR_NAME && <span className={styles.timelineActor}> · {a.ACTOR_NAME}</span>}
                    </div>
                    {a.EVENT_DETAIL && <div className={styles.timelineDetail}>{a.EVENT_DETAIL}</div>}
                    <div className={styles.timelineTime}>
                      <Icon.clock /> {a.CREATED_AT ? new Date(a.CREATED_AT).toLocaleString() : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}


export default function CrmLeads() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [creating, setCreating] = useState(false);
  const [opened, setOpened] = useState(null);

  const fetchAll = () => {
    setLoading(true);
    API.get("/crm/leads")
      .then((r) => setLeads(r.data || []))
      .catch(() => setLeads([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { fetchAll(); }, []);

  const statusCounts = useMemo(() => {
    const counts = { ALL: leads.length, ACTIVE: 0, WON: 0, LOST: 0 };
    leads.forEach((l) => {
      if (l.STATUS === "WON") counts.WON += 1;
      else if (["LOST", "CANCELLED"].includes(l.STATUS)) counts.LOST += 1;
      else counts.ACTIVE += 1;
    });
    return counts;
  }, [leads]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return leads.filter((l) => {
      if (statusFilter === "ACTIVE" && ["WON", "LOST", "CANCELLED"].includes(l.STATUS)) return false;
      if (statusFilter === "WON" && l.STATUS !== "WON") return false;
      if (statusFilter === "LOST" && !["LOST", "CANCELLED"].includes(l.STATUS)) return false;
      if (q) {
        const hay = [l.COMPANY_NAME, l.LEAD_CODE, l.CONTACT_PERSON, l.PHONE, l.EMAIL, l.CITY]
          .filter(Boolean).join(" ").toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [leads, search, statusFilter]);

  const FILTERS = [
    { key: "", label: "All", countKey: "ALL", color: "#0f172a" },
    { key: "ACTIVE", label: "Active", countKey: "ACTIVE", color: "#4f46e5" },
    { key: "WON", label: "Won", countKey: "WON", color: "#059669" },
    { key: "LOST", label: "Lost / Cancelled", countKey: "LOST", color: "#dc2626" },
  ];

  return (
    <div className={styles.pageWrapper}>
      <div className={styles.hero}>
        <div>
          <div className={styles.heroLabel}>CRM</div>
          <h1 className={styles.heroTitle}>Leads</h1>
        </div>
        <div className={styles.heroActions}>
          <button onClick={() => setCreating(true)} className={styles.heroBtnSolid}>
            <Icon.plus size={13} /> Add Lead
          </button>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <StatTile label="Total leads" value={statusCounts.ALL} color="#0f172a" icon={<Icon.funnel size={20} />} />
        <StatTile label="In pipeline" value={statusCounts.ACTIVE} sub="being worked" color="#4f46e5" icon={<Icon.inbox size={20} />} />
        <StatTile label="Won" value={statusCounts.WON} sub="became customers" color="#059669" icon={<Icon.trophy size={20} />} />
        <StatTile label="Lost / Cancelled" value={statusCounts.LOST} color="#dc2626" icon={<Icon.close size={20} />} />
      </div>

      <div className={styles.filterBar}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}><Icon.search size={16} /></span>
          <input
            type="text"
            placeholder="Search by name, code, contact, phone, city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <div className={styles.chipRow}>
          {FILTERS.map((f) => {
            const active = statusFilter === f.key;
            return (
              <button
                key={f.key || "all"}
                type="button"
                onClick={() => setStatusFilter(f.key)}
                className={`${styles.chip}${active ? ` ${styles.chipActive}` : ""}`}
              >
                <span>{f.label}</span>
                <span
                  className={`${styles.chipBadge}${active ? ` ${styles.chipBadgeActive}` : ""}`}
                  style={!active ? { background: `${f.color}20`, color: f.color } : undefined}
                >
                  {statusCounts[f.countKey]}
                </span>
              </button>
            );
          })}
        </div>

        <div className={styles.filterCount}>{filtered.length} of {leads.length}</div>
      </div>

      {loading && <div className={styles.loadingMsg}>Loading leads…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          <div className={styles.emptyStateIcon}>
            {leads.length === 0 ? <Icon.funnel size={40} /> : <Icon.search size={36} />}
          </div>
          <div className={styles.emptyStateTitle}>
            {leads.length === 0 ? "No leads yet" : "No matches for these filters"}
          </div>
          <div className={styles.emptyStateSub}>
            {leads.length === 0
              ? "New website enquiries land here automatically — or add one manually."
              : "Try a different search term, or clear the filters."}
          </div>
          {leads.length === 0 && (
            <button type="button" onClick={() => setCreating(true)} className={styles.emptyStateBtn}>
              <Icon.plus size={13} /> Add Lead
            </button>
          )}
        </div>
      )}

      <div className={styles.cardsGrid}>
        {filtered.map((l) => (
          <LeadCard key={l.ID} lead={l} onOpen={setOpened} />
        ))}
      </div>

      {creating && (
        <NewLeadModal onClose={() => setCreating(false)} onSaved={() => { setCreating(false); fetchAll(); }} />
      )}

      {opened && (
        <LeadDrawer lead={opened} onClose={() => setOpened(null)} onChanged={fetchAll} />
      )}
    </div>
  );
}
