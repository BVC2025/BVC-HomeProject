// =====================================================================
// DocumentLibrary — admin-uploaded document management for the
// HRMS AI Assistant.
//
// UX:
//   - Upload drop / file-picker (admins only)
//   - List of uploaded documents with title, size, pages, badges
//     (has-tables, OCR, scanned)
//   - Delete button per row (admins only)
//   - Read-only for non-admin employees
//
// Talks to:
//   POST   /hrms-ai/documents
//   GET    /hrms-ai/documents
//   DELETE /hrms-ai/documents/{id}
//
// Phase A scope only — no chat integration yet. Chat wiring lands in
// Phase B when we start indexing + retrieving per-doc.
// =====================================================================

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import API from "../services/api";
import styles from "./DocumentLibrary.module.css";


const ADMIN_ROLES = new Set([
  "ADMIN", "SUPER_ADMIN",
  "HR", "MANAGER", "PRODUCTION_HEAD",
  "MANAGING_DIRECTOR", "HR_MANAGER", "SALES_MANAGER",
  "PURCHASE_MANAGER", "PRODUCTION_MANAGER",
  "INVENTORY_MANAGER", "ACCOUNTS_MANAGER",
]);

function isAdminFromStorage() {
  if (typeof window === "undefined") return false;
  const role = (localStorage.getItem("role") || "").toUpperCase();
  return ADMIN_ROLES.has(role);
}


// ---------------------------------------------------------------------
// SVG icons — inline strokes, matching the rest of the ESS design
// ---------------------------------------------------------------------
const Icon = ({ children, size = 16 }) => (
  <svg
    width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round"
    strokeLinejoin="round" aria-hidden="true"
  >{children}</svg>
);
const IcUpload = () => <Icon><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" /></Icon>;
const IcTrash  = () => <Icon><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></Icon>;
const IcRefresh = () => <Icon><polyline points="23 4 23 10 17 10" /><polyline points="1 20 1 14 7 14" /><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" /></Icon>;
const IcFile   = () => <Icon><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Icon>;
const IcCheck  = () => <Icon size={12}><polyline points="20 6 9 17 4 12" /></Icon>;
const IcAlert  = () => <Icon size={12}><path d="M12 9v4" /><path d="M12 17h.01" /><path d="M10.29 3.86l-8.5 15A2 2 0 0 0 3.53 22h17a2 2 0 0 0 1.75-3.14l-8.5-15a2 2 0 0 0-3.48 0z" /></Icon>;


// ---------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------

function humanBytes(n) {
  if (n == null) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}


// =====================================================================
// Component
// =====================================================================

export default function DocumentLibrary() {

  const [docs, setDocs]         = useState([]);
  const [loading, setLoading]   = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError]       = useState("");
  const [toast, setToast]       = useState("");

  const fileInputRef = useRef(null);
  const isAdmin = useMemo(isAdminFromStorage, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await API.get("/hrms-ai/documents");
      setDocs(res.data?.documents || []);
    } catch (e) {
      setError(e?.response?.data?.detail || "Couldn't load the document library.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Auto-clear the toast
  useEffect(() => {
    if (!toast) return undefined;
    const t = setTimeout(() => setToast(""), 4000);
    return () => clearTimeout(t);
  }, [toast]);


  // -------------------------------------------------------------------
  // Upload
  // -------------------------------------------------------------------
  const uploadFile = useCallback(async (file, customTitle) => {
    if (!file) return;
    if (uploading) return;

    setError("");
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      if (customTitle && customTitle.trim()) {
        form.append("title", customTitle.trim());
      }

      const res = await API.post("/hrms-ai/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });

      const doc = res.data?.document;
      if (doc?.extraction_error) {
        setToast(`Uploaded, but extraction had issues: ${doc.extraction_error}`);
      } else {
        setToast(`Uploaded "${doc?.title || file.name}".`);
      }
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.detail || "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [uploading, refresh]);

  const onFilePicked = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadFile(f);
  };

  const onDrop = (e) => {
    e.preventDefault();
    if (!isAdmin) return;
    const f = e.dataTransfer.files?.[0];
    if (f) uploadFile(f);
  };


  // -------------------------------------------------------------------
  // Delete
  // -------------------------------------------------------------------
  const remove = useCallback(async (doc) => {
    if (!window.confirm(`Delete "${doc.title}" from the knowledge base?`)) return;
    try {
      await API.delete(`/hrms-ai/documents/${doc.id}`);
      setToast(`Deleted "${doc.title}".`);
      await refresh();
    } catch (e) {
      setError(e?.response?.data?.detail || "Delete failed.");
    }
  }, [refresh]);


  // ===================================================================
  // Render
  // ===================================================================

  return (
    <div className={styles.wrap}>

      {/* Header */}
      <div className={styles.head}>
        <div>
          <div className={styles.eyebrow}>HRMS AI</div>
          <h2 className={styles.title}>Document Library</h2>
          <p className={styles.sub}>
            {isAdmin
              ? "Upload PDFs, Word files, Excels or scanned images. The AI will use them as its knowledge source."
              : "Documents your HR admin has published to the AI assistant."}
          </p>
        </div>

        <div className={styles.headActions}>
          <button
            type="button"
            className={styles.iconBtn}
            onClick={refresh}
            title="Refresh"
            aria-label="Refresh"
          >
            <IcRefresh />
          </button>

          {isAdmin && (
            <>
              <button
                type="button"
                className={styles.primaryBtn}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                <IcUpload />
                {uploading ? "Uploading…" : "Upload document"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx,.txt,.md,.log,.csv,.xlsx,.xlsm,.png,.jpg,.jpeg,.webp,.bmp,.tiff"
                style={{ display: "none" }}
                onChange={onFilePicked}
              />
            </>
          )}
        </div>
      </div>

      {/* Drop zone (admin only) */}
      {isAdmin && (
        <div
          className={styles.dropZone}
          onDragOver={(e) => e.preventDefault()}
          onDrop={onDrop}
        >
          Drag a file here, or click <b>Upload document</b> above.
          <div className={styles.dropHint}>
            PDF · Word · Text · Markdown · CSV · Excel · Image (PNG/JPG/TIFF, will be OCR'd)
            &nbsp;·&nbsp; Max 25 MB
          </div>
        </div>
      )}

      {/* Errors + toast */}
      {error && <div className={styles.error}>{error}</div>}
      {toast && <div className={styles.toast}>{toast}</div>}

      {/* Doc list */}
      <div className={styles.card}>
        {loading && <div className={styles.muted}>Loading documents…</div>}

        {!loading && docs.length === 0 && (
          <div className={styles.empty}>
            {isAdmin
              ? "Nothing uploaded yet. Add a document to get started."
              : "The knowledge base is empty. Your HR admin hasn't uploaded any documents."}
          </div>
        )}

        {!loading && docs.length > 0 && (
          <ul className={styles.list}>
            {docs.map((d) => (
              <li key={d.id} className={styles.row}>
                <span className={styles.rowIcon}><IcFile /></span>

                <div className={styles.rowBody}>
                  <div className={styles.rowTitle}>{d.title}</div>
                  <div className={styles.rowMeta}>
                    <span>{humanBytes(d.size_bytes)}</span>
                    <span className={styles.dot}>·</span>
                    <span>
                      {d.page_count != null
                        ? `${d.page_count} page${d.page_count === 1 ? "" : "s"}`
                        : "text"}
                    </span>
                    <span className={styles.dot}>·</span>
                    <span>{fmtDate(d.created_at)}</span>
                  </div>

                  <div className={styles.badgeRow}>
                    {(d.extracted_text_len || 0) > 0 ? (
                      <span className={`${styles.badge} ${styles.badgeOk}`}>
                        <IcCheck /> extracted
                      </span>
                    ) : (
                      <span className={`${styles.badge} ${styles.badgeWarn}`}>
                        <IcAlert /> empty text
                      </span>
                    )}
                    {d.table_count > 0 && (
                      <span className={styles.badge}>
                        {d.table_count} table{d.table_count === 1 ? "" : "s"}
                      </span>
                    )}
                    {d.ocr_applied ? (
                      <span className={styles.badge}>OCR</span>
                    ) : null}
                    {d.has_images ? (
                      <span className={styles.badge}>images</span>
                    ) : null}
                    {d.extraction_error ? (
                      <span
                        className={`${styles.badge} ${styles.badgeWarn}`}
                        title={d.extraction_error}
                      >
                        <IcAlert /> extraction warning
                      </span>
                    ) : null}
                  </div>
                </div>

                {isAdmin && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => remove(d)}
                    title="Delete"
                    aria-label="Delete document"
                  >
                    <IcTrash />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

    </div>
  );
}
