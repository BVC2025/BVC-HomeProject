import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";
import styles from "./GRNPrint.module.css";


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
      <div className={styles.stateError}>
        Error: {error}
      </div>
    );
  }

  if (!grn) {

    return (
      <div className={styles.stateLoading}>
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
      `}</style>

      <div className={styles.grnPage}>

        <div className={styles.grnHeader}>

          <div className={styles.vendorBlock}>
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

          <div className={styles.grnTitle}>
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
            <div className={`${styles.statusStamp} ${grn.STATUS === "FINAL" ? styles.statusFinal : styles.statusDraft}`}>
              {grn.STATUS}
            </div>
          </div>

        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className="label">Supplier</div>
            <div className="value">{grn.SUPPLIER_NAME || "—"}</div>
            <div className="sub">{grn.SUPPLIER_CODE || ""}</div>
          </div>
          <div className={styles.metaCard}>
            <div className="label">Received By (Warehouse)</div>
            <div className="value">{grn.RECEIVED_BY_NAME || "—"}</div>
            <div className="sub">{grn.RECEIVED_DATE}</div>
          </div>
        </div>

        <table className={styles.grnLines}>
          <thead>
            <tr>
              <th className={styles.colNum}>#</th>
              <th>Material / Description</th>
              <th className={styles.colOrdered}>Ordered</th>
              <th className={styles.colAccepted}>Accepted</th>
              <th className={styles.colRejected}>Rejected</th>
              <th className={styles.colUnit}>Unit</th>
            </tr>
          </thead>
          <tbody>
            {grn.LINES.map((l, idx) => (
              <tr key={l.ID}>
                <td>{idx + 1}</td>
                <td>
                  {l.DESCRIPTION || `PO Line #${l.PO_LINE_ID}`}
                  {Number(l.QUANTITY_REJECTED) > 0 && l.REJECTION_REASON && (
                    <div className={styles.rejectNote}>
                      Reject reason: {l.REJECTION_REASON}
                    </div>
                  )}
                </td>
                <td className={styles.cellOrdered}>{l.ORDERED || "—"}</td>
                <td className={styles.cellAccepted}>
                  {l.QUANTITY_RECEIVED || 0}
                </td>
                {/* Rejected qty color is runtime-dynamic: red when > 0, muted otherwise */}
                <td style={{
                  textAlign: "right",
                  fontWeight: 700,
                  color: Number(l.QUANTITY_REJECTED) > 0 ? "#b91c1c" : "#cbd5e1"
                }}>
                  {l.QUANTITY_REJECTED || 0}
                </td>
                <td>{l.UNIT || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.totalsBox}>
          <div className={`${styles.totalsTile} ${styles.totalsTileArrived}`}>
            <div className="lbl">Total Arrived</div>
            <div className="val">{(totalAccepted + totalRejected).toFixed(2)}</div>
            <div className={styles.tileSubText}>
              accepted + rejected
            </div>
          </div>
          <div className={`${styles.totalsTile} ${styles.totalsTileAccepted}`}>
            <div className="lbl">✅ Accepted</div>
            <div className={`val ${styles.valAccepted}`}>{totalAccepted.toFixed(2)}</div>
            <div className={styles.tileSubText}>
              added to inventory
            </div>
          </div>
          <div className={`${styles.totalsTile} ${styles.totalsTileRejected}`}>
            <div className="lbl">❌ Rejected</div>
            <div className={`val ${styles.valRejected}`}>{totalRejected.toFixed(2)}</div>
            <div className={styles.tileSubText}>
              sent back / debit note
            </div>
          </div>
        </div>

        {grn.NOTES && (
          <div className={styles.notesBlock}>
            <b>Notes:</b> {grn.NOTES}
          </div>
        )}

        <div className={styles.sigBlock}>
          <div className={styles.sig}>Supplier Representative</div>
          <div className={styles.sig}>Warehouse Supervisor</div>
          <div className={styles.sig}>QC / Inspection</div>
        </div>

        <div className={styles.footer}>
          <span>
            Generated by BVC24 ERP · {new Date().toLocaleString("en-IN")}
            {grn.STATUS === "FINAL" && grn.FINALIZED_AT && (
              <> · Finalized: {new Date(grn.FINALIZED_AT).toLocaleString("en-IN")}</>
            )}
          </span>
          <span>Page 1 of 1</span>
        </div>
      </div>

      <div className={`no-print ${styles.printButtonWrap}`}>
        <button onClick={() => window.print()} className={styles.printButton}>
          🖨️ Print / Save as PDF
        </button>
      </div>
    </>
  );
}


export default GRNPrint;
