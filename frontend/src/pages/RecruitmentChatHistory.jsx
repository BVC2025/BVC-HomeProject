import { useEffect, useMemo, useState } from "react";
import API from "../services/api";

/* Recruitment Chat History — admin view of everything HR has said to
   Deepthi. Sidebar lists employees who chatted; right panel renders
   the full transcript with role/provider/action badges + draft
   snapshots inlined.

   Data source:
     GET  /recruitment/voice-agent/history/employees
     GET  /recruitment/voice-agent/history/employee/{id}?limit=500
     DEL  /recruitment/voice-agent/history/employee/{id}    (recruitment.manage)
*/

const BVC_RED    = "#C8102E";
const BVC_DARK   = "#7A1022";
const BADGE_BG = {
  CHIT_CHAT:     "#dbeafe",
  NEED_MORE:     "#fef3c7",
  PROPOSE_DRAFT: "#dcfce7",
};
const BADGE_FG = {
  CHIT_CHAT:     "#1e40af",
  NEED_MORE:     "#854d0e",
  PROPOSE_DRAFT: "#166534",
};


export default function RecruitmentChatHistory() {

  const [employees, setEmployees] = useState([]);
  const [selected,  setSelected]  = useState(null);
  const [messages,  setMessages]  = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState("");

  const load = () => {
    setLoading(true);
    setError("");
    API.get("/recruitment/voice-agent/history/employees")
      .then((r) => setEmployees(Array.isArray(r.data) ? r.data : []))
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  useEffect(() => {
    if (!selected?.employee_id) { setMessages([]); return; }
    setDetailBusy(true);
    API.get(`/recruitment/voice-agent/history/employee/${selected.employee_id}`)
      .then((r) => setMessages(r.data?.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setDetailBusy(false));
  }, [selected]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter(e =>
      (e.employee_name || "").toLowerCase().includes(q) ||
      (e.employee_code || "").toLowerCase().includes(q)
    );
  }, [employees, filter]);

  const deleteTranscript = () => {
    if (!selected?.employee_id) return;
    if (!window.confirm(`Delete Deepthi's entire transcript for ${selected.employee_name}? This cannot be undone.`)) return;
    API.delete(`/recruitment/voice-agent/history/employee/${selected.employee_id}`)
      .then(() => { setSelected(null); setMessages([]); load(); })
      .catch((e) => window.alert(e?.response?.data?.detail || "Delete failed"));
  };

  return (
    <div style={S.page}>
      <div style={S.header}>
        <div>
          <div style={S.eyebrow}>BVC24 · Recruitment Assistant</div>
          <div style={S.title}>Deepthi — Chat History</div>
          <div style={S.subtitle}>
            Everything HR has asked, along with the reply Deepthi gave. Useful for
            audit, prompt-tuning, and catching mis-classified requests.
          </div>
        </div>
        <button style={S.refresh} onClick={load} disabled={loading}>
          {loading ? "Loading…" : "Refresh"}
        </button>
      </div>

      {error && <div style={S.errorBar}>{error}</div>}

      <div style={S.grid}>
        {/* Sidebar */}
        <div style={S.sidebar}>
          <input
            style={S.search}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Search employees…"
          />
          {loading && <div style={S.muted}>Loading…</div>}
          {!loading && filtered.length === 0 && (
            <div style={S.muted}>
              {employees.length === 0
                ? "No one has chatted with Deepthi yet."
                : "No match for that filter."}
            </div>
          )}
          {filtered.map((e) => {
            const active = selected?.employee_id === e.employee_id;
            return (
              <button
                key={e.employee_id || "anon"}
                onClick={() => setSelected(e)}
                style={{ ...S.empRow, ...(active ? S.empRowActive : {}) }}
              >
                <div style={S.empName}>
                  {e.employee_name || "(unknown)"}
                  {e.employee_code && <span style={S.empCode}> · {e.employee_code}</span>}
                </div>
                <div style={S.empMeta}>
                  {e.message_count} msgs
                  {e.last_activity && (
                    <>  ·  {new Date(e.last_activity).toLocaleString("en-IN", {
                      dateStyle: "medium", timeStyle: "short",
                    })}</>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Transcript */}
        <div style={S.transcript}>
          {!selected && (
            <div style={S.muted}>Select an employee on the left to see their transcript with Deepthi.</div>
          )}
          {selected && (
            <>
              <div style={S.tHead}>
                <div>
                  <div style={S.tName}>{selected.employee_name}</div>
                  <div style={S.tMeta}>
                    {selected.employee_code} · {selected.message_count} messages
                  </div>
                </div>
                <button style={S.dangerBtn} onClick={deleteTranscript}>Delete transcript</button>
              </div>

              {detailBusy && <div style={S.muted}>Loading messages…</div>}

              {!detailBusy && messages.length === 0 && (
                <div style={S.muted}>No messages saved for this employee.</div>
              )}

              <div style={S.thread}>
                {messages.map((m) => {
                  const isUser = m.role === "user";
                  return (
                    <div key={m.id} style={S.row(isUser)}>
                      <div style={S.bubble(isUser)}>
                        <div style={S.bMeta}>
                          <span style={S.bWho}>{isUser ? "HR" : "Deepthi"}</span>
                          {m.action && (
                            <span style={{
                              ...S.actionBadge,
                              background: BADGE_BG[m.action] || "#f1f5f9",
                              color:      BADGE_FG[m.action] || "#475569",
                            }}>{m.action}</span>
                          )}
                          {m.provider && !isUser && (
                            <span style={S.providerBadge}>{m.provider}</span>
                          )}
                          {m.language && isUser && (
                            <span style={S.langBadge}>{m.language.toUpperCase()}</span>
                          )}
                          <span style={S.time}>
                            {m.created_at && new Date(m.created_at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                          </span>
                        </div>
                        <div style={S.bText}>{m.content}</div>
                        {m.draft && (
                          <details style={S.draftBox}>
                            <summary style={S.draftSummary}>Draft snapshot at this turn</summary>
                            <pre style={S.draftJson}>{JSON.stringify(m.draft, null, 2)}</pre>
                          </details>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


const S = {
  page:       { padding: 20, minHeight: "calc(100vh - 80px)", background: "#f1f5f9" },
  header:     { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, marginBottom: 14, flexWrap: "wrap" },
  eyebrow:    { fontSize: 10, fontWeight: 800, letterSpacing: 2, color: BVC_DARK, textTransform: "uppercase" },
  title:      { fontSize: 22, fontWeight: 900, color: "#0f172a", marginTop: 4 },
  subtitle:   { fontSize: 12, color: "#64748b", maxWidth: 560, marginTop: 4 },
  refresh:    { padding: "8px 14px", background: BVC_RED, color: "#fff", border: "none", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer" },
  errorBar:   { padding: "10px 14px", background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca", borderRadius: 8, marginBottom: 10 },
  grid:       { display: "grid", gridTemplateColumns: "320px 1fr", gap: 14, alignItems: "start" },

  sidebar:    { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 10, maxHeight: "78vh", overflowY: "auto" },
  search:     { width: "100%", padding: "8px 12px", border: "1px solid #cbd5e1", borderRadius: 8, fontSize: 13, marginBottom: 8, boxSizing: "border-box" },
  muted:      { padding: "10px 6px", color: "#94a3b8", fontSize: 13 },

  empRow:     { display: "block", width: "100%", textAlign: "left", padding: "9px 10px", border: "none", borderRadius: 8, background: "transparent", cursor: "pointer", marginBottom: 4 },
  empRowActive: { background: "#fef2f2", boxShadow: "inset 3px 0 0 " + BVC_RED },
  empName:    { fontWeight: 700, fontSize: 13, color: "#0f172a" },
  empCode:    { color: "#94a3b8", fontWeight: 500 },
  empMeta:    { fontSize: 11, color: "#64748b", marginTop: 2 },

  transcript: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 14, minHeight: "60vh" },
  tHead:      { display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid #e5e7eb", paddingBottom: 10, marginBottom: 10 },
  tName:      { fontWeight: 800, fontSize: 15, color: "#0f172a" },
  tMeta:      { fontSize: 12, color: "#64748b" },
  dangerBtn:  { padding: "6px 12px", background: "#fff", color: "#b91c1c", border: "1px solid #fca5a5", borderRadius: 6, fontWeight: 700, fontSize: 12, cursor: "pointer" },

  thread:     { display: "flex", flexDirection: "column", gap: 10 },
  row:        (isUser) => ({ display: "flex", justifyContent: isUser ? "flex-end" : "flex-start" }),
  bubble:     (isUser) => ({
    maxWidth: "78%",
    padding: "10px 14px",
    borderRadius: 12,
    background: isUser ? BVC_RED : "#f8fafc",
    color:      isUser ? "#ffffff" : "#0f172a",
    border:     isUser ? "none" : "1px solid #e5e7eb",
  }),
  bMeta:      { display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, marginBottom: 6, fontSize: 10 },
  bWho:       { fontWeight: 800, letterSpacing: 0.5, textTransform: "uppercase", opacity: 0.85 },
  actionBadge:  { padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: 9, letterSpacing: 0.5 },
  providerBadge:{ padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: 9, background: "#f1f5f9", color: "#475569" },
  langBadge:  { padding: "2px 6px", borderRadius: 4, fontWeight: 700, fontSize: 9, background: "rgba(255,255,255,0.25)" },
  time:       { marginLeft: "auto", opacity: 0.6, fontSize: 10 },
  bText:      { fontSize: 13, lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" },
  draftBox:   { marginTop: 8, fontSize: 12 },
  draftSummary: { cursor: "pointer", fontWeight: 600, opacity: 0.75 },
  draftJson:  { background: "#0f172a", color: "#e2e8f0", padding: 10, borderRadius: 6, fontSize: 11, marginTop: 4, overflowX: "auto" },
};
