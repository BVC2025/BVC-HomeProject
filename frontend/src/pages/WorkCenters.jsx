// =====================================================================
// WorkCenters.jsx  —  Master list of shop-floor work centers.
//
// Used later by Routing to assign each manufacturing step to a
// physical capability. Building this is the foundation; no existing
// flow depends on it yet, so adding/removing entries is safe.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./WorkCenters.module.css";


const CATEGORY_OPTIONS = [
  { value: "FABRICATION", label: "Fabrication" },
  { value: "WELDING", label: "Welding" },
  { value: "PAINTING", label: "Painting" },
  { value: "ASSEMBLY", label: "Assembly" },
  { value: "TESTING", label: "Testing" },
  { value: "PACKAGING", label: "Packaging" },
  { value: "QC", label: "Quality Control" },
  { value: "OTHER", label: "Other" },
];

const CATEGORY_COLORS = {
  FABRICATION: { bg: "#fee2e2", fg: "#991b1b" },
  WELDING: { bg: "#fef3c7", fg: "#92400e" },
  PAINTING: { bg: "#fae8ff", fg: "#86198f" },
  ASSEMBLY: { bg: "#dbeafe", fg: "#1e40af" },
  TESTING: { bg: "#dcfce7", fg: "#166534" },
  PACKAGING: { bg: "#ffedd5", fg: "#9a3412" },
  QC: { bg: "#cffafe", fg: "#155e75" },
  OTHER: { bg: "#e2e8f0", fg: "#475569" },
};


function WorkCenters() {

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState(null);

  const load = async () => {

    setLoading(true);

    try {

      const res = await API.get("/work-centers");

      setRows(Array.isArray(res.data) ? res.data : []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const remove = async (w) => {

    if (!window.confirm(`Deactivate "${w.NAME}"? (soft-delete — historical routing data is preserved)`)) return;

    try {
      await API.delete(`/work-centers/${w.ID}`);
      load();
    } catch (err) {
      alert(err?.response?.data?.detail || "Could not deactivate.");
    }
  };

  const byCategory = useMemo(() => {

    const counts = {};

    rows.forEach((w) => {
      if (!w.IS_ACTIVE) return;
      counts[w.CATEGORY] = (counts[w.CATEGORY] || 0) + 1;
    });

    return counts;

  }, [rows]);

  const activeCount = rows.filter((w) => w.IS_ACTIVE).length;
  const inactiveCount = rows.length - activeCount;

  return (

    <div>

      {/* HERO ------------------------------------------------------- */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroEyebrow}>
            Manufacturing
          </div>
          <h1 className={styles.heroTitle}>
            Work Centers
          </h1>
        </div>

        <button
          onClick={() => setShowCreate(true)}
          className={styles.heroBtn}
        >
          + Add Work Center
        </button>
      </div>

      {/* TILES ------------------------------------------------------ */}
      <div className={styles.tileGrid}>
        <Tile label="Active" value={activeCount} accent="#16a34a" />
        <Tile label="Inactive" value={inactiveCount} accent="#94a3b8" />
        <Tile label="Fab + Weld" value={(byCategory.FABRICATION || 0) + (byCategory.WELDING || 0)} accent="#991b1b" />
        <Tile label="Assembly" value={byCategory.ASSEMBLY || 0} accent="#1e40af" />
      </div>

      {/* TABLE ------------------------------------------------------ */}
      <div className={styles.tableCard}>
        {loading && (
          <div className={styles.loadingText}>Loading…</div>
        )}

        {!loading && rows.length === 0 && (
          <div className={styles.emptyState}>
            No work centers yet. Click <strong>+ Add Work Center</strong> to start.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <table className={styles.table}>
            <thead className={styles.thead}>
              <tr>
                <th className={styles.th}>Code</th>
                <th className={styles.th}>Name</th>
                <th className={`${styles.th} ${styles.thCenter}`}>Category</th>
                <th className={`${styles.th} ${styles.thRight}`}>Capacity / hr</th>
                <th className={`${styles.th} ${styles.thRight}`}>Cost / hr</th>
                <th className={styles.th}>Location</th>
                <th className={`${styles.th} ${styles.thCenter}`}>Status</th>
                <th className={`${styles.th} ${styles.thRight}`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const c = CATEGORY_COLORS[w.CATEGORY] || CATEGORY_COLORS.OTHER;
                const dim = !w.IS_ACTIVE;
                return (
                  <tr key={w.ID} className={styles.tableRow} style={{ opacity: dim ? 0.5 : 1 }}>
                    <td className={`${styles.td} ${styles.tdCode}`}>
                      {w.CODE || "—"}
                    </td>
                    <td className={`${styles.td} ${styles.tdName}`}>
                      {w.NAME}
                    </td>
                    <td className={`${styles.td} ${styles.tdCenter}`}>
                      <Pill bg={c.bg} fg={c.fg}>{w.CATEGORY}</Pill>
                    </td>
                    <td className={`${styles.td} ${styles.tdRight} ${styles.tdCapacity}`}>
                      {Number(w.CAPACITY_PER_HOUR || 0).toFixed(1)}
                    </td>
                    <td className={`${styles.td} ${styles.tdRight} ${styles.tdCost}`}>
                      {w.HOURLY_COST > 0 ? `₹${Number(w.HOURLY_COST).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td className={`${styles.td} ${styles.tdLocation}`}>
                      {w.LOCATION || "—"}
                    </td>
                    <td className={`${styles.td} ${styles.tdCenter}`}>
                      {w.IS_ACTIVE
                        ? <Pill bg="#dcfce7" fg="#166534">Active</Pill>
                        : <Pill bg="#fee2e2" fg="#991b1b">Inactive</Pill>}
                    </td>
                    <td className={`${styles.td} ${styles.tdRight}`}>
                      <div className={styles.rowActions}>
                        <RowBtn onClick={() => setEditing(w)}>Edit</RowBtn>
                        {w.IS_ACTIVE && (
                          <RowBtn danger onClick={() => remove(w)}>Deactivate</RowBtn>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <WorkCenterModal
          mode="create"
          onClose={() => setShowCreate(false)}
          onSaved={() => { setShowCreate(false); load(); }}
        />
      )}

      {editing && (
        <WorkCenterModal
          mode="edit"
          workCenter={editing}
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

function WorkCenterModal({ mode, workCenter, onClose, onSaved }) {

  const isEdit = mode === "edit";

  const [form, setForm] = useState({
    NAME: workCenter?.NAME || "",
    CODE: workCenter?.CODE || "",
    CATEGORY: workCenter?.CATEGORY || "ASSEMBLY",
    CAPACITY_PER_HOUR: workCenter?.CAPACITY_PER_HOUR ?? 1,
    HOURLY_COST: workCenter?.HOURLY_COST ?? 0,
    LOCATION: workCenter?.LOCATION || "",
    NOTES: workCenter?.NOTES || "",
    IS_ACTIVE: workCenter ? !!workCenter.IS_ACTIVE : true,
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const update = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const save = async () => {

    if (!form.NAME.trim()) {
      setError("Name is required.");
      return;
    }

    setSaving(true);
    setError("");

    try {

      const payload = {
        ...form,
        CAPACITY_PER_HOUR: Number(form.CAPACITY_PER_HOUR) || 0,
        HOURLY_COST: Number(form.HOURLY_COST) || 0,
      };

      if (isEdit) {
        await API.patch(`/work-centers/${workCenter.ID}`, payload);
      } else {
        await API.post("/work-centers", payload);
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
      className={styles.modalBackdrop}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.modalBox}
      >
        <div className={styles.modalHeader}>
          {isEdit ? "Edit Work Center" : "Add Work Center"}
        </div>

        <div className={styles.modalBody}>
          <Field label="Name" required>
            <input type="text" maxLength={100} value={form.NAME}
              onChange={(e) => update("NAME", e.target.value)}
              placeholder="e.g. Laser Cutting"
              className={styles.fieldInput} />
          </Field>
          <Field label="Code">
            <input type="text" maxLength={20} value={form.CODE}
              onChange={(e) => update("CODE", e.target.value)}
              placeholder="LC"
              className={`${styles.fieldInput} ${styles.fieldInputUpper}`} />
          </Field>

          <Field label="Category">
            <select value={form.CATEGORY}
              onChange={(e) => update("CATEGORY", e.target.value)}
              className={styles.fieldInput}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Active">
            <label className={styles.checkboxLabel}>
              <input type="checkbox" checked={form.IS_ACTIVE}
                onChange={(e) => update("IS_ACTIVE", e.target.checked)} />
              <span>Available for routing</span>
            </label>
          </Field>

          <Field label="Capacity (units / hour)">
            <input type="number" min="0" step="0.5"
              value={form.CAPACITY_PER_HOUR}
              onChange={(e) => update("CAPACITY_PER_HOUR", e.target.value)}
              className={styles.fieldInput} />
          </Field>
          <Field label="Cost (₹ / hour)">
            <input type="number" min="0" step="10"
              value={form.HOURLY_COST}
              onChange={(e) => update("HOURLY_COST", e.target.value)}
              className={styles.fieldInput} />
          </Field>

          <Field label="Location" full>
            <input type="text" maxLength={200} value={form.LOCATION}
              onChange={(e) => update("LOCATION", e.target.value)}
              placeholder="e.g. Bay 3, Ground Floor"
              className={styles.fieldInput} />
          </Field>

          <Field label="Notes" full>
            <textarea rows={2} maxLength={500} value={form.NOTES}
              onChange={(e) => update("NOTES", e.target.value)}
              className={`${styles.fieldInput} ${styles.fieldInputResizable}`} />
          </Field>

          {error && (
            <div className={styles.errorBox}>{error}</div>
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
    <div className={styles.tile}>
      <div className={styles.tileAccent} style={{ background: accent }} />
      <div className={styles.tileLabel}>{label}</div>
      <div className={styles.tileValue}>
        {value}
      </div>
    </div>
  );
}

function Pill({ children, bg = "#e2e8f0", fg = "#475569" }) {
  return (
    <span className={styles.pill} style={{ background: bg, color: fg }}>{children}</span>
  );
}

function Field({ label, required, full, children }) {
  return (
    <div className={full ? styles.fullCol : undefined}>
      <div className={styles.fieldLabel}>
        {label}
        {required && <span className={styles.required}>*</span>}
      </div>
      {children}
    </div>
  );
}

function RowBtn({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      className={`${styles.rowBtn}${danger ? ` ${styles.rowBtnDanger}` : ""}`}
    >{children}</button>
  );
}


export default WorkCenters;
