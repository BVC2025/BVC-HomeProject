// =====================================================================
// MyProfilePanel — comprehensive VIEW-ONLY employee profile.
// ---------------------------------------------------------------------
// Shown on the Employee Portal → "My Profile" tab. Displays every field
// the employee filled out during onboarding + all documents they've
// uploaded. NO edit / delete controls.
//
// Layout, top → bottom:
//   1. Hero band            — photo + name + code + status pills
//   2. Personal Info        — DOB, gender, blood group, marital, etc.
//   3. Contact Info         — email, phone, address
//   4. Emergency Contact
//   5. Job Info             — dept, designation, joining date, shift
//   6. Compensation & Bank
//   7. Government IDs       — PAN, Aadhaar (masked)
//   8. Education
//   9. Work Experience
//  10. Skills
//  11. Documents            — list, click to view/download
//
// Backend:
//   GET /employees/by-code/{code}           — full employee row
//   GET /employees/{id}/documents           — uploaded docs list
// Both are self-safe (assert_self_or_admin).
// =====================================================================

import { useEffect, useMemo, useState } from "react";

import API, { API_BASE_URL } from "../services/api";
import styles from "./MyProfilePanel.module.css";


// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------
function absoluteUrl(path) {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "2-digit", month: "short", year: "numeric",
  });
}

function fmtTime(iso) {
  if (!iso) return "—";
  // Backend returns times like "10:00:00". Take first 5 chars.
  const s = String(iso);
  if (/^\d{2}:\d{2}/.test(s)) return s.slice(0, 5);
  return s;
}

function fmtMoney(n) {
  if (n == null || n === "") return "—";
  const num = Number(n);
  if (Number.isNaN(num)) return "—";
  return "₹" + num.toLocaleString("en-IN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function fmtBytes(bytes) {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function maskAccount(num) {
  if (!num) return "—";
  const s = String(num);
  if (s.length <= 4) return s;
  return "X".repeat(s.length - 4) + s.slice(-4);
}

function maskAadhaar(num) {
  if (!num) return "—";
  const s = String(num).replace(/\s/g, "");
  if (s.length <= 4) return s;
  return "XXXX XXXX " + s.slice(-4);
}


// Document type labels for the documents list
const DOC_TYPE_LABELS = {
  AADHAAR: "Aadhaar",
  PAN: "PAN card",
  PASSPORT: "Passport",
  DRIVING_LICENSE: "Driving licence",
  VOTER_ID: "Voter ID",
  TENTH_MARKSHEET: "10th marksheet",
  TWELFTH_MARKSHEET: "12th marksheet",
  DIPLOMA: "Diploma",
  DEGREE: "Degree certificate",
  POSTGRADUATE: "PG certificate",
  CERTIFICATE: "Other certificate",
  RESUME: "Resume / CV",
  OFFER_LETTER: "Offer letter",
  EXPERIENCE_LETTER: "Experience letter",
  RELIEVING_LETTER: "Relieving letter",
  SALARY_SLIP: "Previous salary slip",
  BANK_PASSBOOK: "Bank passbook / cheque",
  ADDRESS_PROOF: "Address proof",
  BIRTH_CERTIFICATE: "Birth certificate",
  MARRIAGE_CERTIFICATE: "Marriage certificate",
  OTHER: "Other",
};


// ---------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------
export default function MyProfilePanel({ employeeCode, employeeId }) {

  // Prefer UUID (employee_id) — passes assert_self_or_admin via ID match.
  // Employee_code fallback exists but by-code may 403 if session code
  // differs from the target code.
  const empId = employeeId || localStorage.getItem("employee_id") || "";
  const code  = employeeCode || localStorage.getItem("employee_code") || "";

  const [emp,   setEmp]   = useState(null);
  const [docs,  setDocs]  = useState([]);
  const [err,   setErr]   = useState("");
  const [loading, setLoading] = useState(true);


  // ---------- Fetch employee ----------
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (!empId && !code) {
        setErr("You need to be logged in to view this page.");
        setLoading(false);
        return;
      }
      setLoading(true);
      setErr("");
      try {
        // Prefer UUID — the /employees/{id} endpoint is the reliable path.
        const url = empId
          ? `/employees/${encodeURIComponent(empId)}`
          : `/employees/by-code/${encodeURIComponent(code)}`;
        const res = await API.get(url);
        if (!alive) return;
        setEmp(res.data || null);
      } catch (e) {
        if (!alive) return;
        setErr(e?.response?.data?.detail || "Couldn't load your profile.");
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    return () => { alive = false; };
  }, [empId, code]);


  // ---------- Fetch documents ----------
  useEffect(() => {
    const empIdForDocs = empId || emp?.ID;
    if (!empIdForDocs) return;

    let alive = true;
    (async () => {
      try {
        const res = await API.get(
          `/employees/${encodeURIComponent(empIdForDocs)}/documents`
        );
        if (!alive) return;
        const rows = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
        setDocs(rows);
      } catch {
        // Silent — docs are optional
        if (alive) setDocs([]);
      }
    })();
    return () => { alive = false; };
  }, [emp, empId]);


  // ---------- Derived ----------
  const photoSrc = useMemo(() => {
    const raw = emp?.PHOTO_URL || localStorage.getItem("employee_photo") || "";
    return absoluteUrl(raw);
  }, [emp]);

  const fullName    = emp?.NAME || localStorage.getItem("employee_name") || "Employee";
  const employeeCd  = emp?.EMPLOYEE_CODE || code || "—";
  const initials    = useMemo(() => {
    const parts = String(fullName).trim().split(/\s+/).slice(0, 2);
    return parts.map((p) => p[0] || "").join("").toUpperCase() || "E";
  }, [fullName]);


  // ---------- Render states ----------
  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonCard}>Loading your profile…</div>
      </div>
    );
  }

  if (err) {
    return (
      <div className={styles.page}>
        <div className={styles.errorCard}>
          <div className={styles.errorTitle}>Couldn't load profile</div>
          <div className={styles.errorText}>{err}</div>
        </div>
      </div>
    );
  }

  if (!emp) {
    return (
      <div className={styles.page}>
        <div className={styles.errorCard}>Profile not found.</div>
      </div>
    );
  }


  // ---------- Actual profile ----------
  return (
    <div className={styles.page}>

      {/* ============= HERO ============= */}
      <section className={styles.hero}>
        <div className={styles.heroLeft}>
          {photoSrc ? (
            <img className={styles.avatar} src={photoSrc} alt={fullName} />
          ) : (
            <div className={styles.avatarInitials}>{initials}</div>
          )}
        </div>
        <div className={styles.heroMain}>
          <div className={styles.heroName}>{fullName}</div>
          <div className={styles.heroMeta}>
            <span className={styles.heroCode}>{employeeCd}</span>
            {emp.DESIGNATION?.TITLE && (
              <span className={styles.heroDot}>•</span>
            )}
            {emp.DESIGNATION?.TITLE && (
              <span>{emp.DESIGNATION.TITLE}</span>
            )}
            {emp.DEPARTMENT?.NAME && (
              <span className={styles.heroDot}>•</span>
            )}
            {emp.DEPARTMENT?.NAME && (
              <span>{emp.DEPARTMENT.NAME}</span>
            )}
          </div>
          <div className={styles.heroPills}>
            {emp.STATUS && (
              <span className={`${styles.pill} ${styles[`pill_${emp.STATUS.toLowerCase()}`] || ""}`}>
                {emp.STATUS}
              </span>
            )}
            {emp.EMPLOYMENT_TYPE && (
              <span className={styles.pill}>{emp.EMPLOYMENT_TYPE}</span>
            )}
            {emp.PROFILE_SUBMITTED && (
              <span className={`${styles.pill} ${styles.pill_verified}`}>
                Profile submitted
              </span>
            )}
          </div>
        </div>
      </section>


      {/* ============= PERSONAL INFO ============= */}
      <Section title="Personal Information" icon="user">
        <Grid>
          <Field label="Full name"        value={emp.NAME} />
          <Field label="Date of birth"    value={fmtDate(emp.DOB)} />
          <Field label="Gender"           value={emp.GENDER} />
          <Field label="Blood group"      value={emp.BLOOD_GROUP} />
          <Field label="Nationality"      value={emp.NATIONALITY} />
          <Field label="Marital status"   value={emp.MARITAL_STATUS} />
          <Field label="Father's name"    value={emp.FATHER_NAME} />
          <Field label="Mother's name"    value={emp.MOTHER_NAME} />
          <Field label="Occupation"       value={emp.OCCUPATION} />
        </Grid>
      </Section>


      {/* ============= CONTACT ============= */}
      <Section title="Contact Information" icon="mail">
        <Grid>
          <Field label="Email"     value={emp.EMAIL} />
          <Field label="Phone"     value={emp.PHONE} />
          <Field label="Address"   value={emp.ADDRESS} wide />
          <Field label="City"      value={emp.CITY} />
          <Field label="State"     value={emp.STATE} />
          <Field label="Pincode"   value={emp.PINCODE} />
        </Grid>
      </Section>


      {/* ============= EMERGENCY CONTACT ============= */}
      {(emp.EMERGENCY_CONTACT_NAME || emp.EMERGENCY_CONTACT_PHONE) && (
        <Section title="Emergency Contact" icon="alert">
          <Grid>
            <Field label="Name"     value={emp.EMERGENCY_CONTACT_NAME} />
            <Field label="Phone"    value={emp.EMERGENCY_CONTACT_PHONE} />
            <Field label="Relation" value={emp.EMERGENCY_CONTACT_RELATION} />
          </Grid>
        </Section>
      )}


      {/* ============= JOB INFO ============= */}
      <Section title="Job Information" icon="briefcase">
        <Grid>
          <Field label="Employee code"    value={emp.EMPLOYEE_CODE} />
          <Field label="Department"       value={emp.DEPARTMENT?.NAME} />
          <Field label="Designation"      value={emp.DESIGNATION?.TITLE} />
          <Field label="Role"             value={emp.ROLE?.NAME} />
          <Field label="Employment type"  value={emp.EMPLOYMENT_TYPE} />
          <Field label="Status"           value={emp.STATUS} />
          <Field label="Joining date"     value={fmtDate(emp.JOINING_DATE)} />
          <Field label="Confirmation"     value={fmtDate(emp.CONFIRMATION_DATE)} />
          <Field label="Work location"    value={emp.WORK_LOCATION} />
          <Field label="Shift start"      value={fmtTime(emp.SHIFT_START)} />
          <Field label="Shift end"        value={fmtTime(emp.SHIFT_END)} />
        </Grid>
      </Section>


      {/* ============= COMPENSATION & BANK ============= */}
      <Section title="Compensation & Bank" icon="cash">
        <Grid>
          <Field label="Monthly salary"   value={fmtMoney(emp.SALARY)} />
          <Field label="Bank name"        value={emp.BANK_NAME} />
          <Field label="Account number"   value={maskAccount(emp.BANK_ACCOUNT_NUMBER)} />
          <Field label="IFSC code"        value={emp.IFSC_CODE} />
        </Grid>
      </Section>


      {/* ============= GOVERNMENT IDS ============= */}
      {(emp.PAN_NUMBER || emp.AADHAAR_NUMBER) && (
        <Section title="Government IDs" icon="id">
          <Grid>
            <Field label="PAN"      value={emp.PAN_NUMBER || "—"} />
            <Field label="Aadhaar"  value={maskAadhaar(emp.AADHAAR_NUMBER)} />
          </Grid>
        </Section>
      )}


      {/* ============= EDUCATION ============= */}
      {(emp.QUALIFICATION || emp.COLLEGE || emp.UNIVERSITY) && (
        <Section title="Education" icon="book">
          <Grid>
            <Field label="Qualification"      value={emp.QUALIFICATION} />
            <Field label="College"            value={emp.COLLEGE} />
            <Field label="University"         value={emp.UNIVERSITY} />
            <Field label="Year of passing"    value={emp.YEAR_OF_PASSING} />
            <Field label="Percentage / CGPA"  value={emp.PERCENTAGE} />
          </Grid>
        </Section>
      )}


      {/* ============= WORK EXPERIENCE ============= */}
      {(emp.EXPERIENCE_YEARS || emp.EXPERIENCE_DETAILS
        || emp.PREVIOUS_COMPANY || emp.PAST_PROJECTS) && (
        <Section title="Work Experience" icon="star">
          <Grid>
            <Field label="Total experience (years)" value={emp.EXPERIENCE_YEARS} />
            <Field label="Previous company"         value={emp.PREVIOUS_COMPANY} />
            <Field label="Previous salary"          value={emp.PREVIOUS_SALARY ? fmtMoney(emp.PREVIOUS_SALARY) : "—"} />
            <Field label="Experience details"       value={emp.EXPERIENCE_DETAILS} wide />
            <Field label="Past projects"            value={emp.PAST_PROJECTS} wide />
          </Grid>
        </Section>
      )}


      {/* ============= SKILLS ============= */}
      {emp.SKILLS && (
        <Section title="Skills" icon="tag">
          <div className={styles.skillsWrap}>
            {String(emp.SKILLS)
              .split(/[,;\n]/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((s, i) => (
                <span key={i} className={styles.skillChip}>{s}</span>
              ))}
          </div>
        </Section>
      )}


      {/* ============= DOCUMENTS ============= */}
      <Section title="Documents" icon="doc" count={docs.length}>
        {docs.length === 0 ? (
          <div className={styles.emptyState}>
            You haven't uploaded any documents yet.
          </div>
        ) : (
          <div className={styles.docList}>
            {docs.map((d) => {
              const title = d.TITLE || DOC_TYPE_LABELS[d.DOC_TYPE] || d.DOC_TYPE || "Document";
              const url   = absoluteUrl(d.FILE_URL);
              return (
                <a
                  key={d.ID}
                  className={styles.docRow}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <span className={styles.docIcon}>{DocIcon(d.MIME)}</span>
                  <span className={styles.docBody}>
                    <span className={styles.docTitle}>{title}</span>
                    <span className={styles.docMeta}>
                      {DOC_TYPE_LABELS[d.DOC_TYPE] || d.DOC_TYPE}
                      {d.SIZE_BYTES ? ` · ${fmtBytes(d.SIZE_BYTES)}` : ""}
                      {d.UPLOADED_AT ? ` · uploaded ${fmtDate(d.UPLOADED_AT)}` : ""}
                    </span>
                  </span>
                  <span className={styles.docLink}>View →</span>
                </a>
              );
            })}
          </div>
        )}
      </Section>


      {/* ============= NOTES ============= */}
      {emp.NOTES && (
        <Section title="Notes" icon="note">
          <div className={styles.notesText}>{emp.NOTES}</div>
        </Section>
      )}

      <div className={styles.footerHint}>
        This is your read-only profile. To update any information,
        please contact HR.
      </div>
    </div>
  );
}


// =====================================================================
// Sub-components
// =====================================================================

function Section({ title, icon, count, children }) {
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionIcon}>{SectionIcon(icon)}</span>
        <h3 className={styles.sectionTitle}>{title}</h3>
        {typeof count === "number" && (
          <span className={styles.sectionCount}>{count}</span>
        )}
      </header>
      <div className={styles.sectionBody}>{children}</div>
    </section>
  );
}


function Grid({ children }) {
  return <div className={styles.grid}>{children}</div>;
}


function Field({ label, value, wide }) {
  const display =
    value === null || value === undefined || value === "" ? "—" : value;
  return (
    <div className={`${styles.field} ${wide ? styles.fieldWide : ""}`}>
      <div className={styles.fieldLabel}>{label}</div>
      <div className={styles.fieldValue}>{display}</div>
    </div>
  );
}


// ---------------------------------------------------------------------
// Icons — inline SVG
// ---------------------------------------------------------------------
function makeIcon(paths, size = 18) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.8"
         strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>
  );
}

function SectionIcon(name) {
  switch (name) {
    case "user":
      return makeIcon(<>
        <circle cx="12" cy="8" r="4" />
        <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
      </>);
    case "mail":
      return makeIcon(<>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="M3 7l9 7 9-7" />
      </>);
    case "alert":
      return makeIcon(<>
        <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
        <path d="M12 9v4M12 17h.01" />
      </>);
    case "briefcase":
      return makeIcon(<>
        <rect x="3" y="7" width="18" height="13" rx="2" />
        <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" />
      </>);
    case "cash":
      return makeIcon(<>
        <rect x="2" y="6" width="20" height="12" rx="2" />
        <circle cx="12" cy="12" r="3" />
      </>);
    case "id":
      return makeIcon(<>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <circle cx="9" cy="12" r="2.5" />
        <path d="M14 10h5M14 14h4" />
      </>);
    case "book":
      return makeIcon(<>
        <path d="M4 4v16c0-1.6 1.4-3 3-3h13V4H7c-1.6 0-3 1.4-3 3z" />
        <path d="M4 20V4" />
      </>);
    case "star":
      return makeIcon(<>
        <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.7 6.6 19.5l1.2-6L3.3 9.3l6.1-.7L12 3z" />
      </>);
    case "tag":
      return makeIcon(<>
        <path d="M20 12l-8 8-9-9V3h8z" />
        <circle cx="7.5" cy="7.5" r="1.4" />
      </>);
    case "doc":
      return makeIcon(<>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6" />
      </>);
    case "note":
      return makeIcon(<>
        <rect x="5" y="3" width="14" height="18" rx="2" />
        <path d="M9 8h6M9 12h6M9 16h4" />
      </>);
    default:
      return null;
  }
}

function DocIcon(mime) {
  const m = (mime || "").toLowerCase();
  if (m.includes("pdf")) {
    return makeIcon(<>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
      <text x="8" y="17" fontSize="6" fontFamily="sans-serif" fill="currentColor" stroke="none">PDF</text>
    </>, 20);
  }
  if (m.includes("image")) {
    return makeIcon(<>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <circle cx="9" cy="11" r="2" />
      <path d="M21 15l-5-5-10 10" />
    </>, 20);
  }
  return makeIcon(<>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </>, 20);
}
