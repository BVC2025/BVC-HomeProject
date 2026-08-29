// =====================================================================
// Public Purchase Order Upload — /po-upload/:token
//
// Reached from the "Upload Purchase Order" button in the Purchase Order
// Request email. Anyone with the link can upload a PDF (the opaque
// UPLOAD_TOKEN in the URL is the secret, no login). Mirrors
// EmployeeOnboardingChat.jsx's own unauthenticated-axios-instance +
// FormData upload pattern — the established precedent in this codebase
// for a public file-upload page.
// =====================================================================

import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";
import styles from "./PublicPOUpload.module.css";

// Public axios — token IS the secret, no Bearer header attached, and
// never routed through the authenticated API instance's 401/refresh
// interceptors (which would otherwise redirect a customer with no
// session to the admin login page).
const pub = axios.create({ baseURL: API_BASE_URL });

function formatDate(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-IN", {
      day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const EMPTY_PAYMENT_ROW = () => ({ amount: "", referenceNumber: "", proofFile: null });

export default function PublicPOUpload() {
  const { token } = useParams();

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [context, setContext] = useState(null);

  const [file, setFile] = useState(null);
  const [comments, setComments] = useState("");
  // Left blank on purpose (no pre-filled "1") — a pre-filled value reads as
  // "already answered" and customers tend to leave it untouched without
  // realizing what it's for. Requiring them to type it in forces a
  // deliberate answer every time, including on a re-upload.
  const [quantity, setQuantity] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState("");
  const [result, setResult] = useState(null);

  // No date field anywhere here — the backend stamps every payment created
  // in one submission with a single now_ist() timestamp, since the customer
  // never picks one during this flow.
  const [payments, setPayments] = useState([EMPTY_PAYMENT_ROW()]);
  const [paymentComments, setPaymentComments] = useState("");

  const loadContext = useCallback(() => {
    setLoading(true);
    setLoadError("");
    pub.get(`/po-actions/${token}`)
      .then((r) => {
        setContext(r.data);
      })
      .catch((err) => {
        setLoadError(err?.response?.data?.detail || "This Purchase Order upload link is invalid or has expired.");
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Matches the established load-on-mount pattern used throughout this
  // codebase's other modals/pages (e.g. LeadQuotationModal.jsx) — `load`
  // itself owns the async work, the effect just triggers it once per
  // `token`. The react-hooks/set-state-in-effect advisory this still
  // trips (it traces into the called function) is a known, already-
  // tolerated false positive for this pattern elsewhere in the codebase.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadContext(); }, [loadContext]);

  const alreadyFullyPaid = context && context.remaining_balance <= 0;

  const addPaymentRow = useCallback(() => {
    setPayments((prev) => [...prev, EMPTY_PAYMENT_ROW()]);
  }, []);

  const removePaymentRow = useCallback((idx) => {
    setPayments((prev) => (prev.length > 1 ? prev.filter((_, i) => i !== idx) : prev));
  }, []);

  const updatePaymentRow = useCallback((idx, field, value) => {
    setPayments((prev) => prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p)));
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!file) { setSubmitError("Please choose a PDF file to upload."); return; }

    const qty = parseInt(quantity, 10);
    if (!quantity || Number.isNaN(qty) || qty <= 0) {
      setSubmitError("Enter a valid quantity (a whole number greater than zero).");
      return;
    }

    if (!alreadyFullyPaid) {
      for (let i = 0; i < payments.length; i++) {
        const p = payments[i];
        const amt = parseFloat(p.amount);
        if (p.amount === "" || Number.isNaN(amt) || amt <= 0) {
          setSubmitError(`Payment ${i + 1}: enter a valid amount.`);
          return;
        }
        if (!p.proofFile) {
          setSubmitError(`Payment ${i + 1}: a payment proof file is required.`);
          return;
        }
      }
    }

    setSubmitError("");
    setSubmitting(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("quantity", String(qty));
      if (comments.trim()) fd.append("comments", comments.trim());
      if (!alreadyFullyPaid) {
        payments.forEach((p) => {
          fd.append("payment_amounts", p.amount);
          fd.append("payment_reference_numbers", p.referenceNumber || "");
          fd.append("payment_proofs", p.proofFile);
        });
        if (paymentComments.trim()) fd.append("payment_comments", paymentComments.trim());
      }
      const r = await pub.post(`/po-actions/${token}/upload`, fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(r.data);
    } catch (err) {
      setSubmitError(err?.response?.data?.detail || "Upload failed. Please make sure the file is a PDF under 15 MB.");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={styles.body}>
            <p className={styles.muted}>Loading…</p>
          </div>
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={`${styles.header} ${styles.headerDanger}`}>
            <div className={styles.headerTitle}>Invalid Link</div>
          </div>
          <div className={styles.body}>
            <p>{loadError}</p>
          </div>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className={styles.shell}>
        <div className={styles.card}>
          <div className={`${styles.header} ${styles.headerSuccess}`}>
            <div className={styles.headerTitle}>Purchase Order Received</div>
          </div>
          <div className={styles.body}>
            <p>{result.message}</p>
            <p className={styles.muted}>
              File: <strong>{result.file_name}</strong>
              {result.uploaded_at ? ` — ${formatDate(result.uploaded_at)}` : ""}
            </p>
            {result.payment_recorded && result.payments_recorded > 0 && (
              <p className={styles.muted}>
                {result.payments_recorded > 1
                  ? `Your ${result.payments_recorded} payment records have also been recorded. Thank you.`
                  : "Your payment details have also been recorded. Thank you."}
              </p>
            )}
            <p className={styles.muted}>You can close this tab.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div className={styles.headerEyebrow}>Purchase Order</div>
          <div className={styles.headerTitle}>{context?.project_name || "Upload Your Purchase Order"}</div>
        </div>
        <form className={styles.body} onSubmit={handleSubmit}>
          {context?.already_uploaded && (
            <div className={styles.notice}>
              You previously uploaded <strong>{context.file_name}</strong>
              {context.uploaded_at ? ` on ${formatDate(context.uploaded_at)}` : ""}.
              Uploading a new file below will replace it.
            </div>
          )}

          <label className={styles.label} htmlFor="po-file">Purchase Order (PDF) <span className={styles.req}>*</span></label>
          <input
            id="po-file"
            type="file"
            accept="application/pdf,.pdf"
            className={styles.fileInput}
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />

          <label className={styles.label} htmlFor="po-quantity">Quantity <span className={styles.req}>*</span></label>
          <input
            id="po-quantity"
            type="number"
            min="1"
            step="1"
            className={styles.input}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            placeholder="How many units of this project are you purchasing?"
          />

          <label className={styles.label} htmlFor="po-comments">Comments (optional)</label>
          <textarea
            id="po-comments"
            className={styles.textarea}
            rows={4}
            placeholder="Anything you'd like us to know about this Purchase Order…"
            value={comments}
            onChange={(e) => setComments(e.target.value)}
          />

          {alreadyFullyPaid ? (
            <div className={styles.notice}>
              This Purchase Order is already fully paid — no additional payment is required.
            </div>
          ) : (
            <div className={styles.paymentBox}>
              <p className={styles.label} style={{ marginTop: 0 }}>
                Payment Details <span className={styles.req}>*</span>
              </p>
              <p className={styles.muted} style={{ marginTop: -8 }}>
                At least one payment (amount + proof) is required to complete this submission. If you paid in
                more than one transaction, add each one separately below.
              </p>
              {context?.remaining_balance > 0 && (
                <p className={styles.muted}>
                  Remaining balance: ₹{Number(context.remaining_balance).toLocaleString("en-IN", { minimumFractionDigits: 2 })}
                </p>
              )}

              {payments.map((p, idx) => (
                <div key={idx} className={styles.paymentRow}>
                  <div className={styles.paymentRowHead}>
                    <span className={styles.paymentRowTitle}>Payment {idx + 1}</span>
                    {payments.length > 1 && (
                      <button
                        type="button"
                        className={styles.removeRowBtn}
                        onClick={() => removePaymentRow(idx)}
                      >
                        Remove
                      </button>
                    )}
                  </div>

                  <label className={styles.label} htmlFor={`pay-amount-${idx}`}>
                    Amount <span className={styles.req}>*</span>
                  </label>
                  <input
                    id={`pay-amount-${idx}`}
                    type="number"
                    min="0.01"
                    step="0.01"
                    className={styles.input}
                    value={p.amount}
                    onChange={(e) => updatePaymentRow(idx, "amount", e.target.value)}
                  />

                  <label className={styles.label} htmlFor={`pay-proof-${idx}`}>
                    Payment Proof <span className={styles.req}>*</span>
                  </label>
                  <input
                    id={`pay-proof-${idx}`}
                    type="file"
                    accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx"
                    className={styles.fileInput}
                    onChange={(e) => updatePaymentRow(idx, "proofFile", e.target.files?.[0] || null)}
                  />

                  <label className={styles.label} htmlFor={`pay-ref-${idx}`}>Reference Number (optional)</label>
                  <input
                    id={`pay-ref-${idx}`}
                    type="text"
                    className={styles.input}
                    placeholder="UTR / transaction ID, if any"
                    value={p.referenceNumber}
                    onChange={(e) => updatePaymentRow(idx, "referenceNumber", e.target.value)}
                  />
                </div>
              ))}

              <button type="button" className={styles.addRowBtn} onClick={addPaymentRow}>
                + Add Another Payment
              </button>

              <label className={styles.label} htmlFor="pay-comments">Payment Comments (optional)</label>
              <textarea
                id="pay-comments"
                className={styles.textarea}
                rows={3}
                placeholder="Anything you'd like us to know about these payments…"
                value={paymentComments}
                onChange={(e) => setPaymentComments(e.target.value)}
              />
            </div>
          )}

          {submitError && <div className={styles.error}>{submitError}</div>}

          <button type="submit" className={styles.submitBtn} disabled={submitting}>
            {submitting ? "Uploading…" : "Upload Purchase Order"}
          </button>
        </form>
      </div>
    </div>
  );
}
