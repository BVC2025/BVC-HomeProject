import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  PageHeader, PMButton, PMModal, PMConfirmModal, EmptyState, Loader,
} from "../components/pm";
import { productionScheduleService } from "../services/productionScheduleService";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../hooks/useToast";
import { formatDateTime } from "../utils/formatDateTime";
import ProjectIcon from "../assets/Icons/projectIcon.webp";
import styles from "./ProductionScheduleApproval.module.css";

function Field({ label, value }) {
  return (
    <div className={styles.summaryField}>
      <span className={styles.summaryLabel}>{label}</span>
      <span className={styles.summaryValue}>{value}</span>
    </div>
  );
}

function durationLabel(days) {
  if (days == null) return "—";
  const n = Number(days);
  return `${n} day${n === 1 ? "" : "s"}`;
}

/** Production Schedule Approval — the deep-link target from the "Production
 * Schedule Approval Needed" email (review_url = {FRONTEND_URL}/production-
 * schedule/{id}). Shows one ProductionSchedule proposal in full and, while
 * PROPOSED, lets a permitted staff member Approve it or Reject it with a new
 * start date. Mirrors CustomerPayments.jsx's single-record review-card shape
 * (PageHeader + card + summary grid + status pill) for visual consistency. */
export default function ProductionScheduleApproval() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const toast = useToast();

  const canApprove = hasPermission("production_schedule.approve");
  const canReject = hasPermission("production_schedule.reject");

  const [schedule, setSchedule] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [confirmApproveOpen, setConfirmApproveOpen] = useState(false);
  const [approving, setApproving] = useState(false);

  const [rejectOpen, setRejectOpen] = useState(false);
  const [newStartDate, setNewStartDate] = useState("");
  const [rejectReason, setRejectReason] = useState("");
  const [rejecting, setRejecting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await productionScheduleService.getSchedule(id);
      setSchedule(res.data);
    } catch (e) {
      setError(e?.response?.data?.detail || "Unable to load this production schedule. It may not exist, or you may not have access.");
      setSchedule(null);
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const minDate = schedule?.suggested_start_date ? schedule.suggested_start_date.slice(0, 10) : "";
  const dateTooEarly = !!(newStartDate && minDate && newStartDate < minDate);

  const openReject = useCallback(() => {
    setNewStartDate(minDate || "");
    setRejectReason("");
    setRejectOpen(true);
  }, [minDate]);

  const handleApprove = useCallback(async () => {
    setApproving(true);
    try {
      const res = await productionScheduleService.approveSchedule(id);
      setSchedule(res.data);
      toast.showSuccess("Production schedule approved — tasks have been generated.");
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to approve this schedule.");
    } finally {
      setApproving(false);
    }
  }, [id, toast]);

  const handleReject = useCallback(async () => {
    if (!newStartDate) { toast.showWarning("Pick a new start date"); return; }
    if (dateTooEarly) { toast.showWarning(`New start date must be on or after ${minDate}`); return; }
    setRejecting(true);
    try {
      const res = await productionScheduleService.rejectSchedule(id, {
        new_start_date: newStartDate,
        reason: rejectReason.trim() || undefined,
      });
      setSchedule(res.data);
      toast.showSuccess("Production schedule rejected with a new start date.");
      setRejectOpen(false);
    } catch (e) {
      toast.showError(e?.response?.data?.detail || "Failed to reject this schedule.");
    } finally {
      setRejecting(false);
    }
  }, [id, newStartDate, rejectReason, dateTooEarly, minDate, toast]);

  const minDateHint = useMemo(() => {
    if (!schedule?.suggested_start_date) return "the suggested date";
    return formatDateTime(schedule.suggested_start_date);
  }, [schedule]);

  return (
    <div className={styles.page}>
      <PageHeader
        icon={ProjectIcon}
        iconAlt="Production Schedule Approval"
        title="Production Schedule Approval"
        subtitle="Review the auto-generated production schedule and approve it or choose a new start date"
      />

      <div className={styles.body}>
        {loading ? (
          <Loader />
        ) : error ? (
          <EmptyState
            icon={ProjectIcon}
            iconAlt="Production Schedule Approval"
            title="Unable to load this schedule"
            description={error}
          />
        ) : !schedule ? (
          <EmptyState
            icon={ProjectIcon}
            iconAlt="Production Schedule Approval"
            title="Schedule not found"
          />
        ) : (
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div className={styles.cardTitleBlock}>
                <span className={styles.cardProject}>{schedule.project_name || "—"}</span>
                <span className={styles.cardCustomer}>
                  {schedule.customer_name || "—"}
                  {schedule.company_name ? ` — ${schedule.company_name}` : ""}
                </span>
              </div>
              <span className={styles.statusPill} data-status={schedule.status}>{schedule.status}</span>
            </div>

            <div className={styles.summaryGrid}>
              <Field label="Quantity" value={schedule.quantity ?? "—"} />
              {schedule.lead_id && <Field label="Lead" value={schedule.lead_id} />}
              <Field label="Suggested Start Date" value={formatDateTime(schedule.suggested_start_date)} />
              <Field label="Estimated Completion Date" value={formatDateTime(schedule.estimated_completion_date)} />
              <Field label="Estimated Duration" value={durationLabel(schedule.estimated_duration_days)} />
              <Field label="Created" value={formatDateTime(schedule.created_at)} />
            </div>

            <div className={styles.reasonSection}>
              <div className={styles.sectionLabel}>Suggested Reason</div>
              <p className={styles.reasonText}>{schedule.suggested_reason || "—"}</p>
            </div>

            {schedule.status === "APPROVED" && (
              <div className={styles.decisionSection} data-tone="success">
                <div className={styles.sectionLabel}>Approved</div>
                <p>Approved by {schedule.approved_by_name || "—"} on {formatDateTime(schedule.approved_at)}.</p>
                {schedule.tasks_generated_at && (
                  <p className={styles.mutedNote}>Tasks generated at {formatDateTime(schedule.tasks_generated_at)}.</p>
                )}
              </div>
            )}

            {schedule.status === "REJECTED" && (
              <div className={styles.decisionSection} data-tone="danger">
                <div className={styles.sectionLabel}>Rejected</div>
                <p>Rejected by {schedule.rejected_by_name || "—"} on {formatDateTime(schedule.rejected_at)}.</p>
                {schedule.reject_reason && <p>Reason: {schedule.reject_reason}</p>}
                <p>New start date chosen: {formatDateTime(schedule.chosen_start_date)}</p>
              </div>
            )}

            {schedule.status === "PROPOSED" && (
              <div className={styles.actionsBar}>
                {canApprove && (
                  <PMButton variant="primary" onClick={() => setConfirmApproveOpen(true)} disabled={approving}>
                    {approving ? "Approving…" : "Approve"}
                  </PMButton>
                )}
                {canReject && (
                  <PMButton variant="outline" onClick={openReject} disabled={rejecting}>
                    Reject & Choose New Date
                  </PMButton>
                )}
                {!canApprove && !canReject && (
                  <p className={styles.mutedNote}>You do not have permission to act on this schedule.</p>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <PMConfirmModal
        open={confirmApproveOpen}
        onClose={() => setConfirmApproveOpen(false)}
        onConfirm={handleApprove}
        title="Approve Production Schedule"
        description="This locks in the proposed plan and generates the real assigned tasks. This cannot be undone."
        confirmLabel="Approve"
        cancelLabel="Cancel"
      />

      <PMModal
        open={rejectOpen}
        onClose={() => setRejectOpen(false)}
        title="Reject & Choose New Date"
        size="md"
        footer={
          <>
            <PMButton variant="outline" onClick={() => setRejectOpen(false)}>Cancel</PMButton>
            <PMButton variant="primary" onClick={handleReject} disabled={rejecting || !newStartDate || dateTooEarly}>
              {rejecting ? "Submitting…" : "Submit Rejection"}
            </PMButton>
          </>
        }
      >
        <div className={styles.formGroup}>
          <label>New Start Date <span className={styles.req}>*</span></label>
          <input
            type="date"
            className={styles.input}
            value={newStartDate}
            min={minDate || undefined}
            onChange={(e) => setNewStartDate(e.target.value)}
          />
          <p className={styles.hint}>
            Required employees are not available before {minDateHint} — choose this date or later.
          </p>
          {dateTooEarly && (
            <p className={styles.errorHint}>New start date must be on or after {minDate}.</p>
          )}
        </div>
        <div className={styles.formGroup}>
          <label>Reason (optional)</label>
          <textarea
            className={styles.textarea}
            rows={3}
            value={rejectReason}
            onChange={(e) => setRejectReason(e.target.value)}
            placeholder="Why is this schedule being rejected?"
          />
        </div>
      </PMModal>
    </div>
  );
}
