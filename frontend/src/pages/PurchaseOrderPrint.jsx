import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}


function PurchaseOrderPrint() {

  const { id } = useParams();

  const [po, setPo] = useState(null);

  const [company, setCompany] = useState(null);

  const [error, setError] = useState(null);

  useEffect(() => {

    Promise.all([
      API.get(`/purchase-orders/${id}`),
      API.get("/settings/company").catch(() => ({ data: null })),
    ])
      .then(([pr, cr]) => { setPo(pr.data); setCompany(cr.data || null); })
      .catch((err) => setError(err?.response?.data?.detail || "Failed to load"));

  }, [id]);

  useEffect(() => {

    if (po && company !== undefined) {

      const t = setTimeout(() => window.print(), 350);

      return () => clearTimeout(t);
    }

  }, [po, company]);

  if (error) return <div style={{ padding: 40, color: "#b91c1c", fontFamily: "Arial" }}>Error: {error}</div>;

  if (!po) return <div style={{ padding: 40, color: "#94a3b8", fontFamily: "Arial" }}>Loading…</div>;

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { background: #f1f5f9; }
        .po-page {
          width: 210mm; min-height: 297mm; margin: 0 auto;
          background: white; padding: 18mm;
          box-shadow: 0 8px 30px rgba(0,0,0,0.1);
          font-family: Arial, sans-serif; color: #1f2937; font-size: 11.5pt;
        }
        .po-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid #f59e0b; padding-bottom: 14px; margin-bottom: 18px;
        }
        .vendor-block h1 { margin: 0; font-size: 22pt; color: #0f172a; }
        .vendor-block .tag {
          color: #f59e0b; font-weight: 800; font-size: 9pt;
          letter-spacing: 1.5px; margin-top: 2px;
        }
        .vendor-block .info { font-size: 9pt; color: #475569; line-height: 1.4; margin-top: 8px; }
        .po-title { text-align: right; }
        .po-title h2 { margin: 0; font-size: 18pt; letter-spacing: 4px; color: #475569; }
        .po-title .num { font-size: 13pt; font-weight: 800; color: #0f172a; margin-top: 4px; }
        .po-title .meta { font-size: 9pt; color: #64748b; margin-top: 8px; }
        .meta-grid {
          display: grid; grid-template-columns: 1fr 1fr;
          gap: 14px; margin-bottom: 18px;
        }
        .meta-card {
          border: 1px solid #e2e8f0; border-radius: 6px;
          padding: 10px 12px; background: #fffbeb;
        }
        .meta-card .label {
          font-size: 8pt; color: #94a3b8;
          text-transform: uppercase; letter-spacing: 1.2px;
        }
        .meta-card .value { font-size: 11pt; font-weight: 700; color: #0f172a; margin-top: 2px; }
        .meta-card .sub { font-size: 9pt; color: #475569; }
        table.lines {
          width: 100%; border-collapse: collapse;
          margin-bottom: 14px; font-size: 10.5pt;
        }
        table.lines thead {
          background: linear-gradient(135deg,#F4B324,#C8102E); color: white;
        }
        table.lines th { padding: 8px; text-align: left; font-size: 9.5pt; }
        table.lines td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        table.lines tbody tr:nth-child(even) td { background: #f8fafc; }
        .total-grid { width: 280px; margin-left: auto; font-size: 10.5pt; }
        .total-grid .row { display: flex; justify-content: space-between; padding: 4px 0; }
        .total-grid .grand {
          font-size: 13pt; font-weight: 800; color: #b45309;
          border-top: 2px solid #0f172a; margin-top: 6px; padding-top: 8px;
        }
        .section-title {
          font-size: 9pt; font-weight: 800; letter-spacing: 1.5px;
          color: #d97706; text-transform: uppercase; margin: 18px 0 6px;
        }
        .terms {
          font-size: 9.5pt; color: #475569; white-space: pre-line;
          line-height: 1.5; background: #fafafa; padding: 10px 14px;
          border-left: 3px solid #f59e0b; border-radius: 4px;
        }
        .footer {
          margin-top: 28px; padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          display: flex; justify-content: space-between;
          font-size: 9pt; color: #64748b;
        }
        .sig-block {
          margin-top: 30px; display: flex; justify-content: space-between;
          font-size: 10pt;
        }
        .sig {
          width: 200px; text-align: center;
          border-top: 1px solid #94a3b8; padding-top: 6px; color: #475569;
        }
      `}</style>

      <div className="po-page">

        <div className="po-header">
          <div className="vendor-block">
            <div className="tag">
              {(company?.SHORT_NAME || "BVC24")} · PROCUREMENT
            </div>
            <h1>{company?.LEGAL_NAME || "Bharath Vending Corporation"}</h1>
            <div className="info">
              {[
                company?.ADDRESS_LINE_1, company?.ADDRESS_LINE_2,
                company?.CITY, company?.STATE, company?.PINCODE,
              ].filter(Boolean).join(", ") ||
                "Plot No. 14, Industrial Estate, Chennai, Tamil Nadu - 600032"}<br/>
              {company?.GST_NUMBER && <>GST: {company.GST_NUMBER} · </>}
              {company?.EMAIL || "procurement@bvc24.in"}
              {company?.PHONE && <> · {company.PHONE}</>}<br/>
              {company?.WEBSITE || "www.bvc24.in"}
            </div>
          </div>
          <div className="po-title">
            <h2>PURCHASE ORDER</h2>
            <div className="num">{po.PO_NUMBER}</div>
            <div className="meta">
              Date: <b>{po.PO_DATE}</b><br/>
              Expected Delivery: <b>{po.EXPECTED_DELIVERY_DATE || "—"}</b><br/>
              Status: <b>{po.STATUS}</b>
            </div>
          </div>
        </div>

        <div className="meta-grid">
          <div className="meta-card">
            <div className="label">Supplier</div>
            <div className="value">{po.SUPPLIER_NAME}</div>
            <div className="sub">{po.SUPPLIER_CODE}</div>
            <div className="sub">{po.SUPPLIER_ADDRESS}</div>
            {po.SUPPLIER_GST && <div className="sub">GST: {po.SUPPLIER_GST}</div>}
            <div className="sub">{po.SUPPLIER_PHONE} · {po.SUPPLIER_EMAIL}</div>
          </div>
          <div className="meta-card">
            <div className="label">Ship To</div>
            <div className="value" style={{ whiteSpace: "pre-line", fontSize: "10pt", fontWeight: 600 }}>
              {po.DELIVERY_ADDRESS || company?.LEGAL_NAME || "Bharath Vending Corporation"}
            </div>
            <div className="sub" style={{ marginTop: 8 }}>
              <span className="label">Prepared By</span><br/>{po.PREPARED_BY_NAME || "—"}
            </div>
            {po.LINKED_PROJECT_NAME && (
              <div className="sub" style={{ marginTop: 6 }}>
                <span className="label">For Project</span><br/>{po.LINKED_PROJECT_NAME}
              </div>
            )}
          </div>
        </div>

        <table className="lines">
          <thead>
            <tr>
              <th style={{ width: "5%" }}>#</th>
              <th>Description</th>
              <th style={{ width: "10%" }}>HSN</th>
              <th style={{ width: "8%", textAlign: "right" }}>Qty</th>
              <th style={{ width: "8%" }}>Unit</th>
              <th style={{ width: "13%", textAlign: "right" }}>Rate</th>
              <th style={{ width: "8%", textAlign: "right" }}>Disc</th>
              <th style={{ width: "16%", textAlign: "right" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {(po.LINES || []).map((l, idx) => (
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
          <div className="row"><span>Subtotal</span><span>{inr(po.SUBTOTAL)}</span></div>
          {po.DISCOUNT_PERCENT > 0 && (
            <div className="row">
              <span>Discount ({po.DISCOUNT_PERCENT}%)</span>
              <span>− {inr(po.DISCOUNT_AMOUNT)}</span>
            </div>
          )}
          <div className="row"><span>GST ({po.TAX_PERCENT}%)</span><span>{inr(po.TAX_AMOUNT)}</span></div>
          <div className="row grand"><span>Grand Total</span><span>{inr(po.GRAND_TOTAL)}</span></div>
        </div>

        {po.NOTES && (<><div className="section-title">Notes</div><div className="terms">{po.NOTES}</div></>)}

        {po.TERMS_AND_CONDITIONS && (<><div className="section-title">Terms & Conditions</div><div className="terms">{po.TERMS_AND_CONDITIONS}</div></>)}

        <div className="sig-block">
          <div className="sig">Supplier Acknowledgment</div>
          <div className="sig">For {company?.LEGAL_NAME || "Bharath Vending Corp."}</div>
        </div>

        <div className="footer">
          <span>Generated by BVC24 ERP · {new Date().toLocaleString("en-IN")}</span>
          <span>Page 1 of 1</span>
        </div>
      </div>

      <div className="no-print" style={{ position: "fixed", top: 16, right: 16, background: "white", border: "1px solid #e2e8f0", borderRadius: 8, padding: 8, boxShadow: "0 6px 20px rgba(0,0,0,0.1)" }}>
        <button onClick={() => window.print()} style={{ border: "none", background: "linear-gradient(135deg,#F4B324,#C8102E)", color: "white", padding: "8px 18px", borderRadius: 6, fontWeight: 700, cursor: "pointer" }}>
          🖨️ Print / Save as PDF
        </button>
      </div>
    </>
  );
}


export default PurchaseOrderPrint;
