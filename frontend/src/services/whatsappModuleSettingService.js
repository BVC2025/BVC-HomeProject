import API from "./api";

const VENDOR_ID = 1;
const MODULE_CODE = "lead_module";

export const whatsappModuleSettingService = {
  getForLeadModule: () =>
    API.get(`/whatsapp-module-settings/by-module?vendor_id=${VENDOR_ID}&module_code=${MODULE_CODE}`),

  create: (data) =>
    API.post(`/whatsapp-module-settings?vendor_id=${VENDOR_ID}`, { ...data, MODULE_CODE }),

  update: (id, data) =>
    API.put(`/whatsapp-module-settings/${id}`, data),

  // ── Generic full-CRUD methods for the WhatsApp Module Settings admin page ──
  // (any MODULE_CODE, not just "lead_module") — additive only, the three
  // methods above stay exactly as they were for LeadManagementConfig.jsx.
  getAll: (vendorId = VENDOR_ID) =>
    API.get(`/whatsapp-module-settings?vendor_id=${vendorId}`),

  get: (id) =>
    API.get(`/whatsapp-module-settings/${id}`),

  remove: (id) =>
    API.delete(`/whatsapp-module-settings/${id}`),

  // `create` above always injects MODULE_CODE="lead_module" — wrong for a
  // page where the admin types an arbitrary module code, hence this sibling.
  createForModule: (moduleCode, data, vendorId = VENDOR_ID) =>
    API.post(`/whatsapp-module-settings?vendor_id=${vendorId}`, { ...data, MODULE_CODE: moduleCode }),
};
