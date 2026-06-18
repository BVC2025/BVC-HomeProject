// =====================================================================
// HolidayCalendar.jsx — Admin page for managing vendor holidays.
//
// Used by payroll generation and star-performance scoring as the
// authoritative "non-working dates" list. Sundays are not listed here
// — they're implicitly off in the working-day math.
//
// Layout matches the rest of the redesigned modules: red hero strip,
// stat tiles, single table, modal for create / edit.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


const TYPE_OPTIONS = [
  { value: "NATIONAL", label: "National" },
  { value: "REGIONAL", label: "Regional" },
  { value: "COMPANY",  label: "Company"  }
];

const TYPE_COLORS = {
  NATIONAL: { bg: "#fee2e2", fg: "#991b1b" },
  REGIONAL: { bg: "#fef3c7", fg: "#92400e" },
  COMPANY:  { bg: "#dbeafe", fg: "#1e40af" }
};


function fmtDate(iso) {

  if (!iso) return "—";

  const d = new Date(iso);

  if (Number.isNaN(d.getTime())) return "—";

  return d.toLocaleDateString("en-IN", {
    weekday: "short",
    day:     "2-digit",
    month:   "short",
    year:    "numeric"
  });
}


function HolidayCalendar() {

  const currentYear = new Date().getFullYear();

  const [year,        setYear]        = useState(currentYear);
  const [rows,        setRows]        = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [showCreate,  setShowCreate]  = useState(false);
  const [editing,     setEditing]     = useState(null);

  const yearOptions = useMemo(() => {

    return [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const load = async () => {

    setLoading(true);

    try {

      const res = await API.get(`/holidays?year=${year}`);

      setRows(res.data?.holidays || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    load();

  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const removeHoliday = async (h) => {

    if (!window.confirm(`Delete ${h.NAME} (${h.HOLIDAY_DATE})?`)) return;

    await API.delete(`/holidays/${h.ID}`);

    load();
  };

  const seedIndia = async () => {

    if (!window.confirm(
      `Seed Indian national holidays for ${year}? Existing dates are skipped.`
    )) return;

    try {

      const res = await API.post(`/holidays/seed-india?year=${year}`);

      alert(
        `${res.data?.added || 0} holidays added · ` +
        `${res.data?.skipped_already_present || 0} already present`
      );

      load();

    } catch (err) {

      alert(err?.response?.data?.detail || "Seed failed");
    }
  };

  const byType = useMemo(() => {

    const acc = { NATIONAL: 0, REGIONAL: 0, COMPANY: 0 };

    rows.forEach((r) => { if (acc[r.TYPE] !== undefined) acc[r.TYPE]++; });

    return acc;

  }, [rows]);

  return (

    <div>

      {/* HERO ------------------------------------------------------- */}
      <div style={{
        background: "linear-gradient(135deg, #C8102E 0%, #A60F26 50%, #8B0B1F 100%)",
        color: "white",
        padding: "20px 28px",
        borderRadius: 14,
        marginBottom: 22,
        boxShadow: "0 6px 18px rgba(139,11,31,0.18)",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 16
      }}>
        <div>
          <div style={{
            fontSize: 10,
            letterSpacing: 2,
            color: "#fde047",
            fontWeight: 700,
            textTransform: "uppercase"
          }}>
            Calendar
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Holidays
          </h1>
        </div>

        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{
              padding: "10px 14px",
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.4)",
              background: "transparent",
              color: "white",
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0.6,
              cursor: "pointer"
            }}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y} style={{ color: "#0f172a" }}>{y}</option>
            ))}
          </select>

          <button
            onClick={seedIndia}
            style={{
              background: "transparent",
              color: "white",
              border: "1px solid rgba(255,255,255,0.45)",
              padding: "10px 18px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              cursor: "pointer"
            }}
          >
            Seed India
          </button>

          <button
            onClick={() => setShowCreate(true)}
            style={{
              background: "white",
              color: "#8B0B1F",
              border: "none",
              padding: "10px 20px",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 12,
              letterSpacing: 0.6,
              textTransform: "uppercase",
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(0,0,0,0.15)"
            }}
          >
            + Add Holiday
          </button>
        </div>
      </div>

      {/* TILES ------------------------------------------------------ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        marginBottom: 18
      }}>
        <Tile label="Total"     value={rows.length}        accent="#0f172a" />
        <Tile label="National"  value={byType.NATIONAL}    accent="#991b1b" />
        <Tile label="Regional"  value={byType.REGIONAL}    accent="#92400e" />
        <Tile label="Company"   value={byType.COMPANY}     accent="#1e40af" />
      </div>

      {/* TABLE ------------------------------------------------------ */}
      <div style={{
        background: "white",
        padding: 18,
        borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.06)"
      }}>
        {loading && (
          <div style={{ color: "#94a3b8", padding: 20 }}>Loading…</div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{
            padding: 36,
            textAlign: "center",
            color: "#94a3b8",
            fontSize: 13
          }}>
            No holidays declared for {year}.
            Click <strong>+ Add Holiday</strong> or <strong>Seed India</strong>.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13
          }}>
            <thead>
              <tr style={{
                background: "#f8fafc",
                color: "#475569",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: 0.5
              }}>
                <th style={th()}>Date</th>
                <th style={th()}>Name</th>
                <th style={th("center")}>Type</th>
                <th style={th("center")}>Optional</th>
                <th style={th()}>Notes</th>
                <th style={th("right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={{ ...td(), fontWeight: 700, color: "#0f172a" }}>
                    {fmtDate(h.HOLIDAY_DATE)}
                  </td>
                  <td style={td()}>{h.NAME}</td>
                  <td style={td("center")}>
                    <Pill {...(TYPE_COLORS[h.TYPE] || {})}>
                      {h.TYPE}
                    </Pill>
                  </td>
                  <td style={{ ...td("center"), color: h.IS_OPTIONAL ? "#92400e" : "#94a3b8" }}>
                    {h.IS_OPTIONAL ? "Yes" : "—"}
                  </td>
                  <td style={{ ...td(), color: "#64748b", fontSize: 12 }}>
                    {h.NOTES || "—"}
                  </td>
                  <td style={td("right")}>
                    <div style={{ display: "inline-flex", gap: 6 }}>
                      <RowBtn onClick={() => setEditing(h)}>Edit</RowBtn>
                      <RowBtn danger onClick={() => removeHoliday(h)}>Delete</RowBtn>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <HolidayModal
          mode="create"
          year={year}
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}

      {editing && (
        <HolidayModal
          mode="edit"
          holiday={editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </div>
  );
}


// =====================================================================
// Create / Edit modal
// =====================================================================

function HolidayModal({ mode, holiday, year, onClose, onSaved }) {

  const isEdit = mode === "edit";

  const [form, setForm] = useState({
    HOLIDAY_DATE: holiday?.HOLIDAY_DATE || (year ? `${year}-01-01` : ""),
    NAME:         holiday?.NAME || "",
    TYPE:         holiday?.TYPE || "NATIONAL",
    IS_OPTIONAL:  !!holiday?.IS_OPTIONAL,
    NOTES:        holiday?.NOTES || ""
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {

    if (!form.HOLIDAY_DATE || !form.NAME.trim()) {

      setError("Date and name are required.");

      return;
    }

    setSaving(true);

    setError("");

    try {

      if (isEdit) {

        await API.patch(`/holidays/${holiday.ID}`, {
          NAME:        form.NAME,
          TYPE:        form.TYPE,
          IS_OPTIONAL: form.IS_OPTIONAL,
          NOTES:       form.NOTES || null
        });

      } else {

        await API.post("/holidays", form);
      }

      onSaved();

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
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.45)",
        zIndex: 1000,
        display: "flex", alignItems: "center", justifyContent: "center",
        padding: 24
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "white", borderRadius: 14, width: "100%",
          maxWidth: 520, boxShadow: "0 24px 60px rgba(15,23,42,0.20)"
        }}
      >
        <div style={{
          padding: "16px 22px",
          borderBottom: "1px solid #f1f5f9",
          fontSize: 14, fontWeight: 800, color: "#0f172a",
          letterSpacing: 0.3
        }}>
          {isEdit ? "Edit Holiday" : "Add Holiday"}
        </div>

        <div style={{ padding: 22, display: "grid", gap: 14 }}>
          <Field label="Date" required>
            <input
              type="date"
              value={form.HOLIDAY_DATE}
              onChange={(e) => update("HOLIDAY_DATE", e.target.value)}
              disabled={isEdit}
              style={inputStyle()}
            />
          </Field>

          <Field label="Name" required>
            <input
              type="text"
              maxLength={120}
              value={form.NAME}
              onChange={(e) => update("NAME", e.target.value)}
              placeholder="e.g. Diwali, Founders Day"
              style={inputStyle()}
            />
          </Field>

          <Field label="Type">
            <select
              value={form.TYPE}
              onChange={(e) => update("TYPE", e.target.value)}
              style={inputStyle()}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Optional holiday">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input
                type="checkbox"
                checked={form.IS_OPTIONAL}
                onChange={(e) => update("IS_OPTIONAL", e.target.checked)}
              />
              <span style={{ color: "#64748b" }}>
                Employees may or may not get this day off
              </span>
            </label>
          </Field>

          <Field label="Notes">
            <textarea
              rows={2}
              maxLength={500}
              value={form.NOTES}
              onChange={(e) => update("NOTES", e.target.value)}
              style={{ ...inputStyle(), resize: "vertical" }}
            />
          </Field>

          {error && (
            <div style={{
              padding: 10, background: "#fee2e2", color: "#991b1b",
              borderRadius: 8, fontSize: 12
            }}>
              {error}
            </div>
          )}
        </div>

        <div style={{
          padding: "12px 22px 18px",
          display: "flex", justifyContent: "flex-end", gap: 10
        }}>
          <button onClick={onClose} style={btnSecondary()}>Cancel</button>
          <button onClick={save} disabled={saving} style={btnPrimary(saving)}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Styled primitives
// =====================================================================

function Tile({ label, value, accent }) {
  return (
    <div style={{
      background: "white", padding: "14px 18px", borderRadius: 12,
      boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
      position: "relative", overflow: "hidden"
    }}>
      <div style={{
        position: "absolute", top: 14, bottom: 14, left: 0, width: 3,
        background: accent, borderRadius: "0 3px 3px 0"
      }} />
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#64748b",
        letterSpacing: 0.8, textTransform: "uppercase", marginBottom: 6
      }}>
        {label}
      </div>
      <div style={{ fontSize: 24, fontWeight: 800, color: "#0f172a", lineHeight: 1 }}>
        {value}
      </div>
    </div>
  );
}


function Pill({ children, bg = "#e2e8f0", fg = "#475569" }) {
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
      background: bg, color: fg, textTransform: "uppercase"
    }}>
      {children}
    </span>
  );
}


function Field({ label, required, children }) {
  return (
    <div>
      <div style={{
        fontSize: 10, fontWeight: 700, color: "#64748b",
        letterSpacing: 0.6, textTransform: "uppercase", marginBottom: 4
      }}>
        {label}
        {required && <span style={{ color: "#C8102E", marginLeft: 4 }}>*</span>}
      </div>
      {children}
    </div>
  );
}


function RowBtn({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        background: "transparent",
        border: `1px solid ${danger ? "#fecaca" : "#cbd5e1"}`,
        color: danger ? "#b91c1c" : "#475569",
        padding: "4px 10px", borderRadius: 6, fontSize: 10,
        fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
        cursor: "pointer"
      }}
    >
      {children}
    </button>
  );
}


function inputStyle() {
  return {
    width: "100%", padding: "9px 12px", border: "1px solid #cbd5e1",
    borderRadius: 8, fontSize: 13, background: "white", color: "#0f172a",
    boxSizing: "border-box", fontFamily: "inherit"
  };
}


function btnPrimary(disabled) {
  return {
    background: disabled ? "#cbd5e1" : "#8B0B1F", color: "white",
    border: "none", padding: "10px 20px", borderRadius: 8,
    fontWeight: 800, fontSize: 12, letterSpacing: 0.6,
    textTransform: "uppercase", cursor: disabled ? "default" : "pointer"
  };
}


function btnSecondary() {
  return {
    background: "white", color: "#475569",
    border: "1px solid #cbd5e1", padding: "10px 18px", borderRadius: 8,
    fontWeight: 700, fontSize: 12, letterSpacing: 0.6,
    textTransform: "uppercase", cursor: "pointer"
  };
}


function th(align = "left") {
  return {
    padding: "10px 8px", textAlign: align, fontWeight: 700,
    borderBottom: "1px solid #e2e8f0"
  };
}


function td(align = "left") {
  return { padding: "12px 8px", textAlign: align, verticalAlign: "top" };
}


export default HolidayCalendar;
