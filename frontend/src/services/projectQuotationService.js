import API from "./api";

export const projectQuotationService = {
  getByProject: (projectId) =>
    API.get(`/projects/${projectId}/quotation`),

  update: (projectId, data) =>
    API.put(`/projects/${projectId}/quotation`, data),

  uploadImage: (projectId, formData) =>
    API.post(`/projects/${projectId}/quotation/upload-image`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    }),

  downloadPdf: (projectId) =>
    API.get(`/projects/${projectId}/quotation/pdf`, { responseType: "blob" }),

  downloadDocx: (projectId) =>
    API.get(`/projects/${projectId}/quotation/docx`, { responseType: "blob" }),
};
