import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";


// ===================================================================
// Customers — customer-centric command center.
//
// Every customer card surfaces the essentials at a glance: contact,
// industry, KYC, # of projects, units delivered, status. Click a
// card → 360° drawer shows the projects + work orders + machine
// models being built for them + BOM previews — directly wiring this
// module to Production & BOM.
// ===================================================================


const INDUSTRIES = [
  "Retail",
  "Healthcare",
  "Education",
  "Office",
  "Metro / Transport",
  "Hotel / Hospitality",
  "Government",
  "Manufacturing",
  "Other"
];


const SOURCES = [
  "Website",
  "Exhibition",
  "Referral",
  "Direct Sales",
  "Tender",
  "Cold Call",
  "Other"
];


const STATUS_THEMES = {
  ACTIVE: { bg: "#dcfce7", fg: "#166534", grad: "linear-gradient(135deg,#10b981,#059669)" },
  PROSPECT: { bg: "#dbeafe", fg: "#1e40af", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" },
  LEAD: { bg: "#fef3c7", fg: "#854d0e", grad: "linear-gradient(135deg,#F4B324,#C8102E)" },
  INACTIVE: { bg: "#f1f5f9", fg: "#475569", grad: "linear-gradient(135deg,#94a3b8,#64748b)" }
};


const INDUSTRY_EMOJI = {
  "Retail": "🛍️",
  "Healthcare": "🏥",
  "Education": "🎓",
  "Office": "🏢",
  "Metro / Transport": "🚆",
  "Hotel / Hospitality": "🏨",
  "Government": "🏛️",
  "Manufacturing": "🏭",
  "Other": "📦"
};


// =================================================================
// Reusable atoms
// =================================================================

function StatTile({ label, value, sub, color, icon }) {

  return (

    <div
      style={{
        background: "white",
        padding: "18px 20px",
        borderRadius: 14,
        boxShadow: "0 6px 20px rgba(15,23,42,0.07)",
        borderTop: `3px solid ${color}`,
        position: "relative",
        overflow: "hidden"
      }}
    >
      {icon && (
        <div
          style={{
            position: "absolute",
            top: 14,
            right: 14,
            fontSize: 22,
            opacity: 0.85
          }}
        >
          {icon}
        </div>
      )}

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
          fontWeight: 800,
          color: "#0f172a",
          marginTop: 4,
          letterSpacing: -0.5
        }}
      >
        {value}
      </div>

      {sub && (
        <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}


function StatusPill({ status }) {

  const t = STATUS_THEMES[status] || STATUS_THEMES.ACTIVE;

  return (

    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: t.bg,
        color: t.fg,
        letterSpacing: 0.5,
        textTransform: "uppercase"
      }}
    >
      {status || "ACTIVE"}
    </span>
  );
}


// Lead pipeline status pill — different palette + icons so it's
// visually distinct from the overall customer status.
const LEAD_STATUS_THEMES = {
  NEW: { bg: "#e0e7ff", fg: "#3730a3", icon: "🆕" },
  CONTACTED: { bg: "#dbeafe", fg: "#1e40af", icon: "📞" },
  QUALIFIED: { bg: "#cffafe", fg: "#0e7490", icon: "✓" },
  QUOTED: { bg: "#fef3c7", fg: "#92400e", icon: "📄" },
  NEGOTIATING: { bg: "#fce7f3", fg: "#9d174d", icon: "💬" },
  WON: { bg: "#dcfce7", fg: "#166534", icon: "🏆" },
  LOST: { bg: "#fee2e2", fg: "#991b1b", icon: "❌" }
};


function LeadStatusPill({ status }) {

  const t = LEAD_STATUS_THEMES[status] || LEAD_STATUS_THEMES.NEW;

  return (

    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: t.bg,
        color: t.fg,
        letterSpacing: 0.5,
        textTransform: "uppercase"
      }}
    >
      <span aria-hidden="true">{t.icon}</span>
      {status}
    </span>
  );
}


// =================================================================
// Customer card
// =================================================================

function CustomerCard({ customer, onOpen, onDelete, onEdit, onGenerateQuote }) {

  const status = customer.STATUS || "ACTIVE";

  const theme = STATUS_THEMES[status] || STATUS_THEMES.ACTIVE;

  const industryIcon = INDUSTRY_EMOJI[customer.INDUSTRY] || "🏢";

  const [deleting, setDeleting] = useState(false);

  const handleDelete = async (e) => {

    e.stopPropagation();

    const ok = window.confirm(
      `Delete customer "${customer.CUSTOMER_NAME}" (${customer.CUSTOMER_CODE})?\n\n` +
      `Contacts and requirements will be REMOVED.\n` +
      `Projects, quotations, sales orders, and onboarding sessions ` +
      `will be UNLINKED (kept for audit, just no longer tied to ` +
      `this customer name).\n\n` +
      `This cannot be undone.`
    );

    if (!ok) return;

    setDeleting(true);

    try {

      const res = await API.delete(`/delete-customer/${customer.ID}`);

      if (res?.data?.message) {

        // Quick toast-style notification of what got cleaned up
        console.log("Customer delete:", res.data);
      }

      onDelete?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Delete failed");

    } finally {

      setDeleting(false);
    }
  };

  return (

    <div
      onClick={() => onOpen(customer)}
      className="bvc-cust-card"
      style={{
        background: "white",
        borderRadius: 16,
        padding: 18,
        boxShadow: "0 10px 30px rgba(15,23,42,0.07)",
        cursor: "pointer",
        position: "relative",
        overflow: "hidden",
        animation: "bvcCustFadeIn 0.4s ease-out both"
      }}
    >

      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 4,
          background: theme.grad
        }}
      />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onGenerateQuote?.(customer);
        }}
        title="Auto-generate quotation from this customer's requirements"
        style={{
          position: "absolute",
          top: 10,
          right: 78,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #fbcfe8",
          background: "linear-gradient(135deg,#C8102E,#8B0B1F)",
          color: "white",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 5,
          boxShadow: "0 4px 10px rgba(200,16,46,0.35)"
        }}
      >
        📑
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(customer);
        }}
        title="Edit customer"
        style={{
          position: "absolute",
          top: 10,
          right: 44,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #bae6fd",
          background: "#f0f9ff",
          color: "#0369a1",
          cursor: "pointer",
          fontSize: 12,
          fontWeight: 700,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 5
        }}
      >
        ✏️
      </button>

      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete customer"
        style={{
          position: "absolute",
          top: 10,
          right: 10,
          width: 26,
          height: 26,
          borderRadius: "50%",
          border: "1px solid #fecaca",
          background: deleting ? "#f1f5f9" : "#fef2f2",
          color: deleting ? "#94a3b8" : "#b91c1c",
          cursor: deleting ? "default" : "pointer",
          fontSize: 14,
          fontWeight: 700,
          lineHeight: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          zIndex: 5
        }}
      >
        {deleting ? "…" : "×"}
      </button>

      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginBottom: 12
        }}
      >

        <div
          style={{
            width: 50,
            height: 50,
            borderRadius: 12,
            background: theme.grad,
            color: "white",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 22,
            fontWeight: 800,
            flexShrink: 0,
            boxShadow: `0 6px 16px ${theme.fg}33`,
            position: "relative"
          }}
        >
          {(customer.CUSTOMER_NAME || "?").charAt(0).toUpperCase()}

          <span
            style={{
              position: "absolute",
              bottom: -4,
              right: -4,
              background: "white",
              borderRadius: "50%",
              width: 22,
              height: 22,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 12,
              boxShadow: "0 2px 6px rgba(15,23,42,0.18)",
              border: "1px solid #e2e8f0"
            }}
          >
            {industryIcon}
          </span>
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>

          <div
            style={{
              fontSize: 10,
              fontFamily: "ui-monospace, monospace",
              color: "#94a3b8",
              letterSpacing: 1
            }}
          >
            {customer.CUSTOMER_CODE || "—"}
          </div>

          <div
            style={{
              fontSize: 15,
              fontWeight: 800,
              color: "#0f172a",
              marginTop: 1,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis"
            }}
          >
            {customer.CUSTOMER_NAME}
          </div>

          <div style={{ marginTop: 4, display: "flex", flexWrap: "wrap", gap: 4 }}>
            <StatusPill status={status} />
            {customer.LEAD_STATUS && customer.LEAD_STATUS !== "NEW" && (
              <LeadStatusPill status={customer.LEAD_STATUS} />
            )}
            {customer.LEAD_PRIORITY === "HIGH" && (
              <span style={{
                fontSize: 9,
                fontWeight: 800,
                padding: "2px 7px",
                borderRadius: 999,
                background: "#fee2e2",
                color: "#991b1b",
                letterSpacing: 0.4
              }}>
                🔥 HIGH
              </span>
            )}
          </div>
        </div>
      </div>

      {customer.ASSIGNED_SALES_NAME && (
        <div style={{
          fontSize: 11,
          color: "#64748b",
          marginBottom: 10,
          background: "#fdf2f8",
          padding: "5px 10px",
          borderRadius: 6,
          border: "1px solid #fbcfe8"
        }}>
          🎯 Sales: <strong style={{ color: "#9d174d" }}>
            {customer.ASSIGNED_SALES_NAME}
          </strong>
        </div>
      )}

      {customer.FOLLOW_UP_DATE && customer.LEAD_STATUS !== "WON" && customer.LEAD_STATUS !== "LOST" && (
        <div style={{
          fontSize: 11,
          color: "#92400e",
          marginBottom: 10,
          background: "#fef3c7",
          padding: "5px 10px",
          borderRadius: 6,
          border: "1px solid #fde68a"
        }}>
          📞 Follow-up: <strong>{customer.FOLLOW_UP_DATE}</strong>
        </div>
      )}

      <div
        style={{
          background: "#f8fafc",
          borderRadius: 10,
          padding: "10px 12px",
          marginBottom: 10,
          fontSize: 12,
          color: "#475569",
          lineHeight: 1.5
        }}
      >
        {customer.CONTACT_PERSON && (
          <div style={{ color: "#0f172a", fontWeight: 600 }}>
            👤 {customer.CONTACT_PERSON}
            {customer.DESIGNATION && (
              <span style={{ color: "#64748b", fontWeight: 400 }}>
                {" · "}{customer.DESIGNATION}
              </span>
            )}
          </div>
        )}
        <div>📞 {customer.PHONE || "—"}</div>
        <div
          style={{
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis"
          }}
        >
          ✉️ {customer.EMAIL || "—"}
        </div>
        {(customer.CITY || customer.STATE) && (
          <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>
            📍 {[customer.CITY, customer.STATE].filter(Boolean).join(", ")}
          </div>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 10 }}>
        {customer.INDUSTRY && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#e0f2fe",
              color: "#0369a1"
            }}
          >
            {customer.INDUSTRY}
          </span>
        )}
        {customer.SOURCE && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#ede9fe",
              color: "#6d28d9"
            }}
          >
            via {customer.SOURCE}
          </span>
        )}
        {customer.GST_NUMBER && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              padding: "2px 8px",
              borderRadius: 999,
              background: "#f1f5f9",
              color: "#475569",
              fontFamily: "ui-monospace, monospace"
            }}
            title="GST registered"
          >
            GST ✓
          </span>
        )}
      </div>

      <div
        style={{
          padding: "8px 12px",
          background: "linear-gradient(135deg, #fef2f2 0%, #fff4e6 100%)",
          borderRadius: 8,
          fontSize: 11,
          color: "#4338ca",
          fontWeight: 700,
          textAlign: "center",
          letterSpacing: 0.4
        }}
      >
        Open 360° → projects, machines & BOM ✨
      </div>
    </div>
  );
}


// =================================================================
// Customer create/edit form
// =================================================================

function FormField({ label, children, span = 1 }) {

  return (

    <div style={{ gridColumn: `span ${span}` }}>

      <label
        style={{
          fontSize: 11,
          color: "#64748b",
          fontWeight: 700,
          letterSpacing: 0.5,
          display: "block",
          marginBottom: 4,
          textTransform: "uppercase"
        }}
      >
        {label}
      </label>

      {children}
    </div>
  );
}


function inputStyle() {

  return {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white"
  };
}


// =================================================================
// Phase 2 — Customer Requirements (multi-spec list)
// =================================================================

const REQ_STATUS_THEME = {
  DRAFT: { bg: "#f1f5f9", fg: "#475569" },
  CONFIRMED: { bg: "#dbeafe", fg: "#1d4ed8" },
  QUOTED: { bg: "#fef3c7", fg: "#854d0e" },
  ORDERED: { bg: "#dcfce7", fg: "#166534" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" }
};

const REQ_PRIORITY_THEME = {
  HIGH: { bg: "#fee2e2", fg: "#991b1b" },
  MEDIUM: { bg: "#fef3c7", fg: "#854d0e" },
  LOW: { bg: "#f1f5f9", fg: "#475569" }
};

const MACHINE_CATEGORIES = [
  "Coffee",
  "Snack",
  "Beverage",
  "Combo",
  "Water Dispenser",
  "Custom"
];


function RequirementsManager({ customerId }) {

  const [rows, setRows] = useState([]);

  const [loading, setLoading] = useState(false);

  const [editing, setEditing] = useState(null);
  // null = list view; "new" = new form; object = edit form

  const [products, setProducts] = useState([]);

  const load = () => {

    setLoading(true);

    API.get(`/customers/${customerId}/requirements`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    if (!customerId) return;

    load();

    API.get("/production/models?vendor_id=1")
      .then((r) => setProducts(r.data || []))
      .catch(() => setProducts([]));

  }, [customerId]);

  const remove = async (id) => {

    if (!window.confirm("Delete this requirement?")) return;

    try {

      await API.delete(`/customers/${customerId}/requirements/${id}`);

      load();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to delete");
    }
  };

  if (editing) {

    return (

      <RequirementForm
        customerId={customerId}
        initial={editing === "new" ? null : editing}
        products={products}
        onCancel={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          load();
        }}
      />
    );
  }

  return (

    <div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#10b981", textTransform: "uppercase" }}>
          📋 Customer Requirements ({rows.length})
        </div>

        <button
          type="button"
          onClick={() => setEditing("new")}
          style={{
            border: "none",
            background: "linear-gradient(135deg,#10b981,#059669)",
            color: "white",
            padding: "7px 14px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(16,185,129,0.35)"
          }}
        >
          ➕ Add Requirement
        </button>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "#94a3b8", padding: 12 }}>
          Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div
          style={{
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            padding: 18,
            textAlign: "center",
            color: "#64748b",
            fontSize: 13,
            marginBottom: 18
          }}
        >
          No requirements yet. Click <b>Add Requirement</b> to capture
          what machines this customer wants.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 18 }}>

          {rows.map((r) => {

            const statusTheme = REQ_STATUS_THEME[r.STATUS] || REQ_STATUS_THEME.DRAFT;

            const prioTheme = REQ_PRIORITY_THEME[r.PRIORITY] || REQ_PRIORITY_THEME.MEDIUM;

            return (

              <div
                key={r.ID}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "12px 14px",
                  background: "#fafafa"
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "flex-start",
                    gap: 12
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>

                    <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4, flexWrap: "wrap" }}>
                      <span style={{ fontWeight: 700, fontSize: 14, color: "#0f172a" }}>
                        {r.MACHINE_NAME || r.MACHINE_CATEGORY || "Unnamed requirement"}
                      </span>
                      <span
                        style={{
                          background: statusTheme.bg,
                          color: statusTheme.fg,
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 0.6
                        }}
                      >
                        {r.STATUS}
                      </span>
                      <span
                        style={{
                          background: prioTheme.bg,
                          color: prioTheme.fg,
                          padding: "2px 8px",
                          borderRadius: 6,
                          fontSize: 10,
                          fontWeight: 700,
                          letterSpacing: 0.6
                        }}
                      >
                        {r.PRIORITY}
                      </span>
                    </div>

                    <div style={{ fontSize: 12, color: "#475569", display: "flex", gap: 14, flexWrap: "wrap" }}>
                      {r.MACHINE_CATEGORY && (
                        <span>📦 {r.MACHINE_CATEGORY}</span>
                      )}
                      <span>🔢 Qty: <b>{r.QUANTITY || 1}</b></span>
                      {r.CAPACITY && (
                        <span>📏 {r.CAPACITY}</span>
                      )}
                      {r.TARGET_UNIT_PRICE && (
                        <span>💰 ₹{Number(r.TARGET_UNIT_PRICE).toLocaleString("en-IN")}/unit</span>
                      )}
                      {r.TARGET_DELIVERY_DATE && (
                        <span>📅 by {r.TARGET_DELIVERY_DATE}</span>
                      )}
                    </div>

                    {r.INSTALLATION_SITE && (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
                        📍 {r.INSTALLATION_SITE}
                      </div>
                    )}

                    {r.SPECIAL_NOTES && (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 6, fontStyle: "italic" }}>
                        “{r.SPECIAL_NOTES}”
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6 }}>
                    {r.STATUS !== "ORDERED" && r.PRODUCT_MODEL_ID && (
                      <button
                        type="button"
                        onClick={async () => {

                          if (!window.confirm(
                            "🚀 Convert this requirement into a Project?\n\n" +
                            "This will create a project, seed product stages,\n" +
                            "auto-assign tasks to skilled employees, and\n" +
                            "mark this requirement as ORDERED."
                          )) return;

                          try {

                            const res = await API.post(
                              `/customers/${customerId}/requirements/${r.ID}/to-project`
                            );

                            alert("✅ " + (res.data?.message || "Project created"));

                            load();

                          } catch (err) {

                            alert(err?.response?.data?.detail || "Failed to convert");
                          }
                        }}
                        title="Convert to Project"
                        style={{
                          border: "1px solid #c7d2fe",
                          background: "#eef2ff",
                          color: "#4338ca",
                          padding: "5px 10px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 11,
                          fontWeight: 700
                        }}
                      >
                        🚀 Project
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      title="Edit"
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "white",
                        padding: "5px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 11
                      }}
                    >
                      ✏️
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r.ID)}
                      title="Delete"
                      style={{
                        border: "1px solid #fecaca",
                        background: "#fef2f2",
                        color: "#b91c1c",
                        padding: "5px 10px",
                        borderRadius: 6,
                        cursor: "pointer",
                        fontSize: 11
                      }}
                    >
                      🗑
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}


function RequirementForm({ customerId, initial, products, onCancel, onSaved }) {

  const isEdit = !!initial?.ID;

  const [data, setData] = useState({
    MACHINE_CATEGORY: initial?.MACHINE_CATEGORY || "",
    MACHINE_NAME: initial?.MACHINE_NAME || "",
    PRODUCT_MODEL_ID: initial?.PRODUCT_MODEL_ID || "",
    QUANTITY: initial?.QUANTITY || 1,
    CAPACITY: initial?.CAPACITY || "",
    TARGET_UNIT_PRICE: initial?.TARGET_UNIT_PRICE || "",
    TARGET_DELIVERY_DATE: initial?.TARGET_DELIVERY_DATE || "",
    INSTALLATION_SITE: initial?.INSTALLATION_SITE || "",
    PRIORITY: initial?.PRIORITY || "MEDIUM",
    STATUS: initial?.STATUS || "DRAFT",
    SPECIAL_NOTES: initial?.SPECIAL_NOTES || ""
  });

  const [saving, setSaving] = useState(false);

  const set = (k) => (e) =>
    setData((d) => ({ ...d, [k]: e.target.value }));

  const save = async () => {

    if (!data.MACHINE_NAME && !data.MACHINE_CATEGORY) {

      alert("Please pick a category or enter a machine name.");

      return;
    }

    setSaving(true);

    try {

      // Coerce empty strings → null for optional numeric/date fields
      const payload = {
        ...data,
        PRODUCT_MODEL_ID: data.PRODUCT_MODEL_ID || null,
        TARGET_UNIT_PRICE: data.TARGET_UNIT_PRICE === ""
          ? null
          : Number(data.TARGET_UNIT_PRICE),
        TARGET_DELIVERY_DATE: data.TARGET_DELIVERY_DATE || null,
        QUANTITY: Number(data.QUANTITY) || 1
      };

      if (isEdit) {

        await API.patch(
          `/customers/${customerId}/requirements/${initial.ID}`,
          payload
        );

      } else {

        await API.post(
          `/customers/${customerId}/requirements`,
          payload
        );
      }

      onSaved?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to save");

    } finally {

      setSaving(false);
    }
  };

  return (

    <div
      style={{
        border: "1px solid #10b981",
        borderRadius: 12,
        background: "linear-gradient(180deg,#f0fdf4,#ffffff)",
        padding: 16,
        marginBottom: 18
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 800, color: "#047857", marginBottom: 12, letterSpacing: 0.8 }}>
        {isEdit ? "✏️ EDIT REQUIREMENT" : "➕ NEW REQUIREMENT"}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: 12
        }}
      >
        <FormField label="Machine Category">
          <select
            value={data.MACHINE_CATEGORY}
            onChange={set("MACHINE_CATEGORY")}
            style={inputStyle()}
          >
            <option value="">— pick category —</option>
            {MACHINE_CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </FormField>

        <FormField label="Machine Name / Model">
          <input
            type="text"
            value={data.MACHINE_NAME}
            onChange={set("MACHINE_NAME")}
            style={inputStyle()}
            placeholder="e.g. C 608 R1 Coffee Pro"
          />
        </FormField>

        <FormField label="Link to existing Product (optional)" span={2}>
          <select
            value={data.PRODUCT_MODEL_ID}
            onChange={set("PRODUCT_MODEL_ID")}
            style={inputStyle()}
          >
            <option value="">— none —</option>
            {products.map((p) => (
              <option key={p.ID} value={p.ID}>
                {p.MODEL_NAME} ({p.MODEL_CODE})
              </option>
            ))}
          </select>
        </FormField>

        <FormField label="Quantity">
          <input
            type="number"
            min="1"
            value={data.QUANTITY}
            onChange={set("QUANTITY")}
            style={inputStyle()}
          />
        </FormField>

        <FormField label="Capacity">
          <input
            type="text"
            value={data.CAPACITY}
            onChange={set("CAPACITY")}
            style={inputStyle()}
            placeholder="10 selections / 200 cups / ..."
          />
        </FormField>

        <FormField label="Target Unit Price (₹)">
          <input
            type="number"
            min="0"
            step="0.01"
            value={data.TARGET_UNIT_PRICE}
            onChange={set("TARGET_UNIT_PRICE")}
            style={inputStyle()}
            placeholder="e.g. 85000"
          />
        </FormField>

        <FormField label="Target Delivery Date">
          <input
            type="date"
            value={data.TARGET_DELIVERY_DATE}
            onChange={set("TARGET_DELIVERY_DATE")}
            style={inputStyle()}
          />
        </FormField>

        <FormField label="Installation Site" span={2}>
          <input
            type="text"
            value={data.INSTALLATION_SITE}
            onChange={set("INSTALLATION_SITE")}
            style={inputStyle()}
            placeholder="Branch name + address (where it ships)"
          />
        </FormField>

        <FormField label="Priority">
          <select value={data.PRIORITY} onChange={set("PRIORITY")} style={inputStyle()}>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </FormField>

        <FormField label="Status">
          <select value={data.STATUS} onChange={set("STATUS")} style={inputStyle()}>
            <option value="DRAFT">Draft</option>
            <option value="CONFIRMED">Confirmed</option>
            <option value="QUOTED">Quoted</option>
            <option value="ORDERED">Ordered</option>
            <option value="CANCELLED">Cancelled</option>
          </select>
        </FormField>

        <FormField label="Special Notes / Custom Features" span={2}>
          <textarea
            value={data.SPECIAL_NOTES}
            onChange={set("SPECIAL_NOTES")}
            rows={2}
            style={{ ...inputStyle(), resize: "vertical" }}
            placeholder="Touchscreen, cashless, IoT, custom branding, refrigeration..."
          />
        </FormField>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button
          type="button"
          onClick={onCancel}
          style={{
            border: "1px solid #e2e8f0",
            background: "white",
            padding: "8px 16px",
            borderRadius: 8,
            cursor: "pointer",
            fontSize: 12
          }}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          style={{
            border: "none",
            background: saving
              ? "#94a3b8"
              : "linear-gradient(135deg,#10b981,#059669)",
            color: "white",
            padding: "8px 20px",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            cursor: saving ? "not-allowed" : "pointer"
          }}
        >
          {saving ? "Saving…" : isEdit ? "💾 Update" : "💾 Save"}
        </button>
      </div>
    </div>
  );
}


// =================================================================
// Phase 3 cross-link — quotations belonging to this customer
// =================================================================

const QUOT_STATUS_THEME = {
  DRAFT: { bg: "#f1f5f9", fg: "#475569" },
  SENT: { bg: "#dbeafe", fg: "#1d4ed8" },
  APPROVED: { bg: "#dcfce7", fg: "#166534" },
  REJECTED: { bg: "#fee2e2", fg: "#991b1b" },
  CONVERTED: { bg: "#e0e7ff", fg: "#4338ca" },
  EXPIRED: { bg: "#fef3c7", fg: "#854d0e" }
};


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


function CustomerQuotationsSection({ customerId, onJumpToQuotations }) {

  const [quotations, setQuotations] = useState([]);

  const [loading, setLoading] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);

  const [requirements, setRequirements] = useState([]);

  const [picked, setPicked] = useState(new Set());

  const [creating, setCreating] = useState(false);

  const [margin, setMargin] = useState(25);

  const loadQuotations = () => {

    setLoading(true);

    API.get(`/quotations?customer_id=${customerId}`)
      .then((r) => setQuotations(r.data || []))
      .catch(() => setQuotations([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    if (customerId) loadQuotations();

  }, [customerId]);

  const openPicker = () => {

    // Pull this customer's requirements so the user can choose which
    // ones to include in the new quotation.
    API.get(`/customers/${customerId}/requirements`)
      .then((r) => {

        // Filter out already-finalized rows — only DRAFT/CONFIRMED are quotable
        const quotable = (r.data || []).filter(
          (x) => x.STATUS === "DRAFT" || x.STATUS === "CONFIRMED"
        );

        setRequirements(quotable);

        setPicked(new Set());

        setPickerOpen(true);
      })
      .catch(() => alert("Couldn't load requirements"));
  };

  const togglePick = (id) =>
    setPicked((prev) => {

      const next = new Set(prev);

      if (next.has(id)) next.delete(id); else next.add(id);

      return next;
    });

  const createFromRequirements = async () => {

    if (picked.size === 0) {

      alert("Pick at least one requirement");

      return;
    }

    setCreating(true);

    try {

      const res = await API.post("/quotations/from-requirements", {
        CUSTOMER_ID: customerId,
        REQUIREMENT_IDS: Array.from(picked),
        MARGIN_PERCENT: Number(margin) || 25,
        VENDOR_ID: 1
      });

      alert(res?.data?.message || "Quotation created");

      setPickerOpen(false);

      loadQuotations();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to create quotation");

    } finally {

      setCreating(false);
    }
  };

  return (

    <div>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 12
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#6366f1", textTransform: "uppercase" }}>
          📄 Quotations ({quotations.length})
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button
            type="button"
            onClick={openPicker}
            style={{
              border: "none",
              background: "linear-gradient(135deg,#06b6d4,#C8102E,#8B0B1F)",
              color: "white",
              padding: "7px 14px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer",
              boxShadow: "0 4px 12px rgba(99,102,241,0.35)"
            }}
          >
            ✨ Create from Requirements
          </button>

          <button
            type="button"
            onClick={onJumpToQuotations}
            title="Go to Quotations page"
            style={{
              border: "1px solid #cbd5e1",
              background: "white",
              padding: "7px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 12
            }}
          >
            ↗ Open Quotations
          </button>
        </div>
      </div>

      {loading && (
        <div style={{ fontSize: 12, color: "#94a3b8", padding: 12 }}>
          Loading…
        </div>
      )}

      {!loading && quotations.length === 0 && (
        <div
          style={{
            border: "1px dashed #cbd5e1",
            borderRadius: 10,
            padding: 16,
            textAlign: "center",
            color: "#64748b",
            fontSize: 13
          }}
        >
          No quotations yet for this customer. Pick from confirmed
          requirements or use the Quotations page to create one manually.
        </div>
      )}

      {!loading && quotations.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

          {quotations.map((q) => {

            const theme = QUOT_STATUS_THEME[q.STATUS] || QUOT_STATUS_THEME.DRAFT;

            return (
              <div
                key={q.ID}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: "white",
                  display: "grid",
                  gridTemplateColumns: "150px 1fr 110px 100px 130px",
                  gap: 12,
                  alignItems: "center"
                }}
              >
                <div>
                  <div style={{ fontSize: 12, fontWeight: 800, color: "#0f172a" }}>
                    {q.QUOTATION_NUMBER}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {q.QUOTATION_DATE}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Expires</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{q.EXPIRY_DATE || "—"}</div>
                </div>
                <div>
                  <span
                    style={{
                      background: theme.bg,
                      color: theme.fg,
                      padding: "3px 10px",
                      borderRadius: 999,
                      fontSize: 10,
                      fontWeight: 800,
                      letterSpacing: 0.6
                    }}
                  >
                    {q.STATUS}
                  </span>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Total</div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#047857" }}>{inr(q.GRAND_TOTAL)}</div>
                </div>
                <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={() => window.open(`/quotation-print/${q.ID}`, "_blank")}
                    title="View / Print"
                    style={{
                      border: "1px solid #cbd5e1",
                      background: "white",
                      padding: "5px 10px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 11
                    }}
                  >
                    🖨️
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pickerOpen && (
        <RequirementPickerModal
          requirements={requirements}
          picked={picked}
          togglePick={togglePick}
          margin={margin}
          setMargin={setMargin}
          creating={creating}
          onCancel={() => setPickerOpen(false)}
          onSubmit={createFromRequirements}
        />
      )}

    </div>
  );
}


function RequirementPickerModal({
  requirements, picked, togglePick, margin, setMargin,
  creating, onCancel, onSubmit
}) {

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        zIndex: 1100,
        display: "flex",
        justifyContent: "center",
        alignItems: "center"
      }}
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 640,
          maxWidth: "94%",
          background: "white",
          borderRadius: 12,
          padding: 22,
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 12 }}>
          ✨ Create Quotation from Requirements
        </div>

        {requirements.length === 0 && (
          <div style={{ padding: 16, background: "#fef3c7", borderRadius: 8, color: "#854d0e", fontSize: 13, marginBottom: 12 }}>
            ⚠️ No quotable requirements found. Only DRAFT or CONFIRMED
            requirements can be used. Already-QUOTED requirements
            won't appear here.
          </div>
        )}

        {requirements.length > 0 && (
          <>
            <div style={{ fontSize: 12, color: "#64748b", marginBottom: 10 }}>
              Pick which requirements to include as line items:
            </div>

            <div style={{
              border: "1px solid #e2e8f0",
              borderRadius: 10,
              maxHeight: 280,
              overflow: "auto",
              marginBottom: 14
            }}>
              {requirements.map((r) => (
                <label
                  key={r.ID}
                  style={{
                    display: "flex",
                    gap: 10,
                    padding: "10px 14px",
                    borderBottom: "1px solid #f1f5f9",
                    cursor: "pointer",
                    background: picked.has(r.ID) ? "#f0fdf4" : "white"
                  }}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.ID)}
                    onChange={() => togglePick(r.ID)}
                    style={{ width: 18, height: 18, marginTop: 2 }}
                  />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 13, color: "#0f172a" }}>
                      {r.MACHINE_NAME || r.MACHINE_CATEGORY || `Requirement #${r.ID}`}
                    </div>
                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                      Qty: {r.QUANTITY || 1}
                      {r.TARGET_UNIT_PRICE ? ` · Target ₹${r.TARGET_UNIT_PRICE}/unit` : " · BOM-priced"}
                      {r.CAPACITY ? ` · ${r.CAPACITY}` : ""}
                    </div>
                  </div>
                  <span style={{
                    fontSize: 9,
                    fontWeight: 700,
                    color: "#64748b",
                    background: "#f1f5f9",
                    padding: "2px 8px",
                    borderRadius: 999,
                    height: "fit-content"
                  }}>
                    {r.STATUS}
                  </span>
                </label>
              ))}
            </div>

            <div style={{ marginBottom: 14, display: "flex", gap: 10, alignItems: "center" }}>
              <label style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>
                Margin % (used when no target price set):
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                style={{
                  width: 100,
                  padding: "7px 10px",
                  border: "1px solid #cbd5e1",
                  borderRadius: 8,
                  fontSize: 13
                }}
              />
            </div>
          </>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={onCancel}
            style={{
              border: "1px solid #e2e8f0",
              background: "white",
              padding: "9px 18px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 13
            }}
          >
            Cancel
          </button>

          {requirements.length > 0 && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={creating || picked.size === 0}
              style={{
                border: "none",
                background: creating || picked.size === 0
                  ? "#94a3b8"
                  : "linear-gradient(135deg,#06b6d4,#C8102E,#8B0B1F)",
                color: "white",
                padding: "9px 22px",
                borderRadius: 8,
                fontWeight: 800,
                fontSize: 13,
                cursor: (creating || picked.size === 0) ? "not-allowed" : "pointer",
                boxShadow: "0 6px 18px rgba(14,165,233,0.45)"
              }}
            >
              {creating ? "Creating…" : `✨ Create from ${picked.size} requirement(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}


function CustomerEditor({ initial, onClose, onSaved }) {

  const isEdit = !!initial?.ID;

  const navigate = useNavigate();

  const [form, setForm] = useState({
    CUSTOMER_NAME: initial?.CUSTOMER_NAME || "",
    CUSTOMER_TYPE: initial?.CUSTOMER_TYPE || "PRIVATE_LTD",
    CONTACT_PERSON: initial?.CONTACT_PERSON || "",
    DESIGNATION: initial?.DESIGNATION || "",
    PHONE: initial?.PHONE || "",
    ALTERNATE_PHONE: initial?.ALTERNATE_PHONE || "",
    WHATSAPP_NUMBER: initial?.WHATSAPP_NUMBER || "",
    EMAIL: initial?.EMAIL || "",
    WEBSITE: initial?.WEBSITE || "",
    ADDRESS: initial?.ADDRESS || "",
    BILLING_ADDRESS: initial?.BILLING_ADDRESS || "",
    SHIPPING_ADDRESS: initial?.SHIPPING_ADDRESS || "",
    GOOGLE_MAP_LOCATION: initial?.GOOGLE_MAP_LOCATION || "",
    CITY: initial?.CITY || "",
    STATE: initial?.STATE || "Tamil Nadu",
    PINCODE: initial?.PINCODE || "",
    COUNTRY: initial?.COUNTRY || "India",
    GST_NUMBER: initial?.GST_NUMBER || "",
    PAN_NUMBER: initial?.PAN_NUMBER || "",
    INDUSTRY: initial?.INDUSTRY || "",
    SOURCE: initial?.SOURCE || "",
    STATUS: initial?.STATUS || "ACTIVE",
    NOTES: initial?.NOTES || "",
    // Business profile
    BUSINESS_TYPE: initial?.BUSINESS_TYPE || "",
    NUMBER_OF_BRANCHES: initial?.NUMBER_OF_BRANCHES || "",
    EXPECTED_MONTHLY_ORDERS: initial?.EXPECTED_MONTHLY_ORDERS || "",
    EXISTING_MACHINE_USAGE: initial?.EXISTING_MACHINE_USAGE ? 1 : 0,
    CURRENT_VENDOR_NAME: initial?.CURRENT_VENDOR_NAME || "",
    // Lead pipeline
    LEAD_SOURCE: initial?.LEAD_SOURCE || "WEBSITE",
    LEAD_STATUS: initial?.LEAD_STATUS || "NEW",
    LEAD_PRIORITY: initial?.LEAD_PRIORITY || "MEDIUM",
    ASSIGNED_SALES_ID: initial?.ASSIGNED_SALES_ID || "",
    FOLLOW_UP_DATE: initial?.FOLLOW_UP_DATE || "",
    REQUIREMENT_NOTES: initial?.REQUIREMENT_NOTES || "",
    REQUESTED_MACHINE_NAME: "",
    REQUESTED_MACHINE_CATEGORY: "vending",
    REQUESTED_QUANTITY: 1
  });

  // Sales people for the "Assigned Sales" dropdown
  const [salesPeople, setSalesPeople] = useState([]);

  useEffect(() => {

    API.get("/employees?status=ACTIVE")
      .then((r) => {

        // Sales reps prefer the SALES role or "Sales" department —
        // but show everyone in case roles aren't seeded.
        setSalesPeople(r.data || []);
      })
      .catch(() => setSalesPeople([]));

  }, []);

  const [saving, setSaving] = useState(false);

  // Existing product catalogue — used to populate the datalist
  // for the "Which vending machine?" field. Lets the user either
  // pick an existing model (no duplicate created) or type a new
  // one (auto-created on submit).
  const [existingProducts, setExistingProducts] = useState([]);

  useEffect(() => {

    if (isEdit) return;

    API.get("/production/models?vendor_id=1")
      .then((r) => setExistingProducts(r.data || []))
      .catch(() => setExistingProducts([]));

  }, [isEdit]);

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {

    e?.preventDefault?.();

    if (!form.CUSTOMER_NAME.trim()) {

      alert("Customer / Company name is required");

      return;
    }

    if (!form.PHONE.trim() || !form.EMAIL.trim()) {

      alert("Phone and Email are required");

      return;
    }

    setSaving(true);

    try {

      if (isEdit) {

        await API.patch(`/customers/${initial.ID}`, form);

      } else {

        const res = await API.post("/create-customer", {
          ...form,
          ADDRESS: form.ADDRESS || form.CITY || "",
          VENDOR_ID: 1
        });

        // If the backend auto-created (or linked) a vending
        // machine in Products & BOM, surface it so the user knows
        // it's now available in the Work Order dropdown.
        const prod = res?.data?.requested_product;

        if (prod) {

          const verb = prod.was_existing
            ? "linked to existing"
            : `auto-created with ${prod.stages_seeded || 0} stages + ${prod.bom_seeded || 0} BOM lines`;

          alert(
            `Customer saved.\n\n` +
            `🏭 ${prod.model_name} (${prod.model_code}) ${verb} in Products & BOM.\n` +
            `It's now available in the Work Order "Pick a model" dropdown.`
          );
        }
      }

      onSaved?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to save");

    } finally {

      setSaving(false);
    }
  };

  return (

    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "flex-end"
      }}
      onClick={onClose}
    >

      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 720,
          maxWidth: "94%",
          background: "white",
          overflow: "auto",
          padding: 26,
          boxShadow: "-24px 0 60px rgba(0,0,0,0.35)"
        }}
      >

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            marginBottom: 18,
            paddingBottom: 14,
            borderBottom: "1px solid #e2e8f0"
          }}
        >
          <div>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.4,
                color: "#06b6d4",
                textTransform: "uppercase"
              }}
            >
              {isEdit ? "Edit Customer" : "New Customer"}
            </div>
            <div
              style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#0f172a",
                marginTop: 2
              }}
            >
              {form.CUSTOMER_NAME || "Add a customer who wants a vending machine"}
            </div>
            <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>
              All details land in their 360° view and connect to Production & BOM.
            </div>
          </div>

          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "#f1f5f9",
              padding: "4px 12px",
              borderRadius: 8,
              cursor: "pointer",
              fontSize: 20
            }}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit}>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#06b6d4", textTransform: "uppercase", marginBottom: 10 }}>
            Identity
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >

            <FormField label="Company / Customer Name *">
              <input
                type="text"
                value={form.CUSTOMER_NAME}
                onChange={set("CUSTOMER_NAME")}
                style={inputStyle()}
                placeholder="Chennai Metro Rail Ltd"
              />
            </FormField>

            <FormField label="Customer Type">
              <select
                value={form.CUSTOMER_TYPE}
                onChange={set("CUSTOMER_TYPE")}
                style={inputStyle()}
              >
                <optgroup label="Personal & Distribution">
                  <option value="INDIVIDUAL">Individual</option>
                  <option value="DEALER">Dealer</option>
                  <option value="DISTRIBUTOR">Distributor</option>
                </optgroup>
                <optgroup label="Company Structures (India)">
                  <option value="OPC">One Person Company (OPC)</option>
                  <option value="PRIVATE_LTD">Private Limited Company</option>
                  <option value="PUBLIC_LTD">Public Limited Company</option>
                  <option value="GUARANTEE">Guarantee Company</option>
                  <option value="SUBSIDIARY">Subsidiary Company</option>
                  <option value="STATUTORY">Statutory Company</option>
                  <option value="INSURANCE">Insurance Company</option>
                  <option value="UNLIMITED">Unlimited Company</option>
                </optgroup>
              </select>
            </FormField>

            <FormField label="Industry">
              <select
                value={form.INDUSTRY}
                onChange={set("INDUSTRY")}
                style={inputStyle()}
              >
                <option value="">— pick industry —</option>
                {INDUSTRIES.map((i) => (
                  <option key={i}>{i}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Contact Person">
              <input
                type="text"
                value={form.CONTACT_PERSON}
                onChange={set("CONTACT_PERSON")}
                style={inputStyle()}
                placeholder="Suresh Iyer"
              />
            </FormField>

            <FormField label="Designation">
              <input
                type="text"
                value={form.DESIGNATION}
                onChange={set("DESIGNATION")}
                style={inputStyle()}
                placeholder="Purchase Manager"
              />
            </FormField>
          </div>

          {/* ============================================== */}
          {/*  🎯 LEAD MANAGEMENT (Phase 1)                  */}
          {/* ============================================== */}
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: 1.4,
            color: "#ec4899",
            textTransform: "uppercase",
            marginBottom: 10,
            display: "flex",
            alignItems: "center",
            gap: 8
          }}>
            🎯 Lead Pipeline
            <span style={{
              background: "#fce7f3",
              color: "#9d174d",
              padding: "2px 8px",
              borderRadius: 999,
              fontSize: 9,
              letterSpacing: 0.5
            }}>
              SALES OWNERSHIP
            </span>
          </div>

          <div style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 12,
            marginBottom: 14,
            padding: 14,
            background: "linear-gradient(135deg, #fdf2f8, #fce7f3)",
            border: "1px solid #fbcfe8",
            borderRadius: 10
          }}>

            <FormField label="Lead Source">
              <select
                value={form.LEAD_SOURCE}
                onChange={set("LEAD_SOURCE")}
                style={inputStyle()}
              >
                <option value="WEBSITE">Website</option>
                <option value="COLD_CALL">Cold Call</option>
                <option value="REFERENCE">Reference</option>
                <option value="WALK_IN">Walk-in</option>
                <option value="EMAIL">Email</option>
                <option value="TRADE_FAIR">Trade Fair</option>
                <option value="SOCIAL_MEDIA">Social Media</option>
                <option value="OTHER">Other</option>
              </select>
            </FormField>

            <FormField label="Lead Status">
              <select
                value={form.LEAD_STATUS}
                onChange={set("LEAD_STATUS")}
                style={inputStyle()}
              >
                <option value="NEW">🆕 New</option>
                <option value="CONTACTED">📞 Contacted</option>
                <option value="QUALIFIED">✓ Qualified</option>
                <option value="QUOTED">📄 Quoted</option>
                <option value="NEGOTIATING">💬 Negotiating</option>
                <option value="WON">🏆 Won</option>
                <option value="LOST">❌ Lost</option>
              </select>
            </FormField>

            <FormField label="Lead Priority">
              <select
                value={form.LEAD_PRIORITY}
                onChange={set("LEAD_PRIORITY")}
                style={inputStyle()}
              >
                <option value="HIGH">🔥 High</option>
                <option value="MEDIUM">⚡ Medium</option>
                <option value="LOW">🌱 Low</option>
              </select>
            </FormField>

            <FormField label="Assigned Salesperson">
              <select
                value={form.ASSIGNED_SALES_ID}
                onChange={set("ASSIGNED_SALES_ID")}
                style={inputStyle()}
              >
                <option value="">— pick salesperson —</option>
                {salesPeople.map((e) => (
                  <option key={e.ID} value={e.ID}>
                    {e.NAME} ({e.EMPLOYEE_CODE})
                  </option>
                ))}
              </select>
            </FormField>

            <FormField label="Follow-up Date">
              <input
                type="date"
                value={form.FOLLOW_UP_DATE}
                onChange={set("FOLLOW_UP_DATE")}
                style={inputStyle()}
              />
            </FormField>

            <FormField label="Requirement Notes" span={3}>
              <textarea
                rows={3}
                value={form.REQUIREMENT_NOTES}
                onChange={set("REQUIREMENT_NOTES")}
                placeholder={"What the customer asked for during enquiry —\nspecs, qty, delivery timeline, special features..."}
                style={inputStyle()}
              />
            </FormField>
          </div>

          {!isEdit && (

            <>

              <div style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 1.4,
                color: "#f59e0b",
                textTransform: "uppercase",
                marginBottom: 10,
                display: "flex",
                alignItems: "center",
                gap: 8
              }}>
                🏭 Vending Machine Requested
                <span style={{
                  background: "#fef3c7",
                  color: "#92400e",
                  padding: "2px 8px",
                  borderRadius: 999,
                  fontSize: 9,
                  letterSpacing: 0.5
                }}>
                  AUTO-CREATES IN PRODUCTS & BOM
                </span>
              </div>

              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "2fr 1fr 1fr",
                  gap: 12,
                  marginBottom: 18,
                  padding: 14,
                  background: "linear-gradient(135deg, #fffbeb, #fef3c7)",
                  border: "1px solid #fde68a",
                  borderRadius: 10
                }}
              >

                <FormField label="Which vending machine they want?">
                  <input
                    type="text"
                    list="existing-products-dl"
                    value={form.REQUESTED_MACHINE_NAME}
                    onChange={set("REQUESTED_MACHINE_NAME")}
                    style={inputStyle()}
                    placeholder="e.g. Snack & Beverage Combo Machine"
                  />
                  <datalist id="existing-products-dl">
                    {existingProducts.map((p) => (
                      <option key={p.ID} value={p.MODEL_NAME}>
                        {p.MODEL_CODE} · {p.CATEGORY}
                      </option>
                    ))}
                  </datalist>
                </FormField>

                <FormField label="Category">
                  <select
                    value={form.REQUESTED_MACHINE_CATEGORY}
                    onChange={set("REQUESTED_MACHINE_CATEGORY")}
                    style={inputStyle()}
                  >
                    <option value="vending">vending</option>
                    <option value="snack-beverage">snack-beverage</option>
                    <option value="medicine">medicine</option>
                    <option value="hot-food">hot-food</option>
                    <option value="cosmetics">cosmetics</option>
                    <option value="grocery">grocery</option>
                  </select>
                </FormField>

                <FormField label="Quantity">
                  <input
                    type="number"
                    min="1"
                    value={form.REQUESTED_QUANTITY}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        REQUESTED_QUANTITY: Math.max(
                          1, Number(e.target.value) || 1
                        )
                      }))
                    }
                    style={inputStyle()}
                  />
                </FormField>

                <div style={{
                  gridColumn: "1 / -1",
                  fontSize: 11,
                  color: "#78350f",
                  marginTop: -4
                }}>
                  💡 If the machine doesn't exist in Products & BOM,
                  it'll be auto-created with the default 10-stage
                  manufacturing flow + 62-line BOM template. Already
                  exists? It's linked, no duplicate.
                </div>

              </div>

            </>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#3b82f6", textTransform: "uppercase", marginBottom: 10 }}>
            Reach
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >
            <FormField label="Phone *">
              <input type="text" value={form.PHONE} onChange={set("PHONE")} style={inputStyle()} placeholder="+91 98765 43210" />
            </FormField>
            <FormField label="Alternate Phone">
              <input type="text" value={form.ALTERNATE_PHONE} onChange={set("ALTERNATE_PHONE")} style={inputStyle()} />
            </FormField>
            <FormField label="Email *">
              <input type="email" value={form.EMAIL} onChange={set("EMAIL")} style={inputStyle()} placeholder="contact@example.com" />
            </FormField>
            <FormField label="WhatsApp Number">
              <input type="text" value={form.WHATSAPP_NUMBER} onChange={set("WHATSAPP_NUMBER")} style={inputStyle()} placeholder="+91 98765 43210" />
            </FormField>
            <FormField label="Website" span={2}>
              <input type="text" value={form.WEBSITE} onChange={set("WEBSITE")} style={inputStyle()} placeholder="https://www.example.com" />
            </FormField>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#10b981", textTransform: "uppercase", marginBottom: 10 }}>
            Address
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(4, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >
            <FormField label="Address (Street)" span={4}>
              <input type="text" value={form.ADDRESS} onChange={set("ADDRESS")} style={inputStyle()} placeholder="Plot 12, Industrial Estate" />
            </FormField>
            <FormField label="City">
              <input type="text" value={form.CITY} onChange={set("CITY")} style={inputStyle()} placeholder="Chennai" />
            </FormField>
            <FormField label="State">
              <input type="text" value={form.STATE} onChange={set("STATE")} style={inputStyle()} />
            </FormField>
            <FormField label="Pincode">
              <input type="text" value={form.PINCODE} onChange={set("PINCODE")} style={inputStyle()} placeholder="600001" />
            </FormField>
            <FormField label="Country">
              <input type="text" value={form.COUNTRY} onChange={set("COUNTRY")} style={inputStyle()} />
            </FormField>
            <FormField label="Billing Address (if different)" span={4}>
              <textarea
                rows={2}
                value={form.BILLING_ADDRESS}
                onChange={set("BILLING_ADDRESS")}
                style={inputStyle()}
                placeholder="Leave blank if same as the street address above"
              />
            </FormField>
            <FormField label="Shipping Address (if different)" span={4}>
              <textarea
                rows={2}
                value={form.SHIPPING_ADDRESS}
                onChange={set("SHIPPING_ADDRESS")}
                style={inputStyle()}
                placeholder="Where the machine actually gets installed"
              />
            </FormField>
            <FormField label="Google Maps Location URL" span={4}>
              <input
                type="text"
                value={form.GOOGLE_MAP_LOCATION}
                onChange={set("GOOGLE_MAP_LOCATION")}
                style={inputStyle()}
                placeholder="https://maps.app.goo.gl/..."
              />
            </FormField>
          </div>

          {/* ============================================== */}
          {/*  🏢 BUSINESS PROFILE                           */}
          {/* ============================================== */}
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#0ea5e9", textTransform: "uppercase", marginBottom: 10 }}>
            🏢 Business Profile
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >
            <FormField label="Business Type">
              <input
                type="text"
                value={form.BUSINESS_TYPE}
                onChange={set("BUSINESS_TYPE")}
                style={inputStyle()}
                placeholder="B2B Retail Chain / Hospital Network / ..."
              />
            </FormField>
            <FormField label="Current Vendor (if any)">
              <input
                type="text"
                value={form.CURRENT_VENDOR_NAME}
                onChange={set("CURRENT_VENDOR_NAME")}
                style={inputStyle()}
                placeholder="Their existing supplier name"
              />
            </FormField>
            <FormField label="Number of Branches">
              <input
                type="number"
                min="0"
                value={form.NUMBER_OF_BRANCHES}
                onChange={set("NUMBER_OF_BRANCHES")}
                style={inputStyle()}
                placeholder="e.g. 12"
              />
            </FormField>
            <FormField label="Expected Monthly Orders">
              <input
                type="number"
                min="0"
                value={form.EXPECTED_MONTHLY_ORDERS}
                onChange={set("EXPECTED_MONTHLY_ORDERS")}
                style={inputStyle()}
                placeholder="e.g. 3 units/month"
              />
            </FormField>
            <FormField label="Already using vending machines?" span={2}>
              <label style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13, color: "#475569", padding: "8px 0" }}>
                <input
                  type="checkbox"
                  checked={!!form.EXISTING_MACHINE_USAGE}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    EXISTING_MACHINE_USAGE: e.target.checked ? 1 : 0
                  }))}
                  style={{ width: 18, height: 18 }}
                />
                Yes — customer has previously deployed vending machines
              </label>
            </FormField>
          </div>

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#8b5cf6", textTransform: "uppercase", marginBottom: 10 }}>
            Tax / KYC
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >
            <FormField label="GST Number">
              <input type="text" value={form.GST_NUMBER} onChange={set("GST_NUMBER")} style={inputStyle()} placeholder="33ABCDE1234F1Z5" />
            </FormField>
            <FormField label="PAN Number">
              <input type="text" value={form.PAN_NUMBER} onChange={set("PAN_NUMBER")} style={inputStyle()} />
            </FormField>
          </div>

          {/* ============================================== */}
          {/*  📋 PHASE 2 — REQUIREMENTS (edit mode only)    */}
          {/* ============================================== */}
          {isEdit && (
            <div
              style={{
                background: "linear-gradient(135deg,#ecfdf5,#f0fdf4)",
                border: "1px solid #bbf7d0",
                borderRadius: 12,
                padding: 16,
                marginBottom: 18
              }}
            >
              <RequirementsManager customerId={initial.ID} />
            </div>
          )}

          {/* ============================================== */}
          {/*  📄 PHASE 3 — QUOTATIONS for this customer     */}
          {/* ============================================== */}
          {isEdit && (
            <div
              style={{
                background: "linear-gradient(135deg,#eef2ff,#f5f3ff)",
                border: "1px solid #c7d2fe",
                borderRadius: 12,
                padding: 16,
                marginBottom: 18
              }}
            >
              <CustomerQuotationsSection
                customerId={initial.ID}
                onJumpToQuotations={() => {
                  onClose?.();
                  navigate("/quotations");
                }}
              />
            </div>
          )}

          {!isEdit && (
            <div
              style={{
                background: "#fafafa",
                border: "1px dashed #cbd5e1",
                borderRadius: 10,
                padding: 12,
                marginBottom: 18,
                fontSize: 12,
                color: "#64748b"
              }}
            >
              💡 Save this customer first — once created, you can add a
              full list of vending-machine requirements with quantities,
              specs and target dates.
            </div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: 1.4, color: "#f59e0b", textTransform: "uppercase", marginBottom: 10 }}>
            Lifecycle
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(2, 1fr)",
              gap: 12,
              marginBottom: 18
            }}
          >
            <FormField label="Status">
              <select value={form.STATUS} onChange={set("STATUS")} style={inputStyle()}>
                <option value="ACTIVE">Active</option>
                <option value="PROSPECT">Prospect</option>
                <option value="LEAD">Lead</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </FormField>

            <FormField label="Source">
              <select value={form.SOURCE} onChange={set("SOURCE")} style={inputStyle()}>
                <option value="">— pick source —</option>
                {SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </FormField>

            <FormField label="Notes" span={2}>
              <textarea
                value={form.NOTES}
                onChange={set("NOTES")}
                rows={3}
                style={{ ...inputStyle(), resize: "vertical" }}
                placeholder="Anything we should remember about this customer..."
              />
            </FormField>
          </div>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>

            <button
              type="button"
              onClick={onClose}
              style={{
                border: "1px solid #e2e8f0",
                background: "white",
                padding: "10px 22px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13
              }}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              style={{
                border: "none",
                background: saving
                  ? "#94a3b8"
                  : "linear-gradient(135deg, #E63946, #C8102E, #8B0B1F)",
                color: "white",
                padding: "10px 26px",
                borderRadius: 8,
                fontWeight: 800,
                fontSize: 13,
                cursor: saving ? "not-allowed" : "pointer",
                boxShadow: "0 6px 18px rgba(14,165,233,0.45)"
              }}
            >
              {saving
                ? "Saving…"
                : isEdit
                  ? "💾 Save Changes"
                  : "✨ Create Customer"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}


// =================================================================
// Main page
// =================================================================

function Customers() {

  const [customers, setCustomers] = useState([]);

  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState("");

  const [statusFilter, setStatusFilter] = useState("");

  const [industryFilter, setIndustryFilter] = useState("");

  const [editing, setEditing] = useState(null);

  const [drawerId, setDrawerId] = useState(null);

  const [inviteOpen, setInviteOpen] = useState(false);

  const [generatingFor, setGeneratingFor] = useState(null);

  const fetchAll = async () => {

    setLoading(true);

    try {

      const res = await API.get("/customers");

      setCustomers(res.data || []);

    } finally {

      setLoading(false);
    }
  };

  useEffect(() => {

    fetchAll();

  }, []);

  const filtered = useMemo(() => {

    const q = search.trim().toLowerCase();

    return customers.filter((c) => {

      if (statusFilter && (c.STATUS || "ACTIVE") !== statusFilter) return false;

      if (industryFilter && c.INDUSTRY !== industryFilter) return false;

      if (q) {

        const hay = [
          c.CUSTOMER_NAME, c.CUSTOMER_CODE, c.CONTACT_PERSON,
          c.PHONE, c.EMAIL, c.CITY, c.STATE, c.GST_NUMBER,
          c.INDUSTRY, c.SOURCE
        ].filter(Boolean).join(" ").toLowerCase();

        if (!hay.includes(q)) return false;
      }

      return true;
    });

  }, [customers, search, statusFilter, industryFilter]);

  const stats = useMemo(() => {

    const total = customers.length;

    const active = customers.filter(
      (c) => (c.STATUS || "ACTIVE") === "ACTIVE"
    ).length;

    const prospects = customers.filter(
      (c) => c.STATUS === "PROSPECT" || c.STATUS === "LEAD"
    ).length;

    const withGst = customers.filter((c) => !!c.GST_NUMBER).length;

    return { total, active, prospects, withGst };

  }, [customers]);

  return (

    <div
      style={{
        padding: 26,
        background: "#f1f5f9",
        minHeight: "100%"
      }}
    >

      <style>{`
        @keyframes bvcCustFadeIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes bvcCustHeroShift {
          0%, 100% { background-position: 0% 50%; }
          50%      { background-position: 100% 50%; }
        }
        .bvc-cust-card:hover {
          transform: translateY(-3px);
          box-shadow: 0 18px 42px rgba(15,23,42,0.14);
        }
        .bvc-cust-card {
          transition: transform 0.2s ease, box-shadow 0.2s ease;
        }
      `}</style>

      {/* HERO */}
      <div
        style={{
          background:
            "linear-gradient(120deg, #1A0508 0%, #4A0E18 30%, #8B0B1F 70%, #C8102E 100%)",
          backgroundSize: "300% 300%",
          animation: "bvcCustHeroShift 18s ease-in-out infinite",
          color: "white",
          padding: "26px 28px",
          borderRadius: 18,
          marginBottom: 22,
          position: "relative",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(8,145,178,0.35)"
        }}
      >

        <div
          style={{
            position: "absolute",
            width: 240,
            height: 240,
            borderRadius: "50%",
            background: "rgba(255,255,255,0.08)",
            top: -100,
            right: -60,
            pointerEvents: "none"
          }}
        />

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-start",
            flexWrap: "wrap",
            gap: 20,
            position: "relative"
          }}
        >

          <div style={{ flex: 1, minWidth: 280 }}>

            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: 3,
                textTransform: "uppercase",
                opacity: 0.85,
                marginBottom: 6
              }}
            >
              BVC24 · Customer Command Center
            </div>

            <h1
              style={{
                fontSize: 28,
                fontWeight: 900,
                margin: 0,
                letterSpacing: -0.5,
                lineHeight: 1.15,
                color: "white"
              }}
            >
              Every customer. Every order. Every machine.
            </h1>

            <div
              style={{
                fontSize: 14,
                opacity: 0.9,
                marginTop: 6,
                maxWidth: 560
              }}
            >
              Click any customer card to see the projects + work orders +
              machine models + BOM details being built for them — all in
              one connected view.
            </div>
          </div>

          <div style={{ display: "flex", gap: 10 }}>

            <button
              onClick={() => setInviteOpen(true)}
              title="Generate a self-onboarding link for a new customer"
              style={{
                background: "rgba(255,255,255,0.15)",
                color: "white",
                border: "1px solid rgba(255,255,255,0.4)",
                padding: "12px 18px",
                borderRadius: 12,
                fontWeight: 700,
                fontSize: 13,
                cursor: "pointer",
                letterSpacing: 0.3
              }}
            >
              🤖 Invite (Self-Onboarding)
            </button>

            <button
              onClick={() => setEditing({})}
              style={{
                background: "white",
                color: "#0e7490",
                border: "none",
                padding: "12px 22px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 14,
                cursor: "pointer",
                boxShadow: "0 8px 22px rgba(0,0,0,0.18)",
                letterSpacing: 0.4
              }}
            >
              ➕ Add Customer
            </button>

          </div>
        </div>
      </div>

      {inviteOpen && (
        <InviteCustomerModal onClose={() => setInviteOpen(false)} />
      )}

      {/* Summary tiles */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 14,
          marginBottom: 20
        }}
      >
        <StatTile
          label="Total Customers"
          value={stats.total}
          color="#06b6d4"
          icon="🤝"
        />
        <StatTile
          label="Active"
          value={stats.active}
          sub="receiving orders"
          color="#10b981"
          icon="✓"
        />
        <StatTile
          label="Prospects + Leads"
          value={stats.prospects}
          sub="in the pipeline"
          color="#f59e0b"
          icon="🌱"
        />
        <StatTile
          label="With GST"
          value={stats.withGst}
          sub="invoice-ready"
          color="#8b5cf6"
          icon="🧾"
        />
      </div>

      {/* Search + filters */}
      <div
        style={{
          background: "white",
          padding: 14,
          borderRadius: 12,
          boxShadow: "0 4px 14px rgba(15,23,42,0.06)",
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
          alignItems: "center",
          marginBottom: 18
        }}
      >

        <input
          type="text"
          placeholder="🔍 Search by name, code, contact, phone, GST, city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            flex: 1,
            minWidth: 260,
            padding: "10px 14px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13
          }}
        />

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          style={{
            padding: "10px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13
          }}
        >
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{
            padding: "10px 12px",
            border: "1px solid #e2e8f0",
            borderRadius: 8,
            fontSize: 13
          }}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PROSPECT">Prospect</option>
          <option value="LEAD">Lead</option>
          <option value="INACTIVE">Inactive</option>
        </select>

        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            marginLeft: 6
          }}
        >
          {filtered.length} of {customers.length}
        </div>
      </div>

      {/* Cards */}
      {loading && (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading customers…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div
          style={{
            padding: 50,
            textAlign: "center",
            color: "#94a3b8",
            background: "white",
            borderRadius: 14,
            border: "1px dashed #cbd5e1"
          }}
        >
          {customers.length === 0
            ? "No customers yet. Click ➕ Add Customer to create the first one."
            : "No customers match these filters."}
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))",
          gap: 18
        }}
      >
        {filtered.map((c) => (
          <CustomerCard
            key={c.ID}
            customer={c}
            onOpen={() => setDrawerId(c.ID)}
            onEdit={(cust) => setEditing(cust)}
            onDelete={fetchAll}
            onGenerateQuote={(cust) => setGeneratingFor(cust)}
          />
        ))}
      </div>

      {editing != null && (
        <CustomerEditor
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            fetchAll();
          }}
        />
      )}

      <EntityDrawer
        open={drawerId != null}
        type="customer"
        id={drawerId}
        onClose={() => setDrawerId(null)}
      />

      {generatingFor && (
        <GenerateQuotationModal
          customer={generatingFor}
          onClose={() => setGeneratingFor(null)}
          onOpenRequirements={(cust) => {

            // Close this modal and open the customer's edit modal
            // (CustomerEditor) — that's where RequirementsManager
            // lives. The admin adds a requirement there, saves, then
            // re-opens the quotation modal from the customer card.
            setGeneratingFor(null);

            setEditing(cust);
          }}
          onCreated={() => {
            setGeneratingFor(null);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}


// ----------------------------------------------------------------
// Generate Quotation Modal — auto-generates a quotation from a
// customer's active requirements with BOM-based pricing. One-click
// experience: customer + a few knobs (margin, discount, validity) →
// quotation that can be auto-emailed straight to the customer.
// ----------------------------------------------------------------

function GenerateQuotationModal({ customer, onClose, onCreated, onOpenRequirements }) {

  const navigate = useNavigate();

  const [form, setForm] = useState({
    quotation_date: new Date().toISOString().slice(0, 10),
    discount_percent: 0,
    margin_percent: 25,
    validity_days: 30,
    notes: "",
    auto_send: true
  });

  const [submitting, setSubmitting] = useState(false);

  const [error, setError] = useState("");

  const [result, setResult] = useState(null);

  const [linkCopied, setLinkCopied] = useState(false);

  const setField = (k) => (e) => {

    const v = e.target.type === "checkbox"
      ? e.target.checked
      : e.target.value;

    setForm((f) => ({ ...f, [k]: v }));
  };

  const submit = async (e) => {

    e?.preventDefault?.();

    setSubmitting(true);

    setError("");

    try {

      const res = await API.post("/quotations/auto-generate", {
        CUSTOMER_ID: customer.ID,
        QUOTATION_DATE: form.quotation_date || null,
        DISCOUNT_PERCENT: Number(form.discount_percent) || 0,
        MARGIN_PERCENT: Number(form.margin_percent) || 25,
        VALIDITY_DAYS: Number(form.validity_days) || 30,
        NOTES: form.notes || null,
        AUTO_SEND_EMAIL: !!form.auto_send
      });

      setResult(res.data || {});

    } catch (err) {

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Failed to generate quotation."
      );

    } finally {

      setSubmitting(false);
    }
  };

  const copyPublicLink = () => {

    if (!result?.public_url) return;

    navigator.clipboard.writeText(result.public_url);

    setLinkCopied(true);

    setTimeout(() => setLinkCopied(false), 2000);
  };

  // ----- "Customer has no active requirements" friendly error -----
  const noRequirements =
    error &&
    /no\s+(active\s+)?requirement|requirements\s+to\s+quote/i.test(error);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(680px, 100%)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
        }}
      >

        {/* Sticky header */}
        <div style={{
          background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
          color: "white",
          padding: "20px 24px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, opacity: 0.85 }}>
              AUTO QUOTATION
            </div>
            <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>
              Generate Quotation — auto from requirements
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "white", border: "none",
              width: 30, height: 30, borderRadius: 8,
              cursor: "pointer", fontSize: 16
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0,
          overflowY: "auto",
          padding: 22
        }}>

          {/* Customer header card */}
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 14px",
            border: "1px solid #bbf7d0",
            background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
            borderRadius: 12,
            marginBottom: 18
          }}>
            <div style={{
              width: 38, height: 38, borderRadius: 10,
              background: "linear-gradient(135deg,#10b981,#059669)",
              color: "white",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontWeight: 800, fontSize: 18,
              boxShadow: "0 4px 12px rgba(16,185,129,0.35)"
            }}>
              ✓
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{
                fontSize: 10, fontWeight: 800,
                letterSpacing: 1.2, color: "#166534"
              }}>
                CUSTOMER
              </div>
              <div style={{
                fontSize: 15, fontWeight: 800,
                color: "#0f172a",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis"
              }}>
                {customer?.CUSTOMER_NAME || "—"}
              </div>
              <div style={{
                fontSize: 11, color: "#475569",
                fontFamily: "ui-monospace, monospace",
                marginTop: 1
              }}>
                {customer?.CUSTOMER_CODE || "—"}
                {customer?.EMAIL ? ` · ${customer.EMAIL}` : ""}
              </div>
            </div>
          </div>

          {!result && (
            <>
              {error && !noRequirements && (
                <div style={{
                  padding: "10px 12px", background: "#fef2f2",
                  color: "#991b1b", border: "1px solid #fecaca",
                  borderRadius: 8, fontSize: 13, marginBottom: 14
                }}>
                  ⚠ {error}
                </div>
              )}

              {error && noRequirements && (
                <div style={{
                  padding: 14,
                  background: "#fff7ed",
                  color: "#7c2d12",
                  border: "1px solid #fed7aa",
                  borderRadius: 10, fontSize: 13, marginBottom: 14,
                  lineHeight: 1.5
                }}>
                  <div style={{ fontWeight: 800, marginBottom: 4 }}>
                    ⚠ This customer has no active requirements yet
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    A quotation needs at least one requirement (which
                    vending machine, how many). Click below to open the
                    customer's profile and add one — then come back here
                    and click <b>Generate Quotation</b> again.
                  </div>
                  <button
                    onClick={() => {

                      if (onOpenRequirements) {

                        onOpenRequirements(customer);

                      } else {

                        onClose?.();
                      }
                    }}
                    style={{
                      padding: "10px 16px",
                      background: "linear-gradient(135deg,#C8102E,#8B0B1F)",
                      color: "white", border: "none",
                      borderRadius: 8, fontWeight: 800, fontSize: 13,
                      cursor: "pointer",
                      boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                    }}
                  >
                    📋 Open Customer → Add a Requirement
                  </button>
                </div>
              )}

              <form onSubmit={submit}>

                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1fr 1fr",
                  gap: 12,
                  marginBottom: 12
                }}>
                  <Field label="Quotation date">
                    <input
                      type="date"
                      value={form.quotation_date}
                      onChange={setField("quotation_date")}
                      style={inviteInputStyle()}
                    />
                  </Field>

                  <Field label="Validity (days)">
                    <input
                      type="number"
                      min="1"
                      value={form.validity_days}
                      onChange={setField("validity_days")}
                      style={inviteInputStyle()}
                    />
                  </Field>

                  <Field label="Margin % (BOM-based pricing)">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.margin_percent}
                      onChange={setField("margin_percent")}
                      style={inviteInputStyle()}
                    />
                  </Field>

                  <Field label="Discount %">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.discount_percent}
                      onChange={setField("discount_percent")}
                      style={inviteInputStyle()}
                    />
                  </Field>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label style={{
                    display: "block",
                    fontSize: 11, fontWeight: 700,
                    color: "#475569", marginBottom: 4,
                    letterSpacing: 0.5
                  }}>
                    Notes (optional)
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={setField("notes")}
                    rows={2}
                    placeholder="Anything special the customer should know…"
                    style={{
                      ...inviteInputStyle(),
                      resize: "vertical"
                    }}
                  />
                </div>

                <label style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 10,
                  padding: "10px 12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 10,
                  cursor: "pointer",
                  marginBottom: 16
                }}>
                  <input
                    type="checkbox"
                    checked={form.auto_send}
                    onChange={setField("auto_send")}
                    style={{ width: 18, height: 18 }}
                  />
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#991b1b" }}>
                      📧 Auto-send email to customer
                    </div>
                    <div style={{ fontSize: 11, color: "#7f1d1d", marginTop: 2 }}>
                      Quotation goes out the moment it's generated. Uncheck
                      to keep it as a DRAFT for review.
                    </div>
                  </div>
                </label>

                {/* What will be auto-filled callout */}
                <div style={{
                  background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
                  border: "1.5px solid #F4B324",
                  borderRadius: 12,
                  padding: "12px 14px",
                  marginBottom: 16
                }}>
                  <div style={{
                    fontSize: 11, fontWeight: 800,
                    letterSpacing: 1.2, color: "#8B4500",
                    marginBottom: 6
                  }}>
                    ✨ WHAT WILL BE AUTO-FILLED
                  </div>
                  <ul style={{
                    margin: 0,
                    paddingLeft: 18,
                    fontSize: 12,
                    color: "#7c2d12",
                    lineHeight: 1.7
                  }}>
                    <li>Company details, contact, GST &amp; address</li>
                    <li>All active requirements as line items</li>
                    <li>BOM-based pricing with {form.margin_percent || 25}% margin</li>
                    <li>GST 18% &amp; standard payment terms</li>
                    <li>12-month warranty &amp; delivery terms</li>
                  </ul>
                </div>

                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button
                    type="button"
                    onClick={onClose}
                    style={{
                      padding: "11px 18px",
                      background: "white",
                      color: "#475569",
                      border: "1px solid #cbd5e1",
                      borderRadius: 10,
                      fontWeight: 700, fontSize: 13,
                      cursor: "pointer"
                    }}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={submitting}
                    style={{
                      padding: "11px 22px",
                      background: submitting
                        ? "#94a3b8"
                        : "linear-gradient(135deg, #C8102E, #8B0B1F)",
                      color: "white", border: "none",
                      borderRadius: 10, fontWeight: 800, fontSize: 13,
                      cursor: submitting ? "wait" : "pointer",
                      boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                    }}
                  >
                    {submitting ? "Generating…" : "🤖 Generate Quotation"}
                  </button>
                </div>
              </form>
            </>
          )}

          {result && (
            <div style={{
              background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
              border: "2px solid #16a34a",
              borderRadius: 14,
              padding: 18,
              marginBottom: 8
            }}>
              <div style={{
                fontSize: 11, fontWeight: 800,
                letterSpacing: 1.5, color: "#14532d",
                marginBottom: 8
              }}>
                ✅ QUOTATION GENERATED
              </div>

              <div style={{
                fontSize: 20, fontWeight: 800,
                color: "#0f172a", letterSpacing: -0.3
              }}>
                {result.quotation_number || "—"} generated
              </div>

              <div style={{
                fontSize: 13, color: "#166534",
                marginTop: 6, lineHeight: 1.5
              }}>
                {(() => {
                  const lines = result?.quotation?.LINES?.length
                    ?? result?.requirements_used?.length
                    ?? 0;
                  const total = result?.quotation?.GRAND_TOTAL;
                  const totalStr = (total !== null && total !== undefined && !isNaN(total))
                    ? "₹" + Number(total).toLocaleString("en-IN", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2
                      })
                    : "—";
                  return `${lines} line(s), grand total ${totalStr}`;
                })()}
              </div>

              {result.email_sent && (
                <div style={{
                  marginTop: 12,
                  display: "inline-block",
                  padding: "6px 12px",
                  background: "#16a34a",
                  color: "white",
                  borderRadius: 999,
                  fontSize: 11, fontWeight: 800, letterSpacing: 0.5
                }}>
                  📧 Emailed to {customer?.EMAIL || "customer"}
                </div>
              )}

              {!result.email_sent && form.auto_send && (
                <div style={{
                  marginTop: 12,
                  padding: "8px 12px",
                  background: "#fff7ed",
                  color: "#7c2d12",
                  border: "1px solid #fed7aa",
                  borderRadius: 8,
                  fontSize: 12
                }}>
                  ⚠ Email could not be sent
                  {result.email_status ? `: ${result.email_status}` : ""}.
                  Quotation kept as DRAFT — you can retry from the
                  Quotations page.
                </div>
              )}

              {result.warnings && result.warnings.length > 0 && (
                <div style={{
                  marginTop: 12,
                  padding: "10px 12px",
                  background: "#fef3c7",
                  border: "1px solid #fde68a",
                  borderRadius: 8
                }}>
                  <div style={{
                    fontSize: 10, fontWeight: 800,
                    letterSpacing: 1, color: "#92400e",
                    marginBottom: 4
                  }}>
                    ⚠ WARNINGS
                  </div>
                  <ul style={{
                    margin: 0, paddingLeft: 18,
                    fontSize: 11, color: "#78350f",
                    lineHeight: 1.5
                  }}>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div style={{
                display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap"
              }}>
                <button
                  onClick={() => {
                    navigate("/quotations");
                    onCreated?.(result.quotation_id);
                  }}
                  style={{
                    padding: "10px 18px",
                    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
                    color: "white", border: "none",
                    borderRadius: 10, fontWeight: 800, fontSize: 13,
                    cursor: "pointer",
                    boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                  }}
                >
                  Open Quotation →
                </button>

                {result.public_url && (
                  <button
                    onClick={copyPublicLink}
                    style={{
                      padding: "10px 14px",
                      background: linkCopied ? "#16a34a" : "white",
                      color: linkCopied ? "white" : "#475569",
                      border: linkCopied
                        ? "1px solid #16a34a"
                        : "1px solid #cbd5e1",
                      borderRadius: 10, fontWeight: 700, fontSize: 12,
                      cursor: "pointer"
                    }}
                  >
                    {linkCopied ? "✓ Copied!" : "📋 Copy public link"}
                  </button>
                )}

                <button
                  onClick={onClose}
                  style={{
                    padding: "10px 14px",
                    background: "white",
                    color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: 10, fontWeight: 700, fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  Close
                </button>
              </div>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}


// ----------------------------------------------------------------
// Invite Customer Modal — admin generates a self-onboarding link
// that the customer opens in their browser to fill in their own
// company profile via the AI chatbot.
// ----------------------------------------------------------------

function InviteCustomerModal({ onClose }) {

  const [form, setForm] = useState({ NAME_HINT: "", EMAIL_HINT: "" });

  const [result, setResult] = useState(null);

  const [pending, setPending] = useState([]);

  const [loading, setLoading] = useState(false);

  const [error, setError] = useState("");

  const [copied, setCopied] = useState(false);

  const loadPending = () => {

    API.get("/onboarding/sessions")
      .then((r) => setPending(r.data || []))
      .catch(() => setPending([]));
  };

  useEffect(() => { loadPending(); }, []);

  const submit = async (e) => {

    e?.preventDefault?.();

    setLoading(true);

    setError("");

    setResult(null);

    setCopied(false);

    try {

      const res = await API.post("/onboarding/invite", {
        NAME_HINT: form.NAME_HINT.trim() || null,
        EMAIL_HINT: form.EMAIL_HINT.trim() || null,
        VENDOR_ID: 1
      });

      setResult(res.data);

      loadPending();

    } catch (err) {

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not generate invitation."
      );

    } finally {

      setLoading(false);
    }
  };

  const copy = () => {

    if (!result?.portal_url) return;

    navigator.clipboard.writeText(result.portal_url);

    setCopied(true);

    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.55)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1100, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(720px, 100%)",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
        }}
      >

        {/* Sticky header */}
        <div style={{
          background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
          color: "white",
          padding: "20px 24px",
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between"
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 2, opacity: 0.85 }}>
              CUSTOMER SELF-ONBOARDING
            </div>
            <h2 style={{ margin: "4px 0 0", fontSize: 18 }}>
              Invite customer to fill their own profile
            </h2>
          </div>
          <button
            onClick={onClose}
            style={{
              background: "rgba(255,255,255,0.15)",
              color: "white", border: "none",
              width: 30, height: 30, borderRadius: 8,
              cursor: "pointer", fontSize: 16
            }}
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div style={{
          flex: 1, minHeight: 0,
          overflowY: "auto",
          padding: 22
        }}>

          <p style={{ margin: "0 0 16px", color: "#475569", fontSize: 13, lineHeight: 1.5 }}>
            Generate a unique link the customer opens in their browser.
            Our AI chatbot walks them through every field — when they
            click <b>Submit</b>, the customer card appears here automatically.
          </p>

          {!result && (
            <form onSubmit={submit}>
              <div style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 12,
                marginBottom: 12
              }}>
                <Field label="Company name (optional)">
                  <input
                    type="text"
                    value={form.NAME_HINT}
                    onChange={(e) => setForm({ ...form, NAME_HINT: e.target.value })}
                    placeholder="e.g. Apollo Hospitals"
                    style={inviteInputStyle()}
                  />
                </Field>
                <Field label="Customer email (optional — sends invite)">
                  <input
                    type="email"
                    value={form.EMAIL_HINT}
                    onChange={(e) => setForm({ ...form, EMAIL_HINT: e.target.value })}
                    placeholder="contact@example.com"
                    style={inviteInputStyle()}
                  />
                </Field>
              </div>

              {error && (
                <div style={{
                  padding: "8px 12px", background: "#fef2f2",
                  color: "#991b1b", border: "1px solid #fecaca",
                  borderRadius: 8, fontSize: 13, marginBottom: 12
                }}>
                  ⚠ {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: "11px 22px",
                  background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
                  color: "white", border: "none",
                  borderRadius: 10, fontWeight: 800, fontSize: 13,
                  cursor: loading ? "wait" : "pointer",
                  boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                }}
              >
                {loading ? "Generating…" : "🔗 Generate Invitation Link"}
              </button>
            </form>
          )}

          {result && (
            <div style={{
              background: "linear-gradient(135deg, #fff7ed, #ffedd5)",
              border: "2px solid #F4B324",
              borderRadius: 12,
              padding: "16px 18px",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: "#8B4500", marginBottom: 8 }}>
                ✅ INVITATION CREATED
              </div>
              <div style={{
                background: "white", padding: 10, borderRadius: 8,
                fontFamily: "ui-monospace, monospace", fontSize: 12,
                wordBreak: "break-all", color: "#0f172a",
                border: "1px solid #fcd34d"
              }}>
                {result.portal_url}
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button
                  onClick={copy}
                  style={{
                    padding: "8px 14px",
                    background: copied ? "#16a34a" : "#0f172a",
                    color: "white", border: "none",
                    borderRadius: 8, fontWeight: 700, fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  {copied ? "✓ Copied!" : "📋 Copy Link"}
                </button>
                <a
                  href={result.portal_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "8px 14px",
                    background: "#C8102E",
                    color: "white", border: "none",
                    borderRadius: 8, fontWeight: 700, fontSize: 12,
                    textDecoration: "none",
                    display: "inline-block"
                  }}
                >
                  Open in new tab ↗
                </a>
                <button
                  onClick={() => { setResult(null); setForm({ NAME_HINT: "", EMAIL_HINT: "" }); }}
                  style={{
                    padding: "8px 14px",
                    background: "white", color: "#475569",
                    border: "1px solid #cbd5e1",
                    borderRadius: 8, fontWeight: 700, fontSize: 12,
                    cursor: "pointer"
                  }}
                >
                  + Generate another
                </button>
              </div>
              {result.email_sent && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#166534" }}>
                  📧 Invitation email also sent to <b>{result.session.EMAIL_HINT}</b>
                </div>
              )}
              {result.email_message && !result.email_sent && result.session?.EMAIL_HINT && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#854d0e" }}>
                  ⚠ Email not sent: {result.email_message}
                </div>
              )}
            </div>
          )}

          {/* Pending invitations list */}
          <div style={{ marginTop: 22 }}>
            <div style={{
              fontSize: 11, fontWeight: 800,
              letterSpacing: 1.4, color: "#475569",
              marginBottom: 8,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center"
            }}>
              <span>ONBOARDING INVITATIONS ({pending.length})</span>
              <button
                onClick={loadPending}
                style={{
                  fontSize: 10,
                  background: "white",
                  border: "1px solid #cbd5e1",
                  borderRadius: 6,
                  padding: "3px 8px",
                  cursor: "pointer",
                  color: "#475569",
                  fontWeight: 700,
                  letterSpacing: 0.3
                }}
              >
                🔄 Refresh
              </button>
            </div>

            {pending.length === 0 && (
              <div style={{ color: "#94a3b8", fontSize: 12, padding: 14, textAlign: "center" }}>
                No invitations yet.
              </div>
            )}

            {pending.length > 0 && (
              <div style={{
                border: "1px solid #e2e8f0",
                borderRadius: 10,
                overflow: "hidden"
              }}>

                {/* Header row */}
                <div style={{
                  display: "grid",
                  gridTemplateColumns: "1.4fr 1fr 70px 70px 90px 80px",
                  gap: 8,
                  padding: "8px 12px",
                  background: "#f8fafc",
                  fontSize: 9,
                  fontWeight: 800,
                  letterSpacing: 1,
                  color: "#94a3b8",
                  borderBottom: "1px solid #e2e8f0"
                }}>
                  <div>CUSTOMER</div>
                  <div>STATUS</div>
                  <div style={{ textAlign: "right" }}>COMPLETE</div>
                  <div style={{ textAlign: "right" }}>PENDING</div>
                  <div>LAST ACTIVE</div>
                  <div></div>
                </div>

                {pending.map((p) => (
                  <div
                    key={p.ID}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.4fr 1fr 70px 70px 90px 80px",
                      gap: 8,
                      padding: "10px 12px",
                      alignItems: "center",
                      fontSize: 12,
                      borderBottom: "1px solid #f1f5f9"
                    }}
                  >
                    {/* Customer name + sub */}
                    <div>
                      <div style={{ fontWeight: 700, color: "#0f172a" }}>
                        {p.DISPLAY_NAME || p.NAME_HINT || (
                          <span style={{ color: "#94a3b8", fontWeight: 500 }}>
                            (unnamed)
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>
                        {p.EMAIL_HINT || "no email"}
                        {p.CREATED_AT && (
                          <> · invited {new Date(p.CREATED_AT).toLocaleDateString("en-IN")}</>
                        )}
                      </div>
                    </div>

                    <StatusChip status={p.STATUS} />

                    {/* Progress */}
                    <div style={{
                      textAlign: "right",
                      fontWeight: 800,
                      color: p.PROGRESS_PCT >= 100 ? "#16a34a" : "#475569",
                      fontSize: 13
                    }}>
                      {p.PROGRESS_PCT}%
                    </div>

                    {/* Pending count */}
                    <div style={{
                      textAlign: "right",
                      color: p.PENDING_COUNT > 0 ? "#d97706" : "#94a3b8",
                      fontWeight: 700,
                      fontSize: 12
                    }}>
                      {p.PENDING_COUNT ?? "—"}
                    </div>

                    {/* Last active */}
                    <div style={{ fontSize: 10, color: "#64748b" }}>
                      {p.SUBMITTED_AT
                        ? <>✓ {new Date(p.SUBMITTED_AT).toLocaleDateString("en-IN")}</>
                        : p.LAST_ACTIVITY_AT
                          ? new Date(p.LAST_ACTIVITY_AT).toLocaleDateString("en-IN")
                          : <span style={{ color: "#94a3b8" }}>—</span>
                      }
                    </div>

                    {/* Action — Delete the invitation */}
                    <button
                      onClick={async () => {

                        const ok = window.confirm(
                          `Delete onboarding invitation for "${p.DISPLAY_NAME || p.NAME_HINT || "this customer"}"?\n\n` +
                          `The portal account and chat history will be removed.` +
                          (p.CUSTOMER_ID
                            ? "\n\nThe linked customer record will be PRESERVED — delete it separately from the Customers page if needed."
                            : "")
                        );

                        if (!ok) return;

                        try {

                          await API.delete(`/onboarding/sessions/${p.TOKEN}`);

                          loadPending();

                        } catch (err) {

                          alert(
                            err?.response?.data?.detail ||
                              "Could not delete invitation."
                          );
                        }
                      }}
                      title="Delete this invitation"
                      style={{
                        padding: "6px 8px",
                        background: "white",
                        color: "#b91c1c",
                        border: "1px solid #fecaca",
                        borderRadius: 6,
                        fontSize: 10,
                        cursor: "pointer",
                        fontWeight: 700
                      }}
                    >
                      🗑 Delete
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      </div>
    </div>
  );
}


function StatusChip({ status }) {

  const themes = {
    INVITED:    { bg: "#f1f5f9", fg: "#475569" },
    REGISTERED: { bg: "#dbeafe", fg: "#1d4ed8" },
    IN_PROGRESS:{ bg: "#fef3c7", fg: "#854d0e" },
    SUBMITTED:  { bg: "#dcfce7", fg: "#166534" }
  };

  const t = themes[status] || themes.INVITED;

  return (
    <span style={{
      background: t.bg, color: t.fg,
      padding: "3px 8px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.5,
      textAlign: "center"
    }}>
      {status?.replace(/_/g, " ")}
    </span>
  );
}


function inviteInputStyle() {

  return {
    width: "100%",
    padding: "9px 11px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white",
    boxSizing: "border-box"
  };
}


function Field({ label, children }) {

  return (
    <div>
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: "#475569",
        marginBottom: 4,
        letterSpacing: 0.5
      }}>
        {label}
      </label>
      {children}
    </div>
  );
}


export default Customers;
