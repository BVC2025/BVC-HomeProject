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
    NAME: employee.NAME || "",
    EMAIL: employee.EMAIL || "",
    PHONE: employee.PHONE || "",
    DOB: employee.DOB || "",
    GENDER: employee.GENDER || "",
    FATHER_NAME: employee.FATHER_NAME || "",
    MOTHER_NAME: employee.MOTHER_NAME || "",
    MARITAL_STATUS: employee.MARITAL_STATUS || "",
    OCCUPATION: employee.OCCUPATION || "",
    ADDRESS: employee.ADDRESS || "",
    CITY: employee.CITY || "",
    STATE: employee.STATE || "Tamil Nadu",
    PINCODE: employee.PINCODE || "",
    QUALIFICATION: employee.QUALIFICATION || "",
    YEAR_OF_PASSING: employee.YEAR_OF_PASSING || "",
    EMPLOYMENT_TYPE: employee.EMPLOYMENT_TYPE || "FRESHER",
    EXPERIENCE_YEARS: employee.EXPERIENCE_YEARS || 0,
    SKILLS: employee.SKILLS || "",
    EXPERIENCE_DETAILS: employee.EXPERIENCE_DETAILS || "",
    PAST_PROJECTS: employee.PAST_PROJECTS || "",
    NOTES: employee.NOTES || ""
  });

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  // ---- Documents ----
  // Uploaded IMMEDIATELY (not deferred to submit). If the employee
  // closes the browser mid-form, their IDs are already saved on
  // the server via the /employees/{id}/documents endpoint.
  const [docType, setDocType] = useState(DOC_TYPES[0].value);
  const [docTitle, setDocTitle] = useState("");
  const [docBusy, setDocBusy] = useState(false);
  const [docError, setDocError] = useState("");
  const [docs, setDocs] = useState([]);
  const docInputRef = useRef(null);

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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleDocPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_DOC_MB * 1024 * 1024) {
      setDocError(`File must be under ${MAX_DOC_MB} MB.`);
      if (docInputRef.current) docInputRef.current.value = "";
      return;
    }
    setDocBusy(true);
    setDocError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", docType);
      fd.append("title", docTitle || file.name);
      const res = await API.post(
        `/employees/${encodeURIComponent(employee.ID)}/documents`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const newDoc = res.data?.document || res.data;
      if (newDoc) setDocs((prev) => [newDoc, ...prev]);
      setDocTitle("");
    } catch (err) {
      setDocError(
        err?.response?.data?.detail ||
        err?.message ||
        "Upload failed."
      );
    } finally {
      setDocBusy(false);
      if (docInputRef.current) docInputRef.current.value = "";
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
  const submit = (e) => {
    e?.preventDefault?.();
    setError("");

    if (!form.NAME.trim()) { setError("Name is required."); return; }
    if (!form.PHONE.trim() || !form.EMAIL.trim()) {
      setError("Phone and Email are required.");
      return;
    }

    setConfirmOpen(true);
  };

  const confirmSubmit = async () => {
    setConfirmOpen(false);
    setSaving(true);
    try {
      const payload = {
        ...form,
        DOB: form.DOB || null,
        YEAR_OF_PASSING: form.YEAR_OF_PASSING ? Number(form.YEAR_OF_PASSING) : null,
        EXPERIENCE_YEARS: Number(form.EXPERIENCE_YEARS) || 0
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
          <button onClick={onLogout} className={styles.logoutBtn}>
            {Icons.logout} <span>Logout</span>
          </button>
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

          {/* Documents */}
          <Section icon={Icons.paperclip} title="Documents">
            <div className={styles.docHint}>
              Upload your Resume, Aadhaar, PAN and any other required ID
              proofs. PDF or image (JPG / PNG). Max {MAX_DOC_MB} MB per file.
            </div>

            <div className={styles.docUploadRow}>
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
                  placeholder="e.g. Aadhaar front side"
                />
              </Field>

              <Field label="File">
                <input
                  ref={docInputRef}
                  type="file"
                  accept=".pdf,image/*"
                  onChange={handleDocPick}
                  disabled={docBusy}
                  className={styles.input}
                />
              </Field>
            </div>

            {docError && (
              <div className={styles.errorBanner}>{Icons.alert}<span>{docError}</span></div>
            )}
            {docBusy && (
              <div className={styles.fieldHint}>Uploading…</div>
            )}

            {docs.length > 0 && (
              <ul className={styles.docList}>
                {docs.map((d) => {
                  const id = d.ID || d.id;
                  const typeLbl =
                    DOC_TYPES.find((t) => t.value === d.DOC_TYPE)?.label
                    || d.DOC_TYPE
                    || "Other";
                  return (
                    <li key={id} className={styles.docItem}>
                      <span className={styles.docType}>{typeLbl}</span>
                      <span className={styles.docTitle}>
                        {d.TITLE || d.FILE_NAME || "Untitled"}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeDoc(id)}
                        className={styles.docRemove}
                      >
                        Remove
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
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
