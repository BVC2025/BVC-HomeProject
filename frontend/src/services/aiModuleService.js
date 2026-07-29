import API from "./api";

export const aiModuleService = {
  getAll: () => API.get("/rag/modules"),

  update: (id, data) => {
    const fd = new FormData();
    if (data.DESCRIPTION !== undefined) fd.append("description", data.DESCRIPTION ?? "");
    if (data.LLM_MODEL !== undefined) fd.append("llm_model", data.LLM_MODEL ?? "");
    if (data.IS_ACTIVE !== undefined) fd.append("is_active", data.IS_ACTIVE);
    return API.put(`/rag/modules/${id}`, fd);
  },

  deactivate: (id) => API.delete(`/rag/modules/${id}`),

  getSettings: () => API.get("/rag/settings"),
};
