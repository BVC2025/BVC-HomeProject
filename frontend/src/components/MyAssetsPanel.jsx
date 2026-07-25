// =====================================================================
// MyAssetsPanel — company assets issued to the employee.
// ---------------------------------------------------------------------
// Read-only list of things HR/IT has allocated: laptop, mouse, monitor,
// ID card, access card, etc. Each row shows the issued date, the
// returned date (or "In your possession" if still active), and the
// serial number if HR logged one.
//
// Backend endpoint:
//   GET /hr-onboarding/employees/{emp_id}/assets
//   → [ { id, asset_name, asset_category, serial_number,
//         issued_date, returned_date, status, notes } ]
//
// The endpoint accepts either UUID or EMPLOYEE_CODE, so we send
// whatever localStorage has.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyAssetsPanel.module.css";


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 20) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
       stroke="currentColor" strokeWidth="1.9"
       strokeLinecap="round" strokeLinejoin="round"
       aria-hidden="true">{children}</svg>
);

const I = {
  laptop: icon(<>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M2 20h20" />
  </>),
  mouse: icon(<>
    <rect x="7" y="3" width="10" height="18" rx="5" />
    <path d="M12 7v4" />
  </>),
  monitor: icon(<>
    <rect x="3" y="3" width="18" height="13" rx="2" />
    <path d="M8 21h8M12 16v5" />
  </>),
  idCard: icon(<>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M14 10h4M14 14h4M6.5 16.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5" />
  </>),
  keycard: icon(<>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M3 10h18" />
    <circle cx="17" cy="15" r="1.4" fill="currentColor" />
  </>),
  phone: icon(<>
    <rect x="6" y="2" width="12" height="20" rx="2" />
    <path d="M11 18h2" />
  </>),
  headset: icon(<>
    <path d="M4 14v-2a8 8 0 0 1 16 0v2" />
    <rect x="3" y="14" width="4" height="6" rx="1" />
    <rect x="17" y="14" width="4" height="6" rx="1" />
  </>),
  keys: icon(<>
    <circle cx="7" cy="14" r="4" />
    <path d="M10 11l10-10" />
    <path d="M16 5l3 3" />
  </>),
  box: icon(<>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4M12 11v10" />
  </>),
  return: icon(<>
    <path d="M9 14L4 9l5-5" />
    <path d="M4 9h11a5 5 0 0 1 0 10h-2" />
  </>, 14),
  clock: icon(<>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </>, 14),
  empty: icon(<>
    <path d="M3 7l9-4 9 4v10l-9 4-9-4z" />
    <path d="M3 7l9 4 9-4M12 11v10" />
  </>, 32),
};


// ------------------------------------------------------------------
// Category → visual mapping. Kept broad so unusual asset names
// still get an icon (falls back to the box icon).
// ------------------------------------------------------------------

const CATEGORY_MAP = [
  { key: "laptop",   test: /laptop|notebook|macbook/i,        icon: I.laptop,  label: "Laptop"      },
  { key: "monitor",  test: /monitor|display|screen/i,         icon: I.monitor, label: "Monitor"     },
  { key: "mouse",    test: /mouse|trackpad/i,                 icon: I.mouse,   label: "Mouse"       },
  { key: "keyboard", test: /keyboard/i,                       icon: I.mouse,   label: "Keyboard"    },
  { key: "headset",  test: /head(set|phone)|earphone/i,       icon: I.headset, label: "Headset"     },
  { key: "id_card",  test: /id.?card|identity/i,              icon: I.idCard,  label: "ID card"     },
  { key: "access",   test: /access.?card|keycard|swipe/i,     icon: I.keycard, label: "Access card" },
  { key: "phone",    test: /phone|mobile|handset/i,           icon: I.phone,   label: "Phone"       },
  { key: "keys",     test: /keys?|locker/i,                   icon: I.keys,    label: "Keys"        },
];

function classify(name, category) {
  const hay = `${name || ""} ${category || ""}`;
  for (const c of CATEGORY_MAP) {
    if (c.test.test(hay)) return c;
  }
  return { key: "other", icon: I.box, label: category || "Other" };
}


// ------------------------------------------------------------------
// Status → chip class
// ------------------------------------------------------------------
const STATUS_META = {
  ISSUED:     { label: "Issued",     cls: "chip_issued"   },
  ALLOCATED:  { label: "Issued",     cls: "chip_issued"   },
  IN_USE:     { label: "In use",     cls: "chip_issued"   },
  RETURNED:   { label: "Returned",   cls: "chip_returned" },
  LOST:       { label: "Lost",       cls: "chip_lost"     },
  DAMAGED:    { label: "Damaged",    cls: "chip_lost"     },
  PENDING:    { label: "Pending",    cls: "chip_pending"  },
};


// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

function fmtDate(value) {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleDateString("en-IN", {
      day: "numeric", month: "short", year: "numeric",
    });
  } catch { return String(value); }
}

function daysBetween(startISO, endISO) {
  if (!startISO) return null;
  const a = new Date(startISO);
  const b = endISO ? new Date(endISO) : new Date();
  if (isNaN(a) || isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}


// ==================================================================
// Component
// ==================================================================
export default function MyAssetsPanel({ employeeId }) {

  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [filter, setFilter]   = useState("all");
  const [query, setQuery]     = useState("");


  // ---- Fetch ----
  const load = useCallback(async () => {
    if (!employeeId) return;
    // Endpoint accepts both UUID and CODE — prefer UUID from localStorage
    // (some deployments keep the code in employee_id).
    const uuid =
         (typeof window !== "undefined"
           ? localStorage.getItem("employee_uuid")
           : "")
      || employeeId;
    setLoading(true);
    setError("");
    try {
      const res = await API.get(
        `/hr-onboarding/employees/${encodeURIComponent(uuid)}/assets`
      );
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      if (e?.response?.status === 404) {
        setRows([]);
      } else {
        setError(e?.response?.data?.detail || "Failed to load assets.");
      }
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived ----

  // Attach classification once per row so we filter and count without
  // re-running the regex 50 times.
  const decorated = useMemo(
    () => rows.map((r) => ({
      ...r,
      _cat: classify(r.asset_name, r.asset_category),
    })),
    [rows]
  );

  const counts = useMemo(() => {
    const c = { all: decorated.length, active: 0, returned: 0 };
    decorated.forEach((r) => {
      if (r.returned_date) c.returned++;
      else c.active++;
    });
    return c;
  }, [decorated]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return decorated.filter((r) => {
      // Category filter
      if (filter === "active"   && r.returned_date) return false;
      if (filter === "returned" && !r.returned_date) return false;
      // Text search
      if (q) {
        const hay = `${r.asset_name || ""} ${r.asset_category || ""} ${r.serial_number || ""}`
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [decorated, filter, query]);


  // ==================================================================
  // Render
  // ==================================================================
  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>My Assets</h1>
          <p className={styles.headSub}>
            Company equipment issued to you — laptop, monitor, ID and
            access cards, and more. Includes issue and return dates
            for each item.
          </p>
        </div>

        <div className={styles.headMeta}>
          <div className={styles.metaTile}>
            <div className={styles.metaLabel}>In use</div>
            <div className={styles.metaValue}>{counts.active}</div>
          </div>
          <div className={styles.metaTile}>
            <div className={styles.metaLabel}>Returned</div>
            <div className={styles.metaValue}>{counts.returned}</div>
          </div>
        </div>
      </header>


      {/* ---------- Filter row ---------- */}
      <section className={styles.filterRow}>
        <div className={styles.filters} role="tablist">
          <FilterChip active={filter === "all"}      onClick={() => setFilter("all")}      label="All"      count={counts.all} />
          <FilterChip active={filter === "active"}   onClick={() => setFilter("active")}   label="In use"   count={counts.active}   tone="active" />
          <FilterChip active={filter === "returned"} onClick={() => setFilter("returned")} label="Returned" count={counts.returned} tone="returned" />
        </div>

        <label className={styles.searchBox}>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search asset or serial"
            aria-label="Search assets"
          />
        </label>
      </section>


      {/* ---------- List ---------- */}
      {loading && (
        <div className={styles.loading}>Loading your assets…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && filtered.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>
              {query
                ? `No assets matching "${query}".`
                : filter === "returned"
                  ? "You haven't returned any assets yet."
                  : filter === "active"
                    ? "No assets currently issued to you."
                    : "No assets on record"}
            </div>
            <div className={styles.emptyBody}>
              When HR / IT allocates equipment to you, it will appear here
              with issue and return dates.
            </div>
          </div>
        </div>
      )}

      {!loading && !error && filtered.length > 0 && (
        <ul className={styles.list}>
          {filtered.map((r) => (
            <AssetCard key={r.id} asset={r} />
          ))}
        </ul>
      )}

    </div>
  );
}


// ==================================================================
// Sub-components
// ==================================================================

function FilterChip({ active, label, count, onClick, tone }) {
  const cls = [
    styles.filterChip,
    active ? styles.filterChip_active : "",
    tone && !active ? styles[`filterChip_${tone}`] || "" : "",
  ].filter(Boolean).join(" ");
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className={cls}
      onClick={onClick}
    >
      <span>{label}</span>
      <span className={styles.filterCount}>{count}</span>
    </button>
  );
}


function AssetCard({ asset }) {
  const cat    = asset._cat;
  const status = (asset.status || (asset.returned_date ? "RETURNED" : "ISSUED"))
    .toUpperCase();
  const meta   = STATUS_META[status] || {
    label: status.replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()),
    cls: "chip_issued",
  };

  const isReturned = !!asset.returned_date;
  const days = daysBetween(asset.issued_date, asset.returned_date);

  return (
    <li className={`${styles.card} ${isReturned ? styles.card_returned : ""}`}>

      <div className={`${styles.cardIcon} ${styles[`icon_${cat.key}`] || ""}`}>
        {cat.icon}
      </div>

      <div className={styles.cardBody}>
        <div className={styles.cardHead}>
          <span className={styles.cardName}>
            {asset.asset_name || cat.label}
          </span>
          <span className={styles.cardCatPill}>{cat.label}</span>
          <span className={styles.spacer} />
          <span className={`${styles.chip} ${styles[meta.cls]}`}>{meta.label}</span>
        </div>

        {asset.serial_number && (
          <div className={styles.cardSerial}>
            Serial <b>{asset.serial_number}</b>
          </div>
        )}

        <div className={styles.dates}>
          <div className={styles.dateBlock}>
            <div className={styles.dateLabel}>
              {I.clock}
              <span>Issued</span>
            </div>
            <div className={styles.dateValue}>{fmtDate(asset.issued_date)}</div>
          </div>

          <div className={styles.dateBlock}>
            <div className={styles.dateLabel}>
              {I.return}
              <span>Returned</span>
            </div>
            <div className={styles.dateValue}>
              {isReturned
                ? fmtDate(asset.returned_date)
                : <span className={styles.notReturned}>In your possession</span>}
            </div>
          </div>

          {days != null && (
            <div className={styles.dateBlock}>
              <div className={styles.dateLabel}>
                <span>&nbsp;</span>
                <span>Duration</span>
              </div>
              <div className={styles.dateValue}>
                {days === 0 ? "Today" : `${days} day${days === 1 ? "" : "s"}`}
              </div>
            </div>
          )}
        </div>

        {asset.notes && (
          <div className={styles.notes}>{asset.notes}</div>
        )}
      </div>
    </li>
  );
}
