// =====================================================================
// Admin Module 5 — AI Command Center
// =====================================================================
// Natural-language admin assistant. Type a question (or click an
// example), and the system answers with a short sentence + a small
// data table + follow-up suggestion chips.
//
// Routes through POST /admin/ai/ask which uses:
//   1. Keyword pattern match (fast, free)
//   2. Gemini fallback for fuzzy queries
//   3. Help text when neither resolves
// =====================================================================

import { useEffect, useRef, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_DEEP = "#4A0E18";
const BVC_GOLD = "#F4B324";


export default function AICommandCenter() {

  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text:
        "Hi — I'm the BVC24 AI Assistant. Ask me anything about your live data: " +
        "pending quotations, delayed projects, low stock, attendance, revenue, " +
        "approvals — I'll fetch it instantly. Try a chip below or type your own.",
      time: new Date(),
    },
  ]);
  const [input, setInput]         = useState("");
  const [examples, setExamples]   = useState([]);
  const [busy, setBusy]           = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    API.get("/admin/ai/examples")
      .then((r) => setExamples(r.data?.categories || []))
      .catch(() => setExamples([]));
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const ask = async (query) => {
    const q = (query || input || "").trim();
    if (!q || busy) return;
    setMessages((m) => [
      ...m,
      { role: "user", text: q, time: new Date() },
    ]);
    setInput("");
    setBusy(true);
    try {
      const r = await API.post("/admin/ai/ask", { query: q });
      const d = r.data || {};
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: d.answer || "(no answer)",
          data: d.data,
          intent: d.intent,
          via: d.matched_via,
          suggestions: d.suggestions || [],
          time: new Date(),
        },
      ]);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: e?.response?.data?.detail || "Sorry, that query failed.",
          time: new Date(),
        },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (e) => {
    e?.preventDefault?.();
    ask(input);
  };

  return (
    <div style={{
      padding: 24,
      background: "#F8F4F5",
      minHeight: "calc(100vh - 80px)",
      display: "grid",
      gridTemplateColumns: "1fr 280px",
      gap: 18,
    }}>

      <style>{`
        @keyframes ai-fade { from {opacity:0; transform: translateY(8px);} to {opacity:1; transform: translateY(0);} }
        @keyframes ai-typing {
          0%, 80%, 100% { transform: scale(0.7); opacity: 0.4; }
          40%           { transform: scale(1);   opacity: 1; }
        }
        @keyframes ai-glow {
          0%, 100% { box-shadow: 0 0 0 0 rgba(244,179,36,0); }
          50%      { box-shadow: 0 0 24px 4px rgba(244,179,36,0.45); }
        }
        @keyframes ai-shine {
          0%   { background-position: -200% 0; }
          100% { background-position: 200% 0; }
        }
      `}</style>

      {/* LEFT — chat panel */}
      <div style={{
        background: "white",
        borderRadius: 16,
        boxShadow: "0 8px 28px rgba(15,23,42,0.08)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
        minHeight: "calc(100vh - 130px)",
      }}>

        {/* Hero header */}
        <div style={{
          position: "relative",
          overflow: "hidden",
          background: `linear-gradient(135deg, ${BVC_DEEP} 0%, ${BVC_DARK} 60%, ${BVC_RED} 100%)`,
          color: "white",
          padding: "18px 22px",
        }}>
          <div style={{
            position: "absolute", inset: 0,
            background: "linear-gradient(115deg, rgba(255,255,255,0) 30%, rgba(255,255,255,0.10) 50%, rgba(255,255,255,0) 70%)",
            backgroundSize: "200% 100%",
            animation: "ai-shine 7s ease-in-out infinite",
            pointerEvents: "none",
          }} />
          <div style={{ position: "relative", zIndex: 2, display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{
              width: 46, height: 46, borderRadius: 14,
              background: `radial-gradient(circle at 35% 35%, ${BVC_GOLD}, #B7791F)`,
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 26,
              animation: "ai-glow 3s ease-in-out infinite",
            }}>
              🤖
            </div>
            <div>
              <div style={{
                fontSize: 11, fontWeight: 800, letterSpacing: 2,
                color: BVC_GOLD, textTransform: "uppercase",
              }}>
                BVC24 · Admin Module 5
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, marginTop: 2 }}>
                AI Command Center
              </div>
            </div>
          </div>
        </div>

        {/* Messages */}
        <div
          ref={scrollRef}
          style={{
            flex: 1,
            overflowY: "auto",
            padding: 24,
            background: "linear-gradient(180deg, #ffffff 0%, #faf6f7 100%)",
          }}
        >
          {messages.map((m, i) => (
            <ChatBubble
              key={i}
              role={m.role}
              text={m.text}
              data={m.data}
              suggestions={m.suggestions}
              via={m.via}
              time={m.time}
              onSuggestion={ask}
            />
          ))}
          {busy && (
            <div style={{ display: "flex", gap: 8, padding: "10px 14px", color: "#94a3b8", fontSize: 14 }}>
              {[0, 1, 2].map((i) => (
                <span
                  key={i}
                  style={{
                    display: "inline-block",
                    width: 8, height: 8, borderRadius: "50%",
                    background: BVC_RED,
                    animation: `ai-typing 1.2s infinite ${i * 0.2}s`,
                  }}
                />
              ))}
            </div>
          )}
        </div>

        {/* Composer */}
        <form
          onSubmit={onSubmit}
          style={{
            padding: 16,
            borderTop: "1px solid #e2e8f0",
            background: "white",
            display: "flex",
            gap: 10,
            alignItems: "center",
          }}
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything — e.g. 'show pending quotations'"
            disabled={busy}
            style={{
              flex: 1,
              padding: "12px 16px",
              border: "1.5px solid #e2e8f0",
              borderRadius: 999,
              fontSize: 14,
              outline: "none",
              transition: "border-color 0.15s",
            }}
            onFocus={(e) => { e.target.style.borderColor = BVC_RED; }}
            onBlur={(e) => { e.target.style.borderColor = "#e2e8f0"; }}
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            style={{
              padding: "12px 22px",
              background: busy || !input.trim()
                ? "#cbd5e1"
                : `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`,
              color: "white",
              border: "none",
              borderRadius: 999,
              fontWeight: 800,
              fontSize: 13,
              cursor: busy || !input.trim() ? "not-allowed" : "pointer",
              boxShadow: busy || !input.trim() ? "none" : "0 6px 18px rgba(200,16,46,0.30)",
            }}
          >
            {busy ? "…" : "🚀 Ask"}
          </button>
        </form>
      </div>

      {/* RIGHT — examples panel */}
      <div style={{
        background: "white",
        borderRadius: 16,
        boxShadow: "0 8px 28px rgba(15,23,42,0.08)",
        padding: 16,
        height: "fit-content",
        position: "sticky",
        top: 96,
        maxHeight: "calc(100vh - 130px)",
        overflowY: "auto",
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 1.5,
          color: "#64748b", textTransform: "uppercase", marginBottom: 12,
        }}>
          ⚡ Try one of these
        </div>
        {examples.length === 0 && (
          <div style={{ fontSize: 12, color: "#94a3b8", fontStyle: "italic" }}>
            Loading examples…
          </div>
        )}
        {examples.map((cat) => (
          <div key={cat.label} style={{ marginBottom: 14 }}>
            <div style={{
              fontSize: 10, fontWeight: 800, letterSpacing: 1,
              color: BVC_DARK, textTransform: "uppercase",
              marginBottom: 6,
            }}>
              {cat.label}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {cat.queries.map((q) => (
                <button
                  key={q}
                  onClick={() => ask(q)}
                  disabled={busy}
                  style={{
                    textAlign: "left",
                    padding: "8px 12px",
                    background: "#fafbfc",
                    color: "#0f172a",
                    border: "1px solid #e2e8f0",
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: busy ? "wait" : "pointer",
                    transition: "all 0.15s",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "#fff5f5";
                    e.currentTarget.style.borderColor = "#fecaca";
                    e.currentTarget.style.color = BVC_DARK;
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "#fafbfc";
                    e.currentTarget.style.borderColor = "#e2e8f0";
                    e.currentTarget.style.color = "#0f172a";
                  }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        ))}
        <div style={{
          marginTop: 18,
          padding: "10px 12px",
          background: "#fffbeb",
          border: "1px solid #fde68a",
          borderRadius: 8,
          fontSize: 10,
          color: "#92400e",
          lineHeight: 1.55,
        }}>
          🛈 The assistant uses pattern matching first, then asks Gemini for
          fuzzy queries. All data is live from your ERP database.
        </div>
      </div>

    </div>
  );
}


// =====================================================================
// Chat bubble — renders user or assistant message
// =====================================================================

function ChatBubble({ role, text, data, suggestions, via, time, onSuggestion }) {

  const isUser = role === "user";

  return (
    <div style={{
      display: "flex",
      justifyContent: isUser ? "flex-end" : "flex-start",
      marginBottom: 16,
      animation: "ai-fade 0.35s ease-out",
    }}>
      <div style={{
        maxWidth: "75%",
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        gap: 6,
      }}>
        <div style={{
          padding: "12px 16px",
          background: isUser
            ? `linear-gradient(135deg, ${BVC_RED}, ${BVC_DARK})`
            : "white",
          color: isUser ? "white" : "#0f172a",
          borderRadius: isUser ? "14px 14px 4px 14px" : "14px 14px 14px 4px",
          boxShadow: isUser
            ? "0 6px 18px rgba(200,16,46,0.25)"
            : "0 4px 12px rgba(15,23,42,0.06)",
          fontSize: 14,
          lineHeight: 1.55,
          border: isUser ? "none" : "1px solid #e2e8f0",
          whiteSpace: "pre-wrap",
        }}>
          {renderMarkdownLite(text)}
        </div>

        {data && !isUser && (
          <DataPanel data={data} />
        )}

        {suggestions && suggestions.length > 0 && !isUser && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 2 }}>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => onSuggestion(s)}
                style={{
                  padding: "5px 12px",
                  background: "#eef2ff",
                  color: "#3730a3",
                  border: "1px solid #c7d2fe",
                  borderRadius: 999,
                  fontSize: 11,
                  fontWeight: 700,
                  cursor: "pointer",
                }}
              >
                ↪ {s}
              </button>
            ))}
          </div>
        )}

        <div style={{
          fontSize: 10,
          color: "#94a3b8",
          fontFamily: "ui-monospace, monospace",
          marginTop: 2,
        }}>
          {time?.toLocaleTimeString?.() || ""}
          {via && (
            <span style={{
              marginLeft: 8,
              padding: "1px 6px",
              borderRadius: 999,
              background: via === "gemini" ? "#fef3c7" : "#dbeafe",
              color: via === "gemini" ? "#92400e" : "#1e40af",
              fontWeight: 700,
            }}>
              {via}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}


// =====================================================================
// Data panel — renders the {kind: table|number|...} block
// =====================================================================

function DataPanel({ data }) {

  if (!data) return null;

  if (data.kind === "number") {
    return (
      <div style={{
        padding: "14px 18px",
        background: "linear-gradient(135deg, #fef2f2, #fff5f5)",
        border: "1px solid #fecaca",
        borderRadius: 12,
        maxWidth: 320,
      }}>
        <div style={{
          fontSize: 28, fontWeight: 900, color: BVC_DARK,
          fontFamily: "ui-monospace, monospace",
        }}>
          {data.value}
        </div>
        {data.subtitle && (
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {data.subtitle}
          </div>
        )}
      </div>
    );
  }

  if (data.kind === "table") {
    const rows = data.rows || [];
    if (rows.length === 0) {
      return (
        <div style={{
          padding: "10px 14px",
          background: "#f0fdf4",
          color: "#15803d",
          border: "1px solid #bbf7d0",
          borderRadius: 8,
          fontSize: 12,
          fontStyle: "italic",
        }}>
          Nothing to show — good news.
        </div>
      );
    }
    return (
      <div style={{
        background: "white",
        border: "1px solid #e2e8f0",
        borderRadius: 10,
        overflow: "hidden",
        maxWidth: 520,
      }}>
        {rows.slice(0, 12).map((r, i) => (
          <div key={i} style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "8px 14px",
            borderBottom: i < rows.length - 1 ? "1px solid #f1f5f9" : "none",
            gap: 12,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: "#0f172a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {r.label}
              </div>
              {r.subtitle && (
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {r.subtitle}
                </div>
              )}
            </div>
            {r.value != null && (
              <div style={{
                fontSize: 13,
                fontWeight: 800,
                fontFamily: "ui-monospace, monospace",
                color: BVC_RED,
                whiteSpace: "nowrap",
              }}>
                {r.value}
              </div>
            )}
          </div>
        ))}
        {rows.length > 12 && (
          <div style={{
            padding: "8px 14px",
            background: "#f8fafc",
            fontSize: 11,
            color: "#64748b",
            fontStyle: "italic",
            textAlign: "center",
          }}>
            +{rows.length - 12} more — ask me to filter further.
          </div>
        )}
      </div>
    );
  }

  return null;
}


// Tiny markdown helper: turn **bold** into <strong>
function renderMarkdownLite(text) {
  if (!text) return text;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) {
      return <strong key={i}>{p.slice(2, -2)}</strong>;
    }
    return <span key={i}>{p}</span>;
  });
}
