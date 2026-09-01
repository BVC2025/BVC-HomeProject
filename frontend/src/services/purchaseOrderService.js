import API from "./api";

/**
 * Wraps the Phase 4 Purchase Order backend contracts (routes/purchase_
 * order.py) used by the manual PO creation flow on /inventory (spec
 * Part 17). Full PO CRUD/GRN/activity already exists server-side —
 * this is only the thin client, mirroring productionScheduleService.js's
 * shape.
 */
export const purchaseOrderService = {
  // params: { status, supplier_id, project_id, vendor_id } — all optional.
  list: (params = {}) =>
    API.get("/purchase-orders", { params }),

  get: (id) =>
    API.get(`/purchase-orders/${id}`),

  // data: { SUPPLIER_ID, PO_DATE?, EXPECTED_DELIVERY_DATE?, DISCOUNT_PERCENT?,
  // TAX_PERCENT?, DELIVERY_ADDRESS?, TERMS_AND_CONDITIONS?, NOTES?,
  // PREPARED_BY?, VENDOR_ID?, LINES: [{PRODUCT_ID?, DESCRIPTION, HSN_CODE?,
  // QUANTITY, UNIT?, UNIT_PRICE, DISCOUNT_PERCENT?, SORT_ORDER?}] }
  create: (data) =>
    API.post("/purchase-orders", data),

  send: (id) =>
    API.post(`/purchase-orders/${id}/send`),
};
