import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import axios from "axios";

import { API_BASE_URL } from "../services/api";


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
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1A0508, #4A0E18 60%, #8B0B1F)",
      fontFamily: "Segoe UI, system-ui, -apple-system, Arial, sans-serif",
      padding: 20
    }}>

      <div style={{
        maxWidth: 1180,
        margin: "0 auto",
        background: "white",
        borderRadius: 16,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
        overflow: "hidden",
        display: "grid",
        gridTemplateColumns: "1fr 300px",
        height: "calc(100vh - 40px)",
        minHeight: 600
      }}>

        {/* =========== Chat column =========== */}
        <div style={{
          display: "flex",
          flexDirection: "column",
          minHeight: 0
        }}>

          {/* Header */}
          <div style={{
            background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
            color: "white",
            padding: "16px 22px",
            flexShrink: 0
          }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 2, opacity: 0.85
            }}>
              BVC24 · ONBOARDING ASSISTANT
            </div>
            <div style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginTop: 2
            }}>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
                Hello, {username || "there"}
              </h1>
              <div style={{ fontSize: 12, opacity: 0.9, fontWeight: 700 }}>
                {filledCount} / {totalFields} answered
              </div>
            </div>
          </div>

          {/* Chat scroll area */}
          <div
            ref={scrollerRef}
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: "auto",
              padding: "18px 22px",
              background: "#f8fafc"
            }}
          >
            {history.length === 0 && (
              <div style={{ textAlign: "center", color: "#94a3b8", fontSize: 13, padding: 40 }}>
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
            <div style={{
              padding: "8px 22px",
              background: "#fef2f2",
              borderTop: "1px solid #fecaca",
              color: "#991b1b",
              fontSize: 12,
              flexShrink: 0
            }}>
              ⚠ {error}
            </div>
          )}

          {/* Smart input area — changes shape based on next_widget */}
          <div style={{
            borderTop: "1px solid #e2e8f0",
            background: "white",
            flexShrink: 0,
            padding: showInputBar ? "12px 14px" : "16px 22px"
          }}>

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
        <div style={{
          background: "linear-gradient(180deg, #fef2f2, #fff)",
          borderLeft: "1px solid #fecaca",
          padding: 22,
          display: "flex",
          flexDirection: "column",
          gap: 16,
          overflowY: "auto"
        }}>

          <ProgressCircle pct={progress} />

          <div style={{
            textAlign: "center",
            fontSize: 12,
            color: "#64748b",
            marginTop: -6
          }}>
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
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "5px 0",
                    fontSize: 12,
                    borderBottom: "1px dashed #fef3c7",
                    opacity: p.skipped ? 0.65 : 1
                  }}
                >
                  <span style={{
                    color: "#0f172a",
                    textDecoration: p.skipped ? "line-through" : "none"
                  }}>
                    {p.label}
                  </span>
                  <span style={{ display: "flex", gap: 4 }}>
                    {p.skipped && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 6px",
                        background: "#e2e8f0",
                        color: "#475569",
                        borderRadius: 999,
                        letterSpacing: 0.5
                      }}>
                        SKIPPED
                      </span>
                    )}
                    {p.required && !p.skipped && (
                      <span style={{
                        fontSize: 9,
                        fontWeight: 800,
                        padding: "1px 6px",
                        background: "#fee2e2",
                        color: "#991b1b",
                        borderRadius: 999,
                        letterSpacing: 0.5
                      }}>
                        REQUIRED
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </CollapsibleCard>
          )}

          {/* Action buttons */}
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: "auto" }}>

            <button
              onClick={() => submit(false)}
              disabled={submitting}
              style={{
                padding: "13px 18px",
                background: progress >= 100
                  ? "linear-gradient(135deg, #16a34a, #15803d)"
                  : "linear-gradient(135deg, #C8102E, #8B0B1F)",
                color: "white",
                border: "none",
                borderRadius: 10,
                fontWeight: 800,
                fontSize: 14,
                cursor: submitting ? "wait" : "pointer",
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
              style={{
                padding: "10px 14px",
                background: "white",
                color: "#475569",
                border: "1px solid #cbd5e1",
                borderRadius: 10,
                fontWeight: 700,
                fontSize: 12,
                cursor: "pointer"
              }}
            >
              💾 Save &amp; Continue Later
            </button>

          </div>

          <div style={{
            fontSize: 10,
            color: "#94a3b8",
            textAlign: "center"
          }}>
            Your responses are saved automatically.
          </div>
        </div>

      </div>

      {/* Toast: "Saved" notification */}
      {showSavedToast && (
        <div style={{
          position: "fixed",
          bottom: 30,
          left: "50%",
          transform: "translateX(-50%)",
          background: "#0f172a",
          color: "white",
          padding: "14px 22px",
          borderRadius: 12,
          fontSize: 14,
          fontWeight: 700,
          boxShadow: "0 12px 30px rgba(0,0,0,0.4)",
          zIndex: 1100
        }}>
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
          <div style={{
            fontSize: 11, fontWeight: 700, color: "#64748b",
            letterSpacing: 0.5, marginBottom: 8
          }}>
            {label.toUpperCase()}
          </div>
        )}
        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
          gap: 8
        }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              disabled={sending}
              onClick={() => onSubmit(opt.label)}
              style={{
                padding: "14px 8px",
                border: "1.5px solid #fecaca",
                borderRadius: 12,
                background: "white",
                cursor: sending ? "default" : "pointer",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 6,
                transition: "all .15s ease",
                fontSize: 13,
                fontWeight: 700,
                color: "#0f172a"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "#fef2f2";
                e.currentTarget.style.borderColor = "#C8102E";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "white";
                e.currentTarget.style.borderColor = "#fecaca";
              }}
            >
              {opt.emoji && (
                <span style={{ fontSize: 24 }}>{opt.emoji}</span>
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
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          {options.map((opt) => (
            <button
              key={opt.value}
              disabled={sending}
              onClick={() => onSubmit(opt.label)}
              style={{
                padding: "12px 24px",
                border: "1.5px solid #fecaca",
                borderRadius: 999,
                background: "white",
                cursor: sending ? "default" : "pointer",
                fontSize: 14,
                fontWeight: 700,
                color: "#0f172a",
                transition: "all .15s ease"
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.background = "#C8102E";
                e.currentTarget.style.color = "white";
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.background = "white";
                e.currentTarget.style.color = "#0f172a";
              }}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            fontSize: 14,
            fontFamily: "inherit",
            background: "white"
          }}
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
          style={sendBtnStyle(sending || !value)}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          type="date"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            fontSize: 14,
            fontFamily: "inherit"
          }}
        />
        <button
          onClick={() => value && onSubmit(value)}
          disabled={sending || !value}
          style={sendBtnStyle(sending || !value)}
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
        style={{ display: "flex", gap: 8, alignItems: "center" }}
      >
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={sending}
          placeholder="Enter a number"
          autoFocus
          style={{
            flex: 1,
            padding: "12px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            fontSize: 14,
            fontFamily: "inherit"
          }}
        />
        <button
          type="submit"
          disabled={sending || value === ""}
          style={sendBtnStyle(sending || value === "")}
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
          style={{
            width: "100%",
            padding: "12px 14px",
            border: "1px solid #cbd5e1",
            borderRadius: 10,
            fontSize: 14,
            fontFamily: "inherit",
            resize: "vertical",
            boxSizing: "border-box"
          }}
        />
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8 }}>
          <SkipRow onSkip={onSkip} sending={sending} inline />
          <button
            onClick={() => value.trim() && onSubmit(value.trim())}
            disabled={sending || !value.trim()}
            style={sendBtnStyle(sending || !value.trim())}
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
      style={{ display: "flex", gap: 8, alignItems: "center" }}
    >
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={sending}
        placeholder="Type your reply…"
        autoFocus
        style={{
          flex: 1,
          padding: "12px 14px",
          border: "1px solid #cbd5e1",
          borderRadius: 10,
          fontSize: 14,
          fontFamily: "inherit"
        }}
      />
      <button
        type="submit"
        disabled={sending || !value.trim()}
        style={sendBtnStyle(sending || !value.trim())}
      >
        Send
      </button>
      <SkipRow onSkip={onSkip} sending={sending} compact />
    </form>
  );
}


function sendBtnStyle(disabled) {

  return {
    padding: "11px 22px",
    background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
    color: "white",
    border: "none",
    borderRadius: 10,
    fontWeight: 800,
    fontSize: 14,
    cursor: disabled ? "default" : "pointer",
    opacity: disabled ? 0.55 : 1
  };
}


function SkipRow({ onSkip, sending, compact, inline }) {

  const style = {
    fontSize: 11,
    color: "#94a3b8",
    background: "none",
    border: "none",
    cursor: sending ? "default" : "pointer",
    fontWeight: 600,
    padding: compact ? "0 4px" : "8px 0 0",
    textDecoration: "underline"
  };

  if (inline) {

    return (
      <button onClick={onSkip} disabled={sending} style={style}>
        Skip this →
      </button>
    );
  }

  if (compact) {

    return (
      <button onClick={onSkip} disabled={sending} title="Skip this question" style={{
        ...style,
        padding: "11px 10px",
        textDecoration: "none",
        fontSize: 12
      }}>
        Skip →
      </button>
    );
  }

  return (
    <div style={{ textAlign: "center", marginTop: 10 }}>
      <button onClick={onSkip} disabled={sending} style={style}>
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
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 10
    }}>
      <div style={{
        maxWidth: "78%",
        padding: "10px 14px",
        borderRadius: 14,
        background: isUser
          ? "linear-gradient(135deg, #C8102E, #8B0B1F)"
          : "white",
        color: isUser ? "white" : "#0f172a",
        fontSize: 14,
        lineHeight: 1.5,
        boxShadow: isUser
          ? "0 4px 12px rgba(200,16,46,0.25)"
          : "0 2px 8px rgba(15,23,42,0.06)",
        border: isUser ? "none" : "1px solid #e2e8f0",
        opacity: muted ? 0.6 : 1,
        fontStyle: muted ? "italic" : "normal",
        whiteSpace: "pre-wrap",
        wordBreak: "break-word"
      }}>
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

  const colour = pct >= 100 ? "#16a34a" : "#C8102E";

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <div style={{ position: "relative", width: size, height: size }}>
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
        <div style={{
          position: "absolute", inset: 0,
          display: "flex", flexDirection: "column",
          alignItems: "center", justifyContent: "center"
        }}>
          <div style={{ fontSize: 28, fontWeight: 900, color: colour }}>
            {pct}%
          </div>
          <div style={{
            fontSize: 10, color: "#64748b",
            fontWeight: 700, letterSpacing: 0.6
          }}>
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
    <div style={{
      background: "white",
      border: `1px solid ${colour}33`,
      borderRadius: 10,
      overflow: "hidden"
    }}>
      <button
        onClick={() => setOpen((o) => !o)}
        style={{
          width: "100%",
          padding: "10px 14px",
          background: `${colour}11`,
          border: "none",
          cursor: "pointer",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: 10,
          fontWeight: 800,
          letterSpacing: 1.4,
          color: colour
        }}
      >
        <span>{title} ({count})</span>
        <span style={{ fontSize: 12 }}>{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div style={{ padding: "10px 14px" }}>
          {children}
        </div>
      )}
    </div>
  );
}


function DataRow({ label, value }) {

  return (
    <div style={{
      display: "flex",
      justifyContent: "space-between",
      gap: 8,
      padding: "3px 0",
      borderBottom: "1px dashed #f1f5f9",
      fontSize: 11
    }}>
      <span style={{ color: "#64748b" }}>{label}</span>
      <span style={{
        fontWeight: 700,
        color: "#0f172a",
        textAlign: "right",
        wordBreak: "break-word",
        maxWidth: "60%"
      }}>
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
      style={{
        position: "fixed", inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center",
        zIndex: 1200, padding: 20
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(460px, 100%)",
          background: "white",
          borderRadius: 16,
          padding: 28,
          boxShadow: "0 24px 60px rgba(0,0,0,0.4)"
        }}
      >
        <div style={{ fontSize: 36, textAlign: "center", marginBottom: 10 }}>
          📝
        </div>
        <h2 style={{ margin: "0 0 8px", fontSize: 20, textAlign: "center", color: "#0f172a" }}>
          Submit partial profile?
        </h2>
        <p style={{ margin: "0 0 18px", color: "#475569", fontSize: 14, textAlign: "center", lineHeight: 1.5 }}>
          You've completed <b>{progress}%</b> of your profile and have <b>{pendingCount}</b> {pendingCount === 1 ? "question" : "questions"} pending.
        </p>
        <p style={{ margin: "0 0 22px", color: "#64748b", fontSize: 13, textAlign: "center", lineHeight: 1.5 }}>
          You can submit now and our team will follow up to collect the rest. Or you can keep going to finish the full profile yourself.
        </p>
        <div style={{ display: "flex", gap: 10 }}>
          <button
            onClick={onCancel}
            style={{
              flex: 1,
              padding: "12px 16px",
              background: "white",
              color: "#475569",
              border: "1px solid #cbd5e1",
              borderRadius: 10,
              fontWeight: 700, fontSize: 13,
              cursor: "pointer"
            }}
          >
            Keep going
          </button>
          <button
            onClick={onConfirm}
            style={{
              flex: 1,
              padding: "12px 16px",
              background: "linear-gradient(135deg, #C8102E, #8B0B1F)",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontWeight: 800, fontSize: 13,
              cursor: "pointer"
            }}
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
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #1A0508, #4A0E18 60%, #8B0B1F)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 20,
      fontFamily: "Segoe UI, system-ui, -apple-system, Arial, sans-serif"
    }}>
      <div style={{
        width: "min(540px, 100%)",
        background: "white",
        borderRadius: 18,
        padding: 40,
        boxShadow: "0 24px 60px rgba(0,0,0,0.4)",
        textAlign: "center"
      }}>

        <div style={{
          width: 90, height: 90,
          margin: "0 auto 18px",
          background: full
            ? "linear-gradient(135deg, #16a34a, #15803d)"
            : "linear-gradient(135deg, #C8102E, #8B0B1F)",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 44,
          color: "white",
          boxShadow: full
            ? "0 12px 30px rgba(22,163,74,0.4)"
            : "0 12px 30px rgba(200,16,46,0.4)"
        }}>
          {full ? "✓" : "📝"}
        </div>

        <h1 style={{ margin: 0, fontSize: 24, color: "#0f172a" }}>
          {full
            ? "Profile Completed Successfully"
            : "Profile Submitted"}
        </h1>

        <div style={{
          fontSize: 48,
          fontWeight: 900,
          color: full ? "#16a34a" : "#C8102E",
          marginTop: 18,
          letterSpacing: -1
        }}>
          {pct}%
        </div>

        <div style={{
          fontSize: 11,
          color: "#64748b",
          fontWeight: 700,
          letterSpacing: 1
        }}>
          {full ? "CUSTOMER DATA VERIFIED" : "COMPLETION"}
        </div>

        <p style={{
          margin: "22px 0 8px",
          color: "#475569",
          fontSize: 14,
          lineHeight: 1.6
        }}>
          {full
            ? "Thank you for submitting your details. Our sales team will review your requirements and contact you shortly."
            : "Thank you! We've saved everything you've shared. Our sales team will reach out and help you fill in the remaining details."}
        </p>

        {code && (
          <div style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 10,
            padding: "10px 14px",
            marginTop: 22,
            display: "inline-block",
            fontSize: 13,
            color: "#8B0B1F"
          }}>
            Your reference: <b>{code}</b>
          </div>
        )}

        {result?.pending_count > 0 && (
          <p style={{
            margin: "22px 0 0",
            color: "#94a3b8",
            fontSize: 12
          }}>
            {result.pending_count} {result.pending_count === 1 ? "question" : "questions"} can be added later by our team or you.
          </p>
        )}

      </div>
    </div>
  );
}


export default OnboardingChat;
