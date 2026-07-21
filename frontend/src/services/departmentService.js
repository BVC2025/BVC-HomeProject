import API from "./api";

const VENDOR_ID = 1;

export const departmentService = {
  getAll: () =>
    API.get(`/departments?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post("/departments", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/departments/${id}`, data),

  remove: (id) =>
    API.delete(`/departments/${id}`),

  downloadTemplate: () =>
    API.get("/departments/bulk-upload/template", { responseType: "blob" }),

  bulkUpload: (formData, sheetName = null) => {
    const qs = sheetName ? `&sheet_name=${encodeURIComponent(sheetName)}` : "";
    return API.post(`/departments/bulk-upload?vendor_id=${VENDOR_ID}${qs}`, formData);
  },
};
