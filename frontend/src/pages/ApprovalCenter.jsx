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
import styles from "./ApprovalCenter.module.css";


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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(new Set());
  const [filter, setFilter] = useState("ALL");
  const [toast, setToast] = useState("");

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
    if (reason === null) return;
    runAction(item, "reject", reason);
  };

  return (
    <div className={styles.page}>

      {/* Hero */}
      <div className={styles.hero}>
        <div className={styles.heroLeft}>
          <div className={styles.heroEyebrow}>BVC24 · Admin Module 4</div>
          <div className={styles.heroTitle}>Approval Center</div>
          <div className={styles.heroSub}>
            One place for everything waiting on your sign-off. Auto-refreshes every 30 seconds.
          </div>
        </div>
        <div className={styles.heroPendingBlock}>
          <div className={styles.heroPendingLabel}>Pending</div>
          <div className={styles.heroPendingCount}>{data.total_pending || 0}</div>
          <div className={styles.heroPendingTime}>
            {data.as_of ? `Updated ${new Date(data.as_of).toLocaleTimeString()}` : "Loading…"}
          </div>
        </div>
      </div>

      {/* Filter chips */}
      <div className={styles.filterRow}>
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
        <div className={styles.errorBanner}>⚠ {error}</div>
      )}

      {toast && (
        <div className={styles.toast}>{toast}</div>
      )}

      {loading && !data.total_pending ? (
        <div className={styles.loadingText}>Loading pending approvals…</div>
      ) : data.total_pending === 0 ? (
        <div className={styles.allClear}>
          <div className={styles.allClearIcon}>✨</div>
          <div className={styles.allClearTitle}>All caught up</div>
          <div className={styles.allClearSub}>
            Nothing is waiting on your approval right now.
          </div>
        </div>
      ) : (
        <div className={styles.bucketList}>
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
      className={`${styles.chip}${active ? ` ${styles.chipActive}` : ""}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
      <span
        className={`${styles.chipBadge}${active ? ` ${styles.chipBadgeActive}` : ""}`}
        style={!active && color ? { background: color + "20", color } : undefined}
      >
        {count}
      </span>
    </button>
  );
}


function BucketSection({ meta, items, busy, onApprove, onReject, itemKey }) {
  if (items.length === 0) return null;
  return (
    <div className={styles.bucketCard}>
      <div
        className={styles.bucketHeader}
        style={{ background: meta.color }}
      >
        <div className={styles.bucketHeaderLeft}>
          <div className={styles.bucketIcon}>{meta.icon}</div>
          <div>
            <div className={styles.bucketName}>{meta.label}</div>
            <div className={styles.bucketPendingLabel}>{items.length} pending</div>
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
    <div className={styles.approvalRow}>
      <div>
        <div className={styles.rowTitleLine}>
          <div className={styles.rowTitle}>{item.title}</div>
          {item.amount != null && (
            <div
              className={styles.rowAmount}
              style={{ color: meta.color }}
            >
              {formatMoney(item.amount)}
            </div>
          )}
        </div>
        {item.subtitle && (
          <div className={styles.rowSubtitle}>{item.subtitle}</div>
        )}
        {item.reason && (
          <div
            className={styles.rowReason}
            style={{ border: `1px solid ${meta.accent}55` }}
          >
            "{item.reason}"
          </div>
        )}
        <div className={styles.rowMeta}>
          {item.actor?.NAME && <span>👤 {item.actor.NAME}</span>}
          {item.requested_at && (
            <span>🕒 {new Date(item.requested_at).toLocaleString()}</span>
          )}
        </div>
      </div>

      <div className={styles.rowActions}>
        <button
          onClick={onReject}
          disabled={busy}
          className={styles.rejectBtn}
        >
          ✗ Reject
        </button>
        <button
          onClick={onApprove}
          disabled={busy}
          className={styles.approveBtn}
        >
          {busy ? "…" : "✓ Approve"}
        </button>
      </div>
    </div>
  );
}
