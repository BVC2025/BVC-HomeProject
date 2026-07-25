import API from "./api";

const VENDOR_ID = 1;

export const inventoryItemService = {
  // ── Inventory Items ──────────────────────────────────────────
  getAll: (params = {}) =>
    API.get("/api/inventory-items", { params: { vendor_id: VENDOR_ID, ...params } }),

  create: (data) =>
    API.post("/api/inventory-items", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/api/inventory-items/${id}`, data),

  remove: (id) =>
    API.delete(`/api/inventory-items/${id}`),

  getDetail: (id) =>
    API.get(`/api/inventory-items/${id}`),

  getStock: (id) =>
    API.get(`/api/inventory-items/${id}/stock`),

  getLowStock: () =>
    API.get(`/api/inventory-items/low-stock?vendor_id=${VENDOR_ID}`),

  getOutOfStock: () =>
    API.get(`/api/inventory-items/out-of-stock?vendor_id=${VENDOR_ID}`),

  // ── Stock Operations ─────────────────────────────────────────
  stockIn: (data) =>
    API.post("/api/inventory-items/stock-in", { ...data, VENDOR_ID }),

  stockOut: (data) =>
    API.post("/api/inventory-items/stock-out", { ...data, VENDOR_ID }),

  stockAdjust: (data) =>
    API.post("/api/inventory-items/stock-adjust", { ...data, VENDOR_ID }),

  stockTransfer: (data) =>
    API.post("/api/inventory-items/stock-transfer", { ...data, VENDOR_ID }),

  // ── Bulk / Export ────────────────────────────────────────────
  bulkUpload: (formData) =>
    API.post(`/api/inventory-items/bulk-upload?vendor_id=${VENDOR_ID}`, formData),

  downloadTemplate: () =>
    API.get("/api/inventory-items/bulk-template", { responseType: "blob" }),

  exportExcel: () =>
    API.get("/api/inventory-items/export/excel", { responseType: "blob" }),

  // ── Movements ────────────────────────────────────────────────
  getMovements: (params = {}) =>
    API.get("/api/inventory-movements", { params: { vendor_id: VENDOR_ID, ...params } }),

  getItemMovements: (itemId) =>
    API.get(`/api/inventory-movements/${itemId}/history`),

  exportMovements: () =>
    API.get("/api/inventory-movements/export/excel", {
      params: { vendor_id: VENDOR_ID },
      responseType: "blob",
    }),

  // ── Batches ──────────────────────────────────────────────────
  getBatches: (params = {}) =>
    API.get("/api/inventory-batches", { params: { vendor_id: VENDOR_ID, ...params } }),

  createBatch: (data) =>
    API.post("/api/inventory-batches", { ...data, VENDOR_ID }),

  updateBatch: (id, data) =>
    API.put(`/api/inventory-batches/${id}`, data),

  getExpiringBatches: (days = 30) =>
    API.get(`/api/inventory-batches/expiring-soon?days=${days}&vendor_id=${VENDOR_ID}`),
};
