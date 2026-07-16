// =====================================================================
// MyProfilePanel
// ---------------------------------------------------------------------
// Employee Self-Service → "My Profile" tab.
//
// Two features on this panel:
//   1. Profile photo — see the current photo, upload/replace it. The
//      new photo also updates localStorage.employee_photo so the home
//      dashboard hero + sidebar avatar refresh without a page reload.
//   2. Documents — list of files the employee has already uploaded
//      (Aadhaar, PAN, resume, education certificates, etc.), plus an
//      inline uploader with a document-type picker.
//
// Backend endpoints (already-existing):
//   POST   /employees/{id}/upload-photo                (multipart file)
//   GET    /employees/{id}/documents                   list
//   POST   /employees/{id}/documents                   upload (multipart)
//   DELETE /employees/{id}/documents/{doc_id}          remove
//
// The employee endpoint gate was loosened to `assert_self_or_admin`
// so employees can manage their own docs without the admin-only
// `document.upload` permission.
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API, { API_BASE_URL } from "../services/api";
import styles from "./MyProfilePanel.module.css";


// Match backend's DOC_TYPES set. Keep the visible label short so it
// fits well on mobile.
const DOC_TYPES = [
  { value: "AADHAAR",             label: "Aadhaar" },
  { value: "PAN",                 label: "PAN card" },
  { value: "PASSPORT",            label: "Passport" },
  { value: "DRIVING_LICENSE",     label: "Driving licence" },
  { value: "VOTER_ID",            label: "Voter ID" },
  { value: "TENTH_MARKSHEET",     label: "10th marksheet" },
  { value: "TWELFTH_MARKSHEET",   label: "12th marksheet" },
  { value: "DIPLOMA",             label: "Diploma" },
  { value: "DEGREE",              label: "Degree certificate" },
  { value: "POSTGRADUATE",        label: "PG certificate" },
  { value: "CERTIFICATE",         label: "Other certificate" },
  { value: "RESUME",              label: "Resume / CV" },
  { value: "OFFER_LETTER",        label: "Offer letter" },
  { value: "EXPERIENCE_LETTER",   label: "Experience letter" },
  { value: "RELIEVING_LETTER",    label: "Relieving letter" },
  { value: "SALARY_SLIP",         label: "Previous salary slip" },
  { value: "BANK_PASSBOOK",       label: "Bank passbook / cheque" },
  { value: "ADDRESS_PROOF",       label: "Address proof" },
  { value: "BIRTH_CERTIFICATE",   label: "Birth certificate" },
  { value: "MARRIAGE_CERTIFICATE",label: "Marriage certificate" },
  { value: "OTHER",               label: "Other" },
];

const MAX_MB = 10;


function absoluteUrl(path) {
  if (!path) return null;
  if (/^https?:/.test(path)) return path;
  return `${API_BASE_URL}${path}`;
}


function humanSize(bytes) {
  if (!bytes && bytes !== 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}


export default function MyProfilePanel({ employeeUuid }) {

  // employeeUuid is the internal UUID of the logged-in employee — the
  // ID column, not the EMPLOYEE_CODE. Photo + docs endpoints take this.
  const empId = employeeUuid || localStorage.getItem("employee_uuid") || "";

  const [photoUrl, setPhotoUrl] = useState(
    () => localStorage.getItem("employee_photo") || ""
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const photoInputRef = useRef(null);

  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  const [docsError, setDocsError] = useState("");

  const [uploadType, setUploadType] = useState("AADHAAR");
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const docInputRef = useRef(null);

  const [confirmDelete, setConfirmDelete] = useState(null);
  // confirmDelete = { id, title } while a delete confirmation is up

  const identity = useMemo(() => ({
    name: (localStorage.getItem("employee_name") || "").trim() || "You",
    code: (localStorage.getItem("employee_code") || "").trim(),
    email: (localStorage.getItem("employee_email") || "").trim(),
  }), []);


  // ---------- Load docs ----------
  const fetchDocs = async () => {
    if (!empId) return;
    setDocsLoading(true);
    setDocsError("");
    try {
      const res = await API.get(
        `/employees/${encodeURIComponent(empId)}/documents`
      );
      const rows = Array.isArray(res.data) ? res.data : (res.data?.rows || []);
      setDocs(rows);
    } catch (err) {
      setDocsError(
        err?.response?.data?.detail ||
        err?.message ||
        "Could not load documents."
      );
    } finally {
      setDocsLoading(false);
    }
  };

  useEffect(() => { fetchDocs(); }, [empId]);


  // ---------- Photo upload ----------
  const handlePhotoPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setPhotoError("Pick an image file (PNG or JPG).");
      return;
    }
    if (file.size > MAX_MB * 1024 * 1024) {
      setPhotoError(`Photo must be under ${MAX_MB} MB.`);
      return;
    }
    setPhotoBusy(true);
    setPhotoError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await API.post(
        `/employees/${encodeURIComponent(empId)}/upload-photo`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const newUrl = res.data?.photo_url || "";
      setPhotoUrl(newUrl);
      // Update localStorage so home dashboard hero + sidebar avatar
      // reflect the new photo on the next render / page nav.
      localStorage.setItem("employee_photo", newUrl);
    } catch (err) {
      setPhotoError(
        err?.response?.data?.detail ||
        err?.message ||
        "Photo upload failed."
      );
    } finally {
      setPhotoBusy(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
    }
  };


  // ---------- Document upload ----------
  const handleDocPick = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_MB * 1024 * 1024) {
      setUploadError(`File must be under ${MAX_MB} MB.`);
      return;
    }
    setUploadBusy(true);
    setUploadError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("doc_type", uploadType);
      fd.append("title", uploadTitle || file.name);
      const res = await API.post(
        `/employees/${encodeURIComponent(empId)}/documents`,
        fd,
        { headers: { "Content-Type": "multipart/form-data" } }
      );
      const newDoc = res.data?.document;
      if (newDoc) setDocs((prev) => [newDoc, ...prev]);
      setUploadTitle("");
    } catch (err) {
      setUploadError(
        err?.response?.data?.detail ||
        err?.message ||
        "Upload failed."
      );
    } finally {
      setUploadBusy(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };


  // ---------- Document delete ----------
  const handleDelete = async (docId) => {
    try {
      await API.delete(
        `/employees/${encodeURIComponent(empId)}/documents/${docId}`
      );
      setDocs((prev) => prev.filter((d) => d.ID !== docId && d.id !== docId));
      setConfirmDelete(null);
    } catch (err) {
      alert(
        err?.response?.data?.detail ||
        err?.message ||
        "Delete failed."
      );
    }
  };


  // ---------- Render ----------
  return (
    <div className={styles.wrap}>

      {/* ============ IDENTITY HERO ============ */}
      <section className={styles.hero}>
        <div className={styles.heroAvatar}>
          {photoUrl
            ? <img src={absoluteUrl(photoUrl)} alt="" />
            : <span>{(identity.name || "?").charAt(0).toUpperCase()}</span>}
        </div>
        <div className={styles.heroText}>
          <div className={styles.heroEyebrow}>Employee profile</div>
          <div className={styles.heroName}>{identity.name}</div>
          <div className={styles.heroMeta}>
            {[identity.code, identity.email].filter(Boolean).join("  ·  ") || "—"}
          </div>
        </div>
      </section>

      {/* ============ PROFILE PHOTO ============ */}
      <section className={styles.card}>
        <header className={styles.cardHead}>
          <h2>Profile photo</h2>
          <p>PNG or JPG, up to {MAX_MB} MB. Shows on your dashboard + payslips.</p>
        </header>

        <div className={styles.photoBody}>
          <div className={styles.photoPreview}>
            {photoUrl
              ? <img src={absoluteUrl(photoUrl)} alt="Current profile" />
              : <span>{(identity.name || "?").charAt(0).toUpperCase()}</span>}
          </div>

          <div className={styles.photoActions}>
            <input
              ref={photoInputRef}
              type="file"
              accept="image/*"
              onChange={handlePhotoPick}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={photoBusy || !empId}
              onClick={() => photoInputRef.current?.click()}
            >
              {photoBusy ? "Uploading…" : (photoUrl ? "Change photo" : "Upload photo")}
            </button>
            {photoError && (
              <div className={styles.errorLine}>{photoError}</div>
            )}
          </div>
        </div>
      </section>

      {/* ============ DOCUMENTS ============ */}
      <section className={styles.card}>
        <header className={styles.cardHead}>
          <h2>My documents</h2>
          <p>Aadhaar, PAN, education certificates, offer letter, etc. — up to {MAX_MB} MB each.</p>
        </header>

        {/* Upload form */}
        <div className={styles.uploadRow}>
          <label className={styles.uploadField}>
            <span className={styles.uploadLabel}>Document type</span>
            <select
              value={uploadType}
              onChange={(e) => setUploadType(e.target.value)}
              className={styles.select}
              disabled={uploadBusy}
            >
              {DOC_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </label>

          <label className={styles.uploadField}>
            <span className={styles.uploadLabel}>Title (optional)</span>
            <input
              type="text"
              value={uploadTitle}
              onChange={(e) => setUploadTitle(e.target.value)}
              placeholder="e.g. Aadhaar front side"
              className={styles.input}
              disabled={uploadBusy}
            />
          </label>

          <div className={styles.uploadFieldWide}>
            <input
              ref={docInputRef}
              type="file"
              accept=".pdf,.png,.jpg,.jpeg,.webp,.doc,.docx,.xls,.xlsx"
              onChange={handleDocPick}
              style={{ display: "none" }}
            />
            <button
              type="button"
              className={styles.btnPrimary}
              disabled={uploadBusy || !empId}
              onClick={() => docInputRef.current?.click()}
            >
              {uploadBusy ? "Uploading…" : "Choose file & upload"}
            </button>
            {uploadError && (
              <div className={styles.errorLine}>{uploadError}</div>
            )}
          </div>
        </div>

        {/* Document list */}
        <div className={styles.docList}>
          {docsLoading && (
            <div className={styles.emptyLine}>Loading…</div>
          )}

          {!docsLoading && docsError && (
            <div className={styles.emptyLine} style={{ color: "#b91c1c" }}>
              {docsError}
            </div>
          )}

          {!docsLoading && !docsError && docs.length === 0 && (
            <div className={styles.emptyLine}>
              No documents uploaded yet. Pick a type and file above to add your first one.
            </div>
          )}

          {docs.map((d) => {
            const id = d.ID ?? d.id;
            const label = DOC_TYPES.find((t) => t.value === d.DOC_TYPE)?.label
                        || d.DOC_TYPE
                        || "Document";
            const url = absoluteUrl(d.FILE_URL || d.file_url);
            return (
              <div key={id} className={styles.docRow}>
                <div className={styles.docIcon}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                       stroke="currentColor" strokeWidth="1.8"
                       strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                    <path d="M8 13h8M8 17h5" />
                  </svg>
                </div>
                <div className={styles.docBody}>
                  <div className={styles.docTitle}>{d.TITLE || d.title || label}</div>
                  <div className={styles.docMeta}>
                    <span className={styles.docPill}>{label}</span>
                    {(d.SIZE_BYTES || d.size_bytes) && (
                      <span>{humanSize(d.SIZE_BYTES || d.size_bytes)}</span>
                    )}
                    {(d.FILE_NAME || d.file_name) && (
                      <span className={styles.docFile}>{d.FILE_NAME || d.file_name}</span>
                    )}
                  </div>
                </div>
                <div className={styles.docActions}>
                  {url && (
                    <a href={url} target="_blank" rel="noreferrer"
                       className={styles.btnGhost}>View</a>
                  )}
                  <button
                    type="button"
                    className={styles.btnDanger}
                    onClick={() => setConfirmDelete({ id, title: d.TITLE || label })}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* ============ DELETE CONFIRM ============ */}
      {confirmDelete && (
        <div className={styles.modalOverlay} onClick={() => setConfirmDelete(null)}>
          <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
            <h3>Delete this document?</h3>
            <p>
              <b>{confirmDelete.title}</b> will be removed permanently. This can't be undone.
            </p>
            <div className={styles.modalActions}>
              <button className={styles.btnGhost} onClick={() => setConfirmDelete(null)}>
                Cancel
              </button>
              <button className={styles.btnDanger} onClick={() => handleDelete(confirmDelete.id)}>
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
