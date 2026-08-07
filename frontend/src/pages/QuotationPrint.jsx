import { useEffect, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";

import API from "../services/api";
import styles from "./QuotationPrint.module.css";


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

  const [searchParams] = useSearchParams();

  const isDownload = searchParams.get("download") === "1";

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

      // Set document title = quotation number so "Save as PDF" uses it as filename
      document.title = q.QUOTATION_NUMBER || "Quotation";

      const t = setTimeout(() => window.print(), 350);

      return () => clearTimeout(t);
    }

  }, [q, company]);

  if (error) {

    return (
      <div className={styles.stateError}>
        Error: {error}
      </div>
    );
  }

  if (!q) {

    return (
      <div className={styles.stateLoading}>
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
      `}</style>

      {/* {isDownload && (
        <div className="no-print" style={{
          position: "fixed",
          top: 0, left: 0, right: 0,
          background: "#0f172a",
          color: "white",
          padding: "10px 20px",
          fontSize: 13,
          fontFamily: "Arial",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          zIndex: 9999
        }}>
          <span>📥 In the print dialog — change <b>Destination</b> to <b>"Save as PDF"</b>, then click Save.</span>
          <button
            onClick={() => window.print()}
            style={{
              background: "#ef4444",
              color: "white",
              border: "none",
              padding: "6px 16px",
              borderRadius: 6,
              cursor: "pointer",
              fontWeight: 700,
              fontSize: 13
            }}
          >
            ⬇️ Save as PDF
          </button>
        </div>
      )} */}

      <div className={`${styles.quotPage}${isDownload ? ` ${styles.quotPageDownload}` : ""}`}>

        <div className={styles.quotHeader}>
          <div className={styles.vendorBlock}>
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
          <div className={styles.quotTitle}>
            <h2>QUOTATION</h2>
            <div className="num">{q.QUOTATION_NUMBER}</div>
            <div className="meta">
              Date: <b>{q.QUOTATION_DATE}</b><br/>
              Valid until: <b>{q.EXPIRY_DATE || "—"}</b><br/>
              Status: <b>{q.STATUS}</b>
            </div>
          </div>
        </div>

        <div className={styles.metaGrid}>
          <div className={styles.metaCard}>
            <div className="label">Quotation To</div>
            <div className="value">{q.CUSTOMER_NAME}</div>
            <div className="sub">{q.CUSTOMER_CODE}</div>
            <div className="sub">{q.CUSTOMER_ADDRESS}</div>
            {q.CUSTOMER_GST && (
              <div className="sub">GST: {q.CUSTOMER_GST}</div>
            )}
            <div className="sub">{q.CUSTOMER_PHONE} · {q.CUSTOMER_EMAIL}</div>
          </div>
          <div className={styles.metaCard}>
            <div className="label">Prepared By</div>
            <div className="value">{q.PREPARED_BY_NAME || "—"}</div>
            <div className={styles.metaCardSubSpaced}>
              <span className="label">Tax Rate</span><br/>
              GST {q.TAX_PERCENT}%
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
            {(q.LINES || []).map((l, idx) => (
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
          <div className={styles.totalRow}>
            <span>Subtotal</span>
            <span>{inr(q.SUBTOTAL)}</span>
          </div>
          {q.DISCOUNT_PERCENT > 0 && (
            <div className={styles.totalRow}>
              <span>Discount ({q.DISCOUNT_PERCENT}%)</span>
              <span>− {inr(q.DISCOUNT_AMOUNT)}</span>
            </div>
          )}
          <div className={styles.totalRow}>
            <span>GST ({q.TAX_PERCENT}%)</span>
            <span>{inr(q.TAX_AMOUNT)}</span>
          </div>
          <div className={styles.grandRow}>
            <span>Grand Total</span>
            <span>{inr(q.GRAND_TOTAL)}</span>
          </div>
        </div>

        {q.NOTES && (
          <>
            <div className={styles.sectionTitle}>Notes</div>
            <div className={styles.terms}>{q.NOTES}</div>
          </>
        )}

        {q.TERMS_AND_CONDITIONS && (
          <>
            <div className={styles.sectionTitle}>Terms & Conditions</div>
            <div className={styles.terms}>{q.TERMS_AND_CONDITIONS}</div>
          </>
        )}

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
        <button
          onClick={() => window.print()}
          className={styles.printButton}
        >
          🖨️ Print / Save as PDF
        </button>
      </div>
    </>
  );
}


export default QuotationPrint;
