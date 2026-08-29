import API from "./api";

const VENDOR_ID = 1;

export const leadModuleSettingService = {
  get: () =>
    API.get(`/lead-management/module-setting?vendor_id=${VENDOR_ID}`),

  update: (data) =>
    API.put(`/lead-management/module-setting?vendor_id=${VENDOR_ID}`, data),
};
