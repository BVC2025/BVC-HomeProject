import API from "./api";

const VENDOR_ID = 1;

export const categoryService = {
  getAll: () =>
    API.get(`/project-categories?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post("/project-categories", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/project-categories/${id}`, data),

  remove: (id) =>
    API.delete(`/project-categories/${id}`),
};
