import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import TablePagination from "../components/TablePagination";
import {
  PageHeader, StatsRow, PMModal, PMSelect, SearchBar, EmptyState, Loader,
  PMButton, PMConfirmModal,
} from "../components/pm";
import { aiModuleService } from "../services/aiModuleService";
import { aiDocumentService } from "../services/aiDocumentService";
import { API_BASE_URL } from "../services/api";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import styles from "./AIPlatformShared.module.css";

const EMPTY_UPLOAD = { moduleCode: "", title: "", description: "", tags: "", category: "" };

const STATUS_BADGE = {
  PENDING: styles.badgePending,
  RUNNING: styles.badgeRunning,
  COMPLETED: styles.badgeCompleted,
  FAILED: styles.badgeFailed,
};

export default function AIKnowledgeBasePage() {
  const [modules, setModules] = useState([]);
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search, setSearch] = useState("");
  const [moduleFilter, setModuleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);

  const [uploadModal, setUploadModal] = useState(false);
  const [uploadForm, setUploadForm] = useState(EMPTY_UPLOAD);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef();

  const [replaceTarget, setReplaceTarget] = useState(null);
  const replaceFileRef = useRef();

  const [confirmModal, setConfirmModal] = useState(null);
  const [togglingId, setTogglingId] = useState(null);

  const toast = useToast();
  const fetchedRef = useRef(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    else setRefreshing(true);
    try {
      const [modRes, docRes] = await Promise.all([
        aiModuleService.getAll(),
        aiDocumentService.getAll(),
      ]);
      setModules(modRes.data || []);
      setDocs(docRes.data || []);
    } catch {
      toast.showError("Failed to load knowledge base");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    load();
  }, [load]);

  const handleRefresh = useCallback(() => load(true), [load]);

  const moduleOptions = useMemo(
    () => modules.map((m) => ({ value: m.ID, label: m.MODULE_NAME })),
    [modules]
  );

  const moduleCodeOptions = useMemo(
    () => modules.map((m) => ({ value: m.MODULE_CODE, label: m.MODULE_NAME })),
    [modules]
  );

  const categoryOptions = useMemo(() => {
    const set = new Set(docs.map((d) => d.DOCUMENT_CATEGORY).filter(Boolean));
    return Array.from(set).map((c) => ({ value: c, label: c }));
  }, [docs]);

  const filtered = useMemo(() => {
    let data = docs;
    if (search.trim()) {
      const t = search.toLowerCase();
      data = data.filter(
        (d) =>
          d.TITLE?.toLowerCase().includes(t) ||
          (d.DESCRIPTION || "").toLowerCase().includes(t) ||
          (d.DOCUMENT_TAGS || "").toLowerCase().includes(t)
      );
    }
    if (moduleFilter) data = data.filter((d) => d.MODULE_ID === moduleFilter);
    if (statusFilter) data = data.filter((d) => d.PROCESSING_STATUS === statusFilter);
    if (categoryFilter) data = data.filter((d) => d.DOCUMENT_CATEGORY === categoryFilter);
    if (filterFrom || filterTo) {
      const from = filterFrom ? new Date(filterFrom) : null;
      const to = filterTo ? new Date(filterTo) : null;
      data = data.filter((d) => {
        if (!d.CREATED_AT) return false;
        const dt = new Date(d.CREATED_AT);
        if (from && dt < from) return false;
        if (to && dt > to) return false;
        return true;
      });
    }
    return data;
  }, [docs, search, moduleFilter, statusFilter, categoryFilter, filterFrom, filterTo]);

  const paginated = useMemo(
    () => (pageSize === 0 ? filtered : filtered.slice((page - 1) * pageSize, page * pageSize)),
    [filtered, page, pageSize]
  );

  const stats = useMemo(() => [
    { value: docs.length, label: "Total Documents" },
    { value: docs.filter((d) => d.IS_ACTIVE).length, label: "Active" },
    { value: docs.filter((d) => d.PROCESSING_STATUS === "COMPLETED").length, label: "Trained" },
    { value: docs.filter((d) => d.PROCESSING_STATUS === "FAILED").length, label: "Failed" },
  ], [docs]);

  const openUpload = useCallback(() => {
    setUploadForm({ ...EMPTY_UPLOAD, moduleCode: modules[0]?.MODULE_CODE || "" });
    setUploadFile(null);
    setUploadModal(true);
  }, [modules]);

  const handleUpload = useCallback(async () => {
    if (!uploadFile) {
      toast.showWarning("Choose a file to upload");
      return;
    }
    if (!uploadForm.moduleCode) {
      toast.showWarning("Select an AI module");
      return;
    }
    setUploading(true);
    try {
      await aiDocumentService.upload({
        file: uploadFile,
        moduleCode: uploadForm.moduleCode,
        title: uploadForm.title,
        description: uploadForm.description,
        tags: uploadForm.tags,
        category: uploadForm.category,
      });
      toast.showSuccess("Document uploaded. Training started.");
      setUploadModal(false);
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [uploadFile, uploadForm, toast, load]);

  const handleReplaceFile = useCallback(async (e) => {
    const f = e.target.files[0];
    e.target.value = "";
    if (!f || !replaceTarget) return;
    try {
      await aiDocumentService.replace(replaceTarget.ID, f);
      toast.showSuccess("Document replaced. Re-training started.");
      load(true);
    } catch (err) {
      toast.showError(err?.response?.data?.detail || "Replace failed");
    } finally {
      setReplaceTarget(null);
    }
  }, [replaceTarget, toast, load]);

  const handleToggleActive = useCallback(async (doc) => {
    setTogglingId(doc.ID);
    try {
      if (doc.IS_ACTIVE) await aiDocumentService.deactivate(doc.ID);
      else await aiDocumentService.activate(doc.ID);
      toast.showSuccess(doc.IS_ACTIVE ? "Document deactivated" : "Document activated");
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Update failed");
    } finally {
      setTogglingId(null);
    }
  }, [toast, load]);

  const handleRetrain = useCallback(async (doc) => {
    try {
      await aiDocumentService.retrain(doc.ID);
      toast.showSuccess("Retraining started");
      load(true);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Retrain failed");
    }
  }, [toast, load]);

  const handleDelete = useCallback((doc) => {
    setConfirmModal({
      title: "Delete Document",
      description: `Delete "${doc.TITLE}"? This removes the file and its vectors. This cannot be undone.`,
      onConfirm: async () => {
        try {
          await aiDocumentService.remove(doc.ID);
          toast.showSuccess("Document deleted");
          load(true);
        } catch (e) {
          toast.showError(e?.response?.data?.detail || "Delete failed");
        }
      },
    });
  }, [toast, load]);

  const handleDownload = useCallback((doc) => {
    const token = localStorage.getItem("token");
    const url = `${API_BASE_URL}${aiDocumentService.downloadUrl(doc.ID)}`;
    // Open in a new tab; the browser will send the Authorization header
    // only for fetch/XHR, so we fetch-and-blob to keep auth working.
    fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
      .then((res) => res.blob())
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = doc.FILE_NAME || "document";
        a.click();
      })
      .catch(() => toast.showError("Download failed"));
  }, [toast]);

  const handleSearchChange = useCallback((v) => {
    setSearch(v);
    setPage(1);
  }, []);

  return (
    <div className={styles.page}>
      <PageHeader
        title="AI Knowledge Base"
        subtitle="Documents that train each AI Assistant's answers (SOPs, FAQs, policies, price lists...)"
        onRefresh={handleRefresh}
        refreshing={refreshing}
        actions={
          <PMButton variant="primary" onClick={openUpload} disabled={modules.length === 0}>
            Upload Document
          </PMButton>
        }
      />

      <StatsRow stats={stats} />

      <div className={styles.tableSection}>
        <div className={styles.toolbar}>
          <SearchBar value={search} onChange={handleSearchChange} placeholder="Search documents…" />
          <div className={styles.filterGroup}>
            <PMSelect
              options={moduleOptions}
              value={moduleFilter}
              onChange={setModuleFilter}
              placeholder="All modules"
              allowClear
              valueKey="value"
              labelKey="label"
              size="sm"
            />
            <PMSelect
              options={["PENDING", "RUNNING", "COMPLETED", "FAILED"]}
              value={statusFilter}
              onChange={setStatusFilter}
              placeholder="All statuses"
              allowClear
              size="sm"
            />
            <PMSelect
              options={categoryOptions}
              value={categoryFilter}
              onChange={setCategoryFilter}
              placeholder="All categories"
              allowClear
              size="sm"
            />
            <div className={styles.dateFilters}>
              <label className={styles.dateLabel}>From</label>
              <input type="datetime-local" className={styles.dateInput} value={filterFrom} onChange={(e) => { setFilterFrom(e.target.value); setPage(1); }} />
              <label className={styles.dateLabel}>To</label>
              <input type="datetime-local" className={styles.dateInput} value={filterTo} onChange={(e) => { setFilterTo(e.target.value); setPage(1); }} />
              {(filterFrom || filterTo) && (
                <button className={styles.clearFilter} onClick={() => { setFilterFrom(""); setFilterTo(""); }}>✕</button>
              )}
            </div>
          </div>
          <span className={styles.count}>{filtered.length} document{filtered.length !== 1 ? "s" : ""}</span>
        </div>

        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>#</th>
                <th>Title</th>
                <th>Module</th>
                <th>Category</th>
                <th>Status</th>
                <th>Chunks / Vectors</th>
                <th>Version</th>
                <th>Active</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={10}><Loader /></td></tr>
              ) : paginated.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState
                      title={search ? "No documents match your search" : "No documents yet"}
                      description={!search ? "Click 'Upload Document' to train an AI Assistant." : undefined}
                    />
                  </td>
                </tr>
              ) : (
                paginated.map((d, i) => (
                  <tr key={d.ID}>
                    <td className={styles.idx}>{(page - 1) * pageSize + i + 1}</td>
                    <td className={styles.nameCell}>{d.TITLE}</td>
                    <td>{d.MODULE_NAME}</td>
                    <td>{d.DOCUMENT_CATEGORY || <span className={styles.muted}>—</span>}</td>
                    <td>
                      <span className={STATUS_BADGE[d.PROCESSING_STATUS] || styles.badgePending}>
                        {d.PROCESSING_STATUS}
                      </span>
                      {d.PROCESSING_STATUS === "FAILED" && d.PROCESSING_ERROR && (
                        <div className={styles.muted} style={{ fontSize: "var(--font-xs)", marginTop: 4 }}>
                          {d.PROCESSING_ERROR.slice(0, 80)}
                        </div>
                      )}
                    </td>
                    <td>{d.TOTAL_CHUNKS} / {d.TOTAL_VECTORS}</td>
                    <td>v{d.VERSION}</td>
                    <td>
                      <span className={d.IS_ACTIVE ? styles.badgeActive : styles.badgeInactive}>
                        {d.IS_ACTIVE ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>{formatDateTime(d.CREATED_AT)}</td>
                    <td>
                      <div className={styles.rowActions}>
                        <button className={styles.iconBtn} title="Download" onClick={() => handleDownload(d)}>⬇</button>
                        <button className={styles.iconBtn} title="Replace file" onClick={() => { setReplaceTarget(d); replaceFileRef.current?.click(); }}>⇄</button>
                        <button className={styles.iconBtn} title="Retrain" onClick={() => handleRetrain(d)}>↻</button>
                        <button
                          className={d.IS_ACTIVE ? styles.toggleBtnActive : styles.toggleBtn}
                          onClick={() => handleToggleActive(d)}
                          disabled={togglingId === d.ID}
                          title={d.IS_ACTIVE ? "Deactivate" : "Activate"}
                        >
                          {togglingId === d.ID ? "…" : d.IS_ACTIVE ? "Deactivate" : "Activate"}
                        </button>
                        <button className={styles.iconBtnDanger} title="Delete" onClick={() => handleDelete(d)}>🗑</button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <TablePagination
          total={filtered.length}
          page={page}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        />
      </div>

      {/* Hidden input for the "Replace" row action */}
      <input ref={replaceFileRef} type="file" style={{ display: "none" }} onChange={handleReplaceFile} />

      {/* Upload Modal */}
      <PMModal
        open={uploadModal}
        onClose={() => setUploadModal(false)}
        title="Upload Document"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setUploadModal(false)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleUpload} disabled={uploading}>
              {uploading ? "Uploading…" : "Upload & Train"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formStack}>
          <div className={styles.formGroup}>
            <label>AI Module <span className={styles.req}>*</span></label>
            <PMSelect
              options={moduleCodeOptions}
              value={uploadForm.moduleCode}
              onChange={(v) => setUploadForm((f) => ({ ...f, moduleCode: v }))}
              placeholder="Select module"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Title</label>
            <input
              className={styles.input}
              value={uploadForm.title}
              onChange={(e) => setUploadForm((f) => ({ ...f, title: e.target.value }))}
              placeholder="e.g. Lead Assignment SOP"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Description</label>
            <textarea
              className={styles.textarea}
              value={uploadForm.description}
              onChange={(e) => setUploadForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
            />
          </div>
          <div className={styles.formGroup}>
            <label>Category</label>
            <input
              className={styles.input}
              value={uploadForm.category}
              onChange={(e) => setUploadForm((f) => ({ ...f, category: e.target.value }))}
              placeholder="e.g. SOP, FAQ, Policy"
            />
          </div>
          <div className={styles.formGroup}>
            <label>Tags</label>
            <input
              className={styles.input}
              value={uploadForm.tags}
              onChange={(e) => setUploadForm((f) => ({ ...f, tags: e.target.value }))}
              placeholder="Comma-separated, e.g. leads, indiamart, onboarding"
            />
          </div>
          <div className={styles.formGroup}>
            <label>File <span className={styles.req}>*</span></label>
            <div className={styles.dropzone} onClick={() => fileRef.current?.click()}>
              <span>{uploadFile ? uploadFile.name : "Click to browse (.pdf, .docx, .txt, .md, .csv, .xlsx)"}</span>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.docx,.txt,.md,.csv,.xlsx"
              style={{ display: "none" }}
              onChange={(e) => setUploadFile(e.target.files[0] || null)}
            />
          </div>
        </div>
      </PMModal>

      <PMConfirmModal
        open={!!confirmModal}
        onClose={() => setConfirmModal(null)}
        onConfirm={confirmModal?.onConfirm ?? (() => {})}
        title={confirmModal?.title}
        description={confirmModal?.description}
        confirmLabel="Delete"
        cancelLabel="Cancel"
      />
    </div>
  );
}
