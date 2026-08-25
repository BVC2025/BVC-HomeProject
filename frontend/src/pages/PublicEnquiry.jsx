// =====================================================================
// Public Customer Enquiry — step-by-step chatbot intake at /enquiry
//
// Anyone with the link can fill this. Each answer maps to one field
// on the (now much slimmer) Customer model, plus a single free-text
// summary of what they're looking for. On submit the data lands in
// the Admin's Customers list and the 360° drawer.
// =====================================================================

import { useEffect, useRef, useState } from "react";

import API from "../services/api";
import styles from "./PublicEnquiry.module.css";


// Field order matches the Customer 360° view layout, so the admin
// sees fields in the same order the customer filled them.
const QUESTIONS = [
  {
    key: "NAME",
    section: "Company",
    label: "What's your name?",
    placeholder: "e.g. Suresh Iyer",
    required: true,
    type: "text"
  },
  {
    key: "COMPANY_NAME",
    section: "Company",
    label: "What's your company name? (optional)",
    placeholder: "e.g. Chennai Metro Rail Ltd",
    required: false,
    type: "text"
  },
  {
    key: "PHONE_NUMBER",
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
    key: "ADDRESS",
    section: "Company",
    label: "Your address? (street, city, state — whatever you have)",
    placeholder: "e.g. 12 Anna Salai, Chennai, Tamil Nadu",
    required: false,
    type: "text"
  },
  {
    key: "GST_NUMBER",
    section: "Company",
    label: "GST number, if you have one? (optional)",
    placeholder: "e.g. 33ABCDE1234F1Z5",
    required: false,
    type: "text"
  },
  {
    key: "_SUMMARY",
    section: "Requirement",
    label: "Tell us what you're looking for — machine type, quantity, timeline, anything else",
    placeholder: "e.g. Need 5 snack vending machines by next month for our metro station.",
    required: false,
    type: "textarea"
  }
];

// Map each answer key to the body shape the backend expects. The
// backend's /public/enquiry/submit route still only reads company
// name/phone/email (+ CITY/STATE for a legacy address string), so we
// keep sending those under their old wire names, and add ADDRESS /
// COMPANY_NAME / GST_NUMBER as extra top-level fields the backend is
// free to pick up later — unrecognized fields are ignored, not errors.
function buildPayload(answers) {

  return {
    company: {
      CUSTOMER_NAME: answers.NAME || "",
      CONTACT_PERSON: "",
      DESIGNATION: "",
      PHONE: answers.PHONE_NUMBER || "",
      EMAIL: answers.EMAIL || "",
      CITY: "",
      STATE: "",
      INDUSTRY: ""
    },
    requirement: {},
    COMPANY_NAME: answers.COMPANY_NAME || null,
    ADDRESS: answers.ADDRESS || null,
    GST_NUMBER: answers.GST_NUMBER || null,
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

  const [submitting, setSubmitting] = useState(false);

  const [result, setResult] = useState(null);

  const [error, setError] = useState("");

  const inputRef = useRef(null);

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

              {(q.type === "text" || q.type === "tel" ||
                q.type === "email") && (

                <input
                  ref={inputRef}
                  type={q.type}
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder={q.placeholder}
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

              {["Company", "Requirement"].map((sec) => (

                <div key={sec} className={styles.reviewSection}>

                  <div className={styles.reviewSectionTitle}>
                    {sec === "Company" ? "Company Details" : "Your Requirement"}
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
                We'll reach out on <strong>{answers.PHONE_NUMBER || "the number you gave us"}</strong>.
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
