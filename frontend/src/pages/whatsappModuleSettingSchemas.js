import React from "react";
import WhatsAppWelcomePreview from "../components/whatsapp/WhatsAppWelcomePreview";
import { formatDateTime } from "../utils/formatDateTime";

/**
 * Module-level field schemas for the WhatsApp Module Settings admin page —
 * consumed by the generic, reusable PMEntityFormModal / PMEntityDetailsModal
 * (components/pm/). Defined once at import time so schema-level predicate
 * functions are never reconstructed per render.
 */

/**
 * Registry of ERP modules that can have their own WhatsApp automation
 * settings — the single source of truth for the Module Select shown in the
 * Add form, Edit form, and the page's Module filter. Deliberately a plain
 * array, not derived from live data, so it stays a curated, admin-controlled
 * list. Add a new module here (and nowhere else in the frontend) as it gets
 * its own WhatsApp automation, e.g.:
 *   { value: "sales_module", label: "Sales Module" },
 *   { value: "inventory_module", label: "Inventory Module" },
 */
export const MODULE_OPTIONS = [
  { value: "lead_module", label: "Lead Module" },
];

export function moduleLabel(code) {
  return MODULE_OPTIONS.find((o) => o.value === code)?.label || code;
}

export const WHATSAPP_MODULE_SETTING_FORM_SCHEMA = [
  {
    name: "MODULE_CODE",
    label: "Module",
    type: "select",
    section: "General",
    required: true,
    options: MODULE_OPTIONS,
    disabled: (values, ctx) => ctx.mode === "edit",
    helperText:
      "Which ERP module these WhatsApp automation settings apply to. Cannot be changed after creation.",
  },
  {
    name: "IS_ENABLED",
    label: "Enabled — turn this module's WhatsApp automation on/off",
    type: "checkbox",
    section: "General",
    fullWidth: true,
  },
  {
    name: "AUTO_TRIGGER_ENABLED",
    label: "Auto-send welcome message when a new record is created",
    type: "checkbox",
    section: "Welcome Message",
    fullWidth: true,
  },
  {
    name: "WELCOME_TEMPLATE_NAME",
    label: "Welcome Template Name",
    type: "text",
    section: "Welcome Message",
    required: (values) => !!values.AUTO_TRIGGER_ENABLED,
    helperText: (values) =>
      values.AUTO_TRIGGER_ENABLED
        ? "Must exactly match an approved template name in Meta Business Manager. See the Meta Template Creation Guide."
        : "Optional while auto-trigger is off.",
  },
  {
    name: "WELCOME_TEMPLATE_LANG",
    label: "Welcome Template Language Code",
    type: "text",
    section: "Welcome Message",
    placeholder: "en_US",
  },
  {
    name: "WELCOME_TEMPLATE_PARAMS",
    label: "Welcome Template Parameters (CSV)",
    type: "text",
    section: "Welcome Message",
    fullWidth: true,
    placeholder: "CONTACT_NAME",
    helperText:
      "Comma-separated Lead field names mapped to {{1}}, {{2}}… in your Meta template body, in order. See the Meta Template Creation Guide for details.",
  },
  {
    name: "REENGAGE_TEMPLATE_NAME",
    label: "Re-engagement Template Name",
    type: "text",
    section: "Re-engagement",
  },
  {
    name: "REENGAGE_TEMPLATE_LANG",
    label: "Re-engagement Template Language Code",
    type: "text",
    section: "Re-engagement",
    placeholder: "en_US",
  },
  {
    name: "AI_REPLY_ENABLED",
    label: "AI auto-reply enabled",
    type: "checkbox",
    section: "AI & Languages",
    fullWidth: true,
  },
  {
    name: "SUPPORTED_LANGUAGES",
    label: "Supported Languages (CSV of ISO codes)",
    type: "text",
    section: "AI & Languages",
    fullWidth: true,
    required: true,
    placeholder: "en, ta",
    helperText: "Comma-separated ISO codes (e.g. en, ta) — drives the language buttons shown in the sample preview.",
  },
];

export const WHATSAPP_MODULE_SETTING_DETAIL_SCHEMA = [
  { name: "MODULE_CODE", label: "Module", section: "General", format: (v) => moduleLabel(v) },
  {
    name: "IS_ENABLED",
    label: "Enabled",
    section: "General",
    format: (v) => (v ? "Enabled" : "Disabled"),
  },
  {
    name: "AUTO_TRIGGER_ENABLED",
    label: "Auto-trigger Welcome Message",
    section: "Welcome Message",
    format: (v) => (v ? "Enabled" : "Disabled"),
  },
  { name: "WELCOME_TEMPLATE_NAME", label: "Welcome Template Name", section: "Welcome Message" },
  { name: "WELCOME_TEMPLATE_LANG", label: "Welcome Template Language Code", section: "Welcome Message" },
  {
    name: "WELCOME_TEMPLATE_PARAMS",
    label: "Welcome Template Parameters",
    section: "Welcome Message",
    fullWidth: true,
  },
  { name: "REENGAGE_TEMPLATE_NAME", label: "Re-engagement Template Name", section: "Re-engagement" },
  { name: "REENGAGE_TEMPLATE_LANG", label: "Re-engagement Template Language Code", section: "Re-engagement" },
  {
    name: "AI_REPLY_ENABLED",
    label: "AI Auto-reply",
    section: "AI & Languages",
    format: (v) => (v ? "Enabled" : "Disabled"),
  },
  { name: "SUPPORTED_LANGUAGES", label: "Supported Languages", section: "AI & Languages", fullWidth: true },
  { name: "CREATED_AT", label: "Created", section: "Meta", format: (v) => formatDateTime(v) },
  { name: "UPDATED_AT", label: "Updated", section: "Meta", format: (v) => formatDateTime(v) },
];

/**
 * Builds the `extraSections` array passed to PMEntityDetailsModal — a plain
 * function (not a schema constant) since it needs the currently-loaded
 * vendor's BUSINESS_DISPLAY_NAME, which isn't part of the row itself.
 */
export function buildWhatsAppPreviewSections(businessDisplayName) {
  return [
    {
      key: "sample-preview",
      title: "Sample WhatsApp Message Preview",
      render: (values) =>
        React.createElement(WhatsAppWelcomePreview, {
          WELCOME_TEMPLATE_NAME: values.WELCOME_TEMPLATE_NAME,
          WELCOME_TEMPLATE_LANG: values.WELCOME_TEMPLATE_LANG,
          WELCOME_TEMPLATE_PARAMS: values.WELCOME_TEMPLATE_PARAMS,
          SUPPORTED_LANGUAGES: values.SUPPORTED_LANGUAGES,
          businessDisplayName,
        }),
    },
  ];
}
