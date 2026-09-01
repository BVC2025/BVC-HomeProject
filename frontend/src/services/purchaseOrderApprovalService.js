import API from "./api";

/**
 * Wraps the low-stock reorder Purchase Order Approval Batch backend
 * contracts (inventory_reorder_service.evaluate_and_propose_reorder ->
 * purchase_order_approval_service.approve_batch/reject_batch), mirroring
 * productionScheduleService.js's shape for the equivalent workflow.
 */
export const purchaseOrderApprovalService = {
  // params: { status, vendor_id } — both optional.
  listBatches: (params = {}) =>
    API.get("/purchase-order-approvals", { params }),

  getBatch: (id) =>
    API.get(`/purchase-order-approvals/${id}`),

  approveBatch: (id) =>
    API.post(`/purchase-order-approvals/${id}/approve`),

  // data: { reason?: string }
  rejectBatch: (id, data = {}) =>
    API.post(`/purchase-order-approvals/${id}/reject`, data),

  // Manually (re)trigger the low-stock scan on demand.
  evaluateReorder: (data = {}) =>
    API.post("/purchase-order-approvals/evaluate", data),
};
