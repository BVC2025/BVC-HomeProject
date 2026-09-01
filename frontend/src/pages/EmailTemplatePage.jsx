import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useToast } from "../hooks/useToast";
import RichTextEditor from "../components/RichTextEditor";
import { emailTemplateService } from "../services/emailTemplateService";
import styles from "./EmailTemplatePage.module.css";

// ── Sample values shown ONLY in the live preview ──────────────────────────────
const PREVIEW_VARS = {
  company_name: "Your Company Name",
  invited_company: "Acme Suppliers Pvt. Ltd.",
  registration_link: "#preview-register",
  expires_at: "31 December 2025",
  support_email: "support@company.com",
  company_address: "123 Business Park, Chennai, Tamil Nadu 600001",
  contact_number: "+91 98765 43210",
  website: "www.company.com",
  // Every BUTTON_MANIFEST urlVar below MUST have an entry here — SAVE_VARS
  // (used when the template is actually saved, not just previewed) is
  // mechanically derived from this object's keys. Omitting one here means
  // renderButtonsHtml()'s `vars[meta.urlVar]` resolves to undefined and its
  // `|| "#"` fallback silently bakes a dead href="#" into the saved
  // BODY_HTML instead of preserving the {{accept_link}}-style placeholder —
  // exactly the bug that caused saved template edits to be discarded at
  // send time (the backend's stale-content guard in get_template_for_send()
  // then falls back to the catalog default for the whole email).
  accept_link: "#preview-accept",
  reject_link: "#preview-reject",
  upload_link: "#preview-upload",
  view_payment_url: "#preview-view-payment",
  login_url: "#preview-login",
  review_schedule_url: "#preview-review-schedule",
  review_batch_url: "#preview-review-batch",
};

// Preserved in saved BODY_HTML — substituted by backend render_template() at send time
const SAVE_VARS = Object.fromEntries(
  Object.keys(PREVIEW_VARS).map((k) => [k, `{{${k}}}`])
);

// ── Default design for a blank / never-edited template ────────────────────────
const DEFAULT_DESIGN = {
  logoDataUrl: "",
  headerTitle: "Supplier Management Portal",
  contentHtml: [
    "<p>Dear <strong>{{invited_company}}</strong>,</p>",
    "<p>We are pleased to invite you to register as an approved supplier on our ",
    "procurement platform. Please click the button below to complete your supplier ",
    "profile and begin the onboarding process.</p>",
    "<p>If you have any questions at any stage of the registration process, do not ",
    "hesitate to reach out to our team — we are happy to assist.</p>",
  ].join(""),
  customNotes: "",
  buttons: [],
};

// ── Protected action-button manifest ───────────────────────────────────────────
// These four template types had their Accept/Reject/Upload/View-Payment
// buttons silently dropped on every save, because they lived OUTSIDE the
// freeform contentHtml region the rich-text editor round-trips, and
// buildEmailHtml() (below) previously had no idea they existed. Buttons are
// now a separate, protected field (design.buttons) — analogous to
// logoDataUrl/headerTitle — with only `text` ever user-editable; `urlVar`/
// `color` are fixed here so the underlying action/link can never be broken
// by a content edit. EMPLOYEE_ONBOARDING's login button is now protected
// the same way (see parseDesign()'s legacy-migration handling below).
// SUPPLIER_INVITATION is untouched — its "Complete Registration" CTA is
// built directly into buildEmailHtml() (see isInvitation below), not a
// freeform contentHtml element, so it was never at risk.
// IMPORTANT: every `urlVar` referenced below must have a matching entry in
// PREVIEW_VARS above — see the comment there for why.
const BUTTON_MANIFEST = {
  PROJECT_QUOTATION: [
    { id: "accept", urlVar: "accept_link", color: "#16a34a", defaultText: "Accept Quotation" },
    { id: "reject", urlVar: "reject_link", color: "#dc2626", defaultText: "Reject Quotation" },
  ],
  REVISED_PROJECT_QUOTATION: [
    { id: "accept", urlVar: "accept_link", color: "#16a34a", defaultText: "Accept Quotation" },
    { id: "reject", urlVar: "reject_link", color: "#dc2626", defaultText: "Reject Quotation" },
  ],
  PURCHASE_ORDER_REQUEST: [
    { id: "upload", urlVar: "upload_link", color: "#DC2626", defaultText: "Upload Purchase Order" },
  ],
  PURCHASE_ORDER_UPLOADED_NOTIFICATION: [
    { id: "view_payment", urlVar: "view_payment_url", color: "#DC2626", defaultText: "View Payment" },
  ],
  EMPLOYEE_ONBOARDING: [
    { id: "login", urlVar: "login_url", color: "#DC2626", defaultText: "Log In Now" },
  ],
  PRODUCTION_SCHEDULE_APPROVAL: [
    { id: "review_schedule", urlVar: "review_schedule_url", color: "#DC2626", defaultText: "Review & Approve Schedule" },
  ],
  PURCHASE_ORDER_APPROVAL: [
    { id: "review_batch", urlVar: "review_batch_url", color: "#DC2626", defaultText: "Review & Approve Purchase Orders" },
  ],
};

function defaultButtonsFor(templateType) {
  const manifest = BUTTON_MANIFEST[templateType];
  return manifest ? manifest.map((b) => ({ id: b.id, text: b.defaultText })) : [];
}

// Renders design.buttons into the same table-wrapped-<a> markup already used
// throughout this codebase's email templates — inserted right after
// contentHtml. `buttons` array order drives left-to-right layout, so the
// editor's reorder control can swap Accept/Reject positions; color/urlVar
// always come from the manifest (never from user input).
function renderButtonsHtml(design, templateType, vars) {
  const manifest = BUTTON_MANIFEST[templateType];
  if (!manifest || manifest.length === 0) return "";
  const buttons = design.buttons && design.buttons.length > 0 ? design.buttons : defaultButtonsFor(templateType);
  const cells = buttons
    .map((btn) => {
      const meta = manifest.find((m) => m.id === btn.id);
      if (!meta) return null;
      const url = vars[meta.urlVar] || "#";
      const text = btn.text || meta.defaultText;
      return `<td style="background:${meta.color};border-radius:7px;">
                  <a href="${url}" style="display:inline-block;padding:14px 28px;color:#ffffff;
                         text-decoration:none;font-weight:700;font-size:15px;">
                    ${text}
                  </a>
                </td>`;
    })
    .filter(Boolean);
  if (cells.length === 0) return "";
  const spacer = `<td style="width:14px;line-height:1px;font-size:1px;">&nbsp;</td>`;
  return `<table cellpadding="0" cellspacing="0" role="presentation" style="margin:20px 0 24px;">
              <tr>${cells.join(spacer)}</tr>
            </table>`;
}

// ── HTML assembler — pure function, called for both preview and save ───────────
function buildEmailHtml(design, vars, templateType = "SUPPLIER_INVITATION") {
  const { logoDataUrl, headerTitle, contentHtml, customNotes } = design;
  const {
    company_name,
    registration_link,
    expires_at,
    support_email,
    company_address,
    contact_number,
    website,
  } = vars;
  const isInvitation = !templateType || templateType === "SUPPLIER_INVITATION";

  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Company Logo"
            style="max-height:60px;max-width:180px;display:block;margin:0 auto 14px;
                   object-fit:contain;">`
    : "";

  const headerSubtitleHtml = headerTitle
    ? `<p style="color:rgba(255,255,255,0.82);margin:10px 0 0;font-size:12px;
                 letter-spacing:0.8px;text-transform:uppercase;">${headerTitle}</p>`
    : "";

  const notesHtml = customNotes
    ? `<p style="color:#94a3b8;font-size:12px;font-style:italic;margin:20px 0 0;
                 padding-top:16px;border-top:1px solid #f1f5f9;">${customNotes}</p>`
    : "";

  const websiteHref = website.startsWith("http") ? website : `https://${website}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Supplier Invitation</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#f8fafc;padding:40px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#ffffff;border-radius:10px;overflow:hidden;
                    box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#DC2626;padding:32px 48px;text-align:center;">
            ${logoHtml}
            <h1 style="color:#ffffff;margin:0;font-size:24px;font-weight:700;
                       letter-spacing:-0.3px;">${company_name}</h1>
            ${headerSubtitleHtml}
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:40px 48px;font-family:Arial,Helvetica,sans-serif;
                     font-size:15px;line-height:1.75;color:#475569;">
            ${contentHtml || ""}

            ${renderButtonsHtml(design, templateType, vars)}

            ${isInvitation ? `<!-- CTA Button -->
            <table cellpadding="0" cellspacing="0" role="presentation"
                   style="margin:28px 0 20px;">
              <tr>
                <td style="background:#DC2626;border-radius:7px;">
                  <a href="${registration_link}"
                     style="display:inline-block;padding:14px 32px;color:#ffffff;
                            text-decoration:none;font-weight:700;font-size:15px;
                            letter-spacing:0.2px;">
                    Complete Registration &rarr;
                  </a>
                </td>
              </tr>
            </table>

            <p style="color:#64748b;font-size:13px;line-height:1.65;margin:0 0 8px;">
              This invitation expires on <strong>${expires_at}</strong>.
            </p>` : ""}
            <p style="color:#64748b;font-size:13px;line-height:1.65;margin:0;">
              Questions? Contact us at
              <a href="mailto:${support_email}"
                 style="color:#DC2626;text-decoration:none;">${support_email}</a>.
            </p>
            ${notesHtml}
          </td>
        </tr>

        <!-- Divider -->
        <tr>
          <td style="padding:0 48px;">
            <hr style="border:none;border-top:1px solid #e2e8f0;margin:0;">
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:24px 48px;background:#f8fafc;text-align:center;">
            <p style="color:#94a3b8;font-size:12px;line-height:2;margin:0;">
              <strong style="color:#64748b;">${company_name}</strong><br>
              ${company_address}<br>
              Phone:&nbsp;${contact_number}&nbsp;|&nbsp;
              <a href="${websiteHref}"
                 style="color:#DC2626;text-decoration:none;">${website}</a><br>
              <a href="mailto:${support_email}"
                 style="color:#DC2626;text-decoration:none;">${support_email}</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

// ── Parse DESIGN_JSON stored in DB ────────────────────────────────────────────
// `templateType` lets this backfill a `buttons` array from BUTTON_MANIFEST
// whenever the stored DESIGN_JSON has none (or an empty one) — every
// currently-broken template in the DB falls into exactly this case, so this
// self-heals them the next time an admin opens the editor, no manual data
// fix required.
// Before EMPLOYEE_ONBOARDING got a protected login button (above), its
// "Log In Now" link lived inline inside contentHtml as a plain <table>/<a>
// pair — the same fragile arrangement the other four manifest types used
// to have. A row saved before this fix still has that markup baked into
// its stored contentHtml; backfilling `buttons` for it below would render
// a second, duplicate login button alongside the one already in the text.
// This strips exactly that one legacy <table>...</table> block (identified
// by containing the {{login_url}} placeholder) the next time the row is
// loaded into the editor, mirroring the self-healing button backfill this
// function already does for the other template types.
const LEGACY_LOGIN_BUTTON_RE = /<table[^>]*>(?:(?!<\/table>)[\s\S])*?\{\{login_url\}\}(?:(?!<\/table>)[\s\S])*?<\/table>/i;

function parseDesign(designJson, templateType) {
  const fallbackButtons = defaultButtonsFor(templateType);
  if (!designJson) return { ...DEFAULT_DESIGN, buttons: fallbackButtons };
  try {
    const parsed = JSON.parse(designJson);
    if (parsed && parsed.version === 1) {
      const hasButtons = Array.isArray(parsed.buttons) && parsed.buttons.length > 0;
      let contentHtml = parsed.contentHtml ?? DEFAULT_DESIGN.contentHtml;
      if (!hasButtons && templateType === "EMPLOYEE_ONBOARDING" && contentHtml.includes("{{login_url}}")) {
        contentHtml = contentHtml.replace(LEGACY_LOGIN_BUTTON_RE, "");
      }
      return {
        logoDataUrl: parsed.logoDataUrl ?? "",
        headerTitle: parsed.headerTitle ?? DEFAULT_DESIGN.headerTitle,
        contentHtml,
        customNotes: parsed.customNotes ?? "",
        buttons: hasButtons ? parsed.buttons : fallbackButtons,
      };
    }
  } catch {
    /* fall through to default */
  }
  return { ...DEFAULT_DESIGN, buttons: fallbackButtons };
}

// ── Page component ────────────────────────────────────────────────────────────
function EmailTemplatePage() {
  const toast = useToast();

  const [templates, setTemplates] = useState([]);
  const [selectedType, setSelectedType] = useState("");
  const [subject, setSubject] = useState("");
  const [design, setDesign] = useState({ ...DEFAULT_DESIGN });
  const [saving, setSaving] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingTmpl, setLoadingTmpl] = useState(false);
  const [previewHtml, setPreviewHtml] = useState("");
  // Incremented when a different template loads → forces RichTextEditor remount
  const [editorKey, setEditorKey] = useState(0);
  // Searchable template dropdown
  const [ddOpen, setDdOpen] = useState(false);
  const [ddSearch, setDdSearch] = useState("");

  const fetchedRef = useRef(false);
  const previewTimerRef = useRef(null);
  const logoInputRef = useRef(null);
  const ddRef = useRef(null);   // for click-outside detection
  const subjectRef = useRef(subject);
  const selectedTypeRef = useRef(selectedType);

  // Keep refs in sync so closures always read the latest values
  useEffect(() => { subjectRef.current = subject; }, [subject]);
  useEffect(() => { selectedTypeRef.current = selectedType; }, [selectedType]);

  // ── Fetch template list (once, StrictMode-safe) ───────────────────────────
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;

    emailTemplateService
      .getAll()
      .then((res) => {
        const list = res.data || [];
        setTemplates(list);
        if (list.length > 0) setSelectedType(list[0].TEMPLATE_TYPE);
      })
      .catch(() => toast.showError("Failed to load email templates"))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load template detail when selection changes ───────────────────────────
  useEffect(() => {
    if (!selectedType) return;
    setLoadingTmpl(true);

    emailTemplateService
      .getByType(selectedType)
      .then((res) => {
        const tmpl = res.data;
        setSubject(tmpl.SUBJECT || "");
        setDesign(parseDesign(tmpl.DESIGN_JSON, selectedType));
        setEditorKey((k) => k + 1); // remount RichTextEditor with fresh content
      })
      .catch(() => toast.showError("Failed to load template"))
      .finally(() => setLoadingTmpl(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedType]);

  // ── Debounced preview rebuild (350 ms after any design change) ───────────
  useEffect(() => {
    clearTimeout(previewTimerRef.current);
    previewTimerRef.current = setTimeout(() => {
      setPreviewHtml(buildEmailHtml(design, PREVIEW_VARS, selectedTypeRef.current));
    }, 350);
    return () => clearTimeout(previewTimerRef.current);
  }, [design]);

  // ── Close dropdown on outside click ──────────────────────────────────────
  useEffect(() => {
    if (!ddOpen) return;
    const handleOutside = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) {
        setDdOpen(false);
        setDdSearch("");
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [ddOpen]);

  // ── Handlers ─────────────────────────────────────────────────────────────
  const handleSelectTemplate = useCallback((type) => {
    setSelectedType(type);
    setDdOpen(false);
    setDdSearch("");
  }, []);

  const handleSubjectChange = useCallback((e) => {
    setSubject(e.target.value);
  }, []);

  const handleHeaderTitleChange = useCallback((e) => {
    setDesign((prev) => ({ ...prev, headerTitle: e.target.value }));
  }, []);

  const handleCustomNotesChange = useCallback((e) => {
    setDesign((prev) => ({ ...prev, customNotes: e.target.value }));
  }, []);

  // Stable reference passed to RichTextEditor (no dependency)
  const handleContentChange = useCallback((html) => {
    setDesign((prev) => ({ ...prev, contentHtml: html }));
  }, []);

  // Button text is the only user-editable field on a manifest button —
  // urlVar/color are never exposed, so the underlying action/link can't be
  // broken by editing here.
  const handleButtonTextChange = useCallback((id, text) => {
    setDesign((prev) => ({
      ...prev,
      buttons: (prev.buttons || []).map((b) => (b.id === id ? { ...b, text } : b)),
    }));
  }, []);

  // Reorders two buttons relative to each other (e.g. Accept/Reject) — the
  // coarse-grained "move to another position" this editor supports, versus
  // free drag-anywhere-in-content.
  const handleMoveButton = useCallback((index, direction) => {
    setDesign((prev) => {
      const buttons = [...(prev.buttons || [])];
      const newIndex = index + direction;
      if (newIndex < 0 || newIndex >= buttons.length) return prev;
      [buttons[index], buttons[newIndex]] = [buttons[newIndex], buttons[index]];
      return { ...prev, buttons };
    });
  }, []);

  const handleLogoUpload = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (!file.type.startsWith("image/")) {
        toast.showError("Please select an image file (PNG, JPG, SVG)");
        e.target.value = "";
        return;
      }
      if (file.size > 512 * 1024) {
        toast.showError("Logo file must be under 512 KB");
        e.target.value = "";
        return;
      }

      const reader = new FileReader();
      reader.onload = (ev) =>
        setDesign((prev) => ({ ...prev, logoDataUrl: ev.target.result }));
      reader.readAsDataURL(file);
      e.target.value = "";
    },
    [toast]
  );

  const handleRemoveLogo = useCallback(() => {
    setDesign((prev) => ({ ...prev, logoDataUrl: "" }));
  }, []);

  const handleSave = useCallback(async () => {
    if (!selectedType || saving) return;
    setSaving(true);
    try {
      const bodyHtml = buildEmailHtml(design, SAVE_VARS, selectedType);
      const designJson = JSON.stringify({ version: 1, ...design });
      await emailTemplateService.update(selectedType, {
        SUBJECT: subjectRef.current,
        BODY_HTML: bodyHtml,
        DESIGN_JSON: designJson,
      });
      toast.showSuccess("Template saved. Future emails will use this updated version.");
    } catch {
      toast.showError("Failed to save template — please try again.");
    } finally {
      setSaving(false);
    }
  }, [selectedType, design, saving, toast]);

  // ── Derived ───────────────────────────────────────────────────────────────
  const selectedTemplate = useMemo(
    () => templates.find((t) => t.TEMPLATE_TYPE === selectedType) || null,
    [templates, selectedType]
  );

  const filteredTemplates = useMemo(() => {
    if (!ddSearch.trim()) return templates;
    const q = ddSearch.toLowerCase();
    return templates.filter(
      (t) =>
        t.DISPLAY_NAME.toLowerCase().includes(q) ||
        t.TEMPLATE_TYPE.toLowerCase().includes(q) ||
        (t.SUBJECT || "").toLowerCase().includes(q)
    );
  }, [templates, ddSearch]);

  const canSave = !saving && !loadingTmpl && !!selectedType;
  const activeButtonManifest = BUTTON_MANIFEST[selectedType] || null;

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      <div className={styles.card}>

      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h2 className={styles.title}>Email Template Editor</h2>
          <p className={styles.subtitle}>
            Edit the template content, logo, and subject line.
            Changes apply automatically to all future outgoing emails.
          </p>
        </div>

        <div className={styles.topRight}>
          {/* ── Searchable template selector ── */}
          <div className={styles.topField} ref={ddRef}>
            <label className={styles.topLabel}>Template</label>

            {/* Trigger */}
            <button
              type="button"
              className={`${styles.ddTrigger} ${ddOpen ? styles.ddTriggerOpen : ""}`}
              onClick={() => !loadingList && setDdOpen((o) => !o)}
              disabled={loadingList}
            >
              <span className={styles.ddTriggerText}>
                {loadingList
                  ? "Loading…"
                  : selectedTemplate?.DISPLAY_NAME || "Select a template"}
              </span>
              <svg
                className={styles.ddChevron}
                style={{ transform: ddOpen ? "rotate(180deg)" : "rotate(0deg)" }}
                width="12" height="12" viewBox="0 0 12 12" fill="none"
              >
                <path
                  d="M2 4l4 4 4-4"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>

            {/* Dropdown panel */}
            {ddOpen && (
              <div className={styles.ddPanel}>
                {/* Search */}
                <div className={styles.ddSearchWrap}>
                  <svg className={styles.ddSearchIcon}
                    width="14" height="14" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    type="text"
                    className={styles.ddSearchInput}
                    placeholder="Search templates…"
                    value={ddSearch}
                    onChange={(e) => setDdSearch(e.target.value)}
                    autoFocus
                  />
                </div>

                {/* Items */}
                <div className={styles.ddList}>
                  {filteredTemplates.length === 0 ? (
                    <div className={styles.ddEmpty}>No templates match</div>
                  ) : (
                    filteredTemplates.map((t) => {
                      const active = t.TEMPLATE_TYPE === selectedType;
                      return (
                        <div
                          key={t.TEMPLATE_TYPE}
                          className={`${styles.ddItem} ${active ? styles.ddItemActive : ""}`}
                          onClick={() => handleSelectTemplate(t.TEMPLATE_TYPE)}
                        >
                          <div className={styles.ddItemRow}>
                            <span className={styles.ddItemName}>{t.DISPLAY_NAME}</span>
                            {active && (
                              <span className={styles.ddItemBadge}>Active</span>
                            )}
                          </div>
                          <div className={styles.ddItemType}>{t.TEMPLATE_TYPE}</div>
                          {t.SUBJECT && (
                            <div className={styles.ddItemSubject}
                              title={t.SUBJECT}>
                              {t.SUBJECT}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            className={styles.saveBtn}
            onClick={handleSave}
            disabled={!canSave}
          >
            {saving ? "Saving…" : "Save Template"}
          </button>
        </div>
      </div>

      {/* ── Split pane ── */}
      <div className={styles.splitPane}>

        {/* LEFT — Editor */}
        <div className={styles.editorPanel}>
          {loadingTmpl ? (
            <div className={styles.loadingMsg}>Loading template…</div>
          ) : (
            <div className={styles.editorInner}>

              {/* Subject */}
              <div className={styles.section}>
                <label className={styles.sectionLabel} htmlFor="tmpl-subject">
                  Subject Line
                </label>
                <input
                  id="tmpl-subject"
                  type="text"
                  className={styles.textInput}
                  value={subject}
                  onChange={handleSubjectChange}
                  placeholder="e.g. You're invited to register as a supplier"
                />
              </div>

              {/* Logo upload */}
              <div className={styles.section}>
                <label className={styles.sectionLabel}>
                  Company Logo
                  <span className={styles.hint}>&nbsp;· PNG, JPG or SVG, max 512 KB</span>
                </label>
                <div className={styles.logoRow}>
                  {design.logoDataUrl ? (
                    <div className={styles.logoPreviewBox}>
                      <img
                        src={design.logoDataUrl}
                        alt="Logo preview"
                        className={styles.logoThumb}
                      />
                      <button
                        type="button"
                        className={styles.removeLogoBtn}
                        onClick={handleRemoveLogo}
                        title="Remove logo"
                      >
                        ×
                      </button>
                    </div>
                  ) : (
                    <div className={styles.logoEmpty}>No logo uploaded</div>
                  )}
                  <input
                    ref={logoInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp"
                    className={styles.hiddenInput}
                    onChange={handleLogoUpload}
                  />
                  <button
                    type="button"
                    className={styles.uploadBtn}
                    onClick={() => logoInputRef.current?.click()}
                  >
                    {design.logoDataUrl ? "Replace Logo" : "Upload Logo"}
                  </button>
                </div>
              </div>

              {/* Header subtitle */}
              <div className={styles.section}>
                <label className={styles.sectionLabel} htmlFor="tmpl-header">
                  Header Subtitle
                  <span className={styles.hint}>&nbsp;· Shown below the company name in the red banner</span>
                </label>
                <input
                  id="tmpl-header"
                  type="text"
                  className={styles.textInput}
                  value={design.headerTitle}
                  onChange={handleHeaderTitleChange}
                  placeholder="e.g. Supplier Management Portal"
                />
              </div>

              {/* Rich text body */}
              <div className={styles.section}>
                <label className={styles.sectionLabel}>
                  Email Body Content
                  <span className={styles.hint}>
                    &nbsp;· Use{" "}
                    <code className={styles.code}>{"{{invited_company}}"}</code>{" "}
                    as a placeholder for the supplier name
                  </span>
                </label>
                <RichTextEditor
                  key={editorKey}
                  initialValue={design.contentHtml}
                  onChange={handleContentChange}
                />
              </div>

              {/* Action buttons — protected, non-freeform fields (only for
                  templates that have one). Rendered right after the body
                  content in the final email — see renderButtonsHtml(). */}
              {activeButtonManifest && (
                <div className={styles.section}>
                  <label className={styles.sectionLabel}>
                    Action Button{activeButtonManifest.length > 1 ? "s" : ""}
                    <span className={styles.hint}>
                      &nbsp;· Shown right after the body content above. Text is editable; the
                      underlying action/link is fixed and can't be broken by editing.
                    </span>
                  </label>
                  {(design.buttons && design.buttons.length > 0 ? design.buttons : defaultButtonsFor(selectedType)).map((btn, idx, arr) => {
                    const meta = activeButtonManifest.find((m) => m.id === btn.id);
                    if (!meta) return null;
                    return (
                      <div key={btn.id} className={styles.buttonRow}>
                        <span className={styles.buttonSwatch} style={{ background: meta.color }}>
                          {btn.text || meta.defaultText}
                        </span>
                        <input
                          type="text"
                          className={styles.textInput}
                          value={btn.text}
                          onChange={(e) => handleButtonTextChange(btn.id, e.target.value)}
                          placeholder={meta.defaultText}
                        />
                        {arr.length > 1 && (
                          <div className={styles.buttonReorderBtns}>
                            <button
                              type="button"
                              className={styles.buttonReorderBtn}
                              onClick={() => handleMoveButton(idx, -1)}
                              disabled={idx === 0}
                              title="Move earlier"
                            >
                              ↑
                            </button>
                            <button
                              type="button"
                              className={styles.buttonReorderBtn}
                              onClick={() => handleMoveButton(idx, 1)}
                              disabled={idx === arr.length - 1}
                              title="Move later"
                            >
                              ↓
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Custom notes */}
              <div className={styles.section}>
                <label className={styles.sectionLabel} htmlFor="tmpl-notes">
                  Custom Notes
                  <span className={styles.hint}>&nbsp;· Optional — shown in small italic text below the CTA button</span>
                </label>
                <textarea
                  id="tmpl-notes"
                  className={styles.textarea}
                  value={design.customNotes}
                  onChange={handleCustomNotesChange}
                  placeholder="e.g. Please complete registration within the specified time frame."
                  rows={3}
                />
              </div>

            </div>
          )}
        </div>

        {/* RIGHT — Live preview */}
        <div className={styles.previewPanel}>
          <div className={styles.previewTopBar}>
            <span className={styles.previewLabel}>Live Preview</span>
            <span className={styles.previewNote}>
              Showing sample data — actual company details fill in when email is sent
            </span>
          </div>
          <iframe
            title="Email Preview"
            className={styles.previewFrame}
            srcDoc={previewHtml}
            sandbox="allow-same-origin"
          />
        </div>

      </div>
      </div>
    </div>
  );
}

export default EmailTemplatePage;
