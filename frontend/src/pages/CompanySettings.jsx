// =====================================================================
// Admin Module 3 — Company Master Settings
// =====================================================================
// Edits the single source-of-truth row in `company_master`. Every PDF
// + print view (Quotation / SO / PO / GRN / Payslip / Reports) pulls
// its branding from here.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";

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
      // Revoke after 60s so the browser tab can finish loading
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
      <div style={{ padding: 40, color: "#94a3b8", fontStyle: "italic" }}>
        Loading company settings…
      </div>
    );
  }

  const logoSrc = form.LOGO_URL ? `${BACKEND_URL}${form.LOGO_URL}` : null;

  return (
    <div style={{ padding: 24, background: "#F8F4F5", minHeight: "calc(100vh - 80px)" }}>

      <style>{`
        @keyframes cs-fade { from {opacity:0; transform:translateY(8px);} to {opacity:1; transform:translateY(0);} }
      `}</style>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg,${BVC_DARK} 0%,${BVC_RED} 100%)`,
        borderRadius: 16,
        padding: "20px 26px",
        marginBottom: 20,
        color: "white",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            color: BVC_GOLD, textTransform: "uppercase",
          }}>
            BVC24 · Admin Module 3
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
            Company Master Settings
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            These values appear on every Quotation, Sales Order, Purchase
            Order, GRN, Payslip and PDF Report.
          </div>
        </div>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={previewPdf}
            disabled={previewing}
            title="Open a sample PDF in a new tab using the last-saved company branding"
            style={{
              padding: "12px 18px",
              background: previewing ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.10)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.35)",
              borderRadius: 8,
              fontWeight: 800,
              fontSize: 13,
              cursor: previewing ? "wait" : "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
            }}
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
            style={{
              padding: "12px 24px",
              background: !isDirty || saving ? "#94a3b8" : BVC_GOLD,
              color: "#1A0508",
              border: "none",
              borderRadius: 8,
              fontWeight: 900,
              fontSize: 13,
              cursor: !isDirty || saving ? "not-allowed" : "pointer",
              boxShadow: "0 6px 16px rgba(244,179,36,0.35)",
            }}
          >
            {saving ? "Saving…" : isDirty ? "Save Changes" : "Saved"}
          </button>
        </div>
      </div>

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          background: "#0f172a",
          color: "white",
          padding: "12px 18px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
          zIndex: 9999,
          animation: "cs-fade 0.25s ease-out",
        }}>
          ✓ {toast}
        </div>
      )}

      {/* 2-column body */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", gap: 20 }}>

        {/* LEFT — form sections */}
        <div style={{ display: "grid", gap: 16 }}>

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
        <div style={{
          background: "white",
          borderRadius: 12,
          padding: 18,
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
          height: "fit-content",
          position: "sticky",
          top: 90,
        }}>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
            color: "#64748b", textTransform: "uppercase", marginBottom: 12,
          }}>
            Company Logo
          </div>
          <div style={{
            width: "100%",
            aspectRatio: "1 / 1",
            background: logoSrc ? "white" : "linear-gradient(135deg,#fef2f2,#fff5f5)",
            border: "2px dashed " + (logoSrc ? "#e2e8f0" : "#fecaca"),
            borderRadius: 12,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            marginBottom: 12,
            overflow: "hidden",
          }}>
            {logoSrc ? (
              <img
                src={logoSrc}
                alt="Company logo"
                style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }}
              />
            ) : (
              <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 12, padding: 12 }}>
                No logo uploaded.<br/>
                <span style={{ fontSize: 10 }}>
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
            style={{ display: "none" }}
          />
          <div style={{ display: "grid", gap: 8 }}>
            <button
              onClick={() => fileRef.current?.click()}
              style={{
                padding: "10px 14px",
                background: `linear-gradient(135deg,${BVC_RED},${BVC_DARK})`,
                color: "white",
                border: "none",
                borderRadius: 8,
                fontWeight: 800,
                fontSize: 12,
                cursor: "pointer",
              }}
            >
              {logoSrc ? "Replace Logo" : "Upload Logo"}
            </button>
            {logoSrc && (
              <button
                onClick={removeLogo}
                style={{
                  padding: "8px 14px",
                  background: "white",
                  color: "#b91c1c",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  fontWeight: 700,
                  fontSize: 11,
                  cursor: "pointer",
                }}
              >
                🗑 Remove Logo
              </button>
            )}
          </div>

          <div style={{
            marginTop: 18,
            padding: "10px 12px",
            background: "#fffbeb",
            border: "1px solid #fde68a",
            borderRadius: 8,
            fontSize: 11,
            color: "#92400e",
            lineHeight: 1.5,
          }}>
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
    <div style={{
      background: "white",
      borderRadius: 12,
      padding: 18,
      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
      animation: "cs-fade 0.4s ease-out",
    }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.5,
        color,
        textTransform: "uppercase",
        marginBottom: 12,
        paddingBottom: 8,
        borderBottom: `2px solid ${color}33`,
      }}>
        {title}
      </div>
      <div style={{ display: "grid", gap: 10 }}>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = "text", uppercase = false }) {
  return (
    <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: "#475569" }}>
      {label}
      <input
        type={type}
        value={value ?? ""}
        onChange={onChange}
        placeholder={placeholder}
        style={{
          display: "block",
          width: "100%",
          marginTop: 4,
          padding: "9px 12px",
          border: "1px solid #cbd5e1",
          borderRadius: 6,
          fontSize: 13,
          fontWeight: 500,
          textTransform: uppercase ? "uppercase" : "none",
          boxSizing: "border-box",
        }}
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
      style={{
        width: "100%",
        padding: "9px 12px",
        border: "1px solid #cbd5e1",
        borderRadius: 6,
        fontSize: 13,
        boxSizing: "border-box",
        resize: "vertical",
      }}
    />
  );
}

function Row2({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>{children}</div>;
}

function Row3({ children }) {
  return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>{children}</div>;
}

