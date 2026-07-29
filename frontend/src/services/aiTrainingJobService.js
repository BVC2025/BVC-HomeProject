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

export const aiTrainingJobService = {
  getAll: (filters) => API.get(`/rag/training-jobs${toQuery(filters)}`),

  getById: (id) => API.get(`/rag/training-jobs/${id}`),
};
