// =====================================================================
// MyDocumentsPanel — every document HR has on file for the employee.
// ---------------------------------------------------------------------
// Categories surfaced as tabs:
//   • Employment  — Offer letter, Appointment order, Increment /
//                   promotion / experience / relieving letters
//   • Salary      — Monthly payslips (pulled from /my-payslips)
//   • Identity    — Aadhaar, PAN, Passport, Driving licence, Voter ID
//   • Education   — 10th / 12th / Diploma / Degree / PG / Certificates
//   • Others      — Resume, address proof, bank passbook, etc.
//
// Everything is downloadable. Employment / Identity / Education /
// Others come from GET /employees/{id}/documents; Salary comes from
// GET /my-payslips + GET /my-payslips/{id}/pdf.
// =====================================================================

import { useCallback, useEffect, useMemo, useState } from "react";

import API from "../services/api";
import styles from "./MyDocumentsPanel.module.css";


// Backend URL for opening files directly (documents already have a
// public FILE_URL that includes /static/employee-docs/...).
const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";

function absoluteUrl(path) {
  if (!path) return null;
  if (/^https?:/i.test(path)) return path;
  if (path.startsWith("/")) return `${BACKEND_URL}${path}`;
  return `${BACKEND_URL}/${path}`;
}


// ------------------------------------------------------------------
// Icons
// ------------------------------------------------------------------
const icon = (children, size = 18) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true">{children}</svg>
);

const I = {
  doc: icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>),
  briefcase: icon(<>
    <rect x="2" y="7" width="20" height="14" rx="2" />
    <path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    <path d="M2 13h20" />
  </>),
  rupee: icon(<>
    <path d="M6 4h12" />
    <path d="M6 8h12" />
    <path d="M6 13h4a4 4 0 0 0 0-8H6" />
    <path d="M6 13l8 8" />
  </>),
  idCard: icon(<>
    <rect x="3" y="5" width="18" height="14" rx="2" />
    <circle cx="9" cy="12" r="2.5" />
    <path d="M14 10h4M14 14h4M6.5 16.5c0-1.4 1.1-2.5 2.5-2.5s2.5 1.1 2.5 2.5" />
  </>),
  graduation: icon(<>
    <path d="M22 10L12 5 2 10l10 5 10-5z" />
    <path d="M6 12v5c3 2 9 2 12 0v-5" />
  </>),
  folder: icon(<>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </>),
  search: icon(<><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></>, 14),
  view: icon(<>
    <path d="M2 12s4-8 10-8 10 8 10 8-4 8-10 8-10-8-10-8z" />
    <circle cx="12" cy="12" r="3" />
  </>, 14),
  download: icon(<>
    <path d="M12 3v13" />
    <path d="M7 12l5 5 5-5" />
    <path d="M5 21h14" />
  </>, 14),
  empty: icon(<>
    <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
    <path d="M14 3v6h6" />
  </>, 32),
};


// ------------------------------------------------------------------
// DOC_TYPE → { label, category, tone }
// The label lives on the frontend so we can rename freely without
// touching the DB. Every backend DOC_TYPE has an entry here; anything
// unknown falls into the "Others" bucket with a title-cased label.
// ------------------------------------------------------------------

const DOC_META = {
  // Employment
  OFFER_LETTER: { label: "Offer letter", category: "employment" },
  APPOINTMENT_LETTER: { label: "Appointment order", category: "employment" },
  JOINING_LETTER: { label: "Joining letter", category: "employment" },
  INCREMENT_LETTER: { label: "Increment letter", category: "employment" },
  PROMOTION_LETTER: { label: "Promotion letter", category: "employment" },
  EXPERIENCE_LETTER: { label: "Experience letter", category: "employment" },
  RELIEVING_LETTER: { label: "Relieving letter", category: "employment" },

  // Identity
  AADHAAR: { label: "Aadhaar card", category: "identity" },
  PAN: { label: "PAN card", category: "identity" },
  VOTER_ID: { label: "Voter ID", category: "identity" },
  PASSPORT: { label: "Passport", category: "identity" },
  DRIVING_LICENSE: { label: "Driving licence", category: "identity" },

  // Education
  TENTH_MARKSHEET: { label: "10th marksheet", category: "education" },
  TWELFTH_MARKSHEET: { label: "12th marksheet", category: "education" },
  DIPLOMA: { label: "Diploma", category: "education" },
  DEGREE: { label: "Degree", category: "education" },
  POSTGRADUATE: { label: "Postgraduate", category: "education" },
  EDUCATIONAL: { label: "Educational (other)", category: "education" },
  CERTIFICATE: { label: "Certificate", category: "education" },

  // Others
  RESUME: { label: "Resume / CV", category: "others" },
  PHOTO: { label: "Photograph", category: "others" },
  BIRTH_CERTIFICATE: { label: "Birth certificate", category: "others" },
  MARRIAGE_CERTIFICATE: { label: "Marriage certificate", category: "others" },
  ADDRESS_PROOF: { label: "Address proof", category: "others" },
  BANK_PASSBOOK: { label: "Bank passbook", category: "others" },
  SALARY_SLIP: { label: "Previous salary slip", category: "others" },
  OTHER: { label: "Other", category: "others" },
};

function metaOf(docType) {
  const key = (docType || "").toUpperCase();
  if (DOC_META[key]) return { ...DOC_META[key], type: key };
  return {
    label: key.replace(/_/g, " ").toLowerCase()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Document",
    category: "others",
    type: key,
  };
}


// ------------------------------------------------------------------
// Category → icon + tone
// ------------------------------------------------------------------
const CATS = [
  { key: "employment", label: "Employment", icon: I.briefcase, tone: "blue" },
  { key: "salary", label: "Salary", icon: I.rupee, tone: "green" },
  { key: "identity", label: "Identity", icon: I.idCard, tone: "red" },
  { key: "education", label: "Education", icon: I.graduation, tone: "amber" },
  { key: "others", label: "Others", icon: I.folder, tone: "muted" },
];

function catOf(key) {
  return CATS.find((c) => c.key === key) || CATS[4];
}


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

function humanSize(bytes) {
  const n = Number(bytes || 0);
  if (n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}


// ==================================================================
// Component
// ==================================================================
export default function MyDocumentsPanel({ employeeId }) {

  const [docs, setDocs] = useState([]);   // /employees/{id}/documents
  const [payslips, setPayslips] = useState([]);   // /my-payslips
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [tab, setTab] = useState("employment");
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState(null);   // for payslip PDF downloads


  // ---- Fetch ----
  const load = useCallback(async () => {
    if (!employeeId) return;

    // Documents endpoint uses UUID; payslips endpoint accepts either
    // UUID or CODE via require_employee. Prefer UUID from localStorage
    // when available.
    const uuid =
      (typeof window !== "undefined"
        ? localStorage.getItem("employee_uuid")
        : "")
      || employeeId;

    setLoading(true);
    setError("");
    try {
      const [docRes, slipRes] = await Promise.all([
        API.get(`/employees/${encodeURIComponent(uuid)}/documents`)
          .catch(() => ({ data: [] })),
        API.get(`/my-payslips?employee_id=${encodeURIComponent(employeeId)}`)
          .catch(() => ({ data: [] })),
      ]);
      const dList = Array.isArray(docRes.data)
        ? docRes.data
        : docRes.data?.documents || [];
      const sList = Array.isArray(slipRes.data) ? slipRes.data : [];
      setDocs(dList);
      setPayslips(sList);
    } catch (e) {
      setError(e?.response?.data?.detail || "Failed to load documents.");
    } finally {
      setLoading(false);
    }
  }, [employeeId]);

  useEffect(() => { load(); }, [load]);


  // ---- Derived counts ----
  const counts = useMemo(() => {
    const c = { all: 0, employment: 0, salary: payslips.length, identity: 0, education: 0, others: 0 };
    docs.forEach((d) => {
      const cat = metaOf(d.DOC_TYPE).category;
      c[cat] = (c[cat] || 0) + 1;
      c.all++;
    });
    c.all += payslips.length;
    return c;
  }, [docs, payslips]);


  // ---- Rows for the active tab ----
  const rows = useMemo(() => {
    const qNorm = query.trim().toLowerCase();

    if (tab === "salary") {
      const list = payslips.map((s) => ({
        __kind: "payslip",
        id: `ps-${s.ID}`,
        title: `${s.MONTH_NAME || ""} ${s.YEAR || ""}`.trim() || "Payslip",
        subtitle: s.PAYSLIP_NUMBER || "",
        dateISO: null,
        typeLabel: "Salary slip",
        meta: `${s.RUN_STATUS || ""}`,
        // Actions
        viewUrl: `${BACKEND_URL}/my-payslips/${s.ID}/pdf`,
        downloadId: s.ID,
        downloadName: `Payslip-${s.PAYSLIP_NUMBER || s.ID}.pdf`,
        _raw: s,
      }));
      return qNorm
        ? list.filter((r) => r.title.toLowerCase().includes(qNorm)
          || (r.subtitle || "").toLowerCase().includes(qNorm))
        : list;
    }

    // Documents from /employees/{id}/documents, filtered by category
    const list = docs
      .map((d) => {
        const m = metaOf(d.DOC_TYPE);
        return {
          __kind: "doc",
          id: `d-${d.ID}`,
          title: d.TITLE || m.label,
          subtitle: d.FILE_NAME || "",
          dateISO: d.UPLOADED_AT,
          typeLabel: m.label,
          typeKey: m.type,
          category: m.category,
          size: d.SIZE_BYTES,
          fileUrl: absoluteUrl(d.FILE_URL),
          fileName: d.FILE_NAME || `${m.label}.pdf`,
          _raw: d,
        };
      })
      .filter((r) => r.category === tab);

    if (!qNorm) return list;
    return list.filter((r) =>
      r.title.toLowerCase().includes(qNorm)
      || (r.typeLabel || "").toLowerCase().includes(qNorm)
      || (r.subtitle || "").toLowerCase().includes(qNorm)
    );
  }, [tab, docs, payslips, query]);


  // ---- Actions ----

  const openInNewTab = (url) => {
    if (!url) return;
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const downloadDoc = async (row) => {
    if (row.__kind === "payslip") {
      // Payslip PDF — fetch as blob and force-save with a nice filename
      setBusyId(row.id);
      try {
        const res = await API.get(`/my-payslips/${row.downloadId}/pdf`, {
          responseType: "blob",
        });
        saveBlob(res.data, row.downloadName);
      } catch (e) {
        alert(e?.response?.data?.detail || "Download failed");
      } finally {
        setBusyId(null);
      }
      return;
    }

    // Employee document — the FILE_URL is already public. Fetch it
    // as a blob so the browser saves with the original filename
    // instead of navigating away from the ERP.
    if (!row.fileUrl) return;
    setBusyId(row.id);
    try {
      const res = await fetch(row.fileUrl, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      saveBlob(blob, row.fileName);
    } catch (e) {
      // Fallback: open in a new tab so the user can Save-As manually
      openInNewTab(row.fileUrl);
    } finally {
      setBusyId(null);
    }
  };


  // ==================================================================
  // Render
  // ==================================================================

  const activeCat = catOf(tab);

  return (
    <div className={styles.wrap}>

      {/* ---------- Header ---------- */}
      <header className={styles.head}>
        <div>
          <div className={styles.headEyebrow}>Employee Self-Service</div>
          <h1 className={styles.headTitle}>
            My Documents
            <span className={styles.headCount}>{counts.all}</span>
          </h1>
          <p className={styles.headSub}>
            Every document HR has on file for you — employment letters,
            salary slips, identity proofs, education certificates and
            more. All downloadable.
          </p>
        </div>

        <label className={styles.searchBox}>
          <span className={styles.searchIcon}>{I.search}</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title, type or filename"
            aria-label="Search documents"
          />
        </label>
      </header>


      {/* ---------- Category tabs ---------- */}
      <div className={styles.tabs} role="tablist">
        {CATS.map((c) => (
          <button
            key={c.key}
            type="button"
            role="tab"
            aria-selected={tab === c.key}
            className={`${styles.tab} ${tab === c.key ? styles.tab_active : ""}`}
            onClick={() => setTab(c.key)}
          >
            <span className={`${styles.tabIcon} ${styles[`tint_${c.tone}`]}`}>
              {c.icon}
            </span>
            <span className={styles.tabLabel}>{c.label}</span>
            <span className={styles.tabCount}>{counts[c.key] || 0}</span>
          </button>
        ))}
      </div>


      {/* ---------- Content ---------- */}
      {loading && (
        <div className={styles.loading}>Loading your documents…</div>
      )}

      {!loading && error && (
        <div className={styles.error}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div className={styles.empty}>
          <span className={styles.emptyIcon}>{I.empty}</span>
          <div>
            <div className={styles.emptyTitle}>
              {query
                ? `No documents matching "${query}"`
                : `No ${activeCat.label.toLowerCase()} documents yet`}
            </div>
            <div className={styles.emptyBody}>
              {tab === "salary"
                ? "Your monthly payslips will appear here once HR generates them."
                : "When HR uploads a document to your file, it will appear in this section — downloadable."}
            </div>
          </div>
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <ul className={styles.list}>
          {rows.map((r) => (
            <DocRow
              key={r.id}
              row={r}
              busy={busyId === r.id}
              tone={r.__kind === "payslip" ? "green" : catOf(r.category || tab).tone}
              onView={() => {
                if (r.__kind === "payslip") openInNewTab(r.viewUrl);
                else openInNewTab(r.fileUrl);
              }}
              onDownload={() => downloadDoc(r)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}


// ==================================================================
// Sub-components
// ==================================================================

function DocRow({ row, tone, busy, onView, onDownload }) {
  const sizeText = row.size ? humanSize(row.size) : "";
  const canView = row.__kind === "payslip" ? !!row.viewUrl : !!row.fileUrl;

  return (
    <li className={styles.row}>
      <div className={`${styles.rowIcon} ${styles[`tint_${tone}`]}`}>
        {I.doc}
      </div>

      <div className={styles.rowBody}>
        <div className={styles.rowTitle}>{row.title}</div>
        <div className={styles.rowMeta}>
          <span className={styles.typeChip}>{row.typeLabel}</span>
          {row.dateISO && (
            <>
              <span className={styles.dot}>·</span>
              <span>Uploaded {fmtDate(row.dateISO)}</span>
            </>
          )}
          {row.subtitle && (
            <>
              <span className={styles.dot}>·</span>
              <span className={styles.rowFilename}>{row.subtitle}</span>
            </>
          )}
          {sizeText && (
            <>
              <span className={styles.dot}>·</span>
              <span>{sizeText}</span>
            </>
          )}
        </div>
      </div>

      <div className={styles.rowActions}>
        <button
          type="button"
          className={styles.btnGhost}
          onClick={onView}
          disabled={!canView}
          title={canView ? "Open in a new tab" : "No file available"}
        >
          {I.view}
          <span>View</span>
        </button>
        <button
          type="button"
          className={styles.btnPrimary}
          onClick={onDownload}
          disabled={busy || !canView}
          title="Download"
        >
          {I.download}
          <span>{busy ? "…" : "Download"}</span>
        </button>
      </div>
    </li>
  );
}


// ------------------------------------------------------------------
// Save a Blob with a chosen filename (used by both doc + payslip
// downloads so the browser doesn't navigate away).
// ------------------------------------------------------------------
function saveBlob(blobLike, filename) {
  const blob = blobLike instanceof Blob
    ? blobLike
    : new Blob([blobLike]);
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 5000);
}
