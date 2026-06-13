import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";


// ----------------------------------------------------------------
// Public axios — token IS the secret, no Bearer header attached.
// ----------------------------------------------------------------

const pub = axios.create({ baseURL: API_BASE_URL });


// BVC palette (mirrors the rest of the project)
const COLOURS = {
  primary: "#C8102E",
  dark:    "#8B0B1F",
  deepest: "#4A0E18",
  ink:     "#0f172a",
  gold:    "#F4B324",
  paper:   "#f3f4f6",
};

const GENDERS = ["MALE", "FEMALE", "OTHER", "PREFER_NOT_TO_SAY"];
const EMPLOYMENT_TYPES = ["FRESHER", "EXPERIENCED"];
const MARITAL_STATUSES = ["SINGLE", "MARRIED", "DIVORCED", "WIDOWED"];


// ================================================================
// FIELD VALIDATION
// ----------------------------------------------------------------
// Centralised validators for every field that has a format / range
// constraint. Each entry can have:
//   required: boolean   — empty value is rejected
//   test:     (value) => boolean   — fails the rule when it returns false
//   message:  user-facing error
// Optional fields skip their `test` when empty so candidates aren't
// blocked from submitting partial info.
// ================================================================

function _normalizePhone(v) {
  if (!v) return "";
  let s = String(v).replace(/[\s\-()+]/g, "");
  if (s.startsWith("91") && s.length === 12) s = s.slice(2);
  if (s.startsWith("0")  && s.length === 11) s = s.slice(1);
  return s;
}

function _normalizeDigits(v) {
  return v == null ? "" : String(v).replace(/\D/g, "");
}

const VALIDATORS = {
  NAME: {
    required: true,
    test: (v) => v && v.trim().length >= 2,
    message: "Name is required (at least 2 characters)."
  },
  PHONE: {
    required: true,
    test: (v) => /^\d{10}$/.test(_normalizePhone(v)),
    message: "Contact Number must be exactly 10 digits."
  },
  EMAIL: {
    test: (v) => !v || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v.trim()),
    message: "Please enter a valid email address (e.g. name@example.com)."
  },
  EMERGENCY_CONTACT_PHONE: {
    test: (v) => !v || /^\d{10}$/.test(_normalizePhone(v)),
    message: "Emergency Contact Phone must be exactly 10 digits."
  },
  PINCODE: {
    test: (v) => !v || /^\d{6}$/.test(_normalizeDigits(v)),
    message: "Pincode must be exactly 6 digits."
  },
  PAN_NUMBER: {
    test: (v) => !v || /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(v.toUpperCase().trim()),
    message: "PAN must be 5 letters + 4 digits + 1 letter (e.g. ABCDE1234F)."
  },
  AADHAAR_NUMBER: {
    test: (v) => !v || /^\d{12}$/.test(_normalizeDigits(v)),
    message: "Aadhaar Number must be exactly 12 digits."
  },
  IFSC_CODE: {
    test: (v) => !v || /^[A-Z]{4}0[A-Z0-9]{6}$/.test(v.toUpperCase().trim()),
    message: "IFSC must be 4 letters + 0 + 6 alphanumeric (e.g. HDFC0001234)."
  },
  BANK_ACCOUNT_NUMBER: {
    test: (v) => !v || /^\d{9,18}$/.test(_normalizeDigits(v)),
    message: "Bank Account Number must be 9 to 18 digits."
  },
  DOB: {
    test: (v) => {
      if (!v) return true;
      const d = new Date(v);
      if (isNaN(d.getTime())) return false;
      const ageYrs = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      return ageYrs >= 14 && ageYrs <= 100;
    },
    message: "Date of Birth must be a real past date (age 14-100)."
  },
  YEAR_OF_PASSING: {
    test: (v) => {
      if (v === "" || v == null) return true;
      const n = Number(v);
      const now = new Date().getFullYear();
      return Number.isInteger(n) && n >= 1950 && n <= now + 5;
    },
    message: "Year of Passing must be between 1950 and 5 years from now."
  },
  PERCENTAGE: {
    test: (v) => {
      if (v === "" || v == null) return true;
      const n = Number(v);
      return !isNaN(n) && n >= 0 && n <= 100;
    },
    message: "Percentage / CGPA must be between 0 and 100."
  },
  EXPERIENCE_YEARS: {
    test: (v) => {
      if (v === "" || v == null) return true;
      const n = Number(v);
      return !isNaN(n) && n >= 0 && n <= 60;
    },
    message: "Years of Experience must be between 0 and 60."
  },
  PREVIOUS_SALARY: {
    test: (v) => {
      if (v === "" || v == null) return true;
      const n = Number(v);
      return !isNaN(n) && n >= 0;
    },
    message: "Previous Salary cannot be negative."
  }
};

function validateField(name, value) {
  const rule = VALIDATORS[name];
  if (!rule) return null;
  const isEmpty = value === null || value === undefined ||
                  (typeof value === "string" && !value.trim());
  if (rule.required && isEmpty) return rule.message;
  if (!isEmpty && rule.test && !rule.test(value)) return rule.message;
  return null;
}

function validateAll(form) {
  const errors = {};
  for (const field of Object.keys(VALIDATORS)) {
    const err = validateField(field, form[field]);
    if (err) errors[field] = err;
  }
  return errors;
}


// ----------------------------------------------------------------
// Initials helper for the photo placeholder
// ----------------------------------------------------------------
function initials(name) {
  return (name || "")
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase() || "?";
}


// ================================================================
// Small reusable UI primitives — mirror the Employees.jsx form
// ================================================================

function FormSection({ title, color, children }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 1.4,
        color,
        textTransform: "uppercase",
        marginBottom: 12,
        paddingBottom: 6,
        borderBottom: `2px solid ${color}33`
      }}>
        {title}
      </div>
      {children}
    </div>
  );
}

function FormGrid({ cols, children }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: `repeat(${cols}, 1fr)`,
      gap: 12
    }}>
      {children}
    </div>
  );
}

function FormField({ label, span, children, error, fieldName }) {
  return (
    <div
      style={{ gridColumn: span ? `span ${span}` : undefined }}
      data-field={fieldName}
    >
      <label style={{
        display: "block",
        fontSize: 11,
        fontWeight: 700,
        color: error ? "#dc2626" : "#475569",
        marginBottom: 4,
        letterSpacing: 0.3
      }}>
        {label}
      </label>
      {children}
      {error && (
        <div style={{
          marginTop: 4,
          fontSize: 11,
          fontWeight: 600,
          color: "#dc2626",
          lineHeight: 1.35
        }}>
          {error}
        </div>
      )}
    </div>
  );
}

function inputStyle(hasError) {
  return {
    width: "100%",
    padding: "9px 12px",
    border: `1px solid ${hasError ? "#dc2626" : "#cbd5e1"}`,
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    outline: "none",
    boxSizing: "border-box",
    boxShadow: hasError ? "0 0 0 2px rgba(220, 38, 38, 0.10)" : "none"
  };
}


// ================================================================
// BVC red header strip — shared between both states
// ================================================================
function HeaderStrip({ invitedName }) {
  return (
    <div style={{
      background: `linear-gradient(120deg, ${COLOURS.deepest} 0%, ${COLOURS.dark} 50%, ${COLOURS.primary} 100%)`,
      color: "white",
      padding: "22px 28px",
      boxShadow: "0 8px 24px rgba(139,11,31,0.22)"
    }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <div style={{
          fontSize: 11,
          letterSpacing: 2.4,
          opacity: 0.85,
          fontWeight: 800,
          textTransform: "uppercase"
        }}>
          BVC24 · Employee Registration
        </div>
        <h1 style={{
          fontSize: 24,
          fontWeight: 900,
          margin: "4px 0 0",
          lineHeight: 1.2,
          color: "white"
        }}>
          {invitedName
            ? <>Welcome, {invitedName}</>
            : "Employee Registration"}
        </h1>
      </div>
    </div>
  );
}


// ================================================================
// Final-state cards (already submitted / approved / rejected /
// expired). Mirrors the previous UX so the candidate sees a clear
// terminal message instead of the login form.
// ================================================================
function FinalStateCard({ status, reason }) {
  let icon = "ℹ️";
  let title = "This onboarding link is no longer active.";
  let body  = "Please contact your administrator.";
  let tint  = "#6b7280";

  if (status === "SUBMITTED") {
    icon = "📝";
    title = "Already Submitted";
    body  = "Your details have been sent to the admin. You'll be notified once your account is activated.";
    tint  = "#0369a1";
  } else if (status === "APPROVED") {
    icon = "✅";
    title = "Approved";
    body  = "Your registration has been approved. You can now log in with your Employee ID and password.";
    tint  = "#047857";
  } else if (status === "REJECTED") {
    icon = "🚫";
    title = "Application Not Accepted";
    body  = reason || "Your registration was not accepted by the administrator.";
    tint  = "#b91c1c";
  } else if (status === "EXPIRED") {
    icon = "⏰";
    title = "Link Expired";
    body  = "This onboarding invitation has expired. Please ask your administrator for a fresh link.";
    tint  = "#92400e";
  }

  return (
    <div style={{
      maxWidth: 520,
      margin: "60px auto",
      background: "white",
      borderRadius: 16,
      boxShadow: "0 20px 60px rgba(15,23,42,0.12)",
      padding: 36,
      textAlign: "center",
      borderTop: `4px solid ${tint}`
    }}>
      <div style={{ fontSize: 56, marginBottom: 8 }}>{icon}</div>
      <div style={{
        fontSize: 20,
        fontWeight: 900,
        color: COLOURS.ink,
        marginBottom: 8
      }}>
        {title}
      </div>
      <div style={{
        fontSize: 13,
        color: "#475569",
        lineHeight: 1.6
      }}>
        {body}
      </div>
    </div>
  );
}


// ================================================================
// Celebratory success card after the candidate submits the form
// ================================================================
function SubmittedCard() {
  return (
    <div style={{
      maxWidth: 560,
      margin: "60px auto",
      background: "white",
      borderRadius: 18,
      boxShadow: "0 24px 60px rgba(15,23,42,0.14)",
      padding: 44,
      textAlign: "center",
      borderTop: `5px solid ${COLOURS.primary}`
    }}>
      <div style={{ fontSize: 64, marginBottom: 10 }}>🎉</div>
      <div style={{
        fontSize: 22,
        fontWeight: 900,
        color: COLOURS.ink,
        marginBottom: 10
      }}>
        Submitted for HR Approval
      </div>
      <div style={{
        fontSize: 14,
        color: "#475569",
        lineHeight: 1.65
      }}>
        Your details have been sent to the admin. You'll be notified
        once your account is activated.
      </div>
    </div>
  );
}


// ================================================================
// REGISTRATION FORM — State 2
// Mirrors the Add New Employee modal layout, minus the admin-only
// "Organization Assignment" section and the password field.
// ================================================================
function RegistrationForm({ token, session, onSubmitted }) {

  const employeeCode = session?.employee_code || "";

  const [form, setForm] = useState({
    EMPLOYEE_CODE: employeeCode,
    NAME: session?.invited_name || "",
    FATHER_NAME: "",
    MOTHER_NAME: "",
    DOB: "",
    GENDER: "",
    MARITAL_STATUS: "",
    OCCUPATION: "",
    PHONE: "",
    EMAIL: "",
    ADDRESS: "",
    CITY: "",
    STATE: "",
    PINCODE: "",
    QUALIFICATION: "",
    YEAR_OF_PASSING: "",
    EMPLOYMENT_TYPE: "FRESHER",
    EXPERIENCE_YEARS: 0,
    SKILLS: "",
    EXPERIENCE_DETAILS: "",
    PAST_PROJECTS: "",
    NOTES: "",
    // Phase A — HR Module expansion
    BLOOD_GROUP: "",
    NATIONALITY: "Indian",
    EMERGENCY_CONTACT_NAME: "",
    EMERGENCY_CONTACT_PHONE: "",
    EMERGENCY_CONTACT_RELATION: "",
    WORK_LOCATION: "",
    COLLEGE: "",
    UNIVERSITY: "",
    PERCENTAGE: "",
    PREVIOUS_COMPANY: "",
    PREVIOUS_SALARY: "",
    BANK_ACCOUNT_NUMBER: "",
    BANK_NAME: "",
    IFSC_CODE: "",
    PAN_NUMBER: "",
    AADHAAR_NUMBER: ""
  });

  const [photoFile, setPhotoFile]       = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [uploading, setUploading]       = useState(false);
  const [submitting, setSubmitting]     = useState(false);
  const [error, setError]               = useState("");
  // Per-field validation errors keyed by field name.
  const [errors, setErrors]             = useState({});

  // ---- Candidate documents (resume, marksheet, KYC, ...) ----
  // Staged on the backend keyed by the session token. The submit-form
  // endpoint promotes them to real EmployeeDocument rows.
  const [docs, setDocs]                 = useState([]);     // [{id, doc_type, original_name, size, ...}]
  const [docType, setDocType]           = useState("RESUME");
  const [docUploading, setDocUploading] = useState(false);
  const [docError, setDocError]         = useState("");

  const DOC_TYPES = [
    "RESUME", "MARKSHEET", "DEGREE_CERTIFICATE",
    "AADHAAR", "PAN", "PASSPORT", "DRIVING_LICENSE",
    "OFFER_LETTER", "EXPERIENCE_LETTER",
    "PAYSLIP", "BANK_STATEMENT", "OTHER",
  ];

  // On mount, ask the backend what's already been staged for this
  // token. Lets the candidate close the tab and come back without
  // losing what they uploaded.
  useEffect(() => {
    if (!token) return;
    pub.get(`/employee-onboarding/${token}/documents`)
      .then((r) => setDocs(r.data?.documents || []))
      .catch(() => { /* non-fatal */ });
  }, [token]);

  const handleDocUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocError("");
    setDocUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      const r = await pub.post(
        `/employee-onboarding/${token}/upload-document`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const newDoc = r.data?.document;
      if (newDoc) setDocs((prev) => [...prev, newDoc]);
      e.target.value = ""; // allow re-uploading the same file
    } catch (err) {
      setDocError(
        err?.response?.data?.detail ||
        "Upload failed. Check the file type and size (<=10 MB)."
      );
    } finally {
      setDocUploading(false);
    }
  };

  const handleDocDelete = async (id) => {
    setDocError("");
    try {
      await pub.delete(`/employee-onboarding/${token}/documents/${id}`);
      setDocs((prev) => prev.filter((d) => d.id !== id));
    } catch (err) {
      setDocError(
        err?.response?.data?.detail || "Could not remove document."
      );
    }
  };

  const fmtBytes = (n) => {
    if (!n) return "—";
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
    return `${(n / 1024 / 1024).toFixed(1)} MB`;
  };

  // Update a form field. Clears that field's validation error as the
  // user starts correcting it so the red highlight doesn't linger.
  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setErrors((er) => {
      if (!er[k]) return er;
      const next = { ...er };
      delete next[k];
      return next;
    });
  };

  // Re-validate this field on blur so errors appear as soon as the
  // user leaves the input — not just at submit time.
  const blur = (k) => (e) => {
    const msg = validateField(k, e.target.value);
    setErrors((er) => {
      if (msg) return { ...er, [k]: msg };
      if (!er[k]) return er;
      const next = { ...er };
      delete next[k];
      return next;
    });
  };

  const handlePhoto = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setPhotoFile(file);

    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);

    setUploading(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      await pub.post(
        `/employee-onboarding/${token}/upload-photo`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
    } catch (err) {
      // Non-fatal — the candidate can still submit the form text
      console.warn("Photo upload failed", err);
      setError(
        err?.response?.data?.detail ||
        "Photo upload failed — you can still submit your details."
      );
    } finally {
      setUploading(false);
    }
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");

    // Run every field validator before hitting the server.
    const fieldErrors = validateAll(form);
    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      const count = Object.keys(fieldErrors).length;
      setError(
        `Please fix the highlighted field${count > 1 ? "s" : ""} ` +
        `(${count} issue${count > 1 ? "s" : ""}) before submitting.`
      );
      // Scroll the first invalid field into view so the candidate
      // knows where to look.
      const firstField = Object.keys(fieldErrors)[0];
      setTimeout(() => {
        const el = document.querySelector(`[data-field="${firstField}"]`);
        if (el && typeof el.scrollIntoView === "function") {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 60);
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        ...form,
        EMPLOYEE_CODE: (form.EMPLOYEE_CODE || employeeCode).trim().toUpperCase(),
        YEAR_OF_PASSING: form.YEAR_OF_PASSING ? Number(form.YEAR_OF_PASSING) : null,
        EXPERIENCE_YEARS: Number(form.EXPERIENCE_YEARS) || 0,
        DOB: form.DOB || null,
        // Phase A — HR Module expansion: numeric coercions
        PERCENTAGE: form.PERCENTAGE === "" || form.PERCENTAGE == null
          ? null : Number(form.PERCENTAGE),
        PREVIOUS_SALARY: form.PREVIOUS_SALARY === "" || form.PREVIOUS_SALARY == null
          ? null : Number(form.PREVIOUS_SALARY)
      };

      const submitRes = await pub.post(
        `/employee-onboarding/${token}/submit-form`,
        payload
      );

      // Clear stored session — registration is complete.
      try {
        localStorage.removeItem(`employee_onboarding_session_${token}`);
        sessionStorage.removeItem("pending_onboarding_token");
      } catch {
        /* ignore */
      }

      // Backend now auto-approves + returns a login token. Save it
      // as if the user had just logged in via /employee-login so the
      // RoleBasedLanding at "/" recognises the session, then redirect
      // straight to the dashboard.
      const d = submitRes?.data?.auto_login;

      if (d && d.access_token) {

        try {
          localStorage.setItem("auth", "true");
          localStorage.setItem("role", "employee");
          localStorage.setItem("token", d.access_token);
          localStorage.setItem("employee_id", d.EMPLOYEE_ID || d.employee_id || "");
          localStorage.setItem("employee_name", d.EMPLOYEE_NAME || d.name || "");
          localStorage.setItem("department", d.DEPARTMENT || "");
          localStorage.setItem("employee_role", d.ROLE || d.role || "");
          localStorage.setItem("username", d.EMPLOYEE_NAME || d.name || "");
          localStorage.setItem("employee_code", d.EMPLOYEE_ID || d.code || "");
          localStorage.setItem("loginTime", new Date().toISOString());
          localStorage.setItem("attendance_status", d.ATTENDANCE_STATUS || "PRESENT");
        } catch { /* storage blocked */ }

        // Hard navigate so the new auth state is picked up everywhere.
        window.location.href = "/";

        return;
      }

      // Fallback (no auto-login payload): show the legacy submitted card.
      onSubmitted?.();

    } catch (err) {
      const resp = err?.response;
      let message;
      if (!resp) {
        message = `Cannot reach server: ${err?.message || "network error"}`;
      } else if (Array.isArray(resp.data?.detail)) {
        message = resp.data.detail
          .map((d) => {
            const field = (d.loc || []).slice(1).join(".") || "field";
            return `${field}: ${d.msg}`;
          })
          .join(" · ");
      } else if (typeof resp.data?.detail === "string") {
        message = resp.data.detail;
      } else {
        message = `Server error ${resp.status} — try again`;
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        maxWidth: 820,
        margin: "30px auto",
        background: "white",
        borderRadius: 16,
        boxShadow: "0 18px 50px rgba(15,23,42,0.10)",
        padding: 28,
        borderTop: `4px solid ${COLOURS.primary}`
      }}
    >
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        letterSpacing: 2,
        color: COLOURS.primary,
        textTransform: "uppercase"
      }}>
        Step 2 of 2
      </div>
      <h2 style={{
        fontSize: 22,
        fontWeight: 900,
        color: COLOURS.ink,
        margin: "6px 0 4px"
      }}>
        Complete your registration
      </h2>
      <div style={{
        fontSize: 12,
        color: "#64748b",
        marginBottom: 22,
        lineHeight: 1.55
      }}>
        Fill in your personal, contact, education and professional
        details. The admin will review and activate your account.
      </div>

      {error && (
        <div style={{
          background: "#fef2f2",
          color: "#b91c1c",
          border: "1px solid #fecaca",
          padding: 12,
          borderRadius: 8,
          marginBottom: 18,
          fontSize: 13,
          fontWeight: 600
        }}>
          {error}
        </div>
      )}

      {/* ============== PHOTO ============== */}
      <div style={{
        background: `linear-gradient(135deg, ${COLOURS.primary}10, ${COLOURS.dark}14)`,
        border: `1px dashed ${COLOURS.primary}66`,
        borderRadius: 14,
        padding: 18,
        marginBottom: 22,
        display: "flex",
        gap: 18,
        alignItems: "center"
      }}>
        <div style={{
          width: 100,
          height: 100,
          borderRadius: "50%",
          background: photoPreview
            ? `url(${photoPreview}) center/cover`
            : `linear-gradient(135deg, ${COLOURS.primary}, ${COLOURS.dark})`,
          color: "white",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontWeight: 800,
          fontSize: 38,
          border: "3px solid white",
          boxShadow: "0 6px 20px rgba(139,11,31,0.3)",
          flexShrink: 0
        }}>
          {!photoPreview && initials(form.NAME)}
        </div>

        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 800, color: COLOURS.ink, fontSize: 14 }}>
            Passport-size photo
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
            PNG / JPG / WEBP. This will appear on your employee profile,
            attendance views, and resume.
          </div>
          <label
            htmlFor="onb-photo-input"
            style={{
              display: "inline-block",
              marginTop: 10,
              background: `linear-gradient(135deg, ${COLOURS.primary}, ${COLOURS.dark})`,
              color: "white",
              padding: "7px 16px",
              borderRadius: 8,
              cursor: uploading ? "default" : "pointer",
              fontSize: 12,
              fontWeight: 700,
              opacity: uploading ? 0.7 : 1
            }}
          >
            {uploading
              ? "Uploading…"
              : (photoPreview ? "🔄 Change photo" : "📷 Upload photo")}
          </label>
          <input
            id="onb-photo-input"
            type="file"
            accept="image/*"
            onChange={handlePhoto}
            disabled={uploading}
            style={{ display: "none" }}
          />
        </div>
      </div>

      {/* ============== 1. PERSONAL INFORMATION ============== */}
      <FormSection title="① Personal Information" color="#6366f1">
        <FormGrid cols={2}>
          <FormField label="Employee ID (locked)">
            <input
              type="text"
              value={form.EMPLOYEE_CODE}
              readOnly
              style={{
                ...inputStyle(),
                background: "#f1f5f9",
                color: "#64748b",
                cursor: "not-allowed"
              }}
            />
          </FormField>
          <FormField label="Employee Name *" error={errors.NAME} fieldName="NAME">
            <input
              type="text"
              value={form.NAME}
              onChange={set("NAME")}
              onBlur={blur("NAME")}
              placeholder="Ramesh Kumar"
              style={inputStyle(!!errors.NAME)}
            />
          </FormField>
          <FormField label="Father's Name">
            <input
              type="text"
              value={form.FATHER_NAME}
              onChange={set("FATHER_NAME")}
              placeholder="Murugan"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Mother's Name">
            <input
              type="text"
              value={form.MOTHER_NAME}
              onChange={set("MOTHER_NAME")}
              placeholder="Lakshmi"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Date of Birth" error={errors.DOB} fieldName="DOB">
            <input
              type="date"
              value={form.DOB}
              onChange={set("DOB")}
              onBlur={blur("DOB")}
              style={inputStyle(!!errors.DOB)}
            />
          </FormField>
          <FormField label="Gender">
            <select
              value={form.GENDER}
              onChange={set("GENDER")}
              style={inputStyle()}
            >
              <option value="">— pick —</option>
              {GENDERS.map((g) => (
                <option key={g} value={g}>{g.replace("_", " ")}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Marital Status">
            <select
              value={form.MARITAL_STATUS}
              onChange={set("MARITAL_STATUS")}
              style={inputStyle()}
            >
              <option value="">— pick —</option>
              {MARITAL_STATUSES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Occupation">
            <input
              type="text"
              value={form.OCCUPATION}
              onChange={set("OCCUPATION")}
              placeholder="Mechanical Technician"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Blood Group">
            <select
              value={form.BLOOD_GROUP}
              onChange={set("BLOOD_GROUP")}
              style={inputStyle()}
            >
              <option value="">— pick —</option>
              {["A+","A-","B+","B-","O+","O-","AB+","AB-"].map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
          </FormField>
          <FormField label="Nationality">
            <input
              type="text"
              value={form.NATIONALITY}
              onChange={set("NATIONALITY")}
              placeholder="Indian"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Emergency Contact Name">
            <input
              type="text"
              value={form.EMERGENCY_CONTACT_NAME}
              onChange={set("EMERGENCY_CONTACT_NAME")}
              placeholder="Father / Spouse / Sibling"
              style={inputStyle()}
            />
          </FormField>
          <FormField
            label="Emergency Contact Phone"
            error={errors.EMERGENCY_CONTACT_PHONE}
            fieldName="EMERGENCY_CONTACT_PHONE"
          >
            <input
              type="tel"
              value={form.EMERGENCY_CONTACT_PHONE}
              onChange={set("EMERGENCY_CONTACT_PHONE")}
              onBlur={blur("EMERGENCY_CONTACT_PHONE")}
              placeholder="9876543210"
              maxLength={15}
              style={inputStyle(!!errors.EMERGENCY_CONTACT_PHONE)}
            />
          </FormField>
          <FormField label="Relationship" span={2}>
            <input
              type="text"
              value={form.EMERGENCY_CONTACT_RELATION}
              onChange={set("EMERGENCY_CONTACT_RELATION")}
              placeholder="Father / Mother / Spouse / Sibling"
              style={inputStyle()}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* ============== 2. CONTACT ============== */}
      <FormSection title="② Contact" color="#06b6d4">
        <FormGrid cols={2}>
          <FormField label="Contact Number *" error={errors.PHONE} fieldName="PHONE">
            <input
              type="tel"
              value={form.PHONE}
              onChange={set("PHONE")}
              onBlur={blur("PHONE")}
              placeholder="9876543210"
              maxLength={15}
              style={inputStyle(!!errors.PHONE)}
            />
          </FormField>
          <FormField label="Email" error={errors.EMAIL} fieldName="EMAIL">
            <input
              type="email"
              value={form.EMAIL}
              onChange={set("EMAIL")}
              onBlur={blur("EMAIL")}
              placeholder="ramesh@bvc24.in"
              style={inputStyle(!!errors.EMAIL)}
            />
          </FormField>
          <FormField label="Address (Street / House No)" span={2}>
            <textarea
              rows={2}
              value={form.ADDRESS}
              onChange={set("ADDRESS")}
              placeholder="Plot 12, ABC Street, Near XYZ Park"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="City">
            <input
              type="text"
              value={form.CITY}
              onChange={set("CITY")}
              placeholder="Coimbatore"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="State">
            <input
              type="text"
              value={form.STATE}
              onChange={set("STATE")}
              placeholder="Tamil Nadu"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Pincode" span={2} error={errors.PINCODE} fieldName="PINCODE">
            <input
              type="text"
              inputMode="numeric"
              value={form.PINCODE}
              onChange={set("PINCODE")}
              onBlur={blur("PINCODE")}
              placeholder="641001"
              maxLength={6}
              style={inputStyle(!!errors.PINCODE)}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* ============== 3. EDUCATIONAL INFORMATION ============== */}
      <FormSection title="③ Educational Information" color="#10b981">
        <FormGrid cols={2}>
          <FormField label="Qualification">
            <input
              type="text"
              value={form.QUALIFICATION}
              onChange={set("QUALIFICATION")}
              placeholder="BE Mechanical Engineering"
              style={inputStyle()}
            />
          </FormField>
          <FormField
            label="Year of Passing"
            error={errors.YEAR_OF_PASSING}
            fieldName="YEAR_OF_PASSING"
          >
            <input
              type="number"
              min="1950"
              max="2099"
              value={form.YEAR_OF_PASSING}
              onChange={set("YEAR_OF_PASSING")}
              onBlur={blur("YEAR_OF_PASSING")}
              placeholder="2020"
              style={inputStyle(!!errors.YEAR_OF_PASSING)}
            />
          </FormField>
          <FormField label="College">
            <input
              type="text"
              value={form.COLLEGE}
              onChange={set("COLLEGE")}
              placeholder="PSG College of Technology"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="University">
            <input
              type="text"
              value={form.UNIVERSITY}
              onChange={set("UNIVERSITY")}
              placeholder="Anna University"
              style={inputStyle()}
            />
          </FormField>
          <FormField
            label="Percentage / CGPA"
            span={2}
            error={errors.PERCENTAGE}
            fieldName="PERCENTAGE"
          >
            <input
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.PERCENTAGE}
              onChange={set("PERCENTAGE")}
              onBlur={blur("PERCENTAGE")}
              placeholder="85.5"
              style={inputStyle(!!errors.PERCENTAGE)}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* ============== 4. PROFESSIONAL INFORMATION ============== */}
      <FormSection title="④ Professional Information" color="#f59e0b">
        <FormGrid cols={2}>
          <FormField label="Fresher / Experienced">
            <select
              value={form.EMPLOYMENT_TYPE}
              onChange={set("EMPLOYMENT_TYPE")}
              style={inputStyle()}
            >
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </FormField>
          <FormField
            label="Years of Experience"
            error={errors.EXPERIENCE_YEARS}
            fieldName="EXPERIENCE_YEARS"
          >
            <input
              type="number"
              min="0"
              step="0.5"
              value={form.EXPERIENCE_YEARS}
              onChange={set("EXPERIENCE_YEARS")}
              onBlur={blur("EXPERIENCE_YEARS")}
              placeholder="0"
              style={inputStyle(!!errors.EXPERIENCE_YEARS)}
            />
          </FormField>
          <FormField label="Previous Company">
            <input
              type="text"
              value={form.PREVIOUS_COMPANY}
              onChange={set("PREVIOUS_COMPANY")}
              placeholder="ABC Manufacturing Pvt Ltd"
              style={inputStyle()}
            />
          </FormField>
          <FormField
            label="Previous Salary (₹/month)"
            error={errors.PREVIOUS_SALARY}
            fieldName="PREVIOUS_SALARY"
          >
            <input
              type="number"
              min="0"
              step="500"
              value={form.PREVIOUS_SALARY}
              onChange={set("PREVIOUS_SALARY")}
              onBlur={blur("PREVIOUS_SALARY")}
              placeholder="45000"
              style={inputStyle(!!errors.PREVIOUS_SALARY)}
            />
          </FormField>
          <FormField label="Skills (comma-separated)" span={2}>
            <input
              type="text"
              value={form.SKILLS}
              onChange={set("SKILLS")}
              placeholder="solidworks, wiring, assembly, quality check"
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Experience Details" span={2}>
            <textarea
              rows={3}
              value={form.EXPERIENCE_DETAILS}
              onChange={set("EXPERIENCE_DETAILS")}
              placeholder={"ABC Manufacturing — 2 yrs (CNC operator)\nXYZ Industries — 1 yr (Welder)"}
              style={inputStyle()}
            />
          </FormField>
          <FormField label="Past Working Projects" span={2}>
            <textarea
              rows={3}
              value={form.PAST_PROJECTS}
              onChange={set("PAST_PROJECTS")}
              placeholder={"• Snack Vending Machine v2\n• Industrial Conveyor Belt System\n• Custom CNC retrofit"}
              style={inputStyle()}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* ============== 5. BANK + IDENTITY (PAYROLL) ============== */}
      <FormSection title="⑤ Bank & Identity (Payroll)" color="#0284c7">
        <FormGrid cols={2}>
          <FormField
            label="Bank Account Number"
            error={errors.BANK_ACCOUNT_NUMBER}
            fieldName="BANK_ACCOUNT_NUMBER"
          >
            <input
              type="text"
              inputMode="numeric"
              value={form.BANK_ACCOUNT_NUMBER}
              onChange={set("BANK_ACCOUNT_NUMBER")}
              onBlur={blur("BANK_ACCOUNT_NUMBER")}
              placeholder="50100123456789"
              maxLength={18}
              style={inputStyle(!!errors.BANK_ACCOUNT_NUMBER)}
            />
          </FormField>
          <FormField label="Bank Name">
            <input
              type="text"
              value={form.BANK_NAME}
              onChange={set("BANK_NAME")}
              placeholder="HDFC Bank"
              style={inputStyle()}
            />
          </FormField>
          <FormField
            label="IFSC Code"
            error={errors.IFSC_CODE}
            fieldName="IFSC_CODE"
          >
            <input
              type="text"
              value={form.IFSC_CODE}
              onChange={set("IFSC_CODE")}
              onBlur={blur("IFSC_CODE")}
              placeholder="HDFC0001234"
              maxLength={11}
              style={{ ...inputStyle(!!errors.IFSC_CODE), textTransform: "uppercase" }}
            />
          </FormField>
          <FormField
            label="PAN Number"
            error={errors.PAN_NUMBER}
            fieldName="PAN_NUMBER"
          >
            <input
              type="text"
              value={form.PAN_NUMBER}
              onChange={set("PAN_NUMBER")}
              onBlur={blur("PAN_NUMBER")}
              placeholder="ABCDE1234F"
              maxLength={10}
              style={{ ...inputStyle(!!errors.PAN_NUMBER), textTransform: "uppercase" }}
            />
          </FormField>
          <FormField
            label="Aadhaar Number"
            span={2}
            error={errors.AADHAAR_NUMBER}
            fieldName="AADHAAR_NUMBER"
          >
            <input
              type="text"
              inputMode="numeric"
              value={form.AADHAAR_NUMBER}
              onChange={set("AADHAAR_NUMBER")}
              onBlur={blur("AADHAAR_NUMBER")}
              placeholder="1234 5678 9012"
              maxLength={14}
              style={inputStyle(!!errors.AADHAAR_NUMBER)}
            />
          </FormField>
        </FormGrid>
      </FormSection>

      {/* ============== 6. ADDITIONAL INFORMATION ============== */}
      <FormSection title="⑥ Additional Information" color="#8b5cf6">
        <FormField label="Extra Information / Notes">
          <textarea
            rows={3}
            value={form.NOTES}
            onChange={set("NOTES")}
            placeholder="Anything else you'd like your manager to know"
            style={inputStyle()}
          />
        </FormField>
      </FormSection>

      {/* ============== 7. DOCUMENTS ============== */}
      <FormSection title="⑦ Documents" color="#ea580c">
        <div style={{
          background: "#fff7ed",
          border: "1px solid #fed7aa",
          borderRadius: 10,
          padding: 12,
          marginBottom: 14,
          fontSize: 12,
          color: "#7c2d12",
          lineHeight: 1.55,
        }}>
          Upload your <b>resume, marksheets, degree certificate, Aadhaar, PAN</b>,
          and any other documents HR will need. Allowed: PDF, JPG, PNG, DOC/DOCX,
          XLS/XLSX, TXT. Max 10&nbsp;MB per file. You can upload as many as you
          need; they're saved with your application.
        </div>

        <FormGrid cols={2}>
          <FormField label="Document Type">
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              style={inputStyle()}
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </FormField>

          <FormField label="Select File">
            <input
              type="file"
              onChange={handleDocUpload}
              disabled={docUploading}
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx,.txt"
              style={{
                ...inputStyle(),
                padding: "8px 10px",
                cursor: docUploading ? "wait" : "pointer",
              }}
            />
          </FormField>
        </FormGrid>

        {docError && (
          <div style={{
            marginTop: 10,
            padding: "8px 12px",
            background: "#fee2e2",
            border: "1px solid #fca5a5",
            borderRadius: 8,
            color: "#991b1b",
            fontSize: 12,
            fontWeight: 600,
          }}>
            {docError}
          </div>
        )}

        {docUploading && (
          <div style={{
            marginTop: 10,
            fontSize: 12,
            color: "#7c2d12",
            fontWeight: 600,
          }}>
            Uploading…
          </div>
        )}

        {/* Uploaded list */}
        <div style={{ marginTop: 14 }}>
          <div style={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: "uppercase",
            letterSpacing: 0.6,
            color: "#64748b",
            marginBottom: 6,
          }}>
            Uploaded ({docs.length})
          </div>

          {docs.length === 0 ? (
            <div style={{
              padding: "16px 12px",
              textAlign: "center",
              color: "#94a3b8",
              fontSize: 12,
              border: "1px dashed #e2e8f0",
              borderRadius: 8,
            }}>
              No documents uploaded yet.
            </div>
          ) : (
            <div style={{
              border: "1px solid #e2e8f0",
              borderRadius: 8,
              overflow: "hidden",
            }}>
              {docs.map((d, i) => (
                <div
                  key={d.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "10px 12px",
                    background: i % 2 === 0 ? "#fff" : "#f8fafc",
                    borderBottom: i < docs.length - 1 ? "1px solid #e2e8f0" : "none",
                    fontSize: 13,
                  }}
                >
                  <span style={{
                    fontSize: 10,
                    fontWeight: 800,
                    color: "#9a3412",
                    background: "#ffedd5",
                    padding: "3px 8px",
                    borderRadius: 999,
                    letterSpacing: 0.3,
                    whiteSpace: "nowrap",
                  }}>
                    {(d.doc_type || "").replace(/_/g, " ")}
                  </span>
                  <span style={{
                    flex: 1,
                    minWidth: 0,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: COLOURS.ink,
                  }} title={d.original_name}>
                    {d.original_name}
                  </span>
                  <span style={{
                    color: "#94a3b8",
                    fontSize: 11,
                    whiteSpace: "nowrap",
                  }}>
                    {fmtBytes(d.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleDocDelete(d.id)}
                    style={{
                      padding: "5px 10px",
                      border: "1px solid #fca5a5",
                      background: "#fee2e2",
                      color: "#991b1b",
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: "pointer",
                    }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </FormSection>

      <div style={{
        display: "flex",
        justifyContent: "flex-end",
        marginTop: 24,
        paddingTop: 18,
        borderTop: "1px solid #e2e8f0"
      }}>
        <button
          type="submit"
          disabled={submitting || uploading}
          style={{
            background: (submitting || uploading)
              ? "#cbd5e1"
              : `linear-gradient(135deg, ${COLOURS.primary}, ${COLOURS.dark})`,
            color: "white",
            border: "none",
            padding: "12px 30px",
            borderRadius: 12,
            fontWeight: 800,
            fontSize: 14,
            cursor: (submitting || uploading) ? "default" : "pointer",
            boxShadow: "0 10px 24px rgba(200,16,46,0.28)",
            letterSpacing: 0.4
          }}
        >
          {submitting ? "Submitting…" : "✓ Submit for HR Approval"}
        </button>
      </div>
    </form>
  );
}


// ================================================================
// Main page — orchestrates LOGIN / FORM / FINAL states
// ================================================================
function EmployeeOnboardingChat() {

  const { token } = useParams();
  const navigate  = useNavigate();

  // null while we fetch the session metadata
  const [meta, setMeta]           = useState(null);
  const [metaError, setMetaError] = useState("");
  const [loading, setLoading]     = useState(true);

  // Session payload after successful login. Restored from
  // localStorage on mount so a page-refresh keeps the candidate
  // on the form step.
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(`employee_onboarding_session_${token}`);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });

  const [submitted, setSubmitted] = useState(false);

  // Guard so the redirect-to-/login happens at most once per mount.
  const redirectedRef = useRef(false);

  // Fetch the public session metadata so we can:
  //   - show the invited name in the header
  //   - render a terminal state if the session is no longer OPEN
  //   - redirect to /login when the session is OPEN but the
  //     candidate has not yet authenticated on this device
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    setLoading(true);
    pub.get(`/employee-onboarding/${token}`)
      .then((r) => {
        if (cancelled) return;
        setMeta(r.data);

        const sessionStatus = r.data?.status || "OPEN";
        if (sessionStatus !== "OPEN") {
          // Terminal state — let the render branch handle the card.
          return;
        }

        // OPEN session: do we already have a local onboarding session
        // for this token? If not, hand off to the central /login page.
        let hasLocalSession = false;
        try {
          hasLocalSession = !!localStorage.getItem(
            `employee_onboarding_session_${token}`
          );
        } catch {
          hasLocalSession = false;
        }

        if (!hasLocalSession && !redirectedRef.current) {
          redirectedRef.current = true;
          try {
            sessionStorage.setItem("pending_onboarding_token", token);
          } catch {
            /* sessionStorage may be unavailable (private mode) — ignore */
          }
          navigate("/login", { replace: true });
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setMetaError(
          err?.response?.data?.detail ||
          (err?.response?.status === 410
            ? "This onboarding link has expired."
            : "Onboarding link not found.")
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [token, navigate]);

  const invitedName = useMemo(
    () => meta?.invited_name || session?.invited_name || "",
    [meta, session]
  );

  // ----------------------------------------------------------------
  // Render branches
  // ----------------------------------------------------------------

  const bodyStyle = {
    minHeight: "100vh",
    background: COLOURS.paper,
    fontFamily: "system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif",
    color: COLOURS.ink
  };

  if (loading) {
    return (
      <div style={bodyStyle}>
        <HeaderStrip invitedName="" />
        <div style={{
          textAlign: "center",
          padding: 60,
          color: "#64748b",
          fontSize: 14
        }}>
          Loading your onboarding session…
        </div>
      </div>
    );
  }

  if (metaError) {
    return (
      <div style={bodyStyle}>
        <HeaderStrip invitedName="" />
        <FinalStateCard status="EXPIRED" reason={metaError} />
      </div>
    );
  }

  const status = meta?.status || "OPEN";

  // Terminal states — show the final card no matter what's in
  // localStorage. The candidate is done (one way or another).
  if (status !== "OPEN") {
    return (
      <div style={bodyStyle}>
        <HeaderStrip invitedName={invitedName} />
        <FinalStateCard
          status={status}
          reason={meta?.reject_reason}
        />
      </div>
    );
  }

  // Just submitted the form in this session — celebratory card.
  if (submitted) {
    return (
      <div style={bodyStyle}>
        <HeaderStrip invitedName={invitedName} />
        <SubmittedCard />
      </div>
    );
  }

  // Logged-in candidate → show the registration form
  if (session) {
    return (
      <div style={bodyStyle}>
        <HeaderStrip invitedName={invitedName} />
        <RegistrationForm
          token={token}
          session={session}
          onSubmitted={() => setSubmitted(true)}
        />
      </div>
    );
  }

  // Default: not logged in → the effect above has already kicked off
  // navigation to /login. Render a small holding view while React
  // unmounts this page.
  return (
    <div style={bodyStyle}>
      <HeaderStrip invitedName={invitedName} />
      <div style={{
        textAlign: "center",
        padding: 60,
        color: "#64748b",
        fontSize: 14
      }}>
        Redirecting to sign-in…
      </div>
    </div>
  );
}


export default EmployeeOnboardingChat;
