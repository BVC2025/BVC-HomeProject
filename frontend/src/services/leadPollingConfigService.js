import API from "./api";

const VENDOR_ID = 1;

function _sanitize(data) {
  const out = { ...data };
  if (out.POLL_INTERVAL_MINUTES === "" || out.POLL_INTERVAL_MINUTES === undefined) {
    out.POLL_INTERVAL_MINUTES = null;
  } else if (out.POLL_INTERVAL_MINUTES !== null) {
    out.POLL_INTERVAL_MINUTES = Number(out.POLL_INTERVAL_MINUTES);
  }
  return out;
}

export const leadPollingConfigService = {
  getAll: (search = "") =>
    API.get(`/lead-management/configs?vendor_id=${VENDOR_ID}${search ? `&search=${encodeURIComponent(search)}` : ""}`),

  get: (id) =>
    API.get(`/lead-management/configs/${id}`),

  create: (data) =>
    API.post(`/lead-management/configs?vendor_id=${VENDOR_ID}`, { ..._sanitize(data), VENDOR_ID }),

  update: (id, data) =>
    API.put(`/lead-management/configs/${id}`, _sanitize(data)),

  remove: (id) =>
    API.delete(`/lead-management/configs/${id}`),

  activate: (id) =>
    API.post(`/lead-management/configs/${id}/activate`),

  deactivate: (id) =>
    API.post(`/lead-management/configs/${id}/deactivate`),

  syncNow: (id) =>
    API.post(`/lead-management/configs/${id}/sync-now`),

  previewLeads: (params) =>
    API.post("/lead-management/live-preview", params),
};
