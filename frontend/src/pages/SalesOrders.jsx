import { useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./SalesOrders.module.css";


// ===================================================================
// SalesOrders — Phase 5. Contract that follows an APPROVED quotation
// and drives the manufacturing workflow. Each SO line auto-spawns a
// Project when production starts.
// ===================================================================


const STATUS_THEME = {
  DRAFT:             { bg: "#f1f5f9", fg: "#475569", icon: "📝" },
  AWAITING_ADVANCE:  { bg: "#fef3c7", fg: "#a16207", icon: "⏳" },
  CONFIRMED:         { bg: "#dbeafe", fg: "#1d4ed8", icon: "✅" },
  IN_PRODUCTION:     { bg: "#fde68a", fg: "#854d0e", icon: "🏭" },
  SHIPPED:           { bg: "#e0e7ff", fg: "#4338ca", icon: "🚚" },
  DELIVERED:         { bg: "#dcfce7", fg: "#166534", icon: "📦" },
  CLOSED:            { bg: "#cffafe", fg: "#155e75", icon: "🎉" },
  CANCELLED:         { bg: "#fee2e2", fg: "#991b1b", icon: "❌" }
};


function StatusPill({ status }) {

  const t = STATUS_THEME[status] || STATUS_THEME.DRAFT;

  return (
    <span
      className={styles.statusPill}
      style={{ background: t.bg, color: t.fg }}
    >
      {t.icon} {String(status || "").replace(/_/g, " ")}
    </span>
  );
}


/* inputStyle removed — replaced by styles.input CSS module class */


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}


// =================================================================
// SO Editor (create) / Detail (view)
// =================================================================

function SOEditor({ soId, onClose, onSaved }) {

  const isEdit = !!soId;

  const [so, setSo] = useState(null);

  const [loading, setLoading] = useState(isEdit);

  const [customers, setCustomers] = useState([]);

  const [products, setProducts] = useState([]);

  const [employees, setEmployees] = useState([]);

  // Default advance-due = SO_DATE + 7 days
  const today = new Date();
  const defaultAdvanceDue = new Date(today);
  defaultAdvanceDue.setDate(today.getDate() + 7);

  const [draft, setDraft] = useState({
    CUSTOMER_ID: "",
    SO_DATE: today.toISOString().slice(0, 10),
    EXPECTED_DELIVERY_DATE: "",
    ADVANCE_DUE_DATE: defaultAdvanceDue.toISOString().slice(0, 10),
    DISCOUNT_PERCENT: 0,
    TAX_PERCENT: 18,
    ADVANCE_PERCENT: 50,
    DISPATCH_PERCENT: 40,
    INSTALLATION_PERCENT: 10,
    PREPARED_BY: "",
    SHIPPING_ADDRESS: "",
    BILLING_ADDRESS: "",
    TERMS_AND_CONDITIONS:
      "1. Payment as per milestones above.\n" +
      "2. Delivery period from advance receipt.\n" +
      "3. Warranty: 12 months from installation.\n" +
      "4. Installation included at customer site.",
    NOTES: "",
    LINES: []
  });

  const loadSO = () => {

    if (!isEdit) { setLoading(false); return; }

    setLoading(true);

    API.get(`/sales-orders/${soId}`)
      .then((r) => setSo(r.data))
      .catch((e) => alert(e?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    loadSO();

    if (!isEdit) {

      API.get("/customers").then((r) => setCustomers(r.data || []));

      API.get("/production/models?vendor_id=1").then((r) => setProducts(r.data || []));

      API.get("/employees?status=ACTIVE").then((r) => setEmployees(r.data || []));
    }

  }, [soId]);

  // ============ CREATE FLOW ============
  if (!isEdit) {

    const addLine = () =>
      setDraft((d) => ({
        ...d,
        LINES: [...d.LINES, {
          DESCRIPTION: "",
          PRODUCT_MODEL_ID: "",
          HSN_CODE: "",
          QUANTITY: 1,
          UNIT: "nos",
          UNIT_PRICE: 0,
          DISCOUNT_PERCENT: 0
        }]
      }));

    const updateLine = (idx, field, value) =>
      setDraft((d) => ({
        ...d,
        LINES: d.LINES.map((l, i) => i === idx ? { ...l, [field]: value } : l)
      }));

    const removeLine = (idx) =>
      setDraft((d) => ({ ...d, LINES: d.LINES.filter((_, i) => i !== idx) }));

    const subtotal = draft.LINES.reduce(
      (s, l) => s + (Number(l.QUANTITY) || 0) * (Number(l.UNIT_PRICE) || 0)
                  * (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100),
      0
    );

    const discountAmount = subtotal * (Number(draft.DISCOUNT_PERCENT) || 0) / 100;

    const taxable = subtotal - discountAmount;

    const taxAmount = taxable * (Number(draft.TAX_PERCENT) || 0) / 100;

    const grandTotal = taxable + taxAmount;

    const payTotal = (Number(draft.ADVANCE_PERCENT) || 0)
                   + (Number(draft.DISPATCH_PERCENT) || 0)
                   + (Number(draft.INSTALLATION_PERCENT) || 0);

    const save = async () => {

      if (!draft.CUSTOMER_ID) { alert("Pick a customer"); return; }

      if (draft.LINES.length === 0) { alert("Add at least one line"); return; }

      if (Math.abs(payTotal - 100) > 0.01) {

        alert(`Payment milestones must sum to 100% (currently ${payTotal}%)`);

        return;
      }

      try {

        const payload = {
          ...draft,
          CUSTOMER_ID: Number(draft.CUSTOMER_ID),
          DISCOUNT_PERCENT: Number(draft.DISCOUNT_PERCENT) || 0,
          TAX_PERCENT: Number(draft.TAX_PERCENT) || 0,
          ADVANCE_PERCENT: Number(draft.ADVANCE_PERCENT) || 0,
          DISPATCH_PERCENT: Number(draft.DISPATCH_PERCENT) || 0,
          INSTALLATION_PERCENT: Number(draft.INSTALLATION_PERCENT) || 0,
          LINES: draft.LINES.map((l, idx) => ({
            ...l,
            PRODUCT_MODEL_ID: l.PRODUCT_MODEL_ID ? Number(l.PRODUCT_MODEL_ID) : null,
            QUANTITY: Number(l.QUANTITY) || 1,
            UNIT_PRICE: Number(l.UNIT_PRICE) || 0,
            DISCOUNT_PERCENT: Number(l.DISCOUNT_PERCENT) || 0,
            SORT_ORDER: idx
          }))
        };

        const res = await API.post("/sales-orders", payload);

        onSaved?.(res.data?.sales_order?.ID);

      } catch (err) {

        alert(err?.response?.data?.detail || "Failed to save");
      }
    };

    return (
      <ModalShell title="✨ New Sales Order" onClose={onClose} wide>

        <div className={styles.formGrid3}>
          <Field label="Customer *">
            <select value={draft.CUSTOMER_ID} onChange={(e) => setDraft({ ...draft, CUSTOMER_ID: e.target.value })} className={styles.input}>
              <option value="">— pick customer —</option>
              {customers.map((c) => (
                <option key={c.ID} value={c.ID}>{c.CUSTOMER_NAME} ({c.CUSTOMER_CODE})</option>
              ))}
            </select>
          </Field>
          <Field label="SO Date">
            <input type="date" value={draft.SO_DATE} onChange={(e) => setDraft({ ...draft, SO_DATE: e.target.value })} className={styles.input} />
          </Field>
          <Field label="Expected Delivery">
            <input type="date" value={draft.EXPECTED_DELIVERY_DATE} onChange={(e) => setDraft({ ...draft, EXPECTED_DELIVERY_DATE: e.target.value })} className={styles.input} />
          </Field>
          <Field label="Advance Due Date *">
            <input
              type="date"
              value={draft.ADVANCE_DUE_DATE}
              onChange={(e) => setDraft({ ...draft, ADVANCE_DUE_DATE: e.target.value })}
              className={styles.input}
            />
          </Field>
          <Field label="Prepared By">
            <select value={draft.PREPARED_BY} onChange={(e) => setDraft({ ...draft, PREPARED_BY: e.target.value })} className={styles.input}>
              <option value="">— pick salesperson —</option>
              {employees.map((emp) => (<option key={emp.ID} value={emp.ID}>{emp.NAME}</option>))}
            </select>
          </Field>
          <Field label="GST %">
            <input type="number" min="0" value={draft.TAX_PERCENT} onChange={(e) => setDraft({ ...draft, TAX_PERCENT: e.target.value })} className={styles.input} />
          </Field>
          <Field label="Discount %">
            <input type="number" min="0" value={draft.DISCOUNT_PERCENT} onChange={(e) => setDraft({ ...draft, DISCOUNT_PERCENT: e.target.value })} className={styles.input} />
          </Field>
        </div>

        {/* Payment milestones */}
        <div className={styles.milestonesBlock}>
          <div className={styles.milestonesTitle}>
            💰 PAYMENT MILESTONES (must sum to 100%)
          </div>
          <div className={styles.milestonesGrid}>
            <Field label="Advance %">
              <input type="number" min="0" max="100" value={draft.ADVANCE_PERCENT} onChange={(e) => setDraft({ ...draft, ADVANCE_PERCENT: e.target.value })} className={styles.input} />
            </Field>
            <Field label="On Dispatch %">
              <input type="number" min="0" max="100" value={draft.DISPATCH_PERCENT} onChange={(e) => setDraft({ ...draft, DISPATCH_PERCENT: e.target.value })} className={styles.input} />
            </Field>
            <Field label="On Installation %">
              <input type="number" min="0" max="100" value={draft.INSTALLATION_PERCENT} onChange={(e) => setDraft({ ...draft, INSTALLATION_PERCENT: e.target.value })} className={styles.input} />
            </Field>
          </div>
          <div
            className={styles.milestonesTotal}
            style={{ color: Math.abs(payTotal - 100) < 0.01 ? "var(--success)" : "var(--danger)" }}
          >
            Total: {payTotal}% {Math.abs(payTotal - 100) < 0.01 ? "✓" : "⚠ should be 100"}
          </div>
        </div>

        {/* Lines */}
        <div className={styles.lineItemsHeader}>
          <div className={styles.sectionTitle}>
            📦 LINE ITEMS
          </div>
          <button type="button" onClick={addLine} className={styles.btnPrimarySmall}>
            ➕ Add Line
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Description</th>
                <th style={{ width: 180 }}>Product Model</th>
                <th style={{ width: 70 }}>HSN</th>
                <th style={{ width: 70 }}>Qty</th>
                <th style={{ width: 110 }}>Unit Price</th>
                <th style={{ width: 70 }}>Disc%</th>
                <th style={{ width: 110, textAlign: "right" }}>Total</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              {draft.LINES.length === 0 && (
                <tr className={styles.tableEmptyRow}><td colSpan="9">No lines yet.</td></tr>
              )}
              {draft.LINES.map((l, idx) => {

                const lineTotal = (Number(l.QUANTITY) || 0) * (Number(l.UNIT_PRICE) || 0) * (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100);

                return (
                  <tr key={idx} className={styles.tableBodyRow}>
                    <td>{idx + 1}</td>
                    <td><input type="text" value={l.DESCRIPTION} onChange={(e) => updateLine(idx, "DESCRIPTION", e.target.value)} className={styles.input} /></td>
                    <td>
                      <select value={l.PRODUCT_MODEL_ID} onChange={(e) => {
                        updateLine(idx, "PRODUCT_MODEL_ID", e.target.value);
                        const p = products.find((x) => String(x.ID) === String(e.target.value));
                        if (p && !l.DESCRIPTION) updateLine(idx, "DESCRIPTION", `${p.MODEL_NAME} (${p.MODEL_CODE})`);
                      }} className={styles.input}>
                        <option value="">— pick product —</option>
                        {products.map((p) => (<option key={p.ID} value={p.ID}>{p.MODEL_CODE}</option>))}
                      </select>
                    </td>
                    <td><input type="text" value={l.HSN_CODE} onChange={(e) => updateLine(idx, "HSN_CODE", e.target.value)} className={styles.input} /></td>
                    <td><input type="number" min="0" step="0.01" value={l.QUANTITY} onChange={(e) => updateLine(idx, "QUANTITY", e.target.value)} className={styles.input} /></td>
                    <td><input type="number" min="0" step="0.01" value={l.UNIT_PRICE} onChange={(e) => updateLine(idx, "UNIT_PRICE", e.target.value)} className={styles.input} /></td>
                    <td><input type="number" min="0" step="0.1" value={l.DISCOUNT_PERCENT} onChange={(e) => updateLine(idx, "DISCOUNT_PERCENT", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tableCellRight}>{inr(lineTotal)}</td>
                    <td>
                      <button type="button" onClick={() => removeLine(idx)} className={styles.btnRemoveLine}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className={styles.totalsWrap}>
          <div className={styles.totalsBox}>
            <TotalRow label="Subtotal" value={subtotal} />
            <TotalRow label={`Discount (${draft.DISCOUNT_PERCENT || 0}%)`} value={-discountAmount} />
            <TotalRow label={`GST (${draft.TAX_PERCENT || 0}%)`} value={taxAmount} />
            <div className={styles.totalsDivider}>
              <TotalRow label="Grand Total" value={grandTotal} bold large />
            </div>
          </div>
        </div>

        <Field label="Terms & Conditions">
          <textarea rows={4} value={draft.TERMS_AND_CONDITIONS} onChange={(e) => setDraft({ ...draft, TERMS_AND_CONDITIONS: e.target.value })} className={`${styles.input} ${styles.inputTextarea}`} />
        </Field>

        <Field label="Notes">
          <textarea rows={2} value={draft.NOTES} onChange={(e) => setDraft({ ...draft, NOTES: e.target.value })} className={`${styles.input} ${styles.inputTextarea}`} />
        </Field>

        <div className={styles.detailFooter}>
          <button type="button" onClick={onClose} className={styles.btnSecondary}>Cancel</button>
          <button type="button" onClick={save} className={styles.btnPrimary}>
            ✨ Create Sales Order
          </button>
        </div>

      </ModalShell>
    );
  }

  // ============ DETAIL FLOW ============
  if (loading) return <ModalShell title="Loading…" onClose={onClose}><div className={styles.modalCenterMsg}>Loading…</div></ModalShell>;

  if (!so) return <ModalShell title="Not found" onClose={onClose}><div className={styles.modalCenterMsg}>SO not found</div></ModalShell>;

  return <SODetail so={so} onClose={onClose} onChanged={() => { loadSO(); onSaved?.(); }} />;
}


// =================================================================
// Detail with workflow buttons
// =================================================================
function SODetail({ so, onClose, onChanged }) {

  const [activity, setActivity] = useState([]);

  const [paymentDraft, setPaymentDraft] = useState({ open: false, milestone: "ADVANCE", amount: 0, notes: "" });

  const loadActivity = () => {

    API.get(`/sales-orders/${so.ID}/activity`)
      .then((r) => setActivity(r.data || []))
      .catch(() => setActivity([]));
  };

  useEffect(() => { loadActivity(); }, [so.ID, so.STATUS]);

  const action = async (path, body = {}, confirmMsg) => {

    if (confirmMsg && !window.confirm(confirmMsg)) return;

    try {

      const res = await API.post(`/sales-orders/${so.ID}/${path}`, body);

      if (res?.data?.message) alert(res.data.message);

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed");
    }
  };

  const cancel = async () => {

    const reason = window.prompt("Cancellation reason (optional):");

    if (reason === null) return;

    action("cancel", { CANCEL_REASON: reason || "" });
  };

  const deleteSO = async () => {

    const isProtected = !["DRAFT", "CANCELLED"].includes(so.STATUS);

    const msg = isProtected
      ? `This SO is in status ${so.STATUS}. Deleting will REMOVE all its lines and activity (spawned projects stay intact). Continue?`
      : `Delete SO ${so.SO_NUMBER}? This removes its lines and activity. This cannot be undone.`;

    if (!window.confirm(msg)) return;

    try {

      const url = isProtected
        ? `/sales-orders/${so.ID}?force=true`
        : `/sales-orders/${so.ID}`;

      const res = await API.delete(url);

      alert(res?.data?.message || "Sales Order deleted");

      onClose?.();

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  const recordPayment = async () => {

    if (!paymentDraft.amount || Number(paymentDraft.amount) <= 0) {

      alert("Enter a positive amount");

      return;
    }

    try {

      await API.post(`/sales-orders/${so.ID}/payment`, {
        MILESTONE: paymentDraft.milestone,
        AMOUNT: Number(paymentDraft.amount),
        NOTES: paymentDraft.notes || null
      });

      setPaymentDraft({ open: false, milestone: "ADVANCE", amount: 0, notes: "" });

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed");
    }
  };

  const printNow = () => window.open(`/so-print/${so.ID}`, "_blank");

  return (
    <ModalShell title={`📑 ${so.SO_NUMBER}`} onClose={onClose} wide>

      {/* Action buttons */}
      <div className={styles.actionBtnRow}>
        <StatusPill status={so.STATUS} />

        {so.STATUS === "DRAFT" && (
          <ActionBtn color="#0ea5e9" onClick={() => action("confirm", {},
            "Send advance payment request to the customer? Status will become AWAITING_ADVANCE until the advance is received.")}
          >📤 Send Advance Request</ActionBtn>
        )}

        {so.STATUS === "AWAITING_ADVANCE" && (
          <ActionBtn color="#f59e0b" onClick={() => setPaymentDraft((d) => ({
            ...d,
            open: true,
            milestone: "ADVANCE",
            amount: Number((so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100).toFixed(2))
          }))}>
            💰 Record Advance Payment
          </ActionBtn>
        )}

        {so.STATUS === "CONFIRMED" && (
          <ActionBtn color="#f59e0b" onClick={() => action("start-production", {},
            "Start production? This will auto-spawn a Project for each line item with a product link.")}
          >🏭 Start Production</ActionBtn>
        )}

        {so.STATUS === "IN_PRODUCTION" && (
          <ActionBtn color="#6366f1" onClick={() => action("ship", {}, "Mark as SHIPPED?")}>
            🚚 Ship
          </ActionBtn>
        )}

        {so.STATUS === "SHIPPED" && (
          <ActionBtn color="#10b981" onClick={() => action("deliver", {}, "Mark as DELIVERED?")}>
            📦 Mark Delivered
          </ActionBtn>
        )}

        {(so.STATUS === "DELIVERED" || so.STATUS === "SHIPPED") && (
          <ActionBtn color="#0891b2" onClick={() => action("close", {}, "Close this SO? All payments should be received.")}>
            🎉 Close
          </ActionBtn>
        )}

        {!["CLOSED", "CANCELLED"].includes(so.STATUS) && (
          <ActionBtn color="#ef4444" onClick={() => setPaymentDraft((d) => ({ ...d, open: true }))}>
            💰 Record Payment
          </ActionBtn>
        )}

        <ActionBtn color="#6366f1" onClick={printNow}>🖨️ Print / PDF</ActionBtn>

        {!["CLOSED", "CANCELLED"].includes(so.STATUS) && (
          <ActionBtn color="#ef4444" onClick={cancel}>❌ Cancel</ActionBtn>
        )}

        <ActionBtn color="#7f1d1d" onClick={deleteSO}>🗑 Delete</ActionBtn>
      </div>

      {/* Header card */}
      <div className={styles.detailHeaderCard}>
        <InfoBlock label="Customer" value={so.CUSTOMER_NAME || `#${so.CUSTOMER_ID}`} sub={so.CUSTOMER_CODE} />
        <InfoBlock label="SO Date" value={so.SO_DATE} sub={`Expected: ${so.EXPECTED_DELIVERY_DATE || "—"}`} />
        <InfoBlock label="Advance Due" value={so.ADVANCE_DUE_DATE || "—"} sub={`${inr(so.ADVANCE_AMOUNT)} (${so.ADVANCE_PERCENT}%)`} />
        <InfoBlock label="From Quotation" value={so.QUOTATION_NUMBER || "—"} sub={so.PREPARED_BY_NAME ? `By: ${so.PREPARED_BY_NAME}` : ""} />
        <InfoBlock label="Phone / Email" value={so.CUSTOMER_PHONE || "—"} sub={so.CUSTOMER_EMAIL} />
        <InfoBlock label="Total Lines" value={so.LINES?.length || 0} />
      </div>

      {/* AWAITING_ADVANCE banner — prominent advance-due call-out */}
      {so.STATUS === "AWAITING_ADVANCE" && (
        <div className={styles.advanceBanner}>
          <div>
            <div className={styles.advanceBannerLabel}>
              💰 ADVANCE PAYMENT DUE
            </div>
            <div className={styles.advanceBannerAmount}>
              {inr(so.ADVANCE_AMOUNT)}
            </div>
            <div className={styles.advanceBannerSub}>
              {so.ADVANCE_PERCENT}% of {inr(so.GRAND_TOTAL)}
            </div>
          </div>
          <div>
            <div className={styles.advanceBannerDueLabel}>
              📅 DUE BY
            </div>
            <div className={styles.advanceBannerDueDate}>
              {so.ADVANCE_DUE_DATE || "—"}
            </div>
            <div className={styles.advanceBannerSub}>
              Received: {inr(so.ADVANCE_RECEIVED)}
            </div>
          </div>
          <div className={styles.advanceBannerNote}>
            Status will auto-flip to <b>CONFIRMED</b> once the advance is
            fully received and recorded here. Production can then be
            started.
          </div>
        </div>
      )}

      {/* Payment progress */}
      <div className={styles.paymentProgressCard}>
        <div className={styles.paymentProgressHeader}>
          <div className={styles.paymentProgressTitle}>
            💰 PAYMENT PROGRESS
          </div>
          <div className={styles.paymentProgressAmount}>
            {inr(so.PAYMENT_RECEIVED_TOTAL)} / {inr(so.GRAND_TOTAL)}
            <span className={styles.paymentProgressAmountMuted}>
              ({so.PAYMENT_PROGRESS_PCT}%)
            </span>
          </div>
        </div>
        <div className={styles.progressTrack}>
          <div className={styles.progressFill} style={{ width: `${Math.min(100, so.PAYMENT_PROGRESS_PCT || 0)}%` }} />
        </div>
        <div className={styles.paymentMilestonesGrid}>
          <PaymentMilestone label="Advance" percent={so.ADVANCE_PERCENT} expected={so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100} received={so.ADVANCE_RECEIVED} />
          <PaymentMilestone label="On Dispatch" percent={so.DISPATCH_PERCENT} expected={so.GRAND_TOTAL * so.DISPATCH_PERCENT / 100} received={so.DISPATCH_RECEIVED} />
          <PaymentMilestone label="On Installation" percent={so.INSTALLATION_PERCENT} expected={so.GRAND_TOTAL * so.INSTALLATION_PERCENT / 100} received={so.INSTALLATION_RECEIVED} />
        </div>
      </div>

      {/* Lines + spawned projects */}
      <div className={styles.detailLineItemsTitle}>
        📦 LINE ITEMS ({so.LINES?.length || 0})
      </div>

      <div className={styles.tableDetailWrap}>
        <table className={styles.table}>
          <thead className={styles.tableDetailHead}>
            <tr>
              <th style={{ width: 40 }}>#</th>
              <th>Description</th>
              <th style={{ width: 200 }}>Spawned Project</th>
              <th style={{ width: 60, textAlign: "right" }}>Qty</th>
              <th style={{ width: 120, textAlign: "right" }}>Unit Price</th>
              <th style={{ width: 130, textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody className={styles.tableDetailBody}>
            {(so.LINES || []).map((l, idx) => (
              <tr key={l.ID} className={styles.tableDetailBodyRow}>
                <td>{idx + 1}</td>
                <td>
                  <div>{l.DESCRIPTION}</div>
                  {l.PRODUCT_MODEL_CODE && (
                    <div className={styles.productModelCode}>
                      {l.PRODUCT_MODEL_CODE}
                    </div>
                  )}
                </td>
                <td>
                  {l.SPAWNED_PROJECT_ID ? (
                    <div>
                      <div className={styles.spawnedProject}>
                        ✓ Project #{l.SPAWNED_PROJECT_ID}
                      </div>
                      {l.SPAWNED_PROJECT_STATUS && (
                        <div className={styles.spawnedProjectStatus}>{l.SPAWNED_PROJECT_STATUS}</div>
                      )}
                    </div>
                  ) : (
                    <span className={styles.notSpawned}>not yet spawned</span>
                  )}
                </td>
                <td className={styles.tableCellRight}>{l.QUANTITY}</td>
                <td className={styles.tableCellRight}>{inr(l.UNIT_PRICE)}</td>
                <td className={styles.tableCellRightBold}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={styles.totalsWrap}>
        <div className={styles.totalsBoxDetail}>
          <TotalRow label="Subtotal" value={so.SUBTOTAL} />
          {so.DISCOUNT_PERCENT > 0 && <TotalRow label={`Discount (${so.DISCOUNT_PERCENT}%)`} value={-so.DISCOUNT_AMOUNT} />}
          <TotalRow label={`GST (${so.TAX_PERCENT}%)`} value={so.TAX_AMOUNT} />
          <div className={styles.totalsDivider}>
            <TotalRow label="Grand Total" value={so.GRAND_TOTAL} bold large />
          </div>
        </div>
      </div>

      {/* Activity */}
      {activity.length > 0 && (
        <div className={styles.activitySection}>
          <div className={styles.activityTitle}>
            📋 ACTIVITY TIMELINE
          </div>
          <div className={styles.activityList}>
            {activity.map((a, idx) => {
              const icons = {
                CREATED: "📝", AWAITING_ADVANCE: "⏳", CONFIRMED: "✅",
                EMAIL_SENT: "📧", EMAIL_FAILED: "⚠️",
                PROJECTS_SPAWNED: "🏭", PAYMENT_RECEIVED: "💰",
                SHIPPED: "🚚", DELIVERED: "📦", CLOSED: "🎉", CANCELLED: "❌"
              };
              return (
                <div key={a.ID} className={idx === 0 ? styles.activityItemFirst : styles.activityItem}>
                  <div className={styles.activityIcon}>{icons[a.EVENT_TYPE] || "•"}</div>
                  <div className={styles.activityContent}>
                    <div className={styles.activityEventType}>{a.EVENT_TYPE.replace(/_/g, " ")}</div>
                    {a.EVENT_DETAIL && <div className={styles.activityDetail}>{a.EVENT_DETAIL}</div>}
                    <div className={styles.activityTime}>{a.CREATED_AT && new Date(a.CREATED_AT).toLocaleString("en-IN")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {paymentDraft.open && (
        <div onClick={() => setPaymentDraft((d) => ({ ...d, open: false }))} className={styles.paymentModalBackdrop}>
          <div onClick={(e) => e.stopPropagation()} className={styles.paymentModalBox}>
            <div className={styles.paymentModalTitle}>
              💰 Record Payment
            </div>
            <Field label="Milestone">
              <select value={paymentDraft.milestone} onChange={(e) => setPaymentDraft({ ...paymentDraft, milestone: e.target.value })} className={styles.input}>
                <option value="ADVANCE">Advance ({so.ADVANCE_PERCENT}% = {inr(so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100)})</option>
                <option value="DISPATCH">On Dispatch ({so.DISPATCH_PERCENT}% = {inr(so.GRAND_TOTAL * so.DISPATCH_PERCENT / 100)})</option>
                <option value="INSTALLATION">On Installation ({so.INSTALLATION_PERCENT}% = {inr(so.GRAND_TOTAL * so.INSTALLATION_PERCENT / 100)})</option>
              </select>
            </Field>
            <div className={styles.paymentModalSpacer} />
            <Field label="Amount (₹)">
              <input type="number" min="0" step="0.01" value={paymentDraft.amount} onChange={(e) => setPaymentDraft({ ...paymentDraft, amount: e.target.value })} className={styles.input} />
            </Field>
            <div className={styles.paymentModalSpacer} />
            <Field label="Notes (transaction ref, etc.)">
              <textarea rows={2} value={paymentDraft.notes} onChange={(e) => setPaymentDraft({ ...paymentDraft, notes: e.target.value })} className={`${styles.input} ${styles.inputTextarea}`} />
            </Field>
            <div className={styles.paymentModalFooter}>
              <button onClick={() => setPaymentDraft((d) => ({ ...d, open: false }))} className={styles.btnSecondarySmall}>Cancel</button>
              <button onClick={recordPayment} className={styles.btnPrimary}>
                💾 Record
              </button>
            </div>
          </div>
        </div>
      )}

    </ModalShell>
  );
}


function PaymentMilestone({ label, percent, expected, received }) {

  const pct = expected > 0 ? Math.min(100, (received / expected) * 100) : 0;

  const done = pct >= 99.99;

  return (
    <div
      className={styles.milestoneTile}
      style={{
        background: done ? "#dcfce7" : "#fef3c7",
        border: `1px solid ${done ? "#86efac" : "#fcd34d"}`
      }}
    >
      <div className={styles.milestoneTileLabel}>
        {label} · {percent}%
      </div>
      <div
        className={styles.milestoneTileValue}
        style={{ color: done ? "#166534" : "#854d0e" }}
      >
        {inr(received)} / {inr(expected)}
      </div>
      <div className={styles.milestoneMiniTrack}>
        <div
          className={styles.milestoneMiniBar}
          style={{
            width: `${pct}%`,
            background: done ? "#10b981" : "#f59e0b"
          }}
        />
      </div>
    </div>
  );
}


// =================================================================
// Atoms
// =================================================================

function ModalShell({ title, onClose, children, wide }) {

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        className={wide ? styles.modalBoxWide : styles.modalBoxNarrow}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title}</div>
          <button onClick={onClose} className={styles.modalCloseBtn}>×</button>
        </div>
        <div className={styles.modalBody}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function TotalRow({ label, value, bold }) {
  return (
    <div className={bold ? styles.totalRowBold : styles.totalRow}>
      <span>{label}</span><span>{inr(value)}</span>
    </div>
  );
}

function InfoBlock({ label, value, sub }) {
  return (
    <div>
      <div className={styles.infoBlockLabel}>{label}</div>
      <div className={styles.infoBlockValue}>{value}</div>
      {sub && <div className={styles.infoBlockSub}>{sub}</div>}
    </div>
  );
}

function ActionBtn({ color, onClick, children }) {
  return (
    <button
      onClick={onClick}
      className={styles.actionBtn}
      style={{ background: color, boxShadow: `0 4px 12px ${color}55` }}
    >
      {children}
    </button>
  );
}


// =================================================================
// Main page
// =================================================================

function SalesOrders() {

  const [rows, setRows] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const [search, setSearch] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);

  const [editingId, setEditingId] = useState(null);

  const load = () => {

    setLoading(true);

    const params = statusFilter ? `?status=${statusFilter}` : "";

    API.get(`/sales-orders${params}`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = useMemo(() => {

    const s = search.trim().toLowerCase();

    if (!s) return rows;

    return rows.filter((r) =>
      (r.SO_NUMBER || "").toLowerCase().includes(s) ||
      (r.CUSTOMER_NAME || "").toLowerCase().includes(s) ||
      (r.CUSTOMER_CODE || "").toLowerCase().includes(s) ||
      (r.QUOTATION_NUMBER || "").toLowerCase().includes(s)
    );

  }, [rows, search]);

  const stats = useMemo(() => {

    const s = { total: rows.length, awaiting: 0, in_prod: 0, value: 0, delivered: 0 };

    rows.forEach((r) => {
      if (r.STATUS === "AWAITING_ADVANCE") s.awaiting++;
      if (r.STATUS === "IN_PRODUCTION") s.in_prod++;
      if (r.STATUS === "DELIVERED" || r.STATUS === "CLOSED") s.delivered++;
      s.value += r.GRAND_TOTAL || 0;
    });

    return s;

  }, [rows]);

  return (
    <div className={styles.page}>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📑 Sales Orders</h1>
          <div className={styles.pageSubtitle}>
            Approved quotation → confirmed contract → projects → delivery
          </div>
        </div>
        <button onClick={() => { setEditingId(null); setEditorOpen(true); }} className={styles.btnPrimary}>
          ✨ New Sales Order
        </button>
      </div>

      {/* Stats */}
      <div className={styles.statsGrid}>
        <StatTile label="Awaiting Advance" value={stats.awaiting} color="#f59e0b" />
        <StatTile label="In Production" value={stats.in_prod} color="#6366f1" />
        <StatTile label="Delivered + Closed" value={stats.delivered} color="#10b981" />
        <StatTile label="Total Order Value" value={inr(stats.value)} color="#ef4444" isText />
      </div>

      {/* Filters */}
      <div className={styles.filtersRow}>
        <input type="text" placeholder="🔍 Search by SO#, customer, quotation..." value={search} onChange={(e) => setSearch(e.target.value)} className={styles.inputSearch} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={styles.inputStatus}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="AWAITING_ADVANCE">Awaiting Advance</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="IN_PRODUCTION">In Production</option>
          <option value="SHIPPED">Shipped</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CLOSED">Closed</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {/* List */}
      {loading && <div className={styles.loadingState}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          No sales orders yet. Convert an APPROVED quotation or click <b>New Sales Order</b>.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.soList}>
          {filtered.map((r) => (
            <div key={r.ID} onClick={() => { setEditingId(r.ID); setEditorOpen(true); }} className={styles.soCard}>
              <div>
                <div className={styles.soNumber}>{r.SO_NUMBER}</div>
                <div className={styles.soDate}>{r.SO_DATE}</div>
              </div>
              <div>
                <div className={styles.soCustomer}>{r.CUSTOMER_NAME || `#${r.CUSTOMER_ID}`}</div>
                <div className={styles.soCustomerSub}>
                  {r.CUSTOMER_CODE}
                  {r.QUOTATION_NUMBER && ` · 📄 ${r.QUOTATION_NUMBER}`}
                </div>
              </div>
              <div>
                <div className={styles.soPaymentLabel}>Payment</div>
                <div className={styles.soPaymentValue}>
                  {r.PAYMENT_PROGRESS_PCT || 0}% received
                </div>
              </div>
              <div className={styles.soCardRight}>
                <div className={styles.soTotalLabel}>Total</div>
                <div className={styles.soTotalValue}>{inr(r.GRAND_TOTAL)}</div>
              </div>
              <div className={styles.soCardRight}>
                <StatusPill status={r.STATUS} />
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <SOEditor
          soId={editingId}
          onClose={() => { setEditorOpen(false); setEditingId(null); }}
          onSaved={() => { setEditorOpen(false); setEditingId(null); load(); }}
        />
      )}

    </div>
  );
}


function StatTile({ label, value, color, isText }) {
  return (
    <div className={styles.statTile} style={{ borderTop: `3px solid ${color}` }}>
      <div className={styles.statLabel}>{label}</div>
      <div className={isText ? styles.statValueText : styles.statValue}>{value}</div>
    </div>
  );
}


export default SalesOrders;
