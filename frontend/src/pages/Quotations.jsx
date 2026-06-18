import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


// ===================================================================
// Quotations — Phase 3 of the CRM.
//
// Sales pipeline screen: list of quotations, status pipeline, click
// to open the editor (header + line items + totals), workflow actions
// (Send / Approve / Reject), and a print-ready view for PDF export.
// ===================================================================


const STATUS_THEME = {
  DRAFT:       { bg: "#f1f5f9", fg: "#475569", grad: "linear-gradient(135deg,#94a3b8,#64748b)" },
  GENERATED:   { bg: "#e0e7ff", fg: "#3730a3", grad: "linear-gradient(135deg,#6366f1,#4338ca)" },
  SENT:        { bg: "#dbeafe", fg: "#1d4ed8", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" },
  VIEWED:      { bg: "#cffafe", fg: "#0e7490", grad: "linear-gradient(135deg,#06b6d4,#0891b2)" },
  NEGOTIATION: { bg: "#fef3c7", fg: "#92400e", grad: "linear-gradient(135deg,#F4B324,#d97706)" },
  APPROVED:    { bg: "#dcfce7", fg: "#166534", grad: "linear-gradient(135deg,#10b981,#059669)" },
  REJECTED:    { bg: "#fee2e2", fg: "#991b1b", grad: "linear-gradient(135deg,#ef4444,#b91c1c)" },
  CONVERTED:   { bg: "#e0e7ff", fg: "#4338ca", grad: "linear-gradient(135deg,#C8102E,#8B0B1F)" },
  EXPIRED:     { bg: "#fef3c7", fg: "#854d0e", grad: "linear-gradient(135deg,#F4B324,#C8102E)" }
};


function StatusPill({ status }) {

  const t = STATUS_THEME[status] || STATUS_THEME.DRAFT;

  return (

    <span
      style={{
        background: t.bg,
        color: t.fg,
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.8
      }}
    >
      {status}
    </span>
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


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


// =================================================================
// Quotation Editor (modal)
// =================================================================

function QuotationEditor({ quotationId, onClose, onSaved }) {

  const isEdit = !!quotationId;

  const [quotation, setQuotation] = useState(null);

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  // For new quotations
  const [customers, setCustomers] = useState([]);

  const [products, setProducts] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [draft, setDraft] = useState({
    CUSTOMER_ID: "",
    QUOTATION_DATE: new Date().toISOString().slice(0, 10),
    VALIDITY_DAYS: 30,
    DISCOUNT_PERCENT: 0,
    TAX_PERCENT: 18,
    PREPARED_BY: "",
    TERMS_AND_CONDITIONS:
      "1. Prices are valid for the period stated above.\n" +
      "2. Delivery: 4-6 weeks from confirmed PO + advance.\n" +
      "3. Payment: 50% advance, 40% before dispatch, 10% on installation.\n" +
      "4. Warranty: 12 months from date of installation.\n" +
      "5. Installation & training included at customer site.",
    NOTES: "",
    LINES: []
  });

  const loadQuotation = () => {

    if (!isEdit) {

      setLoading(false);

      return;
    }

    setLoading(true);

    API.get(`/quotations/${quotationId}`)
      .then((r) => setQuotation(r.data))
      .catch((err) => alert(err?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    loadQuotation();

    if (!isEdit) {

      // Only need these for the create form
      API.get("/customers").then((r) => setCustomers(r.data || []));

      API.get("/production/models?vendor_id=1").then((r) => setProducts(r.data || []));

      API.get("/employees?status=ACTIVE").then((r) => setEmployees(r.data || []));
    }

  }, [quotationId]);

  // ====== CREATE FLOW ======
  if (!isEdit) {

    const addLine = () =>
      setDraft((d) => ({
        ...d,
        LINES: [
          ...d.LINES,
          {
            DESCRIPTION: "",
            PRODUCT_MODEL_ID: "",
            HSN_CODE: "",
            QUANTITY: 1,
            UNIT: "nos",
            UNIT_PRICE: 0,
            DISCOUNT_PERCENT: 0
          }
        ]
      }));

    const updateLine = (idx, field, value) =>
      setDraft((d) => ({
        ...d,
        LINES: d.LINES.map((l, i) =>
          i === idx ? { ...l, [field]: value } : l
        )
      }));

    const removeLine = (idx) =>
      setDraft((d) => ({
        ...d,
        LINES: d.LINES.filter((_, i) => i !== idx)
      }));

    const onProductPick = (idx, productId) => {

      const p = products.find((x) => String(x.ID) === String(productId));

      updateLine(idx, "PRODUCT_MODEL_ID", productId);

      if (p) {

        updateLine(idx, "DESCRIPTION",
          `${p.MODEL_NAME} (${p.MODEL_CODE})`
        );

        // Try BOM-based auto-price
        API.get(`/quotations-auto-price?product_model_id=${productId}&margin_percent=25&vendor_id=1`)
          .then((r) => {

            if (r.data?.suggested_unit_price) {

              updateLine(idx, "UNIT_PRICE", r.data.suggested_unit_price);
            }
          })
          .catch(() => { /* silent — leave price at 0 */ });
      }
    };

    const subtotal = draft.LINES.reduce(
      (s, l) =>
        s + (Number(l.QUANTITY) || 0) *
            (Number(l.UNIT_PRICE) || 0) *
            (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100),
      0
    );

    const discountAmount = subtotal * (Number(draft.DISCOUNT_PERCENT) || 0) / 100;

    const taxable = subtotal - discountAmount;

    const taxAmount = taxable * (Number(draft.TAX_PERCENT) || 0) / 100;

    const grandTotal = taxable + taxAmount;

    const save = async () => {

      if (!draft.CUSTOMER_ID) {

        alert("Please pick a customer");

        return;
      }

      if (draft.LINES.length === 0) {

        alert("Add at least one line item");

        return;
      }

      const badLine = draft.LINES.find((l) => !l.DESCRIPTION?.trim());

      if (badLine) {

        alert("Every line needs a description");

        return;
      }

      setSaving(true);

      try {

        const payload = {
          ...draft,
          CUSTOMER_ID: Number(draft.CUSTOMER_ID),
          VALIDITY_DAYS: Number(draft.VALIDITY_DAYS) || 30,
          DISCOUNT_PERCENT: Number(draft.DISCOUNT_PERCENT) || 0,
          TAX_PERCENT: Number(draft.TAX_PERCENT) || 0,
          LINES: draft.LINES.map((l, idx) => ({
            ...l,
            PRODUCT_MODEL_ID: l.PRODUCT_MODEL_ID ? Number(l.PRODUCT_MODEL_ID) : null,
            QUANTITY: Number(l.QUANTITY) || 1,
            UNIT_PRICE: Number(l.UNIT_PRICE) || 0,
            DISCOUNT_PERCENT: Number(l.DISCOUNT_PERCENT) || 0,
            SORT_ORDER: idx
          }))
        };

        const res = await API.post("/quotations", payload);

        onSaved?.(res.data?.quotation?.ID);

      } catch (err) {

        alert(err?.response?.data?.detail || "Failed to save");

      } finally {

        setSaving(false);
      }
    };

    return (
      <ModalShell title="✨ New Quotation" onClose={onClose} wide>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>

          <Field label="Customer *">
            <select
              value={draft.CUSTOMER_ID}
              onChange={(e) => setDraft({ ...draft, CUSTOMER_ID: e.target.value })}
              style={inputStyle()}
            >
              <option value="">— pick customer —</option>
              {customers.map((c) => (
                <option key={c.ID} value={c.ID}>
                  {c.CUSTOMER_NAME} ({c.CUSTOMER_CODE})
                </option>
              ))}
            </select>
          </Field>

          <Field label="Quotation Date">
            <input
              type="date"
              value={draft.QUOTATION_DATE}
              onChange={(e) => setDraft({ ...draft, QUOTATION_DATE: e.target.value })}
              style={inputStyle()}
            />
          </Field>

          <Field label="Validity (days)">
            <input
              type="number"
              min="1"
              value={draft.VALIDITY_DAYS}
              onChange={(e) => setDraft({ ...draft, VALIDITY_DAYS: e.target.value })}
              style={inputStyle()}
            />
          </Field>

          <Field label="Prepared By">
            <select
              value={draft.PREPARED_BY}
              onChange={(e) => setDraft({ ...draft, PREPARED_BY: e.target.value })}
              style={inputStyle()}
            >
              <option value="">— pick salesperson —</option>
              {employees.map((emp) => (
                <option key={emp.ID} value={emp.ID}>{emp.NAME}</option>
              ))}
            </select>
          </Field>

          <Field label="Header Discount (%)">
            <input
              type="number"
              min="0"
              step="0.1"
              value={draft.DISCOUNT_PERCENT}
              onChange={(e) => setDraft({ ...draft, DISCOUNT_PERCENT: e.target.value })}
              style={inputStyle()}
            />
          </Field>

        </div>

        {/* Line items */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#0ea5e9", letterSpacing: 1 }}>
            📦 LINE ITEMS
          </div>
          <button
            type="button"
            onClick={addLine}
            style={{
              border: "none",
              background: "linear-gradient(135deg,#10b981,#059669)",
              color: "white",
              padding: "7px 14px",
              borderRadius: 8,
              fontWeight: 700,
              fontSize: 12,
              cursor: "pointer"
            }}
          >
            ➕ Add Line
          </button>
        </div>

        <div style={{ marginBottom: 16, overflow: "auto" }}>

          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
                <th style={{ padding: 8, width: 40 }}>#</th>
                <th style={{ padding: 8 }}>Description</th>
                <th style={{ padding: 8, width: 160 }}>Product Link</th>
                <th style={{ padding: 8, width: 80 }}>HSN</th>
                <th style={{ padding: 8, width: 70 }}>Qty</th>
                <th style={{ padding: 8, width: 60 }}>Unit</th>
                <th style={{ padding: 8, width: 110 }}>Unit Price</th>
                <th style={{ padding: 8, width: 70 }}>Disc%</th>
                <th style={{ padding: 8, width: 110, textAlign: "right" }}>Total</th>
                <th style={{ padding: 8, width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {draft.LINES.length === 0 && (
                <tr>
                  <td colSpan="10" style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>
                    No lines yet. Click "Add Line" to start.
                  </td>
                </tr>
              )}
              {draft.LINES.map((l, idx) => {

                const lineTotal =
                  (Number(l.QUANTITY) || 0) *
                  (Number(l.UNIT_PRICE) || 0) *
                  (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100);

                return (
                  <tr key={idx} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{idx + 1}</td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={l.DESCRIPTION}
                        onChange={(e) => updateLine(idx, "DESCRIPTION", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <select
                        value={l.PRODUCT_MODEL_ID}
                        onChange={(e) => onProductPick(idx, e.target.value)}
                        style={inputStyle()}
                      >
                        <option value="">— link —</option>
                        {products.map((p) => (
                          <option key={p.ID} value={p.ID}>
                            {p.MODEL_CODE}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={l.HSN_CODE}
                        onChange={(e) => updateLine(idx, "HSN_CODE", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.QUANTITY}
                        onChange={(e) => updateLine(idx, "QUANTITY", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={l.UNIT}
                        onChange={(e) => updateLine(idx, "UNIT", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.UNIT_PRICE}
                        onChange={(e) => updateLine(idx, "UNIT_PRICE", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={l.DISCOUNT_PERCENT}
                        onChange={(e) => updateLine(idx, "DISCOUNT_PERCENT", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6, textAlign: "right", fontWeight: 700 }}>
                      {inr(lineTotal)}
                    </td>
                    <td style={{ padding: 6 }}>
                      <button
                        type="button"
                        onClick={() => removeLine(idx)}
                        title="Remove"
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          color: "#b91c1c",
                          padding: "4px 8px",
                          borderRadius: 6,
                          cursor: "pointer",
                          fontSize: 11
                        }}
                      >
                        🗑
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Totals summary */}
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 16 }}>
          <div style={{
            background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
            border: "1px solid #bbf7d0",
            borderRadius: 12,
            padding: 16,
            minWidth: 300
          }}>
            <TotalRow label="Subtotal" value={subtotal} />
            <TotalRow label={`Header Discount (${draft.DISCOUNT_PERCENT || 0}%)`} value={-discountAmount} />

            {/* Editable tax row */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 13, color: "#475569" }}>
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                Tax
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={draft.TAX_PERCENT}
                  onChange={(e) => setDraft({ ...draft, TAX_PERCENT: e.target.value })}
                  style={{
                    width: 58,
                    padding: "3px 6px",
                    border: "1px solid #86efac",
                    borderRadius: 6,
                    fontSize: 12,
                    textAlign: "center",
                    fontFamily: "inherit",
                    background: "white"
                  }}
                />
                <span style={{ fontSize: 12, color: "#64748b" }}>%</span>
              </span>
              <span style={{ fontWeight: 500 }}>{inr(taxAmount)}</span>
            </div>

            <div style={{ borderTop: "1px solid #86efac", marginTop: 6, paddingTop: 6 }}>
              <TotalRow label="Grand Total" value={grandTotal} bold large />
            </div>
          </div>
        </div>

        <Field label="Notes">
          <textarea
            value={draft.NOTES}
            onChange={(e) => setDraft({ ...draft, NOTES: e.target.value })}
            rows={2}
            style={{ ...inputStyle(), resize: "vertical" }}
          />
        </Field>

        <Field label="Terms & Conditions">
          <textarea
            value={draft.TERMS_AND_CONDITIONS}
            onChange={(e) => setDraft({ ...draft, TERMS_AND_CONDITIONS: e.target.value })}
            rows={5}
            style={{ ...inputStyle(), resize: "vertical", fontSize: 12 }}
          />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
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
            type="button"
            onClick={save}
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
            {saving ? "Saving…" : "✨ Create Quotation"}
          </button>
        </div>

      </ModalShell>
    );
  }

  // ====== VIEW / EDIT FLOW ======
  if (loading) {

    return (
      <ModalShell title="Loading…" onClose={onClose}>
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Loading quotation…
        </div>
      </ModalShell>
    );
  }

  if (!quotation) {

    return (
      <ModalShell title="Not found" onClose={onClose}>
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>
          Quotation not found
        </div>
      </ModalShell>
    );
  }

  return (
    <QuotationDetail
      quotation={quotation}
      onClose={onClose}
      onChanged={() => {
        loadQuotation();
        onSaved?.();
      }}
    />
  );
}


function QuotationDetail({ quotation, onClose, onChanged }) {

  const q = quotation;

  const [activity, setActivity] = useState([]);

  const [resending, setResending] = useState(false);

  const [localTaxPct, setLocalTaxPct] = useState(q.TAX_PERCENT ?? 18);

  const taxableBase = (q.SUBTOTAL || 0) - (q.DISCOUNT_AMOUNT || 0);
  const localTaxAmt = taxableBase * (Number(localTaxPct) || 0) / 100;
  const localGrandTotal = taxableBase + localTaxAmt;

  const saveTax = async (val) => {
    try {
      await API.patch(`/quotations/${q.ID}`, { TAX_PERCENT: Number(val) || 0 });
      onChanged?.();
    } catch {
      // silent — totals still show the locally-computed value
    }
  };

  const loadActivity = () => {

    API.get(`/quotations/${q.ID}/activity`)
      .then((r) => setActivity(r.data || []))
      .catch(() => setActivity([]));
  };

  useEffect(() => {

    loadActivity();

  }, [q.ID, q.STATUS, q.VIEW_COUNT, q.EMAIL_SENT_COUNT]);

  const sendNow = async () => {

    if (!window.confirm(
      "Send this quotation to the customer? An email will be dispatched."
    )) return;

    try {

      const res = await API.post(`/quotations/${q.ID}/send`);

      if (res.data?.email_sent) {

        alert(`✅ Email sent successfully!\n\nPublic link: ${res.data.public_url}`);

      } else {

        alert(
          `⚠️ Status updated to SENT, but email failed:\n\n${res.data?.email_status || "unknown error"}\n\n` +
          "You can still share the public link manually."
        );
      }

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to send");
    }
  };

  const resendEmail = async () => {

    if (!window.confirm("Resend the quotation email to the customer?")) return;

    setResending(true);

    try {

      const res = await API.post(`/quotations/${q.ID}/resend-email`);

      if (res.data?.email_sent) {

        alert("📧 Email resent successfully");

      } else {

        alert(`⚠️ Resend failed: ${res.data?.email_status || "unknown error"}`);
      }

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to resend");

    } finally {

      setResending(false);
    }
  };

  const copyPublicLink = async () => {

    if (!q.PUBLIC_URL) {

      alert("Public link is generated only after sending. Click '📤 Send' first.");

      return;
    }

    try {

      await navigator.clipboard.writeText(q.PUBLIC_URL);

      alert("✅ Link copied to clipboard!");

    } catch {

      // Fallback for browsers without clipboard API
      window.prompt("Copy this link:", q.PUBLIC_URL);
    }
  };

  const shareWhatsApp = () => {

    if (!q.PUBLIC_URL) {

      alert("Public link is generated only after sending. Click '📤 Send' first.");

      return;
    }

    const msg = (
      `Hi ${q.CUSTOMER_NAME || "there"},\n\n` +
      `Please find our quotation ${q.QUOTATION_NUMBER} for your requirements.\n\n` +
      `View / Download: ${q.PUBLIC_URL}\n\n` +
      `Total: ${inr(q.GRAND_TOTAL)}\n` +
      `Valid till: ${q.EXPIRY_DATE}\n\n` +
      `— Bharath Vending Corporation`
    );

    // Use the customer's phone if available, else open WhatsApp's
    // share dialog without a number.
    const phone = (q.CUSTOMER_PHONE || "").replace(/\D/g, "");

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank");
  };

  const transition = async (action, body = {}) => {

    if (!window.confirm(`Confirm: mark this quotation as ${action.toUpperCase()}?`))
      return;

    try {

      await API.post(`/quotations/${q.ID}/${action}`, body);

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || `Failed to ${action}`);
    }
  };

  const reject = async () => {

    const reason = window.prompt("Reason for rejection (optional):");

    if (reason === null) return; // user cancelled

    try {

      await API.post(`/quotations/${q.ID}/reject`, {
        REJECTION_REASON: reason || ""
      });

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to reject");
    }
  };

  const printNow = () => {

    window.open(`/quotation-print/${q.ID}`, "_blank");
  };

  const downloadPdf = () => {

    window.open(`/quotation-print/${q.ID}?download=1`, "_blank");
  };

  const deleteQuotation = async () => {

    const isProtected = !["DRAFT", "REJECTED", "EXPIRED"].includes(q.STATUS);

    const msg = isProtected
      ? `This quotation is ${q.STATUS}. Deleting will REMOVE its lines and activity (any Sales Order lines that came from this quote will keep their data but forget which quote they came from). Continue?`
      : "Delete this quotation permanently?";

    if (!window.confirm(msg)) return;

    try {

      const url = isProtected
        ? `/quotations/${q.ID}?force=true`
        : `/quotations/${q.ID}`;

      const res = await API.delete(url);

      alert(res?.data?.message || "Quotation deleted");

      onChanged?.();

      onClose?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (

    <ModalShell title={`📄 ${q.QUOTATION_NUMBER}`} onClose={onClose} wide>

      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <StatusPill status={q.STATUS} />

        {q.STATUS === "DRAFT" && (
          <>
            <ActionBtn color="#3b82f6" onClick={sendNow}>
              📤 Send Email + Share
            </ActionBtn>
            <ActionBtn color="#10b981" onClick={() => transition("approve")}>
              ✅ Mark Approved
            </ActionBtn>
            <ActionBtn color="#ef4444" onClick={reject}>
              ❌ Reject
            </ActionBtn>
          </>
        )}

        {q.STATUS === "SENT" && (
          <>
            <ActionBtn color="#0ea5e9" onClick={resendEmail}>
              {resending ? "📧 Sending…" : "📧 Resend Email"}
            </ActionBtn>
            <ActionBtn color="#10b981" onClick={() => transition("approve")}>
              ✅ Customer Approved
            </ActionBtn>
            <ActionBtn color="#ef4444" onClick={reject}>
              ❌ Customer Rejected
            </ActionBtn>
          </>
        )}

        {(q.STATUS === "SENT" || q.STATUS === "APPROVED") && (
          <>
            <ActionBtn color="#25D366" onClick={shareWhatsApp}>
              📲 Share on WhatsApp
            </ActionBtn>
            <ActionBtn color="#64748b" onClick={copyPublicLink}>
              🔗 Copy Link
            </ActionBtn>
          </>
        )}

        {/* Convert APPROVED quotation → Sales Order (Phase 5) */}
        {q.STATUS === "APPROVED" && (
          <ActionBtn color="#C8102E" onClick={async () => {

            if (!window.confirm(
              "Convert this quotation into a Sales Order?\n\n" +
              "A new SO will be created with the same lines and " +
              "marked as DRAFT. The quotation status will change to " +
              "CONVERTED."
            )) return;

            try {

              const res = await API.post("/sales-orders/from-quotation", {
                QUOTATION_ID: q.ID,
                EXPECTED_DELIVERY_DATE: q.EXPIRY_DATE || null,
                ADVANCE_PERCENT: 50,
                DISPATCH_PERCENT: 40,
                INSTALLATION_PERCENT: 10
              });

              alert("✅ " + (res.data?.message || "Sales Order created"));

              onChanged?.();

            } catch (err) {

              alert(err?.response?.data?.detail || "Failed to convert");
            }
          }}>
            📑 Convert to Sales Order
          </ActionBtn>
        )}

        <ActionBtn color="#6366f1" onClick={printNow}>
          🖨️ Print
        </ActionBtn>

        <ActionBtn color="#0f172a" onClick={downloadPdf}>
          ⬇️ Save PDF
        </ActionBtn>

        {["DRAFT", "REJECTED", "EXPIRED"].includes(q.STATUS) && (
          <ActionBtn color="#ef4444" onClick={deleteQuotation}>
            🗑️ Delete
          </ActionBtn>
        )}
      </div>

      {/* Tracking banner — shows when SENT and onwards */}
      {(q.EMAIL_SENT_AT || q.VIEWED_AT || q.LAST_EMAIL_STATUS) && (
        <div style={{
          background: q.VIEWED_AT
            ? "linear-gradient(135deg,#f0fdf4,#dcfce7)"
            : "linear-gradient(135deg,#fef3c7,#fde68a)",
          border: q.VIEWED_AT ? "1px solid #86efac" : "1px solid #fcd34d",
          borderRadius: 10,
          padding: "10px 14px",
          marginBottom: 14,
          display: "flex",
          gap: 18,
          fontSize: 12,
          flexWrap: "wrap",
          alignItems: "center"
        }}>
          {q.EMAIL_SENT_AT && (
            <div>
              <b>📧 Emailed</b> {q.EMAIL_SENT_COUNT > 1 ? `(${q.EMAIL_SENT_COUNT}×)` : ""}
              {" · "}{new Date(q.EMAIL_SENT_AT).toLocaleString("en-IN")}
            </div>
          )}
          {q.VIEWED_AT ? (
            <div style={{ color: "#166534", fontWeight: 700 }}>
              👁️ Customer viewed{" "}
              {q.VIEW_COUNT > 1 ? `${q.VIEW_COUNT}× ` : ""}
              · last on {new Date(q.LAST_VIEWED_AT).toLocaleString("en-IN")}
            </div>
          ) : q.EMAIL_SENT_AT ? (
            <div style={{ color: "#854d0e" }}>
              ⏳ Customer hasn't opened yet
            </div>
          ) : null}
          {q.LAST_EMAIL_STATUS && !q.EMAIL_SENT_AT && (
            <div style={{ color: "#b91c1c" }}>
              ❌ {q.LAST_EMAIL_STATUS}
            </div>
          )}
        </div>
      )}

      {/* Header card */}
      <div style={{
        background: "linear-gradient(135deg,#f8fafc,#ffffff)",
        border: "1px solid #e2e8f0",
        borderRadius: 12,
        padding: 16,
        marginBottom: 14,
        display: "grid",
        gridTemplateColumns: "repeat(3,1fr)",
        gap: 12
      }}>
        <InfoBlock label="Customer" value={q.CUSTOMER_NAME || `#${q.CUSTOMER_ID}`} sub={q.CUSTOMER_CODE} />
        <InfoBlock label="Date" value={q.QUOTATION_DATE || "—"} sub={`Valid ${q.VALIDITY_DAYS} days`} />
        <InfoBlock label="Expires" value={q.EXPIRY_DATE || "—"} />
        <InfoBlock label="Prepared by" value={q.PREPARED_BY_NAME || "—"} />
        <InfoBlock label="Customer GST" value={q.CUSTOMER_GST || "—"} />
        <InfoBlock label="Phone / Email" value={q.CUSTOMER_PHONE || "—"} sub={q.CUSTOMER_EMAIL} />
      </div>

      {/* Line items */}
      <div style={{ fontSize: 12, fontWeight: 800, color: "#0ea5e9", letterSpacing: 1, marginBottom: 8 }}>
        📦 LINE ITEMS ({q.LINES?.length || 0})
      </div>

      <div style={{ marginBottom: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
              <th style={{ padding: 8, width: 40 }}>#</th>
              <th style={{ padding: 8 }}>Description</th>
              <th style={{ padding: 8, width: 80 }}>HSN</th>
              <th style={{ padding: 8, width: 60, textAlign: "right" }}>Qty</th>
              <th style={{ padding: 8, width: 60 }}>Unit</th>
              <th style={{ padding: 8, width: 110, textAlign: "right" }}>Price</th>
              <th style={{ padding: 8, width: 70, textAlign: "right" }}>Disc</th>
              <th style={{ padding: 8, width: 130, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(q.LINES || []).map((l, idx) => (
              <tr key={l.ID} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: 8 }}>{idx + 1}</td>
                <td style={{ padding: 8 }}>{l.DESCRIPTION}</td>
                <td style={{ padding: 8 }}>{l.HSN_CODE || "—"}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{l.QUANTITY}</td>
                <td style={{ padding: 8 }}>{l.UNIT}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{inr(l.UNIT_PRICE)}</td>
                <td style={{ padding: 8, textAlign: "right" }}>{l.DISCOUNT_PERCENT}%</td>
                <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{
          background: "linear-gradient(135deg,#f0fdf4,#dcfce7)",
          border: "1px solid #bbf7d0",
          borderRadius: 12,
          padding: 16,
          minWidth: 280
        }}>
          <TotalRow label="Subtotal" value={q.SUBTOTAL} />
          {q.DISCOUNT_PERCENT > 0 && (
            <TotalRow label={`Discount (${q.DISCOUNT_PERCENT}%)`} value={-q.DISCOUNT_AMOUNT} />
          )}

          {/* Editable tax row */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", fontSize: 13, color: "#475569" }}>
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              Tax
              <input
                type="number"
                min="0"
                step="0.1"
                value={localTaxPct}
                onChange={(e) => setLocalTaxPct(e.target.value)}
                onBlur={(e) => saveTax(e.target.value)}
                style={{
                  width: 58,
                  padding: "3px 6px",
                  border: "1px solid #86efac",
                  borderRadius: 6,
                  fontSize: 12,
                  textAlign: "center",
                  fontFamily: "inherit",
                  background: "white"
                }}
              />
              <span style={{ fontSize: 12, color: "#64748b" }}>%</span>
            </span>
            <span style={{ fontWeight: 500 }}>{inr(localTaxAmt)}</span>
          </div>

          <div style={{ borderTop: "1px solid #86efac", marginTop: 6, paddingTop: 6 }}>
            <TotalRow label="Grand Total" value={localGrandTotal} bold large />
          </div>
        </div>
      </div>

      {q.NOTES && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>NOTES</div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, fontSize: 13, whiteSpace: "pre-line" }}>
            {q.NOTES}
          </div>
        </div>
      )}

      {q.TERMS_AND_CONDITIONS && (
        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#64748b", marginBottom: 4 }}>TERMS & CONDITIONS</div>
          <div style={{ background: "#fafafa", border: "1px solid #e2e8f0", borderRadius: 8, padding: 12, fontSize: 12, color: "#475569", whiteSpace: "pre-line" }}>
            {q.TERMS_AND_CONDITIONS}
          </div>
        </div>
      )}

      {q.STATUS === "REJECTED" && q.REJECTION_REASON && (
        <div style={{ marginTop: 16, background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#991b1b", marginBottom: 4 }}>
            REJECTION REASON
          </div>
          <div style={{ fontSize: 13, color: "#7f1d1d" }}>{q.REJECTION_REASON}</div>
        </div>
      )}

      {/* Activity timeline */}
      {activity.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#0ea5e9", letterSpacing: 1, marginBottom: 8 }}>
            📋 ACTIVITY TIMELINE
          </div>
          <div style={{
            background: "#f8fafc",
            border: "1px solid #e2e8f0",
            borderRadius: 10,
            padding: "12px 16px"
          }}>
            {activity.map((a, idx) => {

              const isCustomer = a.ACTOR_TYPE === "CUSTOMER";

              const icons = {
                CREATED: "📝",
                SENT: "📤",
                EMAIL_SENT: "📧",
                EMAIL_FAILED: "⚠️",
                VIEWED: "👁️",
                APPROVED: "✅",
                REJECTED: "❌",
                EXPIRED: "⏰",
                CONVERTED: "🚀"
              };

              const removeActivity = async () => {

                if (!window.confirm("Remove this activity entry?")) return;

                try {

                  await API.delete(`/quotations/${q.ID}/activity/${a.ID}`);

                  loadActivity();

                } catch (err) {

                  alert(err?.response?.data?.detail || "Failed to remove");
                }
              };

              return (
                <div
                  key={a.ID}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "8px 0",
                    borderTop: idx === 0 ? "none" : "1px solid #e2e8f0",
                    alignItems: "flex-start"
                  }}
                >
                  <div style={{ fontSize: 18, width: 26 }}>{icons[a.EVENT_TYPE] || "•"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                      {a.EVENT_TYPE.replace(/_/g, " ")}
                      {isCustomer && (
                        <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 800, background: "#fef3c7", color: "#854d0e", padding: "2px 6px", borderRadius: 4, letterSpacing: 0.6 }}>
                          CUSTOMER
                        </span>
                      )}
                    </div>
                    {a.EVENT_DETAIL && (
                      <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
                        {a.EVENT_DETAIL}
                      </div>
                    )}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                      {a.CREATED_AT ? new Date(a.CREATED_AT).toLocaleString("en-IN") : ""}
                    </div>
                  </div>
                  <button
                    onClick={removeActivity}
                    title="Remove this entry"
                    style={{
                      border: "1px solid #e2e8f0",
                      background: "white",
                      color: "#94a3b8",
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      cursor: "pointer",
                      fontSize: 12,
                      lineHeight: 1,
                      padding: 0,
                      flexShrink: 0
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

    </ModalShell>
  );
}


// =================================================================
// Small UI atoms
// =================================================================

function ModalShell({ title, onClose, children, wide }) {

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.55)",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
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
        {/* Sticky title bar — stays visible while body scrolls */}
        <div style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "18px 22px",
          borderBottom: "1px solid #e2e8f0",
          flexShrink: 0,
          background: "white"
        }}>
          <div style={{ fontSize: 17, fontWeight: 800, color: "#0f172a" }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              border: "none",
              background: "transparent",
              fontSize: 22,
              cursor: "pointer",
              color: "#64748b"
            }}
          >
            ×
          </button>
        </div>

        {/* Scrollable body — only this region scrolls */}
        <div style={{
          padding: 22,
          overflowY: "auto",
          flex: 1,
          minHeight: 0
        }}>
          {children}
        </div>
      </div>
    </div>
  );
}


function Field({ label, children }) {

  return (
    <div>
      <label style={{ fontSize: 11, color: "#64748b", fontWeight: 700, letterSpacing: 0.5, marginBottom: 4, display: "block" }}>
        {label}
      </label>
      {children}
    </div>
  );
}


function TotalRow({ label, value, bold, large }) {

  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      padding: "4px 0",
      fontSize: large ? 16 : 13,
      fontWeight: bold ? 800 : 500,
      color: bold ? "#047857" : "#475569"
    }}>
      <span>{label}</span>
      <span>{inr(value)}</span>
    </div>
  );
}


function InfoBlock({ label, value, sub }) {

  return (
    <div>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a" }}>{value}</div>
      {sub && (
        <div style={{ fontSize: 11, color: "#64748b" }}>{sub}</div>
      )}
    </div>
  );
}


function ActionBtn({ color, onClick, children }) {

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        border: "none",
        background: color,
        color: "white",
        padding: "6px 14px",
        borderRadius: 8,
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        boxShadow: `0 4px 12px ${color}55`
      }}
    >
      {children}
    </button>
  );
}


// =================================================================
// Main Quotations page (list + create + edit modal)
// =================================================================

function Quotations() {

  const [rows, setRows] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const [searchQ, setSearchQ] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);

  const [editingId, setEditingId] = useState(null);

  const [dashStats, setDashStats] = useState(null);

  const load = () => {

    setLoading(true);

    const params = statusFilter ? `?status=${statusFilter}` : "";

    API.get(`/quotations${params}`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  const loadDashStats = () => {

    API.get("/quotations/dashboard-stats")
      .then((r) => setDashStats(r.data || null))
      .catch(() => { /* silent — widget will show fallback zeros */ });
  };

  useEffect(() => {

    load();

  }, [statusFilter]);

  // Dashboard stats — fetch on mount + every 30s
  useEffect(() => {

    loadDashStats();

    const t = setInterval(loadDashStats, 30000);

    return () => clearInterval(t);

  }, []);

  const filtered = useMemo(() => {

    const s = searchQ.trim().toLowerCase();

    if (!s) return rows;

    return rows.filter(
      (r) =>
        (r.QUOTATION_NUMBER || "").toLowerCase().includes(s) ||
        (r.CUSTOMER_NAME || "").toLowerCase().includes(s) ||
        (r.CUSTOMER_CODE || "").toLowerCase().includes(s)
    );

  }, [rows, searchQ]);

  const stats = useMemo(() => {

    const s = { total: rows.length, draft: 0, sent: 0, approved: 0, value: 0 };

    rows.forEach((r) => {

      if (r.STATUS === "DRAFT") s.draft++;

      if (r.STATUS === "SENT") s.sent++;

      // Approved tile + Approved Value tile only count APPROVED
      // and CONVERTED quotations — rejected / draft / sent / expired
      // are deliberately excluded so the figure reflects real won
      // business, not pipeline volume.
      if (r.STATUS === "APPROVED" || r.STATUS === "CONVERTED") {

        s.approved++;

        s.value += r.GRAND_TOTAL || 0;
      }
    });

    return s;

  }, [rows]);

  return (

    <div style={{ padding: 24 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>
            📄 Quotations
          </h1>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            Sales pipeline — create, send, track approval
          </div>
        </div>
        <button
          onClick={() => { setEditingId(null); setEditorOpen(true); }}
          style={{
            border: "none",
            background: "linear-gradient(135deg,#06b6d4,#C8102E,#8B0B1F)",
            color: "white",
            padding: "11px 22px",
            borderRadius: 10,
            fontWeight: 800,
            fontSize: 13,
            cursor: "pointer",
            boxShadow: "0 6px 18px rgba(14,165,233,0.45)"
          }}
        >
          ✨ New Quotation
        </button>
      </div>

      {/* Auto-generation dashboard widgets — 6 tiles in a responsive grid */}
      <div style={{
        display: "grid",
        gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
        gap: 12,
        marginBottom: 16
      }}>
        <StatTile
          label="Generated Today"
          value={dashStats?.GENERATED_TODAY ?? 0}
          color="#6366f1"
          icon="🤖"
        />
        <StatTile
          label="Sent"
          value={dashStats?.SENT_TOTAL ?? 0}
          color="#C8102E"
          icon="📤"
        />
        <StatTile
          label="Viewed"
          value={dashStats?.VIEWED_TOTAL ?? 0}
          color="#06b6d4"
          icon="👁️"
        />
        <StatTile
          label="Approved"
          value={dashStats?.APPROVED_TOTAL ?? 0}
          color="#10b981"
          icon="✅"
        />
        <StatTile
          label="Pending"
          value={dashStats?.PENDING_TOTAL ?? 0}
          color="#F4B324"
          icon="⏳"
        />
        <StatTile
          label="MTD Value"
          value={inrCompact(dashStats?.MTD_VALUE ?? 0)}
          color="#8B0B1F"
          icon="💰"
          isText
        />
      </div>

      {/* Pipeline summary tiles (computed from list) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <StatTile label="Total" value={stats.total} color="#6366f1" />
        <StatTile label="Draft" value={stats.draft} color="#94a3b8" />
        <StatTile label="Sent" value={stats.sent} color="#3b82f6" />
        <StatTile label="Approved Value" value={inr(stats.value)} color="#10b981" isText />
      </div>

      {/* Filters */}
      <div style={{ display: "flex", gap: 10, marginBottom: 16, alignItems: "center", flexWrap: "wrap" }}>
        <input
          type="text"
          placeholder="🔍 Search by number, customer..."
          value={searchQ}
          onChange={(e) => setSearchQ(e.target.value)}
          style={{ ...inputStyle(), maxWidth: 320 }}
        />
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          style={{ ...inputStyle(), maxWidth: 200 }}
        >
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="APPROVED">Approved</option>
          <option value="REJECTED">Rejected</option>
          <option value="CONVERTED">Converted</option>
          <option value="EXPIRED">Expired</option>
        </select>
      </div>

      {/* List */}
      {loading && (
        <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>
          Loading…
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div style={{
          padding: 40,
          textAlign: "center",
          border: "1px dashed #cbd5e1",
          borderRadius: 12,
          color: "#64748b"
        }}>
          No quotations yet. Click <b>New Quotation</b> to create one.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => {

            const isProtected = !["DRAFT", "REJECTED", "EXPIRED"].includes(r.STATUS);

            const deleteRow = async (e) => {

              e.stopPropagation();

              const msg = isProtected
                ? `This quotation is ${r.STATUS}. Deleting will REMOVE its lines and activity (any Sales Order lines that came from it will keep their data but lose the link to this quote). Continue?`
                : `Delete quotation ${r.QUOTATION_NUMBER}? This cannot be undone.`;

              if (!window.confirm(msg)) return;

              try {

                await API.delete(
                  `/quotations/${r.ID}${isProtected ? "?force=true" : ""}`
                );

                load();
                loadDashStats();

              } catch (err) {

                alert(
                  err?.response?.data?.detail ||
                  "Failed to delete quotation."
                );
              }
            };

            return (

              <div
                key={r.ID}
                onClick={() => { setEditingId(r.ID); setEditorOpen(true); }}
                style={{
                  background: "white",
                  border: "1px solid #e2e8f0",
                  borderRadius: 12,
                  padding: "14px 18px",
                  display: "grid",
                  gridTemplateColumns: "180px 1fr 200px 140px 140px 60px",
                  gap: 14,
                  alignItems: "center",
                  cursor: "pointer",
                  transition: "box-shadow 0.15s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.boxShadow = "0 8px 20px rgba(15,23,42,0.1)"}
                onMouseLeave={(e) => e.currentTarget.style.boxShadow = "none"}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>
                    {r.QUOTATION_NUMBER}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
                    {r.QUOTATION_DATE}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>
                    {r.CUSTOMER_NAME || `#${r.CUSTOMER_ID}`}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>
                    {r.CUSTOMER_CODE} {r.PREPARED_BY_NAME ? `· ${r.PREPARED_BY_NAME}` : ""}
                  </div>
                </div>
                <div>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Expires</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>{r.EXPIRY_DATE || "—"}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>Total</div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: "#047857" }}>{inr(r.GRAND_TOTAL)}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <StatusPill status={r.STATUS} />
                </div>
                <div style={{ textAlign: "right" }}>
                  <button
                    onClick={deleteRow}
                    title={
                      isProtected
                        ? `Force-delete this ${r.STATUS} quotation`
                        : "Delete this quotation"
                    }
                    style={{
                      background: "white",
                      border: "1px solid #fecaca",
                      color: "#dc2626",
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      cursor: "pointer",
                      fontSize: 15,
                      fontWeight: 700,
                      transition: "all 0.15s"
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = "#dc2626";
                      e.currentTarget.style.color = "white";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = "white";
                      e.currentTarget.style.color = "#dc2626";
                    }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editorOpen && (
        <QuotationEditor
          quotationId={editingId}
          onClose={() => { setEditorOpen(false); setEditingId(null); }}
          onSaved={() => {
            setEditorOpen(false);
            setEditingId(null);
            load();
          }}
        />
      )}

    </div>
  );
}


function StatTile({ label, value, color, isText, icon }) {

  return (
    <div style={{
      background: "white",
      padding: "16px 20px",
      borderRadius: 14,
      boxShadow: "0 6px 20px rgba(15,23,42,0.07)",
      borderTop: `3px solid ${color}`,
      position: "relative",
      overflow: "hidden"
    }}>
      {icon && (
        <div style={{
          position: "absolute",
          top: 12, right: 14,
          fontSize: 20,
          opacity: 0.85
        }}>
          {icon}
        </div>
      )}
      <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{
        fontSize: isText ? 18 : 28,
        fontWeight: 800,
        color: "#0f172a",
        marginTop: 4,
        letterSpacing: -0.3
      }}>
        {value}
      </div>
    </div>
  );
}


// Indian compact currency: ₹1,23,45,678 → ₹1.23 Cr
function inrCompact(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  const v = Number(n);

  if (v >= 10000000) return "₹" + (v / 10000000).toFixed(2) + " Cr";

  if (v >= 100000)   return "₹" + (v / 100000).toFixed(2) + " L";

  if (v >= 1000)     return "₹" + (v / 1000).toFixed(1) + "k";

  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}


export default Quotations;
