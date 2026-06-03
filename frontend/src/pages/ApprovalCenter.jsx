// =====================================================================
// Admin Module 4 — Approval Center
// =====================================================================
// Single page that surfaces every pending approval across 6 buckets:
//   Leaves · Permissions · Quotations · Purchase Orders ·
//   Supplier Payments · Discount Requests
//
// Approve / Reject inline, reason prompt on reject, auto-refresh
// every 30s, optimistic UI on action.
// =====================================================================

import { useEffect, useMemo, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#8B0B1F";
const BVC_GOLD = "#F4B324";


const BUCKET_META = {
  leaves: {
    label: "Leave Requests",
    kind: "leave",
    icon: "🌴",
    color: "#0EA5E9",
    accent: "#BAE6FD",
  },
  permissions: {
    label: "Permission Requests",
    kind: "permission",
    icon: "⏱",
    color: "#F97316",
    accent: "#FED7AA",
  },
  quotations: {
    label: "Quotations",
    kind: "quotation",
    icon: "📋",
    color: "#10B981",
    accent: "#A7F3D0",
  },
  purchase_orders: {
    label: "Purchase Orders",
    kind: "purchase_order",
    icon: "📦",
    color: "#6366F1",
    accent: "#C7D2FE",
  },
  supplier_payments: {
    label: "Supplier Payments",
    kind: "supplier_payment",
    icon: "💳",
    color: "#14B8A6",
    accent: "#99F6E4",
  },
  discount_requests: {
    label: "Customer Discounts",
    kind: "discount_request",
    icon: "🏷️",
    color: "#EC4899",
    accent: "#FBCFE8",
  },
};

const BUCKET_ORDER = [
  "leaves",
  "permissions",
  "quotations",
  "purchase_orders",
  "supplier_payments",
  "discount_requests",
];

function formatMoney(n) {
  if (n == null) return null;
  const v = Number(n);
  return "₹" + v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}


export default function ApprovalCenter() {

  const [data, setData] = useState({ buckets: {}, total_pending: 0, as_of: null });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [busy, setBusy]       = useState(new Set()); // item keys mid-action
  const [filter, setFilter]   = useState("ALL");
  const [toast, setToast]     = useState("");

  const showToast = (msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 2400);
  };

  const fetchPending = async () => {
    try {
      const r = await API.get("/admin/approvals/pending");
      setData(r.data || { buckets: {}, total_pending: 0 });
      setError("");
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load pending approvals.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchPending();
    const id = setInterval(fetchPending, 30 * 1000);
    return () => clearInterval(id);
  }, []);

  const counts = useMemo(() => {
    const out = {};
    let total = 0;
    for (const k of BUCKET_ORDER) {
      out[k] = (data.buckets?.[k] || []).length;
      total += out[k];
    }
    out.ALL = total;
    return out;
  }, [data]);

  const visibleBuckets = useMemo(() => {
    if (filter === "ALL") return BUCKET_ORDER;
    return [filter];
  }, [filter]);

  const itemKey = (item) => `${item.kind}-${item.id}`;

  const runAction = async (item, action, reason) => {
    const key = itemKey(item);
    setBusy((s) => { const n = new Set(s); n.add(key); return n; });
    try {
      const url = `/admin/approvals/${item.kind}/${item.id}/${action}`;
      const body = action === "reject" ? { REJECTION_REASON: reason || "" } : {};
      const r = await API.post(url, body);
      showToast(r.data?.message || `${action} ok`);
      // Optimistically remove from local state, then refresh
      setData((d) => {
        const next = { ...d };
        for (const bkey of Object.keys(next.buckets || {})) {
          next.buckets[bkey] = (next.buckets[bkey] || []).filter(
            (x) => itemKey(x) !== key
          );
        }
        next.total_pending = (next.total_pending || 1) - 1;
        return next;
      });
    } catch (e) {
      showToast(e?.response?.data?.detail || `${action} failed`);
    } finally {
      setBusy((s) => { const n = new Set(s); n.delete(key); return n; });
    }
  };

  const approve = (item) => runAction(item, "approve");

  const reject = (item) => {
    const reason = window.prompt(
      `Reject "${item.title}"? Optionally enter a reason:`,
      ""
    );
    if (reason === null) return; // user hit Cancel
    runAction(item, "reject", reason);
  };

  return (
    <div style={{ padding: 24, background: "#F8F4F5", minHeight: "calc(100vh - 80px)" }}>

      <style>{`
        @keyframes ac-fade { from {opacity:0; transform:translateY(8px);} to {opacity:1; transform:translateY(0);} }
        @keyframes ac-pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.5;transform:scale(0.9);} }
      `}</style>

      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg,#1A0508 0%,${BVC_DARK} 60%,${BVC_RED} 100%)`,
        borderRadius: 16,
        padding: "20px 26px",
        marginBottom: 18,
        color: "white",
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
      }}>
        <div>
          <div style={{
            fontSize: 11, fontWeight: 800, letterSpacing: 2,
            color: BVC_GOLD, textTransform: "uppercase",
          }}>
            BVC24 · Admin Module 4
          </div>
          <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
            Approval Center
          </div>
          <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
            One place for everything waiting on your sign-off. Auto-refreshes every 30 seconds.
          </div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{
            fontSize: 11, opacity: 0.85, letterSpacing: 1.5,
            textTransform: "uppercase", fontWeight: 700,
          }}>
            Pending
          </div>
          <div style={{
            fontSize: 56, fontWeight: 900, lineHeight: 1,
            fontFamily: "ui-monospace,monospace",
            textShadow: "0 4px 18px rgba(0,0,0,0.30)",
          }}>
            {data.total_pending || 0}
          </div>
          <div style={{
            fontSize: 10, opacity: 0.65, marginTop: 4,
            fontFamily: "ui-monospace,monospace",
          }}>
            {data.as_of ? `Updated ${new Date(data.as_of).toLocaleTimeString()}` : "Loading…"}
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 8, marginBottom: 18, flexWrap: "wrap" }}>
        <FilterChip
          label="All"
          icon="✨"
          count={counts.ALL}
          active={filter === "ALL"}
          onClick={() => setFilter("ALL")}
        />
        {BUCKET_ORDER.map((k) => (
          <FilterChip
            key={k}
            label={BUCKET_META[k].label}
            icon={BUCKET_META[k].icon}
            color={BUCKET_META[k].color}
            count={counts[k] || 0}
            active={filter === k}
            onClick={() => setFilter(k)}
          />
        ))}
      </div>

      {error && (
        <div style={{
          padding: "10px 14px",
          background: "#fef2f2",
          color: "#991b1b",
          border: "1px solid #fecaca",
          borderRadius: 8,
          fontSize: 13,
          marginBottom: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {toast && (
        <div style={{
          position: "fixed",
          right: 24,
          bottom: 24,
          background: "#0f172a",
          color: "white",
          padding: "12px 18px",
          borderRadius: 10,
          fontSize: 13,
          fontWeight: 700,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
          zIndex: 9999,
          animation: "ac-fade 0.25s ease-out",
        }}>
          {toast}
        </div>
      )}

      {loading && !data.total_pending ? (
        <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>
          Loading pending approvals…
        </div>
      ) : data.total_pending === 0 ? (
        <div style={{
          padding: 48,
          textAlign: "center",
          background: "white",
          borderRadius: 12,
          boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
        }}>
          <div style={{ fontSize: 56 }}>✨</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#15803d", marginTop: 12 }}>
            All caught up
          </div>
          <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>
            Nothing is waiting on your approval right now.
          </div>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 18 }}>
          {visibleBuckets.map((bkey) => {
            const items = data.buckets?.[bkey] || [];
            if (items.length === 0 && filter === "ALL") return null;
            return (
              <BucketSection
                key={bkey}
                meta={BUCKET_META[bkey]}
                items={items}
                busy={busy}
                onApprove={approve}
                onReject={reject}
                itemKey={itemKey}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}


// ---- Sub-components ---------------------------------------------------

function FilterChip({ label, icon, color, count, active, onClick }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        background: active
          ? `linear-gradient(135deg,${BVC_RED},${BVC_DARK})`
          : "white",
        color: active ? "white" : "#0f172a",
        border: active ? "none" : `1px solid #e2e8f0`,
        borderRadius: 999,
        fontWeight: 700,
        fontSize: 12,
        cursor: "pointer",
        boxShadow: active
          ? "0 6px 18px rgba(200,16,46,0.30)"
          : "0 1px 2px rgba(0,0,0,0.04)",
        transition: "all 0.15s",
      }}
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span style={{
        marginLeft: 4,
        padding: "1px 8px",
        borderRadius: 999,
        background: active ? "rgba(255,255,255,0.18)" : (color ? color + "20" : "#e2e8f0"),
        color: active ? "white" : (color || "#64748b"),
        fontSize: 11,
        fontWeight: 900,
        minWidth: 22,
        textAlign: "center",
      }}>
        {count}
      </span>
    </button>
  );
}


function BucketSection({ meta, items, busy, onApprove, onReject, itemKey }) {
  if (items.length === 0) return null;
  return (
    <div style={{
      background: "white",
      borderRadius: 14,
      boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
      overflow: "hidden",
      animation: "ac-fade 0.35s ease-out",
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "14px 18px",
        background: `linear-gradient(135deg, ${meta.color}DD, ${meta.color}99)`,
        color: "white",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 38, height: 38, borderRadius: 10,
            background: "rgba(255,255,255,0.20)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontSize: 20,
            border: "1px solid rgba(255,255,255,0.30)",
          }}>
            {meta.icon}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 900 }}>{meta.label}</div>
            <div style={{ fontSize: 10, opacity: 0.85, letterSpacing: 1, textTransform: "uppercase" }}>
              {items.length} pending
            </div>
          </div>
        </div>
      </div>

      <div>
        {items.map((item) => (
          <ApprovalRow
            key={itemKey(item)}
            item={item}
            meta={meta}
            busy={busy.has(itemKey(item))}
            onApprove={() => onApprove(item)}
            onReject={() => onReject(item)}
          />
        ))}
      </div>
    </div>
  );
}


function ApprovalRow({ item, meta, busy, onApprove, onReject }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1fr auto",
      gap: 16,
      padding: "14px 18px",
      borderBottom: "1px solid #f1f5f9",
      alignItems: "center",
      transition: "background 0.15s",
    }}
    onMouseEnter={(e) => { e.currentTarget.style.background = "#fafbfc"; }}
    onMouseLeave={(e) => { e.currentTarget.style.background = "white"; }}
    >
      <div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
          <div style={{ fontSize: 14, fontWeight: 800, color: "#0f172a" }}>
            {item.title}
          </div>
          {item.amount != null && (
            <div style={{
              fontSize: 13,
              fontWeight: 800,
              fontFamily: "ui-monospace,monospace",
              color: meta.color,
            }}>
              {formatMoney(item.amount)}
            </div>
          )}
        </div>
        {item.subtitle && (
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 3 }}>
            {item.subtitle}
          </div>
        )}
        {item.reason && (
          <div style={{
            fontSize: 11,
            color: "#475569",
            marginTop: 6,
            padding: "6px 10px",
            background: "#f8fafc",
            border: `1px solid ${meta.accent}55`,
            borderRadius: 6,
            fontStyle: "italic",
            maxWidth: 720,
          }}>
            “{item.reason}”
          </div>
        )}
        <div style={{
          fontSize: 10,
          color: "#94a3b8",
          marginTop: 6,
          display: "flex",
          gap: 8,
        }}>
          {item.actor?.NAME && <span>👤 {item.actor.NAME}</span>}
          {item.requested_at && (
            <span>🕒 {new Date(item.requested_at).toLocaleString()}</span>
          )}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={onReject}
          disabled={busy}
          style={{
            padding: "8px 14px",
            background: "white",
            color: "#b91c1c",
            border: "1px solid #fecaca",
            borderRadius: 8,
            fontWeight: 700,
            fontSize: 12,
            cursor: busy ? "wait" : "pointer",
            opacity: busy ? 0.5 : 1,
          }}
        >
          ✗ Reject
        </button>
        <button
          onClick={onApprove}
          disabled={busy}
          style={{
            padding: "8px 16px",
            background: busy
              ? "#cbd5e1"
              : `linear-gradient(135deg,#16a34a,#15803d)`,
            color: "white",
            border: "none",
            borderRadius: 8,
            fontWeight: 800,
            fontSize: 12,
            cursor: busy ? "wait" : "pointer",
            boxShadow: busy ? "none" : "0 4px 12px rgba(22,163,74,0.30)",
          }}
        >
          {busy ? "…" : "✓ Approve"}
        </button>
      </div>
    </div>
  );
}
