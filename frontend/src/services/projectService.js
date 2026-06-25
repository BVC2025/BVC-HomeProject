import API from "./api";

const VENDOR_ID = 1;

export const projectService = {
  getAll: () =>
    API.get(`/projects?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post("/projects", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/projects/${id}`, data),

  remove: (id) =>
    API.delete(`/projects/${id}`),

  parseBom: (formData, sheetName = null) => {
    const qs = sheetName ? `?sheet_name=${encodeURIComponent(sheetName)}` : "";
    return API.post(`/projects/parse-bom${qs}`, formData);
  },
};
