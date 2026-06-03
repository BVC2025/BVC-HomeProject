import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";


// ===================================================================
// GRNPrint — Goods Receipt Note printable view (A4).
// Official "we received the materials" proof that the warehouse
// supervisor + finance can sign and file. Opens in a new tab and
// auto-fires the browser print dialog.
// ===================================================================


function GRNPrint() {

  const { id } = useParams();

  const [grn, setGrn] = useState(null);

  const [company, setCompany] = useState(null);

  const [error, setError] = useState(null);

  useEffect(() => {

    Promise.all([
      API.get(`/purchase-orders/grn/${id}`),
      API.get("/settings/company").catch(() => ({ data: null })),
    ])
      .then(([gr, cr]) => { setGrn(gr.data); setCompany(cr.data || null); })
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load"));

  }, [id]);

  useEffect(() => {

    if (grn && company !== undefined) {

      const t = setTimeout(() => window.print(), 350);

      return () => clearTimeout(t);
    }

  }, [grn, company]);

  if (error) {

    return (
      <div style={{ padding: 40, color: "#b91c1c", fontFamily: "Arial" }}>
        Error: {error}
      </div>
    );
  }

  if (!grn) {

    return (
      <div style={{ padding: 40, color: "#94a3b8", fontFamily: "Arial" }}>
        Loading GRN…
      </div>
    );
  }

  const totalAccepted = grn.TOTAL_ACCEPTED
    ?? grn.LINES.reduce((s, l) => s + (l.QUANTITY_RECEIVED || 0), 0);

  const totalRejected = grn.TOTAL_REJECTED
    ?? grn.LINES.reduce((s, l) => s + (l.QUANTITY_REJECTED || 0), 0);

  return (
    <>
      <style>{`
        @page { size: A4; margin: 14mm; }
        @media print {
          body { background: white !important; }
          .no-print { display: none !important; }
        }
        body { background: #f1f5f9; }
        .grn-page {
          width: 210mm; min-height: 297mm; margin: 0 auto;
          background: white; padding: 18mm;
          box-shadow: 0 8px 30px rgba(0,0,0,0.1);
          font-family: Arial, sans-serif; color: #1f2937; font-size: 11.5pt;
        }
        .grn-header {
          display: flex; justify-content: space-between; align-items: flex-start;
          border-bottom: 3px solid #0ea5e9; padding-bottom: 14px; margin-bottom: 18px;
        }
        .vendor-block h1 { margin: 0; font-size: 22pt; color: #0f172a; }
        .vendor-block .tag {
          color: #0ea5e9; font-weight: 800; font-size: 9pt;
          letter-spacing: 1.5px; margin-top: 2px;
        }
        .vendor-block .info { font-size: 9pt; color: #475569; line-height: 1.4; margin-top: 8px; }
        .grn-title { text-align: right; }
        .grn-title h2 {
          margin: 0; font-size: 16pt; letter-spacing: 3px; color: #475569;
        }
        .grn-title .num { font-size: 13pt; font-weight: 800; color: #0f172a; margin-top: 4px; }
        .grn-title .meta { font-size: 9pt; color: #64748b; margin-top: 8px; }
        .status-stamp {
          display: inline-block;
          margin-top: 6px;
          padding: 4px 14px;
          border-radius: 6px;
          font-weight: 800;
          font-size: 11pt;
          letter-spacing: 2px;
        }
        .status-final { background: #dcfce7; color: #166534; border: 2px solid #166534; }
        .status-draft { background: #fef3c7; color: #854d0e; border: 2px dashed #854d0e; }

        .meta-grid {
          display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-bottom: 18px;
        }
        .meta-card {
          border: 1px solid #e2e8f0; border-radius: 6px;
          padding: 10px 12px; background: #f8fafc;
        }
        .meta-card .label {
          font-size: 8pt; color: #94a3b8;
          text-transform: uppercase; letter-spacing: 1.2px;
        }
        .meta-card .value { font-size: 11pt; font-weight: 700; color: #0f172a; margin-top: 2px; }
        .meta-card .sub { font-size: 9pt; color: #475569; }

        table.grn-lines {
          width: 100%; border-collapse: collapse;
          margin-bottom: 14px; font-size: 10.5pt;
        }
        table.grn-lines thead {
          background: linear-gradient(135deg,#C8102E,#8B0B1F); color: white;
        }
        table.grn-lines th { padding: 8px; text-align: left; font-size: 9.5pt; }
        table.grn-lines td { padding: 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
        table.grn-lines tbody tr:nth-child(even) td { background: #f8fafc; }

        .totals-box {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin: 14px 0 18px;
        }
        .totals-tile {
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 10px 14px;
          background: #f8fafc;
        }
        .totals-tile.accepted { border-left: 4px solid #10b981; }
        .totals-tile.rejected { border-left: 4px solid #ef4444; }
        .totals-tile.arrived  { border-left: 4px solid #0ea5e9; }
        .totals-tile .lbl { font-size: 9pt; color: #64748b; text-transform: uppercase; letter-spacing: 1.2px; }
        .totals-tile .val { font-size: 18pt; font-weight: 800; margin-top: 2px; color: #0f172a; }

        .rejection-block {
          background: #fef2f2;
          border-left: 3px solid #ef4444;
          padding: 10px 14px;
          border-radius: 4px;
          font-size: 10pt;
          color: #7f1d1d;
          margin-bottom: 14px;
        }

        .sig-block {
          margin-top: 36px; display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 30px; font-size: 10pt;
        }
        .sig {
          text-align: center;
          border-top: 1px solid #94a3b8;
          padding-top: 6px; color: #475569;
        }

        .footer {
          margin-top: 28px; padding-top: 14px;
          border-top: 1px solid #e2e8f0;
          display: flex; justify-content: space-between;
          font-size: 9pt; color: #64748b;
        }
      `}</style>

      <div className="grn-page">

        <div className="grn-header">

          <div className="vendor-block">
            <div className="tag">
              {(company?.SHORT_NAME || "BVC24")} · WAREHOUSE
            </div>
            <h1>{company?.LEGAL_NAME || "Bharath Vending Corporation"}</h1>
            <div className="info">
              {[
                company?.ADDRESS_LINE_1, company?.ADDRESS_LINE_2,
                company?.CITY, company?.STATE, company?.PINCODE,
              ].filter(Boolean).join(", ") ||
                "Plot No. 14, Industrial Estate, Chennai, Tamil Nadu - 600032"}<br/>
              {company?.GST_NUMBER && <>GST: {company.GST_NUMBER} · </>}
              {company?.EMAIL || "warehouse@bvc24.in"}
              {company?.PHONE && <> · {company.PHONE}</>}<br/>
              {company?.WEBSITE || "www.bvc24.in"}
            </div>
          </div>

          <div className="grn-title">
            <h2>GOODS RECEIPT NOTE</h2>
            <div className="num">{grn.GRN_NUMBER}</div>
            <div className="meta">
              Received: <b>{grn.RECEIVED_DATE}</b><br/>
              Against PO: <b>{grn.PO_NUMBER}</b>
              {grn.INVOICE_NUMBER && (
                <>
                  <br/>Supplier Invoice: <b>{grn.INVOICE_NUMBER}</b>
                </>
              )}
            </div>
            <div className={
              "status-stamp " + (grn.STATUS === "FINAL" ? "status-final" : "status-draft")
            }>
              {grn.STATUS}
            </div>
          </div>

        </div>

        <div className="meta-grid">
          <div className="meta-card">
            <div className="label">Supplier</div>
            <div className="value">{grn.SUPPLIER_NAME || "—"}</div>
            <div className="sub">{grn.SUPPLIER_CODE || ""}</div>
          </div>
          <div className="meta-card">
            <div className="label">Received By (Warehouse)</div>
            <div className="value">{grn.RECEIVED_BY_NAME || "—"}</div>
            <div className="sub">{grn.RECEIVED_DATE}</div>
          </div>
        </div>

        <table className="grn-lines">
          <thead>
            <tr>
              <th style={{ width: "5%" }}>#</th>
              <th>Material / Description</th>
              <th style={{ width: "10%", textAlign: "right" }}>Ordered</th>
              <th style={{ width: "12%", textAlign: "right" }}>Accepted</th>
              <th style={{ width: "12%", textAlign: "right" }}>Rejected</th>
              <th style={{ width: "10%" }}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {grn.LINES.map((l, idx) => (
              <tr key={l.ID}>
                <td>{idx + 1}</td>
                <td>
                  {l.DESCRIPTION || `PO Line #${l.PO_LINE_ID}`}
                  {Number(l.QUANTITY_REJECTED) > 0 && l.REJECTION_REASON && (
                    <div style={{ fontSize: "9pt", color: "#b91c1c", marginTop: 2, fontStyle: "italic" }}>
                      Reject reason: {l.REJECTION_REASON}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: "right", color: "#475569" }}>{l.ORDERED || "—"}</td>
                <td style={{ textAlign: "right", fontWeight: 700, color: "#047857" }}>
                  {l.QUANTITY_RECEIVED || 0}
                </td>
                <td style={{ textAlign: "right", fontWeight: 700, color: Number(l.QUANTITY_REJECTED) > 0 ? "#b91c1c" : "#cbd5e1" }}>
                  {l.QUANTITY_REJECTED || 0}
                </td>
                <td>{l.UNIT || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="totals-box">
          <div className="totals-tile arrived">
            <div className="lbl">Total Arrived</div>
            <div className="val">{(totalAccepted + totalRejected).toFixed(2)}</div>
            <div style={{ fontSize: "8.5pt", color: "#64748b", marginTop: 2 }}>
              accepted + rejected
            </div>
          </div>
          <div className="totals-tile accepted">
            <div className="lbl">✅ Accepted</div>
            <div className="val" style={{ color: "#047857" }}>{totalAccepted.toFixed(2)}</div>
            <div style={{ fontSize: "8.5pt", color: "#64748b", marginTop: 2 }}>
              added to inventory
            </div>
          </div>
          <div className="totals-tile rejected">
            <div className="lbl">❌ Rejected</div>
            <div className="val" style={{ color: "#b91c1c" }}>{totalRejected.toFixed(2)}</div>
            <div style={{ fontSize: "8.5pt", color: "#64748b", marginTop: 2 }}>
              sent back / debit note
            </div>
          </div>
        </div>

        {grn.NOTES && (
          <div className="rejection-block" style={{ background: "#fffbeb", borderColor: "#f59e0b", color: "#78350f" }}>
            <b>Notes:</b> {grn.NOTES}
          </div>
        )}

        <div className="sig-block">
          <div className="sig">Supplier Representative</div>
          <div className="sig">Warehouse Supervisor</div>
          <div className="sig">QC / Inspection</div>
        </div>

        <div className="footer">
          <span>
            Generated by BVC24 ERP · {new Date().toLocaleString("en-IN")}
            {grn.STATUS === "FINAL" && grn.FINALIZED_AT && (
              <> · Finalized: {new Date(grn.FINALIZED_AT).toLocaleString("en-IN")}</>
            )}
          </span>
          <span>Page 1 of 1</span>
        </div>
      </div>

      <div className="no-print" style={{
        position: "fixed", top: 16, right: 16, background: "white",
        border: "1px solid #e2e8f0", borderRadius: 8, padding: 8,
        boxShadow: "0 6px 20px rgba(0,0,0,0.1)"
      }}>
        <button onClick={() => window.print()} style={{
          border: "none", background: "linear-gradient(135deg,#C8102E,#8B0B1F)",
          color: "white", padding: "8px 18px", borderRadius: 6,
          fontWeight: 700, cursor: "pointer"
        }}>
          🖨️ Print / Save as PDF
        </button>
      </div>
    </>
  );
}


export default GRNPrint;
