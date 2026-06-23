import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";
import styles from "./PublicQuotation.module.css";


// ===================================================================
// NegotiationChat — floating chat widget injected into the public
// quotation page. Customers can ask for discounts, warranty extensions,
// faster delivery, etc. The bot replies and may auto-apply approved
// discounts. All policy enforcement happens server-side.
// ===================================================================

function NegotiationChat({ token, quotationStatus, onTotalsUpdated }) {

  const [open, setOpen] = useState(false);

  const [messages, setMessages] = useState([]);

  const [input, setInput] = useState("");

  const [sending, setSending] = useState(false);

  const [loaded, setLoaded] = useState(false);

  const [maxDiscount, setMaxDiscount] = useState(10);

  const [lastUpdate, setLastUpdate] = useState(null);

  const scrollRef = useRef(null);

  // Negotiation is only meaningful while the quote is SENT (not yet
  // approved/rejected/converted). Hide the launcher otherwise.
  const canNegotiate = quotationStatus === "SENT";

  // ---- Load chat history when the panel first opens ----
  useEffect(() => {

    if (!open || loaded) return;

    API.get(`/q/${token}/negotiate/history`)
      .then((r) => {

        const data = r.data || {};

        setMessages(data.messages || []);

        if (data.max_discount_percent != null) {

          setMaxDiscount(data.max_discount_percent);
        }

        setLoaded(true);
      })
      .catch(() => {

        // Soft-fail: show an empty chat with a friendly opener
        setMessages([]);

        setLoaded(true);
      });

  }, [open, loaded, token]);

  // ---- Auto-scroll to the newest message ----
  useEffect(() => {

    if (scrollRef.current) {

      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }

  }, [messages, sending]);

  const send = async () => {

    const text = (input || "").trim();

    if (!text || sending) return;

    // Optimistic append of the customer turn
    const localCustomer = {
      ID: `local-${Date.now()}`,
      ROLE: "customer",
      CONTENT: text,
      CREATED_AT: new Date().toISOString()
    };

    setMessages((m) => [...m, localCustomer]);

    setInput("");

    setSending(true);

    try {

      const r = await API.post(`/q/${token}/negotiate`, { MESSAGE: text });

      const data = r.data || {};

      const botRow = {
        ID: `local-${Date.now()}-bot`,
        ROLE: "assistant",
        CONTENT: data.reply || "(no reply)",
        INTENT: data.intent,
        ACTION: data.action,
        DISCOUNT_PERCENT: data.discount_percent,
        CREATED_AT: new Date().toISOString()
      };

      setMessages((m) => [...m, botRow]);

      // If the server applied a new total, surface a confirmation
      // banner inside the chat AND ask the parent page to re-fetch
      // the quotation so line items / grand total update on-screen.
      if (data.totals_updated && data.new_grand_total != null) {

        setLastUpdate({
          discount_percent: data.new_discount_percent,
          new_grand_total: data.new_grand_total,
          ts: Date.now()
        });

        if (onTotalsUpdated) {

          onTotalsUpdated();
        }
      }

    } catch (err) {

      const detail =
        err?.response?.data?.detail ||
        "Sorry — I couldn't reach the assistant right now.";

      setMessages((m) => [
        ...m,
        {
          ID: `local-${Date.now()}-err`,
          ROLE: "assistant",
          CONTENT: detail,
          INTENT: "OTHER",
          ACTION: "INFO_ONLY",
          CREATED_AT: new Date().toISOString()
        }
      ]);

    } finally {

      setSending(false);
    }
  };

  const onKey = (e) => {

    if (e.key === "Enter" && !e.shiftKey) {

      e.preventDefault();

      send();
    }
  };

  if (!canNegotiate) return null;

  return (
    <>
      <style>{`
        .nego-fab {
          position: fixed;
          right: 24px;
          bottom: 24px;
          background: #ef4444;
          color: white;
          border: none;
          border-radius: 999px;
          padding: 14px 22px;
          font-size: 14px;
          font-weight: 800;
          cursor: pointer;
          box-shadow: 0 10px 30px rgba(200,16,46,0.45);
          z-index: 1000;
        }
        .nego-fab:hover { transform: translateY(-2px); }
        .nego-panel {
          position: fixed;
          right: 24px;
          bottom: 24px;
          width: 380px;
          max-width: calc(100vw - 32px);
          height: 540px;
          max-height: calc(100vh - 48px);
          background: white;
          border-radius: 16px;
          box-shadow: 0 20px 60px rgba(0,0,0,0.25);
          display: flex;
          flex-direction: column;
          overflow: hidden;
          z-index: 1001;
          font-family: Arial, Helvetica, sans-serif;
          animation: nego-slide-up 0.22s ease-out;
        }
        @keyframes nego-slide-up {
          from { transform: translateY(20px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
        .nego-header {
          background: #ef4444;
          color: white;
          padding: 14px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        .nego-header .title { font-size: 14px; font-weight: 800; }
        .nego-header .sub   { font-size: 11px; opacity: 0.85; margin-top: 2px; }
        .nego-header .close {
          background: rgba(255,255,255,0.18);
          border: none;
          color: white;
          width: 28px; height: 28px;
          border-radius: 8px;
          cursor: pointer;
          font-size: 16px;
          font-weight: 800;
        }
        .nego-body {
          flex: 1;
          overflow-y: auto;
          padding: 14px;
          background: #f8fafc;
        }
        .nego-msg {
          margin-bottom: 10px;
          display: flex;
        }
        .nego-msg.customer { justify-content: flex-end; }
        .nego-msg .bubble {
          max-width: 80%;
          padding: 9px 13px;
          border-radius: 14px;
          font-size: 13px;
          line-height: 1.45;
          white-space: pre-wrap;
        }
        .nego-msg.customer .bubble {
          background: #ef4444;
          color: white;
          border-bottom-right-radius: 4px;
        }
        .nego-msg.assistant .bubble {
          background: white;
          color: #0f172a;
          border: 1px solid #e2e8f0;
          border-bottom-left-radius: 4px;
        }
        .nego-tag {
          display: inline-block;
          font-size: 10px;
          font-weight: 800;
          margin-top: 4px;
          padding: 2px 8px;
          border-radius: 999px;
          letter-spacing: 0.5px;
        }
        .nego-tag.AUTO_APPROVE { background:#dcfce7; color:#166534; }
        .nego-tag.COUNTER      { background:#fef3c7; color:#854d0e; }
        .nego-tag.DECLINE      { background:#fee2e2; color:#991b1b; }
        .nego-tag.INFO_ONLY    { background:#e0f2fe; color:#075985; }
        .nego-update-banner {
          background: #10b981;
          color: white;
          padding: 10px 12px;
          border-radius: 10px;
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 700;
        }
        .nego-typing {
          color: #94a3b8;
          font-size: 12px;
          font-style: italic;
          padding: 6px 4px;
        }
        .nego-input-row {
          border-top: 1px solid #e2e8f0;
          padding: 10px;
          display: flex;
          gap: 8px;
          background: white;
        }
        .nego-input-row input {
          flex: 1;
          padding: 10px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          font-size: 13px;
          outline: none;
        }
        .nego-input-row input:focus { border-color: #ef4444; }
        .nego-input-row button {
          background: #ef4444;
          color: white;
          border: none;
          padding: 0 16px;
          border-radius: 10px;
          font-weight: 800;
          font-size: 13px;
          cursor: pointer;
        }
        .nego-input-row button:disabled { opacity: 0.5; cursor: not-allowed; }
        .nego-footer {
          background: #f8fafc;
          padding: 6px 12px;
          font-size: 10px;
          color: #94a3b8;
          text-align: center;
          border-top: 1px solid #e2e8f0;
        }
      `}</style>

      {!open && (
        <button
          className="nego-fab no-print"
          onClick={() => setOpen(true)}
          title="Ask a question or negotiate"
        >
          💬 Ask a Question / Negotiate
        </button>
      )}

      {open && (
        <div className="nego-panel no-print" role="dialog" aria-label="Negotiation chat">

          <div className="nego-header">
            <div>
              <div className="title">💬 BVC24 Assistant</div>
              <div className="sub">
                Ask about discount, warranty, delivery — max {maxDiscount}% off
              </div>
            </div>
            <button
              className="close"
              onClick={() => setOpen(false)}
              aria-label="Close chat"
            >
              ×
            </button>
          </div>

          <div className="nego-body" ref={scrollRef}>

            {lastUpdate && (
              <div className="nego-update-banner">
                ✓ Updated — {lastUpdate.discount_percent}% discount applied.
                New Grand Total: ₹
                {Number(lastUpdate.new_grand_total).toLocaleString("en-IN", {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2
                })}
              </div>
            )}

            {messages.length === 0 && loaded && (
              <div className="nego-msg assistant">
                <div className="bubble">
                  Hi! I'm the BVC24 Assistant. You can ask me about:
                  {"\n"}• Discount on this quotation
                  {"\n"}• Extended warranty
                  {"\n"}• Faster delivery
                  {"\n"}• Installation
                  {"\n\n"}How can I help you today?
                </div>
              </div>
            )}

            {messages.map((m) => (
              <div
                key={m.ID}
                className={`nego-msg ${m.ROLE === "customer" ? "customer" : "assistant"}`}
              >
                <div className="bubble">
                  {m.CONTENT}
                  {m.ROLE === "assistant" && m.ACTION && (
                    <div>
                      <span className={`nego-tag ${m.ACTION}`}>
                        {m.ACTION === "AUTO_APPROVE" && "✓ Approved"}
                        {m.ACTION === "COUNTER"      && "↪ Counter-offer"}
                        {m.ACTION === "DECLINE"      && "× Declined"}
                        {m.ACTION === "INFO_ONLY"    && "ℹ Info"}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}

            {sending && (
              <div className="nego-typing">Assistant is typing…</div>
            )}
          </div>

          <div className="nego-input-row">
            <input
              type="text"
              placeholder="Type your message…"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKey}
              disabled={sending}
            />
            <button onClick={send} disabled={sending || !input.trim()}>
              Send
            </button>
          </div>

          <div className="nego-footer">
            Powered by BVC24 — responses follow our published discount policy
          </div>
        </div>
      )}
    </>
  );
}


// ===================================================================
// PublicQuotation — what the CUSTOMER sees when they open the share
// link `/q/<token>` from the email. No login required. Bumps the
// view counter server-side on first load.
// ===================================================================


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


function PublicQuotation() {

  const { token } = useParams();

  const [q, setQ] = useState(null);

  const [error, setError] = useState(null);

  const [responding, setResponding] = useState(false);

  const load = () => {

    API.get(`/q/${token}`)
      .then((r) => setQ(r.data))
      .catch((err) => setError(err?.response?.data?.detail || "Failed to load"));
  };

  useEffect(() => {

    load();

  }, [token]);

  const respond = async (action) => {

    let reason = null;

    if (action === "reject") {

      reason = window.prompt("Reason for rejection (optional):");

      if (reason === null) return;  // cancelled
    }

    if (!window.confirm(
      action === "approve"
        ? "Confirm: APPROVE this quotation?"
        : "Confirm: REJECT this quotation?"
    )) return;

    setResponding(true);

    try {

      const params = new URLSearchParams({ action });

      if (reason) params.set("reason", reason);

      await API.post(`/q/${token}/respond?${params.toString()}`);

      alert(
        action === "approve"
          ? "✅ Thank you! Your approval has been recorded."
          : "Your decision has been recorded."
      );

      load();

    } catch (err) {

      alert(err?.response?.data?.detail || "Failed to record response");

    } finally {

      setResponding(false);
    }
  };

  if (error) {

    return (
      <div className={styles.errorPage}>
        <div className={styles.errorCard}>
          <div className={styles.errorIcon}>🔒</div>
          <h2 className={styles.errorTitle}>Link not available</h2>
          <div className={styles.errorText}>
            This quotation link may be invalid, expired, or no longer
            available. Please contact the sender at <b>contact@bvc24.in</b>.
          </div>
        </div>
      </div>
    );
  }

  if (!q) {

    return (
      <div className={styles.loadingPage}>
        Loading quotation…
      </div>
    );
  }

  const isFinal = ["APPROVED", "REJECTED", "CONVERTED", "EXPIRED"].includes(q.STATUS);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { background: #f1f5f9; margin: 0; }
        .public-shell {
          min-height: 100vh;
          padding: 30px 20px;
          font-family: Arial, Helvetica, sans-serif;
        }
        .public-action-bar {
          max-width: 210mm;
          margin: 0 auto 16px;
          background: #ef4444;
          color: white;
          padding: 14px 22px;
          border-radius: 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          box-shadow: 0 8px 30px rgba(99,102,241,0.35);
        }
        .public-action-bar h3 { margin:0; font-size: 16px; }
        .public-action-bar .sub { font-size: 12px; opacity: 0.85; margin-top: 2px; }
        .public-action-bar button {
          border: none;
          padding: 9px 18px;
          border-radius: 8px;
          font-weight: 700;
          cursor: pointer;
          margin-left: 8px;
          font-size: 13px;
        }
        .btn-approve { background:#10b981; color:white; }
        .btn-reject  { background:#fee2e2; color:#b91c1c; }
        .btn-print   { background:white; color:#0f172a; }
        .status-badge {
          display: inline-block;
          padding: 6px 14px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 1px;
        }
        .quot-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: white;
          padding: 18mm;
          box-shadow: 0 8px 30px rgba(0,0,0,0.1);
          color: #1f2937;
          font-size: 11.5pt;
        }
        .quot-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          border-bottom: 3px solid #0ea5e9;
          padding-bottom: 14px;
          margin-bottom: 18px;
        }
        .vendor-block h1 { margin: 0; font-size: 22pt; color: #0f172a; }
        .vendor-block .tag {
          color: #0ea5e9;
          font-weight: 800;
          font-size: 9pt;
          letter-spacing: 1.5px;
          margin-top: 2px;
        }
        .vendor-block .info {
          font-size: 9pt; color: #475569;
          line-height: 1.4; margin-top: 8px;
        }
        .quot-title { text-align: right; }
        .quot-title h2 {
          margin: 0; font-size: 18pt;
          letter-spacing: 4px; color: #475569;
        }
        .quot-title .num {
          font-size: 13pt; font-weight: 800;
          color: #0f172a; margin-top: 4px;
        }
        .quot-title .meta {
          font-size: 9pt; color: #64748b; margin-top: 8px;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px; margin-bottom: 18px;
        }
        .meta-card {
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 10px 12px;
          background: #f8fafc;
        }
        .meta-card .label {
          font-size: 8pt; color: #94a3b8;
          text-transform: uppercase; letter-spacing: 1.2px;
        }
        .meta-card .value {
          font-size: 11pt; font-weight: 700;
          color: #0f172a; margin-top: 2px;
        }
        .meta-card .sub { font-size: 9pt; color: #475569; }
        table.lines {
          width: 100%; border-collapse: collapse;
          margin-bottom: 14px; font-size: 10.5pt;
        }
        table.lines thead {
          background: #ef4444;
          color: white;
        }
        table.lines th { padding: 8px; text-align: left; font-size: 9.5pt; }
        table.lines td {
          padding: 8px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
        }
        table.lines tbody tr:nth-child(even) td { background: #f8fafc; }
        .total-grid {
          width: 280px; margin-left: auto; font-size: 10.5pt;
        }
        .total-grid .row {
          display: flex; justify-content: space-between; padding: 4px 0;
        }
        .total-grid .grand {
          font-size: 13pt; font-weight: 800; color: #047857;
          border-top: 2px solid #0f172a;
          margin-top: 6px; padding-top: 8px;
        }
        .section-title {
          font-size: 9pt; font-weight: 800;
          letter-spacing: 1.5px; color: #0ea5e9;
          text-transform: uppercase; margin: 18px 0 6px;
        }
        .terms {
          font-size: 9.5pt; color: #475569;
          white-space: pre-line; line-height: 1.5;
          background: #fafafa; padding: 10px 14px;
          border-left: 3px solid #0ea5e9; border-radius: 4px;
        }
        .footer {
          margin-top: 28px; padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          display: flex; justify-content: space-between;
          font-size: 9pt; color: #64748b;
        }
      `}</style>

      <div className="public-shell">

        {/* Action bar — hidden during print */}
        <div className="public-action-bar no-print">
          <div>
            <h3>📄 Quotation {q.QUOTATION_NUMBER}</h3>
            <div className="sub">
              From Bharath Vending Corporation · Valid till {q.EXPIRY_DATE}
            </div>
          </div>
          <div className={styles.actionBarRight}>

            {isFinal && (
              <span
                className={`status-badge ${q.STATUS === "APPROVED" ? styles.badgeApproved : styles.badgePending}`}
              >
                {q.STATUS}
              </span>
            )}

            {!isFinal && (
              <>
                <button
                  className="btn-approve"
                  disabled={responding}
                  onClick={() => respond("approve")}
                >
                  ✅ Approve
                </button>
                <button
                  className="btn-reject"
                  disabled={responding}
                  onClick={() => respond("reject")}
                >
                  ❌ Reject
                </button>
              </>
            )}

            <button className="btn-print" onClick={() => window.print()}>
              🖨️ Download PDF
            </button>
          </div>
        </div>

        <div className="quot-page">

          <div className="quot-header">
            <div className="vendor-block">
              <div className="tag">BVC24 · MANUFACTURING</div>
              <h1>Bharath Vending Corporation</h1>
              <div className="info">
                Plot No. 14, Industrial Estate, Chennai, Tamil Nadu - 600032<br/>
                GST: 33ABCDE1234F1Z5 · contact@bvc24.in · +91 90000 12345<br/>
                www.bvc24.in
              </div>
            </div>
            <div className="quot-title">
              <h2>QUOTATION</h2>
              <div className="num">{q.QUOTATION_NUMBER}</div>
              <div className="meta">
                Date: <b>{q.QUOTATION_DATE}</b><br/>
                Valid until: <b>{q.EXPIRY_DATE || "—"}</b><br/>
                Status: <b>{q.STATUS}</b>
              </div>
            </div>
          </div>

          <div className="meta-grid">
            <div className="meta-card">
              <div className="label">Quotation To</div>
              <div className="value">{q.CUSTOMER_NAME}</div>
              <div className="sub">{q.CUSTOMER_CODE}</div>
              <div className="sub">{q.CUSTOMER_ADDRESS}</div>
              {q.CUSTOMER_GST && <div className="sub">GST: {q.CUSTOMER_GST}</div>}
              <div className="sub">{q.CUSTOMER_PHONE} · {q.CUSTOMER_EMAIL}</div>
            </div>
            <div className="meta-card">
              <div className="label">Prepared By</div>
              <div className="value">{q.PREPARED_BY_NAME || "—"}</div>
              <div className={`sub ${styles.subMargin}`}>
                <span className="label">Tax Rate</span><br/>
                GST {q.TAX_PERCENT}%
              </div>
            </div>
          </div>

          <table className="lines">
            <thead>
              <tr>
                <th className={styles.colNum}>#</th>
                <th>Description</th>
                <th className={styles.colHsn}>HSN</th>
                <th className={styles.colQty}>Qty</th>
                <th className={styles.colUnit}>Unit</th>
                <th className={styles.colRate}>Rate</th>
                <th className={styles.colDisc}>Disc</th>
                <th className={styles.colAmt}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {(q.LINES || []).map((l, idx) => (
                <tr key={l.ID}>
                  <td>{idx + 1}</td>
                  <td>{l.DESCRIPTION}</td>
                  <td>{l.HSN_CODE || "—"}</td>
                  <td className={styles.tdRight}>{l.QUANTITY}</td>
                  <td>{l.UNIT}</td>
                  <td className={styles.tdRight}>{inr(l.UNIT_PRICE)}</td>
                  <td className={styles.tdRight}>{l.DISCOUNT_PERCENT}%</td>
                  <td className={styles.tdRightBold}>{inr(l.LINE_TOTAL)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="total-grid">
            <div className="row"><span>Subtotal</span><span>{inr(q.SUBTOTAL)}</span></div>
            {q.DISCOUNT_PERCENT > 0 && (
              <div className="row">
                <span>Discount ({q.DISCOUNT_PERCENT}%)</span>
                <span>− {inr(q.DISCOUNT_AMOUNT)}</span>
              </div>
            )}
            <div className="row">
              <span>GST ({q.TAX_PERCENT}%)</span>
              <span>{inr(q.TAX_AMOUNT)}</span>
            </div>
            <div className="row grand">
              <span>Grand Total</span>
              <span>{inr(q.GRAND_TOTAL)}</span>
            </div>
          </div>

          {q.NOTES && (
            <>
              <div className="section-title">Notes</div>
              <div className="terms">{q.NOTES}</div>
            </>
          )}

          {q.TERMS_AND_CONDITIONS && (
            <>
              <div className="section-title">Terms & Conditions</div>
              <div className="terms">{q.TERMS_AND_CONDITIONS}</div>
            </>
          )}

          <div className="footer">
            <span>www.bvc24.in · contact@bvc24.in</span>
            <span>Generated by BVC24 ERP</span>
          </div>
        </div>

      </div>

      {/* AI Negotiation Assistant — floating chat widget. Only
          renders while the quotation is still SENT (negotiable). */}
      <NegotiationChat
        token={token}
        quotationStatus={q.STATUS}
        onTotalsUpdated={load}
      />
    </>
  );
}


export default PublicQuotation;
