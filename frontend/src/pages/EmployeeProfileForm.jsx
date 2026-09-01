import { useEffect, useRef, useState } from "react";

import API from "../services/api";
import ConfirmDialog from "../components/ConfirmDialog";
import styles from "./EmployeeProfileForm.module.css";

// Small set surfaced during onboarding. Anything else can still be
// uploaded later from Profile → Documents in the ESS panel.
const DOC_TYPES = [
  { value: "RESUME", label: "Resume / CV" },
  { value: "AADHAAR", label: "Aadhaar" },
  { value: "PAN", label: "PAN card" },
  { value: "DEGREE", label: "Degree certificate" },
  { value: "TENTH_MARKSHEET", label: "10th marksheet" },
  { value: "TWELFTH_MARKSHEET", label: "12th marksheet" },
  { value: "OFFER_LETTER", label: "Offer letter" },
  { value: "BANK_PASSBOOK", label: "Bank passbook / cheque" },
  { value: "ADDRESS_PROOF", label: "Address proof" },
  { value: "OTHER", label: "Other" },
];

// The six required document categories that every new joiner has to
// upload during onboarding. Each slot supports multiple files (e.g.
// front + back of Aadhaar, both 10th and 12th marksheets, etc.).
// The `types` array is the set of DOC_TYPE keys that count towards
// this slot's "uploaded" state.
const REQUIRED_DOC_SLOTS = [
  {
    key:      "SCHOOL_MARKSHEETS",
    label:    "10th & 12th Marksheets",
    hint:     "Upload both 10th and 12th mark sheets (soft copy).",
    types:    ["TENTH_MARKSHEET", "TWELFTH_MARKSHEET"],
    saveAs:   "TENTH_MARKSHEET",   // default when picker doesn't distinguish
    required: true,
  },
  {
    key:      "DEGREE_CERTIFICATE",
    label:    "Degree Certificate (UG / PG)",
    hint:     "UG and/or PG degree certificate. Upload all pages.",
    types:    ["DEGREE", "POSTGRADUATE"],
    saveAs:   "DEGREE",
    required: true,
  },
  {
    key:      "PAN_CARD",
    label:    "PAN Card",
    hint:     "PAN card (front side).",
    types:    ["PAN"],
    saveAs:   "PAN",
    required: true,
  },
  {
    key:      "AADHAAR_CARD",
    label:    "Aadhaar Card",
    hint:     "Aadhaar card front and back.",
    types:    ["AADHAAR"],
    saveAs:   "AADHAAR",
    required: true,
  },
  {
    key:      "EXPERIENCE_CERTIFICATE",
    label:    "Previous Experience Certificate",
    hint:     "Only if you have previous work experience.",
    types:    ["EXPERIENCE_LETTER", "RELIEVING_LETTER", "SALARY_SLIP"],
    saveAs:   "EXPERIENCE_LETTER",
    required: false,
  },
  {
    key:      "BANK_DETAILS",
    label:    "Bank Details",
    hint:     "Cancelled cheque or bank passbook first page.",
    types:    ["BANK_PASSBOOK"],
    saveAs:   "BANK_PASSBOOK",
    required: true,
  },
];

const MAX_DOC_MB = 10;

// ---- Icons ----
// Small stroke SVGs replace the emoji glyphs we used to have. Same
// visual weight everywhere so the page reads as one thing, and
// icons render identically across OS emoji fonts.
const svg = (path) => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.8"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">
    {path}
  </svg>
);

const Icons = {
  identity: svg(<>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M14 10h4M14 14h4M6.5 16.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5" />
  </>),
  camera: svg(<>
    <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
    <circle cx="12" cy="13" r="3.5" />
  </>),
  user: svg(<>
    <circle cx="12" cy="8" r="4" />
    <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
  </>),
  phone: svg(<>
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.3 1.8.6 2.6a2 2 0 0 1-.5 2.1L8 9.6a16 16 0 0 0 6 6l1.2-1.2a2 2 0 0 1 2.1-.5c.8.3 1.7.5 2.6.6a2 2 0 0 1 1.7 2z" />
  </>),
  graduation: svg(<>
    <path d="M22 10L12 5 2 10l10 5 10-5z" />
    <path d="M6 12v5c3 2 9 2 12 0v-5" />
  </>),
  briefcase: svg(<>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M2 13h20" />
  </>),
  paperclip: svg(
    <path d="M21 12.5L12.5 21a5.5 5.5 0 0 1-7.8-7.8l9-9a3.7 3.7 0 0 1 5.2 5.2l-9 9a1.8 1.8 0 0 1-2.6-2.6l7.4-7.4" />
  ),
  note: svg(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
    <path d="M9 13h6M9 17h4" />
  </>),
  logout: svg(<>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="M16 17l5-5-5-5" />
    <path d="M21 12H9" />
  </>),
  building: svg(<>
    <path d="M4 21V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v16" />
    <path d="M9 21V13h6v8" />
    <path d="M8 7h2M8 10h2M14 7h2M14 10h2" />
    <path d="M2 21h20" />
  </>),
  speaker: svg(<>
    <path d="M11 5L6 9H2v6h4l5 4V5z" />
    <path d="M15 9a3 3 0 0 1 0 6" />
    <path d="M17.5 6.5a7 7 0 0 1 0 11" />
  </>),
  bank: svg(<>
    <path d="M3 10l9-6 9 6" />
    <path d="M4 10v8M8 10v8M12 10v8M16 10v8M20 10v8" />
    <path d="M2 21h20" />
  </>),
  alert: svg(<>
    <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    <path d="M12 9v4M12 17h.01" />
  </>),
  check: svg(<>
    <path d="M22 11.1V12a10 10 0 1 1-5.9-9.1" />
    <path d="M22 4L12 14.01l-3-3" />
  </>),
};


// ===================================================================
// EmployeeProfileForm — full-screen one-shot self-registration form
// shown the first time an employee logs in (when PROFILE_SUBMITTED=0).
//
// Mirrors the Admin "Add Employee" form's field set, except:
//   - EMPLOYEE_CODE, ROLE, DEPARTMENT, DESIGNATION are READ-ONLY
//     (those are admin-controlled — employee can't promote themselves)
//   - Photo upload is allowed
//
// On submit: POST /employees/by-code/{code}/submit-profile → flips
// PROFILE_SUBMITTED on the backend → parent re-fetches and the
// dashboard becomes read-only.
// ===================================================================


function Field({ label, children, hint }) {
  return (
    <div>
      <label className={styles.fieldLabel}>{label}</label>
      {children}
      {hint && <div className={styles.fieldHint}>{hint}</div>}
    </div>
  );
}


function Section({ icon, title, children }) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionHeader}>
        <span className={styles.sectionIcon}>{icon}</span>
        <span>{title}</span>
      </div>
      {children}
    </div>
  );
}


function EmployeeProfileForm({ employee, onSubmitted, onLogout }) {

  const [form, setForm] = useState({
    // Personal
    NAME: employee.NAME || "",
    DOB: employee.DOB || "",
    FATHER_NAME: employee.FATHER_NAME || "",
    MOTHER_NAME: employee.MOTHER_NAME || "",
    GENDER: employee.GENDER || "",
    MARITAL_STATUS: employee.MARITAL_STATUS || "",
    OCCUPATION: employee.OCCUPATION || "",
    BLOOD_GROUP: employee.BLOOD_GROUP || "",
    NATIONALITY: employee.NATIONALITY || "Indian",
    EMERGENCY_CONTACT_NAME: employee.EMERGENCY_CONTACT_NAME || "",
    EMERGENCY_CONTACT_PHONE: employee.EMERGENCY_CONTACT_PHONE || "",
    EMERGENCY_CONTACT_RELATION: employee.EMERGENCY_CONTACT_RELATION || "",
    // Contact & address
    EMAIL: employee.EMAIL || "",
    PHONE: employee.PHONE || "",
    ADDRESS: employee.ADDRESS || "",
    CITY: employee.CITY || "",
    STATE: employee.STATE || "Tamil Nadu",
    PINCODE: employee.PINCODE || "",
    // Education
    QUALIFICATION: employee.QUALIFICATION || "",
    YEAR_OF_PASSING: employee.YEAR_OF_PASSING || "",
    COLLEGE: employee.COLLEGE || "",
    UNIVERSITY: employee.UNIVERSITY || "",
    PERCENTAGE: employee.PERCENTAGE ?? "",
    // Professional
    EMPLOYMENT_TYPE: employee.EMPLOYMENT_TYPE || "FRESHER",
    EXPERIENCE_YEARS: employee.EXPERIENCE_YEARS || 0,
    PREVIOUS_COMPANY: employee.PREVIOUS_COMPANY || "",
    SKILLS: employee.SKILLS || "",
    EXPERIENCE_DETAILS: employee.EXPERIENCE_DETAILS || "",
    PAST_PROJECTS: employee.PAST_PROJECTS || "",
    // Work details
    JOINING_DATE: employee.JOINING_DATE || "",
    WORK_LOCATION: employee.WORK_LOCATION || "",
    // Bank & identity (payroll)
    BANK_ACCOUNT_NUMBER: employee.BANK_ACCOUNT_NUMBER || "",
    BANK_NAME: employee.BANK_NAME || "",
    IFSC_CODE: employee.IFSC_CODE || "",
    PAN_NUMBER: employee.PAN_NUMBER || "",
    AADHAAR_NUMBER: employee.AADHAAR_NUMBER || "",
    // Additional
    NOTES: employee.NOTES || ""
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---- Documents ----
  // Docs are uploaded IMMEDIATELY (not deferred to submit) using the
  // same endpoint MyProfilePanel uses. That way if the employee closes
  // the browser mid-form, at least their IDs are saved.

  // Uploaded IMMEDIATELY (not deferred to submit). If the employee
  // closes the browser mid-form, their IDs are already saved on
  // the server via the /employees/{id}/documents endpoint.

  const [docType, setDocType] = useState(DOC_TYPES[0].value);
  const [docTitle, setDocTitle] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState("");
  const [docs, setDocs] = useState([]);
  const docInputRef = useRef(null);

  // Load any docs already uploaded (e.g. employee re-opened the form
  // after uploading one file yesterday).

  // Rehydrate any docs already uploaded (e.g. employee re-opened the
  // form after uploading a file earlier).

  useEffect(() => {
    if (!employee?.ID) return;
    let cancelled = false;
    API.get(`/employees/${encodeURIComponent(employee.ID)}/documents`)
      .then((r) => {
        if (cancelled) return;
        const list = Array.isArray(r.data) ? r.data : r.data?.documents || [];
        setDocs(list);
      })
      .catch(() => { /* first-time load — no docs yet, silent */ });
    return () => { cancelled = true; };
  }, [employee?.ID]);


  // ----- Voice greeting on first open -----
  // Speaks: "Welcome <Name>, please fill in your personal and work details below."
  //
  // Browser autoplay policy blocks speechSynthesis until AFTER a user
  // gesture. Strategy:
  //   1. Try to speak immediately (works when login click is a recent gesture)
  //   2. If blocked, fire on the first click/tap/key anywhere on the page
  //   3. User can also click the manual sound button in the hero (state below)
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const name = (employee?.NAME || "").trim();
    if (!name) return;

    let hasSpoken = false;

    const speak = () => {
      if (hasSpoken) return;
      try {
        const u = new SpeechSynthesisUtterance(
          `Welcome ${name}. Please fill in your personal and work details below.`
        );
        u.rate  = 0.95;
        u.pitch = 1.0;
        u.lang  = "en-IN";
        const voices = window.speechSynthesis.getVoices();
        const preferred =
          voices.find((v) => /en[-_]IN/i.test(v.lang)) ||
          voices.find((v) => /en/i.test(v.lang));
        if (preferred) u.voice = preferred;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
        hasSpoken = true;
        // eslint-disable-next-line no-console
        console.log("[voice] greeting spoken for", name);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[voice] greeting failed:", err);
      }
    };

    // Expose the speak() to the manual button (via window global so a
    // component render doesn't hold a stale reference).
    window.__profileGreet = speak;

    const onFirstGesture = () => { speak(); cleanup(); };

    const cleanup = () => {
      document.removeEventListener("click",       onFirstGesture);
      document.removeEventListener("touchstart",  onFirstGesture);
      document.removeEventListener("keydown",     onFirstGesture);
    };

    document.addEventListener("click",      onFirstGesture);
    document.addEventListener("touchstart", onFirstGesture);
    document.addEventListener("keydown",    onFirstGesture);

    // Try to speak immediately after voices ready
    if (window.speechSynthesis.getVoices().length > 0) {
      setTimeout(speak, 400);
    } else {
      window.speechSynthesis.onvoiceschanged = () => {
        window.speechSynthesis.onvoiceschanged = null;
        setTimeout(speak, 200);
      };
    }

    return () => {
      cleanup();
      try { window.speechSynthesis.cancel(); } catch { /* ignore */ }
      delete window.__profileGreet;
    };
  }, [employee?.ID, employee?.NAME]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Upload a single file with a given DOC_TYPE. Returns the new doc
  // record on success, or throws with a user-facing message.
  const uploadOne = async (file, uploadDocType, uploadTitle) => {
    if (file.size > MAX_DOC_MB * 1024 * 1024) {
      throw new Error(`"${file.name}" is larger than ${MAX_DOC_MB} MB.`);
    }
    const fd = new FormData();
    fd.append("file", file);
    fd.append("doc_type", uploadDocType);
    fd.append("title", uploadTitle || file.name);
    const res = await API.post(
      `/employees/${encodeURIComponent(employee.ID)}/documents`,
      fd,
      { headers: { "Content-Type": "multipart/form-data" } }
    );
    return res.data?.document || res.data;
  };

  // Legacy single-picker (bottom "Add other document" row). Now takes
  // FileList so users can select multiple files at once.
  const handleDocPick = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setDocBusy(true);
    setDocError("");
    try {
      for (const f of files) {
        const newDoc = await uploadOne(f, docType, docTitle || f.name);
        if (newDoc) setDocs((prev) => [newDoc, ...prev]);
      }
      setDocTitle("");
    } catch (err) {
      setDocError(err?.response?.data?.detail || err?.message || "Upload failed.");
    } finally {
      setDocBusy(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  // Per-slot uploader used by the six required-document rows above.
  // Uploads every selected file under the slot's saveAs type.
  const handleSlotPick = async (slot, e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setDocBusy(true);
    setDocError("");
    try {
      for (const f of files) {
        const newDoc = await uploadOne(f, slot.saveAs, f.name);
        if (newDoc) setDocs((prev) => [newDoc, ...prev]);
      }
    } catch (err) {
      setDocError(err?.response?.data?.detail || err?.message || "Upload failed.");
    } finally {
      setDocBusy(false);
      // Clear the individual slot input so the same file can be re-picked
      if (e.target) e.target.value = "";
    }
  };

  const removeDoc = async (docId) => {
    try {
      await API.delete(
        `/employees/${encodeURIComponent(employee.ID)}/documents/${docId}`
      );
      setDocs((prev) => prev.filter((d) => (d.ID || d.id) !== docId));
    } catch (err) {
      alert(err?.response?.data?.detail || "Delete failed");
    }
  };

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  // Form submit is a two-step gate: the button opens a confirmation
  // dialog; only clicking "Yes, submit" in the dialog actually POSTs.
  // Cancel keeps the form editable.
  //
  // Full validation runs here — every business-critical field is
  // enforced before the confirmation dialog opens. The first missing
  // field wins so the employee sees ONE error at a time and can fix
  // it without scrolling through a wall of red text.
  const submit = (e) => {
    e?.preventDefault?.();
    setError("");

    // The employee is usually already at the bottom of the form
    // when they click Submit — scroll them back to the banner so
    // they actually see the message.
    const raise = (msg) => {
      setError(msg);
      requestAnimationFrame(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    };
    const missing = (label) => raise(`${label} is required.`);

    // ---- Personal Information ----
    if (!form.NAME.trim())              { missing("Full Name"); return; }
    if (!form.DOB)                      { missing("Date of Birth"); return; }
    if (!form.FATHER_NAME.trim())       { missing("Father's Name"); return; }
    if (!form.MOTHER_NAME.trim())       { missing("Mother's Name"); return; }
    if (!form.GENDER)                   { missing("Gender"); return; }
    if (!form.MARITAL_STATUS)           { missing("Marital Status"); return; }
    if (!form.BLOOD_GROUP)              { missing("Blood Group"); return; }
    if (!form.NATIONALITY.trim())       { missing("Nationality"); return; }
    if (!form.EMERGENCY_CONTACT_NAME.trim())     { missing("Emergency Contact Name"); return; }
    if (!form.EMERGENCY_CONTACT_PHONE.trim())    { missing("Emergency Contact Phone"); return; }
    if (form.EMERGENCY_CONTACT_PHONE.trim().length !== 10) {
      raise("Emergency Contact Phone must be 10 digits.");
      return;
    }
    if (!form.EMERGENCY_CONTACT_RELATION.trim()) { missing("Emergency Contact Relationship"); return; }

    // ---- Contact & Address ----
    if (!form.PHONE.trim())    { missing("Phone"); return; }
    if (!form.EMAIL.trim())    { missing("Email"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.EMAIL.trim())) {
      raise("Email is not valid.");
      return;
    }
    if (!form.ADDRESS.trim())  { missing("Address"); return; }
    if (!form.CITY.trim())     { missing("City"); return; }
    if (!form.STATE.trim())    { missing("State"); return; }
    if (!form.PINCODE.trim())  { missing("Pincode"); return; }

    // ---- Education ----
    if (!form.QUALIFICATION.trim())  { missing("Qualification"); return; }
    if (!form.YEAR_OF_PASSING)       { missing("Year of Passing"); return; }

    // ---- Work Details ----
    if (!form.JOINING_DATE)          { missing("Joining Date"); return; }

    // ---- Bank & Identity (payroll) ----
    if (!form.BANK_ACCOUNT_NUMBER.trim())   { missing("Bank Account Number"); return; }
    if (!form.BANK_NAME.trim())             { missing("Bank Name"); return; }
    if (!form.IFSC_CODE.trim())             { missing("IFSC Code"); return; }
    if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.IFSC_CODE.trim().toUpperCase())) {
      raise("IFSC Code format is invalid (e.g. HDFC0001234).");
      return;
    }
    if (!form.PAN_NUMBER.trim())            { missing("PAN Number"); return; }
    if (!/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.PAN_NUMBER.trim().toUpperCase())) {
      raise("PAN format is invalid (e.g. ABCDE1234F).");
      return;
    }
    if (!form.AADHAAR_NUMBER.trim())        { missing("Aadhaar Number"); return; }
    if (form.AADHAAR_NUMBER.trim().length !== 12) {
      raise("Aadhaar Number must be 12 digits.");
      return;
    }

    // ---- Required documents (5 mandatory slots) ----
    const uploadedTypes = new Set(docs.map((d) => (d.DOC_TYPE || "").toUpperCase()));
    for (const slot of REQUIRED_DOC_SLOTS) {
      if (!slot.required) continue;
      const hasAny = slot.types.some((t) => uploadedTypes.has(t));
      if (!hasAny) {
        raise(`Please upload: ${slot.label}.`);
        return;
      }
    }

    setConfirmOpen(true);
  };

  const confirmSubmit = async () => {
    setConfirmOpen(false);
    setSaving(true);
    try {
      const payload = {
        ...form,
        // Dates → null if empty (backend expects date or null, not "")
        DOB: form.DOB || null,
        JOINING_DATE: form.JOINING_DATE || null,
        // Numeric coercions
        YEAR_OF_PASSING: form.YEAR_OF_PASSING ? Number(form.YEAR_OF_PASSING) : null,
        EXPERIENCE_YEARS: Number(form.EXPERIENCE_YEARS) || 0,
        PERCENTAGE: form.PERCENTAGE === "" || form.PERCENTAGE == null
          ? null
          : Number(form.PERCENTAGE),
        // Uppercase codes so IFSC / PAN / Aadhaar match validation
        IFSC_CODE: (form.IFSC_CODE || "").trim().toUpperCase(),
        PAN_NUMBER: (form.PAN_NUMBER || "").trim().toUpperCase()
      };

      const code = employee.EMPLOYEE_CODE;
      await API.post(`/employees/by-code/${encodeURIComponent(code)}/submit-profile`, payload);

      if (photoFile) {
        try {
          const fd = new FormData();
          fd.append("file", photoFile);
          await API.post(`/employees/${employee.ID}/upload-photo`, fd, {
            headers: { "Content-Type": "multipart/form-data" }
          });
        } catch (photoErr) {
          console.warn("Photo upload failed:", photoErr);
        }
      }

      onSubmitted?.();
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to submit profile");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.formWrapper}>

        {/* Welcome hero */}
        <div className={styles.hero}>
          <div className={styles.heroRing} />

          {/* Actions row sits at the top so on narrow screens the
              buttons never overlap the title. Desktop CSS floats it
              to the top-right; mobile CSS lets it wrap below the
              text. */}
          <div className={styles.heroActions}>
            <button
              type="button"
              onClick={() => window.__profileGreet && window.__profileGreet()}
              className={styles.greetBtn}
              title="Hear welcome message"
              aria-label="Hear welcome message"
            >
              {Icons.speaker} <span>Play welcome</span>
            </button>
            <button onClick={onLogout} className={styles.logoutBtn}>
              {Icons.logout} <span>Logout</span>
            </button>
          </div>

          <div className={styles.heroEyebrow}>BVC24 · ONE-TIME REGISTRATION</div>
          <h1 className={styles.heroTitle}>
            Welcome, {employee.NAME || employee.EMPLOYEE_CODE}!
          </h1>
          <div className={styles.heroDesc}>
            Please fill in your personal and work details below.
            This is a <b>one-time submission</b> — after you save,
            only admin can change these details.
            Verify everything carefully before submitting.
          </div>
        </div>

        {error && (
          <div className={styles.errorBanner}>{Icons.alert}<span>{error}</span></div>
        )}

        <form onSubmit={submit}>

          {/* Admin-set basics (locked) */}
          <Section icon={Icons.identity} title="Identity (set by Admin)">
            <div className={styles.grid3}>
              <Field label="Employee Code">
                <input type="text" value={employee.EMPLOYEE_CODE || ""} readOnly
                  className={`${styles.input} ${styles.inputReadonly}`} />
              </Field>
              <Field label="Role">
                <input type="text" value={employee.ROLE?.NAME || "—"} readOnly
                  className={`${styles.input} ${styles.inputReadonly}`} />
              </Field>
              <Field label="Department">
                <input type="text" value={employee.DEPARTMENT?.NAME || "—"} readOnly
                  className={`${styles.input} ${styles.inputReadonly}`} />
              </Field>
              <Field label="Designation">
                <input type="text" value={employee.DESIGNATION?.TITLE || "—"} readOnly
                  className={`${styles.input} ${styles.inputReadonly}`} />
              </Field>
            </div>
          </Section>

          {/* Photo */}
          <Section icon={Icons.camera} title="Profile Photo">
            <div className={styles.photoRow}>
              <div
                className={styles.avatar}
                style={photoPreview ? { backgroundImage: `url(${photoPreview})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
              >
                {!photoPreview && (employee.NAME || "?").charAt(0).toUpperCase()}
              </div>
              <div className={styles.photoInputWrapper}>
                <input type="file" accept="image/*" onChange={handlePhoto} className={styles.fileInput} />
                <div className={styles.photoHint}>
                  PNG / JPG. Will appear on your profile card across the ERP.
                </div>
              </div>
            </div>
          </Section>

          {/* Personal Information */}
          <Section icon={Icons.user} title="Personal Information">
            <div className={styles.grid2}>
              <Field label="Full Name *">
                <input type="text" value={form.NAME} onChange={set("NAME")} className={styles.input} required />
              </Field>
              <Field label="Date of Birth">
                <input type="date" value={form.DOB} onChange={set("DOB")} className={styles.input} />
              </Field>
              <Field label="Father's Name">
                <input type="text" value={form.FATHER_NAME} onChange={set("FATHER_NAME")} className={styles.input} />
              </Field>
              <Field label="Mother's Name">
                <input type="text" value={form.MOTHER_NAME} onChange={set("MOTHER_NAME")} className={styles.input} />
              </Field>
              <Field label="Gender">
                <select value={form.GENDER} onChange={set("GENDER")} className={styles.input}>
                  <option value="">— pick —</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Marital Status">
                <select value={form.MARITAL_STATUS} onChange={set("MARITAL_STATUS")} className={styles.input}>
                  <option value="">— pick —</option>
                  <option value="SINGLE">Single</option>
                  <option value="MARRIED">Married</option>
                  <option value="DIVORCED">Divorced</option>
                  <option value="WIDOWED">Widowed</option>
                </select>
              </Field>
              <Field label="Occupation">
                <input type="text" value={form.OCCUPATION} onChange={set("OCCUPATION")} className={styles.input} placeholder="e.g. Mechanical Technician" />
              </Field>
              <Field label="Blood Group">
                <select value={form.BLOOD_GROUP} onChange={set("BLOOD_GROUP")} className={styles.input}>
                  <option value="">— pick —</option>
                  {["A+", "A-", "B+", "B-", "O+", "O-", "AB+", "AB-"].map((b) => (
                    <option key={b} value={b}>{b}</option>
                  ))}
                </select>
              </Field>
              <Field label="Nationality">
                <input type="text" value={form.NATIONALITY} onChange={set("NATIONALITY")} className={styles.input} placeholder="Indian" />
              </Field>
              <Field label="Emergency Contact Name">
                <input type="text" value={form.EMERGENCY_CONTACT_NAME} onChange={set("EMERGENCY_CONTACT_NAME")} className={styles.input} placeholder="Spouse / Parent / Sibling" />
              </Field>
              <Field label="Emergency Contact Phone">
                <input
                  type="tel"
                  inputMode="numeric"
                  maxLength={10}
                  value={form.EMERGENCY_CONTACT_PHONE}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    EMERGENCY_CONTACT_PHONE: e.target.value.replace(/\D/g, "").slice(0, 10)
                  }))}
                  className={styles.input}
                  placeholder="9876543210"
                />
              </Field>
              <Field label="Emergency Contact Relationship">
                <input type="text" value={form.EMERGENCY_CONTACT_RELATION} onChange={set("EMERGENCY_CONTACT_RELATION")} className={styles.input} placeholder="Father / Mother / Spouse / Sibling" />
              </Field>
            </div>
          </Section>

          {/* Contact + Address */}
          <Section icon={Icons.phone} title="Contact & Address">
            <div className={styles.grid2}>
              <Field label="Phone *">
                <input type="text" value={form.PHONE} onChange={set("PHONE")} className={styles.input} required />
              </Field>
              <Field label="Email *">
                <input type="email" value={form.EMAIL} onChange={set("EMAIL")} className={styles.input} required />
              </Field>
              <Field label="Address (Street / House No)">
                <input type="text" value={form.ADDRESS} onChange={set("ADDRESS")} className={styles.input} />
              </Field>
              <Field label="City">
                <input type="text" value={form.CITY} onChange={set("CITY")} className={styles.input} />
              </Field>
              <Field label="State">
                <input type="text" value={form.STATE} onChange={set("STATE")} className={styles.input} />
              </Field>
              <Field label="Pincode">
                <input type="text" value={form.PINCODE} onChange={set("PINCODE")} className={styles.input} />
              </Field>
            </div>
          </Section>

          {/* Education */}
          <Section icon={Icons.graduation} title="Educational Background">
            <div className={styles.gridEdu}>
              <Field label="Qualification">
                <input type="text" value={form.QUALIFICATION} onChange={set("QUALIFICATION")} className={styles.input} placeholder="e.g. BE Mechanical, Diploma in EEE" />
              </Field>
              <Field label="Year of Passing">
                <input type="number" min="1950" max="2099" value={form.YEAR_OF_PASSING} onChange={set("YEAR_OF_PASSING")} className={styles.input} />
              </Field>
            </div>
            <div className={styles.spacer} />
            <div className={styles.grid2}>
              <Field label="College">
                <input type="text" value={form.COLLEGE} onChange={set("COLLEGE")} className={styles.input} placeholder="e.g. PSG College of Technology" />
              </Field>
              <Field label="University">
                <input type="text" value={form.UNIVERSITY} onChange={set("UNIVERSITY")} className={styles.input} placeholder="e.g. Anna University" />
              </Field>
              <Field label="Percentage / CGPA">
                <input type="number" min="0" max="100" step="0.01" value={form.PERCENTAGE} onChange={set("PERCENTAGE")} className={styles.input} placeholder="e.g. 85.5" />
              </Field>
            </div>
          </Section>

          {/* Professional */}
          <Section icon={Icons.briefcase} title="Professional / Experience">
            <div className={styles.grid21}>
              <Field label="Employment Type">
                <select value={form.EMPLOYMENT_TYPE} onChange={set("EMPLOYMENT_TYPE")} className={styles.input}>
                  <option value="FRESHER">Fresher</option>
                  <option value="EXPERIENCED">Experienced</option>
                  <option value="INTERN">Intern</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </Field>
              <Field label="Total Experience (years)">
                <input type="number" min="0" step="0.1" value={form.EXPERIENCE_YEARS} onChange={set("EXPERIENCE_YEARS")} className={styles.input} />
              </Field>
            </div>

            <Field label="Previous Company">
              <input type="text" value={form.PREVIOUS_COMPANY} onChange={set("PREVIOUS_COMPANY")} className={styles.input} placeholder="e.g. ABC Manufacturing Pvt Ltd" />
            </Field>

            <div className={styles.spacer} />

            <Field label="Skills" hint="Comma-separated (e.g. welding, assembly, electrical wiring)">
              <input type="text" value={form.SKILLS} onChange={set("SKILLS")} className={styles.input} />
            </Field>

            <div className={styles.spacer} />

            <Field label="Work Experience Details">
              <textarea rows={4} value={form.EXPERIENCE_DETAILS} onChange={set("EXPERIENCE_DETAILS")} className={`${styles.input} ${styles.textarea}`} placeholder="Previous company names, roles, durations..." />
            </Field>

            <div className={styles.spacer} />

            <Field label="Past Projects">
              <textarea rows={3} value={form.PAST_PROJECTS} onChange={set("PAST_PROJECTS")} className={`${styles.input} ${styles.textarea}`} placeholder="Major projects you've worked on..." />
            </Field>
          </Section>

          {/* Work Details — matches admin's Organization Assignment
              minus Role/Department/Designation which are admin-only. */}
          <Section icon={Icons.building} title="Work Details">
            <div className={styles.grid2}>
              <Field label="Joining Date">
                <input type="date" value={form.JOINING_DATE} onChange={set("JOINING_DATE")} className={styles.input} />
              </Field>
              <Field label="Work Location">
                <input type="text" value={form.WORK_LOCATION} onChange={set("WORK_LOCATION")} className={styles.input} placeholder="Coimbatore HQ / Chennai Site / Remote" />
              </Field>
            </div>
          </Section>

          {/* Bank & Identity (payroll) — required for salary transfer
              and statutory records. Aadhaar/PAN are stored securely. */}
          <Section icon={Icons.bank} title="Bank & Identity (Payroll)">
            <div className={styles.grid2}>
              <Field label="Bank Account Number">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.BANK_ACCOUNT_NUMBER}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    BANK_ACCOUNT_NUMBER: e.target.value.replace(/\D/g, "").slice(0, 20)
                  }))}
                  className={styles.input}
                  placeholder="e.g. 50100123456789"
                />
              </Field>
              <Field label="Bank Name">
                <input type="text" value={form.BANK_NAME} onChange={set("BANK_NAME")} className={styles.input} placeholder="e.g. HDFC Bank" />
              </Field>
              <Field label="IFSC Code" hint="Format: 4 letters + 0 + 6 alphanumeric (e.g. HDFC0001234)">
                <input
                  type="text"
                  value={form.IFSC_CODE}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    IFSC_CODE: e.target.value.toUpperCase().slice(0, 11)
                  }))}
                  className={styles.input}
                  placeholder="HDFC0001234"
                />
              </Field>
              <Field label="PAN Number" hint="Format: 5 letters + 4 digits + 1 letter">
                <input
                  type="text"
                  value={form.PAN_NUMBER}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    PAN_NUMBER: e.target.value.toUpperCase().slice(0, 10)
                  }))}
                  className={styles.input}
                  placeholder="ABCDE1234F"
                />
              </Field>
              <Field label="Aadhaar Number" hint="12 digits">
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.AADHAAR_NUMBER}
                  onChange={(e) => setForm((f) => ({
                    ...f,
                    AADHAAR_NUMBER: e.target.value.replace(/\D/g, "").slice(0, 12)
                  }))}
                  className={styles.input}
                  placeholder="123456789012"
                />
              </Field>
            </div>
          </Section>

          {/* Documents */}
          <Section icon={Icons.paperclip} title="Documents">

            <div className={styles.docHint}>
              Upload the following required documents. Each row accepts
              multiple files (PDF or image, JPG / PNG). Max {MAX_DOC_MB} MB per file.
            </div>

            {/* Six required document slots. Each shows a status pill
                (Uploaded / Missing), a multi-file picker, and the list
                of files that have already been uploaded for that slot. */}
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {REQUIRED_DOC_SLOTS.map((slot) => {
                const filesInSlot = docs.filter((d) => slot.types.includes(d.DOC_TYPE));
                const uploaded   = filesInSlot.length > 0;
                const inputId    = `doc-slot-${slot.key}`;

                return (
                  <div
                    key={slot.key}
                    style={{
                      border: uploaded
                        ? "1px solid #bbf7d0"
                        : (slot.required ? "1px solid #fecaca" : "1px solid #e5e7eb"),
                      background: uploaded
                        ? "#f0fdf4"
                        : (slot.required ? "#fef2f2" : "#f8fafc"),
                      borderRadius: 10,
                      padding: "12px 14px"
                    }}
                  >
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      flexWrap: "wrap"
                    }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{
                          fontSize: 13.5,
                          fontWeight: 700,
                          color: "#0f172a"
                        }}>
                          {slot.label}
                          {slot.required && (
                            <span style={{ color: "#dc2626", marginLeft: 4 }}>*</span>
                          )}
                        </div>
                        <div style={{
                          fontSize: 12,
                          color: "#64748b",
                          marginTop: 2
                        }}>
                          {slot.hint}
                        </div>
                      </div>

                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10
                      }}>
                        <span style={{
                          fontSize: 11,
                          fontWeight: 700,
                          padding: "3px 8px",
                          borderRadius: 999,
                          background: uploaded ? "#dcfce7" : "#fee2e2",
                          color: uploaded ? "#166534" : "#991b1b",
                          textTransform: "uppercase",
                          letterSpacing: 0.4,
                          whiteSpace: "nowrap"
                        }}>
                          {uploaded
                            ? `${filesInSlot.length} file${filesInSlot.length === 1 ? "" : "s"}`
                            : (slot.required ? "Required" : "Optional")}
                        </span>

                        <label
                          htmlFor={inputId}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 6,
                            padding: "7px 14px",
                            borderRadius: 8,
                            background: "#0f172a",
                            color: "#ffffff",
                            fontSize: 13,
                            fontWeight: 600,
                            cursor: docBusy ? "not-allowed" : "pointer",
                            opacity: docBusy ? 0.6 : 1,
                            whiteSpace: "nowrap"
                          }}
                        >
                          {Icons.paperclip}
                          <span>Upload Files</span>
                        </label>
                        <input
                          id={inputId}
                          type="file"
                          multiple
                          accept=".pdf,image/*"
                          disabled={docBusy}
                          onChange={(e) => handleSlotPick(slot, e)}
                          style={{ display: "none" }}
                        />
                      </div>
                    </div>

                    {/* Files uploaded for this slot */}
                    {uploaded && (
                      <ul style={{
                        listStyle: "none",
                        padding: 0,
                        margin: "10px 0 0",
                        display: "flex",
                        flexDirection: "column",
                        gap: 4
                      }}>
                        {filesInSlot.map((d) => {
                          const id = d.ID || d.id;
                          return (
                            <li
                              key={id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                gap: 8,
                                fontSize: 12.5,
                                background: "#ffffff",
                                border: "1px solid #d1fadf",
                                borderRadius: 6,
                                padding: "6px 10px"
                              }}
                            >
                              <span style={{
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap"
                              }}>
                                {d.TITLE || d.FILE_NAME || "Untitled"}
                              </span>
                              <button
                                type="button"
                                onClick={() => removeDoc(id)}
                                style={{
                                  border: "none",
                                  background: "transparent",
                                  color: "#b91c1c",
                                  fontSize: 12,
                                  fontWeight: 600,
                                  cursor: "pointer"
                                }}
                              >
                                Remove
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            {docError && (
              <div className={styles.errorBanner} style={{ marginTop: 12 }}>
                {Icons.alert}
                <span>{docError}</span>
              </div>
            )}
            {docBusy && (
              <div className={styles.fieldHint} style={{ marginTop: 8 }}>
                Uploading…
              </div>
            )}

            {/* Optional — legacy "any other document" picker, kept so the
                employee can still attach an offer letter, address proof,
                or anything not covered by the six required slots. Now
                supports selecting multiple files at once. */}
            <details style={{ marginTop: 18 }}>
              <summary style={{
                cursor: "pointer",
                fontSize: 13,
                fontWeight: 600,
                color: "#334155"
              }}>
                Add another document (optional)
              </summary>
              <div className={styles.docUploadRow} style={{ marginTop: 10 }}>
                <Field label="Document Type">
                  <select
                    value={docType}
                    onChange={(e) => setDocType(e.target.value)}
                    className={styles.input}
                  >
                    {DOC_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                </Field>

                <Field label="Title (optional)">
                  <input
                    type="text"
                    value={docTitle}
                    onChange={(e) => setDocTitle(e.target.value)}
                    className={styles.input}
                    placeholder="e.g. Address proof — utility bill"
                  />
                </Field>

                <Field label="Files (multiple allowed)">
                  <input
                    ref={docInputRef}
                    type="file"
                    multiple
                    accept=".pdf,image/*"
                    onChange={handleDocPick}
                    disabled={docBusy}
                    className={styles.input}
                  />
                </Field>
              </div>
            </details>
          </Section>

          {/* Additional */}
          <Section icon={Icons.note} title="Additional Information">
            <Field label="Notes / Anything else we should know">
              <textarea rows={3} value={form.NOTES} onChange={set("NOTES")} className={`${styles.input} ${styles.textarea}`} />
            </Field>
          </Section>

          {/* Submit */}
          <div className={styles.submitBar}>
            <div className={styles.submitWarning}>
              {Icons.alert}
              <span>
                Once you submit, you <b>cannot</b> edit this form again.
                Only admin can change your details after submission.
              </span>
            </div>
            <button type="submit" disabled={saving} className={styles.submitBtn}>
              {saving
                ? "Submitting…"
                : (<>{Icons.check}<span>Submit My Profile</span></>)}
            </button>
          </div>

        </form>

      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit your profile?"
        message="Are you sure you want to submit the form? Once submitted you cannot edit it again — only admin can change your details."
        confirmLabel="Yes, submit"
        cancelLabel="Keep editing"
        onCancel={() => setConfirmOpen(false)}
        onConfirm={confirmSubmit}
      />

    </div>
  );
}


export default EmployeeProfileForm;
