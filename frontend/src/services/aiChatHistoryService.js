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

export const aiChatHistoryService = {
  getAll: (filters) => API.get(`/rag/chat-history${toQuery(filters)}`),
};
