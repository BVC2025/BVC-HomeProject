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
    CONFIRMATION_DATE: employee.CONFIRMATION_DATE || "",
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
        // Dates → null if empty (backend expects date or null, not "")
        DOB: form.DOB || null,
        CONFIRMATION_DATE: form.CONFIRMATION_DATE || null,
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
          <Section icon="🏢" title="Work Details">
            <div className={styles.grid2}>
              <Field label="Confirmation Date (probation end)">
                <input type="date" value={form.CONFIRMATION_DATE} onChange={set("CONFIRMATION_DATE")} className={styles.input} />
              </Field>
              <Field label="Work Location">
                <input type="text" value={form.WORK_LOCATION} onChange={set("WORK_LOCATION")} className={styles.input} placeholder="Coimbatore HQ / Chennai Site / Remote" />
              </Field>
            </div>
          </Section>

          {/* Bank & Identity (payroll) — required for salary transfer
              and statutory records. Aadhaar/PAN are stored securely. */}
          <Section icon="🏦" title="Bank & Identity (Payroll)">
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
