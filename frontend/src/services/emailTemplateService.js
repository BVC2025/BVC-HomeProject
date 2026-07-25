import API from "./api";

const VENDOR_ID = 1;

export const emailTemplateService = {
  getAll:    ()           => API.get(`/email-templates?vendor_id=${VENDOR_ID}`),
  getByType: (type)       => API.get(`/email-templates/${type}?vendor_id=${VENDOR_ID}`),
  update:    (type, data) => API.put(`/email-templates/${type}?vendor_id=${VENDOR_ID}`, data),
  preview:   (data)       => API.post(`/email-templates/preview?vendor_id=${VENDOR_ID}`, data),
};
