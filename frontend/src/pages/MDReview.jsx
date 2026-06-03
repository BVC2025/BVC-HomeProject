import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

const BAND_COLORS = {
  "Outstanding": { bg: "#dcfce7", fg: "#166534", accent: "#22c55e" },
  "Strong": { bg: "#dbeafe", fg: "#1e40af", accent: "#3b82f6" },
  "Meets expectations": { bg: "#fef9c3", fg: "#854d0e", accent: "#eab308" },
  "Below target": { bg: "#fee2e2", fg: "#b91c1c", accent: "#ef4444" },
  "Needs review": { bg: "#f1f5f9", fg: "#475569", accent: "#94a3b8" },
  "No data": { bg: "#f8fafc", fg: "#94a3b8", accent: "#cbd5e1" }
};


function isoDaysAgo(n) {

  const d = new Date();

  d.setDate(d.getDate() - n);

  return d.toISOString().slice(0, 10);
}


function todayIso() {

  return new Date().toISOString().slice(0, 10);
}


// ----------------------------------------------------------------
// Top stat tiles
// ----------------------------------------------------------------

function StatTile({ label, value, sub, color }) {

  return (

    <div
      style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
        borderTop: `3px solid ${color}`
      }}
    >

      <div
        style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1,
          color: "#64748b",
          textTransform: "uppercase"
        }}
      >
        {label}
      </div>

      <div
        style={{
          fontSize: 28,
          fontWeight: 700,
          color: "#0f172a",
          marginTop: 6
        }}
      >
        {value}
      </div>

      {sub && (

        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            marginTop: 2
          }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// Drill-down modal
// ----------------------------------------------------------------

function EmployeeDetailModal({ employeeId, dateFrom, dateTo, onClose }) {

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(true);

  useEffect(() => {

    if (!employeeId) return;

    setLoading(true);

    API.get(`/performance/employee/${employeeId}`, {
      params: { date_from: dateFrom, date_to: dateTo }
    })
      .then((res) => setData(res.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));

  }, [employeeId, dateFrom, dateTo]);

  if (!employeeId) return null;

  const emp = data?.employee;

  const score = data?.score;

  const tasks = data?.tasks || [];

  return (

    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
        padding: 20
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white",
          borderRadius: 16,
          maxWidth: 820,
          width: "100%",
          maxHeight: "90vh",
          overflow: "auto",
          padding: 28,
          boxShadow: "0 24px 60px rgba(0,0,0,0.3)"
        }}
      >

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18
          }}
        >

          <div>

            <div
              style={{
                fontSize: 22,
                fontWeight: 700,
                color: "#0f172a"
              }}
            >
              {emp?.NAME || "Loading…"}
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#64748b",
                marginTop: 2
              }}
            >
              {emp?.EMPLOYEE_CODE}
              {" · "}
              Shift {emp?.SHIFT_START?.slice(0, 5)}–{emp?.SHIFT_END?.slice(0, 5)}
            </div>

            {emp?.SKILLS && (

              <div
                style={{
                  fontSize: 12,
                  color: "#475569",
                  marginTop: 6
                }}
              >
                Skills: {emp.SKILLS}
              </div>
            )}
          </div>

          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "#f1f5f9",
              fontSize: 18,
              padding: "6px 12px",
              borderRadius: 8,
              cursor: "pointer"
            }}
          >
            ×
          </button>
        </div>

        {loading && (
          <div style={{ color: "#94a3b8" }}>Loading details…</div>
        )}

        {score && (

          <>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "repeat(4, 1fr)",
                gap: 12,
                marginBottom: 24
              }}
            >

              <StatTile
                label="Score"
                value={score.performance_score}
                sub={score.band}
                color={
                  (BAND_COLORS[score.band] || BAND_COLORS["No data"]).accent
                }
              />

              <StatTile
                label="Suggested Increment"
                value={`${score.suggested_increment_pct}%`}
                sub={score.band}
                color="#7c3aed"
              />

              <StatTile
                label="Tasks Completed"
                value={score.total_tasks_completed}
                sub={`${score.on_time_count} on-time / ${score.late_count} late`}
                color="#0ea5e9"
              />

              <StatTile
                label="Avg Early"
                value={`${Math.round(score.avg_minutes_before_deadline)} min`}
                sub="before shift end"
                color="#10b981"
              />
            </div>

            <div
              style={{
                fontSize: 13,
                color: "#475569",
                background: "#f8fafc",
                padding: 12,
                borderRadius: 8,
                marginBottom: 20,
                border: "1px solid #e2e8f0"
              }}
            >
              <strong>Why this score:</strong> {score.explanation}
            </div>

            <div
              style={{
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: 1.2,
                color: "#475569",
                textTransform: "uppercase",
                marginBottom: 10
              }}
            >
              Per-task breakdown
            </div>

            <div style={{ overflow: "auto" }}>

              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  fontSize: 13
                }}
              >

                <thead>

                  <tr
                    style={{
                      background: "#f8fafc",
                      color: "#475569"
                    }}
                  >
                    <th style={{ textAlign: "left", padding: 10 }}>Date</th>
                    <th style={{ textAlign: "left", padding: 10 }}>Task</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Start</th>
                    <th style={{ textAlign: "right", padding: 10 }}>End</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Duration</th>
                    <th style={{ textAlign: "right", padding: 10 }}>Vs Deadline</th>
                  </tr>
                </thead>

                <tbody>

                  {tasks.length === 0 && (

                    <tr>
                      <td
                        colSpan="6"
                        style={{
                          padding: 18,
                          textAlign: "center",
                          color: "#94a3b8"
                        }}
                      >
                        No completed tasks in this range.
                      </td>
                    </tr>
                  )}

                  {tasks.map((t) => (

                    <tr
                      key={t.TASK_ID}
                      style={{ borderBottom: "1px solid #f1f5f9" }}
                    >
                      <td style={{ padding: 10 }}>
                        {t.ASSIGNED_DATE}
                      </td>
                      <td style={{ padding: 10 }}>
                        {t.TASK_NAME}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace"
                        }}
                      >
                        {t.START_TIME?.slice(11, 16) || "—"}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          fontFamily: "ui-monospace, monospace"
                        }}
                      >
                        {t.END_TIME?.slice(11, 16) || "—"}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right"
                        }}
                      >
                        {t.duration_minutes != null
                          ? `${t.duration_minutes} min`
                          : "—"}
                      </td>
                      <td
                        style={{
                          padding: 10,
                          textAlign: "right",
                          color: t.on_time ? "#047857" : "#b91c1c",
                          fontWeight: 600
                        }}
                      >
                        {t.on_time ? "+" : ""}
                        {Math.round(t.minutes_before_deadline)} min
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Main page
// ----------------------------------------------------------------

function MDReview() {

  const [dateFrom, setDateFrom] = useState(isoDaysAgo(29));

  const [dateTo, setDateTo] = useState(todayIso());

  const [data, setData] = useState(null);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [selectedEmpId, setSelectedEmpId] = useState(null);

  const fetchSummary = async () => {

    setLoading(true);

    setError("");

    try {

      const res = await API.get("/performance/summary", {
        params: { date_from: dateFrom, date_to: dateTo, vendor_id: 1 }
      });

      setData(res.data);

    } catch (err) {

      setError(
        err?.response?.data?.detail || err?.message || "Failed to load"
      );
    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchSummary();

  }, []);

  const rows = data?.employees || [];

  const summary = data?.summary || {};

  const periodLabel = data?.period
    ? `${data.period.from} → ${data.period.to} (${data.period.days} days)`
    : "";

  return (

    <div style={{ padding: 24, background: "#f1f5f9", minHeight: "100%" }}>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 20,
          flexWrap: "wrap",
          gap: 12
        }}
      >

        <div>

          <h1
            style={{
              fontSize: 26,
              fontWeight: 700,
              color: "#0f172a",
              margin: 0
            }}
          >
            MD Performance Review
          </h1>

          <div
            style={{
              fontSize: 13,
              color: "#64748b",
              marginTop: 4
            }}
          >
            Auto-scored increment recommendations from
            biometric + task-completion data.
            {periodLabel && <> · {periodLabel}</>}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            background: "white",
            padding: "8px 12px",
            borderRadius: 10,
            boxShadow: "0 2px 8px rgba(0,0,0,0.06)"
          }}
        >

          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            style={{
              border: "1px solid #e2e8f0",
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 13
            }}
          />

          <span style={{ color: "#94a3b8" }}>→</span>

          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            style={{
              border: "1px solid #e2e8f0",
              padding: "6px 10px",
              borderRadius: 6,
              fontSize: 13
            }}
          />

          <button
            onClick={fetchSummary}
            disabled={loading}
            style={{
              border: "none",
              background: "#1e40af",
              color: "white",
              padding: "7px 16px",
              borderRadius: 6,
              fontWeight: 600,
              cursor: loading ? "not-allowed" : "pointer",
              fontSize: 13
            }}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {/* Top stats */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 24
        }}
      >

        <StatTile
          label="Active Employees"
          value={summary.total_employees ?? "—"}
          color="#3b82f6"
        />

        <StatTile
          label="Avg Score"
          value={summary.avg_performance_score ?? "—"}
          sub="out of 100"
          color="#0ea5e9"
        />

        <StatTile
          label="Promotable"
          value={summary.promotable_count ?? "—"}
          sub="≥ 8% increment"
          color="#22c55e"
        />

        <StatTile
          label="Needs Review"
          value={summary.needs_review_count ?? "—"}
          sub="< 40 score"
          color="#ef4444"
        />
      </div>

      {error && (

        <div
          style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#b91c1c",
            padding: 12,
            borderRadius: 8,
            marginBottom: 16
          }}
        >
          {error}
        </div>
      )}

      {/* Employee table */}
      <div
        style={{
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          overflow: "hidden"
        }}
      >

        <div style={{ overflow: "auto" }}>

          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13
            }}
          >

            <thead>

              <tr
                style={{
                  background: "#f8fafc",
                  color: "#475569",
                  fontSize: 11,
                  letterSpacing: 0.8,
                  textTransform: "uppercase"
                }}
              >
                <th style={{ textAlign: "left", padding: 12 }}>Employee</th>
                <th style={{ textAlign: "left", padding: 12 }}>Department</th>
                <th style={{ textAlign: "right", padding: 12 }}>Tasks</th>
                <th style={{ textAlign: "right", padding: 12 }}>On-Time</th>
                <th style={{ textAlign: "right", padding: 12 }}>Avg Early</th>
                <th style={{ textAlign: "right", padding: 12 }}>Score</th>
                <th style={{ textAlign: "left", padding: 12 }}>Band</th>
                <th style={{ textAlign: "right", padding: 12 }}>Suggested</th>
                <th style={{ textAlign: "center", padding: 12 }}>Details</th>
              </tr>
            </thead>

            <tbody>

              {rows.length === 0 && !loading && (

                <tr>
                  <td
                    colSpan="9"
                    style={{
                      padding: 30,
                      textAlign: "center",
                      color: "#94a3b8"
                    }}
                  >
                    No employees in range. Try a wider date range or
                    run the BVC24 seed first.
                  </td>
                </tr>
              )}

              {rows.map((r) => {

                const band = BAND_COLORS[r.band] || BAND_COLORS["No data"];

                return (

                  <tr
                    key={r.EMPLOYEE_ID}
                    style={{
                      borderBottom: "1px solid #f1f5f9"
                    }}
                  >

                    <td style={{ padding: 12 }}>

                      <div
                        style={{ fontWeight: 600, color: "#0f172a" }}
                      >
                        {r.NAME}
                      </div>

                      <div
                        style={{
                          fontSize: 11,
                          color: "#94a3b8"
                        }}
                      >
                        {r.EMPLOYEE_CODE}
                      </div>
                    </td>

                    <td style={{ padding: 12, color: "#475569" }}>
                      {r.DEPARTMENT_NAME || "—"}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "right",
                        fontWeight: 600
                      }}
                    >
                      {r.total_tasks_completed}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "right"
                      }}
                    >
                      {r.total_tasks_completed > 0
                        ? `${Math.round(r.on_time_rate * 100)}%`
                        : "—"}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "right"
                      }}
                    >
                      {r.total_tasks_completed > 0
                        ? `${Math.round(r.avg_minutes_before_deadline)}m`
                        : "—"}
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "right",
                        fontWeight: 700,
                        color: band.fg,
                        fontSize: 15
                      }}
                    >
                      {r.performance_score}
                    </td>

                    <td style={{ padding: 12 }}>

                      <span
                        style={{
                          display: "inline-block",
                          padding: "3px 10px",
                          borderRadius: 999,
                          fontSize: 11,
                          fontWeight: 700,
                          background: band.bg,
                          color: band.fg
                        }}
                      >
                        {r.band}
                      </span>
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "right",
                        fontWeight: 700,
                        color:
                          r.suggested_increment_pct >= 8
                            ? "#047857"
                            : r.suggested_increment_pct >= 3
                              ? "#0f172a"
                              : "#94a3b8",
                        fontSize: 15
                      }}
                    >
                      {r.suggested_increment_pct}%
                    </td>

                    <td
                      style={{
                        padding: 12,
                        textAlign: "center"
                      }}
                    >

                      <button
                        onClick={() => setSelectedEmpId(r.EMPLOYEE_ID)}
                        style={{
                          border: "1px solid #e2e8f0",
                          background: "white",
                          padding: "5px 12px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 12,
                          color: "#1e40af",
                          fontWeight: 600
                        }}
                      >
                        View
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEmpId && (

        <EmployeeDetailModal
          employeeId={selectedEmpId}
          dateFrom={dateFrom}
          dateTo={dateTo}
          onClose={() => setSelectedEmpId(null)}
        />
      )}
    </div>
  );
}


export default MDReview;
