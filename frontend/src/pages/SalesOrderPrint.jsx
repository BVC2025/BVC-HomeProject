import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

import API from "../services/api";
import styles from "./SalesOrderPrint.module.css";


function inr(n) {

  if (n === null || n === undefined || isNaN(n)) return "—";

  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}


function SalesOrderPrint() {

  const { id } = useParams();

  const [so, setSo] = useState(null);

  const [company, setCompany] = useState(null);

  const [error, setError] = useState(null);

  useEffect(() => {

    Promise.all([
      API.get(`/sales-orders/${id}`),
      API.get("/settings/company").catch(() => ({ data: null })),
    ])
      .then(([sr, cr]) => { setSo(sr.data); setCompany(cr.data || null); })
      .catch((e) => setError(e?.response?.data?.detail || "Failed to load"));

  }, [id]);

  useEffect(() => {

    if (so && company !== undefined) {

      const t = setTimeout(() => window.print(), 350);

      return () => clearTimeout(t);
    }

  }, [so, company]);

  if (error) return <div className={styles.stateError}>Error: {error}</div>;

  if (!so) return <div className={styles.stateLoading}>Loading…</div>;

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

      <div className={styles.soPage}>

        <div className={styles.soHeader}>
          <div className={styles.vendorBlock}>
            <div className="tag">
              {(company?.SHORT_NAME || "BVC24")} · SALES
            </div>
            <h1>{company?.LEGAL_NAME || "Bharath Vending Corporation"}</h1>
            <div className="info">
              {[
                company?.ADDRESS_LINE_1, company?.ADDRESS_LINE_2,
                company?.CITY, company?.STATE, company?.PINCODE,
              ].filter(Boolean).join(", ") ||
                "Plot No. 14, Industrial Estate, Chennai, Tamil Nadu - 600032"}<br/>
              {company?.GST_NUMBER && <>GST: {company.GST_NUMBER} · </>}
              {company?.EMAIL || "sales@bvc24.in"}
              {company?.PHONE && <> · {company.PHONE}</>}<br/>
              {company?.WEBSITE || "www.bvc24.in"}
            </div>
          </div>
          <div className={styles.soTitle}>
            <h2>SALES ORDER</h2>
            <div className="num">{so.SO_NUMBER}</div>
            <div className="meta">
              SO Date: <b>{so.SO_DATE}</b><br/>
              Expected Delivery: <b>{so.EXPECTED_DELIVERY_DATE || "—"}</b><br/>
              {so.QUOTATION_NUMBER && (<>From Quotation: <b>{so.QUOTATION_NUMBER}</b><br/></>)}
              Status: <b>{so.STATUS}</b>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className="label">Bill To</div>
            <div className="value">{so.CUSTOMER_NAME}</div>
            <div className="sub">{so.CUSTOMER_CODE}</div>
            <div className="sub">{so.BILLING_ADDRESS || so.CUSTOMER_ADDRESS}</div>
            {so.CUSTOMER_GST && <div className="sub">GST: {so.CUSTOMER_GST}</div>}
            <div className="sub">{so.CUSTOMER_PHONE} · {so.CUSTOMER_EMAIL}</div>
          </div>
          <div className={styles.metaCard}>
            <div className="label">Ship To</div>
            <div className={styles.shipToValue}>
              {so.SHIPPING_ADDRESS || so.BILLING_ADDRESS || so.CUSTOMER_ADDRESS || "—"}
            </div>
            <div className={styles.metaCardSubSpaced}>
              <span className="label">Prepared By</span><br/>{so.PREPARED_BY_NAME || "—"}
            </div>
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
            {(so.LINES || []).map((l, idx) => (
              <tr key={l.ID}>
                <td>{idx + 1}</td>
                <td>
                  {l.DESCRIPTION}
                  {l.PRODUCT_MODEL_CODE && (
                    <div className={styles.modelCode}>
                      Model: {l.PRODUCT_MODEL_CODE}
                    </div>
                  )}
                </td>
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
          <div className={styles.totalRow}><span>Subtotal</span><span>{inr(so.SUBTOTAL)}</span></div>
          {so.DISCOUNT_PERCENT > 0 && (
            <div className={styles.totalRow}>
              <span>Discount ({so.DISCOUNT_PERCENT}%)</span>
              <span>− {inr(so.DISCOUNT_AMOUNT)}</span>
            </div>
          )}
          <div className={styles.totalRow}><span>GST ({so.TAX_PERCENT}%)</span><span>{inr(so.TAX_AMOUNT)}</span></div>
          <div className={styles.grandRow}><span>Grand Total</span><span>{inr(so.GRAND_TOTAL)}</span></div>
        </div>

        <div className={styles.sectionTitle}>💰 Payment Schedule</div>
        <div className={styles.paymentBox}>
          <div className={styles.paymentRow}>
            <span><b>Advance ({so.ADVANCE_PERCENT}%)</b> — on order confirmation</span>
            <span><b>{inr(so.GRAND_TOTAL * so.ADVANCE_PERCENT / 100)}</b></span>
          </div>
          <div className={styles.paymentRow}>
            <span><b>On Dispatch ({so.DISPATCH_PERCENT}%)</b> — before shipment</span>
            <span><b>{inr(so.GRAND_TOTAL * so.DISPATCH_PERCENT / 100)}</b></span>
          </div>
          <div className={styles.paymentRow}>
            <span><b>On Installation ({so.INSTALLATION_PERCENT}%)</b> — at customer site</span>
            <span><b>{inr(so.GRAND_TOTAL * so.INSTALLATION_PERCENT / 100)}</b></span>
          </div>
        </div>

        {so.NOTES && (<><div className={styles.sectionTitle}>Notes</div><div className={styles.terms}>{so.NOTES}</div></>)}

        {so.TERMS_AND_CONDITIONS && (<><div className={styles.sectionTitle}>Terms & Conditions</div><div className={styles.terms}>{so.TERMS_AND_CONDITIONS}</div></>)}

        <div className={styles.sigBlock}>
          <div className={styles.sig}>Customer Signature</div>
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


export default SalesOrderPrint;
