// =====================================================================
// Public Customer Enquiry — step-by-step chatbot intake at /enquiry
//
// Anyone with the link can fill this. Each answer maps to one field
// on the Customer / CustomerRequirement model. On submit the data
// lands in the Admin's Customers list and the 360° drawer.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";


// Field order matches the Customer 360° view layout, so the admin
// sees fields in the same order the customer filled them.
const QUESTIONS = [
  // --- PHASE 1: Company ---
  {
    key: "CUSTOMER_NAME",
    section: "Company",
    label: "What's your company name?",
    placeholder: "e.g. Chennai Metro Rail Ltd",
    required: true,
    type: "text"
  },
  {
    key: "CONTACT_PERSON",
    section: "Company",
    label: "What's your name?",
    placeholder: "e.g. Suresh Iyer",
    required: false,
    type: "text"
  },
  {
    key: "DESIGNATION",
    section: "Company",
    label: "Your role at the company? (optional)",
    placeholder: "e.g. Purchase Manager",
    required: false,
    type: "text"
  },
  {
    key: "PHONE",
    section: "Company",
    label: "Best phone number to reach you?",
    placeholder: "e.g. +91 7603909649",
    required: true,
    type: "tel"
  },
  {
    key: "EMAIL",
    section: "Company",
    label: "Your email address? (optional but recommended)",
    placeholder: "e.g. you@company.com",
    required: false,
    type: "email"
  },
  {
    key: "CITY",
    section: "Company",
    label: "Which city are you based in?",
    placeholder: "e.g. Chennai",
    required: false,
    type: "text"
  },
  {
    key: "STATE",
    section: "Company",
    label: "Which state?",
    placeholder: "e.g. Tamil Nadu",
    required: false,
    type: "text"
  },
  {
    key: "INDUSTRY",
    section: "Company",
    label: "Which industry are you in?",
    required: false,
    type: "select",
    optionsKey: "industries"
  },

  // --- PHASE 2: Machine requirement ---
  {
    key: "MACHINE_CATEGORY",
    section: "Machine",
    label: "What type of vending machine do you need?",
    required: false,
    type: "select",
    optionsKey: "machine_categories"
  },
  {
    key: "QUANTITY",
    section: "Machine",
    label: "How many machines do you need?",
    placeholder: "e.g. 5",
    required: false,
    type: "number",
    min: 1
  },
  {
    key: "CAPACITY",
    section: "Machine",
    label: "Capacity needed? (e.g. number of selections or shelves)",
    placeholder: "e.g. 8 snack columns + 6 chiller shelves",
    required: false,
    type: "text"
  },
  {
    key: "TARGET_UNIT_PRICE",
    section: "Machine",
    label: "Target price per machine in ₹? (optional)",
    placeholder: "e.g. 350000",
    required: false,
    type: "number",
    min: 0
  },
  {
    key: "TARGET_DELIVERY_DATE",
    section: "Machine",
    label: "When do you need it by?",
    required: false,
    type: "date"
  },
  {
    key: "INSTALLATION_SITE",
    section: "Machine",
    label: "Where will it be installed?",
    placeholder: "e.g. Chennai Central metro station, Concourse level",
    required: false,
    type: "text"
  },
  {
    key: "SPECIAL_NOTES",
    section: "Machine",
    label: "Any special features, branding or notes?",
    placeholder: "e.g. Touchscreen + cashless. BVC logo branding. Refrigerated bay 4-8°C.",
    required: false,
    type: "textarea"
  }
];

// Map each answer key to the body shape the backend expects
function buildPayload(answers) {

  return {
    company: {
      CUSTOMER_NAME: answers.CUSTOMER_NAME || "",
      CONTACT_PERSON: answers.CONTACT_PERSON || null,
      DESIGNATION: answers.DESIGNATION || null,
      PHONE: answers.PHONE || "",
      EMAIL: answers.EMAIL || null,
      CITY: answers.CITY || null,
      STATE: answers.STATE || null,
      INDUSTRY: answers.INDUSTRY || null
    },
    requirement: {
      MACHINE_CATEGORY: answers.MACHINE_CATEGORY || null,
      MACHINE_NAME: null,
      QUANTITY: answers.QUANTITY ? Number(answers.QUANTITY) : 1,
      CAPACITY: answers.CAPACITY || null,
      TARGET_UNIT_PRICE: answers.TARGET_UNIT_PRICE
        ? Number(answers.TARGET_UNIT_PRICE) : null,
      TARGET_DELIVERY_DATE: answers.TARGET_DELIVERY_DATE || null,
      INSTALLATION_SITE: answers.INSTALLATION_SITE || null,
      SPECIAL_NOTES: answers.SPECIAL_NOTES || null
    },
    free_text_summary: answers._SUMMARY || null,
    VENDOR_ID: 1
  };
}


export default function PublicEnquiry() {

  const [step, setStep] = useState(0);   // current question index OR review/done
  // step values:  0..N-1 = QUESTIONS[step]
  //               N      = review screen
  //               N+1    = done

  const [answers, setAnswers] = useState({});

  const [draft, setDraft] = useState("");

  const [options, setOptions] = useState({
    industries: [],
    machine_categories: []
  });

  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  const inputRef = useRef(null);

  // Pull dropdown options once on mount
  useEffect(() => {

    API.get("/public/enquiry/options")
      .then((r) => setOptions(r.data || { industries: [], machine_categories: [] }))
      .catch(() => { /* non-fatal */ });

  }, []);

  // Focus the input each time the question changes
  useEffect(() => {

    setTimeout(() => inputRef.current?.focus(), 100);

  }, [step]);

  const total = QUESTIONS.length;

  const isReview = step === total;

  const isDone = step === total + 1;

  const q = QUESTIONS[step];

  const progressPct = Math.min(100, Math.round((step / total) * 100));

  // Sync the draft input with the existing answer when revisiting a question
  useEffect(() => {

    if (q) setDraft(answers[q.key] || "");

  }, [step]);

  const submitCurrent = () => {

    setError("");

    if (q.required && !draft.trim()) {

      setError("This one is required — please answer to continue.");

      return;
    }

    setAnswers((a) => ({ ...a, [q.key]: draft.trim() }));

    setStep((s) => s + 1);
  };

  const skipCurrent = () => {

    if (q.required) {

      setError("Sorry, this question can't be skipped.");

      return;
    }

    setAnswers((a) => ({ ...a, [q.key]: "" }));

    setStep((s) => s + 1);
  };

  const goBack = () => {

    setError("");

    if (step > 0) setStep((s) => s - 1);
  };

  const submitAll = async () => {

    setSubmitting(true);

    setError("");

    try {

      const res = await API.post(
        "/public/enquiry/submit",
        buildPayload(answers)
      );

      setResult(res.data || {});

      setStep(total + 1);

    } catch (e) {

      setError(
        e?.response?.data?.detail ||
        "Sorry, we couldn't submit just now. Please try again in a moment."
      );

    } finally {

      setSubmitting(false);
    }
  };

  // ============= RENDER =============

  return (

    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1a0307 0%, #4a0a14 50%, #8B0B1F 100%)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "system-ui, -apple-system, sans-serif"
    }}>

      <div style={{
        width: "100%",
        maxWidth: 640,
        background: "white",
        borderRadius: 20,
        boxShadow: "0 30px 80px rgba(0,0,0,0.35)",
        overflow: "hidden"
      }}>

        {/* ---- Header ---- */}
        <div style={{
          padding: "22px 28px",
          background: "linear-gradient(135deg, #C8102E 0%, #8B0B1F 100%)",
          color: "white"
        }}>
          <div style={{
            fontSize: 12,
            letterSpacing: 2,
            fontWeight: 700,
            opacity: 0.85,
            textTransform: "uppercase"
          }}>
            BVC24 · AI Smart Manufacturing
          </div>
          <div style={{
            fontSize: 22,
            fontWeight: 800,
            marginTop: 2,
            letterSpacing: -0.4
          }}>
            🤖 Tell us about your requirement
          </div>
          {!isDone && (

            <div style={{ marginTop: 14 }}>
              <div style={{
                height: 6,
                background: "rgba(255,255,255,0.18)",
                borderRadius: 999,
                overflow: "hidden"
              }}>
                <div style={{
                  width: `${progressPct}%`,
                  height: "100%",
                  background: "white",
                  transition: "width 0.4s ease"
                }} />
              </div>
              <div style={{
                fontSize: 11,
                marginTop: 6,
                opacity: 0.9,
                fontWeight: 600
              }}>
                {isReview
                  ? "Review your answers"
                  : `Question ${step + 1} of ${total}  ·  ${q?.section}`}
              </div>
            </div>
          )}
        </div>

        {/* ---- Body ---- */}
        <div style={{ padding: "28px 28px 22px" }}>

          {/* QUESTION SCREEN */}
          {!isReview && !isDone && q && (

            <>

              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#0f172a",
                marginBottom: 16,
                lineHeight: 1.4
              }}>
                {q.label}
                {q.required && (
                  <span style={{ color: "#C8102E", marginLeft: 4 }}>*</span>
                )}
              </div>

              {/* Field by type */}
              {q.type === "textarea" && (

                <textarea
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={q.placeholder}
                  rows={4}
                  style={inputStyle()}
                />
              )}

              {q.type === "select" && (

                <select
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={inputStyle()}
                >
                  <option value="">— pick one —</option>
                  {(options[q.optionsKey] || []).map((o) => (

                    typeof o === "string"
                      ? <option key={o} value={o}>{o}</option>
                      : <option key={o.key} value={o.key}>{o.label}</option>
                  ))}
                </select>
              )}

              {q.type === "date" && (

                <input
                  ref={inputRef}
                  type="date"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  style={inputStyle()}
                />
              )}

              {(q.type === "text" || q.type === "tel" ||
                q.type === "email" || q.type === "number") && (

                <input
                  ref={inputRef}
                  type={q.type}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={q.placeholder}
                  min={q.min}
                  style={inputStyle()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCurrent();
                  }}
                />
              )}

              {error && (

                <div style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  color: "#991b1b",
                  fontSize: 13
                }}>
                  {error}
                </div>
              )}

              {/* Buttons */}
              <div style={{
                marginTop: 22,
                display: "flex",
                justifyContent: "space-between",
                gap: 10
              }}>

                <button
                  onClick={goBack}
                  disabled={step === 0}
                  style={{
                    ...btnGhost,
                    opacity: step === 0 ? 0.4 : 1,
                    cursor: step === 0 ? "not-allowed" : "pointer"
                  }}
                >
                  ‹ Back
                </button>

                <div style={{ display: "flex", gap: 10 }}>

                  {!q.required && (

                    <button onClick={skipCurrent} style={btnGhost}>
                      Skip
                    </button>
                  )}

                  <button onClick={submitCurrent} style={btnPrimary}>
                    {step === total - 1 ? "Review →" : "Next →"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* REVIEW SCREEN */}
          {isReview && (

            <>
              <div style={{
                fontSize: 18,
                fontWeight: 700,
                color: "#0f172a",
                marginBottom: 6
              }}>
                Almost done — review your answers
              </div>

              <div style={{
                fontSize: 13,
                color: "#64748b",
                marginBottom: 18
              }}>
                Click any row to edit. Hit Submit when you're happy.
              </div>

              {["Company", "Machine"].map((sec) => (

                <div key={sec} style={{ marginBottom: 18 }}>

                  <div style={{
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: 1,
                    color: "#C8102E",
                    textTransform: "uppercase",
                    marginBottom: 8
                  }}>
                    {sec === "Company" ? "Company Details" : "Machine Request"}
                  </div>

                  <div style={{
                    border: "1px solid #e2e8f0",
                    borderRadius: 10,
                    overflow: "hidden"
                  }}>
                    {QUESTIONS.filter((qq) => qq.section === sec).map((qq, i, arr) => {

                      const v = answers[qq.key];

                      const display = v || <span style={{ color: "#94a3b8" }}>—</span>;

                      const qIdx = QUESTIONS.findIndex((x) => x.key === qq.key);

                      return (

                        <div
                          key={qq.key}
                          onClick={() => setStep(qIdx)}
                          style={{
                            padding: "10px 14px",
                            borderBottom: i < arr.length - 1
                              ? "1px solid #f1f5f9" : "none",
                            cursor: "pointer",
                            background: "white"
                          }}
                          onMouseEnter={(e) => e.currentTarget.style.background = "#f8fafc"}
                          onMouseLeave={(e) => e.currentTarget.style.background = "white"}
                        >
                          <div style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: "#64748b",
                            textTransform: "uppercase",
                            letterSpacing: 0.6
                          }}>
                            {qq.label.replace(/\?$/, "")}
                          </div>
                          <div style={{
                            fontSize: 14,
                            color: "#0f172a",
                            fontWeight: 600,
                            marginTop: 2
                          }}>
                            {display}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {error && (

                <div style={{
                  marginBottom: 14,
                  padding: "8px 12px",
                  background: "#fef2f2",
                  border: "1px solid #fecaca",
                  borderRadius: 8,
                  color: "#991b1b",
                  fontSize: 13
                }}>
                  {error}
                </div>
              )}

              <div style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 10
              }}>
                <button onClick={goBack} style={btnGhost}>
                  ‹ Back
                </button>
                <button
                  onClick={submitAll}
                  disabled={submitting}
                  style={{
                    ...btnPrimary,
                    opacity: submitting ? 0.6 : 1,
                    cursor: submitting ? "wait" : "pointer"
                  }}
                >
                  {submitting ? "Submitting…" : "✓ Submit Enquiry"}
                </button>
              </div>
            </>
          )}

          {/* DONE SCREEN */}
          {isDone && result && (

            <div style={{ textAlign: "center", padding: "22px 10px" }}>

              <div style={{
                fontSize: 64,
                lineHeight: 1,
                marginBottom: 12
              }}>
                🎉
              </div>

              <div style={{
                fontSize: 22,
                fontWeight: 800,
                color: "#0f172a",
                marginBottom: 8
              }}>
                Thanks for reaching out!
              </div>

              <div style={{
                fontSize: 14,
                color: "#475569",
                lineHeight: 1.6,
                marginBottom: 18
              }}>
                {result.message}
              </div>

              <div style={{
                padding: "10px 16px",
                background: "#f1f5f9",
                borderRadius: 10,
                display: "inline-block",
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                color: "#475569"
              }}>
                Reference: <strong>{result.customer_code}</strong>
              </div>

              <div style={{ marginTop: 22 }}>
                <button
                  onClick={() => {
                    setAnswers({});
                    setResult(null);
                    setStep(0);
                  }}
                  style={btnGhost}
                >
                  Submit another enquiry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        {!isDone && (

          <div style={{
            padding: "12px 24px",
            background: "#f8fafc",
            borderTop: "1px solid #e2e8f0",
            fontSize: 11,
            color: "#94a3b8",
            textAlign: "center"
          }}>
            Powered by BVC24 · Your details stay private and are only used to prepare your quote.
          </div>
        )}
      </div>
    </div>
  );
}


// =====================================================================
// Helpers
// =====================================================================

function inputStyle() {

  return {
    width: "100%",
    padding: "12px 14px",
    border: "2px solid #e2e8f0",
    borderRadius: 10,
    fontSize: 15,
    outline: "none",
    fontFamily: "inherit",
    transition: "border-color 0.15s",
    boxSizing: "border-box"
  };
}


const btnPrimary = {
  background: "linear-gradient(135deg, #C8102E 0%, #8B0B1F 100%)",
  color: "white",
  border: "none",
  padding: "12px 24px",
  borderRadius: 10,
  fontWeight: 800,
  fontSize: 14,
  cursor: "pointer",
  letterSpacing: 0.3,
  boxShadow: "0 6px 18px rgba(200,16,46,0.30)"
};


const btnGhost = {
  background: "white",
  color: "#475569",
  border: "1px solid #e2e8f0",
  padding: "10px 18px",
  borderRadius: 10,
  fontWeight: 700,
  fontSize: 13,
  cursor: "pointer"
};
