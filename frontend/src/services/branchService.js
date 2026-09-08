import API from "./api";

const VENDOR_ID = 1;

export const branchService = {
  getAll: (search) =>
    API.get(`/branches?vendor_id=${VENDOR_ID}${search ? `&search=${encodeURIComponent(search)}` : ""}`),

  create: (data) =>
    API.post("/branches", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/branches/${id}`, data),

  remove: (id) =>
    API.delete(`/branches/${id}`),
};
