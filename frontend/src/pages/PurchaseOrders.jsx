import { useEffect, useMemo, useState } from "react";

import API from "../services/api";


// ===================================================================
// PurchaseOrders — Phase 4. Procurement-side workflow for buying
// materials from suppliers. Mirrors the Quotation page UX but with
// PO-specific flows (GRN, project linking, inventory updates).
// ===================================================================


const STATUS_THEME = {
  DRAFT:            { bg: "#f1f5f9", fg: "#475569" },
  SENT:             { bg: "#dbeafe", fg: "#1d4ed8" },
  CONFIRMED:        { bg: "#fef3c7", fg: "#854d0e" },
  PARTIAL_RECEIVED: { bg: "#fae8ff", fg: "#86198f" },
  RECEIVED:         { bg: "#dcfce7", fg: "#166534" },
  CANCELLED:        { bg: "#fee2e2", fg: "#991b1b" }
};


function StatusPill({ status }) {

  const t = STATUS_THEME[status] || STATUS_THEME.DRAFT;

  return (
    <span
      style={{
        background: t.bg, color: t.fg,
        padding: "3px 10px", borderRadius: 999,
        fontSize: 10, fontWeight: 800, letterSpacing: 0.8
      }}
    >
      {String(status || "").replace(/_/g, " ")}
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
// PO Editor (new) / Detail (existing)
// =================================================================

function POEditor({ poId, onClose, onSaved }) {

  const isEdit = !!poId;

  const [po, setPo] = useState(null);

  const [loading, setLoading] = useState(isEdit);

  const [suppliers, setSuppliers] = useState([]);

  const [materials, setMaterials] = useState([]);

  const [employees, setEmployees] = useState([]);

  const [projects, setProjects] = useState([]);

  const [draft, setDraft] = useState({
    SUPPLIER_ID: "",
    PO_DATE: new Date().toISOString().slice(0, 10),
    EXPECTED_DELIVERY_DATE: "",
    DISCOUNT_PERCENT: 0,
    TAX_PERCENT: 18,
    LINKED_PROJECT_ID: "",
    PREPARED_BY: "",
    DELIVERY_ADDRESS:
      "Bharath Vending Corporation\n" +
      "Plot No. 14, Industrial Estate\n" +
      "Chennai, Tamil Nadu - 600032",
    TERMS_AND_CONDITIONS:
      "1. Delivery as per schedule above.\n" +
      "2. Payment: NET 30 days from receipt of goods.\n" +
      "3. Goods to be inspected on receipt; defects to be replaced.\n" +
      "4. All taxes are extra at applicable rates.",
    NOTES: "",
    LINES: []
  });

  const loadPO = () => {

    if (!isEdit) { setLoading(false); return; }

    setLoading(true);

    API.get(`/purchase-orders/${poId}`)
      .then((r) => setPo(r.data))
      .catch((e) => alert(e?.response?.data?.detail || "Failed to load"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {

    loadPO();

    if (!isEdit) {

      API.get("/suppliers?vendor_id=1&status=ACTIVE").then((r) => setSuppliers(r.data || []));

      API.get("/inventory").then((r) => setMaterials(r.data || []));

      API.get("/employees?status=ACTIVE").then((r) => setEmployees(r.data || []));

      API.get("/projects").then((r) => setProjects(r.data || []));
    }

  }, [poId]);

  // ============ CREATE FLOW ============
  if (!isEdit) {

    const addLine = () =>
      setDraft((d) => ({
        ...d,
        LINES: [
          ...d.LINES,
          {
            DESCRIPTION: "",
            MATERIAL_ID: "",
            HSN_CODE: "",
            QUANTITY: 1,
            UNIT: "pcs",
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

    const onMaterialPick = (idx, materialId) => {

      const m = materials.find((x) => String(x.ID) === String(materialId));

      updateLine(idx, "MATERIAL_ID", materialId);

      if (m) {

        updateLine(idx, "DESCRIPTION", m.MATERIAL_NAME);

        if (m.UNIT_PRICE) updateLine(idx, "UNIT_PRICE", m.UNIT_PRICE);
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

      if (!draft.SUPPLIER_ID) { alert("Pick a supplier"); return; }

      if (draft.LINES.length === 0) { alert("Add at least one line"); return; }

      const bad = draft.LINES.find((l) => !l.DESCRIPTION?.trim());

      if (bad) { alert("Every line needs a description"); return; }

      const payload = {
        ...draft,
        SUPPLIER_ID: Number(draft.SUPPLIER_ID),
        LINKED_PROJECT_ID: draft.LINKED_PROJECT_ID
          ? Number(draft.LINKED_PROJECT_ID) : null,
        DISCOUNT_PERCENT: Number(draft.DISCOUNT_PERCENT) || 0,
        TAX_PERCENT: Number(draft.TAX_PERCENT) || 0,
        LINES: draft.LINES.map((l, idx) => ({
          ...l,
          MATERIAL_ID: l.MATERIAL_ID ? Number(l.MATERIAL_ID) : null,
          QUANTITY: Number(l.QUANTITY) || 1,
          UNIT_PRICE: Number(l.UNIT_PRICE) || 0,
          DISCOUNT_PERCENT: Number(l.DISCOUNT_PERCENT) || 0,
          SORT_ORDER: idx
        }))
      };

      try {

        const res = await API.post("/purchase-orders", payload);

        onSaved?.(res.data?.purchase_order?.ID);

      } catch (err) {

        alert(err?.response?.data?.detail || "Failed to save");
      }
    };

    return (
      <ModalShell title="✨ New Purchase Order" onClose={onClose} wide>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
          <Field label="Supplier *">
            <select value={draft.SUPPLIER_ID} onChange={(e) => setDraft({ ...draft, SUPPLIER_ID: e.target.value })} style={inputStyle()}>
              <option value="">— pick supplier —</option>
              {suppliers.map((s) => (
                <option key={s.ID} value={s.ID}>{s.COMPANY_NAME} ({s.SUPPLIER_CODE})</option>
              ))}
            </select>
          </Field>

          <Field label="PO Date">
            <input type="date" value={draft.PO_DATE} onChange={(e) => setDraft({ ...draft, PO_DATE: e.target.value })} style={inputStyle()} />
          </Field>

          <Field label="Expected Delivery">
            <input type="date" value={draft.EXPECTED_DELIVERY_DATE} onChange={(e) => setDraft({ ...draft, EXPECTED_DELIVERY_DATE: e.target.value })} style={inputStyle()} />
          </Field>

          <Field label="Prepared By">
            <select value={draft.PREPARED_BY} onChange={(e) => setDraft({ ...draft, PREPARED_BY: e.target.value })} style={inputStyle()}>
              <option value="">— pick employee —</option>
              {employees.map((emp) => (
                <option key={emp.ID} value={emp.ID}>{emp.NAME}</option>
              ))}
            </select>
          </Field>

          <Field label="Linked Project (optional)">
            <select value={draft.LINKED_PROJECT_ID} onChange={(e) => setDraft({ ...draft, LINKED_PROJECT_ID: e.target.value })} style={inputStyle()}>
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.ID} value={p.ID}>{p.PROJECT_NAME || `Project #${p.ID}`}</option>
              ))}
            </select>
          </Field>

          <Field label="GST % / Discount %">
            <div style={{ display: "flex", gap: 6 }}>
              <input type="number" placeholder="GST" min="0" value={draft.TAX_PERCENT} onChange={(e) => setDraft({ ...draft, TAX_PERCENT: e.target.value })} style={inputStyle()} />
              <input type="number" placeholder="Disc" min="0" value={draft.DISCOUNT_PERCENT} onChange={(e) => setDraft({ ...draft, DISCOUNT_PERCENT: e.target.value })} style={inputStyle()} />
            </div>
          </Field>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#d97706", letterSpacing: 1 }}>📦 LINE ITEMS</div>
          <button type="button" onClick={addLine} style={{ border: "none", background: "linear-gradient(135deg,#F4B324,#C8102E)", color: "white", padding: "7px 14px", borderRadius: 8, fontWeight: 700, fontSize: 12, cursor: "pointer" }}>
            ➕ Add Line
          </button>
        </div>

        <div style={{ marginBottom: 16, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
                <th style={{ padding: 8, width: 40 }}>#</th>
                <th style={{ padding: 8 }}>Description</th>
                <th style={{ padding: 8, width: 160 }}>Material</th>
                <th style={{ padding: 8, width: 70 }}>HSN</th>
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
                <tr><td colSpan="10" style={{ padding: 20, textAlign: "center", color: "#94a3b8" }}>No lines yet.</td></tr>
              )}
              {draft.LINES.map((l, idx) => {

                const lineTotal = (Number(l.QUANTITY) || 0) * (Number(l.UNIT_PRICE) || 0) * (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100);

                return (
                  <tr key={idx} style={{ borderTop: "1px solid #e2e8f0" }}>
                    <td style={{ padding: 6 }}>{idx + 1}</td>
                    <td style={{ padding: 6 }}><input type="text" value={l.DESCRIPTION} onChange={(e) => updateLine(idx, "DESCRIPTION", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}>
                      <select value={l.MATERIAL_ID} onChange={(e) => onMaterialPick(idx, e.target.value)} style={inputStyle()}>
                        <option value="">— link —</option>
                        {materials.map((m) => (
                          <option key={m.ID} value={m.MATERIAL_ID || m.ID}>{m.MATERIAL_NAME}</option>
                        ))}
                      </select>
                    </td>
                    <td style={{ padding: 6 }}><input type="text" value={l.HSN_CODE} onChange={(e) => updateLine(idx, "HSN_CODE", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}><input type="number" min="0" step="0.01" value={l.QUANTITY} onChange={(e) => updateLine(idx, "QUANTITY", e.target.value)} style={inputStyle()} /></td>
                    <td style={{ padding: 6 }}><input type="text" value={l.UNIT} onChange={(e) => updateLine(idx, "UNIT", e.target.value)} style={inputStyle()} /></td>
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
          <div style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "1px solid #fcd34d", borderRadius: 12, padding: 16, minWidth: 280 }}>
            <TotalRow label="Subtotal" value={subtotal} />
            <TotalRow label={`Discount (${draft.DISCOUNT_PERCENT || 0}%)`} value={-discountAmount} />
            <TotalRow label={`GST (${draft.TAX_PERCENT || 0}%)`} value={taxAmount} />
            <div style={{ borderTop: "1px solid #f59e0b", marginTop: 6, paddingTop: 6 }}>
              <TotalRow label="Grand Total" value={grandTotal} bold large />
            </div>
          </div>
        </div>

        <Field label="Delivery Address">
          <textarea rows={2} value={draft.DELIVERY_ADDRESS} onChange={(e) => setDraft({ ...draft, DELIVERY_ADDRESS: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
        </Field>

        <Field label="Notes">
          <textarea rows={2} value={draft.NOTES} onChange={(e) => setDraft({ ...draft, NOTES: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
        </Field>

        <Field label="Terms & Conditions">
          <textarea rows={4} value={draft.TERMS_AND_CONDITIONS} onChange={(e) => setDraft({ ...draft, TERMS_AND_CONDITIONS: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} />
        </Field>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
          <button type="button" onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "white", padding: "10px 22px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
          <button type="button" onClick={save} style={{ border: "none", background: "linear-gradient(135deg,#F4B324,#E63946,#C8102E)", color: "white", padding: "10px 26px", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 6px 18px rgba(245,158,11,0.4)" }}>
            ✨ Create PO
          </button>
        </div>

      </ModalShell>
    );
  }

  // ============ DETAIL FLOW ============
  if (loading) return <ModalShell title="Loading…" onClose={onClose}><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>Loading PO…</div></ModalShell>;

  if (!po) return <ModalShell title="Not found" onClose={onClose}><div style={{ padding: 40, textAlign: "center", color: "#94a3b8" }}>PO not found</div></ModalShell>;

  return <PODetail po={po} onClose={onClose} onChanged={() => { loadPO(); onSaved?.(); }} />;
}


function PODetail({ po, onClose, onChanged }) {

  const [activity, setActivity] = useState([]);

  const [grns, setGrns] = useState([]);

  const [grnFormOpen, setGrnFormOpen] = useState(false);

  const loadActivity = () => {

    API.get(`/purchase-orders/${po.ID}/activity`)
      .then((r) => setActivity(r.data || []))
      .catch(() => setActivity([]));
  };

  const loadGRNs = () => {

    API.get(`/purchase-orders/${po.ID}/grn`)
      .then((r) => setGrns(r.data || []))
      .catch(() => setGrns([]));
  };

  useEffect(() => {

    loadActivity();

    loadGRNs();

  }, [po.ID, po.STATUS]);

  const sendNow = async () => {

    if (!window.confirm("Send this PO to the supplier (will email them)?")) return;

    try {

      const res = await API.post(`/purchase-orders/${po.ID}/send`);

      if (res.data?.email_sent) {
        alert("✅ PO sent + email delivered!");
      } else {
        alert(`⚠️ PO marked SENT but email failed:\n\n${res.data?.email_status || ""}`);
      }

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to send");
    }
  };

  const transition = async (action, body = {}) => {

    if (!window.confirm(`Confirm: ${action.toUpperCase()}?`)) return;

    try {

      await API.post(`/purchase-orders/${po.ID}/${action}`, body);

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || `Failed to ${action}`);
    }
  };

  const cancelPO = async () => {

    const reason = window.prompt("Cancellation reason (optional):");

    if (reason === null) return;

    try {

      await API.post(`/purchase-orders/${po.ID}/cancel`, { CANCEL_REASON: reason || "" });

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to cancel");
    }
  };

  const shareWhatsApp = () => {

    const phone = (po.SUPPLIER_PHONE || "").replace(/\D/g, "");

    const msg = (
      `Hi ${po.SUPPLIER_NAME || ""},\n\n` +
      `Please find our Purchase Order ${po.PO_NUMBER} attached.\n\n` +
      `Grand Total: ${inr(po.GRAND_TOTAL)}\n` +
      `Expected Delivery: ${po.EXPECTED_DELIVERY_DATE || "TBD"}\n\n` +
      `Kindly acknowledge.\n— Bharath Vending Corp.`
    );

    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`
      : `https://wa.me/?text=${encodeURIComponent(msg)}`;

    window.open(url, "_blank");
  };

  const printNow = () => window.open(`/po-print/${po.ID}`, "_blank");

  const deletePO = async () => {

    if (!window.confirm("Delete this PO permanently?")) return;

    try {

      await API.delete(`/purchase-orders/${po.ID}`);

      onClose?.();

      onChanged?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to delete");
    }
  };

  return (

    <ModalShell title={`📋 ${po.PO_NUMBER}`} onClose={onClose} wide>

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <StatusPill status={po.STATUS} />

        {po.STATUS === "DRAFT" && (
          <>
            <ActionBtn color="#f59e0b" onClick={sendNow}>📤 Send to Supplier</ActionBtn>
            <ActionBtn color="#ef4444" onClick={cancelPO}>❌ Cancel</ActionBtn>
          </>
        )}

        {po.STATUS === "SENT" && (
          <>
            <ActionBtn color="#10b981" onClick={() => transition("confirm")}>✅ Supplier Confirmed</ActionBtn>
            <ActionBtn color="#0ea5e9" onClick={() => transition("resend-email")}>📧 Resend Email</ActionBtn>
            <ActionBtn color="#ef4444" onClick={cancelPO}>❌ Cancel</ActionBtn>
          </>
        )}

        {(po.STATUS === "CONFIRMED" || po.STATUS === "PARTIAL_RECEIVED") && (
          <ActionBtn color="#0ea5e9" onClick={() => setGrnFormOpen(true)}>📦 Record Receipt (GRN)</ActionBtn>
        )}

        {(po.STATUS === "SENT" || po.STATUS === "CONFIRMED") && (
          <>
            <ActionBtn color="#25D366" onClick={shareWhatsApp}>📲 WhatsApp</ActionBtn>
          </>
        )}

        <ActionBtn color="#6366f1" onClick={printNow}>🖨️ Print / PDF</ActionBtn>

        {["DRAFT", "CANCELLED"].includes(po.STATUS) && (
          <ActionBtn color="#ef4444" onClick={deletePO}>🗑️ Delete</ActionBtn>
        )}
      </div>

      {/* Tracking banner */}
      {(po.EMAIL_SENT_AT || po.LAST_EMAIL_STATUS) && (
        <div style={{
          background: po.EMAIL_SENT_AT ? "linear-gradient(135deg,#f0fdf4,#dcfce7)" : "linear-gradient(135deg,#fee2e2,#fecaca)",
          border: po.EMAIL_SENT_AT ? "1px solid #86efac" : "1px solid #fca5a5",
          borderRadius: 10, padding: "10px 14px", marginBottom: 14,
          display: "flex", gap: 18, fontSize: 12, flexWrap: "wrap"
        }}>
          {po.EMAIL_SENT_AT ? (
            <div><b>📧 Emailed</b> {po.EMAIL_SENT_COUNT > 1 ? `(${po.EMAIL_SENT_COUNT}×)` : ""} · {new Date(po.EMAIL_SENT_AT).toLocaleString("en-IN")}</div>
          ) : po.LAST_EMAIL_STATUS && (
            <div style={{ color: "#b91c1c" }}>❌ {po.LAST_EMAIL_STATUS}</div>
          )}
        </div>
      )}

      {/* Header card */}
      <div style={{
        background: "linear-gradient(135deg,#f8fafc,#ffffff)",
        border: "1px solid #e2e8f0", borderRadius: 12, padding: 16, marginBottom: 14,
        display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12
      }}>
        <InfoBlock label="Supplier" value={po.SUPPLIER_NAME || `#${po.SUPPLIER_ID}`} sub={po.SUPPLIER_CODE} />
        <InfoBlock label="PO Date" value={po.PO_DATE || "—"} />
        <InfoBlock label="Expected Delivery" value={po.EXPECTED_DELIVERY_DATE || "—"} />
        <InfoBlock label="Prepared by" value={po.PREPARED_BY_NAME || "—"} />
        <InfoBlock label="Linked Project" value={po.LINKED_PROJECT_NAME || "—"} />
        <InfoBlock label="Supplier Contact" value={po.SUPPLIER_PHONE || "—"} sub={po.SUPPLIER_EMAIL} />
      </div>

      {/* Line items */}
      <div style={{ fontSize: 12, fontWeight: 800, color: "#d97706", letterSpacing: 1, marginBottom: 8 }}>
        📦 LINE ITEMS ({po.LINES?.length || 0})
      </div>

      <div style={{ marginBottom: 14, overflow: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
          <thead>
            <tr style={{ background: "#f8fafc", color: "#475569", textAlign: "left" }}>
              <th style={{ padding: 8, width: 40 }}>#</th>
              <th style={{ padding: 8 }}>Description</th>
              <th style={{ padding: 8, width: 70, textAlign: "right" }}>Ordered</th>
              <th style={{ padding: 8, width: 75, textAlign: "right", color: "#047857" }}>✅ Accepted</th>
              <th style={{ padding: 8, width: 75, textAlign: "right", color: "#b91c1c" }}>❌ Rejected</th>
              <th style={{ padding: 8, width: 70, textAlign: "right" }}>Pending</th>
              <th style={{ padding: 8, width: 50 }}>Unit</th>
              <th style={{ padding: 8, width: 100, textAlign: "right" }}>Rate</th>
              <th style={{ padding: 8, width: 110, textAlign: "right" }}>Total</th>
            </tr>
          </thead>
          <tbody>
            {(po.LINES || []).map((l, idx) => {

              // Use canonical fields when present, fall back to legacy aliases
              const ordered  = Number(l.ORDERED  ?? l.QUANTITY)          || 0;

              const accepted = Number(l.ACCEPTED ?? l.QUANTITY_RECEIVED) || 0;

              const rejected = Number(l.REJECTED) || 0;

              const pending  = Math.max(0, ordered - accepted);

              const fullyReceived = pending <= 0 && ordered > 0;

              return (
                <tr
                  key={l.ID}
                  style={{
                    borderTop: "1px solid #e2e8f0",
                    background: fullyReceived ? "#f0fdf4" : "white"
                  }}
                >
                  <td style={{ padding: 8 }}>{idx + 1}</td>
                  <td style={{ padding: 8 }}>{l.DESCRIPTION}</td>
                  <td style={{ padding: 8, textAlign: "right", fontWeight: 600 }}>{ordered}</td>
                  <td style={{ padding: 8, textAlign: "right", color: "#047857", fontWeight: 700 }}>
                    {accepted || 0}
                  </td>
                  <td style={{
                    padding: 8,
                    textAlign: "right",
                    color: rejected > 0 ? "#b91c1c" : "#cbd5e1",
                    fontWeight: rejected > 0 ? 700 : 400
                  }}>
                    {rejected || 0}
                  </td>
                  <td style={{
                    padding: 8,
                    textAlign: "right",
                    color: pending > 0 ? "#b91c1c" : "#94a3b8",
                    fontWeight: 700
                  }}>
                    {fullyReceived ? "✓" : pending.toFixed(2)}
                  </td>
                  <td style={{ padding: 8 }}>{l.UNIT}</td>
                  <td style={{ padding: 8, textAlign: "right" }}>{inr(l.UNIT_PRICE)}</td>
                  <td style={{ padding: 8, textAlign: "right", fontWeight: 700 }}>{inr(l.LINE_TOTAL)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 14 }}>
        <div style={{ background: "linear-gradient(135deg,#fef3c7,#fde68a)", border: "1px solid #fcd34d", borderRadius: 12, padding: 16, minWidth: 280 }}>
          <TotalRow label="Subtotal" value={po.SUBTOTAL} />
          {po.DISCOUNT_PERCENT > 0 && <TotalRow label={`Discount (${po.DISCOUNT_PERCENT}%)`} value={-po.DISCOUNT_AMOUNT} />}
          <TotalRow label={`GST (${po.TAX_PERCENT}%)`} value={po.TAX_AMOUNT} />
          <div style={{ borderTop: "1px solid #f59e0b", marginTop: 6, paddingTop: 6 }}>
            <TotalRow label="Grand Total" value={po.GRAND_TOTAL} bold large />
          </div>
        </div>
      </div>

      {/* GRNs section */}
      {grns.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#0ea5e9", letterSpacing: 1, marginBottom: 8 }}>
            📥 GOODS RECEIPTS ({grns.length})
          </div>

          {grns.map((g) => {

            const accepted = g.TOTAL_ACCEPTED
              ?? g.LINES.reduce((s, l) => s + (l.QUANTITY_RECEIVED || 0), 0);

            const rejected = g.TOTAL_REJECTED
              ?? g.LINES.reduce((s, l) => s + (l.QUANTITY_REJECTED || 0), 0);

            const finalizeGRN = async () => {

              if (!window.confirm(
                "Finalize this GRN?\n\n" +
                `${accepted} unit(s) will be added to Inventory.\n` +
                `${rejected} unit(s) marked rejected (audit-only).\n\n` +
                (rejected > 0
                  ? `📧 A rejection notice will be auto-emailed to the supplier.\n\n`
                  : "") +
                "This action cannot be undone."
              )) return;

              try {
                const res = await API.post(`/purchase-orders/grn/${g.ID}/finalize`);

                // Surface the rejection-notice outcome if any
                const rn = res?.data?.rejection_notice;

                if (rn) {

                  if (rn.sent) {
                    alert(
                      "✅ GRN finalized\n\n" +
                      `📧 Rejection notice emailed to supplier:\n${rn.detail}`
                    );
                  } else if (!/No rejected lines/i.test(rn.detail || "")) {
                    alert(
                      "⚠️ GRN finalized BUT rejection-notice email failed:\n\n" +
                      `${rn.detail}\n\n` +
                      "Use the 📧 button on the GRN card to retry."
                    );
                  }
                }

                loadGRNs();
                onChanged?.();
              } catch (e) {
                alert(e?.response?.data?.detail || "Failed");
              }
            };

            const resendRejectionNotice = async () => {

              if (!window.confirm(
                "Resend the rejection notice email to the supplier?"
              )) return;

              try {

                const res = await API.post(
                  `/purchase-orders/grn/${g.ID}/resend-rejection-notice`
                );

                if (res?.data?.sent) {
                  alert("📧 Rejection notice resent to supplier");
                } else {
                  alert(`⚠️ Send failed: ${res?.data?.detail || "unknown"}`);
                }

                loadGRNs();
                onChanged?.();

              } catch (e) {

                alert(e?.response?.data?.detail || "Failed");
              }
            };

            const deleteGRN = async () => {

              if (!window.confirm("Delete this DRAFT GRN?")) return;

              try {
                await API.delete(`/purchase-orders/grn/${g.ID}`);
                loadGRNs();
                onChanged?.();
              } catch (e) {
                alert(e?.response?.data?.detail || "Failed");
              }
            };

            return (
              <div
                key={g.ID}
                style={{
                  border: "1px solid #e2e8f0",
                  borderRadius: 10,
                  padding: "12px 16px",
                  marginBottom: 8,
                  background: g.STATUS === "FINAL" ? "#f0fdf4" : "#fffbeb"
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 14 }}>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 800, fontSize: 14 }}>
                        {g.GRN_NUMBER}
                      </span>
                      <span style={{
                        background: g.STATUS === "FINAL" ? "#dcfce7" : "#fef3c7",
                        color: g.STATUS === "FINAL" ? "#166534" : "#854d0e",
                        padding: "3px 10px", borderRadius: 999,
                        fontSize: 10, fontWeight: 800, letterSpacing: 0.6
                      }}>
                        {g.STATUS}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
                      📅 {g.RECEIVED_DATE} · 👤 {g.RECEIVED_BY_NAME || "—"}
                      {g.INVOICE_NUMBER ? ` · 🧾 Inv: ${g.INVOICE_NUMBER}` : ""}
                    </div>

                    {/* Receipt summary chips */}
                    <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                      <span style={{
                        background: "#dcfce7", color: "#166534",
                        padding: "3px 9px", borderRadius: 6,
                        fontSize: 11, fontWeight: 700
                      }}>
                        ✅ Accepted: {accepted}
                      </span>
                      {rejected > 0 && (
                        <span style={{
                          background: "#fee2e2", color: "#991b1b",
                          padding: "3px 9px", borderRadius: 6,
                          fontSize: 11, fontWeight: 700
                        }}>
                          ❌ Rejected: {rejected}
                        </span>
                      )}
                      <span style={{
                        background: "#e0e7ff", color: "#4338ca",
                        padding: "3px 9px", borderRadius: 6,
                        fontSize: 11, fontWeight: 700
                      }}>
                        📦 {g.LINES.length} line(s)
                      </span>
                    </div>

                    {/* Show line-level rejection reasons if any */}
                    {g.LINES.some((l) => Number(l.QUANTITY_REJECTED) > 0) && (
                      <div style={{ marginTop: 8, padding: "6px 10px", background: "#fee2e2", borderRadius: 6, fontSize: 11, color: "#991b1b" }}>
                        {g.LINES.filter((l) => Number(l.QUANTITY_REJECTED) > 0).map((l, i) => (
                          <div key={i}>
                            <b>{l.DESCRIPTION || `Line #${l.PO_LINE_ID}`}:</b>{" "}
                            {l.QUANTITY_REJECTED} {l.UNIT || "unit(s)"} rejected
                            {l.REJECTION_REASON ? ` — "${l.REJECTION_REASON}"` : ""}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>

                    <button
                      onClick={() => window.open(`/grn-print/${g.ID}`, "_blank")}
                      title="Print / PDF"
                      style={{
                        border: "1px solid #cbd5e1",
                        background: "white",
                        padding: "5px 10px",
                        borderRadius: 6,
                        fontSize: 11,
                        cursor: "pointer"
                      }}
                    >
                      🖨️
                    </button>

                    {/* Resend rejection notice — shown only when GRN is
                        FINAL AND has rejected lines. Lets you re-chase
                        the supplier or recover from a previous email
                        failure. */}
                    {g.STATUS === "FINAL" && rejected > 0 && (
                      <button
                        onClick={resendRejectionNotice}
                        title="Resend rejection notice to supplier"
                        style={{
                          border: "1px solid #fecaca",
                          background: "#fef2f2",
                          color: "#b91c1c",
                          padding: "5px 10px",
                          borderRadius: 6,
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: "pointer"
                        }}
                      >
                        📧 Notify
                      </button>
                    )}

                    {g.STATUS === "DRAFT" && (
                      <>
                        <button
                          onClick={finalizeGRN}
                          style={{
                            border: "none",
                            background: "#10b981",
                            color: "white",
                            padding: "5px 12px",
                            borderRadius: 6,
                            fontSize: 11,
                            fontWeight: 700,
                            cursor: "pointer"
                          }}
                        >
                          ✓ Finalize
                        </button>

                        <button
                          onClick={deleteGRN}
                          title="Delete draft"
                          style={{
                            border: "1px solid #fecaca",
                            background: "#fef2f2",
                            color: "#b91c1c",
                            padding: "5px 10px",
                            borderRadius: 6,
                            fontSize: 11,
                            cursor: "pointer"
                          }}
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Activity timeline */}
      {activity.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: "#0ea5e9", letterSpacing: 1, marginBottom: 8 }}>📋 ACTIVITY TIMELINE</div>
          <div style={{ background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10, padding: "12px 16px" }}>
            {activity.map((a, idx) => {

              const icons = {
                CREATED: "📝", SENT: "📤", EMAIL_SENT: "📧", EMAIL_FAILED: "⚠️",
                CONFIRMED: "✅", GRN_RECORDED: "📥", GRN_FINALIZED: "📦",
                CANCELLED: "❌", RECEIVED: "🎉",
                REJECTION_NOTICE_SENT: "🚨", REJECTION_NOTICE_FAILED: "⚠️"
              };

              const removeActivity = async () => {

                if (!window.confirm("Remove this activity entry?")) return;

                try {
                  await API.delete(`/purchase-orders/${po.ID}/activity/${a.ID}`);
                  loadActivity();
                } catch (e) {
                  alert(e?.response?.data?.detail || "Failed");
                }
              };

              return (
                <div key={a.ID} style={{ display: "flex", gap: 12, padding: "8px 0", borderTop: idx === 0 ? "none" : "1px solid #e2e8f0", alignItems: "flex-start" }}>
                  <div style={{ fontSize: 18, width: 26 }}>{icons[a.EVENT_TYPE] || "•"}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 700 }}>{a.EVENT_TYPE.replace(/_/g, " ")}</div>
                    {a.EVENT_DETAIL && <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>{a.EVENT_DETAIL}</div>}
                    <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>{a.CREATED_AT ? new Date(a.CREATED_AT).toLocaleString("en-IN") : ""}</div>
                  </div>
                  <button onClick={removeActivity} style={{ border: "1px solid #e2e8f0", background: "white", color: "#94a3b8", width: 24, height: 24, borderRadius: "50%", cursor: "pointer", fontSize: 12, padding: 0 }}>×</button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {grnFormOpen && (
        <GRNForm
          po={po}
          onCancel={() => setGrnFormOpen(false)}
          onSaved={() => { setGrnFormOpen(false); loadGRNs(); onChanged?.(); }}
        />
      )}

    </ModalShell>
  );
}


function GRNForm({ po, onCancel, onSaved }) {

  // Lines still owed from the supplier (Ordered - Accepted > 0)
  const pendingLines = (po.LINES || []).filter((l) => {

    const ordered  = Number(l.ORDERED  ?? l.QUANTITY)          || 0;

    const accepted = Number(l.ACCEPTED ?? l.QUANTITY_RECEIVED) || 0;

    return ordered - accepted > 0;
  });

  const [data, setData] = useState({
    RECEIVED_DATE: new Date().toISOString().slice(0, 10),
    RECEIVED_BY: "",
    INVOICE_NUMBER: "",
    NOTES: "",
    FINALIZE: true,
    LINES: pendingLines.map((l) => {

      const ordered  = Number(l.ORDERED  ?? l.QUANTITY)          || 0;

      const accepted = Number(l.ACCEPTED ?? l.QUANTITY_RECEIVED) || 0;

      const pending = ordered - accepted;

      return {
        PO_LINE_ID: l.ID,
        DESCRIPTION: l.DESCRIPTION,
        UNIT: l.UNIT,
        ORDERED: ordered,
        PREV_ACCEPTED: accepted,
        PENDING: pending,
        // Pre-fill: "receive everything that's pending"
        ACCEPTED: pending,
        REJECTED: 0,
        REJECTION_REASON: ""
      };
    })
  });

  const [employees, setEmployees] = useState([]);

  const [saving, setSaving] = useState(false);

  useEffect(() => {

    API.get("/employees?status=ACTIVE").then((r) => setEmployees(r.data || []));

  }, []);

  const updateLine = (idx, field, value) =>
    setData((d) => ({
      ...d,
      LINES: d.LINES.map((l, i) => i === idx ? { ...l, [field]: value } : l)
    }));

  // ---- Live validation + summary ----
  const lineProblems = data.LINES.map((l) => {

    const accepted = Number(l.ACCEPTED) || 0;

    const rejected = Number(l.REJECTED) || 0;

    if (accepted < 0 || rejected < 0) {

      return "Quantities can't be negative";
    }

    if (accepted > l.PENDING + 0.001) {

      return `Accepted ${accepted} exceeds pending ${l.PENDING}`;
    }

    if (rejected > 0 && !(l.REJECTION_REASON || "").trim()) {

      return "Rejected qty needs a reason";
    }

    return null;
  });

  const hasErrors = lineProblems.some(Boolean);

  const totals = data.LINES.reduce(
    (acc, l) => ({
      ordered:  acc.ordered  + l.ORDERED,
      accepted: acc.accepted + (Number(l.ACCEPTED) || 0),
      rejected: acc.rejected + (Number(l.REJECTED) || 0)
    }),
    { ordered: 0, accepted: 0, rejected: 0 }
  );

  const totalArrived = totals.accepted + totals.rejected;

  const save = async () => {

    const goodLines = data.LINES.filter(
      (l) => Number(l.ACCEPTED) > 0 || Number(l.REJECTED) > 0
    );

    if (goodLines.length === 0) {

      alert("Enter at least one accepted or rejected quantity");

      return;
    }

    if (hasErrors) {

      alert("Please fix the highlighted line errors before saving");

      return;
    }

    setSaving(true);

    try {

      await API.post(`/purchase-orders/${po.ID}/grn`, {
        PO_ID: po.ID,
        RECEIVED_DATE: data.RECEIVED_DATE,
        RECEIVED_BY: data.RECEIVED_BY || null,
        INVOICE_NUMBER: data.INVOICE_NUMBER || null,
        NOTES: data.NOTES || null,
        FINALIZE: data.FINALIZE,
        LINES: goodLines.map((l) => ({
          PO_LINE_ID: l.PO_LINE_ID,
          QUANTITY_RECEIVED: Number(l.ACCEPTED) || 0,
          QUANTITY_REJECTED: Number(l.REJECTED) || 0,
          REJECTION_REASON: l.REJECTION_REASON || null
        }))
      });

      onSaved?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to save GRN");

    } finally {

      setSaving(false);
    }
  };

  return (
    <ModalShell title={`📥 Record Goods Receipt — ${po.PO_NUMBER}`} onClose={onCancel} wide>

      {/* Context banner: supplier + PO summary */}
      <div style={{
        background: "linear-gradient(135deg,#dbeafe,#eef2ff)",
        border: "1px solid #c7d2fe",
        borderRadius: 10,
        padding: "10px 14px",
        marginBottom: 16,
        fontSize: 12,
        color: "#4338ca"
      }}>
        <b>Supplier:</b> {po.SUPPLIER_NAME || `#${po.SUPPLIER_ID}`}{" "}
        ({po.SUPPLIER_CODE || "—"}) ·
        <b> PO:</b> {po.PO_NUMBER} ·
        <b> Expected:</b> {po.EXPECTED_DELIVERY_DATE || "—"}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12, marginBottom: 16 }}>
        <Field label="Received Date *">
          <input type="date" value={data.RECEIVED_DATE} onChange={(e) => setData({ ...data, RECEIVED_DATE: e.target.value })} style={inputStyle()} />
        </Field>
        <Field label="Received By (Warehouse Person)">
          <select value={data.RECEIVED_BY} onChange={(e) => setData({ ...data, RECEIVED_BY: e.target.value })} style={inputStyle()}>
            <option value="">— pick employee —</option>
            {employees.map((e) => <option key={e.ID} value={e.ID}>{e.NAME}</option>)}
          </select>
        </Field>
        <Field label="Supplier Invoice / Challan #">
          <input type="text" value={data.INVOICE_NUMBER} onChange={(e) => setData({ ...data, INVOICE_NUMBER: e.target.value })} style={inputStyle()} placeholder="INV-12345" />
        </Field>
      </div>

      {data.LINES.length === 0 && (
        <div style={{
          padding: 20,
          textAlign: "center",
          background: "#f0fdf4",
          border: "1px dashed #86efac",
          borderRadius: 10,
          color: "#166534",
          fontSize: 13,
          marginBottom: 14
        }}>
          ✅ All PO lines already fully received. Nothing pending.
        </div>
      )}

      {data.LINES.length > 0 && (
        <div style={{ marginBottom: 14, overflow: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#f8fafc", textAlign: "left", color: "#475569" }}>
                <th style={{ padding: 8 }}>Material / Description</th>
                <th style={{ padding: 8, width: 80, textAlign: "right" }}>Ordered</th>
                <th style={{ padding: 8, width: 80, textAlign: "right" }}>Pending</th>
                <th style={{ padding: 8, width: 110, color: "#047857" }}>✅ Accepted</th>
                <th style={{ padding: 8, width: 110, color: "#b91c1c" }}>❌ Rejected</th>
                <th style={{ padding: 8 }}>Reject Reason</th>
              </tr>
            </thead>
            <tbody>
              {data.LINES.map((l, idx) => {

                const err = lineProblems[idx];

                return (
                  <tr
                    key={l.PO_LINE_ID}
                    style={{
                      borderTop: "1px solid #e2e8f0",
                      background: err ? "#fef2f2" : "white"
                    }}
                  >
                    <td style={{ padding: 8 }}>
                      <div>{l.DESCRIPTION}</div>
                      <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
                        Unit: {l.UNIT || "pcs"}
                      </div>
                      {err && (
                        <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 4, fontWeight: 700 }}>
                          ⚠ {err}
                        </div>
                      )}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", color: "#475569", fontWeight: 600 }}>
                      {l.ORDERED}
                    </td>
                    <td style={{ padding: 8, textAlign: "right", color: "#b91c1c", fontWeight: 700 }}>
                      {l.PENDING}
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min="0"
                        max={l.PENDING}
                        step="0.01"
                        value={l.ACCEPTED}
                        onChange={(e) => updateLine(idx, "ACCEPTED", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.REJECTED}
                        onChange={(e) => updateLine(idx, "REJECTED", e.target.value)}
                        style={inputStyle()}
                      />
                    </td>
                    <td style={{ padding: 6 }}>
                      <input
                        type="text"
                        value={l.REJECTION_REASON}
                        onChange={(e) => updateLine(idx, "REJECTION_REASON", e.target.value)}
                        style={inputStyle()}
                        placeholder={
                          Number(l.REJECTED) > 0
                            ? "Damaged / wrong spec / short qty..."
                            : "—"
                        }
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Live totals summary */}
      {data.LINES.length > 0 && (
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
          marginBottom: 14
        }}>
          <SummaryTile label="Total Ordered" value={totals.ordered} color="#475569" />
          <SummaryTile label="Total Arrived" value={totalArrived} color="#0ea5e9" sub="accepted + rejected" />
          <SummaryTile label="✅ Accepted" value={totals.accepted} color="#10b981" sub="→ goes to Inventory" />
          <SummaryTile label="❌ Rejected" value={totals.rejected} color="#ef4444" sub="audit-only, sent back" />
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea rows={2} value={data.NOTES} onChange={(e) => setData({ ...data, NOTES: e.target.value })} style={{ ...inputStyle(), resize: "vertical" }} placeholder="Truck number, delivery time, anything worth noting..." />
      </Field>

      <label style={{ display: "flex", alignItems: "flex-start", gap: 10, marginTop: 12, padding: 12, background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: 8, fontSize: 13, cursor: "pointer" }}>
        <input type="checkbox" checked={data.FINALIZE} onChange={(e) => setData({ ...data, FINALIZE: e.target.checked })} style={{ width: 18, height: 18, marginTop: 2 }} />
        <span>
          <b>Finalize immediately</b> — Inventory will be updated with the
          accepted quantities ({totals.accepted} units). Uncheck to save as
          DRAFT for warehouse supervisor review.
        </span>
      </label>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 16 }}>
        <button onClick={onCancel} disabled={saving} style={{ border: "1px solid #e2e8f0", background: "white", padding: "9px 18px", borderRadius: 8, cursor: saving ? "not-allowed" : "pointer", fontSize: 13 }}>Cancel</button>
        <button
          onClick={save}
          disabled={saving || hasErrors || data.LINES.length === 0}
          style={{
            border: "none",
            background: (saving || hasErrors || data.LINES.length === 0)
              ? "#94a3b8"
              : "linear-gradient(135deg,#C8102E,#8B0B1F)",
            color: "white",
            padding: "9px 22px",
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 13,
            cursor: (saving || hasErrors || data.LINES.length === 0) ? "not-allowed" : "pointer"
          }}
        >
          {saving
            ? "Saving…"
            : (data.FINALIZE ? "💾 Save & Finalize" : "💾 Save Draft")}
        </button>
      </div>

    </ModalShell>
  );
}


// =================================================================
// Auto-from-Project picker
// =================================================================

function AutoFromProjectModal({ onClose, onCreated }) {

  const [projects, setProjects] = useState([]);

  const [projectId, setProjectId] = useState("");

  const [employees, setEmployees] = useState([]);

  const [prepBy, setPrepBy] = useState("");

  const [eta, setEta] = useState("");

  const [creating, setCreating] = useState(false);

  useEffect(() => {

    API.get("/projects").then((r) => setProjects(r.data || []));

    API.get("/employees?status=ACTIVE").then((r) => setEmployees(r.data || []));

  }, []);

  const submit = async () => {

    if (!projectId) { alert("Pick a project"); return; }

    setCreating(true);

    try {

      const res = await API.post("/purchase-orders/auto-from-project", {
        PROJECT_ID: Number(projectId),
        EXPECTED_DELIVERY_DATE: eta || null,
        PREPARED_BY: prepBy || null,
        VENDOR_ID: 1
      });

      const summary =
        `${res.data.message}\n\n` +
        (res.data.pos_created || []).map((p) => `${p.PO_NUMBER} → Supplier #${p.SUPPLIER_ID} · ${inr(p.GRAND_TOTAL)}`).join("\n") +
        (res.data.unassigned_materials?.length
          ? `\n\n⚠️ ${res.data.unassigned_materials.length} BOM item(s) skipped (no preferred supplier). Assign in BOM/Purchase page and re-run.`
          : "");

      alert(summary);

      onCreated?.();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed");

    } finally {

      setCreating(false);
    }
  };

  return (
    <ModalShell title="🤖 Auto-create POs from Project BOM" onClose={onClose}>

      <div style={{ background: "#f0f9ff", border: "1px solid #bae6fd", borderRadius: 10, padding: 12, fontSize: 12, color: "#0c4a6e", marginBottom: 16 }}>
        Reads the project's product BOM → groups items by their
        PREFERRED_SUPPLIER → creates one DRAFT PO per supplier with
        Inventory unit prices. Items without a preferred supplier are
        skipped (set them in the Purchase / BOM page first).
      </div>

      <Field label="Project *">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} style={inputStyle()}>
          <option value="">— pick project —</option>
          {projects.map((p) => (
            <option key={p.ID} value={p.ID}>{p.PROJECT_NAME || `Project #${p.ID}`}</option>
          ))}
        </select>
      </Field>

      <div style={{ height: 12 }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Expected Delivery">
          <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} style={inputStyle()} />
        </Field>
        <Field label="Prepared By">
          <select value={prepBy} onChange={(e) => setPrepBy(e.target.value)} style={inputStyle()}>
            <option value="">— none —</option>
            {employees.map((e) => <option key={e.ID} value={e.ID}>{e.NAME}</option>)}
          </select>
        </Field>
      </div>

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 18 }}>
        <button onClick={onClose} style={{ border: "1px solid #e2e8f0", background: "white", padding: "9px 18px", borderRadius: 8, cursor: "pointer", fontSize: 13 }}>Cancel</button>
        <button onClick={submit} disabled={creating} style={{ border: "none", background: creating ? "#94a3b8" : "linear-gradient(135deg,#C8102E,#8B0B1F)", color: "white", padding: "9px 22px", borderRadius: 8, fontWeight: 800, fontSize: 13, cursor: creating ? "not-allowed" : "pointer" }}>
          {creating ? "Creating…" : "🤖 Generate POs"}
        </button>
      </div>

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
    <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: large ? 16 : 13, fontWeight: bold ? 800 : 500, color: bold ? "#b45309" : "#475569" }}>
      <span>{label}</span><span>{inr(value)}</span>
    </div>
  );
}


function SummaryTile({ label, value, color, sub }) {

  return (
    <div style={{
      background: "white",
      border: `1px solid ${color}33`,
      borderLeft: `4px solid ${color}`,
      borderRadius: 8,
      padding: "10px 14px"
    }}>
      <div style={{ fontSize: 10, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 1, fontWeight: 700 }}>
        {label}
      </div>
      <div style={{ fontSize: 22, fontWeight: 800, color, marginTop: 2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 2 }}>
          {sub}
        </div>
      )}
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

function PurchaseOrders() {

  const [rows, setRows] = useState([]);

  const [loading, setLoading] = useState(true);

  const [statusFilter, setStatusFilter] = useState("");

  const [search, setSearch] = useState("");

  const [editorOpen, setEditorOpen] = useState(false);

  const [editingId, setEditingId] = useState(null);

  const [autoOpen, setAutoOpen] = useState(false);

  const load = () => {

    setLoading(true);

    const params = statusFilter ? `?status=${statusFilter}` : "";

    API.get(`/purchase-orders${params}`)
      .then((r) => setRows(r.data || []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, [statusFilter]);

  const filtered = useMemo(() => {

    const s = search.trim().toLowerCase();

    if (!s) return rows;

    return rows.filter(
      (r) =>
        (r.PO_NUMBER || "").toLowerCase().includes(s) ||
        (r.SUPPLIER_NAME || "").toLowerCase().includes(s) ||
        (r.SUPPLIER_CODE || "").toLowerCase().includes(s)
    );

  }, [rows, search]);

  const stats = useMemo(() => {

    const s = { total: rows.length, draft: 0, sent: 0, received: 0, value: 0 };

    rows.forEach((r) => {

      if (r.STATUS === "DRAFT") s.draft++;
      if (r.STATUS === "SENT" || r.STATUS === "CONFIRMED") s.sent++;
      if (r.STATUS === "RECEIVED" || r.STATUS === "PARTIAL_RECEIVED") s.received++;

      s.value += r.GRAND_TOTAL || 0;
    });

    return s;

  }, [rows]);

  return (

    <div style={{ padding: 24 }}>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>📋 Purchase Orders</h1>
          <div style={{ color: "#64748b", fontSize: 13, marginTop: 4 }}>
            Procurement — issue POs to suppliers, track receipts, update inventory
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => setAutoOpen(true)} style={{ border: "1px solid #c7d2fe", background: "white", color: "#4338ca", padding: "11px 18px", borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
            🤖 Auto-from-Project
          </button>
          <button onClick={() => { setEditingId(null); setEditorOpen(true); }} style={{ border: "none", background: "linear-gradient(135deg,#F4B324,#E63946,#C8102E)", color: "white", padding: "11px 22px", borderRadius: 10, fontWeight: 800, fontSize: 13, cursor: "pointer", boxShadow: "0 6px 18px rgba(245,158,11,0.4)" }}>
            ✨ New PO
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 14, marginBottom: 20 }}>
        <StatTile label="Total POs" value={stats.total} color="#6366f1" />
        <StatTile label="Draft" value={stats.draft} color="#94a3b8" />
        <StatTile label="Open (Sent + Confirmed)" value={stats.sent} color="#f59e0b" />
        <StatTile label="Total Value" value={inr(stats.value)} color="#10b981" isText />
      </div>

      <div style={{ display: "flex", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
        <input type="text" placeholder="🔍 Search by PO#, supplier..." value={search} onChange={(e) => setSearch(e.target.value)} style={{ ...inputStyle(), maxWidth: 320 }} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ ...inputStyle(), maxWidth: 220 }}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PARTIAL_RECEIVED">Partial Received</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {loading && <div style={{ padding: 30, textAlign: "center", color: "#94a3b8" }}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div style={{ padding: 40, textAlign: "center", border: "1px dashed #cbd5e1", borderRadius: 12, color: "#64748b" }}>
          No purchase orders yet. Click <b>New PO</b> or <b>Auto-from-Project</b> to start.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {filtered.map((r) => (
            <div key={r.ID} onClick={() => { setEditingId(r.ID); setEditorOpen(true); }} style={{ background: "white", border: "1px solid #e2e8f0", borderRadius: 12, padding: "14px 18px", display: "grid", gridTemplateColumns: "180px 1fr 180px 140px 160px", gap: 14, alignItems: "center", cursor: "pointer" }}>
              <div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>{r.PO_NUMBER}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{r.PO_DATE}</div>
              </div>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a" }}>{r.SUPPLIER_NAME || `#${r.SUPPLIER_ID}`}</div>
                <div style={{ fontSize: 11, color: "#64748b" }}>{r.SUPPLIER_CODE}{r.LINKED_PROJECT_NAME ? ` · 📁 ${r.LINKED_PROJECT_NAME}` : ""}</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Expected Delivery</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{r.EXPECTED_DELIVERY_DATE || "—"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 11, color: "#94a3b8" }}>Total</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#b45309" }}>{inr(r.GRAND_TOTAL)}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <StatusPill status={r.STATUS} />
              </div>
            </div>
          ))}
        </div>
      )}

      {editorOpen && (
        <POEditor
          poId={editingId}
          onClose={() => { setEditorOpen(false); setEditingId(null); }}
          onSaved={() => { setEditorOpen(false); setEditingId(null); load(); }}
        />
      )}

      {autoOpen && (
        <AutoFromProjectModal
          onClose={() => setAutoOpen(false)}
          onCreated={() => { setAutoOpen(false); load(); }}
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


export default PurchaseOrders;
