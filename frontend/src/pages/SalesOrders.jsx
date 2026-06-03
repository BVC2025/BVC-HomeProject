import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


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
    <span style={{
      background: t.bg, color: t.fg,
      padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, letterSpacing: 0.8
    }}>
      {t.icon} {String(status || "").replace(/_/g, " ")}
    </span>
  );
}


function inputStyle() {

  return {
    width: "100%", padding: "9px 11px",
    border: "1px solid #cbd5e1", borderRadius: 8,
    fontSize: 13, fontFamily: "inherit", background: "white"
  };
}


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

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
          <Field label="Customer *">
            <select value={draft.CUSTOMER_ID} onChange={(e) => setDraft({ ...draft, CUSTOMER_ID: e.target.value })} style={inputStyle()}>
              <option value="">— pick customer —</option>
              {customers.map((c) => (
                <option key={c.ID} value={c.ID}>{c.CUSTOMER_NAME} ({c.CUSTOMER_CODE})</option>
              ))}
            </select>
          </Field>
          <Field label="SO Date">
            <input type="date" value={draft.SO_DATE} onChange={(e) => setDraft({ ...draft, SO_DATE: e.target.value })} style={inputStyle()} />
          </Field>
          <Field label="Expected Delivery">
            <input type="date" value={draft.EXPECTED_DELIVERY_DATE} onChange={(e) => setDraft({ ...draft, EXPECTED_DELIVERY_DATE: e.target.value })} style={inputStyle()} />
          </Field>
          <Field label="Advance Due Date *">
            <input
              type="date"
              value={draft.ADVANCE_DUE_DATE}
              onChange={(e) => setDraft({ ...draft, ADVANCE_DUE_DATE: e.target.value })}
              style={inputStyle()}
            />
          </Field>
          <Field label="Prepared By">
            <select value={draft.PREPARED_BY} onChange={(e) => setDraft({ ...draft, PREPARED_BY: e.target.value })} style={inputStyle()}>
              <option value="">— pick salesperson —</option>
              {employees.map((emp) => (<option key={emp.ID} value={emp.ID}>{emp.NAME}</option>))}
            </select>
          </Field>
          <Field label="GST %">
            <input type="number" min="0" value={draft.TAX_PERCENT} onChange={(e) => setDraft({ ...draft, TAX_PERCENT: e.target.value })} style={inputStyle()} />
          </Field>
          <Field label="Discount %">
            <input type="number" min="0" value={draft.DISCOUNT_PERCENT} onChange={(e) => setDraft({ ...draft, DISCOUNT_PERCENT: e.target.value })} style={inputStyle()} />
          </Field>
        </div>

        {/* Payment milestones */}
        <div style={{
          background: "linear-gradient(135deg,#fef2f2,#fff4e6)",
          border: "1px solid #fecaca",
          borderRadius: 10, padding: "12px 14px", marginBottom: 16
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#8B0B1F", letterSpacing: 1, marginBottom: 8 }}>
            💰 PAYMENT MILESTONES (must sum to 100%)
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10 }}>
            <Field label="Advance %">
              <input type="number" min="0" max="100" value={draft.ADVANCE_PERCENT} onChange={(e) => setDraft({ ...draft, ADVANCE_PERCENT: e.target.value })} style={inputStyle()} />
            </Field>
            <Field label="On Dispatch %">
              <input type="number" min="0" max="100" value={draft.DISPATCH_PERCENT} onChange={(e) => setDraft({ ...draft, DISPATCH_PERCENT: e.target.value })} style={inputStyle()} />
            </Field>
            <Field label="On Installation %">
              <input type="number" min="0" max="100" value={draft.INSTALLATION_PERCENT} onChange={(e) => setDraft({ ...draft, INSTALLATION_PERCENT: e.target.value })} style={inputStyle()} />
            </Field>
          </div>
          <div style={{
            marginTop: 6, fontSize: 11, fontWeight: 700,
            color: Math.abs(payTotal - 100) < 0.01 ? "#166534" : "#b91c1c"
          }}>
            Total: {payTotal}% {Math.abs(payTotal - 100) < 0.01 ? "✓" : "⚠ should be 100"}
          </div>
        </div>

        {/* Lines */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#C8102E", letterSpacing: 1 }}>
            📦 LINE ITEMS
          </div>
          <button type="button" onClick={addLine} style={{ border: "none", background: "linear-gradient(135deg,#C8102E,#8B0B1F)", color: "white", padding: "7px 14px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            ➕ Add Line
          </button>
        </div>

        <div style={{ marginBottom: 16, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
                <th style={{ padding: 8, width: 40 }}>#</th>
                <th style={{ padding: 8 }}>Description</th>
                <th style={{ padding: 8, width: 180 }}>Product Model</th>
                <th style={{ padding: 8, width: 70 }}>HSN</th>
                <th style={{ padding: 8, width: 70 }}>Qty</th>
                <th style={{ padding: 8, width: 110 }}>Unit Price</th>
                <th style={{ padding: 8, width: 70 }}>Disc%</th>
                <th style={{ padding: 8, width: 110, textAlign: "right" }}>Total</th>
                <th style={{ padding: 8, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {draft.LINES.length === 0 && (
                <tr><td colSpan="9" style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>No lines yet.</td></tr>
              )}
              {draft.LINES.map((l, idx) => {

                const lineTotal = (Number(l.QUANTITY) || 0) * (Number(l.UNIT_PRICE) || 0) * (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100);

                return (
                  <tr key={idx} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{idx + 1}</td>
                    <td style={{ padding: 6 }}><input type="text" value={l.DESCRIPTION} onChange={(e) => updateLine(idx, "DESCRIPTION", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}>
                      <select value={l.PRODUCT_MODEL_ID} onChange={(e) => {
                        updateLine(idx, "PRODUCT_MODEL_ID", e.target.value);
                        const p = products.find((x) => String(x.ID) === String(e.target.value));
                        if (p && !l.DESCRIPTION) updateLine(idx, "DESCRIPTION", `${p.MODEL_NAME} (${p.MODEL_CODE})`);
                      }} style={inputStyle()}>
                        <option value="">— pick product —</option>
                        {products.map((p) => (<option key={p.ID} value={p.ID}>{p.MODEL_CODE}</option>))}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}><input type="text" value={l.HSN_CODE} onChange={(e) => updateLine(idx, "HSN_CODE", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}><input type="number" min="0" step="0.01" value={l.QUANTITY} onChange={(e) => updateLine(idx, "QUANTITY", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}><input type="number" min="0" step="0.01" value={l.UNIT_PRICE} onChange={(e) => updateLine(idx, "UNIT_PRICE", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}><input type="number" min="0" step="0.1" value={l.DISCOUNT_PERCENT} onChange={(e) => updateLine(idx, "DISCOUNT_PERCENT", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>{inr(lineTotal)}</td>
                    <td style={{ padding: 6 }}>
                      <button type="button" onClick={() => removeLine(idx)} style={{ border: "1px solid #fecaca", background: "#fef2f2", color: "#b91c1c", padding: "4px 8px", borderRadius: 6, cursor: "pointer", fontSize: 11 }}>🗑</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <div style={{ background: "linear-gradient(135deg,#fef2f2,#fff4e6)", border: "1px solid #fecaca", borderRadius: 12, padding: 16, minWidth: 280 }}>
            <TotalRow label="Subtotal" value={subtotal} />
            <TotalRow label={`Discount (${draft.DISCOUNT_PERCENT || 0}%)`} value={-discountAmount} />
            <TotalRow label={`GST (${draft.TAX_PERCENT || 0}%)`} value={taxAmount} />
            <div style={{ borderTop: "1px solid #C8102E", marginTop: 6, paddingTop: 6 }}>
              <TotalRow label="Grand Total" value={grandTotal} bold large />
            </div>
          </div>
        </div>

        <Field label="Terms & Conditions">
          <textarea rows={4} value={draft.TERMS_AND_CONDITIONS} onChange={(e) => setDraft({ ...draft, TERMS_AND_CONDITIONS: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
        </Field>

        <Field label="Notes">
          <textarea rows={2} value={draft.NOTES} onChange={(e) => setDraft({ ...draft, NOTES: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "white", padding: "10px 22px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button type="button" onClick={save} style={{ border: "none", background: "linear-gradient(135deg,#C8102E,#8B0B1F)", color: "white", padding: "10px 26px", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 6px 18px rgba(200,16,46,0.4)" }}>
            ✨ Create Sales Order
          </button>
        </div>

      </ModalShell>
    );
  }

  // ============ DETAIL FLOW ============
  if (loading) return <ModalShell title="Loading…" onClose={onClose}><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading…</div></ModalShell>;

  if (!so) return <ModalShell title="Not found" onClose={onClose}><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>SO not found</div></ModalShell>;

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
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap", alignItems: "center" }}>
        <StatusPill status={so.STATUS} />

        {so.STATUS === "DRAFT" && (
          <ActionBtn color="#0ea5e9" onClick={() => action("confirm", {},
            "Send advance payment request to the customer? Status will become AWAITING_ADVANCE until the advance is received.")}
          >📤 Send Advance Request</ActionBtn>
        )}

        {so.STATUS === "AWAITING_ADVANCE" && (
          <ActionBtn color="#F4B324" onClick={() => setPaymentDraft((d) => ({
            ...d,
            open: true,
            milestone: "ADVANCE",
            amount: Number((so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100).toFixed(2))
          }))}>
            💰 Record Advance Payment
          </ActionBtn>
        )}

        {so.STATUS === "CONFIRMED" && (
          <ActionBtn color="#F4B324" onClick={() => action("start-production", {},
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
          <ActionBtn color="#C8102E" onClick={() => setPaymentDraft((d) => ({ ...d, open: true }))}>
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
      <div style={{
        background: "linear-gradient(135deg,#fef2f2,#fff4e6)",
        border: "1px solid #fecaca", borderRadius: 12, padding: 16, marginBottom: 14,
        display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12
      }}>
        <InfoBlock label="Customer" value={so.CUSTOMER_NAME || `#${so.CUSTOMER_ID}`} sub={so.CUSTOMER_CODE} />
        <InfoBlock label="SO Date" value={so.SO_DATE} sub={`Expected: ${so.EXPECTED_DELIVERY_DATE || "—"}`} />
        <InfoBlock label="Advance Due" value={so.ADVANCE_DUE_DATE || "—"} sub={`${inr(so.ADVANCE_AMOUNT)} (${so.ADVANCE_PERCENT}%)`} />
        <InfoBlock label="From Quotation" value={so.QUOTATION_NUMBER || "—"} sub={so.PREPARED_BY_NAME ? `By: ${so.PREPARED_BY_NAME}` : ""} />
        <InfoBlock label="Phone / Email" value={so.CUSTOMER_PHONE || "—"} sub={so.CUSTOMER_EMAIL} />
        <InfoBlock label="Total Lines" value={so.LINES?.length || 0} />
      </div>

      {/* AWAITING_ADVANCE banner — prominent advance-due call-out */}
      {so.STATUS === "AWAITING_ADVANCE" && (
        <div style={{
          background: "linear-gradient(135deg,#fff7ed,#ffedd5)",
          border: "2px solid #F4B324",
          borderRadius: 12, padding: "16px 20px", marginBottom: 14,
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16,
          alignItems: "center"
        }}>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#8B4500" }}>
              💰 ADVANCE PAYMENT DUE
            </div>
            <div style={{ fontSize: 24, fontWeight: 900, color: "#C8102E", marginTop: 4 }}>
              {inr(so.ADVANCE_AMOUNT)}
            </div>
            <div style={{ fontSize: 11, color: "#6b4226", marginTop: 2 }}>
              {so.ADVANCE_PERCENT}% of {inr(so.GRAND_TOTAL)}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 10, fontWeight: 800, letterSpacing: 1.5, color: "#8B4500" }}>
              📅 DUE BY
            </div>
            <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>
              {so.ADVANCE_DUE_DATE || "—"}
            </div>
            <div style={{ fontSize: 11, color: "#6b4226", marginTop: 2 }}>
              Received: {inr(so.ADVANCE_RECEIVED)}
            </div>
          </div>
          <div style={{ fontSize: 12, color: "#6b4226", lineHeight: 1.5 }}>
            Status will auto-flip to <b>CONFIRMED</b> once the advance is
            fully received and recorded here. Production can then be
            started.
          </div>
        </div>
      )}

      {/* Payment progress */}
      <div style={{
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 12, padding: 14, marginBottom: 14
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#C8102E", letterSpacing: 1 }}>
            💰 PAYMENT PROGRESS
          </div>
          <div style={{ fontSize: 13, color: "#475569", fontWeight: 700 }}>
            {inr(so.PAYMENT_RECEIVED_TOTAL)} / {inr(so.GRAND_TOTAL)}
            <span style={{ marginLeft: 8, color: "#94a3b8", fontWeight: 500 }}>
              ({so.PAYMENT_PROGRESS_PCT}%)
            </span>
          </div>
        </div>
        <div style={{ height: 8, background: "#f1f5f9", borderRadius: 4, overflow: "hidden", marginBottom: 12 }}>
          <div style={{
            width: `${Math.min(100, so.PAYMENT_PROGRESS_PCT || 0)}%`,
            height: "100%", background: "linear-gradient(90deg,#C8102E,#F4B324)",
            transition: "width 0.4s"
          }} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, fontSize: 12 }}>
          <PaymentMilestone label="Advance" percent={so.ADVANCE_PERCENT} expected={so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100} received={so.ADVANCE_RECEIVED} />
          <PaymentMilestone label="On Dispatch" percent={so.DISPATCH_PERCENT} expected={so.GRAND_TOTAL * so.DISPATCH_PERCENT / 100} received={so.DISPATCH_RECEIVED} />
          <PaymentMilestone label="On Installation" percent={so.INSTALLATION_PERCENT} expected={so.GRAND_TOTAL * so.INSTALLATION_PERCENT / 100} received={so.INSTALLATION_RECEIVED} />
        </div>
      </div>

      {/* Lines + spawned projects */}
      <div style={{ fontSize: 12, fontWeight: 800, color: "#C8102E", letterSpacing: 1, marginBottom: 8 }}>
        📦 LINE ITEMS ({so.LINES?.length || 0})
      </div>

      <div style={{ marginBottom: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
              <th style={{ padding: 8, width: 40 }}>#</th>
              <th style={{ padding: 8 }}>Description</th>
              <th style={{ padding: 8, width: 200 }}>Spawned Project</th>
              <th style={{ padding: 8, width: 60, textAlign: "right" }}>Qty</th>
              <th style={{ padding: 8, width: 120, textAlign: "right" }}>Unit Price</th>
              <th style={{ padding: 8, width: 130, textAlign: "right" }}>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {(so.LINES || []).map((l, idx) => (
              <tr key={l.ID} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: 8 }}>{idx + 1}</td>
                <td style={{ padding: 8 }}>
                  <div>{l.DESCRIPTION}</div>
                  {l.PRODUCT_MODEL_CODE && (
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                      {l.PRODUCT_MODEL_CODE}
                    </div>
                  )}
                </td>
                <td style={{ padding: 8 }}>
                  {l.SPAWNED_PROJECT_ID ? (
                    <div>
                      <div style={{ color: "#047857", fontWeight: 700, fontSize: 11 }}>
                        ✓ Project #{l.SPAWNED_PROJECT_ID}
                      </div>
                      {l.SPAWNED_PROJECT_STATUS && (
                        <div style={{ fontSize: 10, color: "#94a3b8" }}>{l.SPAWNED_PROJECT_STATUS}</div>
                      )}
                    </div>
                  ) : (
                    <span style={{ fontSize: 10, color: "#94a3b8" }}>not yet spawned</span>
                  )}
                </td>
                <td style={{ padding: 8, textAlign: "right" }}>{l.QUANTITY}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{inr(l.UNIT_PRICE)}</td>
                <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <div style={{ background: "linear-gradient(135deg,#fef2f2,#fff4e6)", border: "1px solid #fecaca", borderRadius: 12, padding: 16, minWidth: 280 }}>
          <TotalRow label="Subtotal" value={so.SUBTOTAL} />
          {so.DISCOUNT_PERCENT > 0 && <TotalRow label={`Discount (${so.DISCOUNT_PERCENT}%)`} value={-so.DISCOUNT_AMOUNT} />}
          <TotalRow label={`GST (${so.TAX_PERCENT}%)`} value={so.TAX_AMOUNT} />
          <div style={{ borderTop: "1px solid #C8102E", marginTop: 6, paddingTop: 6 }}>
            <TotalRow label="Grand Total" value={so.GRAND_TOTAL} bold large />
          </div>
        </div>
      </div>

      {/* Activity */}
      {activity.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#C8102E", letterSpacing: 1, marginBottom: 8 }}>
            📋 ACTIVITY TIMELINE
          </div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" }}>
            {activity.map((a, idx) => {
              const icons = {
                CREATED: "📝", AWAITING_ADVANCE: "⏳", CONFIRMED: "✅",
                EMAIL_SENT: "📧", EMAIL_FAILED: "⚠️",
                PROJECTS_SPAWNED: "🏭", PAYMENT_RECEIVED: "💰",
                SHIPPED: "🚚", DELIVERED: "📦", CLOSED: "🎉", CANCELLED: "❌"
              };
              return (
                <div key={a.ID} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: idx === 0 ? "none" : "1px solid #e2e8f0" }}>
                  <div style={{ fontSize: 18, width: 26 }}>{icons[a.EVENT_TYPE] || "•"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{a.EVENT_TYPE.replace(/_/g, " ")}</div>
                    {a.EVENT_DETAIL && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{a.EVENT_DETAIL}</div>}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{a.CREATED_AT && new Date(a.CREATED_AT).toLocaleString("en-IN")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Payment modal */}
      {paymentDraft.open && (
        <div onClick={() => setPaymentDraft((d) => ({ ...d, open: false }))} style={{
          position: "fixed", inset: 0, background: "rgba(15,23,42,0.5)",
          zIndex: 1100, display: "flex", alignItems: "center", justifyContent: "center"
        }}>
          <div onClick={(e) => e.stopPropagation()} style={{
            width: 420, maxWidth: "94%", background: "white",
            borderRadius: 12, padding: 22, boxShadow: "0 24px 60px rgba(0,0,0,0.35)"
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a", marginBottom: 14 }}>
              💰 Record Payment
            </div>
            <Field label="Milestone">
              <select value={paymentDraft.milestone} onChange={(e) => setPaymentDraft({ ...paymentDraft, milestone: e.target.value })} style={inputStyle()}>
                <option value="ADVANCE">Advance ({so.ADVANCE_PERCENT}% = {inr(so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100)})</option>
                <option value="DISPATCH">On Dispatch ({so.DISPATCH_PERCENT}% = {inr(so.GRAND_TOTAL * so.DISPATCH_PERCENT / 100)})</option>
                <option value="INSTALLATION">On Installation ({so.INSTALLATION_PERCENT}% = {inr(so.GRAND_TOTAL * so.INSTALLATION_PERCENT / 100)})</option>
              </select>
            </Field>
            <div style={{ height: 10 }} />
            <Field label="Amount (₹)">
              <input type="number" min="0" step="0.01" value={paymentDraft.amount} onChange={(e) => setPaymentDraft({ ...paymentDraft, amount: e.target.value })} style={inputStyle()} />
            </Field>
            <div style={{ height: 10 }} />
            <Field label="Notes (transaction ref, etc.)">
              <textarea rows={2} value={paymentDraft.notes} onChange={(e) => setPaymentDraft({ ...paymentDraft, notes: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
            </Field>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
              <button onClick={() => setPaymentDraft((d) => ({ ...d, open: false }))} style={{ border: "1px solid #e2e8f0", background: "white", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
              <button onClick={recordPayment} style={{ border: "none", background: "linear-gradient(135deg,#C8102E,#8B0B1F)", color: "white", padding: "9px 22px", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
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
    <div style={{
      background: done ? "#dcfce7" : "#fef3c7",
      border: `1px solid ${done ? "#86efac" : "#fcd34d"}`,
      borderRadius: 8, padding: 10
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.8 }}>
        {label} · {percent}%
      </div>
      <div style={{ fontSize: 13, fontWeight: 800, color: done ? "#166534" : "#854d0e", marginTop: 4 }}>
        {inr(received)} / {inr(expected)}
      </div>
      <div style={{ marginTop: 4, height: 4, background: "rgba(255,255,255,0.5)", borderRadius: 2, overflow: "hidden" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: done ? "#10b981" : "#F4B324", transition: "width 0.4s" }} />
      </div>
    </div>
  );
}


// =================================================================
// Atoms
// =================================================================

function ModalShell({ title, onClose, children, wide }) {

  return (
    <div
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex", justifyContent: "center", alignItems: "center",
        padding: 30
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: wide ? 1100 : 720,
          maxWidth: "98%",
          maxHeight: "92vh",
          background: "white",
          borderRadius: 12,
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
          display: "flex",
          flexDirection: "column",
          overflow: "hidden"
        }}
      >
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          padding: "18px 22px",
          borderBottom: "1px solid #e2e8f0",
          flexShrink: 0,
          background: "white"
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <button onClick={onClose} style={{ border: "none", background: "transparent", fontSize: 22, cursor: "pointer", color: "#64748b" }}>×</button>
        </div>
        <div style={{ padding: 22, overflowY: "auto", flex: 1, minHeight: 0 }}>
          {children}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <label style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, display: "block" }}>{label}</label>
      {children}
    </div>
  );
}

function TotalRow({ label, value, bold, large }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: large ? 16 : 13, fontWeight: bold ? 800 : 500, color: bold ? "#8B0B1F" : "#475569" }}>
      <span>{label}</span><span>{inr(value)}</span>
    </div>
  );
}

function InfoBlock({ label, value, sub }) {
  return (
    <div>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "#64748b" }}>{sub}</div>}
    </div>
  );
}

function ActionBtn({ color, onClick, children }) {
  return (
    <button onClick={onClick} style={{ border: "none", background: color, color: "white", padding: "6px 14px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer", boxShadow: `0 4px 12px ${color}55` }}>
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
    <div style={{ padding: 24 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>📑 Sales Orders</h1>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            Approved quotation → confirmed contract → projects → delivery
          </div>
        </div>
        <button onClick={() => { setEditingId(null); setEditorOpen(true); }} style={{ border: "none", background: "linear-gradient(135deg,#C8102E,#8B0B1F)", color: "white", padding: "11px 22px", borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 6px 18px rgba(200,16,46,0.4)" }}>
          ✨ New Sales Order
        </button>
      </div>

      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <StatTile label="Awaiting Advance" value={stats.awaiting} color="#F4B324" />
        <StatTile label="In Production" value={stats.in_prod} color="#6366f1" />
        <StatTile label="Delivered + Closed" value={stats.delivered} color="#10b981" />
        <StatTile label="Total Order Value" value={inr(stats.value)} color="#C8102E" isText />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="text" placeholder="🔍 Search by SO#, customer, quotation..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle(), maxWidth: 380 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle(), maxWidth: 220 }}>
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
      {loading && <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", border: "1px dashed #cbd5e1", borderRadius: 12, color: "#64748b" }}>
          No sales orders yet. Convert an APPROVED quotation or click <b>New Sales Order</b>.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => (
            <div key={r.ID} onClick={() => { setEditingId(r.ID); setEditorOpen(true); }} style={{
              background: "white", border: "1px solid #e2e8f0", borderRadius: 12,
              padding: "14px 18px",
              display: "grid", gridTemplateColumns: "170px 1fr 180px 140px 160px",
              gap: 14, alignItems: "center", cursor: "pointer"
            }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{r.SO_NUMBER}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{r.SO_DATE}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{r.CUSTOMER_NAME || `#${r.CUSTOMER_ID}`}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>
                  {r.CUSTOMER_CODE}
                  {r.QUOTATION_NUMBER && ` · 📄 ${r.QUOTATION_NUMBER}`}
                </div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Payment</div>
                <div style={{ fontSize: 12, color: "#475569", fontWeight: 700 }}>
                  {r.PAYMENT_PROGRESS_PCT || 0}% received
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Total</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#8B0B1F" }}>{inr(r.GRAND_TOTAL)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
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
    <div style={{ background: "white", padding: "16px 20px", borderRadius: 14, boxShadow: "0 6px 20px rgba(15,23,42,0.07)", borderTop: `3px solid ${color}` }}>
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1 }}>{label}</div>
      <div style={{ fontSize: isText ? 18 : 28, fontWeight: 800, color: "#0f172a", marginTop: 4 }}>{value}</div>
    </div>
  );
}


export default SalesOrders;
