// =====================================================================
// Shift Management
//
// Three tabs:
//   • Shifts          — master list of shift templates (Morning / Night / etc.)
//   • Calendar        — employees × dates grid, click a cell to assign
//   • Change Requests — approval workflow
//
// Backend: /shifts/*   (routes/shifts.py)
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const BORDER = "#e2e8f0";
const MUTED  = "#64748b";
const TEXT   = "#0f172a";
const SURFACE = "#f8fafc";


export default function ShiftManagement() {

  const [tab, setTab] = useState("shifts");
  const [toast, setToast] = useState("");

  useEffect(() => {
    if (!toast) return undefined;
    const id = setTimeout(() => setToast(""), 2800);
    return () => clearTimeout(id);
  }, [toast]);

  return (
    <div style={{ padding: 18, color: TEXT, background: SURFACE, minHeight: "100%" }}>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
        borderRadius: 14, padding: "18px 24px", color: "white",
        marginBottom: 14,
      }}>
        <div style={{
          fontSize: 10, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          BVC24 · HR · Workforce Ops
        </div>
        <div style={{ fontSize: 22, fontWeight: 900, marginTop: 3 }}>
          Shift Management
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 3 }}>
          Shift templates · scheduling · rotation · change requests · night differential
        </div>
      </div>

      {/* Tab strip */}
      <div style={{
        background: "white", borderRadius: 10, padding: 5, marginBottom: 12,
        display: "flex", gap: 3, border: `1px solid ${BORDER}`,
      }}>
        {[
          { key: "shifts",   label: "Shift Templates" },
          { key: "calendar", label: "Calendar & Schedule" },
          // Change Requests intentionally hidden — per business
          // decision, admins assign shifts and employees follow;
          // no employee-initiated swap workflow.
          // { key: "requests", label: "Change Requests" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "9px 16px", borderRadius: 6, border: "none",
              background: tab === t.key ? BVC_RED : "transparent",
              color: tab === t.key ? "white" : MUTED,
              fontSize: 12, fontWeight: 700, cursor: "pointer",
              letterSpacing: 0.3,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "shifts"   && <ShiftsTab onToast={setToast} />}
      {tab === "calendar" && <CalendarTab onToast={setToast} />}
      {tab === "requests" && <RequestsTab onToast={setToast} />}

      {toast && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%",
          transform: "translateX(-50%)",
          background: "#1f2937", color: "white",
          padding: "9px 16px", borderRadius: 8, fontSize: 12,
          fontWeight: 600, boxShadow: "0 6px 18px rgba(0,0,0,0.2)",
          zIndex: 300,
        }}>
          {toast}
        </div>
      )}
    </div>
  );
}


// =====================================================================
// TAB 1 — Shift Templates (CRUD)
// =====================================================================

function ShiftsTab({ onToast }) {

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);        // null = closed, {} = new, {ID,...} = edit
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    API.get("/shifts")
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

  const filtered = useMemo(
    () => showInactive ? rows : rows.filter((s) => s.IS_ACTIVE),
    [rows, showInactive],
  );

  const remove = async (s) => {
    if (!window.confirm(`Deactivate shift "${s.NAME}"? History will be preserved.`)) return;
    try {
      await API.delete(`/shifts/${s.ID}`);
      onToast(`Deactivated ${s.NAME}`);
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div>

      <div style={{
        display: "flex", justifyContent: "space-between",
        alignItems: "center", flexWrap: "wrap", gap: 10, marginBottom: 12,
      }}>
        <div style={{ fontSize: 12, color: MUTED }}>
          {filtered.length} shift template{filtered.length === 1 ? "" : "s"}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <label style={{ fontSize: 12, color: MUTED, display: "inline-flex", alignItems: "center", gap: 5 }}>
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
            />
            Show inactive
          </label>
          <button
            onClick={() => setEditing({})}
            style={{
              background: BVC_RED, color: "white", border: "none",
              padding: "8px 15px", borderRadius: 6, fontSize: 12,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            + New Shift
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: MUTED }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: MUTED,
          background: "white", border: `1px dashed ${BORDER}`, borderRadius: 10,
        }}>
          No shifts yet. Click <b>+ New Shift</b> to define one (e.g. Morning 09:00–18:00, Night 22:00–06:00).
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
          gap: 10,
        }}>
          {filtered.map((s) => (
            <ShiftCard key={s.ID} shift={s} onEdit={setEditing} onDelete={remove} />
          ))}
        </div>
      )}

      {editing && (
        <ShiftEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); onToast("Shift saved"); load(); }}
        />
      )}
    </div>
  );
}


function ShiftCard({ shift, onEdit, onDelete }) {
  return (
    <div style={{
      background: "white", border: `1px solid ${BORDER}`, borderRadius: 10,
      padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8,
      borderLeft: `4px solid ${shift.COLOR || "#3b82f6"}`,
    }}>
      <div style={{ display: "flex", alignItems: "start", justifyContent: "space-between", gap: 8 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
              color: MUTED, background: SURFACE, padding: "2px 7px", borderRadius: 4,
            }}>
              {shift.SHIFT_CODE}
            </span>
            <span style={{
              fontSize: 9, fontWeight: 800, letterSpacing: 0.8, textTransform: "uppercase",
              color: shift.IS_NIGHT ? "#7c3aed" : "#1e40af",
              background: shift.IS_NIGHT ? "#f3e8ff" : "#eff6ff",
              padding: "2px 7px", borderRadius: 4,
            }}>
              {shift.CATEGORY}
            </span>
            {!shift.IS_ACTIVE && (
              <span style={{
                fontSize: 9, fontWeight: 800, letterSpacing: 0.6,
                color: "#991b1b", background: "#fee2e2",
                padding: "2px 6px", borderRadius: 4,
              }}>
                INACTIVE
              </span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 700, color: TEXT, marginTop: 5 }}>
            {shift.NAME}
          </div>
          <div style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {shift.START_TIME} → {shift.END_TIME}
            {shift.CROSS_MIDNIGHT && <span style={{ color: "#7c3aed", fontWeight: 700 }}> · crosses midnight</span>}
          </div>
          <div style={{ fontSize: 11, color: MUTED, marginTop: 3 }}>
            {shift.BREAK_MINUTES}m break
            {shift.IS_NIGHT && shift.NIGHT_ALLOWANCE_PCT > 0 && (
              <span> · +{shift.NIGHT_ALLOWANCE_PCT}% night allowance</span>
            )}
            {shift.FLEX_WINDOW_MINUTES > 0 && (
              <span> · ±{shift.FLEX_WINDOW_MINUTES}m flex</span>
            )}
          </div>
        </div>
      </div>
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
        <button
          onClick={() => onEdit(shift)}
          style={{
            background: "white", color: MUTED, border: `1px solid ${BORDER}`,
            padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Edit
        </button>
        {shift.IS_ACTIVE && (
          <button
            onClick={() => onDelete(shift)}
            style={{
              background: "white", color: "#991b1b", border: "1px solid #fecaca",
              padding: "5px 10px", borderRadius: 5, fontSize: 11, fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Deactivate
          </button>
        )}
      </div>
    </div>
  );
}


function ShiftEditor({ initial, onClose, onSaved }) {

  const isNew = !initial.ID;

  const [form, setForm] = useState({
    SHIFT_CODE:          initial.SHIFT_CODE          || "",
    NAME:                initial.NAME                || "",
    START_TIME:          initial.START_TIME          || "09:00",
    END_TIME:            initial.END_TIME            || "18:00",
    CROSS_MIDNIGHT:      !!initial.CROSS_MIDNIGHT,
    BREAK_MINUTES:       initial.BREAK_MINUTES       ?? 60,
    CATEGORY:            initial.CATEGORY            || "DAY",
    IS_NIGHT:            !!initial.IS_NIGHT,
    NIGHT_ALLOWANCE_PCT: initial.NIGHT_ALLOWANCE_PCT ?? 0,
    FLEX_WINDOW_MINUTES: initial.FLEX_WINDOW_MINUTES ?? 0,
    COLOR:               initial.COLOR               || "#3b82f6",
    DESCRIPTION:         initial.DESCRIPTION         || "",
    IS_ACTIVE:           initial.IS_ACTIVE == null ? true : !!initial.IS_ACTIVE,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => {
    const v = e.target.type === "checkbox" ? e.target.checked : e.target.value;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");
    if (!form.SHIFT_CODE.trim() || !form.NAME.trim()) {
      setError("Shift code and name are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        SHIFT_CODE:          form.SHIFT_CODE.trim(),
        NAME:                form.NAME.trim(),
        START_TIME:          form.START_TIME,
        END_TIME:            form.END_TIME,
        CROSS_MIDNIGHT:      !!form.CROSS_MIDNIGHT,
        BREAK_MINUTES:       Number(form.BREAK_MINUTES) || 0,
        CATEGORY:            form.CATEGORY,
        IS_NIGHT:            !!form.IS_NIGHT,
        NIGHT_ALLOWANCE_PCT: Number(form.NIGHT_ALLOWANCE_PCT) || 0,
        FLEX_WINDOW_MINUTES: Number(form.FLEX_WINDOW_MINUTES) || 0,
        COLOR:               form.COLOR,
        DESCRIPTION:         form.DESCRIPTION.trim() || null,
        IS_ACTIVE:           !!form.IS_ACTIVE,
      };
      if (isNew) {
        await API.post("/shifts", payload);
      } else {
        await API.patch(`/shifts/${initial.ID}`, payload);
      }
      onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 200,
      }}
    >
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 12, width: "100%", maxWidth: 560,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 22px", borderRadius: "12px 12px 0 0",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: BVC_GOLD, textTransform: "uppercase" }}>
            {isNew ? "New shift" : "Edit shift"}
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>
            {isNew ? "Create a shift template" : `Edit ${initial.NAME}`}
          </div>
        </div>

        <div style={{ padding: 20 }}>

          <FormRow>
            <FormField label="Code *">
              <input type="text" value={form.SHIFT_CODE} onChange={set("SHIFT_CODE")}
                placeholder="M / E / N" style={inputStyle} />
            </FormField>
            <FormField label="Name *">
              <input type="text" value={form.NAME} onChange={set("NAME")}
                placeholder="Morning shift" style={inputStyle} />
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Start time">
              <input type="time" value={form.START_TIME} onChange={set("START_TIME")} style={inputStyle} />
            </FormField>
            <FormField label="End time">
              <input type="time" value={form.END_TIME} onChange={set("END_TIME")} style={inputStyle} />
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Category">
              <select value={form.CATEGORY} onChange={set("CATEGORY")} style={inputStyle}>
                <option value="DAY">Day</option>
                <option value="NIGHT">Night</option>
                <option value="FLEXIBLE">Flexible</option>
                <option value="SPLIT">Split</option>
              </select>
            </FormField>
            <FormField label="Break (min)">
              <input type="number" min="0" value={form.BREAK_MINUTES} onChange={set("BREAK_MINUTES")} style={inputStyle} />
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Flex window ± min">
              <input type="number" min="0" value={form.FLEX_WINDOW_MINUTES} onChange={set("FLEX_WINDOW_MINUTES")} style={inputStyle} />
            </FormField>
            <FormField label="Night allowance %">
              <input type="number" min="0" step="0.5"
                value={form.NIGHT_ALLOWANCE_PCT} onChange={set("NIGHT_ALLOWANCE_PCT")}
                style={inputStyle} />
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Cross midnight?">
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.CROSS_MIDNIGHT} onChange={set("CROSS_MIDNIGHT")} />
                Yes — ends the next day
              </label>
            </FormField>
            <FormField label="Night shift?">
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.IS_NIGHT} onChange={set("IS_NIGHT")} />
                Yes — qualifies for night pay
              </label>
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Colour">
              <input type="color" value={form.COLOR} onChange={set("COLOR")}
                style={{ ...inputStyle, height: 40, padding: 4 }} />
            </FormField>
            <FormField label="Active?">
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.IS_ACTIVE} onChange={set("IS_ACTIVE")} />
                Yes — assignable
              </label>
            </FormField>
          </FormRow>

          <FormField label="Description">
            <textarea rows={2} value={form.DESCRIPTION} onChange={set("DESCRIPTION")}
              placeholder="Optional notes shown on the calendar tooltip"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
          </FormField>

          {error && (
            <div style={{
              background: "#fef2f2", color: "#991b1b", padding: "9px 12px",
              borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 10,
              border: "1px solid #fecaca",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnCancel}>Cancel</button>
            <button type="submit" disabled={saving} style={btnPrimary(saving)}>
              {saving ? "Saving…" : isNew ? "Create shift" : "Save changes"}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}


// =====================================================================
// TAB 2 — Calendar & Schedule
// =====================================================================

function CalendarTab({ onToast }) {

  const [shifts, setShifts]       = useState([]);
  const [employees, setEmployees] = useState([]);
  const [assignments, setAssignments] = useState([]);   // range slice
  const [loading, setLoading]     = useState(true);

  const [weekStart, setWeekStart] = useState(mondayOf(new Date()));
  const [selected, setSelected]   = useState(null);     // {emp, date}
  const [bulkOpen, setBulkOpen]   = useState(false);

  const weekDates = useMemo(() => {
    const arr = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(d.getDate() + i);
      arr.push(d);
    }
    return arr;
  }, [weekStart]);

  const loadMasters = useCallback(() => {
    Promise.all([
      API.get("/shifts", { params: { active_only: true } }),
      API.get("/employees"),
    ]).then(([sRes, eRes]) => {
      setShifts(Array.isArray(sRes.data) ? sRes.data : []);
      const all = Array.isArray(eRes.data) ? eRes.data : [];
      setEmployees(all.filter((e) => {
        const st = (e.STATUS || "ACTIVE").toUpperCase();
        return st !== "RESIGNED" && st !== "TERMINATED";
      }));
    }).catch(() => { /* non-fatal */ });
  }, []);

  const loadRange = useCallback(() => {
    setLoading(true);
    const from = isoDate(weekDates[0]);
    const to   = isoDate(weekDates[6]);
    API.get("/shifts/schedule/range", { params: { from_date: from, to_date: to } })
      .then((r) => setAssignments(Array.isArray(r.data) ? r.data : []))
      .catch(() => setAssignments([]))
      .finally(() => setLoading(false));
  }, [weekDates]);

  useEffect(loadMasters, [loadMasters]);
  useEffect(loadRange, [loadRange]);

  const assignmentAt = (empId, iso) => assignments.find(
    (a) => a.EMPLOYEE_ID === empId && a.SHIFT_DATE === iso
  );

  const setCellShift = async (emp, iso, shiftId) => {
    try {
      await API.post("/shifts/schedule/assign", {
        EMPLOYEE_ID: emp.ID,
        SHIFT_ID: shiftId,
        SHIFT_DATE: iso,
      });
      onToast(shiftId ? "Shift assigned" : "Marked as OFF");
      loadRange();
      setSelected(null);
    } catch (e) {
      onToast(e?.response?.data?.detail || "Failed");
    }
  };

  const clearCell = async (assignmentId) => {
    try {
      await API.delete(`/shifts/schedule/${assignmentId}`);
      onToast("Assignment removed");
      loadRange();
      setSelected(null);
    } catch (e) {
      onToast(e?.response?.data?.detail || "Failed");
    }
  };

  const autoFillWeek = async () => {
    if (!window.confirm(
      `Auto-fill every unassigned weekday from ${isoDate(weekDates[0])} to ${isoDate(weekDates[6])}\n` +
      `using each employee's default shift on their profile?`
    )) return;
    try {
      const res = await API.post("/shifts/schedule/auto-fill", {
        FROM_DATE: isoDate(weekDates[0]),
        TO_DATE:   isoDate(weekDates[6]),
        SKIP_WEEKENDS: true,
      });
      const d = res.data || {};
      onToast(`Auto-fill: +${d.created} created, ${d.skipped_existing} already set`);
      loadRange();
    } catch (e) {
      onToast(e?.response?.data?.detail || "Auto-fill failed");
    }
  };

  return (
    <div>

      {/* Toolbar */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "space-between",
        gap: 10, marginBottom: 10, flexWrap: "wrap",
      }}>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <button onClick={() => setWeekStart(shiftDay(weekStart, -7))} style={btnGhost}>← Prev</button>
          <button onClick={() => setWeekStart(mondayOf(new Date()))} style={btnGhost}>Today</button>
          <button onClick={() => setWeekStart(shiftDay(weekStart, +7))} style={btnGhost}>Next →</button>
          <span style={{ fontSize: 12, color: MUTED, marginLeft: 10 }}>
            Week of <b>{isoDate(weekDates[0])}</b>
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={autoFillWeek} style={btnGhost}>Auto-fill week</button>
          <button
            onClick={() => setBulkOpen(true)}
            style={{
              background: BVC_RED, color: "white", border: "none",
              padding: "7px 14px", borderRadius: 6, fontSize: 12,
              fontWeight: 700, cursor: "pointer",
            }}
          >
            Bulk assign
          </button>
        </div>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: MUTED }}>Loading…</div>}

      {/* Legend */}
      {!loading && shifts.length > 0 && (
        <div style={{
          display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap",
          alignItems: "center", fontSize: 11, color: MUTED,
        }}>
          <span style={{ fontWeight: 700 }}>Legend:</span>
          {shifts.map((s) => (
            <span key={s.ID} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
              <span style={{
                width: 12, height: 12, borderRadius: 3,
                background: s.COLOR || "#3b82f6",
              }} />
              {s.NAME}
            </span>
          ))}
          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <span style={{
              width: 12, height: 12, borderRadius: 3,
              background: "#f1f5f9", border: `1px dashed ${BORDER}`,
            }} />
            OFF
          </span>
        </div>
      )}

      {/* Grid */}
      {!loading && employees.length > 0 && (
        <div style={{
          background: "white", border: `1px solid ${BORDER}`, borderRadius: 10,
          overflowX: "auto",
        }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: SURFACE }}>
                <th style={thStyle}>Employee</th>
                {weekDates.map((d) => (
                  <th key={d.toISOString()} style={{
                    ...thStyle,
                    color: d.getDay() === 0 || d.getDay() === 6 ? "#991b1b" : MUTED,
                  }}>
                    <div>{d.toLocaleDateString(undefined, { weekday: "short" })}</div>
                    <div style={{ fontSize: 10, fontWeight: 600, color: MUTED }}>
                      {d.getDate()}/{d.getMonth() + 1}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {employees.map((emp) => (
                <tr key={emp.ID}>
                  <td style={{
                    ...tdStyle,
                    borderRight: `1px solid ${BORDER}`, fontWeight: 600,
                    background: "white", minWidth: 180,
                  }}>
                    <div>{emp.NAME}</div>
                    <div style={{ fontSize: 10, color: MUTED }}>
                      {emp.EMPLOYEE_CODE}
                    </div>
                  </td>
                  {weekDates.map((d) => {
                    const iso = isoDate(d);
                    const a = assignmentAt(emp.ID, iso);
                    const isSelected = selected && selected.empId === emp.ID && selected.iso === iso;
                    return (
                      <td key={iso}
                        onClick={() => setSelected({ empId: emp.ID, iso, current: a })}
                        style={{
                          ...tdStyle,
                          cursor: "pointer",
                          background: a
                            ? (a.COLOR || (a.SHIFT_ID ? "#dbeafe" : "#f1f5f9"))
                            : "white",
                          borderLeft: isSelected ? `2px solid ${BVC_RED}` : `1px solid ${BORDER}`,
                          color: a ? "#0f172a" : MUTED,
                          fontWeight: 700,
                          textAlign: "center",
                        }}
                      >
                        {a ? (
                          a.SHIFT_ID
                            ? <><div>{a.SHIFT_CODE}</div>
                                <div style={{ fontSize: 9, fontWeight: 600 }}>
                                  {a.START_TIME}
                                </div></>
                            : <span style={{ color: "#991b1b" }}>OFF</span>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && employees.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: MUTED,
          background: "white", border: `1px dashed ${BORDER}`, borderRadius: 10,
        }}>
          No employees to schedule. Add employees first.
        </div>
      )}

      {selected && (
        <CellPicker
          selected={selected}
          shifts={shifts}
          onPick={(sid) => setCellShift(
            employees.find((e) => e.ID === selected.empId),
            selected.iso, sid
          )}
          onClear={() => selected.current && clearCell(selected.current.ID)}
          onClose={() => setSelected(null)}
        />
      )}

      {bulkOpen && (
        <BulkAssignModal
          shifts={shifts}
          employees={employees}
          initialFrom={isoDate(weekDates[0])}
          initialTo={isoDate(weekDates[6])}
          onClose={() => setBulkOpen(false)}
          onSaved={(result) => {
            const d = result || {};
            onToast(`+${d.created} created, ${d.updated} updated, ${d.skipped_existing} skipped`);
            setBulkOpen(false);
            loadRange();
          }}
        />
      )}
    </div>
  );
}


function CellPicker({ selected, shifts, onPick, onClear, onClose }) {
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.4)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 200, padding: 16,
      }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 12, padding: 18,
          minWidth: 300, maxWidth: 460,
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 800, color: TEXT, marginBottom: 3 }}>
          Assign shift
        </div>
        <div style={{ fontSize: 12, color: MUTED, marginBottom: 12 }}>
          {selected.iso}
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {shifts.map((s) => (
            <button key={s.ID} onClick={() => onPick(s.ID)}
              style={{
                background: s.COLOR || "#3b82f6", color: "white",
                border: "none", borderRadius: 6, padding: "9px 12px",
                fontSize: 12, fontWeight: 700, cursor: "pointer",
                textAlign: "left",
              }}
            >
              <div>{s.SHIFT_CODE} · {s.NAME}</div>
              <div style={{ fontSize: 10, opacity: 0.85 }}>{s.START_TIME}–{s.END_TIME}</div>
            </button>
          ))}
          <button onClick={() => onPick(null)}
            style={{
              background: "#f1f5f9", color: "#991b1b", border: `1px dashed ${BORDER}`,
              borderRadius: 6, padding: "9px 12px",
              fontSize: 12, fontWeight: 700, cursor: "pointer",
            }}
          >
            OFF-day / weekly off
          </button>
        </div>

        <div style={{ display: "flex", gap: 6, justifyContent: "space-between", marginTop: 14 }}>
          {selected.current ? (
            <button onClick={onClear} style={{
              background: "white", color: "#991b1b", border: "1px solid #fecaca",
              padding: "6px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700,
              cursor: "pointer",
            }}>
              Remove assignment
            </button>
          ) : <span />}
          <button onClick={onClose} style={btnCancel}>Close</button>
        </div>
      </div>
    </div>
  );
}


function BulkAssignModal({ shifts, employees, initialFrom, initialTo, onClose, onSaved }) {

  const [form, setForm] = useState({
    SHIFT_ID:      shifts[0]?.ID || "",
    FROM_DATE:     initialFrom,
    TO_DATE:       initialTo,
    SKIP_WEEKENDS: true,
    OVERWRITE:     false,
    EMPLOYEE_IDS:  [],
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const toggleEmp = (id) => {
    setForm((f) => {
      const has = f.EMPLOYEE_IDS.includes(id);
      return {
        ...f,
        EMPLOYEE_IDS: has
          ? f.EMPLOYEE_IDS.filter((x) => x !== id)
          : [...f.EMPLOYEE_IDS, id],
      };
    });
  };

  const submit = async () => {
    setError("");
    if (form.EMPLOYEE_IDS.length === 0) {
      setError("Pick at least one employee.");
      return;
    }
    setSaving(true);
    try {
      const res = await API.post("/shifts/schedule/bulk", {
        EMPLOYEE_IDS:  form.EMPLOYEE_IDS,
        SHIFT_ID:      form.SHIFT_ID || null,
        FROM_DATE:     form.FROM_DATE,
        TO_DATE:       form.TO_DATE,
        SKIP_WEEKENDS: form.SKIP_WEEKENDS,
        OVERWRITE:     form.OVERWRITE,
      });
      onSaved?.(res.data);
    } catch (err) {
      setError(err?.response?.data?.detail || "Bulk assign failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 200,
      }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 12, width: "100%", maxWidth: 640,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 22px", borderRadius: "12px 12px 0 0",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: BVC_GOLD, textTransform: "uppercase" }}>
            Bulk assign
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>
            Roster multiple employees to a shift
          </div>
        </div>

        <div style={{ padding: 20 }}>

          <FormRow>
            <FormField label="Shift">
              <select value={form.SHIFT_ID}
                onChange={(e) => setForm((f) => ({ ...f, SHIFT_ID: e.target.value || null }))}
                style={inputStyle}>
                <option value="">— OFF-day for everyone —</option>
                {shifts.map((s) => (
                  <option key={s.ID} value={s.ID}>
                    {s.SHIFT_CODE} · {s.NAME} ({s.START_TIME}–{s.END_TIME})
                  </option>
                ))}
              </select>
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="From date">
              <input type="date" value={form.FROM_DATE}
                onChange={(e) => setForm((f) => ({ ...f, FROM_DATE: e.target.value }))}
                style={inputStyle} />
            </FormField>
            <FormField label="To date">
              <input type="date" value={form.TO_DATE}
                onChange={(e) => setForm((f) => ({ ...f, TO_DATE: e.target.value }))}
                style={inputStyle} />
            </FormField>
          </FormRow>

          <FormRow>
            <FormField label="Skip weekends?">
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.SKIP_WEEKENDS}
                  onChange={(e) => setForm((f) => ({ ...f, SKIP_WEEKENDS: e.target.checked }))} />
                Sat / Sun stay unassigned
              </label>
            </FormField>
            <FormField label="Overwrite existing?">
              <label style={checkboxLabel}>
                <input type="checkbox" checked={form.OVERWRITE}
                  onChange={(e) => setForm((f) => ({ ...f, OVERWRITE: e.target.checked }))} />
                Replace conflicting shifts
              </label>
            </FormField>
          </FormRow>

          <FormField label={`Employees (${form.EMPLOYEE_IDS.length} selected)`}>
            <div style={{
              maxHeight: 220, overflowY: "auto",
              border: `1px solid ${BORDER}`, borderRadius: 8, padding: 8,
            }}>
              <label style={{
                display: "flex", alignItems: "center", justifyContent: "flex-start",
                gap: 8, marginBottom: 6, width: "100%",
                fontSize: 12, fontWeight: 700, color: MUTED,
                cursor: "pointer",
              }}>
                <input type="checkbox"
                  style={{ margin: 0, flexShrink: 0 }}
                  checked={form.EMPLOYEE_IDS.length === employees.length}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    EMPLOYEE_IDS: e.target.checked ? employees.map((x) => x.ID) : [],
                  }))} />
                <span>Select all</span>
              </label>
              {employees.map((e) => (
                <label key={e.ID} style={{
                  display: "flex", alignItems: "center", justifyContent: "flex-start",
                  gap: 8, padding: "4px 0", width: "100%",
                  fontSize: 12, color: TEXT, cursor: "pointer",
                }}>
                  <input type="checkbox"
                    style={{ margin: 0, flexShrink: 0 }}
                    checked={form.EMPLOYEE_IDS.includes(e.ID)}
                    onChange={() => toggleEmp(e.ID)} />
                  <span>{e.NAME} <span style={{ color: MUTED, fontSize: 11 }}>({e.EMPLOYEE_CODE || e.ID})</span></span>
                </label>
              ))}
            </div>
          </FormField>

          {error && (
            <div style={{
              background: "#fef2f2", color: "#991b1b", padding: "9px 12px",
              borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 10,
              border: "1px solid #fecaca",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button type="button" onClick={onClose} style={btnCancel}>Cancel</button>
            <button type="button" onClick={submit} disabled={saving} style={btnPrimary(saving)}>
              {saving ? "Assigning…" : "Assign"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// TAB 3 — Change Requests
// =====================================================================

function RequestsTab({ onToast }) {

  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState("PENDING");
  const [loading, setLoading] = useState(true);
  const [shifts, setShifts] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const params = filter ? { status: filter } : {};
    API.get("/shifts/change-requests", { params })
      .then((r) => setRows(Array.isArray(r.data) ? r.data : []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  }, [filter]);

  useEffect(load, [load]);

  useEffect(() => {
    Promise.all([
      API.get("/shifts", { params: { active_only: true } }),
      API.get("/employees"),
    ]).then(([sRes, eRes]) => {
      setShifts(sRes.data || []);
      const all = eRes.data || [];
      setEmployees(all.filter((e) => {
        const st = (e.STATUS || "ACTIVE").toUpperCase();
        return st !== "RESIGNED" && st !== "TERMINATED";
      }));
    }).catch(() => { /* non-fatal */ });
  }, []);

  const approve = async (r) => {
    if (!window.confirm(`Approve ${r.REQUESTED_BY_NAME}'s request for ${r.SHIFT_DATE}?`)) return;
    try {
      await API.post(`/shifts/change-requests/${r.ID}/approve`, {});
      onToast("Approved");
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || "Failed");
    }
  };

  const reject = async (r) => {
    const reason = window.prompt("Reject — reason?");
    if (!reason || !reason.trim()) return;
    try {
      await API.post(`/shifts/change-requests/${r.ID}/reject`, { REJECTION_REASON: reason.trim() });
      onToast("Rejected");
      load();
    } catch (e) {
      onToast(e?.response?.data?.detail || "Failed");
    }
  };

  return (
    <div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", gap: 4 }}>
          {["PENDING", "APPROVED", "REJECTED", "CANCELLED", ""].map((s) => (
            <button key={s || "ALL"} onClick={() => setFilter(s)}
              style={{
                padding: "6px 12px", fontSize: 11, fontWeight: 700,
                borderRadius: 5, border: "none", cursor: "pointer",
                background: filter === s ? BVC_RED : "white",
                color: filter === s ? "white" : MUTED,
                letterSpacing: 0.4,
              }}
            >
              {s || "ALL"}
            </button>
          ))}
        </div>
        <button onClick={() => setShowCreate(true)}
          style={{
            background: BVC_RED, color: "white", border: "none",
            padding: "8px 15px", borderRadius: 6, fontSize: 12,
            fontWeight: 700, cursor: "pointer",
          }}
        >
          + New Request
        </button>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: MUTED }}>Loading…</div>}

      {!loading && rows.length === 0 && (
        <div style={{
          padding: 40, textAlign: "center", color: MUTED,
          background: "white", border: `1px dashed ${BORDER}`, borderRadius: 10,
        }}>
          No change requests {filter ? `in ${filter}` : ""} state.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.ID} style={{
              background: "white", border: `1px solid ${BORDER}`, borderRadius: 10,
              padding: "12px 14px",
              display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "center",
            }}>
              <div>
                <div style={{
                  display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap",
                  marginBottom: 4,
                }}>
                  <span style={{ fontSize: 10, fontWeight: 800, color: MUTED, letterSpacing: 0.6 }}>
                    REQ #{r.ID}
                  </span>
                  <RequestStatusPill status={r.STATUS} />
                  <span style={{ fontSize: 11, color: MUTED }}>
                    {r.SHIFT_DATE}
                  </span>
                </div>
                <div style={{ fontSize: 13, fontWeight: 700, color: TEXT }}>
                  {r.REQUESTED_BY_NAME || "Someone"}
                </div>
                <div style={{ fontSize: 11, color: MUTED, marginTop: 2 }}>
                  {r.FROM_SHIFT_NAME || "OFF"} → {r.TO_SHIFT_NAME || "OFF"}
                  {r.SWAP_WITH_EMPLOYEE_NAME && ` · swap with ${r.SWAP_WITH_EMPLOYEE_NAME}`}
                </div>
                {r.REASON && (
                  <div style={{ fontSize: 11, color: MUTED, marginTop: 3, fontStyle: "italic" }}>
                    "{r.REASON}"
                  </div>
                )}
                {r.REJECTION_REASON && (
                  <div style={{
                    fontSize: 11, color: "#991b1b", marginTop: 4,
                    background: "#fef2f2", padding: "5px 8px", borderRadius: 5,
                  }}>
                    Rejected: {r.REJECTION_REASON}
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                {r.STATUS === "PENDING" && (
                  <>
                    <button onClick={() => approve(r)} style={btnGreen}>Approve</button>
                    <button onClick={() => reject(r)} style={btnRed}>Reject</button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {showCreate && (
        <CreateRequestModal
          shifts={shifts}
          employees={employees}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); onToast("Request submitted"); load(); }}
        />
      )}
    </div>
  );
}


function RequestStatusPill({ status }) {
  const themes = {
    PENDING:   { bg: "#fef3c7", fg: "#854d0e" },
    APPROVED:  { bg: "#dcfce7", fg: "#166534" },
    REJECTED:  { bg: "#fee2e2", fg: "#991b1b" },
    CANCELLED: { bg: "#f1f5f9", fg: "#475569" },
  };
  const t = themes[status] || themes.CANCELLED;
  return (
    <span style={{
      background: t.bg, color: t.fg,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
      padding: "2px 8px", borderRadius: 999,
    }}>{status}</span>
  );
}


function CreateRequestModal({ shifts, employees, onClose, onSaved }) {

  const [form, setForm] = useState({
    REQUESTED_BY_ID: "",
    SHIFT_DATE: "",
    TO_SHIFT_ID: "",
    SWAP_WITH_EMPLOYEE_ID: "",
    REASON: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async () => {
    setError("");
    if (!form.REQUESTED_BY_ID) { setError("Pick the requesting employee."); return; }
    if (!form.SHIFT_DATE)      { setError("Pick a date."); return; }
    setSaving(true);
    try {
      await API.post("/shifts/change-requests", {
        REQUESTED_BY_ID:       form.REQUESTED_BY_ID,
        SHIFT_DATE:            form.SHIFT_DATE,
        TO_SHIFT_ID:           form.TO_SHIFT_ID || null,
        SWAP_WITH_EMPLOYEE_ID: form.SWAP_WITH_EMPLOYEE_ID || null,
        REASON:                form.REASON.trim() || null,
      });
      onSaved?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div onClick={onClose}
      style={{
        position: "fixed", inset: 0, background: "rgba(15,23,42,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 16, zIndex: 200,
      }}
    >
      <div onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 12, width: "100%", maxWidth: 500,
          maxHeight: "92vh", overflowY: "auto",
          boxShadow: "0 20px 40px rgba(0,0,0,0.15)",
        }}
      >
        <div style={{
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", padding: "16px 22px", borderRadius: "12px 12px 0 0",
        }}>
          <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, color: BVC_GOLD, textTransform: "uppercase" }}>
            Change request
          </div>
          <div style={{ fontSize: 17, fontWeight: 900, marginTop: 3 }}>
            Request a shift change or swap
          </div>
        </div>

        <div style={{ padding: 20 }}>

          <FormField label="Requesting employee *">
            <select value={form.REQUESTED_BY_ID}
              onChange={(e) => setForm((f) => ({ ...f, REQUESTED_BY_ID: e.target.value }))}
              style={inputStyle}>
              <option value="">— pick employee —</option>
              {employees.map((e) => (
                <option key={e.ID} value={e.ID}>{e.NAME} ({e.EMPLOYEE_CODE || e.ID})</option>
              ))}
            </select>
          </FormField>

          <FormField label="Date *">
            <input type="date" value={form.SHIFT_DATE}
              onChange={(e) => setForm((f) => ({ ...f, SHIFT_DATE: e.target.value }))}
              style={inputStyle} />
          </FormField>

          <FormField label="Requested shift (leave blank = request OFF)">
            <select value={form.TO_SHIFT_ID}
              onChange={(e) => setForm((f) => ({ ...f, TO_SHIFT_ID: e.target.value }))}
              style={inputStyle}>
              <option value="">— OFF-day —</option>
              {shifts.map((s) => (
                <option key={s.ID} value={s.ID}>{s.NAME} ({s.START_TIME}–{s.END_TIME})</option>
              ))}
            </select>
          </FormField>

          <FormField label="Swap with (optional)">
            <select value={form.SWAP_WITH_EMPLOYEE_ID}
              onChange={(e) => setForm((f) => ({ ...f, SWAP_WITH_EMPLOYEE_ID: e.target.value }))}
              style={inputStyle}>
              <option value="">— no swap —</option>
              {employees
                .filter((e) => e.ID !== form.REQUESTED_BY_ID)
                .map((e) => (
                  <option key={e.ID} value={e.ID}>{e.NAME} ({e.EMPLOYEE_CODE || e.ID})</option>
                ))
              }
            </select>
          </FormField>

          <FormField label="Reason">
            <textarea rows={2} value={form.REASON}
              onChange={(e) => setForm((f) => ({ ...f, REASON: e.target.value }))}
              placeholder="Why the change is needed…"
              style={{ ...inputStyle, resize: "vertical", fontFamily: "inherit" }} />
          </FormField>

          {error && (
            <div style={{
              background: "#fef2f2", color: "#991b1b", padding: "9px 12px",
              borderRadius: 8, fontSize: 12, fontWeight: 600, marginTop: 10,
              border: "1px solid #fecaca",
            }}>
              {error}
            </div>
          )}

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
            <button onClick={onClose} style={btnCancel}>Cancel</button>
            <button onClick={submit} disabled={saving} style={btnPrimary(saving)}>
              {saving ? "Submitting…" : "Submit request"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Small helpers + reusable form pieces
// =====================================================================

function isoDate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function mondayOf(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const day = x.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  x.setDate(x.getDate() + diff);
  return x;
}

function shiftDay(d, delta) {
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  return x;
}


function FormRow({ children }) {
  const count = Array.isArray(children) ? children.length : 1;
  return (
    <div style={{ display: "grid", gridTemplateColumns: `repeat(${count}, 1fr)`, gap: 10 }}>
      {children}
    </div>
  );
}

function FormField({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        fontSize: 10, fontWeight: 800, color: MUTED,
        letterSpacing: 0.6, textTransform: "uppercase",
        display: "block", marginBottom: 4,
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


const inputStyle = {
  width: "100%", padding: "8px 11px",
  border: `1px solid ${BORDER}`, borderRadius: 7, fontSize: 13,
  outline: "none", color: TEXT, background: SURFACE, boxSizing: "border-box",
};

const checkboxLabel = {
  display: "inline-flex", alignItems: "center", gap: 6,
  fontSize: 12, color: TEXT, cursor: "pointer",
  padding: "6px 0",
};

const thStyle = {
  padding: "9px 10px", textAlign: "center",
  fontSize: 10, fontWeight: 800, letterSpacing: 0.6, textTransform: "uppercase",
  color: MUTED, borderBottom: `1px solid ${BORDER}`,
  whiteSpace: "nowrap",
};

const tdStyle = {
  padding: "8px 10px", borderBottom: `1px solid ${BORDER}`,
  fontSize: 12, verticalAlign: "middle",
};

const btnGhost = {
  background: "white", color: MUTED, border: `1px solid ${BORDER}`,
  padding: "6px 12px", borderRadius: 5, fontSize: 11, fontWeight: 600,
  cursor: "pointer",
};

const btnCancel = {
  background: "white", color: MUTED, border: `1px solid ${BORDER}`,
  padding: "8px 15px", borderRadius: 6, fontSize: 12, fontWeight: 700,
  cursor: "pointer",
};

const btnGreen = {
  background: "#16a34a", color: "white", border: "none",
  padding: "6px 12px", borderRadius: 5, fontSize: 11, fontWeight: 700,
  cursor: "pointer",
};

const btnRed = {
  background: "#dc2626", color: "white", border: "none",
  padding: "6px 12px", borderRadius: 5, fontSize: 11, fontWeight: 700,
  cursor: "pointer",
};

const btnPrimary = (saving) => ({
  background: BVC_RED, color: "white", border: "none",
  padding: "8px 18px", borderRadius: 6, fontSize: 12, fontWeight: 700,
  cursor: saving ? "not-allowed" : "pointer", opacity: saving ? 0.7 : 1,
});
