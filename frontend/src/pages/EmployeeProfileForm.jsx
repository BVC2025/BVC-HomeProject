import { useState } from "react";

import API from "../services/api";
import styles from "./EmployeeProfileForm.module.css";


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
      <div className={styles.sectionHeader}>{icon} {title}</div>
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

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handlePhoto = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPhotoPreview(ev.target.result);
    reader.readAsDataURL(file);
  };

  const submit = async (e) => {
    e?.preventDefault?.();
    setError("");

    if (!form.NAME.trim()) { setError("Name is required."); return; }
    if (!form.PHONE.trim() || !form.EMAIL.trim()) {
      setError("Phone and Email are required.");
      return;
    }

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
            ⏻ Logout
          </button>
        </div>

        {error && (
          <div className={styles.errorBanner}>⚠ {error}</div>
        )}

        <form onSubmit={submit}>

          {/* Admin-set basics (locked) */}
          <Section icon="🪪" title="Identity (set by Admin)">
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
          <Section icon="📷" title="Profile Photo">
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
          <Section icon="👤" title="Personal Information">
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
          <Section icon="📞" title="Contact & Address">
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
          <Section icon="🎓" title="Educational Background">
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
          <Section icon="💼" title="Professional / Experience">
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

          {/* Additional */}
          <Section icon="📝" title="Additional Information">
            <Field label="Notes / Anything else we should know">
              <textarea rows={3} value={form.NOTES} onChange={set("NOTES")} className={`${styles.input} ${styles.textarea}`} />
            </Field>
          </Section>

          {/* Submit */}
          <div className={styles.submitBar}>
            <div className={styles.submitWarning}>
              ⚠ Once you submit, you <b>cannot</b> edit this form again.
              Only admin can change your details after submission.
            </div>
            <button type="submit" disabled={saving} className={styles.submitBtn}>
              {saving ? "Submitting…" : "✓ Submit My Profile"}
            </button>
          </div>

        </form>

      </div>
    </div>
  );
}


export default EmployeeProfileForm;
