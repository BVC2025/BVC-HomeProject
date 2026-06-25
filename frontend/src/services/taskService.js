import API from "./api";

const VENDOR_ID = 1;

export const taskService = {
  getByProject: (projectId) =>
    API.get(`/task-templates?project_id=${projectId}`),

  create: (data) =>
    API.post("/task-templates", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/task-templates/${id}`, data),

  remove: (id) =>
    API.delete(`/task-templates/${id}`),

  reorder: (items) =>
    API.patch("/task-templates/reorder", items),

  bulkCreate: (tasks) =>
    API.post("/task-templates/bulk-create", tasks),

  bulkUpload: (formData, sheetName = null) => {
    const qs = sheetName ? `?vendor_id=${VENDOR_ID}&sheet_name=${encodeURIComponent(sheetName)}` : `?vendor_id=${VENDOR_ID}`;
    return API.post(`/task-templates/bulk-upload${qs}`, formData);
  },
};
