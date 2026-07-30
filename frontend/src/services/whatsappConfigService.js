import API from "./api";

const VENDOR_ID = 1;

function _sanitize(data) {
  const out = { ...data };
  ["MAX_SEND_PER_SECOND", "DAILY_SEND_CAP"].forEach((key) => {
    if (out[key] === "" || out[key] === undefined) {
      delete out[key];
    } else if (out[key] !== null) {
      out[key] = Number(out[key]);
    }
  });
  return out;
}

export const whatsappConfigService = {
  getAll: (search = "") =>
    API.get(`/whatsapp-config?vendor_id=${VENDOR_ID}${search ? `&search=${encodeURIComponent(search)}` : ""}`),

  get: (id) =>
    API.get(`/whatsapp-config/${id}`),

  create: (data) =>
    API.post(`/whatsapp-config?vendor_id=${VENDOR_ID}`, _sanitize(data)),

  update: (id, data) =>
    API.put(`/whatsapp-config/${id}`, _sanitize(data)),

  remove: (id) =>
    API.delete(`/whatsapp-config/${id}`),

  activate: (id) =>
    API.post(`/whatsapp-config/${id}/activate`),

  deactivate: (id) =>
    API.post(`/whatsapp-config/${id}/deactivate`),

  testConnection: (id) =>
    API.post(`/whatsapp-config/${id}/test-connection`),

  listTemplates: (id) =>
    API.get(`/whatsapp-config/${id}/templates`),

  sendTest: (id, data) =>
    API.post(`/whatsapp-config/${id}/send-test`, data),

  resume: (id) =>
    API.post(`/whatsapp-config/${id}/resume`),
};
