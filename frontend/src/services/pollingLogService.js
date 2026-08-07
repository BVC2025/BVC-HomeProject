import API from "./api";

const VENDOR_ID = 1;

export const pollingLogService = {
  getAll: (params = {}) =>
    API.get("/lead-management/polling-logs", { params: { vendor_id: VENDOR_ID, ...params } }),
};
