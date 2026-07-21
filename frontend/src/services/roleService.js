import API from "./api";

const VENDOR_ID = 1;

export const roleService = {
  getAll: (deptId = null) => {
    const qs = deptId ? `&dept_id=${deptId}` : "";
    return API.get(`/org-roles?vendor_id=${VENDOR_ID}${qs}`);
  },

  create: (data) =>
    API.post("/org-roles", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/org-roles/${id}`, data),

  remove: (id) =>
    API.delete(`/org-roles/${id}`),

  downloadTemplate: () =>
    API.get("/org-roles/bulk-upload/template", { responseType: "blob" }),

  bulkUpload: (formData, sheetName = null) => {
    const qs = sheetName ? `&sheet_name=${encodeURIComponent(sheetName)}` : "";
    return API.post(`/org-roles/bulk-upload?vendor_id=${VENDOR_ID}${qs}`, formData);
  },
};
