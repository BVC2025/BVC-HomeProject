import API from "./api";

const VENDOR_ID = 1;

export const emailSendRuleService = {
  getAll: () =>
    API.get(`/email-send-rules?vendor_id=${VENDOR_ID}`),

  getByEvent: (eventType) =>
    API.get(`/email-send-rules/${eventType}?vendor_id=${VENDOR_ID}`),

  update: (eventType, body) =>
    API.put(`/email-send-rules/${eventType}?vendor_id=${VENDOR_ID}`, body),
};
