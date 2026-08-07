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


// Inline SVG icon set — Heroicons-outline style, matches the rest of the
// app's convention (SidebarIcon in Dashboard.jsx, KpiIcon in the command
// center). No emoji anywhere in this page.
function Icon({ name, size = 18, color, className }) {

  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: color || "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    className,
    "aria-hidden": true,
  };

  switch (name) {
    case "grid":
      return (
        <svg {...common}>
          <rect x="3" y="3" width="7" height="7" rx="1.4" />
          <rect x="14" y="3" width="7" height="7" rx="1.4" />
          <rect x="3" y="14" width="7" height="7" rx="1.4" />
          <rect x="14" y="14" width="7" height="7" rx="1.4" />
        </svg>
      );
    case "leave":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="18" rx="2" />
          <path d="M16 2v4M8 2v4M3 10h18" />
        </svg>
      );
    case "permission":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 2" />
        </svg>
      );
    case "quotation":
      return (
        <svg {...common}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4" />
          <path d="M10 13h4M10 17h4" />
        </svg>
      );
    case "purchase_order":
      return (
        <svg {...common}>
          <path d="M3 7l9-4 9 4-9 4-9-4z" />
          <path d="M3 7v10l9 4V11" />
          <path d="M21 7v10l-9 4" />
        </svg>
      );
    case "supplier_payment":
      return (
        <svg {...common}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <path d="M2 10h20" />
        </svg>
      );
    case "discount":
      return (
        <svg {...common}>
          <path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9Z" />
          <circle cx="7.5" cy="7.5" r="1.4" fill={color || "currentColor"} />
        </svg>
      );
    case "success":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l2.5 2.5L16 9.5" />
        </svg>
      );
    case "warning":
      return (
        <svg {...common}>
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
          <path d="M12 9v4M12 17h.01" />
        </svg>
      );
    case "person":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.5 3.5-7 8-7s8 2.5 8 7" />
        </svg>
      );
    case "clock":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5v5l3.5 2" />
        </svg>
      );
    case "check":
      return (
        <svg {...common}>
          <path d="M5 12.5l4.5 4.5L19 7" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    default:
      return null;
  }
}


const BUCKET_META = {
  leaves: {
    label: "Leave Requests",
    kind: "leave",
    icon: "leave",
    color: "#0EA5E9",
    accent: "#BAE6FD",
  },
  permissions: {
    label: "Permission Requests",
    kind: "permission",
    icon: "permission",
    color: "#DC2626",
    accent: "#FECACA",
  },
  quotations: {
    label: "Quotations",
    kind: "quotation",
    icon: "quotation",
    color: "#10B981",
    accent: "#A7F3D0",
  },
  purchase_orders: {
    label: "Purchase Orders",
    kind: "purchase_order",
    icon: "purchase_order",
    color: "#6366F1",
    accent: "#C7D2FE",
  },
  supplier_payments: {
    label: "Supplier Payments",
    kind: "supplier_payment",
    icon: "supplier_payment",
    color: "#14B8A6",
    accent: "#99F6E4",
  },
  discount_requests: {
    label: "Customer Discounts",
    kind: "discount_request",
    icon: "discount",
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
          icon="grid"
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
        <div className={styles.errorBanner}>
          <Icon name="warning" size={16} />
          {error}
        </div>
      )}

      {toast && (
        <div className={styles.toast}>{toast}</div>
      )}

      {loading && !data.total_pending ? (
        <div className={styles.loadingText}>Loading pending approvals…</div>
      ) : data.total_pending === 0 ? (
        <div className={styles.allClear}>
          <div className={styles.allClearIcon}>
            <Icon name="success" size={48} color="var(--success)" />
          </div>
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
      <Icon name={icon} size={15} color={active ? undefined : color} />
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
          <div className={styles.bucketIcon}>
            <Icon name={meta.icon} size={20} color="#fff" />
          </div>
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
          {item.actor?.NAME && (
            <span className={styles.rowMetaItem}>
              <Icon name="person" size={13} />
              {item.actor.NAME}
            </span>
          )}
          {item.requested_at && (
            <span className={styles.rowMetaItem}>
              <Icon name="clock" size={13} />
              {new Date(item.requested_at).toLocaleString()}
            </span>
          )}
        </div>
      </div>

      <div className={styles.rowActions}>
        <button
          onClick={onReject}
          disabled={busy}
          className={styles.rejectBtn}
        >
          <Icon name="close" size={14} />
          Reject
        </button>
        <button
          onClick={onApprove}
          disabled={busy}
          className={styles.approveBtn}
        >
          {busy ? "…" : (<><Icon name="check" size={14} />Approve</>)}
        </button>
      </div>
    </div>
  );
}
