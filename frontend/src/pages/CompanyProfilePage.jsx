import { useState, useEffect, useCallback, useRef, useMemo, memo } from "react";
import {
  PageHeader, Loader, PMButton, PMConfirmModal,
  CustomFieldsSection, CustomFieldsModal,
} from "../components/pm";
import { useToast } from "../hooks/useToast";
import { useCustomFields } from "../hooks/useCustomFields";
import API, { API_BASE_URL } from "../services/api";
import styles from "./CompanyProfilePage.module.css";

// ---------------------------------------------------------------------------
// Field — memo-wrapped so it only re-renders when its own props change.
// Accepts `name` and calls onChange(name, value), letting the parent use one
// stable handleChange without per-field inline closures.
// ---------------------------------------------------------------------------
const Field = memo(function Field({
  name, label, value, onChange,
  type = "text", span2 = false, placeholder = "",
}) {
  const handleInput = useCallback(
    (e) => onChange(name, e.target.value),
    [name, onChange],
  );
  return (
    <div className={span2 ? `${styles.fieldGroup} ${styles.span2}` : styles.fieldGroup}>
      <label className={styles.fieldLabel}>{label}</label>
      <input
        type={type}
        className={styles.input}
        value={value || ""}
        onChange={handleInput}
        placeholder={placeholder}
      />
    </div>
  );
});

// SectionCard is NOT memo-wrapped: its `children` prop is always a new JSX
// object, so memo would add overhead with no benefit.
function SectionCard({ title, desc, children }) {
  return (
    <div className={styles.sectionCard}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {desc && <p className={styles.sectionDesc}>{desc}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CompanyProfilePage
// ---------------------------------------------------------------------------
export default function CompanyProfilePage() {
  const [profile, setProfile] = useState(null);
  const [form, setForm] = useState({});
  const [initialForm, setInitialForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoUploading, setLogoUploading] = useState(false);
  const [domainStatus, setDomainStatus] = useState(null);
  const [cfModal, setCfModal] = useState(false);
  const [leaveModal, setLeaveModal] = useState(false);

  // ── Refs (never trigger re-renders) ────────────────────────────────────
  // Prevents double-fetch in React Strict Mode (mount→unmount→mount cycle).
  const hasFetchedRef = useRef(false);
  // Always-current copies of state/callback values, updated each render.
  // Callbacks that read these do NOT need them in their dep arrays,
  // which prevents the "stale closure → dep changes → effect re-fires" chain.
  const formRef = useRef({});
  const profileRef = useRef(null);
  const isDirtyRef = useRef(false);
  const toastRef = useRef(null);
  const loadCfValRef = useRef(null);
  const domainStatusRef = useRef(null);  // keeps handleSave stable across domain checks
  const validateCfRef = useRef(null);  // insulates handleSave from hook instability
  const saveCfValuesRef = useRef(null);  // same
  const refreshFieldsRef = useRef(null);  // insulates handleCfModalClose
  // Timers
  const domainTimerRef = useRef(null);
  // Pending navigation — stored in a ref, NOT state, because React would
  // call a function passed to setState() as a functional updater.
  const pendingNavRef = useRef(null);
  // ── Hooks ───────────────────────────────────────────────────────────────
  const toast = useToast();

  const {
    fields: cfFields,
    cfValues,
    handleCfChange,
    loadValues: loadCfValues,
    validateCf,
    saveCfValues,
    refreshFields,
  } = useCustomFields("company_master");

  // ── Sync refs every render (no deps needed, no re-renders triggered) ────
  toastRef.current = toast;
  loadCfValRef.current = loadCfValues;
  formRef.current = form;
  profileRef.current = profile;
  domainStatusRef.current = domainStatus;
  validateCfRef.current = validateCf;
  saveCfValuesRef.current = saveCfValues;
  refreshFieldsRef.current = refreshFields;

  // ── isDirty (memoized — only recalculates when form/initialForm change) ─
  const isDirty = useMemo(
    () => JSON.stringify(form) !== JSON.stringify(initialForm),
    [form, initialForm],
  );

  // Keep a ref in sync so the beforeunload handler can read it without
  // needing to be re-registered on every keystroke.
  useEffect(() => { isDirtyRef.current = isDirty; }, [isDirty]);

  // ── beforeunload — registered exactly once (empty deps) ─────────────────
  // Reads isDirtyRef.current so it never needs to be torn down/re-added.
  useEffect(() => {
    const handler = (e) => {
      if (isDirtyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);

  // ── Initial data fetch — exactly once ───────────────────────────────────
  // Empty dep array is intentional. hasFetchedRef guards against the
  // Strict Mode double-invocation (mount → unmount → remount in dev).
  // AbortController ensures the in-flight request is cancelled if the
  // component unmounts before it resolves.
  useEffect(() => {
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    const ctrl = new AbortController();
    setLoading(true);

    API.get("/settings/company", { signal: ctrl.signal })
      .then((res) => {
        const data = res.data;
        profileRef.current = data;
        setProfile(data);
        setForm(data);
        setInitialForm(data);
        if (data.ID) loadCfValRef.current(data.ID);
      })
      .catch((err) => {
        // Suppress cancellation errors — they are expected on unmount.
        if (!ctrl.signal.aborted) {
          toastRef.current.showError("Failed to load company profile.");
        }
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false);
      });

    return () => {
      ctrl.abort();
    };
  }, []); // intentionally empty

  // ── Clean up domain debounce timer on unmount ────────────────────────────
  useEffect(() => () => clearTimeout(domainTimerRef.current), []);

  // Single field updater — stable (no deps), used by all Field instances.
  const handleChange = useCallback((field, val) => {
    setForm((prev) => ({ ...prev, [field]: val }));
  }, []);

  // Domain field: debounced availability check.
  // Reads the value from the event directly — no form/domainStatus dep needed.
  const handleDomainChange = useCallback((e) => {
    const val = e.target.value;
    handleChange("DOMAIN", val);
    clearTimeout(domainTimerRef.current);

    if (!val?.trim()) {
      setDomainStatus(null);
      return;
    }

    setDomainStatus("checking");
    domainTimerRef.current = setTimeout(async () => {
      try {
        const r = await API.get(
          `/settings/company/domain/check?domain=${encodeURIComponent(val.trim())}`,
        );
        setDomainStatus(r.data.available ? "available" : "taken");
      } catch {
        setDomainStatus("invalid");
      }
    }, 500);
  }, [handleChange]);

  // Extracted handlers for non-Field inputs — no inline closures in JSX.
  const handleWorkHoursChange = useCallback((e) => {
    handleChange(
      "WORK_HOURS",
      e.target.value === "" ? null : parseFloat(e.target.value),
    );
  }, [handleChange]);

  const handleNotesChange = useCallback((e) => {
    handleChange("NOTES", e.target.value);
  }, [handleChange]);

  const handleLogoInputChange = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const fd = new FormData();
    fd.append("file", file);
    setLogoUploading(true);

    API.post("/settings/company/upload-logo", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    })
      .then((r) => {
        const logoUrl = r.data?.logo_url || r.data?.company?.LOGO_URL;
        setProfile((p) => ({ ...p, LOGO_URL: logoUrl }));
        toastRef.current.showSuccess("Logo updated.");
      })
      .catch(() => toastRef.current.showError("Logo upload failed."))
      .finally(() => setLogoUploading(false));
  }, []);

  // handleSave reads form/profile/domainStatus via refs — keeps the function
  // identity stable across keystrokes, so the Save PMButton (memo-wrapped)
  // does not re-render every time the user types.
  const handleSave = useCallback(async () => {
    const ds = domainStatusRef.current;
    if (ds === "taken") { toastRef.current.showError("Domain is already taken. Please choose another."); return; }
    if (ds === "invalid") { toastRef.current.showError("Please fix the domain format before saving."); return; }

    const currentForm = formRef.current;
    if (currentForm?.WORK_HOURS != null && currentForm.WORK_HOURS !== "") {
      const wh = parseFloat(currentForm.WORK_HOURS);
      if (isNaN(wh) || wh < 0 || wh > 24) {
        toastRef.current.showError("Working hours must be between 0 and 24.");
        return;
      }
    }

    const cfError = validateCfRef.current?.();
    if (cfError) { toastRef.current.showError(cfError); return; }

    setSaving(true);
    try {
      const res = await API.put("/settings/company", currentForm);
      const updated = res.data?.company || currentForm;
      if (profileRef.current?.ID) await saveCfValuesRef.current?.(profileRef.current.ID);
      profileRef.current = updated;
      setProfile(updated);
      setInitialForm(updated);
      toastRef.current.showSuccess("Company profile saved successfully.");
    } catch (e) {
      toastRef.current.showError(
        e?.response?.data?.detail || "Failed to save. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }, []); // intentionally empty — all values accessed via always-current refs

  const handleCfModalClose = useCallback(() => {
    setCfModal(false);
    refreshFieldsRef.current?.();
  }, []); // intentionally empty — refreshFields accessed via ref

  const openCfModal = useCallback(() => setCfModal(true), []);

  const handleCopyDomain = useCallback(() => {
    const d = (formRef.current.DOMAIN || "").trim();
    if (!d) return;
    navigator.clipboard.writeText(`${d}.bvc24.in`);
    toastRef.current.showSuccess("Copied to clipboard.");
  }, []);

  const handleCopyDomainPreview = useCallback(() => {
    const d = (formRef.current.DOMAIN || "").trim();
    if (!d) return;
    navigator.clipboard.writeText(`${d}.bvc24.in`);
    toastRef.current.showSuccess("Copied!");
  }, []);

  const handleLeaveConfirm = useCallback(() => {
    setLeaveModal(false);
    pendingNavRef.current?.();
    pendingNavRef.current = null;
  }, []);

  const handleLeaveCancel = useCallback(() => setLeaveModal(false), []);

  // ── Derived values (memoized) ─────────────────────────────────────────────

  const logoSrc = useMemo(() => {
    if (!profile?.LOGO_URL) return null;
    return profile.LOGO_URL.startsWith("http")
      ? profile.LOGO_URL
      : `${API_BASE_URL}${profile.LOGO_URL}`;
  }, [profile?.LOGO_URL]);

  const domainDisplay = useMemo(
    () => (form.DOMAIN || "").trim(),
    [form.DOMAIN],
  );

  const createdYear = useMemo(
    () => (profile?.CREATED_AT ? new Date(profile.CREATED_AT).getFullYear() : null),
    [profile?.CREATED_AT],
  );

  const logoInitial = useMemo(
    () => (form.LEGAL_NAME || "C").charAt(0).toUpperCase(),
    [form.LEGAL_NAME],
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.pageTop}>
        <PageHeader
          title="Company Profile"
          subtitle="Manage your organization's details, domain, and working hours"
          actions={
            <PMButton variant="primary" loading={saving} onClick={handleSave} disabled={saving}>
              Save Changes
            </PMButton>
          }
        />
      </div>
      {/* Spacer holds the header's height in the flex flow when it's pinned fixed */}
      <div className={styles.headerSpacer} />

      <div className={styles.scrollArea}>
        {loading ? (
          <div className={styles.loaderWrap}><Loader /></div>
        ) : (
          <div className={styles.layout}>

            {/* ── LEFT: Profile Card ───────────────────────────────── */}
            <aside className={styles.sidebar}>
              <div className={styles.profileCard}>

                <div className={styles.logoWrapper}>
                  {logoSrc ? (
                    <img src={logoSrc} alt="Company logo" className={styles.logoImg} />
                  ) : (
                    <div className={styles.logoPlaceholder}>{logoInitial}</div>
                  )}
                  <label
                    className={styles.logoUploadLabel}
                    title={logoUploading ? "Uploading…" : "Upload logo"}
                  >
                    {logoUploading ? <span className={styles.logoSpinner} /> : "📷"}
                    <input
                      type="file"
                      accept=".png,.jpg,.jpeg,.webp,.svg"
                      onChange={handleLogoInputChange}
                      hidden
                    />
                  </label>
                </div>

                <div className={styles.companyName}>{form.LEGAL_NAME || "Your Company"}</div>
                {form.SHORT_NAME && <div className={styles.companyCode}>{form.SHORT_NAME}</div>}
                {form.TAGLINE && <div className={styles.companyTagline}>{form.TAGLINE}</div>}

                <div className={styles.statusRow}>
                  <span className={styles.statusChip}>Active</span>
                  {createdYear && <span className={styles.createdDate}>Since {createdYear}</span>}
                </div>

                {domainDisplay && domainStatus !== "invalid" && (
                  <div className={styles.domainBadgeWrap}>
                    <span className={styles.domainBadge}>{domainDisplay}.bvc24.in</span>
                    <button className={styles.copyIconBtn} onClick={handleCopyDomain} title="Copy URL">
                      ⧉
                    </button>
                  </div>
                )}

                {isDirty && <div className={styles.unsavedBadge}>Unsaved changes</div>}
              </div>

            </aside>

            {/* ── RIGHT: Edit Sections ─────────────────────────────── */}
            <main className={styles.sections}>

              <SectionCard title="Company Information">
                <div className={styles.fieldGrid}>
                  <Field name="LEGAL_NAME" label="Legal Name *" value={form.LEGAL_NAME} onChange={handleChange} placeholder="Bharath Vending Corporation" span2 />
                  <Field name="SHORT_NAME" label="Short Name" value={form.SHORT_NAME} onChange={handleChange} placeholder="BVC24" />
                  <Field name="TAGLINE" label="Tagline" value={form.TAGLINE} onChange={handleChange} placeholder="Your company slogan" />
                </div>
              </SectionCard>

              <SectionCard title="Contact & Web Presence">
                <div className={styles.fieldGrid}>
                  <Field name="EMAIL" label="Email" value={form.EMAIL} type="email" onChange={handleChange} placeholder="contact@company.in" />
                  <Field name="PHONE" label="Phone" value={form.PHONE} type="tel" onChange={handleChange} placeholder="+91 98765 43210" />
                  <Field name="WEBSITE" label="Website" value={form.WEBSITE} onChange={handleChange} placeholder="www.company.in" span2 />
                </div>
              </SectionCard>

              <SectionCard title="Address">
                <div className={styles.fieldGrid}>
                  <Field name="ADDRESS_LINE_1" label="Address Line 1" value={form.ADDRESS_LINE_1} onChange={handleChange} placeholder="Plot No. / Building" span2 />
                  <Field name="ADDRESS_LINE_2" label="Address Line 2" value={form.ADDRESS_LINE_2} onChange={handleChange} placeholder="Street / Area" span2 />
                  <Field name="CITY" label="City" value={form.CITY} onChange={handleChange} placeholder="Chennai" />
                  <Field name="STATE" label="State" value={form.STATE} onChange={handleChange} placeholder="Tamil Nadu" />
                  <Field name="PINCODE" label="PIN Code" value={form.PINCODE} onChange={handleChange} placeholder="600001" />
                  <Field name="COUNTRY" label="Country" value={form.COUNTRY} onChange={handleChange} placeholder="India" />
                </div>
              </SectionCard>

              <SectionCard title="Legal & Registration">
                <div className={styles.fieldGrid}>
                  <Field name="GST_NUMBER" label="GST Number" value={form.GST_NUMBER} onChange={handleChange} placeholder="33ABCDE1234F1Z5" />
                  <Field name="PAN_NUMBER" label="PAN Number" value={form.PAN_NUMBER} onChange={handleChange} placeholder="ABCDE1234F" />
                  <Field name="CIN_NUMBER" label="CIN Number" value={form.CIN_NUMBER} onChange={handleChange} placeholder="U74900TN2020PTC000000" />
                </div>
              </SectionCard>

              <SectionCard title="Banking Details">
                <div className={styles.fieldGrid}>
                  <Field name="BANK_NAME" label="Bank Name" value={form.BANK_NAME} onChange={handleChange} placeholder="State Bank of India" />
                  <Field name="BANK_ACCOUNT_NUMBER" label="Account Number" value={form.BANK_ACCOUNT_NUMBER} onChange={handleChange} placeholder="00000000000000" />
                  <Field name="BANK_IFSC" label="IFSC Code" value={form.BANK_IFSC} onChange={handleChange} placeholder="SBIN0000000" />
                  <Field name="BANK_BRANCH" label="Branch" value={form.BANK_BRANCH} onChange={handleChange} placeholder="Anna Nagar, Chennai" />
                  <Field name="UPI_ID" label="UPI ID" value={form.UPI_ID} onChange={handleChange} placeholder="company@upi" />
                </div>
              </SectionCard>

              <SectionCard title="Domain Configuration" desc="Your unique portal subdomain on the BVC24 platform.">
                <div className={styles.domainInputWrap}>
                  <div className={styles.domainInputRow}>
                    <input
                      className={styles.domainInput}
                      value={form.DOMAIN || ""}
                      onChange={handleDomainChange}
                      placeholder="your-company"
                      spellCheck={false}
                      autoComplete="off"
                    />
                    <span className={styles.domainSuffix}>.bvc24.in</span>
                  </div>
                  <div className={styles.domainStatusRow}>
                    {domainStatus === "checking" && (
                      <span className={styles.domainChecking}>
                        <span className={styles.dotSpinner} /> Checking availability…
                      </span>
                    )}
                    {domainStatus === "available" && <span className={styles.domainAvail}>✓ Available</span>}
                    {domainStatus === "taken" && <span className={styles.domainTaken}>✗ Already taken</span>}
                    {domainStatus === "invalid" && <span className={styles.domainTaken}>✗ Invalid format</span>}
                  </div>
                </div>

                {domainDisplay && domainStatus !== "invalid" && (
                  <div className={styles.domainPreviewRow}>
                    <span className={styles.domainPreviewLabel}>Your portal URL</span>
                    <span className={styles.domainPreviewUrl}>{domainDisplay}.bvc24.in</span>
                    <button className={styles.copyBtn} onClick={handleCopyDomainPreview}>Copy</button>
                  </div>
                )}

                <p className={styles.domainHint}>
                  Lowercase letters, numbers, and hyphens only. Min 3 characters. No leading/trailing hyphens.
                </p>
              </SectionCard>

              <SectionCard title="Working Hours" desc="Standard daily working hours for your organization.">
                <div className={styles.workHoursRow}>
                  <input
                    type="number"
                    min="0"
                    max="24"
                    step="0.5"
                    value={form.WORK_HOURS ?? ""}
                    onChange={handleWorkHoursChange}
                    className={styles.workHoursInput}
                    placeholder="8"
                  />
                  <span className={styles.workHoursUnit}>hours / day</span>
                </div>
                {form.WORK_HOURS != null && form.WORK_HOURS !== "" && (
                  <div className={styles.workHoursPreview}>
                    <span>🕗</span>
                    <span><strong>{form.WORK_HOURS}</strong> standard working hours per day</span>
                  </div>
                )}
              </SectionCard>

              <SectionCard title="Notes">
                <textarea
                  className={`${styles.input} ${styles.textarea}`}
                  value={form.NOTES || ""}
                  onChange={handleNotesChange}
                  placeholder="Internal notes about this company…"
                  rows={4}
                />
              </SectionCard>

              <SectionCard title="Custom Fields">
                <div className={styles.cfHeader}>
                  <p className={styles.sectionDesc} style={{ margin: 0 }}>
                    Organization-specific fields added to this company profile.
                  </p>
                  <PMButton variant="outline" size="sm" onClick={openCfModal}>
                    Manage Fields
                  </PMButton>
                </div>
                {cfFields && cfFields.length > 0 ? (
                  <div className={styles.cfSection}>
                    <CustomFieldsSection fields={cfFields} values={cfValues} onChange={handleCfChange} />
                  </div>
                ) : (
                  <p className={styles.cfEmpty}>No custom fields yet. Click "Manage Fields" to add one.</p>
                )}
              </SectionCard>

              <div className={styles.bottomActions}>
                <PMButton variant="primary" loading={saving} onClick={handleSave} disabled={saving}>
                  Save Changes
                </PMButton>
              </div>

            </main>
          </div>
        )}

      </div>{/* /scrollArea */}

      {cfModal && (
        <CustomFieldsModal open={cfModal} tableName="company_master" onClose={handleCfModalClose} />
      )}

      {leaveModal && (
        <PMConfirmModal
          open={leaveModal}
          onClose={handleLeaveCancel}
          onConfirm={handleLeaveConfirm}
          title="Unsaved Changes"
          description="You have unsaved changes. Are you sure you want to leave without saving?"
          confirmLabel="Leave"
          cancelLabel="Stay"
        />
      )}
    </div>
  );
}
