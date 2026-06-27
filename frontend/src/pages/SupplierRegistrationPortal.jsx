import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import API from "../services/api";
import styles from "./SupplierRegistrationPortal.module.css";

const TOTAL_STEPS = 6;

const DELIVERY_MODE_OPTIONS = ["Road", "Rail", "Air", "Sea", "Courier", "Hand Delivery"];

const COMPANY_TYPE_OPTIONS = [
  "Sole Proprietorship", "Partnership", "LLP", "Private Limited",
  "Public Limited", "OPC", "Co-operative", "Government", "Other",
];

const EMPTY_FORM = {
  // Step 1 — Company Info
  COMPANY_NAME: "", REGISTRATION_NO: "", GST_NUMBER: "", COMPANY_TYPE: "",
  ADDRESS: "", CITY: "", STATE: "", PIN_CODE: "",
  // Step 2 — Contact
  CONTACT_PERSON_NAME: "", EMAIL: "", PHONE: "",
  ALTERNATE_EMAIL: "", ALTERNATE_PHONE: "",
  // Step 3 — Business Profile
  YEARS_IN_BUSINESS: "", ANNUAL_TURNOVER: "", EMPLOYEE_COUNT: "", CERTIFICATIONS: [],
  // Step 4 — Financials
  ADVANCE_PERCENT: 0, CREDIT_DAYS: 30, MINIMUM_ORDER_VALUE: 0, LEAD_TIME_DAYS: 7, DELIVERY_MODES: [],
  // Step 5 — Products
  PRODUCTS: [],
};

const STEP_LABELS = [
  "Company Info",
  "Contact Details",
  "Business Profile",
  "Financials & Logistics",
  "Product Registration",
  "Review & Submit",
];

function FieldRow({ label, value }) {
  if (!value && value !== 0) return null;
  return (
    <div className={styles.reviewField}>
      <span className={styles.reviewKey}>{label}</span>
      <span className={styles.reviewVal}>{String(value)}</span>
    </div>
  );
}

export default function SupplierRegistrationPortal() {
  const { token } = useParams();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState(EMPTY_FORM);
  const [errors, setErrors] = useState({});
  const [invitation, setInvitation] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tokenError, setTokenError] = useState(null); // "expired" | "invalid" | "submitted" | "approved"
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [productSearch, setProductSearch] = useState("");
  const [productResults, setProductResults] = useState([]);
  const [productSearching, setProductSearching] = useState(false);
  const [certInput, setCertInput] = useState("");
  const searchTimer = useRef(null);

  // ── Load token ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await API.get(`/api/supplier-onboarding/register/${token}`);
        setInvitation(res.data.invitation);
        const draft = res.data.draft;
        if (draft?.FORM_DATA) {
          setForm((prev) => ({ ...prev, ...draft.FORM_DATA, PRODUCTS: draft.PRODUCTS_DATA || [] }));
          // resume from last saved step
          if (draft.PRODUCTS_DATA?.length > 0) setStep(5);
          else if (draft.FORM_DATA.ADVANCE_PERCENT !== undefined) setStep(4);
          else if (draft.FORM_DATA.YEARS_IN_BUSINESS !== undefined) setStep(3);
          else if (draft.FORM_DATA.CONTACT_PERSON_NAME) setStep(2);
        }
        if (["SUBMITTED", "APPROVED"].includes(res.data.invitation?.STATUS)) {
          setTokenError(res.data.invitation.STATUS === "APPROVED" ? "approved" : "submitted");
        }
      } catch (e) {
        const msg = e?.response?.data?.detail || "";
        if (msg.toLowerCase().includes("expir")) setTokenError("expired");
        else setTokenError("invalid");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [token]);

  // ── Product search ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!productSearch.trim()) { setProductResults([]); return; }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(async () => {
      setProductSearching(true);
      try {
        const res = await API.get("/api/products", { params: { search: productSearch, status: "ACTIVE", vendor_id: 1 } });
        setProductResults(res.data || []);
      } catch {
        setProductResults([]);
      } finally {
        setProductSearching(false);
      }
    }, 300);
    return () => clearTimeout(searchTimer.current);
  }, [productSearch]);

  // ── Helpers ─────────────────────────────────────────────────────────────
  const setField = useCallback((field, value) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => { const e = { ...prev }; delete e[field]; return e; });
  }, []);

  const toggleDeliveryMode = useCallback((mode) => {
    setForm((prev) => ({
      ...prev,
      DELIVERY_MODES: prev.DELIVERY_MODES.includes(mode)
        ? prev.DELIVERY_MODES.filter((m) => m !== mode)
        : [...prev.DELIVERY_MODES, mode],
    }));
  }, []);

  const addCert = useCallback(() => {
    if (!certInput.trim()) return;
    setForm((prev) => ({ ...prev, CERTIFICATIONS: [...(prev.CERTIFICATIONS || []), certInput.trim()] }));
    setCertInput("");
  }, [certInput]);

  const removeCert = useCallback((i) => {
    setForm((prev) => ({ ...prev, CERTIFICATIONS: prev.CERTIFICATIONS.filter((_, j) => j !== i) }));
  }, []);

  const addProduct = useCallback((product) => {
    setForm((prev) => {
      if (prev.PRODUCTS.some((p) => p.PRODUCT_ID === product.ID)) return prev;
      return {
        ...prev,
        PRODUCTS: [...prev.PRODUCTS, {
          PRODUCT_ID: product.ID,
          PRODUCT_NAME: product.PRODUCT_NAME,
          PRODUCT_CODE: product.PRODUCT_CODE,
          UNIT: product.UNIT,
          UNIT_PRICE: "",
          MOQ: "",
          LEAD_TIME_DAYS: "",
        }],
      };
    });
    setProductSearch("");
    setProductResults([]);
  }, []);

  const removeProduct = useCallback((pid) => {
    setForm((prev) => ({ ...prev, PRODUCTS: prev.PRODUCTS.filter((p) => p.PRODUCT_ID !== pid) }));
  }, []);

  const updateProduct = useCallback((pid, field, value) => {
    setForm((prev) => ({
      ...prev,
      PRODUCTS: prev.PRODUCTS.map((p) => p.PRODUCT_ID === pid ? { ...p, [field]: value } : p),
    }));
  }, []);

  // ── Validation ──────────────────────────────────────────────────────────
  const validate = useCallback((stepNum) => {
    const e = {};
    if (stepNum === 1) {
      if (!form.COMPANY_NAME.trim()) e.COMPANY_NAME = "Required";
    }
    if (stepNum === 2) {
      if (!form.CONTACT_PERSON_NAME.trim()) e.CONTACT_PERSON_NAME = "Required";
      if (!form.EMAIL.trim()) e.EMAIL = "Required";
      else if (!/\S+@\S+\.\S+/.test(form.EMAIL)) e.EMAIL = "Invalid email";
      if (!form.PHONE.trim()) e.PHONE = "Required";
    }
    if (stepNum === 5) {
      form.PRODUCTS.forEach((p) => {
        if (!p.UNIT_PRICE || parseFloat(p.UNIT_PRICE) <= 0) {
          e[`price_${p.PRODUCT_ID}`] = "Price required";
        }
      });
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }, [form]);

  // ── Save draft ──────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (silent = false) => {
    if (!silent) setSaving(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await API.post(`/api/supplier-onboarding/register/${token}/save-draft`, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
      });
    } catch {
      // silent failure on auto-save
    } finally {
      if (!silent) setSaving(false);
    }
  }, [form, token]);

  const handleNext = useCallback(async () => {
    if (!validate(step)) return;
    setSaving(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await API.post(`/api/supplier-onboarding/register/${token}/save-draft`, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
      });
    } catch {
      // non-blocking — still advance
    } finally {
      setSaving(false);
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [step, validate, form, token]);

  const handleBack = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  const handleSubmit = useCallback(async () => {
    if (!validate(step)) return;
    setSubmitting(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await API.post(`/api/supplier-onboarding/register/${token}/save-draft`, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
      });
      await API.post(`/api/supplier-onboarding/register/${token}/submit`);
      setSubmitted(true);
    } catch (e) {
      alert(e?.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [form, token, step, validate]);

  // ── Render states ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.spinnerWrap}>
            <div className={styles.spinner} />
            <p>Verifying your invitation link…</p>
          </div>
        </div>
      </div>
    );
  }

  if (tokenError === "expired") {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.errorScreen}>
            <div className={styles.errorIcon}>⏰</div>
            <h2>Invitation Expired</h2>
            <p>This registration link has expired. Please contact the company to request a new invitation.</p>
            <p className={styles.supportContact}>
              Support: <a href="mailto:support@bvc24.com">support@bvc24.com</a>
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (tokenError === "invalid") {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.errorScreen}>
            <div className={styles.errorIcon}>⚠️</div>
            <h2>Invalid Link</h2>
            <p>This registration link is not valid. Please check the link in your email or contact support.</p>
          </div>
        </div>
      </div>
    );
  }

  if (tokenError === "submitted" || tokenError === "approved") {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.successScreen}>
            <div className={styles.successIcon}>✓</div>
            <h2>{tokenError === "approved" ? "Registration Approved!" : "Already Submitted"}</h2>
            <p>
              {tokenError === "approved"
                ? "Your supplier registration has been approved. You can now work with us!"
                : "Your registration has already been submitted and is under review. We will contact you shortly."}
            </p>
          </div>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className={styles.root}>
        <div className={styles.card}>
          <div className={styles.successScreen}>
            <div className={styles.successIcon}>✓</div>
            <h2>Registration Submitted Successfully!</h2>
            <p>
              Thank you, <strong>{form.CONTACT_PERSON_NAME || form.COMPANY_NAME}</strong>! Our team will review your registration and contact you within <strong>2 business days</strong>.
            </p>
            {form.EMAIL && <p className={styles.confirmEmail}>A confirmation will be sent to <strong>{form.EMAIL}</strong>.</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.header}>
          <div className={styles.brandRow}>
            <span className={styles.brandName}>BVC24</span>
            <span className={styles.brandTag}>Supplier Portal</span>
          </div>
          {invitation && (
            <p className={styles.inviteFor}>
              Invited by <strong>{invitation.INVITED_COMPANY_NAME || "BVC24"}</strong>
            </p>
          )}
        </div>

        {/* Progress */}
        <div className={styles.progressBar}>
          {STEP_LABELS.map((label, i) => (
            <div
              key={i}
              className={`${styles.progressStep} ${i + 1 < step ? styles.progressDone : ""} ${i + 1 === step ? styles.progressActive : ""}`}
            >
              <div className={styles.progressDot}>
                {i + 1 < step ? "✓" : i + 1}
              </div>
              <span className={styles.progressLabel}>{label}</span>
            </div>
          ))}
        </div>

        {/* Step Content */}
        <div className={styles.stepBody}>
          <h3 className={styles.stepTitle}>{STEP_LABELS[step - 1]}</h3>

          {/* Step 1 — Company Info */}
          {step === 1 && (
            <div className={styles.formGrid}>
              <div className={`${styles.fg} ${styles.full}`}>
                <label>Company Name <span className={styles.req}>*</span></label>
                <input className={`${styles.input} ${errors.COMPANY_NAME ? styles.inputError : ""}`} value={form.COMPANY_NAME} onChange={(e) => setField("COMPANY_NAME", e.target.value)} placeholder="e.g. Acme Industries Pvt. Ltd." />
                {errors.COMPANY_NAME && <span className={styles.err}>{errors.COMPANY_NAME}</span>}
              </div>
              <div className={styles.fg}>
                <label>Registration No.</label>
                <input className={styles.input} value={form.REGISTRATION_NO} onChange={(e) => setField("REGISTRATION_NO", e.target.value)} placeholder="CIN / LLPIN" />
              </div>
              <div className={styles.fg}>
                <label>GST Number</label>
                <input className={styles.input} value={form.GST_NUMBER} onChange={(e) => setField("GST_NUMBER", e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} />
              </div>
              <div className={styles.fg}>
                <label>Company Type</label>
                <select className={styles.select} value={form.COMPANY_TYPE} onChange={(e) => setField("COMPANY_TYPE", e.target.value)}>
                  <option value="">Select type…</option>
                  {COMPANY_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div className={`${styles.fg} ${styles.full}`}>
                <label>Address</label>
                <textarea className={styles.textarea} value={form.ADDRESS} onChange={(e) => setField("ADDRESS", e.target.value)} placeholder="Street address, building, area" rows={2} />
              </div>
              <div className={styles.fg}>
                <label>City</label>
                <input className={styles.input} value={form.CITY} onChange={(e) => setField("CITY", e.target.value)} placeholder="e.g. Mumbai" />
              </div>
              <div className={styles.fg}>
                <label>State</label>
                <input className={styles.input} value={form.STATE} onChange={(e) => setField("STATE", e.target.value)} placeholder="e.g. Maharashtra" />
              </div>
              <div className={styles.fg}>
                <label>PIN Code</label>
                <input className={styles.input} value={form.PIN_CODE} onChange={(e) => setField("PIN_CODE", e.target.value)} placeholder="400001" maxLength={6} />
              </div>
            </div>
          )}

          {/* Step 2 — Contact */}
          {step === 2 && (
            <div className={styles.formGrid}>
              <div className={`${styles.fg} ${styles.full}`}>
                <label>Contact Person Name <span className={styles.req}>*</span></label>
                <input className={`${styles.input} ${errors.CONTACT_PERSON_NAME ? styles.inputError : ""}`} value={form.CONTACT_PERSON_NAME} onChange={(e) => setField("CONTACT_PERSON_NAME", e.target.value)} placeholder="Primary contact name" />
                {errors.CONTACT_PERSON_NAME && <span className={styles.err}>{errors.CONTACT_PERSON_NAME}</span>}
              </div>
              <div className={styles.fg}>
                <label>Email <span className={styles.req}>*</span></label>
                <input className={`${styles.input} ${errors.EMAIL ? styles.inputError : ""}`} type="email" value={form.EMAIL} onChange={(e) => setField("EMAIL", e.target.value)} placeholder="contact@company.com" />
                {errors.EMAIL && <span className={styles.err}>{errors.EMAIL}</span>}
              </div>
              <div className={styles.fg}>
                <label>Phone <span className={styles.req}>*</span></label>
                <input className={`${styles.input} ${errors.PHONE ? styles.inputError : ""}`} value={form.PHONE} onChange={(e) => setField("PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
                {errors.PHONE && <span className={styles.err}>{errors.PHONE}</span>}
              </div>
              <div className={styles.fg}>
                <label>Alternate Email</label>
                <input className={styles.input} type="email" value={form.ALTERNATE_EMAIL} onChange={(e) => setField("ALTERNATE_EMAIL", e.target.value)} placeholder="alt@company.com" />
              </div>
              <div className={styles.fg}>
                <label>Alternate Phone</label>
                <input className={styles.input} value={form.ALTERNATE_PHONE} onChange={(e) => setField("ALTERNATE_PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
              </div>
            </div>
          )}

          {/* Step 3 — Business Profile */}
          {step === 3 && (
            <div className={styles.formGrid}>
              <div className={styles.fg}>
                <label>Years in Business</label>
                <input className={styles.input} type="number" min={0} value={form.YEARS_IN_BUSINESS} onChange={(e) => setField("YEARS_IN_BUSINESS", e.target.value)} placeholder="e.g. 10" />
              </div>
              <div className={styles.fg}>
                <label>Annual Turnover (₹)</label>
                <input className={styles.input} type="number" min={0} value={form.ANNUAL_TURNOVER} onChange={(e) => setField("ANNUAL_TURNOVER", e.target.value)} placeholder="e.g. 5000000" />
              </div>
              <div className={styles.fg}>
                <label>Employee Count</label>
                <input className={styles.input} type="number" min={0} value={form.EMPLOYEE_COUNT} onChange={(e) => setField("EMPLOYEE_COUNT", e.target.value)} placeholder="e.g. 50" />
              </div>
              <div className={`${styles.fg} ${styles.full}`}>
                <label>Certifications</label>
                <div className={styles.tagInputRow}>
                  <input className={styles.input} value={certInput} onChange={(e) => setCertInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCert(); } }} placeholder="e.g. ISO 9001, BIS, MSME" />
                  <button className={styles.addTagBtn} onClick={addCert} type="button">Add</button>
                </div>
                {form.CERTIFICATIONS?.length > 0 && (
                  <div className={styles.tagList}>
                    {form.CERTIFICATIONS.map((c, i) => (
                      <span key={i} className={styles.tag}>{c}<button onClick={() => removeCert(i)} className={styles.tagRemove}>×</button></span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 4 — Financials */}
          {step === 4 && (
            <div className={styles.formGrid}>
              <div className={styles.fg}>
                <label>Advance Payment %</label>
                <input className={styles.input} type="number" min={0} max={100} value={form.ADVANCE_PERCENT} onChange={(e) => setField("ADVANCE_PERCENT", parseFloat(e.target.value) || 0)} />
              </div>
              <div className={styles.fg}>
                <label>Credit Days</label>
                <input className={styles.input} type="number" min={0} value={form.CREDIT_DAYS} onChange={(e) => setField("CREDIT_DAYS", parseInt(e.target.value, 10) || 0)} />
              </div>
              <div className={styles.fg}>
                <label>Minimum Order Value (₹)</label>
                <input className={styles.input} type="number" min={0} value={form.MINIMUM_ORDER_VALUE} onChange={(e) => setField("MINIMUM_ORDER_VALUE", parseFloat(e.target.value) || 0)} />
              </div>
              <div className={styles.fg}>
                <label>Lead Time (days)</label>
                <input className={styles.input} type="number" min={0} value={form.LEAD_TIME_DAYS} onChange={(e) => setField("LEAD_TIME_DAYS", parseInt(e.target.value, 10) || 0)} />
              </div>
              <div className={`${styles.fg} ${styles.full}`}>
                <label>Delivery Modes</label>
                <div className={styles.checkGrid}>
                  {DELIVERY_MODE_OPTIONS.map((mode) => (
                    <label key={mode} className={styles.checkLabel}>
                      <input type="checkbox" checked={form.DELIVERY_MODES.includes(mode)} onChange={() => toggleDeliveryMode(mode)} />
                      {mode}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Step 5 — Products */}
          {step === 5 && (
            <div className={styles.productStep}>
              <div className={styles.productSearchWrap}>
                <label>Search Products to Register</label>
                <div className={styles.searchInputWrap}>
                  <input
                    className={styles.input}
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Type product name or code…"
                  />
                  {productSearching && <span className={styles.searchSpinner}>…</span>}
                </div>
                {productResults.length > 0 && (
                  <div className={styles.productDropdown}>
                    {productResults.map((p) => (
                      <button key={p.ID} className={styles.productOption} onClick={() => addProduct(p)}>
                        <span className={styles.pCode}>{p.PRODUCT_CODE}</span>
                        <span className={styles.pName}>{p.PRODUCT_NAME}</span>
                        <span className={styles.pUnit}>{p.UNIT}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {form.PRODUCTS.length === 0 ? (
                <div className={styles.noProducts}>
                  <p>Search and add products you can supply. You can add multiple products.</p>
                </div>
              ) : (
                <div className={styles.productList}>
                  {form.PRODUCTS.map((p) => (
                    <div key={p.PRODUCT_ID} className={styles.productCard}>
                      <div className={styles.productCardHeader}>
                        <span className={styles.pCardCode}>{p.PRODUCT_CODE}</span>
                        <span className={styles.pCardName}>{p.PRODUCT_NAME}</span>
                        <span className={styles.pCardUnit}>{p.UNIT}</span>
                        <button className={styles.removeProductBtn} onClick={() => removeProduct(p.PRODUCT_ID)}>Remove</button>
                      </div>
                      <div className={styles.productCardFields}>
                        <div className={styles.fg}>
                          <label>Unit Price (₹) <span className={styles.req}>*</span></label>
                          <input
                            className={`${styles.input} ${errors[`price_${p.PRODUCT_ID}`] ? styles.inputError : ""}`}
                            type="number" min={0.01} step={0.01}
                            value={p.UNIT_PRICE}
                            onChange={(e) => updateProduct(p.PRODUCT_ID, "UNIT_PRICE", e.target.value)}
                            placeholder="Unit price in ₹"
                          />
                          {errors[`price_${p.PRODUCT_ID}`] && <span className={styles.err}>{errors[`price_${p.PRODUCT_ID}`]}</span>}
                        </div>
                        <div className={styles.fg}>
                          <label>MOQ</label>
                          <input className={styles.input} type="number" min={0} value={p.MOQ} onChange={(e) => updateProduct(p.PRODUCT_ID, "MOQ", e.target.value)} placeholder="Minimum order qty" />
                        </div>
                        <div className={styles.fg}>
                          <label>Lead Time (days)</label>
                          <input className={styles.input} type="number" min={0} value={p.LEAD_TIME_DAYS} onChange={(e) => updateProduct(p.PRODUCT_ID, "LEAD_TIME_DAYS", e.target.value)} placeholder="Days" />
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Step 6 — Review */}
          {step === 6 && (
            <div className={styles.reviewWrap}>
              <div className={styles.reviewSection}>
                <h4 className={styles.reviewSectionTitle}>Company Information</h4>
                <div className={styles.reviewFields}>
                  <FieldRow label="Company Name" value={form.COMPANY_NAME} />
                  <FieldRow label="GST Number" value={form.GST_NUMBER} />
                  <FieldRow label="Company Type" value={form.COMPANY_TYPE} />
                  <FieldRow label="Address" value={[form.ADDRESS, form.CITY, form.STATE, form.PIN_CODE].filter(Boolean).join(", ")} />
                </div>
              </div>
              <div className={styles.reviewSection}>
                <h4 className={styles.reviewSectionTitle}>Contact Details</h4>
                <div className={styles.reviewFields}>
                  <FieldRow label="Contact Person" value={form.CONTACT_PERSON_NAME} />
                  <FieldRow label="Email" value={form.EMAIL} />
                  <FieldRow label="Phone" value={form.PHONE} />
                </div>
              </div>
              <div className={styles.reviewSection}>
                <h4 className={styles.reviewSectionTitle}>Business & Financials</h4>
                <div className={styles.reviewFields}>
                  <FieldRow label="Years in Business" value={form.YEARS_IN_BUSINESS} />
                  <FieldRow label="Annual Turnover" value={form.ANNUAL_TURNOVER ? `₹${Number(form.ANNUAL_TURNOVER).toLocaleString()}` : null} />
                  <FieldRow label="Credit Days" value={form.CREDIT_DAYS} />
                  <FieldRow label="Lead Time (days)" value={form.LEAD_TIME_DAYS} />
                  <FieldRow label="Delivery Modes" value={form.DELIVERY_MODES?.join(", ")} />
                  {form.CERTIFICATIONS?.length > 0 && <FieldRow label="Certifications" value={form.CERTIFICATIONS.join(", ")} />}
                </div>
              </div>
              {form.PRODUCTS.length > 0 && (
                <div className={styles.reviewSection}>
                  <h4 className={styles.reviewSectionTitle}>Products ({form.PRODUCTS.length})</h4>
                  <div className={styles.reviewProductList}>
                    {form.PRODUCTS.map((p) => (
                      <div key={p.PRODUCT_ID} className={styles.reviewProductItem}>
                        <span>{p.PRODUCT_CODE} — {p.PRODUCT_NAME}</span>
                        <span className={styles.reviewPrice}>₹{Number(p.UNIT_PRICE || 0).toLocaleString()} / {p.UNIT || "unit"}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <p className={styles.reviewDisclaimer}>
                By submitting, you confirm that all information provided is accurate. Our team will verify and respond within 2 business days.
              </p>
            </div>
          )}
        </div>

        {/* Navigation */}
        <div className={styles.footer}>
          <button className={styles.backBtn} onClick={handleBack} disabled={step === 1 || saving || submitting}>
            ← Back
          </button>
          <div className={styles.stepIndicator}>{step} / {TOTAL_STEPS}</div>
          {step < TOTAL_STEPS ? (
            <button className={styles.nextBtn} onClick={handleNext} disabled={saving}>
              {saving ? "Saving…" : "Next →"}
            </button>
          ) : (
            <button className={styles.submitBtn} onClick={handleSubmit} disabled={submitting}>
              {submitting ? "Submitting…" : "Submit Registration"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
