import { useEffect, useLayoutEffect, useRef, useState } from "react";

import API from "../services/api";
import styles from "./InvoiceOrder.module.css";


// ===================================================================
// InvoiceOrder — editable invoice / credit-note builder.
//
// Faithfully reproduces the BVC printed invoice layout (logo + company
// header, document title bar, Inv/Vendor meta grid, Vendor & Delivery
// address blocks, line-item table, terms + totals, amount-in-words,
// bank details, signatures). EVERY field on the sheet is editable.
//
// Flow:  Pick Customer → auto-fills vendor/delivery → edit lines →
//        Download PDF (html2pdf) or Print / Export PDF (window.print).
// ===================================================================


// ── Indian-format currency: "2,92,875.42" (no symbol, matches print) ──
function fmt(n) {

  return Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}


// ── Indian number-to-words (lakh / crore grouping) ──
function numberToWordsIndian(value) {

  let num = Math.round(Number(value) || 0);

  if (num === 0) return "Zero";

  const ones = [
    "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight",
    "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen",
    "Sixteen", "Seventeen", "Eighteen", "Nineteen"
  ];

  const tens = [
    "", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy",
    "Eighty", "Ninety"
  ];

  const twoDigits = (n) => {
    if (n < 20) return ones[n];
    return tens[Math.floor(n / 10)] + (n % 10 ? "-" + ones[n % 10] : "");
  };

  const threeDigits = (n) => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    let s = "";
    if (h) s += ones[h] + " Hundred";
    if (r) s += (h ? " And " : "") + twoDigits(r);
    return s;
  };

  let words = "";

  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const rest = num;

  if (crore) words += twoDigits(crore) + " Crore ";
  if (lakh) words += twoDigits(lakh) + " Lakh ";
  if (thousand) words += twoDigits(thousand) + " Thousand ";
  if (rest) words += threeDigits(rest);

  return words.trim();
}


// ── Defaults seeded from the reference document ──
const DEFAULT_COMPANY = {
  name: "Bharath Vending Corporation",
  addr1: "Plot No : 16B, E&E Industrial Estate, Sitra,",
  addr2: "Civil Aerodrome Post, Coimbatore - 641 014, TN, INDIA.",
  gst: "33AAXFB2859F1Z6",
  contact: "Email: info@bvc24.com | Website: www.bvc24.com | +91 422 4356565",
  bank: "Acc. No : 50200100064100 | IFS Code : HDFC0001068 | Bank : HDFC Bank Ltd | Branch : Kalapatti Main Road | Coimbatore - 641011. TN, India."
};

const DEFAULT_INV = {
  docType: "CREDIT NOTE",
  invNo: "BVC - CN / 25-26 / 001",
  invDate: "05-08-2025",
  poNo: "Verbal",
  vendorGst: "33AAJCN6225C1ZS",
  contactName: "Mr. Padmanabhan Pradeep Siddharth",
  contactNo: "+91 97900 61523",
  vendorAddress:
    "NUTRIPHARM LIFE SCIENCES PRIVATE LIMITED\nNo-15B, Saibaba colony, NSR Road\nCoimbatore, Tamil Nadu, 641 011",
  deliveryAddress:
    "NUTRIPHARM LIFE SCIENCES PRIVATE LIMITED\nNo-15B, Saibaba colony, NSR Road\nCoimbatore, Tamil Nadu, 641 011",
  gstPercent: 18,
  receiverName: "NUTRIPHARM LIFE SCIENCES PRIVATE LIMITED"
};

const DEFAULT_TERMS = [
  "We declare that this invoice shows the actual price of the goods described and that all particulars are true and currect.",
  "Fright in Extra and unloading charges on customer scope.",
  "Subject to Coimbatore Jurisdication."
];

const DEFAULT_LINES = [
  {
    desc: "BVC – Smart Snacks & Beverage Vending Machine Model: BSV - 610",
    hsn: "8476",
    qty: 1,
    unit: "No",
    price: 292875.42
  }
];

const DOC_TYPES = ["CREDIT NOTE", "TAX INVOICE", "PROFORMA INVOICE", "DEBIT NOTE"];


function InvoiceOrder() {

  const [company, setCompany] = useState(DEFAULT_COMPANY);
  const [inv, setInv] = useState(DEFAULT_INV);
  const [terms, setTerms] = useState(DEFAULT_TERMS);
  const [lines, setLines] = useState(DEFAULT_LINES);
  const [logo, setLogo] = useState("/logo.webp");

  const [customers, setCustomers] = useState([]);
  const [pickedCustomer, setPickedCustomer] = useState("");
  const [busy, setBusy] = useState(false);

  const pageRef = useRef(null);

  // Load the customer list for the "Pick Customer" dropdown.
  useEffect(() => {
    API.get("/customers")
      .then((r) => setCustomers(r.data || []))
      .catch(() => setCustomers([]));
  }, []);

  // Keep every textarea sized to its content so nothing clips in the PDF.
  useLayoutEffect(() => {
    if (!pageRef.current) return;
    pageRef.current.querySelectorAll("textarea").forEach((t) => {
      t.style.height = "auto";
      t.style.height = t.scrollHeight + "px";
    });
  });

  // ── Totals ──
  const lineAmount = (l) => (Number(l.qty) || 0) * (Number(l.price) || 0);
  const subTotal = lines.reduce((s, l) => s + lineAmount(l), 0);
  const gstAmount = (subTotal * (Number(inv.gstPercent) || 0)) / 100;
  const netAmount = Math.round(subTotal + gstAmount);

  // ── Field setters ──
  const setField = (key) => (e) =>
    setInv((p) => ({ ...p, [key]: e.target.value }));

  const setCompanyField = (key) => (e) =>
    setCompany((p) => ({ ...p, [key]: e.target.value }));

  const setLine = (idx, key, val) =>
    setLines((p) => p.map((l, i) => (i === idx ? { ...l, [key]: val } : l)));

  const addLine = () =>
    setLines((p) => [...p, { desc: "", hsn: "", qty: 1, unit: "No", price: 0 }]);

  const removeLine = (idx) =>
    setLines((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  const setTerm = (idx, val) =>
    setTerms((p) => p.map((t, i) => (i === idx ? val : t)));

  const addTerm = () => setTerms((p) => [...p, ""]);

  const removeTerm = (idx) =>
    setTerms((p) => (p.length > 1 ? p.filter((_, i) => i !== idx) : p));

  // ── Pick Customer → auto-fill vendor & delivery blocks ──
  const onPickCustomer = (e) => {

    const id = e.target.value;
    setPickedCustomer(id);

    const c = customers.find((x) => String(x.ID) === String(id));
    if (!c) return;

    const addr = [c.BILLING_ADDRESS || c.ADDRESS, c.CITY, c.STATE, c.PINCODE]
      .filter(Boolean)
      .join(", ");

    const billBlock = [c.CUSTOMER_NAME, addr].filter(Boolean).join("\n");

    const shipBlock = c.SHIPPING_ADDRESS
      ? [c.CUSTOMER_NAME, c.SHIPPING_ADDRESS].filter(Boolean).join("\n")
      : billBlock;

    setInv((p) => ({
      ...p,
      vendorAddress: billBlock,
      deliveryAddress: shipBlock,
      vendorGst: c.GST_NUMBER || "",
      contactName: c.CONTACT_PERSON || "",
      contactNo: c.PHONE || "",
      receiverName: c.CUSTOMER_NAME || p.receiverName
    }));
  };

  // ── Logo upload ──
  const onLogoUpload = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => setLogo(reader.result);
    reader.readAsDataURL(file);
  };

  // ── Download as a real PDF file (html2pdf) ──
  const downloadPdf = async () => {

    if (!pageRef.current) return;

    setBusy(true);
    try {
      const html2pdf = (await import("html2pdf.js")).default;

      const safeName =
        (inv.invNo || "invoice").replace(/[^\w.-]+/g, "_") + ".pdf";

      await html2pdf()
        .set({
          margin: 0,
          filename: safeName,
          image: { type: "jpeg", quality: 0.98 },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            // Omit editor-only controls (Add Line / Add Term / remove ✕)
            // from the rendered PDF — they carry the global `no-print` class.
            ignoreElements: (el) =>
              !!(el.classList && el.classList.contains("no-print"))
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
          pagebreak: { mode: ["css", "legacy"] }
        })
        .from(pageRef.current)
        .save();
    } catch (err) {
      alert("Could not generate PDF: " + (err?.message || err));
    } finally {
      setBusy(false);
    }
  };

  // ── Print / Export via browser (Save as PDF) ──
  const printPdf = () => window.print();

  return (
    <div className={styles.page}>

      {/* Embedded print rules — isolate the invoice so the app sidebar,
          top bar and notifications never print; only the sheet does. */}
      <style>{`
        @media print {
          @page { size: A4; margin: 6mm; }
          html, body { background: #ffffff !important; }
          /* Hide the whole app, then reveal only the invoice subtree. */
          body * { visibility: hidden !important; }
          .invoice-print-root, .invoice-print-root * { visibility: visible !important; }
          .invoice-print-root {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            margin: 0;
            padding: 0;
          }
          .no-print { display: none !important; }
        }
      `}</style>

      {/* ── Toolbar (never printed) ── */}
      <div className={`${styles.toolbar} no-print`}>
        <div className={styles.toolbarLeft}>
          <h1 className={styles.title}>Invoice</h1>
          <p className={styles.subtitle}>
            Pick a customer, edit any field, then download or print.
          </p>
        </div>

        <div className={styles.toolbarActions}>
          <select
            className={styles.select}
            value={pickedCustomer}
            onChange={onPickCustomer}
            title="Pick customer"
          >
            <option value="">— Pick Customer —</option>
            {customers.map((c) => (
              <option key={c.ID} value={c.ID}>
                {c.CUSTOMER_NAME}
                {c.CUSTOMER_CODE ? ` (${c.CUSTOMER_CODE})` : ""}
              </option>
            ))}
          </select>

          <select
            className={styles.select}
            value={inv.docType}
            onChange={setField("docType")}
            title="Document type"
          >
            {DOC_TYPES.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>

          <label className={styles.fileBtn}>
            Add Logo
            <input
              type="file"
              accept="image/*"
              onChange={onLogoUpload}
              hidden
            />
          </label>

          <button
            className={styles.btnPrimary}
            onClick={downloadPdf}
            disabled={busy}
          >
            {busy ? "Generating…" : "⬇ Download PDF"}
          </button>

          <button className={styles.btnGhost} onClick={printPdf}>
            🖨 Export / Print
          </button>
        </div>
      </div>

      {/* ── The A4 invoice sheet — everything inside is editable ── */}
      <div className={`${styles.sheetWrap} invoice-print-root`}>
        <div className={styles.sheet} ref={pageRef}>

          {/* Brand / company header */}
          <div className={styles.brandRow}>
            <div className={styles.logoBox}>
              {logo ? (
                <img className={styles.logoImg} src={logo} alt="logo" />
              ) : (
                <span className={styles.logoEmpty}>Add Logo</span>
              )}
            </div>

            <div className={styles.companyBlock}>
              <input
                className={`${styles.inp} ${styles.companyName}`}
                value={company.name}
                onChange={setCompanyField("name")}
              />
              <input
                className={`${styles.inp} ${styles.companyLine}`}
                value={company.addr1}
                onChange={setCompanyField("addr1")}
              />
              <input
                className={`${styles.inp} ${styles.companyLine}`}
                value={company.addr2}
                onChange={setCompanyField("addr2")}
              />
              <div className={styles.companyLineStrong}>
                GST No. :{" "}
                <input
                  className={`${styles.inp} ${styles.inpInline}`}
                  value={company.gst}
                  onChange={setCompanyField("gst")}
                />
              </div>
              <input
                className={`${styles.inp} ${styles.companyLine}`}
                value={company.contact}
                onChange={setCompanyField("contact")}
              />
            </div>
          </div>

          {/* Title bar */}
          <div className={styles.titleBar}>{inv.docType}</div>

          {/* Meta grid: invoice numbers (L) + vendor contact (R) */}
          <div className={styles.metaRow}>
            <div className={styles.metaCol}>
              <MetaLine label="Inv. No." value={inv.invNo} onChange={setField("invNo")} />
              <MetaLine label="Inv. Date" value={inv.invDate} onChange={setField("invDate")} />
              <MetaLine label="PO. No." value={inv.poNo} onChange={setField("poNo")} last />
            </div>
            <div className={styles.metaCol}>
              <MetaLine label="Vendor GST No." value={inv.vendorGst} onChange={setField("vendorGst")} />
              <MetaLine label="Contact Name" value={inv.contactName} onChange={setField("contactName")} />
              <MetaLine label="Contact No." value={inv.contactNo} onChange={setField("contactNo")} last />
            </div>
          </div>

          {/* Address blocks */}
          <div className={styles.addrRow}>
            <div className={styles.addrCol}>
              <div className={styles.addrHead}>VENDOR ADDRESS</div>
              <textarea
                className={styles.addrBody}
                value={inv.vendorAddress}
                onChange={setField("vendorAddress")}
                rows={3}
              />
            </div>
            <div className={`${styles.addrCol} ${styles.addrColLast}`}>
              <div className={styles.addrHead}>DELIVERY ADDRESS</div>
              <textarea
                className={styles.addrBody}
                value={inv.deliveryAddress}
                onChange={setField("deliveryAddress")}
                rows={3}
              />
            </div>
          </div>

          {/* Line items */}
          <table className={styles.itemsTable}>
            <thead>
              <tr>
                <th className={styles.colSno}>S.No.</th>
                <th className={styles.colDesc}>PRODUCT DESCRIPTION</th>
                <th className={styles.colQty}>Qty</th>
                <th className={styles.colUnit}>Unit</th>
                <th className={styles.colPrice}>Unit Price</th>
                <th className={styles.colAmt}>AMOUNT</th>
                <th className={`${styles.colDel} no-print`}></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, idx) => (
                <tr key={idx}>
                  <td className={styles.tcCenter}>{idx + 1}</td>
                  <td>
                    <textarea
                      className={styles.descInput}
                      value={l.desc}
                      onChange={(e) => setLine(idx, "desc", e.target.value)}
                      rows={1}
                      placeholder="Product description"
                    />
                    <div className={styles.hsnRow}>
                      HSN Code :{" "}
                      <input
                        className={`${styles.inp} ${styles.hsnInput}`}
                        value={l.hsn}
                        onChange={(e) => setLine(idx, "hsn", e.target.value)}
                      />
                    </div>
                  </td>
                  <td className={styles.tcRight}>
                    <input
                      className={`${styles.inp} ${styles.inpR}`}
                      type="number"
                      value={l.qty}
                      onChange={(e) => setLine(idx, "qty", e.target.value)}
                    />
                  </td>
                  <td className={styles.tcCenter}>
                    <input
                      className={`${styles.inp} ${styles.inpC}`}
                      value={l.unit}
                      onChange={(e) => setLine(idx, "unit", e.target.value)}
                    />
                  </td>
                  <td className={styles.tcRight}>
                    <input
                      className={`${styles.inp} ${styles.inpR}`}
                      type="number"
                      step="any"
                      value={l.price}
                      onChange={(e) => setLine(idx, "price", e.target.value)}
                    />
                  </td>
                  <td className={`${styles.tcRight} ${styles.amtCell}`}>
                    {fmt(lineAmount(l))}
                  </td>
                  <td className={`${styles.tcCenter} no-print`}>
                    <button
                      className={styles.removeBtn}
                      onClick={() => removeLine(idx)}
                      title="Remove line"
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <button className={`${styles.addRowBtn} no-print`} onClick={addLine}>
            + Add Line
          </button>

          {/* Terms (L) + Totals (R) */}
          <div className={styles.lowerRow}>
            <div className={styles.termsCol}>
              <div className={styles.termsTitle}>Terms &amp; Conditions :</div>
              {terms.map((t, idx) => (
                <div className={styles.termRow} key={idx}>
                  <span className={styles.termNum}>{idx + 1}</span>
                  <textarea
                    className={styles.termInput}
                    value={t}
                    onChange={(e) => setTerm(idx, e.target.value)}
                    rows={1}
                  />
                  <button
                    className={`${styles.removeBtn} no-print`}
                    onClick={() => removeTerm(idx)}
                    title="Remove term"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button className={`${styles.addTermBtn} no-print`} onClick={addTerm}>
                + Add Term
              </button>
            </div>

            <div className={styles.totalsCol}>
              <div className={styles.totalLine}>
                <span>Total Amount</span>
                <span className={styles.totalValue}>{fmt(subTotal)}</span>
              </div>
              <div className={styles.totalLine}>
                <span>
                  GST{" "}
                  <input
                    className={`${styles.inp} ${styles.gstInput}`}
                    type="number"
                    value={inv.gstPercent}
                    onChange={setField("gstPercent")}
                  />
                  %
                </span>
                <span className={styles.totalValue}>{fmt(gstAmount)}</span>
              </div>
              <div className={`${styles.totalLine} ${styles.netLine}`}>
                <span>Net Amount</span>
                <span className={styles.totalValue}>{fmt(netAmount)}</span>
              </div>
            </div>
          </div>

          {/* Amount in words */}
          <div className={styles.wordsRow}>
            <span className={styles.wordsLabel}>In Words (INR)</span>
            <span className={styles.wordsValue}>
              Rupees {numberToWordsIndian(netAmount)} Only
            </span>
          </div>

          {/* Bank details */}
          <div className={styles.bankRow}>
            <span className={styles.bankLabel}>Bank Details :</span>
            <input
              className={`${styles.inp} ${styles.bankInput}`}
              value={company.bank}
              onChange={setCompanyField("bank")}
            />
          </div>

          {/* Flexible spacer — pushes signatures to the bottom so the
              sheet fills the full A4 page instead of clustering at top. */}
          <div className={styles.spacer} />

          {/* Signatures */}
          <div className={styles.signRow}>
            <div className={styles.signCol}>
              <div className={styles.signLabel}>Receiver Signatory</div>
              <input
                className={`${styles.inp} ${styles.signName}`}
                value={inv.receiverName}
                onChange={setField("receiverName")}
              />
            </div>
            <div className={`${styles.signCol} ${styles.signColRight}`}>
              <div className={styles.signLabel}>Authorized Signatory</div>
              <input
                className={`${styles.inp} ${styles.signName} ${styles.signNameRight}`}
                value={company.name}
                onChange={setCompanyField("name")}
              />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}


// Label : value row used in the meta grid.
function MetaLine({ label, value, onChange, last }) {
  return (
    <div className={`${styles.metaLine} ${last ? styles.metaLineLast : ""}`}>
      <span className={styles.metaLabel}>{label} :</span>
      <input className={styles.metaInput} value={value} onChange={onChange} />
    </div>
  );
}


export default InvoiceOrder;
