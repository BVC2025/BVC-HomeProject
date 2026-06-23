// =====================================================================
// HolidayCalendar.jsx — Admin page for managing vendor holidays.
//
// Used by payroll generation and star-performance scoring as the
// authoritative "non-working dates" list. Sundays are not listed here
// — they're implicitly off in the working-day math.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./HolidayCalendar.module.css";


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
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>Calendar</div>
          <h1 className={styles.heroTitle}>Holidays</h1>
        </div>

        <div className={styles.heroActions}>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className={styles.yearSelect}
          >
            {yearOptions.map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>

          <button onClick={seedIndia} className={styles.ghostBtn}>
            Seed India
          </button>

          <button onClick={() => setShowCreate(true)} className={styles.addBtn}>
            + Add Holiday
          </button>
        </div>
      </div>

      {/* TILES ------------------------------------------------------ */}
      <div className={styles.tilesGrid}>
        <Tile label="Total"    value={rows.length}     accent="#0f172a" />
        <Tile label="National" value={byType.NATIONAL} accent="#991b1b" />
        <Tile label="Regional" value={byType.REGIONAL} accent="#92400e" />
        <Tile label="Company"  value={byType.COMPANY}  accent="#1e40af" />
      </div>

      {/* TABLE ------------------------------------------------------ */}
      <div className={styles.tablePanel}>
        {loading && (
          <div className={styles.loadingText}>Loading…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className={styles.emptyText}>
            No holidays declared for {year}.
            Click <strong>+ Add Holiday</strong> or <strong>Seed India</strong>.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Date</th>
                <th className={styles.th}>Name</th>
                <th className={styles.thCenter}>Type</th>
                <th className={styles.thCenter}>Optional</th>
                <th className={styles.th}>Notes</th>
                <th className={styles.thRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((h) => (
                <tr key={h.ID} className={styles.tr}>
                  <td className={styles.tdDate}>{fmtDate(h.HOLIDAY_DATE)}</td>
                  <td className={styles.td}>{h.NAME}</td>
                  <td className={styles.tdCenter}>
                    <Pill {...(TYPE_COLORS[h.TYPE] || {})}>
                      {h.TYPE}
                    </Pill>
                  </td>
                  <td className={h.IS_OPTIONAL ? styles.tdOptionalYes : styles.tdOptional}>
                    {h.IS_OPTIONAL ? "Yes" : "—"}
                  </td>
                  <td className={styles.tdNotes}>{h.NOTES || "—"}</td>
                  <td className={styles.tdRight}>
                    <div className={styles.rowBtnWrap}>
                      <button className={styles.rowBtn} onClick={() => setEditing(h)}>Edit</button>
                      <button className={styles.rowBtnDanger} onClick={() => removeHoliday(h)}>Delete</button>
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

    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          {isEdit ? "Edit Holiday" : "Add Holiday"}
        </div>

        <div className={styles.modalBody}>
          <Field label="Date" required>
            <input
              type="date"
              value={form.HOLIDAY_DATE}
              onChange={(e) => update("HOLIDAY_DATE", e.target.value)}
              disabled={isEdit}
              className={styles.input}
            />
          </Field>

          <Field label="Name" required>
            <input
              type="text"
              maxLength={120}
              value={form.NAME}
              onChange={(e) => update("NAME", e.target.value)}
              placeholder="e.g. Diwali, Founders Day"
              className={styles.input}
            />
          </Field>

          <Field label="Type">
            <select
              value={form.TYPE}
              onChange={(e) => update("TYPE", e.target.value)}
              className={styles.input}
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </Field>

          <Field label="Optional holiday">
            <label className={styles.checkboxRow}>
              <input
                type="checkbox"
                checked={form.IS_OPTIONAL}
                onChange={(e) => update("IS_OPTIONAL", e.target.checked)}
              />
              <span>Employees may or may not get this day off</span>
            </label>
          </Field>

          <Field label="Notes">
            <textarea
              rows={2}
              maxLength={500}
              value={form.NOTES}
              onChange={(e) => update("NOTES", e.target.value)}
              className={styles.textareaInput}
            />
          </Field>

          {error && (
            <div className={styles.errorBanner}>{error}</div>
          )}
        </div>

        <div className={styles.modalFooter}>
          <button onClick={onClose} className={styles.btnSecondary}>Cancel</button>
          <button onClick={save} disabled={saving} className={styles.btnPrimary}>
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
    <div className={styles.tile} style={{ "--tile-accent": accent }}>
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>{value}</div>
    </div>
  );
}


function Pill({ children, bg = "#e2e8f0", fg = "#475569" }) {
  return (
    <span className={styles.pill} style={{ background: bg, color: fg }}>
      {children}
    </span>
  );
}


function Field({ label, required, children }) {
  return (
    <div>
      <div className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.fieldRequired}>*</span>}
      </div>
      {children}
    </div>
  );
}


export default HolidayCalendar;
