import API from "./api";

const VENDOR_ID = 1;

export const designationService = {
  getAll: (departmentId) =>
    API.get(`/designations?vendor_id=${VENDOR_ID}${departmentId ? `&department_id=${departmentId}` : ""}`),

  create: (data) =>
    API.post("/designations", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/designations/${id}`, data),

  remove: (id) =>
    API.delete(`/designations/${id}`),
};
