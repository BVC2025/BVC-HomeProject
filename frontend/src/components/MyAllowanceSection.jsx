// =====================================================================
// MyAllowanceSection — Employee Portal -> Allowance tab.
//
// Employee submits office-related expense claims (travel, food, fuel
// etc.) for MD approval. Shows the submit form + history of past
// claims with status badges. Mobile-first modern SaaS layout.
// =====================================================================

import { useEffect, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";


// Inline SVGs — dependency-free, stroke-based, match ESS style.
const IconSvg = ({ children, size = 16 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth="2"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true"
  >
    {children}
  </svg>
);
const IconClipboard = () => (
  <IconSvg>
    <rect x="8" y="3" width="8" height="4" rx="1" />
    <path d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h12a2 2 0 002-2V7a2 2 0 00-2-2h-2" />
  </IconSvg>
);
const IconClock = () => (
  <IconSvg>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </IconSvg>
);
const IconCheck = () => (
  <IconSvg>
    <path d="M20 6L9 17l-5-5" />
  </IconSvg>
);
const IconX = () => (
  <IconSvg>
    <path d="M18 6L6 18M6 6l12 12" />
  </IconSvg>
);


/* Live-tracks the root `data-theme` attribute so inline-style colours
   can switch when the user toggles dark mode from Settings. */
function useDarkMode() {
  const [dark, setDark] = useState(
    () => typeof document !== "undefined" &&
          document.documentElement.getAttribute("data-theme") === "dark"
  );
  useEffect(() => {
    const obs = new MutationObserver(() => {
      setDark(document.documentElement.getAttribute("data-theme") === "dark");
    });
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => obs.disconnect();
  }, []);
  return dark;
}

function paletteFor(dark) {
  return dark ? {
    pageBg:        "#0b1220",
    cardBg:        "#131c2c",
    cardBorder:    "rgba(255, 255, 255, 0.08)",
    inputBg:       "rgba(255, 255, 255, 0.03)",
    inputBorder:   "rgba(255, 255, 255, 0.12)",
    strong:        "#f1f5f9",
    body:          "#e2e8f0",
    muted:         "#94a3b8",
    soft:          "#cbd5e1",
    label:         "#94a3b8",
    fadedBg:       "rgba(255, 255, 255, 0.03)",
    fadedBorder:   "rgba(255, 255, 255, 0.10)",
    divider:       "rgba(255, 255, 255, 0.08)",
    errorBg:       "rgba(239, 68, 68, 0.14)",
    errorFg:       "#fca5a5",
    errorBorder:   "rgba(239, 68, 68, 0.32)",
    successBg:     "rgba(16, 185, 129, 0.14)",
    successFg:     "#a7f3d0",
    successBorder: "rgba(16, 185, 129, 0.32)",
    toastBg:       "#0f172a",
    statusPending: { bg: "rgba(251, 191, 36, 0.16)", fg: "#fbbf24" },
    statusApproved:{ bg: "rgba(16, 185, 129, 0.16)", fg: "#6ee7b7" },
    statusRejected:{ bg: "rgba(239, 68, 68, 0.16)",  fg: "#fca5a5" },
  } : {
    pageBg:        "#f8fafc",
    cardBg:        "#ffffff",
    cardBorder:    "#e5e7eb",
    inputBg:       "#ffffff",
    inputBorder:   "#e5e7eb",
    strong:        "#0f172a",
    body:          "#334155",
    muted:         "#94a3b8",
    soft:          "#64748b",
    label:         "#475569",
    fadedBg:       "#f8fafc",
    fadedBorder:   "#e5e7eb",
    divider:       "#f1f5f9",
    errorBg:       "#fef2f2",
    errorFg:       "#991b1b",
    errorBorder:   "#fecaca",
    successBg:     "#f0fdf4",
    successFg:     "#166534",
    successBorder: "#bbf7d0",
    toastBg:       "#0f172a",
    statusPending: { bg: "#fef3c7", fg: "#854d0e" },
    statusApproved:{ bg: "#dcfce7", fg: "#166534" },
    statusRejected:{ bg: "#fee2e2", fg: "#991b1b" },
  };
}


const CATEGORIES = [
  { value: "TRAVEL",          label: "Travel" },
  { value: "FOOD",            label: "Food" },
  { value: "ACCOMMODATION",   label: "Accommodation" },
  { value: "OFFICE_SUPPLIES", label: "Office supplies" },
  { value: "FUEL",            label: "Fuel" },
  { value: "COMMUNICATION",   label: "Communication" },
  { value: "CLIENT_MEETING",  label: "Client meeting" },
  { value: "TRAINING",        label: "Training" },
  { value: "OTHER",           label: "Other" },
];


function StatusPill({ status, pal }) {
  const key = status === "APPROVED" ? "statusApproved"
            : status === "REJECTED" ? "statusRejected"
            : "statusPending";
  const t = pal[key];
  const label = status === "APPROVED" ? "APPROVED"
              : status === "REJECTED" ? "REJECTED"
              : "PENDING";
  return (
    <span
      style={{
        display: "inline-block",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 10,
        fontWeight: 700,
        background: t.bg,
        color: t.fg,
        letterSpacing: 0.5,
      }}
    >
      {label}
    </span>
  );
}


function inr(n) {
  if (n === null || n === undefined || isNaN(n)) return "-";
  return "₹" + Number(n).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}


// Human-readable category label for the claim rows (FOOD → Food).
function catLabel(code) {
  const found = CATEGORIES.find((c) => c.value === code);
  if (found) return found.label;
  return (code || "").toLowerCase().replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}


export default function MyAllowanceSection({ employeeId }) {

  const dark = useDarkMode();
  const pal = paletteFor(dark);

  const [rows, setRows] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");

  const [form, setForm] = useState({
    CATEGORY: "TRAVEL",
    AMOUNT: "",
    EXPENSE_DATE: new Date().toISOString().slice(0, 10),
    DESCRIPTION: "",
  });

  const [submitting, setSubmitting] = useState(false);

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
  };

  const load = async () => {
    if (!employeeId) return;
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        API.get(`/allowances?employee_id=${encodeURIComponent(employeeId)}`),
        API.get(`/allowances/summary?employee_id=${encodeURIComponent(employeeId)}`),
      ]);
      setRows(list.data || []);
      setSummary(sum.data || null);
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load allowances.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [employeeId]);

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!form.AMOUNT || Number(form.AMOUNT) <= 0) {
      setError("Amount must be greater than zero.");
      return;
    }
    if (!form.EXPENSE_DATE) {
      setError("Expense date is required.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      await API.post("/allowances", {
        EMPLOYEE_ID: employeeId,
        CATEGORY: form.CATEGORY,
        AMOUNT: Number(form.AMOUNT),
        EXPENSE_DATE: form.EXPENSE_DATE,
        DESCRIPTION: form.DESCRIPTION || null,
      });
      showToast("Expense submitted. The MD has been notified.");
      setForm({
        CATEGORY: "TRAVEL",
        AMOUNT: "",
        EXPENSE_DATE: new Date().toISOString().slice(0, 10),
        DESCRIPTION: "",
      });
      load();
    } catch (e) {
      setError(e?.response?.data?.detail || "Submission failed.");
    } finally {
      setSubmitting(false);
    }
  };


  // ------- shared styles -------
  const labelStyle = {
    fontSize: 11,
    fontWeight: 600,
    color: pal.label,
    letterSpacing: 0.4,
    textTransform: "uppercase",
    display: "block",
    marginBottom: 6,
  };

  const inputStyle = {
    width: "100%",
    height: 44,
    padding: "0 12px",
    border: `1px solid ${pal.inputBorder}`,
    borderRadius: 8,
    fontSize: 14,
    fontFamily: "inherit",
    background: pal.inputBg,
    color: pal.strong,
    colorScheme: dark ? "dark" : "light",
    boxSizing: "border-box",
    outline: "none",
    transition: "border-color 120ms, box-shadow 120ms",
  };


  return (
    <div className="bvc-allow-root" style={{ display: "grid", gap: 12 }}>

      {/* ================= 1. HERO ================= */}
      <section
        style={{
          background: pal.cardBg,
          border: `1px solid ${pal.cardBorder}`,
          borderLeft: `3px solid ${BVC_RED}`,
          borderRadius: 12,
          padding: "16px 18px",
          boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
          display: "flex",
          flexWrap: "wrap",
          gap: 16,
          alignItems: "flex-start",
        }}
      >
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{
            fontSize: 10.5, fontWeight: 700, letterSpacing: 1.4,
            color: BVC_RED, textTransform: "uppercase",
            marginBottom: 6,
          }}>
            Expense claims
          </div>
          <h1 style={{
            fontSize: 19, fontWeight: 700, letterSpacing: -0.3,
            lineHeight: 1.25, margin: "0 0 6px 0", color: pal.strong,
          }}>
            Submit office-related expenses for approval
          </h1>
          <p style={{
            fontSize: 12.5, lineHeight: 1.55, margin: 0, color: pal.soft,
          }}>
            Travel, food, supplies, fuel and more. The Managing Director
            receives an email the moment you submit.
          </p>
        </div>

        {summary && (
          <div
            className="bvc-allow-hero-stat"
            style={{
              paddingLeft: 16,
              borderLeft: `1px solid ${pal.divider}`,
              textAlign: "right",
              minWidth: 128,
              flex: "0 1 auto",
              alignSelf: "stretch",
              display: "flex",
              flexDirection: "column",
              justifyContent: "center",
            }}
          >
            <div style={{
              fontSize: 10, fontWeight: 700, letterSpacing: 1.3,
              color: BVC_RED, textTransform: "uppercase",
              marginBottom: 4,
            }}>
              This month
            </div>
            <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: -0.5, lineHeight: 1.05, color: pal.strong }}>
              {inr((summary.pending_amount || 0) + (summary.approved_amount || 0))}
            </div>
            <div style={{ fontSize: 11, marginTop: 4, color: pal.muted }}>
              {summary.total} claim{summary.total === 1 ? "" : "s"} submitted
            </div>
          </div>
        )}
      </section>

      {/* ================= 2. STATS ================= */}
      {summary && (
        <section
          className="bvc-allow-stats"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
            gap: 10,
          }}
        >
          <StatCard pal={pal} tint="blue"  icon={<IconClipboard />} label="Total claims" value={summary.total} />
          <StatCard pal={pal} tint="amber" icon={<IconClock />}     label="Pending"      value={summary.pending}  sub={inr(summary.pending_amount)} />
          <StatCard pal={pal} tint="green" icon={<IconCheck />}     label="Approved"     value={summary.approved} sub={inr(summary.approved_amount)} />
          <StatCard pal={pal} tint="red"   icon={<IconX />}         label="Rejected"     value={summary.rejected} />
        </section>
      )}

      {/* ================= 3. NEW EXPENSE FORM ================= */}
      <section style={{
        background: pal.cardBg,
        border: `1px solid ${pal.cardBorder}`,
        borderRadius: 12,
        padding: 16,
        boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.3,
          color: pal.strong,
          textTransform: "uppercase",
          marginBottom: 12,
        }}>
          New expense
        </div>

        <form onSubmit={submit} className="bvc-allow-form">

          <div className="bvc-allow-form-grid">
            <div>
              <label style={labelStyle}>Category</label>
              <select
                className="bvc-allow-input"
                value={form.CATEGORY}
                onChange={(e) => setForm({ ...form, CATEGORY: e.target.value })}
                style={inputStyle}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>

            <div>
              <label style={labelStyle}>Amount (₹)</label>
              <div style={{ position: "relative" }}>
                <span style={{
                  position: "absolute",
                  left: 12,
                  top: "50%",
                  transform: "translateY(-50%)",
                  color: pal.muted,
                  fontSize: 14,
                  fontWeight: 500,
                  pointerEvents: "none",
                }}>
                  ₹
                </span>
                <input
                  className="bvc-allow-input"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={form.AMOUNT}
                  onChange={(e) => setForm({ ...form, AMOUNT: e.target.value })}
                  placeholder="1250"
                  style={{ ...inputStyle, paddingLeft: 28 }}
                />
              </div>
            </div>

            <div>
              <label style={labelStyle}>Expense date</label>
              <input
                className="bvc-allow-input"
                type="date"
                value={form.EXPENSE_DATE}
                onChange={(e) => setForm({ ...form, EXPENSE_DATE: e.target.value })}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ marginTop: 10 }}>
            <label style={labelStyle}>Description</label>
            <textarea
              className="bvc-allow-input"
              rows={2}
              value={form.DESCRIPTION}
              onChange={(e) => setForm({ ...form, DESCRIPTION: e.target.value })}
              placeholder="What was the expense for? Who was it with? Where?"
              style={{
                ...inputStyle,
                height: "auto",
                minHeight: 68,
                padding: "10px 12px",
                resize: "vertical",
                lineHeight: 1.4,
              }}
            />
          </div>

          {error && (
            <div
              role="alert"
              style={{
                marginTop: 10,
                padding: "9px 12px",
                background: pal.errorBg,
                color: pal.errorFg,
                border: `1px solid ${pal.errorBorder}`,
                borderRadius: 8,
                fontSize: 12.5,
              }}
            >
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="bvc-allow-submit"
            style={{
              marginTop: 14,
              width: "100%",
              height: 46,
              background: submitting ? "#94a3b8" : BVC_RED,
              color: "#ffffff",
              border: "none",
              borderRadius: 10,
              fontWeight: 700,
              fontSize: 14,
              letterSpacing: 0.2,
              cursor: submitting ? "wait" : "pointer",
              transition: "background 120ms, transform 40ms",
              boxShadow: submitting ? "none" : "0 1px 2px rgba(200,16,46,0.20)",
            }}
          >
            {submitting ? "Submitting…" : "Submit for approval"}
          </button>
        </form>
      </section>

      {/* ================= 4. SUBMITTED CLAIMS ================= */}
      <section style={{
        background: pal.cardBg,
        border: `1px solid ${pal.cardBorder}`,
        borderRadius: 12,
        padding: "14px 4px 4px 4px",
        boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
      }}>
        <div style={{
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: 1.3,
          color: pal.strong,
          textTransform: "uppercase",
          margin: "0 12px 10px 12px",
        }}>
          My submitted claims ({rows.length})
        </div>

        {loading && (
          <div style={{ color: pal.muted, fontSize: 13, padding: "10px 14px" }}>
            Loading…
          </div>
        )}

        {!loading && rows.length === 0 && (
          <div style={{
            margin: "0 12px 12px 12px",
            color: pal.soft,
            fontSize: 13,
            padding: 14,
            background: pal.fadedBg,
            border: `1px dashed ${pal.fadedBorder}`,
            borderRadius: 8,
            textAlign: "center",
          }}>
            No expense claims yet. Submit your first one above.
          </div>
        )}

        {!loading && rows.length > 0 && (
          <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
            {rows.map((r, idx) => (
              <li
                key={r.ID}
                style={{
                  padding: "12px 14px",
                  borderTop: idx === 0 ? "none" : `1px solid ${pal.divider}`,
                  display: "grid",
                  gridTemplateColumns: "1fr auto",
                  columnGap: 12,
                  rowGap: 2,
                  alignItems: "center",
                }}
              >
                <div style={{ minWidth: 0 }}>
                  <div style={{
                    fontSize: 13.5,
                    fontWeight: 600,
                    color: pal.strong,
                    letterSpacing: 0.1,
                  }}>
                    {catLabel(r.CATEGORY)}
                  </div>
                  <div style={{
                    fontSize: 11.5,
                    color: pal.muted,
                    marginTop: 2,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}>
                    {r.EXPENSE_DATE
                      ? new Date(r.EXPENSE_DATE).toLocaleDateString("en-IN", {
                          day: "2-digit", month: "short", year: "numeric",
                        })
                      : "—"}
                    {r.DESCRIPTION ? ` · ${r.DESCRIPTION}` : ""}
                  </div>
                  {r.REVIEW_NOTES && (
                    <div style={{
                      marginTop: 6,
                      padding: "5px 8px",
                      background: r.STATUS === "REJECTED" ? pal.errorBg : pal.successBg,
                      border: `1px solid ${r.STATUS === "REJECTED" ? pal.errorBorder : pal.successBorder}`,
                      color: r.STATUS === "REJECTED" ? pal.errorFg : pal.successFg,
                      borderRadius: 6,
                      fontSize: 11.5,
                      lineHeight: 1.4,
                    }}>
                      <b>MD:</b> {r.REVIEW_NOTES}
                    </div>
                  )}
                </div>

                <div style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "flex-end",
                  gap: 4,
                }}>
                  <div style={{
                    fontSize: 15,
                    fontWeight: 700,
                    color: pal.strong,
                    letterSpacing: -0.2,
                    fontVariantNumeric: "tabular-nums",
                  }}>
                    {inr(r.AMOUNT)}
                  </div>
                  <StatusPill status={r.STATUS} pal={pal} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ================= 5. TOAST ================= */}
      {toast && (
        <div
          role="status"
          style={{
            position: "fixed",
            left: "50%",
            transform: "translateX(-50%)",
            bottom: "calc(env(safe-area-inset-bottom, 0px) + 20px)",
            background: pal.toastBg,
            color: "white",
            padding: "11px 18px",
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
            zIndex: 9999,
            maxWidth: "calc(100% - 32px)",
          }}
        >
          {toast}
        </div>
      )}

      {/* ================= mobile-first CSS ================= */}
      <style>{`
        .bvc-allow-root {
          font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI',
                       Roboto, 'Helvetica Neue', Arial, sans-serif;
          padding-bottom: env(safe-area-inset-bottom, 0px);
        }

        /* Form field grid: single-column on mobile, 3-up on wider screens. */
        .bvc-allow-form-grid {
          display: grid;
          grid-template-columns: 1fr;
          gap: 10px;
        }
        @media (min-width: 640px) {
          .bvc-allow-form-grid {
            grid-template-columns: repeat(3, minmax(0, 1fr));
            gap: 12px;
          }
        }

        /* Focus ring — subtle red glow instead of the browser default. */
        .bvc-allow-input:focus,
        .bvc-allow-input:focus-visible {
          border-color: ${BVC_RED} !important;
          box-shadow: 0 0 0 3px rgba(200, 16, 46, 0.14) !important;
        }

        .bvc-allow-submit:hover:not(:disabled) {
          background: ${BVC_DARK} !important;
        }
        .bvc-allow-submit:active:not(:disabled) {
          transform: translateY(1px);
        }
        .bvc-allow-submit:focus-visible {
          outline: 2px solid ${BVC_RED};
          outline-offset: 2px;
        }

        /* Placeholder tone */
        .bvc-allow-input::placeholder {
          color: ${pal.muted};
          opacity: 1;
        }

        /* On very narrow phones, drop the hero's "This month" chip to a
           new row so the headline gets full width. */
        @media (max-width: 400px) {
          .bvc-allow-hero-stat {
            border-left: none !important;
            padding-left: 0 !important;
            text-align: left !important;
            border-top: 1px solid ${pal.divider};
            padding-top: 10px !important;
            width: 100%;
          }
        }
      `}</style>
    </div>
  );
}


// ---------------------------------------------------------------------
// StatCard — one of the 2×2 statistic tiles.
// tint drives the icon square's colour so blue/amber/green/red pick
// their own soft background + saturated icon at a glance.
// ---------------------------------------------------------------------
const TILE_TINTS = {
  blue:  { light: { bg: "#eff6ff", fg: "#1d4ed8" }, dark: { bg: "rgba(59, 130, 246, 0.18)", fg: "#93c5fd" } },
  amber: { light: { bg: "#fffbeb", fg: "#b45309" }, dark: { bg: "rgba(251, 191, 36, 0.18)", fg: "#fbbf24" } },
  green: { light: { bg: "#ecfdf5", fg: "#047857" }, dark: { bg: "rgba(16, 185, 129, 0.18)", fg: "#6ee7b7" } },
  red:   { light: { bg: "#fef2f2", fg: "#b91c1c" }, dark: { bg: "rgba(239, 68, 68, 0.18)",  fg: "#fca5a5" } },
};

function StatCard({ pal, tint, icon, label, value, sub }) {
  const isDark = pal.strong === "#f1f5f9";
  const t = TILE_TINTS[tint] || TILE_TINTS.blue;
  const tone = isDark ? t.dark : t.light;

  return (
    <div style={{
      background: pal.cardBg,
      border: `1px solid ${pal.cardBorder}`,
      borderRadius: 12,
      padding: 14,
      boxShadow: "0 1px 2px rgba(15,23,42,0.03)",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      minHeight: 96,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{
          width: 32, height: 32, borderRadius: 8,
          background: tone.bg, color: tone.fg,
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          flexShrink: 0,
        }}>
          {icon}
        </span>
        <div style={{
          fontSize: 10.5,
          fontWeight: 600,
          letterSpacing: 0.8,
          color: pal.soft,
          textTransform: "uppercase",
        }}>
          {label}
        </div>
      </div>
      <div style={{
        fontSize: 24,
        fontWeight: 800,
        color: pal.strong,
        letterSpacing: -0.4,
        lineHeight: 1,
      }}>
        {value}
      </div>
      {sub && (
        <div style={{ fontSize: 11.5, color: pal.muted, marginTop: -2 }}>
          {sub}
        </div>
      )}
    </div>
  );
}
