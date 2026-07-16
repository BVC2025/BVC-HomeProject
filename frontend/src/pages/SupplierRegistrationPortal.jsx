import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import PMSelect from "../components/pm/PMSelect";
import { CustomFieldsSection } from "../components/pm";
import { supplierRegistrationService } from "../services/supplierRegistrationService";
import styles from "./SupplierRegistrationPortal.module.css";

const TOTAL_STEPS = 6;

// ── Validation patterns ──────────────────────────────────────────────────────
const RE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RE_PHONE = /^[6-9]\d{9}$/;           // Indian mobile: 10 digits, starts 6–9
const RE_GST = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;   // 15-char GST
const RE_PIN = /^[1-9][0-9]{5}$/;        // Indian PIN: 6 digits, non-zero start

const DELIVERY_MODE_OPTIONS = ["Road", "Rail", "Air", "Sea", "Courier", "Hand Delivery"];

const COMPANY_TYPE_OPTIONS = [
  "Sole Proprietorship", "Partnership", "LLP", "Private Limited",
  "Public Limited", "OPC", "Co-operative", "Government", "Other",
];

const PAYMENT_TERMS_OPTIONS = ["Advance", "NET 15", "NET 30", "NET 45", "NET 60", "COD"];

const EMPTY_FORM = {
  // Step 1 — Company Info
  COMPANY_NAME: "", REGISTRATION_NO: "", GST_NUMBER: "", COMPANY_TYPE: "",
  ADDRESS: "", ADDRESS_LINE2: "", CITY: "", STATE: "", PIN_CODE: "",
  // Step 2 — Contact
  CONTACT_PERSON_NAME: "", EMAIL: "", PHONE: "",
  ALTERNATE_EMAIL: "", ALTERNATE_PHONE: "", WEBSITE: "",
  // Step 3 — Business Profile
  YEARS_IN_BUSINESS: "", ANNUAL_TURNOVER: "", EMPLOYEE_COUNT: "", CERTIFICATIONS: [],
  PAN_NUMBER: "",
  // Step 4 — Financials
  ADVANCE_PERCENT: 0, CREDIT_DAYS: 30, MINIMUM_ORDER_VALUE: 0, LEAD_TIME_DAYS: 7, DELIVERY_MODES: [],
  // Step 4 — Banking
  BANK_NAME: "", ACCOUNT_NUMBER: "", IFSC_CODE: "", PAYMENT_TERMS: "",
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

// ── Step components (memo-wrapped so only the active step re-renders) ────────

const Step1CompanyInfo = memo(function Step1CompanyInfo({ form, errors, setField }) {
  return (
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
        <input className={`${styles.input} ${errors.GST_NUMBER ? styles.inputError : ""}`} value={form.GST_NUMBER} onChange={(e) => setField("GST_NUMBER", e.target.value.toUpperCase())} placeholder="22AAAAA0000A1Z5" maxLength={15} />
        {errors.GST_NUMBER && <span className={styles.err}>{errors.GST_NUMBER}</span>}
      </div>
      <div className={styles.fg}>
        <label>Company Type</label>
        <select className={styles.select} value={form.COMPANY_TYPE} onChange={(e) => setField("COMPANY_TYPE", e.target.value)}>
          <option value="">Select type…</option>
          {COMPANY_TYPE_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
      <div className={`${styles.fg} ${styles.full}`}>
        <label>Address Line 1</label>
        <textarea className={styles.textarea} value={form.ADDRESS} onChange={(e) => setField("ADDRESS", e.target.value)} placeholder="Street address, building, area" rows={2} />
      </div>
      <div className={`${styles.fg} ${styles.full}`}>
        <label>Address Line 2</label>
        <input className={styles.input} value={form.ADDRESS_LINE2} onChange={(e) => setField("ADDRESS_LINE2", e.target.value)} placeholder="Floor, suite, landmark (optional)" />
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
        <input className={`${styles.input} ${errors.PIN_CODE ? styles.inputError : ""}`} value={form.PIN_CODE} onChange={(e) => setField("PIN_CODE", e.target.value)} placeholder="400001" maxLength={6} />
        {errors.PIN_CODE && <span className={styles.err}>{errors.PIN_CODE}</span>}
      </div>
    </div>
  );
});

const Step2Contact = memo(function Step2Contact({ form, errors, setField }) {
  return (
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
        <input className={`${styles.input} ${errors.ALTERNATE_EMAIL ? styles.inputError : ""}`} type="email" value={form.ALTERNATE_EMAIL} onChange={(e) => setField("ALTERNATE_EMAIL", e.target.value)} placeholder="alt@company.com" />
        {errors.ALTERNATE_EMAIL && <span className={styles.err}>{errors.ALTERNATE_EMAIL}</span>}
      </div>
      <div className={styles.fg}>
        <label>Alternate Phone</label>
        <input className={`${styles.input} ${errors.ALTERNATE_PHONE ? styles.inputError : ""}`} value={form.ALTERNATE_PHONE} onChange={(e) => setField("ALTERNATE_PHONE", e.target.value)} placeholder="+91 9XXXXXXXXX" />
        {errors.ALTERNATE_PHONE && <span className={styles.err}>{errors.ALTERNATE_PHONE}</span>}
      </div>
      <div className={`${styles.fg} ${styles.full}`}>
        <label>Website</label>
        <input className={styles.input} value={form.WEBSITE} onChange={(e) => setField("WEBSITE", e.target.value)} placeholder="https://www.yourcompany.com" />
      </div>
    </div>
  );
});

const Step3Business = memo(function Step3Business({ form, errors, setField, certInput, setCertInput, addCert, removeCert, certError }) {
  return (
    <div className={styles.formGrid}>
      <div className={styles.fg}>
        <label>Years in Business</label>
        <input className={`${styles.input} ${errors.YEARS_IN_BUSINESS ? styles.inputError : ""}`} type="number" min={0} max={200} value={form.YEARS_IN_BUSINESS} onChange={(e) => setField("YEARS_IN_BUSINESS", e.target.value)} placeholder="e.g. 10" />
        {errors.YEARS_IN_BUSINESS && <span className={styles.err}>{errors.YEARS_IN_BUSINESS}</span>}
      </div>
      <div className={styles.fg}>
        <label>Annual Turnover (₹)</label>
        <input className={`${styles.input} ${errors.ANNUAL_TURNOVER ? styles.inputError : ""}`} type="number" min={0} value={form.ANNUAL_TURNOVER} onChange={(e) => setField("ANNUAL_TURNOVER", e.target.value)} placeholder="e.g. 5000000" />
        {errors.ANNUAL_TURNOVER && <span className={styles.err}>{errors.ANNUAL_TURNOVER}</span>}
      </div>
      <div className={styles.fg}>
        <label>Employee Count</label>
        <input className={`${styles.input} ${errors.EMPLOYEE_COUNT ? styles.inputError : ""}`} type="number" min={0} step={1} value={form.EMPLOYEE_COUNT} onChange={(e) => setField("EMPLOYEE_COUNT", e.target.value)} placeholder="e.g. 50" />
        {errors.EMPLOYEE_COUNT && <span className={styles.err}>{errors.EMPLOYEE_COUNT}</span>}
      </div>
      <div className={styles.fg}>
        <label>PAN Number</label>
        <input className={styles.input} value={form.PAN_NUMBER} onChange={(e) => setField("PAN_NUMBER", e.target.value.toUpperCase())} placeholder="e.g. AAAAA9999A" maxLength={10} />
      </div>
      <div className={`${styles.fg} ${styles.full}`}>
        <label>Certifications</label>
        <div className={styles.tagInputRow}>
          <input className={`${styles.input} ${certError ? styles.inputError : ""}`} value={certInput} onChange={(e) => { setCertInput(e.target.value); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addCert(); } }} placeholder="e.g. ISO 9001, BIS, MSME" />
          <button className={styles.addTagBtn} onClick={addCert} type="button">Add</button>
        </div>
        {certError && <span className={styles.err}>{certError}</span>}
        {form.CERTIFICATIONS?.length > 0 && (
          <div className={styles.tagList}>
            {form.CERTIFICATIONS.map((c, i) => (
              <span key={i} className={styles.tag}>{c}<button onClick={() => removeCert(i)} className={styles.tagRemove}>×</button></span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

const Step4Financials = memo(function Step4Financials({ form, errors, setField, toggleDeliveryMode }) {
  return (
    <div className={styles.formGrid}>
      <div className={styles.fg}>
        <label>Advance Payment %</label>
        <input className={`${styles.input} ${errors.ADVANCE_PERCENT ? styles.inputError : ""}`} type="number" min={0} max={100} value={form.ADVANCE_PERCENT} onChange={(e) => setField("ADVANCE_PERCENT", parseFloat(e.target.value) || 0)} />
        {errors.ADVANCE_PERCENT && <span className={styles.err}>{errors.ADVANCE_PERCENT}</span>}
      </div>
      <div className={styles.fg}>
        <label>Credit Days</label>
        <input className={`${styles.input} ${errors.CREDIT_DAYS ? styles.inputError : ""}`} type="number" min={0} value={form.CREDIT_DAYS} onChange={(e) => setField("CREDIT_DAYS", parseInt(e.target.value, 10) || 0)} />
        {errors.CREDIT_DAYS && <span className={styles.err}>{errors.CREDIT_DAYS}</span>}
      </div>
      <div className={styles.fg}>
        <label>Minimum Order Value (₹)</label>
        <input className={`${styles.input} ${errors.MINIMUM_ORDER_VALUE ? styles.inputError : ""}`} type="number" min={0} value={form.MINIMUM_ORDER_VALUE} onChange={(e) => setField("MINIMUM_ORDER_VALUE", parseFloat(e.target.value) || 0)} />
        {errors.MINIMUM_ORDER_VALUE && <span className={styles.err}>{errors.MINIMUM_ORDER_VALUE}</span>}
      </div>
      <div className={styles.fg}>
        <label>Lead Time (days)</label>
        <input className={`${styles.input} ${errors.LEAD_TIME_DAYS ? styles.inputError : ""}`} type="number" min={0} value={form.LEAD_TIME_DAYS} onChange={(e) => setField("LEAD_TIME_DAYS", parseInt(e.target.value, 10) || 0)} />
        {errors.LEAD_TIME_DAYS && <span className={styles.err}>{errors.LEAD_TIME_DAYS}</span>}
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
      <div className={`${styles.fg} ${styles.full}`}>
        <div className={styles.sectionDivider}>Banking Details</div>
      </div>
      <div className={styles.fg}>
        <label>Bank Name</label>
        <input className={styles.input} value={form.BANK_NAME} onChange={(e) => setField("BANK_NAME", e.target.value)} placeholder="e.g. State Bank of India" />
      </div>
      <div className={styles.fg}>
        <label>Account Number</label>
        <input className={styles.input} value={form.ACCOUNT_NUMBER} onChange={(e) => setField("ACCOUNT_NUMBER", e.target.value)} placeholder="Bank account number" />
      </div>
      <div className={styles.fg}>
        <label>IFSC Code</label>
        <input className={styles.input} value={form.IFSC_CODE} onChange={(e) => setField("IFSC_CODE", e.target.value.toUpperCase())} placeholder="e.g. SBIN0001234" maxLength={11} />
      </div>
      <div className={styles.fg}>
        <label>Payment Terms</label>
        <select className={styles.select} value={form.PAYMENT_TERMS} onChange={(e) => setField("PAYMENT_TERMS", e.target.value)}>
          <option value="">Select terms…</option>
          {PAYMENT_TERMS_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      </div>
    </div>
  );
});

const Step5Products = memo(function Step5Products({
  form, errors,
  categories, categoriesLoading,
  selectedCategoryId, onCategoryChange,
  productsForCategory, productsLoading,
  addProduct, removeProduct, updateProduct,
}) {
  const [selectedProductId, setSelectedProductId] = useState("");

  // Reset product selection whenever the active category changes
  useEffect(() => { setSelectedProductId(""); }, [selectedCategoryId]);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c.ID, label: c.NAME })),
    [categories],
  );

  // Exclude products already added to the form so they don't appear in the dropdown
  const productOptions = useMemo(
    () =>
      productsForCategory
        .filter((p) => !form.PRODUCTS.some((fp) => fp.PRODUCT_ID === p.ID))
        .map((p) => ({
          value: p.ID,
          label: `${p.PRODUCT_CODE} — ${p.PRODUCT_NAME} (${p.UNIT})`,
        })),
    [productsForCategory, form.PRODUCTS],
  );

  const handleProductSelect = useCallback(
    (productId) => {
      if (!productId) return;
      const product = productsForCategory.find((p) => p.ID === productId);
      if (product) {
        addProduct(product);
        setSelectedProductId(""); // reset trigger to placeholder after adding
      }
    },
    [productsForCategory, addProduct],
  );

  const productPlaceholder =
    !selectedCategoryId
      ? "Select a category first"
      : productsLoading
      ? "Loading products…"
      : productOptions.length === 0
      ? "No available products in this category"
      : "Search & select a product";

  return (
    <div className={styles.productStep}>
      {/* ── Category → Product selectors ────────────────────── */}
      <div className={styles.productSelectRow}>
        <div className={styles.selectGroup}>
          <label>Category</label>
          <PMSelect
            value={selectedCategoryId}
            onChange={onCategoryChange}
            options={categoryOptions}
            placeholder={categoriesLoading ? "Loading categories…" : "Select a category…"}
            searchPlaceholder="Search categories…"
            disabled={categoriesLoading}
            allowClear
          />
        </div>
        <div className={styles.selectGroup}>
          <label>Product</label>
          <PMSelect
            value={selectedProductId}
            onChange={handleProductSelect}
            options={productOptions}
            placeholder={productPlaceholder}
            searchPlaceholder="Search products…"
            disabled={!selectedCategoryId || productsLoading}
          />
        </div>
      </div>

      {/* ── Added products list ──────────────────────────────── */}
      {form.PRODUCTS.length === 0 ? (
        <div className={styles.noProducts}>
          <p>Select a category and product above. You can register multiple products.</p>
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
  );
});

const Step6Review = memo(function Step6Review({ form, cfFields = [], cfValues = {} }) {
  return (
    <div className={styles.reviewWrap}>
      <div className={styles.reviewSection}>
        <h4 className={styles.reviewSectionTitle}>Company Information</h4>
        <div className={styles.reviewFields}>
          <FieldRow label="Company Name" value={form.COMPANY_NAME} />
          <FieldRow label="Registration No." value={form.REGISTRATION_NO} />
          <FieldRow label="GST Number" value={form.GST_NUMBER} />
          <FieldRow label="PAN Number" value={form.PAN_NUMBER} />
          <FieldRow label="Company Type" value={form.COMPANY_TYPE} />
          <FieldRow label="Address Line 1" value={form.ADDRESS} />
          <FieldRow label="Address Line 2" value={form.ADDRESS_LINE2} />
          <FieldRow label="City / State / PIN" value={[form.CITY, form.STATE, form.PIN_CODE].filter(Boolean).join(", ")} />
        </div>
      </div>
      <div className={styles.reviewSection}>
        <h4 className={styles.reviewSectionTitle}>Contact Details</h4>
        <div className={styles.reviewFields}>
          <FieldRow label="Contact Person" value={form.CONTACT_PERSON_NAME} />
          <FieldRow label="Email" value={form.EMAIL} />
          <FieldRow label="Phone" value={form.PHONE} />
          <FieldRow label="Alternate Email" value={form.ALTERNATE_EMAIL} />
          <FieldRow label="Alternate Phone" value={form.ALTERNATE_PHONE} />
          <FieldRow label="Website" value={form.WEBSITE} />
        </div>
      </div>
      <div className={styles.reviewSection}>
        <h4 className={styles.reviewSectionTitle}>Business Profile</h4>
        <div className={styles.reviewFields}>
          <FieldRow label="Years in Business" value={form.YEARS_IN_BUSINESS} />
          <FieldRow label="Annual Turnover" value={form.ANNUAL_TURNOVER ? `₹${Number(form.ANNUAL_TURNOVER).toLocaleString()}` : null} />
          <FieldRow label="Employee Count" value={form.EMPLOYEE_COUNT} />
          {form.CERTIFICATIONS?.length > 0 && <FieldRow label="Certifications" value={form.CERTIFICATIONS.join(", ")} />}
        </div>
      </div>
      <div className={styles.reviewSection}>
        <h4 className={styles.reviewSectionTitle}>Financials & Logistics</h4>
        <div className={styles.reviewFields}>
          <FieldRow label="Advance Payment %" value={form.ADVANCE_PERCENT} />
          <FieldRow label="Credit Days" value={form.CREDIT_DAYS} />
          <FieldRow label="Min. Order Value" value={form.MINIMUM_ORDER_VALUE ? `₹${Number(form.MINIMUM_ORDER_VALUE).toLocaleString()}` : null} />
          <FieldRow label="Lead Time (days)" value={form.LEAD_TIME_DAYS} />
          <FieldRow label="Delivery Modes" value={form.DELIVERY_MODES?.join(", ")} />
          <FieldRow label="Payment Terms" value={form.PAYMENT_TERMS} />
        </div>
      </div>
      {(form.BANK_NAME || form.ACCOUNT_NUMBER || form.IFSC_CODE) && (
        <div className={styles.reviewSection}>
          <h4 className={styles.reviewSectionTitle}>Banking Details</h4>
          <div className={styles.reviewFields}>
            <FieldRow label="Bank Name" value={form.BANK_NAME} />
            <FieldRow label="Account Number" value={form.ACCOUNT_NUMBER} />
            <FieldRow label="IFSC Code" value={form.IFSC_CODE} />
          </div>
        </div>
      )}
      {form.PRODUCTS.length > 0 && (
        <div className={styles.reviewSection}>
          <h4 className={styles.reviewSectionTitle}>Products ({form.PRODUCTS.length})</h4>
          <div className={styles.reviewProductList}>
            {form.PRODUCTS.map((p) => (
              <div key={p.PRODUCT_ID} className={styles.reviewProductItem}>
                <span>{p.PRODUCT_CODE} — {p.PRODUCT_NAME}</span>
                <span className={styles.reviewPrice}>₹{Number(p.UNIT_PRICE || 0).toLocaleString()} / {p.UNIT || "unit"}</span>
                {p.MOQ && <span className={styles.reviewMeta}>MOQ: {p.MOQ}</span>}
                {p.LEAD_TIME_DAYS && <span className={styles.reviewMeta}>Lead: {p.LEAD_TIME_DAYS}d</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {Array.isArray(cfFields) && cfFields.length > 0 &&
        cfFields.some((f) => cfValues[f.ID] !== undefined && cfValues[f.ID] !== null && cfValues[f.ID] !== "") && (
        <div className={styles.reviewSection}>
          <h4 className={styles.reviewSectionTitle}>Additional Information</h4>
          <div className={styles.reviewFields}>
            {cfFields.map((field) => {
              const val = cfValues[field.ID];
              if (val === undefined || val === null || val === "") return null;
              const display = Array.isArray(val) ? val.join(", ") : String(val);
              return <FieldRow key={field.ID} label={field.FIELD_NAME} value={display} />;
            })}
          </div>
        </div>
      )}
      <p className={styles.reviewDisclaimer}>
        By submitting, you confirm that all information provided is accurate. Our team will verify and respond within 2 business days.
      </p>
    </div>
  );
});

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
  const [vendorId, setVendorId] = useState(1);
  const [categories, setCategories] = useState([]);
  const [categoriesLoading, setCategoriesLoading] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [productsForCategory, setProductsForCategory] = useState([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [certInput, setCertInput] = useState("");
  const [certError, setCertError] = useState("");
  const [cfFields, setCfFields] = useState([]);
  const [cfValues, setCfValues] = useState({});
  const categoriesFetchedRef = useRef(false);

  // ── Load token ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const res = await supplierRegistrationService.getRegistration(token);
        // Backend returns flat keys: invitation_id, status, invited_company_name, etc.
        const data = res.data;
        setInvitation({
          INVITED_COMPANY_NAME: data.invited_company_name,
          STATUS: data.status,
        });
        if (data.vendor_id) setVendorId(data.vendor_id);
        const draft = data.draft;
        if (draft?.form_data) {
          const fd = draft.form_data;
          setForm((prev) => ({
            ...prev,
            COMPANY_NAME: fd.company_name || "",
            REGISTRATION_NO: fd.registration_no || "",
            COMPANY_TYPE: fd.company_type || "",
            CONTACT_PERSON_NAME: fd.contact_person || "",
            EMAIL: fd.email || "",
            PHONE: fd.phone || "",
            ALTERNATE_EMAIL: fd.alternate_email || "",
            ALTERNATE_PHONE: fd.alternate_phone || "",
            WEBSITE: fd.website || "",
            ADDRESS: fd.address_line1 || "",
            ADDRESS_LINE2: fd.address_line2 || "",
            CITY: fd.city || "",
            STATE: fd.state || "",
            PIN_CODE: fd.pincode || "",
            GST_NUMBER: fd.gst_number || "",
            PAN_NUMBER: fd.pan_number || "",
            BANK_NAME: fd.bank_name || "",
            ACCOUNT_NUMBER: fd.account_number || "",
            IFSC_CODE: fd.ifsc_code || "",
            PAYMENT_TERMS: fd.payment_terms || "",
            YEARS_IN_BUSINESS: fd.years_in_business != null ? String(fd.years_in_business) : "",
            ANNUAL_TURNOVER: fd.annual_turnover != null ? String(fd.annual_turnover) : "",
            EMPLOYEE_COUNT: fd.employee_count != null ? String(fd.employee_count) : "",
            CERTIFICATIONS: Array.isArray(fd.certifications) ? fd.certifications : [],
            ADVANCE_PERCENT: fd.advance_percent != null ? fd.advance_percent : 0,
            CREDIT_DAYS: fd.credit_days != null ? fd.credit_days : 30,
            MINIMUM_ORDER_VALUE: fd.minimum_order_value != null ? fd.minimum_order_value : 0,
            LEAD_TIME_DAYS: fd.lead_time_days != null ? fd.lead_time_days : 7,
            DELIVERY_MODES: Array.isArray(fd.delivery_modes) ? fd.delivery_modes : [],
            PRODUCTS: (draft.products_data || []).map((p, i) => ({
              PRODUCT_ID: p.product_id || `restored-${i}`,
              PRODUCT_NAME: p.product_name || "",
              PRODUCT_CODE: "",
              UNIT: p.unit || "PCS",
              UNIT_PRICE: p.unit_price != null ? String(p.unit_price) : "",
              MOQ: p.moq != null ? String(p.moq) : "",
              LEAD_TIME_DAYS: p.lead_time_days != null ? String(p.lead_time_days) : "",
            })),
          }));
          // Restore custom field values from draft if present
          if (fd.cf_values && typeof fd.cf_values === "object") {
            setCfValues(fd.cf_values);
          }
          // Resume from last saved step
          if ((draft.products_data || []).length > 0) setStep(5);
          else if (fd.contact_person) setStep(2);
        }
        if (["SUBMITTED", "APPROVED"].includes(data.status)) {
          setTokenError(data.status === "APPROVED" ? "approved" : "submitted");
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

  // ── Load categories once after the invitation token is validated ────────
  useEffect(() => {
    if (!invitation || categoriesFetchedRef.current) return;
    categoriesFetchedRef.current = true;
    setCategoriesLoading(true);
    supplierRegistrationService
      .getCategories(vendorId)
      .then((res) => setCategories((res.data || []).filter((c) => c.IS_ACTIVE === true)))
      .catch(() => setCategories([]))
      .finally(() => setCategoriesLoading(false));
  }, [invitation, vendorId]);

  // ── Load custom field definitions after invitation is validated ─────────
  useEffect(() => {
    if (!invitation || !token) return;
    supplierRegistrationService
      .getCustomFields(token)
      .then((res) => setCfFields(res.data || []))
      .catch(() => setCfFields([]));
  }, [invitation, token]);

  // ── Load products whenever the selected category changes ─────────────────
  useEffect(() => {
    if (!selectedCategoryId) { setProductsForCategory([]); return; }
    setProductsLoading(true);
    supplierRegistrationService
      .getProductsByCategory(vendorId, selectedCategoryId)
      .then((res) => setProductsForCategory(res.data?.items || []))
      .catch(() => setProductsForCategory([]))
      .finally(() => setProductsLoading(false));
  }, [selectedCategoryId, vendorId]);

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
    const val = certInput.trim();
    if (!val) return;
    const lower = val.toLowerCase();
    setForm((prev) => {
      if ((prev.CERTIFICATIONS || []).some((c) => c.toLowerCase() === lower)) {
        setCertError("This certification has already been added.");
        return prev;
      }
      setCertError("");
      return { ...prev, CERTIFICATIONS: [...(prev.CERTIFICATIONS || []), val] };
    });
    setCertInput("");
  }, [certInput]);

  const removeCert = useCallback((i) => {
    setForm((prev) => ({ ...prev, CERTIFICATIONS: prev.CERTIFICATIONS.filter((_, j) => j !== i) }));
  }, []);

  const handleCfChange = useCallback((fieldId, value) => {
    setCfValues((prev) => ({ ...prev, [fieldId]: value }));
  }, []);

  const handleCategoryChange = useCallback((id) => {
    setSelectedCategoryId(id);
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
      if (!form.COMPANY_NAME.trim())
        e.COMPANY_NAME = "Company name is required.";
      if (form.GST_NUMBER.trim() && !RE_GST.test(form.GST_NUMBER.trim()))
        e.GST_NUMBER = "Invalid GST number. Must be 15 characters (e.g. 22AAAAA0000A1Z5).";
      if (form.PIN_CODE.trim() && !RE_PIN.test(form.PIN_CODE.trim()))
        e.PIN_CODE = "PIN code must be 6 digits and cannot start with 0.";
    }

    if (stepNum === 2) {
      if (!form.CONTACT_PERSON_NAME.trim())
        e.CONTACT_PERSON_NAME = "Contact person name is required.";
      if (!form.EMAIL.trim())
        e.EMAIL = "Email address is required.";
      else if (!RE_EMAIL.test(form.EMAIL.trim()))
        e.EMAIL = "Please enter a valid email address.";
      if (!form.PHONE.trim())
        e.PHONE = "Mobile number is required.";
      else if (!RE_PHONE.test(form.PHONE.trim()))
        e.PHONE = "Enter a valid 10-digit mobile number starting with 6–9.";
      if (form.ALTERNATE_EMAIL.trim() && !RE_EMAIL.test(form.ALTERNATE_EMAIL.trim()))
        e.ALTERNATE_EMAIL = "Please enter a valid email address.";
      else if (form.ALTERNATE_EMAIL.trim() && form.ALTERNATE_EMAIL.trim().toLowerCase() === form.EMAIL.trim().toLowerCase())
        e.ALTERNATE_EMAIL = "Alternate email must be different from the primary email.";
      if (form.ALTERNATE_PHONE.trim() && !RE_PHONE.test(form.ALTERNATE_PHONE.trim()))
        e.ALTERNATE_PHONE = "Enter a valid 10-digit mobile number starting with 6–9.";
      else if (form.ALTERNATE_PHONE.trim() && form.ALTERNATE_PHONE.trim() === form.PHONE.trim())
        e.ALTERNATE_PHONE = "Alternate phone must be different from the primary phone number.";
    }

    if (stepNum === 3) {
      const yib = form.YEARS_IN_BUSINESS;
      if (yib !== "" && (isNaN(Number(yib)) || Number(yib) < 0 || Number(yib) > 200))
        e.YEARS_IN_BUSINESS = "Enter a valid number of years (0–200).";
      const at = form.ANNUAL_TURNOVER;
      if (at !== "" && (isNaN(Number(at)) || Number(at) < 0))
        e.ANNUAL_TURNOVER = "Enter a valid positive turnover amount.";
      const ec = form.EMPLOYEE_COUNT;
      if (ec !== "" && (isNaN(Number(ec)) || Number(ec) < 0 || !Number.isInteger(Number(ec))))
        e.EMPLOYEE_COUNT = "Enter a valid whole number for employee count.";
      // Validate required custom fields
      const missingCf = cfFields.filter((f) => f.IS_REQUIRED && !cfValues[f.ID]);
      if (missingCf.length > 0) {
        e.cf_required = `Please fill in: ${missingCf.map((f) => f.FIELD_NAME).join(", ")}.`;
      }
    }

    if (stepNum === 4) {
      if (form.ADVANCE_PERCENT < 0 || form.ADVANCE_PERCENT > 100)
        e.ADVANCE_PERCENT = "Advance % must be between 0 and 100.";
      if (form.CREDIT_DAYS < 0)
        e.CREDIT_DAYS = "Credit days must be 0 or more.";
      if (form.MINIMUM_ORDER_VALUE < 0)
        e.MINIMUM_ORDER_VALUE = "Minimum order value must be 0 or more.";
      if (form.LEAD_TIME_DAYS < 0)
        e.LEAD_TIME_DAYS = "Lead time must be 0 or more days.";
    }

    if (stepNum === 5) {
      form.PRODUCTS.forEach((p) => {
        if (!p.UNIT_PRICE || parseFloat(p.UNIT_PRICE) <= 0)
          e[`price_${p.PRODUCT_ID}`] = "Unit price is required and must be greater than 0.";
      });
    }

    setErrors(e);
    return Object.keys(e).length === 0;
  }, [form, cfFields, cfValues]);

  // ── Save draft ──────────────────────────────────────────────────────────
  const saveDraft = useCallback(async (silent = false) => {
    if (!silent) setSaving(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await supplierRegistrationService.saveDraft(token, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
        CF_VALUES: cfValues,
      });
    } catch {
      // silent failure on auto-save
    } finally {
      if (!silent) setSaving(false);
    }
  }, [form, token, cfValues]);

  const handleNext = useCallback(async () => {
    if (!validate(step)) return;
    setSaving(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await supplierRegistrationService.saveDraft(token, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
        CF_VALUES: cfValues,
      });
    } catch {
      // non-blocking — still advance
    } finally {
      setSaving(false);
    }
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }, [step, validate, form, token, cfValues]);

  const handleBack = useCallback(() => setStep((s) => Math.max(s - 1, 1)), []);

  const handleSubmit = useCallback(async () => {
    if (!validate(step)) return;
    setSubmitting(true);
    try {
      const { PRODUCTS, ...formData } = form;
      await supplierRegistrationService.saveDraft(token, {
        FORM_DATA: formData,
        PRODUCTS_DATA: PRODUCTS,
        CF_VALUES: cfValues,
      });
      await supplierRegistrationService.submitRegistration(token);
      setSubmitted(true);

      console.log("--------submitted------")
    } catch (e) {
      alert(e?.response?.data?.detail || "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }, [form, token, step, validate, cfValues]);

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

          {step === 1 && <Step1CompanyInfo form={form} errors={errors} setField={setField} />}
          {step === 2 && <Step2Contact form={form} errors={errors} setField={setField} />}
          {step === 3 && <Step3Business form={form} errors={errors} setField={setField} certInput={certInput} setCertInput={setCertInput} addCert={addCert} removeCert={removeCert} certError={certError} />}
          {step === 3 && cfFields.length > 0 && (
            <div className={styles.cfSection}>
              <p className={styles.cfSectionTitle}>Additional Required Information</p>
              <CustomFieldsSection
                fields={cfFields}
                values={cfValues}
                onChange={handleCfChange}
              />
              {errors.cf_required && (
                <p className={styles.cfError}>{errors.cf_required}</p>
              )}
            </div>
          )}
          {step === 4 && <Step4Financials form={form} errors={errors} setField={setField} toggleDeliveryMode={toggleDeliveryMode} />}
          {step === 5 && (
            <Step5Products
              form={form}
              errors={errors}
              categories={categories}
              categoriesLoading={categoriesLoading}
              selectedCategoryId={selectedCategoryId}
              onCategoryChange={handleCategoryChange}
              productsForCategory={productsForCategory}
              productsLoading={productsLoading}
              addProduct={addProduct}
              removeProduct={removeProduct}
              updateProduct={updateProduct}
            />
          )}
          {step === 6 && <Step6Review form={form} cfFields={cfFields} cfValues={cfValues} />}
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
