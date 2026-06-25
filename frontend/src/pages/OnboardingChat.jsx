import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";
import styles from "./OnboardingChat.module.css";


// ----------------------------------------------------------------
// Portal-specific axios — never auto-attaches the admin JWT.
// ----------------------------------------------------------------

const portal = axios.create({ baseURL: API_BASE_URL });

const portalKeyFor = (token) => `portal_session_${token}`;


// ================================================================
// OnboardingChat — AI-driven conversational data collection with
// smart widget rendering (text / select / cards / radio / date /
// number / textarea), live progress, pending breakdown, and
// partial-submit support.
// ================================================================

function OnboardingChat() {

  const { token } = useParams();

  const navigate = useNavigate();

  const sessionKey = localStorage.getItem(portalKeyFor(token));

  const username = localStorage.getItem(`${portalKeyFor(token)}_user`) || "";

  const [history, setHistory] = useState([]);

  const [progress, setProgress] = useState(0);

  const [partial, setPartial] = useState({});

  const [pending, setPending] = useState([]);

  const [filledCount, setFilledCount] = useState(0);

  const [totalFields, setTotalFields] = useState(0);

  const [nextWidget, setNextWidget] = useState({ widget: "text", options: [] });

  const [submitted, setSubmitted] = useState(false);

  const [submittedResult, setSubmittedResult] = useState(null);

  const [input, setInput] = useState("");

  const [sending, setSending] = useState(false);

  const [error, setError] = useState("");

  const [submitting, setSubmitting] = useState(false);

  const [showSavedToast, setShowSavedToast] = useState(false);

  const [confirmPartial, setConfirmPartial] = useState(false);

  const scrollerRef = useRef(null);

  const headers = sessionKey
    ? { Authorization: `Bearer ${sessionKey}` }
    : null;

  // ---- 1. Bounce to landing if not logged in ----
  useEffect(() => {

    if (!sessionKey) {

      navigate(`/portal/onboarding/${token}`, { replace: true });
    }

  }, [sessionKey, token, navigate]);

  // ---- 2. Load history + state on mount ----
  useEffect(() => {

    if (!sessionKey) return;

    Promise.all([
      portal.get(`/onboarding/${token}/history`, { headers }),
      portal.get(`/onboarding/${token}/state`, { headers })
    ])
      .then(([hRes, sRes]) => {

        setHistory(hRes.data?.history || []);

        applyStateUpdate(sRes.data || {});

        if (sRes.data?.submitted) {

          setSubmitted(true);
        }
      })
      .catch((err) => {

        if (err?.response?.status === 401) {

          localStorage.removeItem(portalKeyFor(token));

          navigate(`/portal/onboarding/${token}`, { replace: true });

          return;
        }

        setError(
          err?.response?.data?.detail ||
            "Could not load your onboarding session."
        );
      });

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // ---- 3. Auto-scroll chat to bottom on new messages ----
  useEffect(() => {

    if (scrollerRef.current) {

      scrollerRef.current.scrollTop = scrollerRef.current.scrollHeight;
    }

  }, [history, sending]);

  const applyStateUpdate = (data) => {

    setProgress(data.progress_pct ?? 0);

    setPartial(data.partial ?? {});

    setPending(data.pending ?? []);

    setFilledCount(data.filled_count ?? 0);

    setTotalFields(data.total_fields ?? 0);

    if (data.next_widget) {

      setNextWidget(data.next_widget);
    }
  };

  // ---- 4. Send a chat message (free-form OR widget choice) ----
  const sendMessage = async (msg, opts = {}) => {

    if (!msg || sending || submitted) return;

    setInput("");

    setError("");

    setHistory((h) => [
      ...h,
      { ROLE: "user", CONTENT: msg, CREATED_AT: new Date().toISOString() }
    ]);

    setSending(true);

    try {

      const body = { MESSAGE: msg };

      if (opts.skipFieldKey) {

        body.SKIP_FIELD = opts.skipFieldKey;
      }

      const res = await portal.post(
        `/onboarding/${token}/chat`,
        body,
        { headers }
      );

      const data = res.data || {};

      setHistory((h) => [
        ...h,
        {
          ROLE: "assistant",
          CONTENT: data.reply || "",
          CREATED_AT: new Date().toISOString()
        }
      ]);

      applyStateUpdate(data);

    } catch (err) {

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not send message. Please try again."
      );

    } finally {

      setSending(false);
    }
  };

  // ---- 5. Skip the current field (deterministic backend handling) ----
  const skipField = () => {

    const fieldKey = nextWidget?.field_key;

    if (!fieldKey) {

      // No field key — fall back to sending "skip" as a regular message
      sendMessage("skip");

      return;
    }

    sendMessage("skip", { skipFieldKey: fieldKey });
  };

  // ---- 6. Save & continue later ----
  const saveAndExit = () => {

    setShowSavedToast(true);

    setTimeout(() => setShowSavedToast(false), 3000);
  };

  // ---- 7. Submit final (or partial) ----
  const submit = async (confirmedPartial = false) => {

    if (submitting) return;

    if (progress < 100 && !confirmedPartial) {

      setConfirmPartial(true);

      return;
    }

    setConfirmPartial(false);

    setSubmitting(true);

    setError("");

    try {

      const res = await portal.post(
        `/onboarding/${token}/submit`,
        { CONFIRMED: true },
        { headers }
      );

      setSubmitted(true);

      setSubmittedResult(res.data);

    } catch (err) {

      setError(
        err?.response?.data?.detail ||
          err?.message ||
          "Could not submit. Please try again."
      );

    } finally {

      setSubmitting(false);
    }
  };

  // ---- 8. Submitted screen ----
  if (submitted) {

    return (
      <SubmittedScreen
        result={submittedResult}
        partial={partial}
        progress={progress}
      />
    );
  }

  const showInputBar = nextWidget.widget === "text"
    || nextWidget.widget === "textarea"
    || !nextWidget.widget;

  return (
    <div className={styles.page}>

      <div className={styles.shell}>

        {/* =========== Chat column =========== */}
        <div className={styles.chatCol}>

          {/* Header */}
          <div className={styles.chatHeader}>
            <div className={styles.chatHeaderLabel}>
              BVC24 · ONBOARDING ASSISTANT
            </div>
            <div className={styles.chatHeaderRow}>
              <h1 className={styles.chatHeaderTitle}>
                Hello, {username || "there"}
              </h1>
              <div className={styles.chatHeaderCount}>
                {filledCount} / {totalFields} answered
              </div>
            </div>
          </div>

          {/* Chat scroll area */}
          <div ref={scrollerRef} className={styles.chatScroll}>
            {history.length === 0 && (
              <div className={styles.chatEmpty}>
                Loading…
              </div>
            )}

            {history.map((m, idx) => (
              <Bubble key={idx} message={m} />
            ))}

            {sending && (
              <Bubble
                message={{ ROLE: "assistant", CONTENT: "Typing…" }}
                muted
              />
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className={styles.errorBanner}>
              ⚠ {error}
            </div>
          )}

          {/* Smart input area — changes shape based on next_widget */}
          <div className={`${styles.inputArea} ${showInputBar ? styles.inputAreaText : styles.inputAreaWidget}`}>

            <SmartInput
              widget={nextWidget}
              value={input}
              onChange={setInput}
              onSubmit={(val) => sendMessage(String(val))}
              sending={sending}
              onSkip={skipField}
            />

          </div>
        </div>

        {/* =========== Side panel =========== */}
        <div className={styles.sidePanel}>

          <ProgressCircle pct={progress} />

          <div className={styles.sidePanelNote}>
            {pending.length === 0
              ? "All set — submit when ready."
              : `${pending.length} ${pending.length === 1 ? "question" : "questions"} remaining`}
          </div>

          {/* Collected fields */}
          {Object.keys(partial).length > 0 && (
            <CollapsibleCard
              title="✅ COLLECTED"
              colour="#16a34a"
              defaultOpen={false}
              count={Object.keys(partial).length}
            >
              {Object.entries(partial).map(([k, v]) => (
                <DataRow key={k} label={k} value={v} />
              ))}
            </CollapsibleCard>
          )}

          {/* Pending fields */}
          {pending.length > 0 && (
            <CollapsibleCard
              title="⏳ PENDING INFORMATION"
              colour="#d97706"
              defaultOpen
              count={pending.length}
            >
              {pending.map((p) => (
                <div
                  key={p.key}
                  className={`${styles.pendingItem} ${p.skipped ? styles.pendingItemSkipped : ""}`}
                >
                  <span className={p.skipped ? styles.pendingLabelStruck : styles.pendingLabel}>
                    {p.label}
                  </span>
                  <span className={styles.badgeRow}>
                    {p.skipped && (
                      <span className={styles.chipSkipped}>
                        SKIPPED
                      </span>
                    )}
                    {p.required && !p.skipped && (
                      <span className={styles.chipRequired}>
                        REQUIRED
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </CollapsibleCard>
          )}

          {/* Action buttons */}
          <div className={styles.actionButtons}>

            <button
              onClick={() => submit(false)}
              disabled={submitting}
              className={progress >= 100 ? styles.btnSubmitComplete : styles.btnSubmit}
              style={{
                boxShadow: progress >= 100
                  ? "0 6px 18px rgba(22,163,74,0.35)"
                  : "0 6px 18px rgba(200,16,46,0.35)"
              }}
            >
              {submitting
                ? "Submitting…"
                : progress >= 100
                  ? "✓ Submit Details"
                  : "Submit Details"}
            </button>

            <button
              onClick={saveAndExit}
              className={styles.btnSave}
            >
              💾 Save &amp; Continue Later
            </button>

          </div>

          <div className={styles.autosaveNote}>
            Your responses are saved automatically.
          </div>
        </div>

      </div>

      {/* Toast: "Saved" notification */}
      {showSavedToast && (
        <div className={styles.toast}>
          💾 Your progress is saved. You can return to this link anytime.
        </div>
      )}

      {/* Partial-submit confirmation modal */}
      {confirmPartial && (
        <ConfirmPartialModal
          progress={progress}
          pendingCount={pending.length}
          onCancel={() => setConfirmPartial(false)}
          onConfirm={() => submit(true)}
        />
      )}

    </div>
  );
}


// ================================================================
// SmartInput — picks the right control for the AI's next field
// ================================================================

function SmartInput({ widget, value, onChange, onSubmit, sending, onSkip }) {

  const w = widget?.widget || "text";

  const options = widget?.options || [];

  const label = widget?.label;

  // ---- Cards (chip grid with optional emojis) ----
  if (w === "cards") {

    return (
      <div>
        {label && (
          <div className={styles.cardChipLabel}>
            {label.toUpperCase()}
          </div>
        )}
        <div className={styles.cardGrid}>
          {options.map((opt) => (
            <button
              key={opt.value}
              disabled={sending}
              onClick={() => onSubmit(opt.label)}
              className={styles.cardChip}
            >
              {opt.emoji && (
                <span className={styles.cardChipEmoji}>{opt.emoji}</span>
              )}
              <span>{opt.label}</span>
            </button>
          ))}
        </div>
        <SkipRow onSkip={onSkip} sending={sending} />
      </div>
    );
  }

  // ---- Radio buttons ----
  if (w === "radio") {

    return (
      <div>
        <div className={styles.radioRow}>
          {options.map((opt) => (
            <button
              key={opt.value}
              disabled={sending}
              onClick={() => onSubmit(opt.label)}
              className={styles.radioBtn}
            >
              {opt.label}
            </button>
          ))}
        </div>
        <SkipRow onSkip={onSkip} sending={sending} />
      </div>
    );
  }

  // ---- Select (dropdown) ----
  if (w === "select") {

    return (
      <div className={styles.inlineInputRow}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          className={styles.selectInput}
        >
          <option value="">— pick one —</option>
          {options.map((opt) => (
            <option key={opt.value} value={opt.label}>
              {opt.emoji ? `${opt.emoji} ${opt.label}` : opt.label}
            </option>
          ))}
        </select>
        <button
          onClick={() => value && onSubmit(value)}
          disabled={sending || !value}
          className={styles.sendBtn}
        >
          Send
        </button>
        <SkipRow onSkip={onSkip} sending={sending} compact />
      </div>
    );
  }

  // ---- Date picker ----
  if (w === "date") {

    return (
      <div className={styles.inlineInputRow}>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          className={styles.textInput}
        />
        <button
          onClick={() => value && onSubmit(value)}
          disabled={sending || !value}
          className={styles.sendBtn}
        >
          Send
        </button>
        <SkipRow onSkip={onSkip} sending={sending} compact />
      </div>
    );
  }

  // ---- Number ----
  if (w === "number") {

    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (value !== "" && !sending) onSubmit(value);
        }}
        className={styles.inlineInputRow}
      >
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          placeholder="Enter a number"
          autoFocus
          className={styles.textInput}
        />
        <button
          type="submit"
          disabled={sending || value === ""}
          className={styles.sendBtn}
        >
          Send
        </button>
        <SkipRow onSkip={onSkip} sending={sending} compact />
      </form>
    );
  }

  // ---- Textarea (multi-line) ----
  if (w === "textarea") {

    return (
      <div>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          placeholder="Type your reply…"
          rows={3}
          autoFocus
          className={styles.textarea}
        />
        <div className={styles.textareaFooter}>
          <SkipRow onSkip={onSkip} sending={sending} inline />
          <button
            onClick={() => value.trim() && onSubmit(value.trim())}
            disabled={sending || !value.trim()}
            className={styles.sendBtn}
          >
            Send
          </button>
        </div>
      </div>
    );
  }

  // ---- Default: free-text input ----
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const v = value.trim();
        if (v && !sending) onSubmit(v);
      }}
      className={styles.inlineInputRow}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={sending}
        placeholder="Type your reply…"
        autoFocus
        className={styles.textInput}
      />
      <button
        type="submit"
        disabled={sending || !value.trim()}
        className={styles.sendBtn}
      >
        Send
      </button>
      <SkipRow onSkip={onSkip} sending={sending} compact />
    </form>
  );
}


function SkipRow({ onSkip, sending, compact, inline }) {

  if (inline) {

    return (
      <button onClick={onSkip} disabled={sending} className={styles.skipBtn}>
        Skip this →
      </button>
    );
  }

  if (compact) {

    return (
      <button
        onClick={onSkip}
        disabled={sending}
        title="Skip this question"
        className={styles.skipBtnCompact}
      >
        Skip →
      </button>
    );
  }

  return (
    <div className={styles.skipCenter}>
      <button onClick={onSkip} disabled={sending} className={styles.skipBtn}>
        Skip this question →
      </button>
    </div>
  );
}


// ================================================================
// Sub-components
// ================================================================

function Bubble({ message, muted }) {

  const isUser = message.ROLE === "user";

  return (
    <div className={`${styles.bubbleWrap} ${isUser ? styles.bubbleWrapUser : styles.bubbleWrapAssistant}`}>
      <div
        className={`${isUser ? styles.bubbleUser : styles.bubbleAssistant} ${muted ? styles.bubbleMuted : ""}`}
        style={{
          background: isUser ? "var(--clr-primary)" : "var(--card-bg)",
          color: isUser ? "#fff" : "var(--text-primary)",
          border: isUser ? "none" : "1px solid var(--border)",
          boxShadow: isUser
            ? "0 4px 12px rgba(200,16,46,0.25)"
            : "0 2px 8px rgba(15,23,42,0.06)"
        }}
      >
        {message.CONTENT}
      </div>
    </div>
  );
}


function ProgressCircle({ pct }) {

  const size = 140;

  const stroke = 12;

  const radius = (size - stroke) / 2;

  const circumference = 2 * Math.PI * radius;

  const filled = circumference * (Math.min(100, Math.max(0, pct)) / 100);

  const colour = pct >= 100 ? "#16a34a" : "var(--clr-primary)";

  return (
    <div className={styles.progressCircle}>
      <div className={styles.progressInner} style={{ width: size, height: size }}>
        <svg width={size} height={size}>
          <circle cx={size / 2} cy={size / 2} r={radius}
            stroke="#fee2e2" strokeWidth={stroke} fill="none" />
          <circle cx={size / 2} cy={size / 2} r={radius}
            stroke={colour} strokeWidth={stroke} fill="none"
            strokeDasharray={`${filled} ${circumference}`}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            style={{ transition: "stroke-dasharray 0.4s ease" }}
          />
        </svg>
        <div className={styles.progressCenter}>
          <div className={styles.progressPct} style={{ color: colour }}>
            {pct}%
          </div>
          <div className={styles.progressLabel}>
            COMPLETED
          </div>
        </div>
      </div>
    </div>
  );
}


function CollapsibleCard({ title, colour, count, children, defaultOpen }) {

  const [open, setOpen] = useState(!!defaultOpen);

  return (
    <div
      className={styles.collapsibleCard}
      style={{ border: `1px solid ${colour}33` }}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className={styles.collapsibleToggle}
        style={{
          background: `${colour}11`,
          color: colour
        }}
      >
        <span>{title} ({count})</span>
        <span className={styles.collapsibleCaret}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className={styles.collapsibleBody}>
          {children}
        </div>
      )}
    </div>
  );
}


function DataRow({ label, value }) {

  return (
    <div className={styles.dataRow}>
      <span className={styles.dataRowLabel}>{label}</span>
      <span className={styles.dataRowValue}>
        {String(value)}
      </span>
    </div>
  );
}


// ================================================================
// Confirmation modal — partial submit
// ================================================================

function ConfirmPartialModal({ progress, pendingCount, onCancel, onConfirm }) {

  return (
    <div
      onClick={onCancel}
      className={styles.modalOverlay}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={styles.modalBox}
      >
        <div className={styles.modalIcon}>
          📝
        </div>
        <h2 className={styles.modalTitle}>
          Submit partial profile?
        </h2>
        <p className={styles.modalBody}>
          You've completed <b>{progress}%</b> of your profile and have <b>{pendingCount}</b> {pendingCount === 1 ? "question" : "questions"} pending.
        </p>
        <p className={styles.modalNote}>
          You can submit now and our team will follow up to collect the rest. Or you can keep going to finish the full profile yourself.
        </p>
        <div className={styles.modalButtons}>
          <button
            onClick={onCancel}
            className={styles.btnKeepGoing}
          >
            Keep going
          </button>
          <button
            onClick={onConfirm}
            className={styles.btnSubmitAnyway}
          >
            Submit anyway
          </button>
        </div>
      </div>
    </div>
  );
}


// ================================================================
// Submitted screen — different copy for 100% vs partial
// ================================================================

function SubmittedScreen({ result, partial, progress }) {

  const full = (result?.fully_complete ?? progress >= 100);

  const code = result?.customer_code;

  const pct = result?.completion_pct ?? progress;

  return (
    <div className={styles.submittedPage}>
      <div className={styles.submittedCard}>

        <div className={`${styles.submittedIcon} ${full ? styles.submittedIconFull : styles.submittedIconPartial}`}>
          {full ? "✓" : "📝"}
        </div>

        <h1 className={styles.submittedTitle}>
          {full
            ? "Profile Completed Successfully"
            : "Profile Submitted"}
        </h1>

        <div className={`${styles.submittedPct} ${full ? styles.submittedPctFull : styles.submittedPctPartial}`}>
          {pct}%
        </div>

        <div className={styles.submittedVerifyLabel}>
          {full ? "CUSTOMER DATA VERIFIED" : "COMPLETION"}
        </div>

        <p className={styles.submittedMessage}>
          {full
            ? "Thank you for submitting your details. Our sales team will review your requirements and contact you shortly."
            : "Thank you! We've saved everything you've shared. Our sales team will reach out and help you fill in the remaining details."}
        </p>

        {code && (
          <div className={styles.refChip}>
            Your reference: <b>{code}</b>
          </div>
        )}

        {result?.pending_count > 0 && (
          <p className={styles.submittedPendingNote}>
            {result.pending_count} {result.pending_count === 1 ? "question" : "questions"} can be added later by our team or you.
          </p>
        )}

      </div>
    </div>
  );
}


export default OnboardingChat;
