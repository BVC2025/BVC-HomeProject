import API from "./api";

function toQuery(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      params.append(key, value);
    }
  });
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export const aiDocumentService = {
  getAll: (filters) => API.get(`/rag/documents${toQuery(filters)}`),

  getById: (id) => API.get(`/rag/documents/${id}`),

  downloadUrl: (id) => `/rag/documents/${id}/download`,

  upload: ({ file, moduleCode, title, description, tags, category }) => {
    const fd = new FormData();
    fd.append("file", file);
    fd.append("module_code", moduleCode);
    fd.append("title", title || "");
    fd.append("description", description || "");
    fd.append("tags", tags || "");
    fd.append("category", category || "");
    return API.post("/rag/documents/upload", fd);
  },

  replace: (id, file) => {
    const fd = new FormData();
    fd.append("file", file);
    return API.put(`/rag/documents/${id}/replace`, fd);
  },

  activate: (id) => API.patch(`/rag/documents/${id}/activate`),

  deactivate: (id) => API.patch(`/rag/documents/${id}/deactivate`),

  remove: (id) => API.delete(`/rag/documents/${id}`),

  retrain: (id) => API.post(`/rag/documents/${id}/retrain`),
};
