import { memo, useCallback, useEffect, useState } from "react";
import { PMModal, PMButton, Loader } from "../pm";
import { leadService } from "../../services/leadService";
import { useToast } from "../../hooks/useToast";
import { formatDateTime } from "../../utils/formatDateTime";
import { API_BASE_URL } from "../../services/api";
import styles from "../../pages/ManualLeadManagement.module.css";

function absoluteUrl(path) {
  if (!path) return "";
  return path.startsWith("http") ? path : `${API_BASE_URL}${path}`;
}

/** Lead -> Purchase Order modal, opened two ways: the "View PO" row icon
 * (shown once the lead's status is PO_RECEIVED) and — via
 * ManualLeadManagement.jsx's Lead Status dropdown interception — selecting
 * "PO Received" for a lead that has no PO on file yet, whether or not a
 * Purchase Order Request was ever sent for it.
 *
 * Renders one of two states based on whether a file is already on record:
 * no file yet (no PO row at all, or a row exists from a PO Request send
 * but nothing was uploaded) -> an upload form (file required, comments
 * optional) is shown directly, no dead-end; a file already exists -> the
 * PDF preview + comments + a "Re-upload Purchase Order" action to replace
 * it. Both states submit through the same leadService.uploadPurchaseOrder
 * call — there is only one upload implementation.
 *
 * Mirrors LeadQuotationModal.jsx's shape: a single PMModal, a load-on-open
 * effect that intentionally omits the unstable `load`/`toast` callback
 * from its dependency array (see that file for why — useToast() returns a
 * new object every render, which would otherwise loop the loader
 * forever). */
export const LeadPurchaseOrderModal = memo(function LeadPurchaseOrderModal({ open, onClose, lead }) {
  const toast = useToast();
  const [po, setPo] = useState(null);
  const [loading, setLoading] = useState(false);

  const [reuploadOpen, setReuploadOpen] = useState(false);
  const [reuploadFile, setReuploadFile] = useState(null);
  const [reuploadComments, setReuploadComments] = useState("");
  const [reuploadError, setReuploadError] = useState("");
  const [reuploading, setReuploading] = useState(false);

  const load = useCallback(async () => {
    if (!lead) return;
    setLoading(true);
    try {
      const res = await leadService.getPurchaseOrder(lead.ID);
      setPo(res.data);
    } catch (e) {
      if (e?.response?.status === 404) {
        setPo(null); // no PO row yet at all — the upload form covers this the same as "row exists, no file"
      } else {
        toast.showError("Failed to load Purchase Order");
      }
    } finally {
      setLoading(false);
    }
  }, [lead, toast]);

  useEffect(() => {
    if (open) {
      setReuploadOpen(false);
      setReuploadFile(null);
      setReuploadComments("");
      setReuploadError("");
      load();
    }
    // `load` intentionally excluded — see LeadQuotationModal.jsx's identical
    // comment: it's a useCallback depending on the unstable `toast` object
    // useToast() recreates every render, and depending on it here would
    // re-fire this effect (and the loader) on every render while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, lead?.ID]);

  const hasFile = !!po?.FILE_URL;

  const handleReuploadSubmit = useCallback(async () => {
    if (!reuploadFile) {
      setReuploadError("Please choose a PDF file to upload.");
      return;
    }
    const wasFirstUpload = !hasFile;
    setReuploading(true);
    setReuploadError("");
    try {
      const fd = new FormData();
      fd.append("file", reuploadFile);
      if (reuploadComments.trim()) fd.append("comments", reuploadComments.trim());
      const res = await leadService.uploadPurchaseOrder(lead.ID, fd);
      toast.showSuccess(res.data?.message || (wasFirstUpload ? "Purchase Order received" : "Purchase Order re-uploaded"));
      setReuploadOpen(false);
      setReuploadFile(null);
      setReuploadComments("");
      load();
    } catch (e) {
      const detail = e?.response?.data?.detail;
      setReuploadError(typeof detail === "string" ? detail : "Failed to upload Purchase Order");
    } finally {
      setReuploading(false);
    }
  }, [lead, reuploadFile, reuploadComments, toast, load, hasFile]);

  const uploadForm = (
    <div className={styles.formGrid}>
      <div className={`${styles.formGroup} ${styles.fullWidth}`}>
        <label>Purchase Order File (PDF) <span className={styles.req}>*</span></label>
        <input
          type="file"
          accept="application/pdf,.pdf"
          onChange={(e) => setReuploadFile(e.target.files?.[0] || null)}
        />
      </div>
      <div className={`${styles.formGroup} ${styles.fullWidth}`}>
        <label>Comments</label>
        <textarea
          className={styles.textarea}
          rows={3}
          value={reuploadComments}
          onChange={(e) => setReuploadComments(e.target.value)}
          placeholder={hasFile ? "Optional — reason for re-upload, or notes from the customer…" : "Optional — e.g. how the Purchase Order was received"}
        />
      </div>
      {reuploadError && (
        <div className={`${styles.formGroup} ${styles.fullWidth}`}>
          <span className={styles.fieldError}>{reuploadError}</span>
        </div>
      )}
      <div className={`${styles.formGroup} ${styles.fullWidth}`}>
        {hasFile && (
          <>
            <PMButton variant="outline" onClick={() => setReuploadOpen(false)} disabled={reuploading}>
              Cancel
            </PMButton>{" "}
          </>
        )}
        <PMButton variant="primary" onClick={handleReuploadSubmit} disabled={reuploading}>
          {reuploading ? "Uploading…" : hasFile ? "Upload" : "Upload Purchase Order"}
        </PMButton>
      </div>
    </div>
  );

  return (
    <PMModal
      open={open}
      onClose={onClose}
      title={hasFile ? `Purchase Order — ${lead?.CONTACT_NAME || ""}` : `Receive Purchase Order — ${lead?.CONTACT_NAME || ""}`}
      size="lg"
    >
      {loading ? (
        <Loader />
      ) : !hasFile ? (
        <>
          <p className={styles.hint} style={{ marginBottom: "var(--sp-3)" }}>
            No Purchase Order is on file for this lead yet — upload the document the customer shared
            (by email, another channel, or with the request that was already sent) to mark it received.
          </p>
          {uploadForm}
        </>
      ) : (
        <>
          <iframe
            src={absoluteUrl(po.FILE_URL)}
            title="Purchase Order"
            className={styles.poPreviewFrame}
          />

          <div className={styles.formGrid} style={{ marginTop: "var(--sp-4)" }}>
            <div className={styles.formGroup}>
              <label>Quantity</label>
              <p>
                <span style={{
                  display: "inline-flex", alignItems: "center", gap: 6,
                  padding: "4px 14px", borderRadius: "999px",
                  background: "var(--clr-primary-light, #fee2e2)",
                  border: "1px solid var(--clr-primary-border, #fca5a5)",
                  color: "var(--clr-primary, #DC2626)",
                  fontWeight: 700, fontSize: "0.95rem",
                }}>
                  {po.QUANTITY ?? 1}
                </span>
              </p>
            </div>
            <div className={styles.formGroup}>
              <label>PO Status</label>
              <p>Received</p>
            </div>
            <div className={`${styles.formGroup} ${styles.fullWidth}`}>
              <label>Comments</label>
              <p>{po.COMMENTS || "No comments provided."}</p>
            </div>
            <div className={styles.formGroup}>
              <label>Uploaded</label>
              <p>{po.UPLOADED_AT ? formatDateTime(po.UPLOADED_AT) : "—"}</p>
            </div>
            <div className={styles.formGroup}>
              <label>Uploaded By</label>
              <p>{po.UPLOADED_BY_SOURCE === "STAFF" ? "Staff (on customer's behalf)" : "Customer"}</p>
            </div>
          </div>

          {!reuploadOpen ? (
            <div style={{ marginTop: "var(--sp-4)" }}>
              <PMButton variant="outline" onClick={() => setReuploadOpen(true)}>
                Re-upload Purchase Order
              </PMButton>
            </div>
          ) : (
            <div style={{ marginTop: "var(--sp-4)" }}>{uploadForm}</div>
          )}
        </>
      )}
    </PMModal>
  );
});
