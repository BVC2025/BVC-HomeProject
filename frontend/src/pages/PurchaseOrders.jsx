import { useEffect, useMemo, useState } from "react";
import styles from "./PurchaseOrders.module.css";
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
      className={styles.statusPill}
      style={{ background: t.bg, color: t.fg }}
    >
      {String(status || "").replace(/_/g, " ")}
    </span>
  );
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

        <div className={styles.formGrid3}>
          <Field label="Supplier *">
            <select value={draft.SUPPLIER_ID} onChange={(e) => setDraft({ ...draft, SUPPLIER_ID: e.target.value })} className={styles.input}>
              <option value="">— pick supplier —</option>
              {suppliers.map((s) => (
                <option key={s.ID} value={s.ID}>{s.COMPANY_NAME} ({s.SUPPLIER_CODE})</option>
              ))}
            </select>
          </Field>

          <Field label="PO Date">
            <input type="date" value={draft.PO_DATE} onChange={(e) => setDraft({ ...draft, PO_DATE: e.target.value })} className={styles.input} />
          </Field>

          <Field label="Expected Delivery">
            <input type="date" value={draft.EXPECTED_DELIVERY_DATE} onChange={(e) => setDraft({ ...draft, EXPECTED_DELIVERY_DATE: e.target.value })} className={styles.input} />
          </Field>

          <Field label="Prepared By">
            <select value={draft.PREPARED_BY} onChange={(e) => setDraft({ ...draft, PREPARED_BY: e.target.value })} className={styles.input}>
              <option value="">— pick employee —</option>
              {employees.map((emp) => (
                <option key={emp.ID} value={emp.ID}>{emp.NAME}</option>
              ))}
            </select>
          </Field>

          <Field label="Linked Project (optional)">
            <select value={draft.LINKED_PROJECT_ID} onChange={(e) => setDraft({ ...draft, LINKED_PROJECT_ID: e.target.value })} className={styles.input}>
              <option value="">— none —</option>
              {projects.map((p) => (
                <option key={p.ID} value={p.ID}>{p.PROJECT_NAME || `Project #${p.ID}`}</option>
              ))}
            </select>
          </Field>

          <Field label="GST % / Discount %">
            <div className={styles.inputDualWrap}>
              <input type="number" placeholder="GST" min="0" value={draft.TAX_PERCENT} onChange={(e) => setDraft({ ...draft, TAX_PERCENT: e.target.value })} className={styles.input} />
              <input type="number" placeholder="Disc" min="0" value={draft.DISCOUNT_PERCENT} onChange={(e) => setDraft({ ...draft, DISCOUNT_PERCENT: e.target.value })} className={styles.input} />
            </div>
          </Field>
        </div>

        <div className={styles.lineItemsHeader}>
          <div className={styles.lineItemsLabel}>📦 LINE ITEMS</div>
          <button type="button" onClick={addLine} className={styles.btnAddLine}>
            ➕ Add Line
          </button>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                <th className={styles.thW40}>#</th>
                <th>Description</th>
                <th className={styles.thW160}>Material</th>
                <th className={styles.thW70}>HSN</th>
                <th className={styles.thW70}>Qty</th>
                <th className={styles.thW60}>Unit</th>
                <th className={styles.thW110}>Unit Price</th>
                <th className={styles.thW70}>Disc%</th>
                <th className={`${styles.thW110} ${styles.tdAlignRight}`}>Total</th>
                <th className={styles.thW40}></th>
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              {draft.LINES.length === 0 && (
                <tr><td colSpan="10" className={styles.tableEmptyRow}>No lines yet.</td></tr>
              )}
              {draft.LINES.map((l, idx) => {

                const lineTotal = (Number(l.QUANTITY) || 0) * (Number(l.UNIT_PRICE) || 0) * (1 - (Number(l.DISCOUNT_PERCENT) || 0) / 100);

                return (
                  <tr key={idx}>
                    <td className={styles.tdPadSm}>{idx + 1}</td>
                    <td className={styles.tdPadSm}><input type="text" value={l.DESCRIPTION} onChange={(e) => updateLine(idx, "DESCRIPTION", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tdPadSm}>
                      <select value={l.MATERIAL_ID} onChange={(e) => onMaterialPick(idx, e.target.value)} className={styles.input}>
                        <option value="">— link —</option>
                        {materials.map((m) => (
                          <option key={m.ID} value={m.MATERIAL_ID || m.ID}>{m.MATERIAL_NAME}</option>
                        ))}
                      </select>
                    </td>
                    <td className={styles.tdPadSm}><input type="text" value={l.HSN_CODE} onChange={(e) => updateLine(idx, "HSN_CODE", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tdPadSm}><input type="number" min="0" step="0.01" value={l.QUANTITY} onChange={(e) => updateLine(idx, "QUANTITY", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tdPadSm}><input type="text" value={l.UNIT} onChange={(e) => updateLine(idx, "UNIT", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tdPadSm}><input type="number" min="0" step="0.01" value={l.UNIT_PRICE} onChange={(e) => updateLine(idx, "UNIT_PRICE", e.target.value)} className={styles.input} /></td>
                    <td className={styles.tdPadSm}><input type="number" min="0" step="0.1" value={l.DISCOUNT_PERCENT} onChange={(e) => updateLine(idx, "DISCOUNT_PERCENT", e.target.value)} className={styles.input} /></td>
                    <td className={`${styles.tdPadSm} ${styles.tdAlignRightXB}`}>{inr(lineTotal)}</td>
                    <td className={styles.tdPadSm}>
                      <button type="button" onClick={() => removeLine(idx)} className={styles.btnGrnDelete}>🗑</button>
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

        <Field label="Delivery Address">
          <textarea rows={2} value={draft.DELIVERY_ADDRESS} onChange={(e) => setDraft({ ...draft, DELIVERY_ADDRESS: e.target.value })} className={`${styles.input} ${styles.inputResizable}`} />
        </Field>

        <Field label="Notes">
          <textarea rows={2} value={draft.NOTES} onChange={(e) => setDraft({ ...draft, NOTES: e.target.value })} className={`${styles.input} ${styles.inputResizable}`} />
        </Field>

        <Field label="Terms & Conditions">
          <textarea rows={4} value={draft.TERMS_AND_CONDITIONS} onChange={(e) => setDraft({ ...draft, TERMS_AND_CONDITIONS: e.target.value })} className={`${styles.input} ${styles.inputResizable}`} />
        </Field>

        <div className={styles.modalFooter}>
          <button type="button" onClick={onClose} className={styles.btnCancelWide}>Cancel</button>
          <button type="button" onClick={save} className={styles.btnCreatePO}>
            ✨ Create PO
          </button>
        </div>

      </ModalShell>
    );
  }

  // ============ DETAIL FLOW ============
  if (loading) return <ModalShell title="Loading…" onClose={onClose}><div className={styles.loadingState}>Loading PO…</div></ModalShell>;

  if (!po) return <ModalShell title="Not found" onClose={onClose}><div className={styles.loadingState}>PO not found</div></ModalShell>;

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
      <div className={styles.detailActionRow}>
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
        <div className={`${styles.trackingBanner} ${po.EMAIL_SENT_AT ? styles.trackingBannerSuccess : styles.trackingBannerFail}`}>
          {po.EMAIL_SENT_AT ? (
            <div><b>📧 Emailed</b> {po.EMAIL_SENT_COUNT > 1 ? `(${po.EMAIL_SENT_COUNT}×)` : ""} · {new Date(po.EMAIL_SENT_AT).toLocaleString("en-IN")}</div>
          ) : po.LAST_EMAIL_STATUS && (
            <div className={styles.trackingBannerFailText}>❌ {po.LAST_EMAIL_STATUS}</div>
          )}
        </div>
      )}

      {/* Header card */}
      <div className={styles.detailHeaderCard}>
        <InfoBlock label="Supplier" value={po.SUPPLIER_NAME || `#${po.SUPPLIER_ID}`} sub={po.SUPPLIER_CODE} />
        <InfoBlock label="PO Date" value={po.PO_DATE || "—"} />
        <InfoBlock label="Expected Delivery" value={po.EXPECTED_DELIVERY_DATE || "—"} />
        <InfoBlock label="Prepared by" value={po.PREPARED_BY_NAME || "—"} />
        <InfoBlock label="Linked Project" value={po.LINKED_PROJECT_NAME || "—"} />
        <InfoBlock label="Supplier Contact" value={po.SUPPLIER_PHONE || "—"} sub={po.SUPPLIER_EMAIL} />
      </div>

      {/* Line items */}
      <div className={`${styles.sectionLabel} ${styles.sectionLabelAmber}`}>
        📦 LINE ITEMS ({po.LINES?.length || 0})
      </div>

      <div className={styles.tableWrapSm}>
        <table className={styles.table}>
          <thead className={styles.tableHead}>
            <tr>
              <th className={styles.thW40}>#</th>
              <th>Description</th>
              <th className={`${styles.thW70} ${styles.tdAlignRight}`}>Ordered</th>
              <th className={`${styles.thW75} ${styles.tdAlignRight} ${styles.thAcceptedColor}`}>✅ Accepted</th>
              <th className={`${styles.thW75} ${styles.tdAlignRight} ${styles.thRejectedColor}`}>❌ Rejected</th>
              <th className={`${styles.thW70} ${styles.tdAlignRight}`}>Pending</th>
              <th>Unit</th>
              <th className={`${styles.thW100} ${styles.tdAlignRight}`}>Rate</th>
              <th className={`${styles.thW110} ${styles.tdAlignRight}`}>Total</th>
            </tr>
          </thead>
          <tbody className={styles.tableBody}>
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
                    background: fullyReceived ? "#f0fdf4" : "white"
                  }}
                >
                  <td className={styles.tdPad}>{idx + 1}</td>
                  <td className={styles.tdPad}>{l.DESCRIPTION}</td>
                  <td className={`${styles.tdPad} ${styles.tdOrdered}`}>{ordered}</td>
                  <td className={`${styles.tdPad} ${styles.tdAccepted}`}>
                    {accepted || 0}
                  </td>
                  <td className={styles.tdPad} style={{
                    textAlign: "right",
                    color: rejected > 0 ? "#b91c1c" : "#cbd5e1",
                    fontWeight: rejected > 0 ? 700 : 400
                  }}>
                    {rejected || 0}
                  </td>
                  <td className={styles.tdPad} style={{
                    textAlign: "right",
                    color: pending > 0 ? "#b91c1c" : "#94a3b8",
                    fontWeight: 700
                  }}>
                    {fullyReceived ? "✓" : pending.toFixed(2)}
                  </td>
                  <td className={styles.tdPad}>{l.UNIT}</td>
                  <td className={`${styles.tdPad} ${styles.tdAlignRight}`}>{inr(l.UNIT_PRICE)}</td>
                  <td className={`${styles.tdPad} ${styles.tdAlignRightXB}`}>{inr(l.LINE_TOTAL)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Totals */}
      <div className={styles.totalsWrapMb14}>
        <div className={styles.totalsBox}>
          <TotalRow label="Subtotal" value={po.SUBTOTAL} />
          {po.DISCOUNT_PERCENT > 0 && <TotalRow label={`Discount (${po.DISCOUNT_PERCENT}%)`} value={-po.DISCOUNT_AMOUNT} />}
          <TotalRow label={`GST (${po.TAX_PERCENT}%)`} value={po.TAX_AMOUNT} />
          <div className={styles.totalsDivider}>
            <TotalRow label="Grand Total" value={po.GRAND_TOTAL} bold large />
          </div>
        </div>
      </div>

      {/* GRNs section */}
      {grns.length > 0 && (
        <div className={styles.grnSectionWrap}>
          <div className={`${styles.sectionLabel} ${styles.sectionLabelBlue}`}>
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
                className={`${styles.grnCard} ${g.STATUS === "FINAL" ? styles.grnCardFinal : styles.grnCardDraft}`}
              >
                <div className={styles.grnCardInner}>

                  <div className={styles.grnCardLeft}>
                    <div className={styles.grnChipHead}>
                      <span className={styles.grnNumber}>
                        {g.GRN_NUMBER}
                      </span>
                      <span
                        className={styles.grnStatusPill}
                        style={{
                          background: g.STATUS === "FINAL" ? "#dcfce7" : "#fef3c7",
                          color: g.STATUS === "FINAL" ? "#166534" : "#854d0e"
                        }}
                      >
                        {g.STATUS}
                      </span>
                    </div>

                    <div className={styles.grnMeta}>
                      📅 {g.RECEIVED_DATE} · 👤 {g.RECEIVED_BY_NAME || "—"}
                      {g.INVOICE_NUMBER ? ` · 🧾 Inv: ${g.INVOICE_NUMBER}` : ""}
                    </div>

                    {/* Receipt summary chips */}
                    <div className={styles.grnChips}>
                      <span className={styles.grnChipAccepted}>
                        ✅ Accepted: {accepted}
                      </span>
                      {rejected > 0 && (
                        <span className={styles.grnChipRejected}>
                          ❌ Rejected: {rejected}
                        </span>
                      )}
                      <span className={styles.grnChipLines}>
                        📦 {g.LINES.length} line(s)
                      </span>
                    </div>

                    {/* Show line-level rejection reasons if any */}
                    {g.LINES.some((l) => Number(l.QUANTITY_REJECTED) > 0) && (
                      <div className={styles.grnRejectionDetail}>
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

                  <div className={styles.grnCardActions}>

                    <button
                      onClick={() => window.open(`/grn-print/${g.ID}`, "_blank")}
                      title="Print / PDF"
                      className={styles.btnGrnPrint}
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
                        className={styles.btnGrnNotify}
                      >
                        📧 Notify
                      </button>
                    )}

                    {g.STATUS === "DRAFT" && (
                      <>
                        <button
                          onClick={finalizeGRN}
                          className={styles.btnGrnFinalize}
                        >
                          ✓ Finalize
                        </button>

                        <button
                          onClick={deleteGRN}
                          title="Delete draft"
                          className={styles.btnGrnDelete}
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
        <div className={styles.activityWrap}>
          <div className={`${styles.sectionLabel} ${styles.sectionLabelBlue}`}>📋 ACTIVITY TIMELINE</div>
          <div className={styles.activityInner}>
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
                <div key={a.ID} className={`${styles.activityRow} ${idx !== 0 ? styles.activityRowBorder : ""}`}>
                  <div className={styles.activityIcon}>{icons[a.EVENT_TYPE] || "•"}</div>
                  <div className={styles.activityBody}>
                    <div className={styles.activityEvent}>{a.EVENT_TYPE.replace(/_/g, " ")}</div>
                    {a.EVENT_DETAIL && <div className={styles.activityDetail}>{a.EVENT_DETAIL}</div>}
                    <div className={styles.activityTime}>{a.CREATED_AT ? new Date(a.CREATED_AT).toLocaleString("en-IN") : ""}</div>
                  </div>
                  <button onClick={removeActivity} className={styles.btnRemoveActivity}>×</button>
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
      <div className={styles.grnContextBanner}>
        <b>Supplier:</b> {po.SUPPLIER_NAME || `#${po.SUPPLIER_ID}`}{" "}
        ({po.SUPPLIER_CODE || "—"}) ·
        <b> PO:</b> {po.PO_NUMBER} ·
        <b> Expected:</b> {po.EXPECTED_DELIVERY_DATE || "—"}
      </div>

      <div className={styles.formGrid3}>
        <Field label="Received Date *">
          <input type="date" value={data.RECEIVED_DATE} onChange={(e) => setData({ ...data, RECEIVED_DATE: e.target.value })} className={styles.input} />
        </Field>
        <Field label="Received By (Warehouse Person)">
          <select value={data.RECEIVED_BY} onChange={(e) => setData({ ...data, RECEIVED_BY: e.target.value })} className={styles.input}>
            <option value="">— pick employee —</option>
            {employees.map((e) => <option key={e.ID} value={e.ID}>{e.NAME}</option>)}
          </select>
        </Field>
        <Field label="Supplier Invoice / Challan #">
          <input type="text" value={data.INVOICE_NUMBER} onChange={(e) => setData({ ...data, INVOICE_NUMBER: e.target.value })} className={styles.input} placeholder="INV-12345" />
        </Field>
      </div>

      {data.LINES.length === 0 && (
        <div className={styles.grnAllReceived}>
          ✅ All PO lines already fully received. Nothing pending.
        </div>
      )}

      {data.LINES.length > 0 && (
        <div className={styles.tableWrapSm}>
          <table className={styles.table}>
            <thead className={styles.tableHead}>
              <tr>
                <th>Material / Description</th>
                <th className={styles.thGrnOrdered}>Ordered</th>
                <th className={styles.thGrnPending}>Pending</th>
                <th className={styles.thGrnAccepted}>✅ Accepted</th>
                <th className={styles.thGrnRejected}>❌ Rejected</th>
                <th>Reject Reason</th>
              </tr>
            </thead>
            <tbody className={styles.tableBody}>
              {data.LINES.map((l, idx) => {

                const err = lineProblems[idx];

                return (
                  <tr
                    key={l.PO_LINE_ID}
                    style={{
                      background: err ? "#fef2f2" : "white"
                    }}
                  >
                    <td className={styles.tdPad}>
                      <div>{l.DESCRIPTION}</div>
                      <div className={styles.grnLineUnit}>
                        Unit: {l.UNIT || "pcs"}
                      </div>
                      {err && (
                        <div className={styles.grnLineError}>
                          ⚠ {err}
                        </div>
                      )}
                    </td>
                    <td className={`${styles.tdPad} ${styles.tdOrdered}`}>
                      {l.ORDERED}
                    </td>
                    <td className={`${styles.tdPad} ${styles.tdPendingRed}`}>
                      {l.PENDING}
                    </td>
                    <td className={styles.tdPadSm}>
                      <input
                        type="number"
                        min="0"
                        max={l.PENDING}
                        step="0.01"
                        value={l.ACCEPTED}
                        onChange={(e) => updateLine(idx, "ACCEPTED", e.target.value)}
                        className={styles.input}
                      />
                    </td>
                    <td className={styles.tdPadSm}>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={l.REJECTED}
                        onChange={(e) => updateLine(idx, "REJECTED", e.target.value)}
                        className={styles.input}
                      />
                    </td>
                    <td className={styles.tdPadSm}>
                      <input
                        type="text"
                        value={l.REJECTION_REASON}
                        onChange={(e) => updateLine(idx, "REJECTION_REASON", e.target.value)}
                        className={styles.input}
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
        <div className={styles.grnSummaryGrid}>
          <SummaryTile label="Total Ordered" value={totals.ordered} color="#475569" />
          <SummaryTile label="Total Arrived" value={totalArrived} color="#0ea5e9" sub="accepted + rejected" />
          <SummaryTile label="✅ Accepted" value={totals.accepted} color="#10b981" sub="→ goes to Inventory" />
          <SummaryTile label="❌ Rejected" value={totals.rejected} color="#ef4444" sub="audit-only, sent back" />
        </div>
      )}

      <Field label="Notes (optional)">
        <textarea rows={2} value={data.NOTES} onChange={(e) => setData({ ...data, NOTES: e.target.value })} className={`${styles.input} ${styles.inputResizable}`} placeholder="Truck number, delivery time, anything worth noting..." />
      </Field>

      <label className={styles.grnFinalizeToggle}>
        <input type="checkbox" checked={data.FINALIZE} onChange={(e) => setData({ ...data, FINALIZE: e.target.checked })} className={styles.grnFinalizeToggleCheckbox} />
        <span>
          <b>Finalize immediately</b> — Inventory will be updated with the
          accepted quantities ({totals.accepted} units). Uncheck to save as
          DRAFT for warehouse supervisor review.
        </span>
      </label>

      <div className={styles.modalFooter}>
        <button onClick={onCancel} disabled={saving} className={`${styles.btnCancel} ${saving ? styles.btnCancelDisabled : ""}`}>Cancel</button>
        <button
          onClick={save}
          disabled={saving || hasErrors || data.LINES.length === 0}
          className={`${styles.btnGrnSave} ${(saving || hasErrors || data.LINES.length === 0) ? styles.btnGrnSaveDisabled : styles.btnGrnSaveActive}`}
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

      <div className={styles.autoProjectInfo}>
        Reads the project's product BOM → groups items by their
        PREFERRED_SUPPLIER → creates one DRAFT PO per supplier with
        Inventory unit prices. Items without a preferred supplier are
        skipped (set them in the Purchase / BOM page first).
      </div>

      <Field label="Project *">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)} className={styles.input}>
          <option value="">— pick project —</option>
          {projects.map((p) => (
            <option key={p.ID} value={p.ID}>{p.PROJECT_NAME || `Project #${p.ID}`}</option>
          ))}
        </select>
      </Field>

      <div className={styles.fieldSpacer} />

      <div className={styles.formGrid2}>
        <Field label="Expected Delivery">
          <input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className={styles.input} />
        </Field>
        <Field label="Prepared By">
          <select value={prepBy} onChange={(e) => setPrepBy(e.target.value)} className={styles.input}>
            <option value="">— none —</option>
            {employees.map((e) => <option key={e.ID} value={e.ID}>{e.NAME}</option>)}
          </select>
        </Field>
      </div>

      <div className={styles.modalFooterMt18}>
        <button onClick={onClose} className={styles.btnCancel}>Cancel</button>
        <button
          onClick={submit}
          disabled={creating}
          className={`${styles.btnGeneratePOs} ${creating ? styles.btnGeneratePOsDisabled : styles.btnGeneratePOsActive}`}
        >
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
      className={styles.modalOverlay}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`${styles.modalBox} ${wide ? styles.modalBoxWide : styles.modalBoxNormal}`}
      >
        <div className={styles.modalHeader}>
          <div className={styles.modalTitle}>{title}</div>
          <button onClick={onClose} className={styles.modalClose}>×</button>
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


function TotalRow({ label, value, bold, large }) {

  return (
    <div className={`${styles.totalRow} ${bold ? styles.totalRowBold : styles.totalRowNormal} ${large ? styles.totalRowLarge : ""}`}>
      <span>{label}</span><span>{inr(value)}</span>
    </div>
  );
}


function SummaryTile({ label, value, color, sub }) {

  return (
    <div
      className={styles.summaryTile}
      style={{
        border: `1px solid ${color}33`,
        borderLeft: `4px solid ${color}`
      }}
    >
      <div className={styles.summaryTileLabel}>
        {label}
      </div>
      <div className={styles.summaryTileValue} style={{ color }}>
        {value}
      </div>
      {sub && (
        <div className={styles.summaryTileSub}>
          {sub}
        </div>
      )}
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

    <div className={styles.page}>

      <div className={styles.pageHeader}>
        <div>
          <h1 className={styles.pageTitle}>📋 Purchase Orders</h1>
          <div className={styles.pageSubtitle}>
            Procurement — issue POs to suppliers, track receipts, update inventory
          </div>
        </div>
        <div className={styles.headerActions}>
          <button onClick={() => setAutoOpen(true)} className={styles.btnAutoProject}>
            🤖 Auto-from-Project
          </button>
          <button onClick={() => { setEditingId(null); setEditorOpen(true); }} className={styles.btnNewPO}>
            ✨ New PO
          </button>
        </div>
      </div>

      <div className={styles.statsGrid}>
        <StatTile label="Total POs" value={stats.total} color="#6366f1" />
        <StatTile label="Draft" value={stats.draft} color="#94a3b8" />
        <StatTile label="Open (Sent + Confirmed)" value={stats.sent} color="#f59e0b" />
        <StatTile label="Total Value" value={inr(stats.value)} color="#10b981" isText />
      </div>

      <div className={styles.toolbar}>
        <input type="text" placeholder="🔍 Search by PO#, supplier..." value={search} onChange={(e) => setSearch(e.target.value)} className={`${styles.input} ${styles.toolbarSearch}`} />
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={`${styles.input} ${styles.toolbarSelect}`}>
          <option value="">All statuses</option>
          <option value="DRAFT">Draft</option>
          <option value="SENT">Sent</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="PARTIAL_RECEIVED">Partial Received</option>
          <option value="RECEIVED">Received</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      {loading && <div className={styles.loadingState}>Loading…</div>}

      {!loading && filtered.length === 0 && (
        <div className={styles.emptyState}>
          No purchase orders yet. Click <b>New PO</b> or <b>Auto-from-Project</b> to start.
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className={styles.poList}>
          {filtered.map((r) => (
            <div key={r.ID} onClick={() => { setEditingId(r.ID); setEditorOpen(true); }} className={styles.poRow}>
              <div>
                <div className={styles.poRowNumber}>{r.PO_NUMBER}</div>
                <div className={styles.poRowDate}>{r.PO_DATE}</div>
              </div>
              <div>
                <div className={styles.poRowSupplier}>{r.SUPPLIER_NAME || `#${r.SUPPLIER_ID}`}</div>
                <div className={styles.poRowMeta}>{r.SUPPLIER_CODE}{r.LINKED_PROJECT_NAME ? ` · 📁 ${r.LINKED_PROJECT_NAME}` : ""}</div>
              </div>
              <div>
                <div className={styles.poRowDeliveryLabel}>Expected Delivery</div>
                <div className={styles.poRowDeliveryValue}>{r.EXPECTED_DELIVERY_DATE || "—"}</div>
              </div>
              <div className={styles.poRowRight}>
                <div className={styles.poRowTotalLabel}>Total</div>
                <div className={styles.poRowTotalValue}>{inr(r.GRAND_TOTAL)}</div>
              </div>
              <div className={styles.poRowRight}>
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
    <div className={styles.statTile} style={{ borderTop: `3px solid ${color}` }}>
      <div className={styles.statTileLabel}>{label}</div>
      <div className={`${styles.statTileValue} ${isText ? styles.statTileValueText : styles.statTileValueNum}`}>{value}</div>
    </div>
  );
}


export default PurchaseOrders;
