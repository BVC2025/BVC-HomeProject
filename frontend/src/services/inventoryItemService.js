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

  // stock-transfer was removed from the backend — a location-to-location
  // transfer doesn't make sense without InventoryItem's location
  // dimension (see inventory_items.py's module docstring). Deliberately
  // not reintroduced here.

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

  getMovementDetails: (id) =>
    API.get(`/api/inventory-movements/${id}/details`),

  exportMovements: () =>
    API.get("/api/inventory-movements/export/excel", {
      params: { vendor_id: VENDOR_ID },
      responseType: "blob",
    }),

  // ── Batches ──────────────────────────────────────────────────
  getBatches: (params = {}) =>
    API.get("/api/inventory-batches", { params: { vendor_id: VENDOR_ID, ...params } }),

  getBatchDetails: (id) =>
    API.get(`/api/inventory-batches/${id}/details`),

  // Multipart — Batch Number is generated server-side, and DC/Invoice are
  // real file uploads now (see inventory_batches.py's create_batch).
  // `data` carries lowercase Form field names matching the backend
  // signature exactly (vendor_id, product_id, supplier_id, ...).
  createBatch: (data, dcFile, invoiceFile) => {
    const fd = new FormData();
    Object.entries({ vendor_id: VENDOR_ID, ...data }).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") fd.append(k, v);
    });
    if (dcFile) fd.append("dc_file", dcFile);
    if (invoiceFile) fd.append("invoice_file", invoiceFile);
    return API.post("/api/inventory-batches", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
  },

  updateBatch: (id, data) =>
    API.put(`/api/inventory-batches/${id}`, data),

  getExpiringBatches: (days = 30) =>
    API.get(`/api/inventory-batches/expiring-soon?days=${days}&vendor_id=${VENDOR_ID}`),

  getProductSuppliers: (productId) =>
    API.get(`/api/inventory-batches/products/${productId}/suppliers`, { params: { vendor_id: VENDOR_ID } }),

  getAllSuppliers: () =>
    API.get("/api/inventory-batches/suppliers", { params: { vendor_id: VENDOR_ID } }),

  viewBatchFile: (batchId, kind) =>
    API.get(`/api/inventory-batches/${batchId}/file/${kind}`, { responseType: "blob" }),
};
