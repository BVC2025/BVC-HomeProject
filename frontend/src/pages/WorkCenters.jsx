// =====================================================================
// WorkCenters.jsx  —  Master list of shop-floor work centers.
//
// Used later by Routing to assign each manufacturing step to a
// physical capability. Building this is the foundation; no existing
// flow depends on it yet, so adding/removing entries is safe.
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


const CATEGORY_OPTIONS = [
  { value: "FABRICATION", label: "Fabrication" },
  { value: "WELDING",     label: "Welding" },
  { value: "PAINTING",    label: "Painting" },
  { value: "ASSEMBLY",    label: "Assembly" },
  { value: "TESTING",     label: "Testing" },
  { value: "PACKAGING",   label: "Packaging" },
  { value: "QC",          label: "Quality Control" },
  { value: "OTHER",       label: "Other" },
];

const CATEGORY_COLORS = {
  FABRICATION: { bg: "#fee2e2", fg: "#991b1b" },
  WELDING:     { bg: "#fef3c7", fg: "#92400e" },
  PAINTING:    { bg: "#fae8ff", fg: "#86198f" },
  ASSEMBLY:    { bg: "#dbeafe", fg: "#1e40af" },
  TESTING:     { bg: "#dcfce7", fg: "#166534" },
  PACKAGING:   { bg: "#ffedd5", fg: "#9a3412" },
  QC:          { bg: "#cffafe", fg: "#155e75" },
  OTHER:       { bg: "#e2e8f0", fg: "#475569" },
};


function WorkCenters() {

  const [rows, setRows]       = useState([]);
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

  const activeCount   = rows.filter((w) => w.IS_ACTIVE).length;
  const inactiveCount = rows.length - activeCount;

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
            Manufacturing
          </div>
          <h1 style={{
            fontSize: 22,
            fontWeight: 700,
            margin: "4px 0 0",
            lineHeight: 1.2,
            color: "white",
            letterSpacing: -0.3
          }}>
            Work Centers
          </h1>
        </div>

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
          + Add Work Center
        </button>
      </div>

      {/* TILES ------------------------------------------------------ */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 14,
        marginBottom: 18
      }}>
        <Tile label="Active"      value={activeCount}                   accent="#16a34a" />
        <Tile label="Inactive"    value={inactiveCount}                 accent="#94a3b8" />
        <Tile label="Fab + Weld"  value={(byCategory.FABRICATION||0)+(byCategory.WELDING||0)}  accent="#991b1b" />
        <Tile label="Assembly"    value={byCategory.ASSEMBLY || 0}      accent="#1e40af" />
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
            No work centers yet. Click <strong>+ Add Work Center</strong> to start.
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
                <th style={th()}>Code</th>
                <th style={th()}>Name</th>
                <th style={th("center")}>Category</th>
                <th style={th("right")}>Capacity / hr</th>
                <th style={th("right")}>Cost / hr</th>
                <th style={th()}>Location</th>
                <th style={th("center")}>Status</th>
                <th style={th("right")}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => {
                const c = CATEGORY_COLORS[w.CATEGORY] || CATEGORY_COLORS.OTHER;
                const dim = !w.IS_ACTIVE;
                return (
                  <tr key={w.ID} style={{
                    borderBottom: "1px solid #f1f5f9",
                    opacity: dim ? 0.5 : 1
                  }}>
                    <td style={{ ...td(), fontFamily: "ui-monospace, monospace", color: "#64748b" }}>
                      {w.CODE || "—"}
                    </td>
                    <td style={{ ...td(), fontWeight: 700, color: "#0f172a" }}>
                      {w.NAME}
                    </td>
                    <td style={td("center")}>
                      <Pill bg={c.bg} fg={c.fg}>{w.CATEGORY}</Pill>
                    </td>
                    <td style={{ ...td("right"), fontWeight: 700 }}>
                      {Number(w.CAPACITY_PER_HOUR || 0).toFixed(1)}
                    </td>
                    <td style={{ ...td("right"), color: "#64748b" }}>
                      {w.HOURLY_COST > 0 ? `₹${Number(w.HOURLY_COST).toLocaleString("en-IN")}` : "—"}
                    </td>
                    <td style={{ ...td(), color: "#64748b" }}>
                      {w.LOCATION || "—"}
                    </td>
                    <td style={td("center")}>
                      {w.IS_ACTIVE
                        ? <Pill bg="#dcfce7" fg="#166534">Active</Pill>
                        : <Pill bg="#fee2e2" fg="#991b1b">Inactive</Pill>}
                    </td>
                    <td style={td("right")}>
                      <div style={{ display: "inline-flex", gap: 6 }}>
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
    NAME:              workCenter?.NAME              || "",
    CODE:              workCenter?.CODE              || "",
    CATEGORY:          workCenter?.CATEGORY          || "ASSEMBLY",
    CAPACITY_PER_HOUR: workCenter?.CAPACITY_PER_HOUR ?? 1,
    HOURLY_COST:       workCenter?.HOURLY_COST       ?? 0,
    LOCATION:          workCenter?.LOCATION          || "",
    NOTES:             workCenter?.NOTES             || "",
    IS_ACTIVE:         workCenter ? !!workCenter.IS_ACTIVE : true,
  });

  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState("");

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
        HOURLY_COST:       Number(form.HOURLY_COST) || 0,
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
          maxWidth: 600, boxShadow: "0 24px 60px rgba(15,23,42,0.20)",
        }}
      >
        <div style={{
          padding: "16px 22px",
          borderBottom: "1px solid #f1f5f9",
          fontSize: 14, fontWeight: 800, color: "#0f172a", letterSpacing: 0.3
        }}>
          {isEdit ? "Edit Work Center" : "Add Work Center"}
        </div>

        <div style={{ padding: 22, display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14 }}>
          <Field label="Name" required>
            <input type="text" maxLength={100} value={form.NAME}
                   onChange={(e) => update("NAME", e.target.value)}
                   placeholder="e.g. Laser Cutting"
                   style={inputStyle()} />
          </Field>
          <Field label="Code">
            <input type="text" maxLength={20} value={form.CODE}
                   onChange={(e) => update("CODE", e.target.value)}
                   placeholder="LC"
                   style={{ ...inputStyle(), textTransform: "uppercase" }} />
          </Field>

          <Field label="Category">
            <select value={form.CATEGORY}
                    onChange={(e) => update("CATEGORY", e.target.value)}
                    style={inputStyle()}>
              {CATEGORY_OPTIONS.map((c) => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Active">
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <input type="checkbox" checked={form.IS_ACTIVE}
                     onChange={(e) => update("IS_ACTIVE", e.target.checked)} />
              <span style={{ color: "#64748b" }}>Available for routing</span>
            </label>
          </Field>

          <Field label="Capacity (units / hour)">
            <input type="number" min="0" step="0.5"
                   value={form.CAPACITY_PER_HOUR}
                   onChange={(e) => update("CAPACITY_PER_HOUR", e.target.value)}
                   style={inputStyle()} />
          </Field>
          <Field label="Cost (₹ / hour)">
            <input type="number" min="0" step="10"
                   value={form.HOURLY_COST}
                   onChange={(e) => update("HOURLY_COST", e.target.value)}
                   style={inputStyle()} />
          </Field>

          <Field label="Location" full>
            <input type="text" maxLength={200} value={form.LOCATION}
                   onChange={(e) => update("LOCATION", e.target.value)}
                   placeholder="e.g. Bay 3, Ground Floor"
                   style={inputStyle()} />
          </Field>

          <Field label="Notes" full>
            <textarea rows={2} maxLength={500} value={form.NOTES}
                      onChange={(e) => update("NOTES", e.target.value)}
                      style={{ ...inputStyle(), resize: "vertical" }} />
          </Field>

          {error && (
            <div style={{
              gridColumn: "1 / -1",
              padding: 10, background: "#fee2e2", color: "#991b1b",
              borderRadius: 8, fontSize: 12
            }}>{error}</div>
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
      }}>{label}</div>
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
    }}>{children}</span>
  );
}

function Field({ label, required, full, children }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
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
    <button onClick={onClick} style={{
      background: "transparent",
      border: `1px solid ${danger ? "#fecaca" : "#cbd5e1"}`,
      color: danger ? "#b91c1c" : "#475569",
      padding: "4px 10px", borderRadius: 6, fontSize: 10,
      fontWeight: 700, letterSpacing: 0.4, textTransform: "uppercase",
      cursor: "pointer"
    }}>{children}</button>
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


export default WorkCenters;
