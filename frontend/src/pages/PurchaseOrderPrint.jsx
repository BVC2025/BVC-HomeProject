import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";
import styles from "./PurchaseOrderPrint.module.css";


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

  if (error) return <div className={styles.stateError}>Error: {error}</div>;

  if (!po) return <div className={styles.stateLoading}>Loading…</div>;

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

      <div className={styles.poPage}>

        <div className={styles.poHeader}>
          <div className={styles.vendorBlock}>
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
          <div className={styles.poTitle}>
            <h2>PURCHASE ORDER</h2>
            <div className="num">{po.PO_NUMBER}</div>
            <div className="meta">
              Date: <b>{po.PO_DATE}</b><br/>
              Expected Delivery: <b>{po.EXPECTED_DELIVERY_DATE || "—"}</b><br/>
              Status: <b>{po.STATUS}</b>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className="label">Supplier</div>
            <div className="value">{po.SUPPLIER_NAME}</div>
            <div className="sub">{po.SUPPLIER_CODE}</div>
            <div className="sub">{po.SUPPLIER_ADDRESS}</div>
            {po.SUPPLIER_GST && <div className="sub">GST: {po.SUPPLIER_GST}</div>}
            <div className="sub">{po.SUPPLIER_PHONE} · {po.SUPPLIER_EMAIL}</div>
          </div>
          <div className={styles.metaCard}>
            <div className="label">Ship To</div>
            <div className={styles.shipToValue}>
              {po.DELIVERY_ADDRESS || company?.LEGAL_NAME || "Bharath Vending Corporation"}
            </div>
            <div className={styles.metaCardSubSpaced}>
              <span className="label">Prepared By</span><br/>{po.PREPARED_BY_NAME || "—"}
            </div>
            {po.LINKED_PROJECT_NAME && (
              <div className={styles.metaCardSubProject}>
                <span className="label">For Project</span><br/>{po.LINKED_PROJECT_NAME}
              </div>
            )}
          </div>
        </div>

        <table className={styles.linesTable}>
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
            {(po.LINES || []).map((l, idx) => (
              <tr key={l.ID}>
                <td>{idx + 1}</td>
                <td>{l.DESCRIPTION}</td>
                <td>{l.HSN_CODE || "—"}</td>
                <td className={styles.textRight}>{l.QUANTITY}</td>
                <td>{l.UNIT}</td>
                <td className={styles.textRight}>{inr(l.UNIT_PRICE)}</td>
                <td className={styles.textRight}>{l.DISCOUNT_PERCENT}%</td>
                <td className={styles.textRightBold}>{inr(l.LINE_TOTAL)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className={styles.totalGrid}>
          <div className={styles.totalRow}><span>Subtotal</span><span>{inr(po.SUBTOTAL)}</span></div>
          {po.DISCOUNT_PERCENT > 0 && (
            <div className={styles.totalRow}>
              <span>Discount ({po.DISCOUNT_PERCENT}%)</span>
              <span>− {inr(po.DISCOUNT_AMOUNT)}</span>
            </div>
          )}
          <div className={styles.totalRow}><span>GST ({po.TAX_PERCENT}%)</span><span>{inr(po.TAX_AMOUNT)}</span></div>
          <div className={styles.grandRow}><span>Grand Total</span><span>{inr(po.GRAND_TOTAL)}</span></div>
        </div>

        {po.NOTES && (<><div className={styles.sectionTitle}>Notes</div><div className={styles.terms}>{po.NOTES}</div></>)}

        {po.TERMS_AND_CONDITIONS && (<><div className={styles.sectionTitle}>Terms & Conditions</div><div className={styles.terms}>{po.TERMS_AND_CONDITIONS}</div></>)}

        <div className={styles.sigBlock}>
          <div className={styles.sig}>Supplier Acknowledgment</div>
          <div className={styles.sig}>For {company?.LEGAL_NAME || "Bharath Vending Corp."}</div>
        </div>

        <div className={styles.footer}>
          <span>Generated by BVC24 ERP · {new Date().toLocaleString("en-IN")}</span>
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


export default PurchaseOrderPrint;
