/**
 * Pure helpers backing WhatsAppWelcomePreview — kept separate from the .jsx
 * so they're independently usable (e.g. by a future re-engagement-message
 * preview) without pulling in React.
 */

export const LANGUAGE_LABELS = {
  en: "English",
  en_us: "English",
  en_gb: "English",
  ta: "தமிழ்",
  ta_in: "தமிழ்",
  hi: "हिन्दी",
  hi_in: "हिन्दी",
  te: "తెలుగు",
  kn: "ಕನ್ನಡ",
  ml: "മലയാളം",
  mr: "मराठी",
  gu: "ગુજરાતી",
  bn: "বাংলা",
  pa: "ਪੰਜਾਬੀ",
};

export function parseCsvList(csv) {
  return String(csv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function languageLabel(code) {
  const trimmed = String(code || "").trim();
  if (!trimmed) return "";
  return LANGUAGE_LABELS[trimmed.toLowerCase()] || trimmed;
}

/**
 * Builds one { code, label } entry per language in a CSV field, in the
 * order given, deduped case-insensitively — unknown codes fall back to the
 * raw code as their own label.
 */
export function buildLanguageButtons(supportedLanguagesCsv) {
  const codes = parseCsvList(supportedLanguagesCsv);
  const seen = new Set();
  const out = [];
  for (const code of codes) {
    const key = code.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ code, label: languageLabel(code) });
  }
  return out;
}
