/**
 * Centralized form validation utility for Supplier & Inventory Management pages.
 *
 * Usage:
 *   import { validateForm, clearFieldError } from "../utils/formValidation";
 *
 *   const { isValid, errors } = validateForm(SUPPLIER_RULES, formData);
 *   if (!isValid) { setErrors(errors); return; }
 */

// ── Primitive validators ────────────────────────────────────────────────────
// Each returns null on pass, or a human-readable string on failure.

function _required(value) {
  const str = value === null || value === undefined ? "" : String(value).trim();
  return str.length > 0 ? null : "This field is required.";
}

function _email(value) {
  if (!value || String(value).trim() === "") return null; // optional
  // RFC-5322 simplified
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  return re.test(String(value).trim()) ? null : "Enter a valid email address (e.g. name@company.com).";
}

function _phone(value) {
  if (!value || String(value).trim() === "") return null; // optional
  // Strip common formatting: spaces, dashes, dots, parentheses
  const cleaned = String(value).replace(/[\s\-().]/g, "");
  // Must be 7-15 digits, optional leading +
  const re = /^\+?[1-9]\d{6,14}$/;
  return re.test(cleaned) ? null : "Enter a valid phone number (7–15 digits, e.g. +91 9876543210).";
}

function _url(value) {
  if (!value || String(value).trim() === "") return null; // optional
  const raw = String(value).trim();
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error();
    return null;
  } catch {
    return "Enter a valid URL (e.g. https://example.com).";
  }
}

function _gst(value) {
  if (!value || String(value).trim() === "") return null; // optional
  // Indian GST: 2 digits + 5 alpha + 4 digits + 1 alpha + 1 alphanumeric + Z + 1 alphanumeric
  const re = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
  return re.test(String(value).trim().toUpperCase())
    ? null
    : "Enter a valid 15-character GST number (e.g. 22AAAAA0000A1Z5).";
}

function _hsnCode(value) {
  if (!value || String(value).trim() === "") return null; // optional
  const re = /^\d{4,8}$/;
  return re.test(String(value).trim())
    ? null
    : "HSN code must be 4 to 8 numeric digits (e.g. 7318 or 73181590).";
}

function _categoryCode(value) {
  if (!value || String(value).trim() === "") return null; // optional
  // Letters, digits, hyphens, underscores — no leading hyphen
  const re = /^[A-Z0-9][A-Z0-9\-_]*$/;
  return re.test(String(value).trim().toUpperCase())
    ? null
    : "Code can only contain letters, numbers, hyphens, and underscores (no spaces).";
}

function _productCode(value) {
  if (!value || String(value).trim() === "") return null;
  const re = /^[A-Z0-9][A-Z0-9\-_.]*$/;
  return re.test(String(value).trim().toUpperCase())
    ? null
    : "Product code can only contain letters, numbers, hyphens, underscores, and dots.";
}

function _nonNegativeNumber(value) {
  const n = Number(value);
  return !isNaN(n) && n >= 0 ? null : "Must be a valid number (0 or greater).";
}

function _nonNegativeInt(value) {
  const n = Number(value);
  return !isNaN(n) && n >= 0 && Number.isInteger(n)
    ? null
    : "Must be a whole number (0 or greater).";
}

function _positiveNumber(value) {
  const n = Number(value);
  return !isNaN(n) && n > 0 ? null : "Must be greater than 0.";
}

function _validDate(value) {
  if (!value || String(value).trim() === "") return null; // optional
  return !isNaN(new Date(value).getTime()) ? null : "Enter a valid date.";
}

// ── Named validator registry ────────────────────────────────────────────────

const VALIDATORS = {
  required: _required,
  email: _email,
  phone: _phone,
  url: _url,
  gst: _gst,
  hsnCode: _hsnCode,
  categoryCode: _categoryCode,
  productCode: _productCode,
  nonNegativeNumber: _nonNegativeNumber,
  nonNegativeInt: _nonNegativeInt,
  positiveNumber: _positiveNumber,
  validDate: _validDate,
};

// ── Parameterized factory validators ───────────────────────────────────────

export function minLength(min) {
  return (value) => {
    const s = String(value ?? "").trim();
    return s.length >= min ? null : `Must be at least ${min} characters long.`;
  };
}

export function maxLength(max) {
  return (value) => {
    const s = String(value ?? "");
    return s.length <= max ? null : `Must be at most ${max} characters long.`;
  };
}

export function rangeNumber(min, max) {
  return (value) => {
    const n = Number(value);
    if (isNaN(n)) return "Must be a valid number.";
    if (n < min) return `Must be at least ${min}.`;
    if (n > max) return `Must be at most ${max}.`;
    return null;
  };
}

// ── Core validate function ──────────────────────────────────────────────────

/**
 * Validate a form data object against a rules map.
 *
 * Rule formats (per field, as an array):
 *   "required"                   — named validator (string)
 *   minLength(2)                 — factory-created function
 *   (value, data) => null|string — inline custom validator
 *
 * Returns { isValid: boolean, errors: { FIELD: "message" } }
 *
 * Only the FIRST failing rule per field is reported.
 */
export function validateForm(rules, data) {
  const errors = {};

  for (const [field, fieldRules] of Object.entries(rules)) {
    const value = data[field];

    for (const rule of fieldRules) {
      let error = null;

      if (typeof rule === "string") {
        const fn = VALIDATORS[rule];
        if (fn) error = fn(value, data);
      } else if (typeof rule === "function") {
        error = rule(value, data);
      }

      if (error) {
        errors[field] = error;
        break;
      }
    }
  }

  return { isValid: Object.keys(errors).length === 0, errors };
}

/**
 * Clear a single field error from the errors state.
 * Avoids re-renders when the field has no error.
 *
 * Usage in onChange handler:
 *   clearFieldError(setErrors, "EMAIL");
 */
export function clearFieldError(setErrors, field) {
  setErrors((prev) => {
    if (!prev[field]) return prev;
    const next = { ...prev };
    delete next[field];
    return next;
  });
}

// ── Pre-built rule sets for each form ─────────────────────────────────────

/** Supplier Add/Edit modal */
export const SUPPLIER_RULES = {
  COMPANY_NAME: ["required", minLength(2), maxLength(200)],
  PHONE: ["phone"],
  EMAIL: ["email"],
  ALTERNATE_EMAIL: [
    "email",
    (value, data) => {
      if (!value || !String(value).trim()) return null;
      if (data.EMAIL && String(value).trim().toLowerCase() === String(data.EMAIL).trim().toLowerCase())
        return "Alternate email must be different from the primary email.";
      return null;
    },
  ],
  ALTERNATE_PHONE: [
    "phone",
    (value, data) => {
      if (!value || !String(value).trim()) return null;
      if (data.PHONE && String(value).trim() === String(data.PHONE).trim())
        return "Alternate phone must be different from the primary phone.";
      return null;
    },
  ],
  GST_NUMBER: ["gst"],
  WEBSITE: ["url"],
  CREDIT_DAYS: ["nonNegativeInt"],
  LEAD_TIME_DAYS: ["nonNegativeInt"],
  ADVANCE_PERCENT: [rangeNumber(0, 100)],
};

/** Invite Supplier modal */
export const INVITE_RULES = {
  INVITED_COMPANY_NAME: ["required", minLength(2)],
  INVITED_EMAIL: ["required", "email"],
  INVITED_PHONE: ["phone"],
};

/** Inventory Category Add/Edit modal */
export const CATEGORY_RULES = {
  NAME: ["required", minLength(2), maxLength(100)],
  CODE: ["categoryCode", maxLength(30)],
  SORT_ORDER: ["nonNegativeInt"],
};

/** Product Master Add/Edit modal */
export const PRODUCT_RULES = {
  PRODUCT_CODE: ["required", "productCode", maxLength(50)],
  PRODUCT_NAME: ["required", minLength(2), maxLength(200)],
  HSN_CODE: ["hsnCode"],
  UNIT: ["required"],
};

/** Inventory Item Add/Edit modal */
export const ITEM_RULES = {
  PRODUCT_ID: ["required"],
  LOCATION: [maxLength(200)],
  REORDER_LEVEL: ["nonNegativeNumber"],
  REORDER_QTY: ["nonNegativeNumber"],
  SAFETY_STOCK: ["nonNegativeNumber"],
  MAX_STOCK: ["nonNegativeNumber"],
  // Cross-field: safety stock ≤ reorder level (only checked when max_stock > 0)
  _STOCK_LEVELS: (_, data) => {
    const reorder = Number(data.REORDER_LEVEL) || 0;
    const safety = Number(data.SAFETY_STOCK) || 0;
    const max = Number(data.MAX_STOCK) || 0;
    if (max > 0 && reorder > max) {
      return "Reorder Level cannot exceed Max Stock.";
    }
    if (safety > reorder) {
      return "Safety Stock cannot exceed Reorder Level.";
    }
    return null;
  },
};

/** Batch Add modal */
export const BATCH_RULES = {
  INVENTORY_ITEM_ID: ["required"],
  BATCH_NUMBER: ["required", maxLength(100)],
  MFG_DATE: ["validDate"],
  EXPIRY_DATE: [
    "validDate",
    (value, data) => {
      if (!value || !data.MFG_DATE) return null;
      return new Date(value) > new Date(data.MFG_DATE)
        ? null
        : "Expiry date must be after the manufacturing date.";
    },
  ],
  QTY_RECEIVED: ["nonNegativeNumber"],
  UNIT_COST: ["nonNegativeNumber"],
};

/** Batch Edit modal (no INVENTORY_ITEM_ID) */
export const BATCH_EDIT_RULES = {
  BATCH_NUMBER: ["required", maxLength(100)],
  MFG_DATE: ["validDate"],
  EXPIRY_DATE: [
    "validDate",
    (value, data) => {
      if (!value || !data.MFG_DATE) return null;
      return new Date(value) > new Date(data.MFG_DATE)
        ? null
        : "Expiry date must be after the manufacturing date.";
    },
  ],
  QTY_RECEIVED: ["nonNegativeNumber"],
  UNIT_COST: ["nonNegativeNumber"],
};

/** Lead Polling Configuration Add/Edit modal */
export const LEAD_POLLING_CONFIG_RULES = {
  ACCOUNT_LABEL: ["required", minLength(2), maxLength(150)],
  PLATFORM_NAME: ["required", maxLength(50)],
  BASE_URL: ["required", "url"],
  ENDPOINT_URL: ["required", maxLength(500)],
  API_TYPE: ["required"],
  POLL_INTERVAL_MINUTES: [rangeNumber(5, 1440)],
};

/** Polling config PULL_API_KEY is validated separately (required on Add,
 * optional on Edit — blank preserves the existing key) */
export const LEAD_POLLING_API_KEY_RULE = ["required", minLength(5)];

/** Manual Lead Management Add/Edit modal */
export const LEAD_RULES = {
  CONTACT_NAME: ["required", minLength(2), maxLength(200)],
  CONTACT_MOBILE: ["phone"],
  CONTACT_EMAIL: ["email"],
  COMPANY_NAME: [maxLength(255)],
  PINCODE: [
    (value) => {
      if (!value || !String(value).trim()) return null;
      return /^\d{4,10}$/.test(String(value).trim()) ? null : "Enter a valid pincode.";
    },
  ],
  LEAD_STATUS: ["required"],
};
