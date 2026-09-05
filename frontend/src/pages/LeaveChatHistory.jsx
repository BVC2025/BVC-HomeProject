import { useEffect, useMemo, useState } from "react";
import API from "../services/api";

/* Admin Chat History page.

   Shows every conversation the Voice Leave Assistant has stored.
   Left rail: list of employees who have chatted (name + code, unread-
   style counter of total messages, last-activity timestamp).
   Main pane: full transcript of the selected employee, oldest turn
   first, styled like the chat itself so admins can review the
   dialogue as it happened.

   Purpose: monitor for off-topic / inappropriate use of the
   assistant. RBAC is enforced by the route in rbac.js (leave.view.all).
*/

const S = {
  page: {
    display: "flex",
    height: "calc(100vh - 90px)",
    background: "var(--surface, #f9fafb)",
    borderRadius: 12,
    overflow: "hidden",
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
    margin: "16px 24px",
    border: "1px solid var(--border, #e5e7eb)",
  },
  rail: {
    width: 320,
    minWidth: 260,
    borderRight: "1px solid var(--border, #e5e7eb)",
    background: "var(--card-bg, #ffffff)",
    display: "flex",
    flexDirection: "column",
  },
  railHeader: {
    padding: "16px 20px",
    borderBottom: "1px solid var(--border, #e5e7eb)",
    background: "linear-gradient(90deg, #dc2626, #b91c1c)",
    color: "#ffffff",
  },
  railTitle: { margin: 0, fontSize: 16, fontWeight: 700 },
  railSub:   { margin: "4px 0 0 0", fontSize: 12, opacity: 0.9 },
  railSearch: {
    padding: "10px 12px",
    borderBottom: "1px solid var(--border, #e5e7eb)",
  },
  railInput: {
    width: "100%",
    padding: "8px 12px",
    borderRadius: 8,
    border: "1px solid var(--border, #d1d5db)",
    background: "var(--card-bg, #ffffff)",
    color: "inherit",
    fontSize: 13,
    outline: "none",
    boxSizing: "border-box",
  },
  railList: { overflowY: "auto", flex: 1 },
  railItem: (active) => ({
    padding: "12px 16px",
    borderBottom: "1px solid var(--border, #f3f4f6)",
    cursor: "pointer",
    background: active ? "#fef2f2" : "transparent",
    borderLeft: `3px solid ${active ? "#dc2626" : "transparent"}`,
    display: "flex",
    flexDirection: "column",
    gap: 4,
  }),
  railName: { fontWeight: 600, fontSize: 14, color: "var(--text, #1f2937)" },
  railCode: { fontSize: 11, color: "#9ca3af", fontFamily: "monospace" },
  railMeta: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 4,
    fontSize: 11,
    color: "#6b7280",
  },
  msgCount: {
    background: "#fee2e2",
    color: "#b91c1c",
    padding: "2px 8px",
    borderRadius: 999,
    fontWeight: 600,
    fontSize: 11,
  },
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    minWidth: 0,
    background: "var(--surface, #f9fafb)",
  },
  mainHeader: {
    padding: "16px 24px",
    background: "var(--card-bg, #ffffff)",
    borderBottom: "1px solid var(--border, #e5e7eb)",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  mainTitle: { margin: 0, fontSize: 16, fontWeight: 700, color: "var(--text, #1f2937)" },
  mainSub:   { margin: "2px 0 0 0", fontSize: 12, color: "#6b7280" },
  deleteBtn: {
    padding: "8px 14px",
    borderRadius: 8,
    border: "1px solid #dc2626",
    background: "#ffffff",
    color: "#dc2626",
    fontWeight: 600,
    fontSize: 12,
    cursor: "pointer",
  },
  transcript: {
    flex: 1,
    overflowY: "auto",
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 10,
  },
  row: (isUser) => ({
    display: "flex",
    justifyContent: isUser ? "flex-end" : "flex-start",
  }),
  bubble: (isUser) => ({
    maxWidth: "70%",
    padding: "10px 14px",
    borderRadius: 14,
    background: isUser ? "#dc2626" : "var(--card-bg, #ffffff)",
    color: isUser ? "#ffffff" : "var(--text, #1f2937)",
    border: isUser ? "none" : "1px solid var(--border, #e5e7eb)",
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
  }),
  stamp: (isUser) => ({
    fontSize: 10,
    color: "#9ca3af",
    marginTop: 4,
    textAlign: isUser ? "right" : "left",
    paddingLeft: isUser ? 0 : 4,
    paddingRight: isUser ? 4 : 0,
  }),
  actionBadge: {
    display: "inline-block",
    marginLeft: 6,
    padding: "1px 6px",
    borderRadius: 4,
    background: "#f0fdf4",
    color: "#166534",
    fontSize: 10,
    fontWeight: 600,
  },
  empty: {
    padding: 40,
    textAlign: "center",
    color: "#9ca3af",
    fontSize: 14,
  },
  bannerErr: {
    margin: "16px 24px",
    padding: "10px 14px",
    background: "#fef2f2",
    color: "#b91c1c",
    border: "1px solid #fecaca",
    borderRadius: 8,
    fontSize: 13,
  },
};

function fmtTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch (_) {
    return iso;
  }
}

function fmtRelative(iso) {
  if (!iso) return "never";
  const d = new Date(iso);
  const secs = Math.floor((Date.now() - d.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

export default function LeaveChatHistory() {

  const [employees, setEmployees] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [transcript, setTranscript] = useState(null);
  const [loadingList, setLoadingList] = useState(false);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const fetchList = async () => {
    setLoadingList(true);
    setError("");
    try {
      const res = await API.get("/leave-ai-chat/history/employees");
      const rows = Array.isArray(res.data) ? res.data : [];
      setEmployees(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].employee_id);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load chat history list.");
      setEmployees([]);
    } finally {
      setLoadingList(false);
    }
  };

  const fetchTranscript = async (empId) => {
    if (!empId) return;
    setLoadingTranscript(true);
    setError("");
    try {
      const res = await API.get(`/leave-ai-chat/history/${empId}`);
      setTranscript(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load transcript.");
      setTranscript(null);
    } finally {
      setLoadingTranscript(false);
    }
  };

  useEffect(() => {
    fetchList();
  }, []);

  useEffect(() => {
    if (selectedId) fetchTranscript(selectedId);
  }, [selectedId]);

  const clearHistory = async () => {
    if (!transcript?.employee?.id) return;
    if (!window.confirm(
      `Delete ALL chat history for ${transcript.employee.name}? This can't be undone.`
    )) return;
    try {
      await API.delete(`/leave-ai-chat/history/${transcript.employee.id}`);
      await fetchList();
      setTranscript(null);
      setSelectedId(null);
    } catch (e) {
      setError(e?.response?.data?.detail || "Delete failed.");
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return employees;
    return employees.filter((e) =>
      (e.employee_name || "").toLowerCase().includes(q) ||
      (e.employee_code || "").toLowerCase().includes(q)
    );
  }, [employees, search]);

  return (
    <>
      {error && <div style={S.bannerErr}>{error}</div>}
      <div style={S.page}>

        <div style={S.rail}>
          <div style={S.railHeader}>
            <h2 style={S.railTitle}>Chat History</h2>
            <p style={S.railSub}>Voice Leave Assistant conversations</p>
          </div>

          <div style={S.railSearch}>
            <input
              style={S.railInput}
              placeholder="Search by name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <div style={S.railList}>
            {loadingList && <div style={S.empty}>Loading…</div>}
            {!loadingList && filtered.length === 0 && (
              <div style={S.empty}>
                {search
                  ? "No employees match that search."
                  : "No employee has used the assistant yet."}
              </div>
            )}
            {!loadingList && filtered.map((emp) => (
              <div
                key={emp.employee_id}
                style={S.railItem(emp.employee_id === selectedId)}
                onClick={() => setSelectedId(emp.employee_id)}
              >
                <div style={S.railName}>{emp.employee_name || "—"}</div>
                <div style={S.railCode}>{emp.employee_code}</div>
                <div style={S.railMeta}>
                  <span>{fmtRelative(emp.last_activity)}</span>
                  <span style={S.msgCount}>{emp.message_count} msgs</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div style={S.main}>
          <div style={S.mainHeader}>
            <div>
              <h3 style={S.mainTitle}>
                {transcript?.employee?.name || "Select an employee"}
              </h3>
              <p style={S.mainSub}>
                {transcript
                  ? `${transcript.message_count} message${transcript.message_count === 1 ? "" : "s"} · ${transcript.employee.code}`
                  : "Pick a name on the left to see their full transcript"}
              </p>
            </div>
            {transcript && transcript.message_count > 0 && (
              <button style={S.deleteBtn} onClick={clearHistory}>
                Clear history
              </button>
            )}
          </div>

          <div style={S.transcript}>
            {loadingTranscript && <div style={S.empty}>Loading transcript…</div>}
            {!loadingTranscript && !transcript && (
              <div style={S.empty}>Nothing to show.</div>
            )}
            {!loadingTranscript && transcript && transcript.messages.length === 0 && (
              <div style={S.empty}>
                No messages yet for {transcript.employee.name}.
              </div>
            )}
            {!loadingTranscript && transcript && transcript.messages.map((m) => {
              const isUser = m.role === "user";
              return (
                <div key={m.id}>
                  <div style={S.row(isUser)}>
                    <div style={S.bubble(isUser)}>
                      {m.content}
                      {m.action && m.action !== "ANSWER_ONLY" && (
                        <span style={S.actionBadge}>{m.action}</span>
                      )}
                    </div>
                  </div>
                  <div style={S.row(isUser)}>
                    <div style={S.stamp(isUser)}>
                      {fmtTime(m.created_at)}
                      {m.language && m.language !== "auto" && ` · ${m.language}`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
}
