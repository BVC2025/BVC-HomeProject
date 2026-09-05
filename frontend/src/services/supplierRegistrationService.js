import API from "./api";

export const supplierRegistrationService = {
  getRegistration: (token) =>
    API.get(`/api/supplier-onboarding/register/${token}`),

  // Maps the page's UPPERCASE form shape to the backend's DraftSaveRequest snake_case schema.
  // Backend expects flat fields at JSON root (company_name, contact_person, etc.) and a
  // `products` array of DraftProductRow objects — not the nested FORM_DATA/PRODUCTS_DATA
  // wrapper the page uses internally.
  getCustomFields: (token) =>
    API.get(`/api/supplier-onboarding/register/${token}/custom-fields`),

  saveDraft: (token, { FORM_DATA: form = {}, PRODUCTS_DATA: products = [], CF_VALUES: cfVals = null }) => {
    const num = (v) => (v !== "" && v != null ? parseFloat(v) : null);
    const int = (v) => (v !== "" && v != null ? parseInt(v, 10) : null);
    const arr = (v) => (Array.isArray(v) && v.length ? v : null);
    const body = {
      company_name:        form.COMPANY_NAME         || null,
      registration_no:     form.REGISTRATION_NO      || null,
      company_type:        form.COMPANY_TYPE          || null,
      contact_person:      form.CONTACT_PERSON_NAME   || null,
      email:               form.EMAIL                || null,
      phone:               form.PHONE                || null,
      alternate_email:     form.ALTERNATE_EMAIL       || null,
      alternate_phone:     form.ALTERNATE_PHONE       || null,
      website:             form.WEBSITE               || null,
      address_line1:       form.ADDRESS               || null,
      address_line2:       form.ADDRESS_LINE2         || null,
      city:                form.CITY                  || null,
      state:               form.STATE                 || null,
      pincode:             form.PIN_CODE              || null,
      gst_number:          form.GST_NUMBER            || null,
      pan_number:          form.PAN_NUMBER             || null,
      bank_name:           form.BANK_NAME             || null,
      account_number:      form.ACCOUNT_NUMBER        || null,
      ifsc_code:           form.IFSC_CODE             || null,
      payment_terms:       form.PAYMENT_TERMS         || null,
      years_in_business:   num(form.YEARS_IN_BUSINESS),
      annual_turnover:     num(form.ANNUAL_TURNOVER),
      employee_count:      int(form.EMPLOYEE_COUNT),
      certifications:      arr(form.CERTIFICATIONS),
      advance_percent:     num(form.ADVANCE_PERCENT),
      credit_days:         int(form.CREDIT_DAYS),
      minimum_order_value: num(form.MINIMUM_ORDER_VALUE),
      lead_time_days:      int(form.LEAD_TIME_DAYS),
      delivery_modes:      arr(form.DELIVERY_MODES),
      products: (products || [])
        .filter((p) => p.PRODUCT_NAME)
        .map((p) => ({
          product_name:   p.PRODUCT_NAME,
          product_id:     (p.PRODUCT_ID && !String(p.PRODUCT_ID).startsWith("restored-"))
                            ? p.PRODUCT_ID : null,
          unit:           p.UNIT || "PCS",
          unit_price:     num(p.UNIT_PRICE),
          moq:            num(p.MOQ),
          lead_time_days: int(p.LEAD_TIME_DAYS),
        })),
    };
    if (cfVals !== null) {
      body.cf_values = cfVals;
    }
    return API.post(`/api/supplier-onboarding/register/${token}/save-draft`, body);
  },

  submitRegistration: (token) =>
    API.post(`/api/supplier-onboarding/register/${token}/submit`),

  // The three lookups below back the public registration page's
  // product-selection step. They must stay token-scoped and unauthenticated
  // — the equivalent RBAC-protected /api/products and /api/inventory-categories
  // endpoints return a 401/403 for an anonymous supplier, which the shared
  // axios instance's response interceptor treats as "session ended" and
  // force-redirects to /login, even on this public, token-gated page.
  searchProducts: (token, search) =>
    API.get(`/api/supplier-onboarding/register/${token}/products`, { params: { search } }),

  getCategories: (token) =>
    API.get(`/api/supplier-onboarding/register/${token}/categories`),

  getProductsByCategory: (token, categoryId) =>
    API.get(`/api/supplier-onboarding/register/${token}/products`, {
      params: { category_id: categoryId },
    }),
};
