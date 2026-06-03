import { useEffect, useState } from "react";

import API from "../services/api";


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


function field() {

  return {
    width: "100%",
    padding: "10px 12px",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    fontSize: 13,
    fontFamily: "inherit",
    background: "white"
  };
}

function readonly() {

  return {
    ...field(),
    background: "#f1f5f9",
    color: "#475569",
    cursor: "not-allowed"
  };
}


function Field({ label, children, hint }) {

  return (
    <div>
      <label style={{
        fontSize: 11, color: "#64748b", fontWeight: 700,
        letterSpacing: 0.5, marginBottom: 4, display: "block",
        textTransform: "uppercase"
      }}>
        {label}
      </label>
      {children}
      {hint && (
        <div style={{ fontSize: 10, color: "#94a3b8", marginTop: 4 }}>
          {hint}
        </div>
      )}
    </div>
  );
}


function Section({ icon, title, children }) {

  return (
    <div style={{
      background: "white",
      borderRadius: 14,
      padding: 22,
      marginBottom: 18,
      boxShadow: "0 6px 20px rgba(15,23,42,0.06)"
    }}>
      <div style={{
        fontSize: 12,
        fontWeight: 800,
        color: "#4338ca",
        letterSpacing: 1.6,
        textTransform: "uppercase",
        marginBottom: 16,
        paddingBottom: 10,
        borderBottom: "2px solid #e2e8f0"
      }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}


function EmployeeProfileForm({ employee, onSubmitted, onLogout }) {

  // Pre-fill from the existing employee record so admin-entered
  // basics (NAME / ROLE / DEPT) are visible.
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

  const set = (k) => (e) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

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

    if (!form.NAME.trim()) {

      setError("Name is required.");

      return;
    }

    if (!form.PHONE.trim() || !form.EMAIL.trim()) {

      setError("Phone and Email are required.");

      return;
    }

    setSaving(true);

    try {

      const payload = {
        ...form,
        DOB: form.DOB || null,
        YEAR_OF_PASSING: form.YEAR_OF_PASSING
          ? Number(form.YEAR_OF_PASSING)
          : null,
        EXPERIENCE_YEARS: Number(form.EXPERIENCE_YEARS) || 0
      };

      const code = employee.EMPLOYEE_CODE;

      await API.post(
        `/employees/by-code/${encodeURIComponent(code)}/submit-profile`,
        payload
      );

      // Upload photo separately if present
      if (photoFile) {

        try {

          const fd = new FormData();

          fd.append("file", photoFile);

          await API.post(
            `/employees/${employee.ID}/upload-photo`,
            fd,
            { headers: { "Content-Type": "multipart/form-data" } }
          );

        } catch (photoErr) {

          // Non-fatal — profile is saved either way
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

    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #f1f5f9 0%, #e0e7ff 100%)",
      padding: "30px 24px"
    }}>

      <div style={{ maxWidth: 980, margin: "0 auto" }}>

        {/* Welcome hero */}
        <div style={{
          background: "linear-gradient(135deg, #C8102E, #E63946, #F4B324)",
          color: "white",
          borderRadius: 18,
          padding: "30px 32px",
          marginBottom: 22,
          boxShadow: "0 14px 40px rgba(99,102,241,0.35)",
          position: "relative",
          overflow: "hidden"
        }}>

          <div style={{
            position: "absolute", right: -60, top: -60,
            width: 220, height: 220, borderRadius: "50%",
            background: "rgba(255,255,255,0.1)"
          }} />

          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 2.5,
            opacity: 0.9, marginBottom: 6
          }}>
            BVC24 · ONE-TIME REGISTRATION
          </div>

          <h1 style={{
            fontSize: 30, fontWeight: 900, margin: 0,
            lineHeight: 1.15, letterSpacing: -0.5
          }}>
            Welcome, {employee.NAME || employee.EMPLOYEE_CODE}!
          </h1>

          <div style={{ fontSize: 14, opacity: 0.9, marginTop: 10, maxWidth: 700 }}>
            Please fill in your personal and work details below.
            This is a <b>one-time submission</b> — after you save,
            only admin can change these details.
            Verify everything carefully before submitting.
          </div>

          <button
            onClick={onLogout}
            style={{
              position: "absolute", top: 16, right: 18,
              background: "rgba(255,255,255,0.2)",
              border: "1px solid rgba(255,255,255,0.4)",
              color: "white", padding: "6px 14px",
              borderRadius: 8, fontSize: 12, fontWeight: 700,
              cursor: "pointer"
            }}
          >
            ⏻ Logout
          </button>
        </div>

        {error && (
          <div style={{
            background: "#fef2f2", border: "1px solid #fecaca",
            color: "#b91c1c", padding: "12px 16px", borderRadius: 10,
            marginBottom: 16, fontWeight: 600
          }}>
            ⚠ {error}
          </div>
        )}

        <form onSubmit={submit}>

          {/* Admin-set basics (locked) */}
          <Section icon="🪪" title="Identity (set by Admin)">
            <div style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 14
            }}>
              <Field label="Employee Code">
                <input
                  type="text"
                  value={employee.EMPLOYEE_CODE || ""}
                  readOnly
                  style={readonly()}
                />
              </Field>
              <Field label="Role">
                <input
                  type="text"
                  value={employee.ROLE?.NAME || "—"}
                  readOnly
                  style={readonly()}
                />
              </Field>
              <Field label="Department">
                <input
                  type="text"
                  value={employee.DEPARTMENT?.NAME || "—"}
                  readOnly
                  style={readonly()}
                />
              </Field>
              <Field label="Designation">
                <input
                  type="text"
                  value={employee.DESIGNATION?.TITLE || "—"}
                  readOnly
                  style={readonly()}
                />
              </Field>
            </div>
          </Section>

          {/* Photo */}
          <Section icon="📷" title="Profile Photo">
            <div style={{ display: "flex", alignItems: "center", gap: 18 }}>

              <div style={{
                width: 100, height: 100, borderRadius: "50%",
                background: photoPreview
                  ? `url(${photoPreview}) center/cover`
                  : "linear-gradient(135deg, #818cf8, #c084fc)",
                color: "white", display: "flex", alignItems: "center",
                justifyContent: "center", fontSize: 28, fontWeight: 800,
                boxShadow: "0 8px 24px rgba(99,102,241,0.3)"
              }}>
                {!photoPreview && (employee.NAME || "?").charAt(0).toUpperCase()}
              </div>

              <div style={{ flex: 1 }}>
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePhoto}
                  style={{ fontSize: 13 }}
                />
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 6 }}>
                  PNG / JPG. Will appear on your profile card across the ERP.
                </div>
              </div>
            </div>
          </Section>

          {/* Personal Information */}
          <Section icon="👤" title="Personal Information">
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14
            }}>
              <Field label="Full Name *">
                <input type="text" value={form.NAME} onChange={set("NAME")} style={field()} required />
              </Field>
              <Field label="Date of Birth">
                <input type="date" value={form.DOB} onChange={set("DOB")} style={field()} />
              </Field>
              <Field label="Father's Name">
                <input type="text" value={form.FATHER_NAME} onChange={set("FATHER_NAME")} style={field()} />
              </Field>
              <Field label="Mother's Name">
                <input type="text" value={form.MOTHER_NAME} onChange={set("MOTHER_NAME")} style={field()} />
              </Field>
              <Field label="Gender">
                <select value={form.GENDER} onChange={set("GENDER")} style={field()}>
                  <option value="">— pick —</option>
                  <option value="MALE">Male</option>
                  <option value="FEMALE">Female</option>
                  <option value="OTHER">Other</option>
                  <option value="PREFER_NOT_TO_SAY">Prefer not to say</option>
                </select>
              </Field>
              <Field label="Marital Status">
                <select value={form.MARITAL_STATUS} onChange={set("MARITAL_STATUS")} style={field()}>
                  <option value="">— pick —</option>
                  <option value="SINGLE">Single</option>
                  <option value="MARRIED">Married</option>
                  <option value="DIVORCED">Divorced</option>
                  <option value="WIDOWED">Widowed</option>
                </select>
              </Field>
              <Field label="Occupation">
                <input type="text" value={form.OCCUPATION} onChange={set("OCCUPATION")} style={field()} placeholder="e.g. Mechanical Technician" />
              </Field>
            </div>
          </Section>

          {/* Contact + Address */}
          <Section icon="📞" title="Contact & Address">
            <div style={{
              display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 14
            }}>
              <Field label="Phone *">
                <input type="text" value={form.PHONE} onChange={set("PHONE")} style={field()} required />
              </Field>
              <Field label="Email *">
                <input type="email" value={form.EMAIL} onChange={set("EMAIL")} style={field()} required />
              </Field>
              <Field label="Address (Street / House No)" >
                <input type="text" value={form.ADDRESS} onChange={set("ADDRESS")} style={field()} />
              </Field>
              <Field label="City">
                <input type="text" value={form.CITY} onChange={set("CITY")} style={field()} />
              </Field>
              <Field label="State">
                <input type="text" value={form.STATE} onChange={set("STATE")} style={field()} />
              </Field>
              <Field label="Pincode">
                <input type="text" value={form.PINCODE} onChange={set("PINCODE")} style={field()} />
              </Field>
            </div>
          </Section>

          {/* Education */}
          <Section icon="🎓" title="Educational Background">
            <div style={{
              display: "grid", gridTemplateColumns: "2fr 1fr", gap: 14
            }}>
              <Field label="Qualification">
                <input type="text" value={form.QUALIFICATION} onChange={set("QUALIFICATION")} style={field()} placeholder="e.g. BE Mechanical, Diploma in EEE" />
              </Field>
              <Field label="Year of Passing">
                <input type="number" min="1950" max="2099" value={form.YEAR_OF_PASSING} onChange={set("YEAR_OF_PASSING")} style={field()} />
              </Field>
            </div>
          </Section>

          {/* Professional */}
          <Section icon="💼" title="Professional / Experience">
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, marginBottom: 14
            }}>
              <Field label="Employment Type">
                <select value={form.EMPLOYMENT_TYPE} onChange={set("EMPLOYMENT_TYPE")} style={field()}>
                  <option value="FRESHER">Fresher</option>
                  <option value="EXPERIENCED">Experienced</option>
                  <option value="INTERN">Intern</option>
                  <option value="CONTRACT">Contract</option>
                </select>
              </Field>
              <Field label="Total Experience (years)">
                <input type="number" min="0" step="0.1" value={form.EXPERIENCE_YEARS} onChange={set("EXPERIENCE_YEARS")} style={field()} />
              </Field>
            </div>

            <Field label="Skills" hint="Comma-separated (e.g. welding, assembly, electrical wiring)">
              <input type="text" value={form.SKILLS} onChange={set("SKILLS")} style={field()} />
            </Field>

            <div style={{ height: 14 }} />

            <Field label="Work Experience Details">
              <textarea
                rows={4}
                value={form.EXPERIENCE_DETAILS}
                onChange={set("EXPERIENCE_DETAILS")}
                style={{ ...field(), resize: "vertical" }}
                placeholder="Previous company names, roles, durations..."
              />
            </Field>

            <div style={{ height: 14 }} />

            <Field label="Past Projects">
              <textarea
                rows={3}
                value={form.PAST_PROJECTS}
                onChange={set("PAST_PROJECTS")}
                style={{ ...field(), resize: "vertical" }}
                placeholder="Major projects you've worked on..."
              />
            </Field>
          </Section>

          {/* Additional */}
          <Section icon="📝" title="Additional Information">
            <Field label="Notes / Anything else we should know">
              <textarea
                rows={3}
                value={form.NOTES}
                onChange={set("NOTES")}
                style={{ ...field(), resize: "vertical" }}
              />
            </Field>
          </Section>

          {/* Submit */}
          <div style={{
            background: "white", borderRadius: 14, padding: 22,
            boxShadow: "0 6px 20px rgba(15,23,42,0.06)",
            display: "flex", justifyContent: "space-between",
            alignItems: "center", flexWrap: "wrap", gap: 12
          }}>
            <div style={{ fontSize: 12, color: "#64748b", flex: 1, minWidth: 220 }}>
              ⚠ Once you submit, you <b>cannot</b> edit this form again.
              Only admin can change your details after submission.
            </div>

            <button
              type="submit"
              disabled={saving}
              style={{
                border: "none",
                background: saving
                  ? "#94a3b8"
                  : "linear-gradient(135deg, #C8102E, #E63946, #F4B324)",
                color: "white",
                padding: "12px 32px",
                borderRadius: 12,
                fontWeight: 800,
                fontSize: 14,
                cursor: saving ? "not-allowed" : "pointer",
                letterSpacing: 0.5,
                boxShadow: "0 8px 22px rgba(139,92,246,0.4)"
              }}
            >
              {saving ? "Submitting…" : "✓ Submit My Profile"}
            </button>
          </div>

        </form>

      </div>

    </div>
  );
}


export default EmployeeProfileForm;
