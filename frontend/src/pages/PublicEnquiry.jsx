// =====================================================================
// Public Customer Enquiry — step-by-step chatbot intake at /enquiry
//
// Anyone with the link can fill this. Each answer maps to one field
// on the Customer / CustomerRequirement model. On submit the data
// lands in the Admin's Customers list and the 360° drawer.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import styles from "./PublicEnquiry.module.css";


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

    <div className={styles.shell}>

      <div className={styles.card}>

        {/* ---- Header ---- */}
        <div className={styles.header}>
          <div className={styles.headerEyebrow}>
            BVC24 · AI Smart Manufacturing
          </div>
          <div className={styles.headerTitle}>
            🤖 Tell us about your requirement
          </div>
          {!isDone && (

            <div className={styles.progressWrap}>
              <div className={styles.progressTrack}>
                {/* width is runtime-computed from step/total — must stay inline */}
                <div
                  className={styles.progressFill}
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className={styles.progressLabel}>
                {isReview
                  ? "Review your answers"
                  : `Question ${step + 1} of ${total}  ·  ${q?.section}`}
              </div>
            </div>
          )}
        </div>

        {/* ---- Body ---- */}
        <div className={styles.body}>

          {/* QUESTION SCREEN */}
          {!isReview && !isDone && q && (

            <>

              <div className={styles.questionLabel}>
                {q.label}
                {q.required && (
                  <span className={styles.required}>*</span>
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
                  className={styles.input}
                />
              )}

              {q.type === "select" && (

                <select
                  ref={inputRef}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  className={styles.input}
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
                  className={styles.input}
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
                  className={styles.input}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") submitCurrent();
                  }}
                />
              )}

              {error && (

                <div className={styles.errorMsg}>
                  {error}
                </div>
              )}

              {/* Buttons */}
              <div className={styles.btnRow}>

                <button
                  onClick={goBack}
                  disabled={step === 0}
                  className={styles.btnGhost}
                >
                  ‹ Back
                </button>

                <div className={styles.btnRight}>

                  {!q.required && (

                    <button onClick={skipCurrent} className={styles.btnGhost}>
                      Skip
                    </button>
                  )}

                  <button onClick={submitCurrent} className={styles.btnPrimary}>
                    {step === total - 1 ? "Review →" : "Next →"}
                  </button>
                </div>
              </div>
            </>
          )}

          {/* REVIEW SCREEN */}
          {isReview && (

            <>
              <div className={styles.reviewTitle}>
                Almost done — review your answers
              </div>

              <div className={styles.reviewSub}>
                Click any row to edit. Hit Submit when you're happy.
              </div>

              {["Company", "Machine"].map((sec) => (

                <div key={sec} className={styles.reviewSection}>

                  <div className={styles.reviewSectionTitle}>
                    {sec === "Company" ? "Company Details" : "Machine Request"}
                  </div>

                  <div className={styles.reviewTable}>
                    {QUESTIONS.filter((qq) => qq.section === sec).map((qq, i, arr) => {

                      const v = answers[qq.key];

                      const display = v || <span className={styles.reviewRowEmpty}>—</span>;

                      const qIdx = QUESTIONS.findIndex((x) => x.key === qq.key);

                      return (

                        <div
                          key={qq.key}
                          onClick={() => setStep(qIdx)}
                          className={
                            i < arr.length - 1
                              ? `${styles.reviewRow} ${styles.reviewRowBordered}`
                              : styles.reviewRow
                          }
                        >
                          <div className={styles.reviewRowKey}>
                            {qq.label.replace(/\?$/, "")}
                          </div>
                          <div className={styles.reviewRowVal}>
                            {display}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {error && (

                <div className={styles.errorMsg}>
                  {error}
                </div>
              )}

              <div className={styles.reviewBtnRow}>
                <button onClick={goBack} className={styles.btnGhost}>
                  ‹ Back
                </button>
                <button
                  onClick={submitAll}
                  disabled={submitting}
                  className={styles.btnPrimary}
                >
                  {submitting ? "Submitting…" : "✓ Submit Enquiry"}
                </button>
              </div>
            </>
          )}

          {/* DONE SCREEN */}
          {isDone && result && (

            <div className={styles.doneWrap}>

              <div className={styles.doneEmoji}>
                🎉
              </div>

              <div className={styles.doneTitle}>
                Thanks for reaching out!
              </div>

              <div className={styles.doneMessage}>
                {result.message}
              </div>

              <div className={styles.doneRef}>
                Reference: <strong>{result.customer_code}</strong>
              </div>

              <div className={styles.doneActions}>
                <button
                  onClick={() => {
                    setAnswers({});
                    setResult(null);
                    setStep(0);
                  }}
                  className={styles.btnGhost}
                >
                  Submit another enquiry
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ---- Footer ---- */}
        {!isDone && (

          <div className={styles.footer}>
            Powered by BVC24 · Your details stay private and are only used to prepare your quote.
          </div>
        )}
      </div>
    </div>
  );
}
