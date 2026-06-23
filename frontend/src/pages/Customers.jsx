import { useEffect, useMemo, useState } from "react";

import { useNavigate } from "react-router-dom";

import API from "../services/api";

import EntityDrawer from "../components/EntityDrawer";

import styles from "./Customers.module.css";


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
  ACTIVE: { bg: "#dcfce7", fg: "#166534", color: "#059669" },
  PROSPECT: { bg: "#dbeafe", fg: "#1e40af", color: "#1d4ed8" },
  LEAD: { bg: "#fef3c7", fg: "#854d0e", color: "#f59e0b" },
  INACTIVE: { bg: "#f1f5f9", fg: "#475569", color: "#94a3b8" }
};


// Inline SVGs — keep them tiny so the cards stay light.
const Icon = {
  search: (p) => (
    <svg width={p?.size || 16} height={p?.size || 16} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  ),
  users: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  check: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  trending: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" /><polyline points="17 6 23 6 23 12" />
    </svg>
  ),
  receipt: (p) => (
    <svg width={p?.size || 18} height={p?.size || 18} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" /><line x1="8" y1="13" x2="16" y2="13" />
      <line x1="8" y1="17" x2="16" y2="17" />
    </svg>
  ),
  pencil: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z" />
    </svg>
  ),
  doc: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  ),
  trash: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
      <line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" />
    </svg>
  ),
  phone: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.37 1.9.72 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.35 1.85.59 2.81.72A2 2 0 0 1 22 16.92z" />
    </svg>
  ),
  mail: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
      <polyline points="22,6 12,13 2,6" />
    </svg>
  ),
  pin: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  ),
  user: (p) => (
    <svg width={p?.size || 12} height={p?.size || 12} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  plus: (p) => (
    <svg width={p?.size || 14} height={p?.size || 14} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  ),
};


// =================================================================
// Reusable atoms
// =================================================================

function StatTile({ label, value, sub, color, icon }) {

  return (

    <div
      className={styles.statTile}
      style={{ borderTop: `3px solid ${color}` }}
    >
      {icon && (
        <div className={styles.statTileIcon} style={{ color }}>
          {icon}
        </div>
      )}

      <div className={styles.statTileLabel}>
        {label}
      </div>

      <div className={styles.statTileValue}>
        {value}
      </div>

      {sub && (
        <div className={styles.statTileSub}>
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
      className={styles.statusPill}
      style={{ background: t.bg, color: t.fg }}
    >
      {status || "ACTIVE"}
    </span>
  );
}


// Lead pipeline status pill — distinct palette from overall customer
// status so the two are visually separable.
const LEAD_STATUS_THEMES = {
  NEW: { bg: "#e0e7ff", fg: "#3730a3" },
  CONTACTED: { bg: "#dbeafe", fg: "#1e40af" },
  QUALIFIED: { bg: "#cffafe", fg: "#0e7490" },
  QUOTED: { bg: "#fef3c7", fg: "#92400e" },
  NEGOTIATING: { bg: "#fce7f3", fg: "#9d174d" },
  WON: { bg: "#dcfce7", fg: "#166534" },
  LOST: { bg: "#fee2e2", fg: "#991b1b" }
};


function LeadStatusPill({ status }) {

  const t = LEAD_STATUS_THEMES[status] || LEAD_STATUS_THEMES.NEW;

  return (

    <span
      className={styles.leadStatusPill}
      style={{ background: t.bg, color: t.fg }}
    >
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
      className={styles.card}
    >

      <div
        className={styles.cardAccentBar}
        style={{ background: theme.color }}
      />

      <button
        onClick={(e) => {
          e.stopPropagation();
          onGenerateQuote?.(customer);
        }}
        title="Auto-generate quotation from this customer's requirements"
        className={styles.cardBtnQuote}
      >
        <Icon.doc size={14} />
      </button>

      <button
        onClick={(e) => {
          e.stopPropagation();
          onEdit?.(customer);
        }}
        title="Edit customer"
        className={styles.cardBtnEdit}
      >
        <Icon.pencil size={14} />
      </button>

      <button
        onClick={handleDelete}
        disabled={deleting}
        title="Delete customer"
        className={styles.cardBtnDelete}
      >
        <Icon.trash size={14} />
      </button>

      <div className={styles.cardHeader}>

        <div
          className={styles.cardAvatar}
          style={{
            background: theme.color,
            boxShadow: `0 6px 16px ${theme.fg}33`
          }}
        >
          {(customer.CUSTOMER_NAME || "?").charAt(0).toUpperCase()}
        </div>

        <div className={styles.cardMeta}>

          <div className={styles.cardCode}>
            {customer.CUSTOMER_CODE || "—"}
          </div>

          <div className={styles.cardName}>
            {customer.CUSTOMER_NAME}
          </div>

          <div className={styles.cardBadgeRow}>
            <StatusPill status={status} />
            {customer.LEAD_STATUS && customer.LEAD_STATUS !== "NEW" && (
              <LeadStatusPill status={customer.LEAD_STATUS} />
            )}
            {customer.LEAD_PRIORITY === "HIGH" && (
              <span className={styles.highPriorityBadge}>
                HIGH PRIORITY
              </span>
            )}
          </div>
        </div>
      </div>

      {customer.ASSIGNED_SALES_NAME && (
        <div className={styles.salesOwnerBanner}>
          Sales owner: <strong>{customer.ASSIGNED_SALES_NAME}</strong>
        </div>
      )}

      {customer.FOLLOW_UP_DATE && customer.LEAD_STATUS !== "WON" && customer.LEAD_STATUS !== "LOST" && (
        <div className={styles.followUpBanner}>
          Follow-up: <strong>{customer.FOLLOW_UP_DATE}</strong>
        </div>
      )}

      <div className={styles.contactBlock}>
        {customer.CONTACT_PERSON && (
          <div className={styles.contactName}>
            <Icon.user />
            <span>
              {customer.CONTACT_PERSON}
              {customer.DESIGNATION && (
                <span className={styles.contactDesignation}>
                  {" · "}{customer.DESIGNATION}
                </span>
              )}
            </span>
          </div>
        )}
        <div className={styles.contactRow}>
          <Icon.phone />
          <span>{customer.PHONE || "—"}</span>
        </div>
        <div className={styles.contactRowTruncate}>
          <Icon.mail />
          <span>{customer.EMAIL || "—"}</span>
        </div>
        {(customer.CITY || customer.STATE) && (
          <div className={styles.contactLocation}>
            <Icon.pin />
            <span>{[customer.CITY, customer.STATE].filter(Boolean).join(", ")}</span>
          </div>
        )}
      </div>

      <div className={styles.tagRow}>
        {customer.INDUSTRY && (
          <span className={styles.tagIndustry}>
            {customer.INDUSTRY}
          </span>
        )}
        {customer.SOURCE && (
          <span className={styles.tagSource}>
            via {customer.SOURCE}
          </span>
        )}
        {customer.GST_NUMBER && (
          <span className={styles.tagGst} title="GST registered">
            GST
          </span>
        )}
      </div>

      <div className={styles.cardFooter}>
        View profile &rarr;
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

      <label className={styles.fieldLabel}>
        {label}
      </label>

      {children}
    </div>
  );
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

      <div className={styles.reqHeader}>
        <div className={styles.reqTitle}>
          Requirements ({rows.length})
        </div>

        <button
          type="button"
          onClick={() => setEditing("new")}
          className={styles.reqAddBtn}
        >
          <Icon.plus size={12} />
          Add requirement
        </button>
      </div>

      {loading && (
        <div className={styles.reqLoading}>
          Loading…
        </div>
      )}

      {!loading && rows.length === 0 && (
        <div className={styles.reqEmpty}>
          No requirements yet. Click <b>Add Requirement</b> to capture
          what machines this customer wants.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <div className={styles.reqList}>

          {rows.map((r) => {

            const statusTheme = REQ_STATUS_THEME[r.STATUS] || REQ_STATUS_THEME.DRAFT;

            const prioTheme = REQ_PRIORITY_THEME[r.PRIORITY] || REQ_PRIORITY_THEME.MEDIUM;

            return (

              <div key={r.ID} className={styles.reqItem}>
                <div className={styles.reqItemRow}>
                  <div className={styles.reqItemBody}>

                    <div className={styles.reqItemHeader}>
                      <span className={styles.reqItemName}>
                        {r.MACHINE_NAME || r.MACHINE_CATEGORY || "Unnamed requirement"}
                      </span>
                      <span
                        className={styles.reqStatusBadge}
                        style={{ background: statusTheme.bg, color: statusTheme.fg }}
                      >
                        {r.STATUS}
                      </span>
                      <span
                        className={styles.reqPrioBadge}
                        style={{ background: prioTheme.bg, color: prioTheme.fg }}
                      >
                        {r.PRIORITY}
                      </span>
                    </div>

                    <div className={styles.reqItemMeta}>
                      {r.MACHINE_CATEGORY && (
                        <span>Category: <b>{r.MACHINE_CATEGORY}</b></span>
                      )}
                      <span>Qty: <b>{r.QUANTITY || 1}</b></span>
                      {r.CAPACITY && (
                        <span>Capacity: <b>{r.CAPACITY}</b></span>
                      )}
                      {r.TARGET_UNIT_PRICE && (
                        <span>Target: <b>&#8377;{Number(r.TARGET_UNIT_PRICE).toLocaleString("en-IN")}/unit</b></span>
                      )}
                      {r.TARGET_DELIVERY_DATE && (
                        <span>By <b>{r.TARGET_DELIVERY_DATE}</b></span>
                      )}
                    </div>

                    {r.INSTALLATION_SITE && (
                      <div className={styles.reqItemSite}>
                        Site: {r.INSTALLATION_SITE}
                      </div>
                    )}

                    {r.SPECIAL_NOTES && (
                      <div className={styles.reqItemNotes}>
                        &ldquo;{r.SPECIAL_NOTES}&rdquo;
                      </div>
                    )}
                  </div>

                  <div className={styles.reqItemActions}>
                    {r.STATUS !== "ORDERED" && r.PRODUCT_MODEL_ID && (
                      <button
                        type="button"
                        onClick={async () => {

                          if (!window.confirm(
                            "Convert this requirement into a Project?\n\n" +
                            "This will create a project, seed product stages, " +
                            "auto-assign tasks to skilled employees, and " +
                            "mark this requirement as ORDERED."
                          )) return;

                          try {

                            const res = await API.post(
                              `/customers/${customerId}/requirements/${r.ID}/to-project`
                            );

                            alert(res.data?.message || "Project created");

                            load();

                          } catch (err) {

                            alert(err?.response?.data?.detail || "Failed to convert");
                          }
                        }}
                        title="Convert to Project"
                        className={styles.reqBtnConvert}
                      >
                        Convert to project
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setEditing(r)}
                      title="Edit"
                      className={styles.reqBtnEdit}
                    >
                      <Icon.pencil size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => remove(r.ID)}
                      title="Delete"
                      className={styles.reqBtnDelete}
                    >
                      <Icon.trash size={13} />
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

    <div className={styles.reqForm}>
      <div className={styles.reqFormTitle}>
        {isEdit ? "EDIT REQUIREMENT" : "NEW REQUIREMENT"}
      </div>

      <div className={styles.reqFormGrid}>
        <FormField label="Machine Category">
          <select
            value={data.MACHINE_CATEGORY}
            onChange={set("MACHINE_CATEGORY")}
            className={styles.input}
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
            className={styles.input}
            placeholder="e.g. C 608 R1 Coffee Pro"
          />
        </FormField>

        <FormField label="Link to existing Product (optional)" span={2}>
          <select
            value={data.PRODUCT_MODEL_ID}
            onChange={set("PRODUCT_MODEL_ID")}
            className={styles.input}
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
            className={styles.input}
          />
        </FormField>

        <FormField label="Capacity">
          <input
            type="text"
            value={data.CAPACITY}
            onChange={set("CAPACITY")}
            className={styles.input}
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
            className={styles.input}
            placeholder="e.g. 85000"
          />
        </FormField>

        <FormField label="Target Delivery Date">
          <input
            type="date"
            value={data.TARGET_DELIVERY_DATE}
            onChange={set("TARGET_DELIVERY_DATE")}
            className={styles.input}
          />
        </FormField>

        <FormField label="Installation Site" span={2}>
          <input
            type="text"
            value={data.INSTALLATION_SITE}
            onChange={set("INSTALLATION_SITE")}
            className={styles.input}
            placeholder="Branch name + address (where it ships)"
          />
        </FormField>

        <FormField label="Priority">
          <select value={data.PRIORITY} onChange={set("PRIORITY")} className={styles.input}>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>
        </FormField>

        <FormField label="Status">
          <select value={data.STATUS} onChange={set("STATUS")} className={styles.input}>
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
            className={styles.input}
            style={{ resize: "vertical" }}
            placeholder="Touchscreen, cashless, IoT, custom branding, refrigeration..."
          />
        </FormField>
      </div>

      <div className={styles.reqFormActions}>
        <button
          type="button"
          onClick={onCancel}
          className={styles.reqFormCancelBtn}
        >
          Cancel
        </button>

        <button
          type="button"
          onClick={save}
          disabled={saving}
          className={styles.reqFormSaveBtn}
        >
          {saving ? "Saving…" : isEdit ? "Update" : "Save"}
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

      <div className={styles.quotHeader}>
        <div className={styles.quotTitle}>
          Quotations ({quotations.length})
        </div>

        <div className={styles.quotActions}>
          <button
            type="button"
            onClick={openPicker}
            className={styles.quotBtnCreate}
          >
            Create from requirements
          </button>

          <button
            type="button"
            onClick={onJumpToQuotations}
            title="Go to Quotations page"
            className={styles.quotBtnOpen}
          >
            Open quotations &rarr;
          </button>
        </div>
      </div>

      {loading && (
        <div className={styles.reqLoading}>
          Loading…
        </div>
      )}

      {!loading && quotations.length === 0 && (
        <div className={styles.quotEmpty}>
          No quotations yet for this customer. Pick from confirmed
          requirements or use the Quotations page to create one manually.
        </div>
      )}

      {!loading && quotations.length > 0 && (
        <div className={styles.quotList}>

          {quotations.map((q) => {

            const theme = QUOT_STATUS_THEME[q.STATUS] || QUOT_STATUS_THEME.DRAFT;

            return (
              <div key={q.ID} className={styles.quotRow}>
                <div>
                  <div className={styles.quotNumber}>
                    {q.QUOTATION_NUMBER}
                  </div>
                  <div className={styles.quotDate}>
                    {q.QUOTATION_DATE}
                  </div>
                </div>
                <div>
                  <div className={styles.quotExpLabel}>Expires</div>
                  <div className={styles.quotExpDate}>{q.EXPIRY_DATE || "—"}</div>
                </div>
                <div>
                  <span
                    className={styles.statusPill}
                    style={{ background: theme.bg, color: theme.fg }}
                  >
                    {q.STATUS}
                  </span>
                </div>
                <div className={styles.quotTotalCol}>
                  <div className={styles.quotTotalLabel}>Total</div>
                  <div className={styles.quotTotal}>{inr(q.GRAND_TOTAL)}</div>
                </div>
                <div className={styles.quotBtnViewWrap}>
                  <button
                    type="button"
                    onClick={() => window.open(`/quotation-print/${q.ID}`, "_blank")}
                    title="View / Print"
                    className={styles.quotBtnView}
                  >
                    View
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
    <div className={styles.modalOverlay} onClick={onCancel}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.pickerModal}
      >
        <div className={styles.pickerTitle}>
          Create quotation from requirements
        </div>

        {requirements.length === 0 && (
          <div className={styles.pickerNoReqs}>
            No quotable requirements found. Only DRAFT or CONFIRMED
            requirements can be used. Already-QUOTED requirements
            won&apos;t appear here.
          </div>
        )}

        {requirements.length > 0 && (
          <>
            <div className={styles.pickerHint}>
              Pick which requirements to include as line items:
            </div>

            <div className={styles.pickerList}>
              {requirements.map((r) => (
                <label
                  key={r.ID}
                  className={`${styles.pickerRow} ${picked.has(r.ID) ? styles.pickerRowSelected : styles.pickerRowDefault}`}
                >
                  <input
                    type="checkbox"
                    checked={picked.has(r.ID)}
                    onChange={() => togglePick(r.ID)}
                    style={{ width: 18, height: 18, marginTop: 2 }}
                  />
                  <div className={styles.reqItemBody}>
                    <div className={styles.pickerRowName}>
                      {r.MACHINE_NAME || r.MACHINE_CATEGORY || `Requirement #${r.ID}`}
                    </div>
                    <div className={styles.pickerRowMeta}>
                      Qty: {r.QUANTITY || 1}
                      {r.TARGET_UNIT_PRICE ? ` · Target ₹${r.TARGET_UNIT_PRICE}/unit` : " · BOM-priced"}
                      {r.CAPACITY ? ` · ${r.CAPACITY}` : ""}
                    </div>
                  </div>
                  <span className={styles.pickerStatusBadge}>
                    {r.STATUS}
                  </span>
                </label>
              ))}
            </div>

            <div className={styles.pickerMarginRow}>
              <label className={styles.pickerMarginLabel}>
                Margin % (used when no target price set):
              </label>
              <input
                type="number"
                min="0"
                step="1"
                value={margin}
                onChange={(e) => setMargin(e.target.value)}
                className={styles.pickerMarginInput}
              />
            </div>
          </>
        )}

        <div className={styles.pickerActions}>
          <button
            type="button"
            onClick={onCancel}
            className={styles.pickerCancelBtn}
          >
            Cancel
          </button>

          {requirements.length > 0 && (
            <button
              type="button"
              onClick={onSubmit}
              disabled={creating || picked.size === 0}
              className={styles.pickerConfirmBtn}
            >
              {creating ? "Creating…" : `Create from ${picked.size} requirement(s)`}
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

  const [errors, setErrors] = useState({});

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

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((errs) => ({ ...errs, [k]: "" }));
  };

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

    // Field-level validation
    const PHONE_RE = /^\d{10}$/;
    const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
    const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

    const newErrors = {};

    if (!PHONE_RE.test(form.PHONE.trim())) {
      newErrors.PHONE = "Enter a valid 10-digit mobile number";
    }
    if (form.ALTERNATE_PHONE.trim() && !PHONE_RE.test(form.ALTERNATE_PHONE.trim())) {
      newErrors.ALTERNATE_PHONE = "Enter a valid 10-digit mobile number";
    }
    if (form.WHATSAPP_NUMBER.trim() && !PHONE_RE.test(form.WHATSAPP_NUMBER.trim())) {
      newErrors.WHATSAPP_NUMBER = "Enter a valid 10-digit mobile number";
    }
    if (form.GST_NUMBER.trim() && !GST_RE.test(form.GST_NUMBER.trim())) {
      newErrors.GST_NUMBER = "Invalid GST — must be 15 chars e.g. 33ABCDE1234F1Z5";
    }
    if (form.PAN_NUMBER.trim() && !PAN_RE.test(form.PAN_NUMBER.trim())) {
      newErrors.PAN_NUMBER = "Invalid PAN — must be 10 chars e.g. ABCDE1234F";
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
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
            `${prod.model_name} (${prod.model_code}) ${verb} in Products & BOM.\n` +
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

    <div className={styles.editorOverlay} onClick={onClose}>

      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.editorPanel}
      >

        <div className={styles.editorHeader}>
          <div>
            <div className={styles.editorHeaderLabel}>
              {isEdit ? "Edit Customer" : "New Customer"}
            </div>
            <div className={styles.editorHeaderTitle}>
              {form.CUSTOMER_NAME || "Add a customer who wants a vending machine"}
            </div>
            <div className={styles.editorHeaderSub}>
              All details land in their 360° view and connect to Production & BOM.
            </div>
          </div>

          <button
            onClick={onClose}
            className={styles.editorCloseBtn}
          >
            ×
          </button>
        </div>

        <form onSubmit={submit}>

          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingCyan}`}>
            Identity
          </div>

          <div className={styles.grid2}>

            <FormField label="Company / Customer Name *">
              <input
                type="text"
                value={form.CUSTOMER_NAME}
                onChange={set("CUSTOMER_NAME")}
                className={styles.input}
                placeholder="Chennai Metro Rail Ltd"
              />
            </FormField>

            <FormField label="Customer Type">
              <select
                value={form.CUSTOMER_TYPE}
                onChange={set("CUSTOMER_TYPE")}
                className={styles.input}
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
                className={styles.input}
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
                className={styles.input}
                placeholder="Suresh Iyer"
              />
            </FormField>

            <FormField label="Designation">
              <input
                type="text"
                value={form.DESIGNATION}
                onChange={set("DESIGNATION")}
                className={styles.input}
                placeholder="Purchase Manager"
              />
            </FormField>
          </div>

          {/* Lead pipeline */}
          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingGray}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
            Lead pipeline
            <span className={styles.formSectionBadge}>
              SALES OWNERSHIP
            </span>
          </div>

          <div className={`${styles.grid3} ${styles.subPanel}`}>

            <FormField label="Lead Source">
              <select
                value={form.LEAD_SOURCE}
                onChange={set("LEAD_SOURCE")}
                className={styles.input}
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
                className={styles.input}
              >
                <option value="NEW">New</option>
                <option value="CONTACTED">Contacted</option>
                <option value="QUALIFIED">Qualified</option>
                <option value="QUOTED">Quoted</option>
                <option value="NEGOTIATING">Negotiating</option>
                <option value="WON">Won</option>
                <option value="LOST">Lost</option>
              </select>
            </FormField>

            <FormField label="Lead Priority">
              <select
                value={form.LEAD_PRIORITY}
                onChange={set("LEAD_PRIORITY")}
                className={styles.input}
              >
                <option value="HIGH">High</option>
                <option value="MEDIUM">Medium</option>
                <option value="LOW">Low</option>
              </select>
            </FormField>

            <FormField label="Assigned Salesperson">
              <select
                value={form.ASSIGNED_SALES_ID}
                onChange={set("ASSIGNED_SALES_ID")}
                className={styles.input}
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
                className={styles.input}
              />
            </FormField>

            <FormField label="Requirement Notes" span={3}>
              <textarea
                rows={3}
                value={form.REQUIREMENT_NOTES}
                onChange={set("REQUIREMENT_NOTES")}
                placeholder={"What the customer asked for during enquiry —\nspecs, qty, delivery timeline, special features..."}
                className={styles.input}
              />
            </FormField>
          </div>

          {!isEdit && (

            <>

              <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingGray}`} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                Machine requested
                <span className={styles.formSectionBadge}>
                  AUTO-CREATES IN PRODUCTS &amp; BOM
                </span>
              </div>

              <div className={`${styles.subPanel} ${styles.machineGrid}`}>

                <FormField label="Which vending machine they want?">
                  <input
                    type="text"
                    list="existing-products-dl"
                    value={form.REQUESTED_MACHINE_NAME}
                    onChange={set("REQUESTED_MACHINE_NAME")}
                    className={styles.input}
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
                    className={styles.input}
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
                    className={styles.input}
                  />
                </FormField>

                <div className={styles.machineHint}>
                  If the machine doesn&apos;t exist in Products &amp; BOM,
                  it&apos;ll be auto-created with the default 10-stage
                  manufacturing flow + 62-line BOM template. Already
                  exists? It&apos;s linked, no duplicate.
                </div>

              </div>

            </>
          )}

          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingBlue}`}>
            Reach
          </div>

          <div className={styles.grid3}>
            <FormField label="Phone *">
              <input
                type="text"
                value={form.PHONE}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setForm((f) => ({ ...f, PHONE: digits }));
                  setErrors((errs) => ({
                    ...errs,
                    PHONE: digits.length > 0 && digits.length < 10 ? "Mobile number must be 10 digits" : ""
                  }));
                }}
                className={`${styles.input}${errors.PHONE ? ` ${styles.inputError}` : ""}`}
                placeholder="9876543210"
                inputMode="numeric"
              />
              {errors.PHONE && <div className={styles.errorMsg}>{errors.PHONE}</div>}
            </FormField>
            <FormField label="Alternate Phone">
              <input
                type="text"
                value={form.ALTERNATE_PHONE}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setForm((f) => ({ ...f, ALTERNATE_PHONE: digits }));
                  setErrors((errs) => ({
                    ...errs,
                    ALTERNATE_PHONE: digits.length > 0 && digits.length < 10 ? "Mobile number must be 10 digits" : ""
                  }));
                }}
                className={`${styles.input}${errors.ALTERNATE_PHONE ? ` ${styles.inputError}` : ""}`}
                placeholder="9876543210"
                inputMode="numeric"
              />
              {errors.ALTERNATE_PHONE && <div className={styles.errorMsg}>{errors.ALTERNATE_PHONE}</div>}
            </FormField>
            <FormField label="Email *">
              <input type="email" value={form.EMAIL} onChange={set("EMAIL")} className={styles.input} placeholder="contact@example.com" />
            </FormField>
            <FormField label="WhatsApp Number">
              <input
                type="text"
                value={form.WHATSAPP_NUMBER}
                onChange={(e) => {
                  const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                  setForm((f) => ({ ...f, WHATSAPP_NUMBER: digits }));
                  setErrors((errs) => ({
                    ...errs,
                    WHATSAPP_NUMBER: digits.length > 0 && digits.length < 10 ? "Mobile number must be 10 digits" : ""
                  }));
                }}
                className={`${styles.input}${errors.WHATSAPP_NUMBER ? ` ${styles.inputError}` : ""}`}
                placeholder="9876543210"
                inputMode="numeric"
              />
              {errors.WHATSAPP_NUMBER && <div className={styles.errorMsg}>{errors.WHATSAPP_NUMBER}</div>}
            </FormField>
            <FormField label="Website" span={2}>
              <input type="text" value={form.WEBSITE} onChange={set("WEBSITE")} className={styles.input} placeholder="https://www.example.com" />
            </FormField>
          </div>

          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingGreen}`}>
            Address
          </div>

          <div className={styles.grid4}>
            <FormField label="Address (Street)" span={4}>
              <input type="text" value={form.ADDRESS} onChange={set("ADDRESS")} className={styles.input} placeholder="Plot 12, Industrial Estate" />
            </FormField>
            <FormField label="City">
              <input type="text" value={form.CITY} onChange={set("CITY")} className={styles.input} placeholder="Chennai" />
            </FormField>
            <FormField label="State">
              <input type="text" value={form.STATE} onChange={set("STATE")} className={styles.input} />
            </FormField>
            <FormField label="Pincode">
              <input type="text" value={form.PINCODE} onChange={set("PINCODE")} className={styles.input} placeholder="600001" />
            </FormField>
            <FormField label="Country">
              <input type="text" value={form.COUNTRY} onChange={set("COUNTRY")} className={styles.input} />
            </FormField>
            <FormField label="Billing Address (if different)" span={4}>
              <textarea
                rows={2}
                value={form.BILLING_ADDRESS}
                onChange={set("BILLING_ADDRESS")}
                className={styles.input}
                placeholder="Leave blank if same as the street address above"
              />
            </FormField>
            <FormField label="Shipping Address (if different)" span={4}>
              <textarea
                rows={2}
                value={form.SHIPPING_ADDRESS}
                onChange={set("SHIPPING_ADDRESS")}
                className={styles.input}
                placeholder="Where the machine actually gets installed"
              />
            </FormField>
            <FormField label="Google Maps Location URL" span={4}>
              <input
                type="text"
                value={form.GOOGLE_MAP_LOCATION}
                onChange={set("GOOGLE_MAP_LOCATION")}
                className={styles.input}
                placeholder="https://maps.app.goo.gl/..."
              />
            </FormField>
          </div>

          {/* Business profile */}
          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingGray}`}>
            Business profile
          </div>

          <div className={styles.grid2}>
            <FormField label="Business Type">
              <input
                type="text"
                value={form.BUSINESS_TYPE}
                onChange={set("BUSINESS_TYPE")}
                className={styles.input}
                placeholder="B2B Retail Chain / Hospital Network / ..."
              />
            </FormField>
            <FormField label="Current Vendor (if any)">
              <input
                type="text"
                value={form.CURRENT_VENDOR_NAME}
                onChange={set("CURRENT_VENDOR_NAME")}
                className={styles.input}
                placeholder="Their existing supplier name"
              />
            </FormField>
            <FormField label="Number of Branches">
              <input
                type="number"
                min="0"
                value={form.NUMBER_OF_BRANCHES}
                onChange={set("NUMBER_OF_BRANCHES")}
                className={styles.input}
                placeholder="e.g. 12"
              />
            </FormField>
            <FormField label="Expected Monthly Orders">
              <input
                type="number"
                min="0"
                value={form.EXPECTED_MONTHLY_ORDERS}
                onChange={set("EXPECTED_MONTHLY_ORDERS")}
                className={styles.input}
                placeholder="e.g. 3 units/month"
              />
            </FormField>
            <FormField label="Already using vending machines?" span={2}>
              <label className={styles.checkboxRow}>
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

          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingPurple}`}>
            Tax / KYC
          </div>

          <div className={styles.grid2}>
            <FormField label="GST Number">
              <input
                type="text"
                value={form.GST_NUMBER}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().slice(0, 15);
                  const GST_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
                  let msg = "";
                  if (val.length > 0 && val.length < 15) msg = `${val.length}/15 chars — format: 33ABCDE1234F1Z5`;
                  else if (val.length === 15 && !GST_RE.test(val)) msg = "Invalid GST format — e.g. 33ABCDE1234F1Z5";
                  setForm((f) => ({ ...f, GST_NUMBER: val }));
                  setErrors((errs) => ({ ...errs, GST_NUMBER: msg }));
                }}
                className={`${styles.input}${errors.GST_NUMBER ? ` ${styles.inputError}` : ""}`}
                placeholder="33ABCDE1234F1Z5"
              />
              {errors.GST_NUMBER && <div className={styles.errorMsg}>{errors.GST_NUMBER}</div>}
            </FormField>
            <FormField label="PAN Number">
              <input
                type="text"
                value={form.PAN_NUMBER}
                onChange={(e) => {
                  const val = e.target.value.toUpperCase().slice(0, 10);
                  const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
                  let msg = "";
                  if (val.length > 0 && val.length < 10) msg = `${val.length}/10 chars — format: ABCDE1234F`;
                  else if (val.length === 10 && !PAN_RE.test(val)) msg = "Invalid PAN format — e.g. ABCDE1234F";
                  setForm((f) => ({ ...f, PAN_NUMBER: val }));
                  setErrors((errs) => ({ ...errs, PAN_NUMBER: msg }));
                }}
                className={`${styles.input}${errors.PAN_NUMBER ? ` ${styles.inputError}` : ""}`}
                placeholder="ABCDE1234F"
              />
              {errors.PAN_NUMBER && <div className={styles.errorMsg}>{errors.PAN_NUMBER}</div>}
            </FormField>
          </div>

          {/* Requirements (edit mode only) */}
          {isEdit && (
            <div className={styles.subSection}>
              <RequirementsManager customerId={initial.ID} />
            </div>
          )}

          {/* Quotations for this customer */}
          {isEdit && (
            <div className={styles.subSection}>
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
            <div className={styles.saveHintBox}>
              Save this customer first &mdash; once created, you can add a
              full list of vending-machine requirements with quantities,
              specs and target dates.
            </div>
          )}

          <div className={`${styles.formSectionHeading} ${styles.formSectionHeadingAmber}`}>
            Lifecycle
          </div>

          <div className={styles.grid2}>
            <FormField label="Status">
              <select value={form.STATUS} onChange={set("STATUS")} className={styles.input}>
                <option value="ACTIVE">Active</option>
                <option value="PROSPECT">Prospect</option>
                <option value="LEAD">Lead</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </FormField>

            <FormField label="Source">
              <select value={form.SOURCE} onChange={set("SOURCE")} className={styles.input}>
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
                className={styles.input}
                style={{ resize: "vertical" }}
                placeholder="Anything we should remember about this customer..."
              />
            </FormField>
          </div>

          <div className={styles.formActions}>

            <button
              type="button"
              onClick={onClose}
              className={styles.btnCancel}
            >
              Cancel
            </button>

            <button
              type="submit"
              disabled={saving}
              className={styles.btnSubmit}
            >
              {saving
                ? "Saving…"
                : isEdit
                  ? "Save changes"
                  : "Create customer"}
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

    <div className={styles.pageWrapper}>

      {/* HERO */}
      <div className={styles.hero}>
        <div>
          <div className={styles.heroLabel}>
            CRM
          </div>
          <h1 className={styles.heroTitle}>
            Customers
          </h1>
        </div>

        <div className={styles.heroActions}>
          <button
            onClick={() => setInviteOpen(true)}
            title="Generate a self-onboarding link for a new customer"
            className={styles.heroBtnOutline}
          >
            Invite via Self-Onboarding
          </button>

          <button
            onClick={() => setEditing({})}
            className={styles.heroBtnSolid}
          >
            + Add Customer
          </button>
        </div>
      </div>

      {inviteOpen && (
        <InviteCustomerModal onClose={() => setInviteOpen(false)} />
      )}

      {/* Summary tiles */}
      <div className={styles.statsGrid}>
        <StatTile
          label="Total customers"
          value={stats.total}
          color="#0f172a"
          icon={<Icon.users size={22} />}
        />
        <StatTile
          label="Active"
          value={stats.active}
          sub="receiving orders"
          color="#059669"
          icon={<Icon.check size={22} />}
        />
        <StatTile
          label="Prospects + leads"
          value={stats.prospects}
          sub="in the pipeline"
          color="#B47900"
          icon={<Icon.trending size={22} />}
        />
        <StatTile
          label="With GST"
          value={stats.withGst}
          sub="invoice-ready"
          color="#1d4ed8"
          icon={<Icon.receipt size={22} />}
        />
      </div>

      {/* Search + filters */}
      <div className={styles.filterBar}>

        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>
            <Icon.search size={16} />
          </span>
          <input
            type="text"
            placeholder="Search by name, code, contact, phone, GST, city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <select
          value={industryFilter}
          onChange={(e) => setIndustryFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All industries</option>
          {INDUSTRIES.map((i) => (
            <option key={i}>{i}</option>
          ))}
        </select>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className={styles.filterSelect}
        >
          <option value="">All statuses</option>
          <option value="ACTIVE">Active</option>
          <option value="PROSPECT">Prospect</option>
          <option value="LEAD">Lead</option>
          <option value="INACTIVE">Inactive</option>
        </select>

        <div className={styles.filterCount}>
          {filtered.length} of {customers.length}
        </div>
      </div>

      {/* Cards */}
      {loading && (
        <div className={styles.loadingMsg}>
          Loading customers…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          {customers.length === 0
            ? "No customers yet. Click + Add Customer to create the first one."
            : "No customers match these filters."}
        </div>
      )}

      <div className={styles.cardsGrid}>
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
    <div onClick={onClose} className={styles.fullModalOverlay}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.fullModal}
      >

        {/* Sticky header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalHeaderLabel}>
              AUTO QUOTATION
            </div>
            <h2 className={styles.modalHeaderTitle}>
              Generate Quotation — auto from requirements
            </h2>
          </div>
          <button onClick={onClose} className={styles.modalCloseBtn}>
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>

          {/* Customer header card */}
          <div className={styles.quotModalCustCard}>
            <div className={styles.quotModalAvatar}>
              {(customer?.CUSTOMER_NAME || "?").charAt(0).toUpperCase()}
            </div>
            <div className={styles.reqItemBody}>
              <div className={styles.quotModalCustLabel}>
                CUSTOMER
              </div>
              <div className={styles.quotModalCustName}>
                {customer?.CUSTOMER_NAME || "—"}
              </div>
              <div className={styles.quotModalCustCode}>
                {customer?.CUSTOMER_CODE || "—"}
                {customer?.EMAIL ? ` · ${customer.EMAIL}` : ""}
              </div>
            </div>
          </div>

          {!result && (
            <>
              {error && !noRequirements && (
                <div className={styles.errBannerRed}>
                  {error}
                </div>
              )}

              {error && noRequirements && (
                <div className={styles.errBannerOrange}>
                  <div className={styles.errBannerOrangeTitle}>
                    This customer has no active requirements yet
                  </div>
                  <div style={{ marginBottom: 10 }}>
                    A quotation needs at least one requirement (which
                    vending machine, how many). Click below to open the
                    customer&apos;s profile and add one &mdash; then come back here
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
                    className={styles.errOpenCustBtn}
                  >
                    Open customer &rarr; Add a requirement
                  </button>
                </div>
              )}

              <form onSubmit={submit}>

                <div className={styles.quotFormGrid}>
                  <Field label="Quotation date">
                    <input
                      type="date"
                      value={form.quotation_date}
                      onChange={setField("quotation_date")}
                      className={styles.inviteInput}
                    />
                  </Field>

                  <Field label="Validity (days)">
                    <input
                      type="number"
                      min="1"
                      value={form.validity_days}
                      onChange={setField("validity_days")}
                      className={styles.inviteInput}
                    />
                  </Field>

                  <Field label="Margin % (BOM-based pricing)">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.margin_percent}
                      onChange={setField("margin_percent")}
                      className={styles.inviteInput}
                    />
                  </Field>

                  <Field label="Discount %">
                    <input
                      type="number"
                      min="0"
                      step="0.1"
                      value={form.discount_percent}
                      onChange={setField("discount_percent")}
                      className={styles.inviteInput}
                    />
                  </Field>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <label className={styles.fieldAtomLabel}>
                    Notes (optional)
                  </label>
                  <textarea
                    value={form.notes}
                    onChange={setField("notes")}
                    rows={2}
                    placeholder="Anything special the customer should know…"
                    className={styles.inviteInput}
                    style={{ resize: "vertical" }}
                  />
                </div>

                <label className={styles.autoSendRow}>
                  <input
                    type="checkbox"
                    checked={form.auto_send}
                    onChange={setField("auto_send")}
                    style={{ width: 18, height: 18 }}
                  />
                  <div>
                    <div className={styles.autoSendTitle}>
                      Auto-send email to customer
                    </div>
                    <div className={styles.autoSendSub}>
                      Quotation goes out the moment it&apos;s generated. Uncheck
                      to keep it as a DRAFT for review.
                    </div>
                  </div>
                </label>

                {/* What will be auto-filled callout */}
                <div className={styles.autoFillCallout}>
                  <div className={styles.autoFillCalloutLabel}>
                    WHAT WILL BE AUTO-FILLED
                  </div>
                  <ul className={styles.autoFillCalloutList}>
                    <li>Company details, contact, GST &amp; address</li>
                    <li>All active requirements as line items</li>
                    <li>BOM-based pricing with {form.margin_percent || 25}% margin</li>
                    <li>GST 18% &amp; standard payment terms</li>
                    <li>12-month warranty &amp; delivery terms</li>
                  </ul>
                </div>

                <div className={styles.modalFormActions}>
                  <button
                    type="button"
                    onClick={onClose}
                    className={styles.modalCancelBtn}
                  >
                    Cancel
                  </button>

                  <button
                    type="submit"
                    disabled={submitting}
                    className={styles.modalSubmitBtn}
                  >
                    {submitting ? "Generating…" : "Generate quotation"}
                  </button>
                </div>
              </form>
            </>
          )}

          {result && (
            <div className={styles.quotSuccessPanel}>
              <div className={styles.quotSuccessLabel}>
                QUOTATION GENERATED
              </div>

              <div className={styles.quotSuccessNumber}>
                {result.quotation_number || "—"} generated
              </div>

              <div className={styles.quotSuccessMeta}>
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
                <div className={styles.quotEmailedBadge}>
                  Emailed to {customer?.EMAIL || "customer"}
                </div>
              )}

              {!result.email_sent && form.auto_send && (
                <div className={styles.quotEmailFailBanner}>
                  Email could not be sent
                  {result.email_status ? `: ${result.email_status}` : ""}.
                  Quotation kept as DRAFT &mdash; you can retry from the
                  Quotations page.
                </div>
              )}

              {result.warnings && result.warnings.length > 0 && (
                <div className={styles.quotWarnPanel}>
                  <div className={styles.quotWarnLabel}>
                    WARNINGS
                  </div>
                  <ul className={styles.quotWarnList}>
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              <div className={styles.quotSuccessActions}>
                <button
                  onClick={() => {
                    navigate("/quotations");
                    onCreated?.(result.quotation_id);
                  }}
                  className={styles.quotOpenBtn}
                >
                  Open Quotation →
                </button>

                {result.public_url && (
                  <button
                    onClick={copyPublicLink}
                    className={linkCopied ? styles.quotCopyBtnCopied : styles.quotCopyBtn}
                  >
                    {linkCopied ? "Copied" : "Copy public link"}
                  </button>
                )}

                <button
                  onClick={onClose}
                  className={styles.quotCloseBtn}
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
    <div onClick={onClose} className={styles.fullModalOverlay}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.fullModalWide}
      >

        {/* Sticky header */}
        <div className={styles.modalHeader}>
          <div>
            <div className={styles.modalHeaderLabel}>
              CUSTOMER SELF-ONBOARDING
            </div>
            <h2 className={styles.modalHeaderTitle}>
              Invite customer to fill their own profile
            </h2>
          </div>
          <button onClick={onClose} className={styles.modalCloseBtn}>
            ×
          </button>
        </div>

        {/* Body */}
        <div className={styles.modalBody}>

          <p className={styles.inviteBody}>
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
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={loading}
                style={{
                  padding: "11px 22px",
                  background: "#ef4444",
                  color: "white", border: "none",
                  borderRadius: 10, fontWeight: 800, fontSize: 13,
                  cursor: loading ? "wait" : "pointer",
                  boxShadow: "0 6px 18px rgba(200,16,46,0.35)"
                }}
              >
                {loading ? "Generating…" : "Generate invitation link"}
              </button>
            </form>
          )}

          {result && (
            <div style={{
              background: "#fffbeb",
              border: "1px solid #f59e0b",
              borderRadius: 12,
              padding: "16px 18px",
              marginBottom: 16
            }}>
              <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: 1.5, color: "#8B4500", marginBottom: 8 }}>
                INVITATION CREATED
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
                  {copied ? "Copied" : "Copy link"}
                </button>
                <a
                  href={result.portal_url}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    padding: "8px 14px",
                    background: "#ef4444",
                    color: "white", border: "none",
                    borderRadius: 8, fontWeight: 700, fontSize: 12,
                    textDecoration: "none",
                    display: "inline-block"
                  }}
                >
                  Open in new tab &rarr;
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
                  Generate another
                </button>
              </div>
              {result.email_sent && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#166534" }}>
                  Invitation email also sent to <b>{result.session.EMAIL_HINT}</b>
                </div>
              )}
              {result.email_message && !result.email_sent && result.session?.EMAIL_HINT && (
                <div style={{ marginTop: 10, fontSize: 11, color: "#854d0e" }}>
                  Email not sent: {result.email_message}
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
                Refresh
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
                        ? new Date(p.SUBMITTED_AT).toLocaleDateString("en-IN")
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
                        fontWeight: 700,
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 4
                      }}
                    >
                      <Icon.trash size={11} />
                      Delete
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
    INVITED: { bg: "#f1f5f9", fg: "#475569" },
    REGISTERED: { bg: "#dbeafe", fg: "#1d4ed8" },
    IN_PROGRESS: { bg: "#fef3c7", fg: "#854d0e" },
    SUBMITTED: { bg: "#dcfce7", fg: "#166534" }
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
