import React, { useMemo } from "react";
import { buildLanguageButtons, parseCsvList } from "./whatsappPreviewUtils";
import styles from "./WhatsAppWelcomePreview.module.css";

/**
 * Illustrative "Sample WhatsApp Message Preview" — mocks up what the very
 * first welcome message would roughly look like on the customer's phone.
 * This is NOT the literal Meta-approved template wording (that lives in
 * Meta Business Manager, not this database) — it's a generic, always-
 * clearly-labeled admin reference preview built from the row's own
 * template/language fields plus the vendor's business display name.
 */
function WhatsAppWelcomePreview({
  WELCOME_TEMPLATE_NAME,
  WELCOME_TEMPLATE_LANG,
  WELCOME_TEMPLATE_PARAMS,
  SUPPORTED_LANGUAGES,
  businessDisplayName,
}) {
  const languages = useMemo(() => buildLanguageButtons(SUPPORTED_LANGUAGES), [SUPPORTED_LANGUAGES]);
  const hasFirstNameParam = useMemo(
    () => parseCsvList(WELCOME_TEMPLATE_PARAMS).length > 0,
    [WELCOME_TEMPLATE_PARAMS]
  );

  if (!WELCOME_TEMPLATE_NAME) {
    return (
      <p className={styles.emptyNote}>
        No welcome template configured yet — set a Welcome Template Name to preview the sample message.
      </p>
    );
  }

  return (
    <div className={styles.previewWrap}>
      <p className={styles.disclaimer}>
        Illustrative sample only — the actual approved wording and formatting for this template are
        defined in Meta Business Manager, not this database. "Bharath" is a placeholder value, not real
        customer data.
      </p>
      <div className={styles.bubble}>
        <p>{hasFirstNameParam ? "Hi Bharath 👋" : "Hi there 👋"}</p>
        <p>Welcome to {businessDisplayName || "your business"}.</p>
        <p>Thank you for contacting us.</p>
        {languages.length > 0 && <p>Please choose your preferred language.</p>}
        {languages.length > 0 && (
          <div className={styles.langButtons}>
            {languages.map((l) => (
              <span key={l.code} className={styles.langButton}>
                {l.label}
              </span>
            ))}
          </div>
        )}
        {languages.length === 0 && (
          <p className={styles.caption}>
            No supported languages configured — add ISO codes (e.g. en, ta) to preview language buttons.
          </p>
        )}
      </div>
      <p className={styles.caption}>
        Template: {WELCOME_TEMPLATE_NAME} ({WELCOME_TEMPLATE_LANG || "—"})
      </p>
    </div>
  );
}

export default React.memo(WhatsAppWelcomePreview);
