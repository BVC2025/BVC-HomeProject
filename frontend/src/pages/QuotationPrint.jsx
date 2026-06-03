import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";


// ===================================================================
// QuotationPrint — A4-styled printable view that opens in a new tab.
// Users press the browser's Print → Save as PDF to export.
// ===================================================================


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


function QuotationPrint() {

  const { id } = useParams();

  const [q, setQ] = useState(null);

  const [company, setCompany] = useState(null);

  const [error, setError] = useState(null);

  useEffect(() => {

    Promise.all([
      API.get(`/quotations/${id}`),
      API.get("/settings/company").catch(() => ({ data: null })),
    ])
      .then(([qr, cr]) => {
        setQ(qr.data);
        setCompany(cr.data || null);
      })
      .catch((err) => setError(err?.response?.data?.detail || "Failed to load"));

  }, [id]);

  // Auto-trigger the print dialog once both quote + company are loaded
  useEffect(() => {

    if (q && company !== undefined) {

      // Small delay so styles settle before the browser snapshots
      const t = setTimeout(() => window.print(), 350);

      return () => clearTimeout(t);
    }

  }, [q, company]);

  if (error) {

    return (
      <div style={{ padding: 40, color: "#b91c1c", fontFamily: "Arial" }}>
        Error: {error}
      </div>
    );
  }

  if (!q) {

    return (
      <div style={{ padding: 40, color: "#94a3b8", fontFamily: "Arial" }}>
        Loading…
      </div>
    );
  }

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { background: #f1f5f9; }
        .quot-page {
          width: 210mm;
          min-height: 297mm;
          margin: 0 auto;
          background: white;
          padding: 18mm;
          box-shadow: 0 8px 30px rgba(0,0,0,0.1);
          font-family: 'Arial', 'Helvetica', sans-serif;
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
        .vendor-block h1 {
          margin: 0;
          font-size: 22pt;
          color: #0f172a;
          letter-spacing: -0.5px;
        }
        .vendor-block .tag {
          color: #0ea5e9;
          font-weight: 800;
          font-size: 9pt;
          letter-spacing: 1.5px;
          margin-top: 2px;
        }
        .vendor-block .info {
          font-size: 9pt;
          color: #475569;
          line-height: 1.4;
          margin-top: 8px;
        }
        .quot-title {
          text-align: right;
        }
        .quot-title h2 {
          margin: 0;
          font-size: 18pt;
          letter-spacing: 4px;
          color: #475569;
        }
        .quot-title .num {
          font-size: 13pt;
          font-weight: 800;
          color: #0f172a;
          margin-top: 4px;
        }
        .quot-title .meta {
          font-size: 9pt;
          color: #64748b;
          margin-top: 8px;
        }
        .meta-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 14px;
          margin-bottom: 18px;
        }
        .meta-card {
          border: 1px solid #e2e8f0;
          border-radius: 6px;
          padding: 10px 12px;
          background: #f8fafc;
        }
        .meta-card .label {
          font-size: 8pt;
          color: #94a3b8;
          text-transform: uppercase;
          letter-spacing: 1.2px;
        }
        .meta-card .value {
          font-size: 11pt;
          font-weight: 700;
          color: #0f172a;
          margin-top: 2px;
        }
        .meta-card .sub {
          font-size: 9pt;
          color: #475569;
          margin-top: 1px;
        }
        table.lines {
          width: 100%;
          border-collapse: collapse;
          margin-bottom: 14px;
          font-size: 10.5pt;
        }
        table.lines thead {
          background: linear-gradient(135deg,#C8102E,#8B0B1F);
          color: white;
        }
        table.lines th {
          padding: 8px;
          text-align: left;
          font-size: 9.5pt;
          letter-spacing: 0.5px;
        }
        table.lines td {
          padding: 8px;
          border-bottom: 1px solid #e2e8f0;
          vertical-align: top;
        }
        table.lines tbody tr:nth-child(even) td {
          background: #f8fafc;
        }
        .total-grid {
          width: 280px;
          margin-left: auto;
          font-size: 10.5pt;
        }
        .total-grid .row {
          display: flex;
          justify-content: space-between;
          padding: 4px 0;
        }
        .total-grid .grand {
          font-size: 13pt;
          font-weight: 800;
          color: #047857;
          border-top: 2px solid #0f172a;
          margin-top: 6px;
          padding-top: 8px;
        }
        .section-title {
          font-size: 9pt;
          font-weight: 800;
          letter-spacing: 1.5px;
          color: #0ea5e9;
          text-transform: uppercase;
          margin: 18px 0 6px;
        }
        .terms {
          font-size: 9.5pt;
          color: #475569;
          white-space: pre-line;
          line-height: 1.5;
          background: #fafafa;
          padding: 10px 14px;
          border-left: 3px solid #0ea5e9;
          border-radius: 4px;
        }
        .footer {
          margin-top: 28px;
          padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          display: flex;
          justify-content: space-between;
          font-size: 9pt;
          color: #64748b;
        }
        .sig-block {
          margin-top: 30px;
          display: flex;
          justify-content: space-between;
          font-size: 10pt;
        }
        .sig-block .sig {
          width: 200px;
          text-align: center;
          border-top: 1px solid #94a3b8;
          padding-top: 6px;
          color: #475569;
        }
      `}</style>

      <div className="quot-page">

        <div className="quot-header">
          <div className="vendor-block">
            <div className="tag">
              {(company?.SHORT_NAME || "BVC24")} · QUOTATION
            </div>
            <h1>{company?.LEGAL_NAME || "Bharath Vending Corporation"}</h1>
            <div className="info">
              {[
                company?.ADDRESS_LINE_1,
                company?.ADDRESS_LINE_2,
                company?.CITY,
                company?.STATE,
                company?.PINCODE,
              ].filter(Boolean).join(", ") ||
                "Plot No. 14, Industrial Estate, Chennai, Tamil Nadu - 600032"}
              <br/>
              {company?.GST_NUMBER && <>GST: {company.GST_NUMBER} · </>}
              {company?.PAN_NUMBER && <>PAN: {company.PAN_NUMBER} · </>}
              {company?.EMAIL || "contact@bvc24.in"}
              {company?.PHONE && <> · {company.PHONE}</>}<br/>
              {company?.WEBSITE || "www.bvc24.in"}
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
            {q.CUSTOMER_GST && (
              <div className="sub">GST: {q.CUSTOMER_GST}</div>
            )}
            <div className="sub">{q.CUSTOMER_PHONE} · {q.CUSTOMER_EMAIL}</div>
          </div>
          <div className="meta-card">
            <div className="label">Prepared By</div>
            <div className="value">{q.PREPARED_BY_NAME || "—"}</div>
            <div className="sub" style={{ marginTop: 8 }}>
              <span className="label">Tax Rate</span><br/>
              GST {q.TAX_PERCENT}%
            </div>
          </div>
        </div>

        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: "5%" }}>#</th>
              <th>Description</th>
              <th style={{ width: "12%" }}>HSN</th>
              <th style={{ width: "8%", textAlign: "right" }}>Qty</th>
              <th style={{ width: "8%" }}>Unit</th>
              <th style={{ width: "13%", textAlign: "right" }}>Rate</th>
              <th style={{ width: "8%", textAlign: "right" }}>Disc</th>
              <th style={{ width: "16%", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(q.LINES || []).map((l, idx) => (
              <tr key={l.ID}>
                <td>{idx + 1}</td>
                <td>{l.DESCRIPTION}</td>
                <td>{l.HSN_CODE || "—"}</td>
                <td style={{ textAlign: "right" }}>{l.QUANTITY}</td>
                <td>{l.UNIT}</td>
                <td style={{ textAlign: "right" }}>{inr(l.UNIT_PRICE)}</td>
                <td style={{ textAlign: "right" }}>{l.DISCOUNT_PERCENT}%</td>
                <td style={{ textAlign: "right", fontWeight: 700 }}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="total-grid">
          <div className="row">
            <span>Subtotal</span>
            <span>{inr(q.SUBTOTAL)}</span>
          </div>
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

        <div className="sig-block">
          <div className="sig">Customer Signature</div>
          <div className="sig">For {company?.LEGAL_NAME || "Bharath Vending Corp."}</div>
        </div>

        <div className="footer">
          <span>Generated by BVC24 ERP · {new Date().toLocaleString("en-IN")}</span>
          <span>Page 1 of 1</span>
        </div>
      </div>

      <div className="no-print" style={{
        position: "fixed", top: 16, right: 16,
        background: "white", border: "1px solid #e2e8f0",
        borderRadius: 8, padding: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.1)"
      }}>
        <button
          onClick={() => window.print()}
          style={{
            border: "none",
            background: "linear-gradient(135deg,#C8102E,#8B0B1F)",
            color: "white",
            padding: "8px 18px",
            borderRadius: 6,
            fontWeight: 700,
            cursor: "pointer"
          }}
        >
          🖨️ Print / Save as PDF
        </button>
      </div>
    </>
  );
}


export default QuotationPrint;
