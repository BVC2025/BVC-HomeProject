// =====================================================================
// Admin Module 3 — Company Master Settings
// =====================================================================
// Edits the single source-of-truth row in `company_master`. Every PDF
// + print view (Quotation / SO / PO / GRN / Payslip / Reports) pulls
// its branding from here.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";
import styles from "./CompanySettings.module.css";


// Same base URL the API helper points at — used to render the logo
// preview (which lives under /static on the backend).
const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8000";


export default function CompanySettings() {

  const [form, setForm]     = useState(null);
  const [original, setOrig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [previewing, setPreviewing] = useState(false);
  const [error, setError]     = useState("");
  const [toast, setToast]     = useState("");
  const fileRef = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2500);
  };

  const fetchCompany = async () => {
    setLoading(true);
    try {
      const r = await API.get("/settings/company");
      setForm(r.data);
      setOrig(r.data);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load company settings.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchCompany(); }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const isDirty = useMemo(() => {
    if (!form || !original) return false;
    for (const k of Object.keys(form)) {
      if (k === "ID" || k === "VENDOR_ID" || k === "UPDATED_AT") continue;
      if ((form[k] || "") !== (original[k] || "")) return true;
    }
    return false;
  }, [form, original]);

  const save = async () => {
    if (!form) return;
    setSaving(true);
    setError("");
    try {
      const { ID, VENDOR_ID, UPDATED_AT, LOGO_URL, ...payload } = form;
      const r = await API.put("/settings/company", payload);
      setForm(r.data.company);
      setOrig(r.data.company);
      showToast("Company settings saved.");
    } catch (e) {
      setError(e?.response?.data?.detail || "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const uploadLogo = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("file", file);
    try {
      const r = await API.post("/settings/company/upload-logo", fd, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setForm(r.data.company);
      setOrig(r.data.company);
      showToast("Logo uploaded.");
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Logo upload failed.");
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const previewPdf = async () => {
    if (isDirty) {
      const ok = window.confirm(
        "You have unsaved changes. The preview will use the LAST SAVED " +
        "values, not what's on screen. Save first to preview your " +
        "current edits.\n\nOpen preview with last-saved values anyway?"
      );
      if (!ok) return;
    }
    setPreviewing(true);
    try {
      const response = await API.get("/settings/company/preview-pdf", {
        responseType: "blob",
      });
      const blob = new Blob([response.data], { type: "application/pdf" });
      const url = window.URL.createObjectURL(blob);
      const win = window.open(url, "_blank");
      if (!win) {
        showToast("Pop-up blocked — allow pop-ups for this site.");
      }
      setTimeout(() => window.URL.revokeObjectURL(url), 60_000);
    } catch (e) {
      setError(e?.response?.data?.detail || "Preview failed.");
    } finally {
      setPreviewing(false);
    }
  };

  const removeLogo = async () => {
    if (!window.confirm("Remove the current logo?")) return;
    try {
      const r = await API.delete("/settings/company/logo");
      setForm(r.data.company);
      setOrig(r.data.company);
      showToast("Logo removed.");
    } catch (ex) {
      setError(ex?.response?.data?.detail || "Remove failed.");
    }
  };

  if (loading || !form) {
    return (
      <div className={styles.loadingText}>Loading company settings…</div>
    );
  }

  const logoSrc = form.LOGO_URL ? `${BACKEND_URL}${form.LOGO_URL}` : null;

  return (
    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.heroEyebrow}>BVC24 · Admin Module 3</div>
          <div className={styles.heroTitle}>Company Master Settings</div>
          <div className={styles.heroSub}>
            These values appear on every Quotation, Sales Order, Purchase
            Order, GRN, Payslip and PDF Report.
          </div>
        </div>
        <div className={styles.heroActions}>
          <button
            onClick={previewPdf}
            disabled={previewing}
            title="Open a sample PDF in a new tab using the last-saved company branding"
            className={styles.previewBtn}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2"
                 strokeLinecap="round" strokeLinejoin="round">
              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
              <circle cx="12" cy="12" r="3"/>
            </svg>
            {previewing ? "Opening…" : "Preview PDF"}
          </button>
          <button
            onClick={save}
            disabled={!isDirty || saving}
            className={`${styles.saveBtn}${(!isDirty || saving) ? ` ${styles.saveBtnDisabled}` : ""}`}
          >
            {saving ? "Saving…" : isDirty ? "Save Changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}

      {toast && (
        <div className={styles.toast}>✓ {toast}</div>
      )}

      {/* 2-column body */}
      <div className={styles.bodyGrid}>

        {/* LEFT — form sections */}
        <div className={styles.formCol}>

          <Section title="① Identity" color="#6366f1">
            <Row2>
              <Field label="Legal Name *" value={form.LEGAL_NAME} onChange={set("LEGAL_NAME")} placeholder="Bharath Vending Corporation" />
              <Field label="Short Name (used as logo text)" value={form.SHORT_NAME} onChange={set("SHORT_NAME")} placeholder="BVC24" />
            </Row2>
            <Field label="Tagline" value={form.TAGLINE} onChange={set("TAGLINE")} placeholder="Manufacturing Management System" />
          </Section>

          <Section title="② Statutory" color="#0ea5e9">
            <Row3>
              <Field label="GST Number" value={form.GST_NUMBER} onChange={set("GST_NUMBER")} placeholder="33ABCDE1234F1Z5" />
              <Field label="PAN Number" value={form.PAN_NUMBER} onChange={set("PAN_NUMBER")} placeholder="ABCDE1234F" />
              <Field label="CIN Number" value={form.CIN_NUMBER} onChange={set("CIN_NUMBER")} placeholder="U99999TN2020PTC123456" />
            </Row3>
          </Section>

          <Section title="③ Address" color="#10b981">
            <Field label="Address Line 1" value={form.ADDRESS_LINE_1} onChange={set("ADDRESS_LINE_1")} placeholder="Plot No. 14, Industrial Estate" />
            <Field label="Address Line 2" value={form.ADDRESS_LINE_2} onChange={set("ADDRESS_LINE_2")} placeholder="Optional" />
            <Row3>
              <Field label="City" value={form.CITY} onChange={set("CITY")} placeholder="Chennai" />
              <Field label="State" value={form.STATE} onChange={set("STATE")} placeholder="Tamil Nadu" />
              <Field label="Pincode" value={form.PINCODE} onChange={set("PINCODE")} placeholder="600032" />
            </Row3>
            <Field label="Country" value={form.COUNTRY} onChange={set("COUNTRY")} placeholder="India" />
          </Section>

          <Section title="④ Contact" color="#f59e0b">
            <Row3>
              <Field label="Email" type="email" value={form.EMAIL} onChange={set("EMAIL")} placeholder="contact@example.com" />
              <Field label="Phone" value={form.PHONE} onChange={set("PHONE")} placeholder="+91 98765 43210" />
              <Field label="Website" value={form.WEBSITE} onChange={set("WEBSITE")} placeholder="www.example.com" />
            </Row3>
          </Section>

          <Section title="⑤ Bank Details" color="#14b8a6">
            <Row2>
              <Field label="Bank Name" value={form.BANK_NAME} onChange={set("BANK_NAME")} placeholder="HDFC Bank" />
              <Field label="Account Number" value={form.BANK_ACCOUNT_NUMBER} onChange={set("BANK_ACCOUNT_NUMBER")} placeholder="50100123456789" />
            </Row2>
            <Row3>
              <Field label="IFSC Code" value={form.BANK_IFSC} onChange={set("BANK_IFSC")} placeholder="HDFC0001234" uppercase />
              <Field label="Branch" value={form.BANK_BRANCH} onChange={set("BANK_BRANCH")} placeholder="Coimbatore Main" />
              <Field label="UPI ID" value={form.UPI_ID} onChange={set("UPI_ID")} placeholder="company@upi" />
            </Row3>
          </Section>

          <Section title="⑥ Notes (internal)" color="#8b5cf6">
            <TextArea value={form.NOTES} onChange={set("NOTES")} placeholder="Anything else useful for HR / accounts" />
          </Section>

        </div>

        {/* RIGHT — logo */}
        <div className={styles.logoPanel}>
          <div className={styles.logoTitle}>Company Logo</div>
          <div className={`${styles.logoBox}${logoSrc ? ` ${styles.logoBoxFilled}` : ` ${styles.logoBoxEmpty}`}`}>
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="Company logo"
                className={styles.logoImg}
              />
            ) : (
              <div className={styles.logoEmptyText}>
                No logo uploaded.<br/>
                <span className={styles.logoEmptyHint}>
                  PNG / JPG / WebP / SVG · ≤ 2 MB
                </span>
              </div>
            )}
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,.svg"
            onChange={uploadLogo}
            className={styles.hidden}
          />
          <div className={styles.logoBtnGrid}>
            <button
              onClick={() => fileRef.current?.click()}
              className={styles.uploadBtn}
            >
              {logoSrc ? "Replace Logo" : "Upload Logo"}
            </button>
            {logoSrc && (
              <button onClick={removeLogo} className={styles.removeBtn}>
                🗑 Remove Logo
              </button>
            )}
          </div>

          <div className={styles.logoHint}>
            🛈 The logo appears on PDF reports (cover page) and on every
            invoice / quotation / payslip header.
          </div>
        </div>

      </div>
    </div>
  );
}


// ---- Small helpers ---------------------------------------------------

function Section({ title, color, children }) {
  return (
    <div className={styles.sectionCard}>
      <div
        className={styles.sectionTitle}
        style={{ color, borderBottom: `2px solid ${color}33` }}
      >
        {title}
      </div>
      <div className={styles.sectionBody}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", uppercase = false }) {
  return (
    <label className={styles.fieldLabel}>
      {label}
      <input
        type={type}
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        className={`${styles.input}${uppercase ? ` ${styles.inputUppercase}` : ""}`}
      />
    </label>
  );
}

function TextArea({ value, onChange, placeholder }) {
  return (
    <textarea
      rows={3}
      value={value ?? ""}
      onChange={onChange}
      placeholder={placeholder}
      className={styles.textarea}
    />
  );
}

function Row2({ children }) {
  return <div className={styles.row2}>{children}</div>;
}

function Row3({ children }) {
  return <div className={styles.row3}>{children}</div>;
}
