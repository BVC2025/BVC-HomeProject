// =====================================================================
// AIPreCheckPanel — Phase 4
//
// Renders the pre-check response from POST /leave/pre-check:
//   - AI verdict banner (APPROVE / APPROVE_WITH_CAUTION / NEEDS_MD_REVIEW)
//   - CL / SL remaining + late / absent counters
//   - Pending tasks that overlap the leave window, each with a
//     commit-by date input the employee has to fill for HIGH/MEDIUM.
//
// Used by ApplyLeave.jsx (standalone page) and MyLeaveRequest.jsx
// (Employee Portal → Leave tab).
// =====================================================================


const URGENCY_STYLE = {
  HIGH:   { fg: "#b91c1c", bg: "#fee2e2", brd: "#fca5a5", label: "HIGH — due during leave" },
  MEDIUM: { fg: "#b45309", bg: "#fef3c7", brd: "#fcd34d", label: "MEDIUM — due right after leave" },
  LOW:    { fg: "#334155", bg: "#f1f5f9", brd: "#cbd5e1", label: "LOW — no due date" },
};

const VERDICT_STYLE = {
  APPROVE:              { fg: "#065f46", bg: "#ecfdf5", brd: "#10b981", label: "Approve" },
  APPROVE_WITH_CAUTION: { fg: "#92400e", bg: "#fffbeb", brd: "#f59e0b", label: "Approve with caution" },
  NEEDS_MD_REVIEW:      { fg: "#991b1b", bg: "#fef2f2", brd: "#ef4444", label: "Needs MD review" },
};


const styles_pc_label = {
  fontSize: 10, fontWeight: 800, letterSpacing: 1.2,
  textTransform: "uppercase", color: "#64748b",
};
const styles_pc_value = {
  fontSize: 20, fontWeight: 800, color: "#0f172a", marginTop: 2,
};
const styles_pc_smallLabel = {
  display: "block",
  fontSize: 10, fontWeight: 700, letterSpacing: 1,
  textTransform: "uppercase", color: "#64748b",
  marginBottom: 4,
};


export default function AIPreCheckPanel({ preCheck, commitments, setCommitments }) {

  const ai = preCheck?.ai_recommendation || {};
  const v  = VERDICT_STYLE[String(ai.verdict || "").toUpperCase()]
           || VERDICT_STYLE.NEEDS_MD_REVIEW;

  const bal = preCheck?.leave_balance || {};
  const att = preCheck?.attendance_pattern || {};
  const tasks = preCheck?.pending_tasks || [];
  const blockers = preCheck?.blocking_conflicts || [];

  const setCommit = (task_id, field, value) => {
    setCommitments((prev) => ({
      ...prev,
      [task_id]: { ...(prev[task_id] || {}), [field]: value },
    }));
  };

  return (
    <div style={{
      marginTop: 18,
      border: "1px solid #e2e8f0",
      borderRadius: 10,
      background: "white",
    }}>
      {/* AI verdict header */}
      <div style={{
        padding: "12px 16px",
        background: v.bg,
        borderLeft: `3px solid ${v.brd}`,
        borderRadius: "10px 10px 0 0",
      }}>
        <div style={{
          fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2,
          textTransform: "uppercase", color: v.fg,
        }}>
          AI Recommendation · {v.label}
        </div>
        <div style={{
          marginTop: 4, fontSize: 14, fontWeight: 700, color: "#0f172a",
        }}>
          {ai.headline || "No headline"}
        </div>
        {Array.isArray(ai.reasons) && ai.reasons.length > 0 && (
          <ul style={{
            margin: "6px 0 0 16px", padding: 0,
            fontSize: 13, color: "#334155",
          }}>
            {ai.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
        <div style={{
          marginTop: 6, fontSize: 11, fontStyle: "italic", color: "#64748b",
        }}>
          Advisory only — MD is the final decision maker.
        </div>
      </div>

      {/* Policy blocker(s) — surfaced before AI so it's unmistakable */}
      {blockers.length > 0 && (
        <div style={{ padding: "10px 12px", background: "#fef2f2", borderTop: "1px solid #fecaca" }}>
          {blockers.map((b, i) => (
            <div key={i} style={{
              padding: "10px 12px",
              background: "white",
              border: "1px solid #fecaca",
              borderLeft: "3px solid #b91c1c",
              borderRadius: 6,
              marginBottom: i === blockers.length - 1 ? 0 : 8,
            }}>
              <div style={{
                fontSize: 10.5, fontWeight: 800, letterSpacing: 1.2,
                textTransform: "uppercase", color: "#b91c1c",
                marginBottom: 4,
              }}>
                Policy blocker · this leave cannot be submitted
              </div>
              <div style={{ fontSize: 13, color: "#0f172a", lineHeight: 1.5 }}>
                {b.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Balance + attendance strip */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
        gap: 10,
        padding: 12,
        borderBottom: "1px solid #f1f5f9",
      }}>
        <div>
          <div style={styles_pc_label}>CL remaining</div>
          <div style={styles_pc_value}>{bal.casual_remaining ?? "—"}</div>
        </div>
        <div>
          <div style={styles_pc_label}>SL remaining</div>
          <div style={styles_pc_value}>{bal.sick_remaining ?? "—"}</div>
        </div>
        <div>
          <div style={styles_pc_label}>Late days (90d)</div>
          <div style={styles_pc_value}>{att.late_days ?? "—"}</div>
        </div>
        <div>
          <div style={styles_pc_label}>Absent (90d)</div>
          <div style={styles_pc_value}>{att.absent_days ?? "—"}</div>
        </div>
      </div>

      {/* Pending tasks — commit-by inputs */}
      <div style={{ padding: 12 }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 1.2,
          textTransform: "uppercase", color: "#64748b",
          marginBottom: 8,
        }}>
          Pending tasks ({tasks.length})
        </div>

        {tasks.length === 0 && (
          <div style={{
            padding: "10px 12px", background: "#ecfdf5", color: "#065f46",
            borderRadius: 6, fontSize: 13,
          }}>
            No open tasks in this window. Good to go.
          </div>
        )}

        {tasks.map((t) => {
          const u = URGENCY_STYLE[t.urgency] || URGENCY_STYLE.LOW;
          const isGated = t.urgency === "HIGH" || t.urgency === "MEDIUM";
          const c = commitments[t.task_id] || {};
          return (
            <div
              key={t.task_id}
              style={{
                border: `1px solid ${u.brd}`,
                borderLeft: `3px solid ${u.fg}`,
                borderRadius: 8,
                padding: 10,
                marginBottom: 8,
                background: "#fff",
              }}
            >
              <div style={{
                display: "flex", justifyContent: "space-between",
                alignItems: "flex-start", gap: 10, flexWrap: "wrap",
              }}>
                <div style={{ minWidth: 0, flex: "1 1 200px" }}>
                  <div style={{
                    fontSize: 13.5, fontWeight: 700, color: "#0f172a",
                  }}>
                    {t.task_name}
                  </div>
                  <div style={{
                    fontSize: 11.5, color: "#64748b", marginTop: 2,
                  }}>
                    Due: {t.due_date || "no date"} · Status: {t.task_status}
                  </div>
                </div>
                <span style={{
                  display: "inline-block", padding: "2px 8px",
                  borderRadius: 999, fontSize: 10, fontWeight: 800,
                  color: u.fg, background: u.bg, letterSpacing: 0.5,
                  whiteSpace: "nowrap",
                }}>
                  {u.label}
                </span>
              </div>
              <div style={{
                display: "grid",
                gridTemplateColumns: "180px 1fr",
                gap: 8,
                marginTop: 10,
              }}>
                <div>
                  <label style={styles_pc_smallLabel}>
                    {isGated ? "Commit by *" : "Commit by (optional)"}
                  </label>
                  <input
                    type="date"
                    value={c.promised_by || ""}
                    onChange={(e) => setCommit(t.task_id, "promised_by", e.target.value)}
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: `1px solid ${isGated && !c.promised_by ? "#fca5a5" : "#cbd5e1"}`,
                      borderRadius: 6,
                      fontSize: 13,
                      background: isGated && !c.promised_by ? "#fef2f2" : "white",
                    }}
                  />
                </div>
                <div>
                  <label style={styles_pc_smallLabel}>Note (optional)</label>
                  <input
                    type="text"
                    value={c.note || ""}
                    onChange={(e) => setCommit(t.task_id, "note", e.target.value)}
                    placeholder="e.g. handing off to Ram before leave"
                    style={{
                      width: "100%",
                      padding: "6px 8px",
                      border: "1px solid #cbd5e1",
                      borderRadius: 6,
                      fontSize: 13,
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// -----------------------------------------------------
// Convenience helpers for the caller.
// -----------------------------------------------------

/** True when every HIGH/MEDIUM pending task has a promised-by date. */
export function allCommitmentsFilled(preCheck, commitments) {
  const gating = (preCheck?.pending_tasks || []).filter(
    (t) => t.urgency === "HIGH" || t.urgency === "MEDIUM"
  );
  return gating.every(
    (t) => (commitments?.[t.task_id]?.promised_by || "").trim() !== ""
  );
}

/** True when the pre-check returned any hard HR-policy blocker
 * (e.g. Casual Leave already used this calendar month). */
export function hasBlockingConflicts(preCheck) {
  return Array.isArray(preCheck?.blocking_conflicts)
      && preCheck.blocking_conflicts.length > 0;
}
