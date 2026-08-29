import API from "./api";

const VENDOR_ID = 1;

export const paymentMilestoneService = {
  getAll: () =>
    API.get(`/payment-milestones?vendor_id=${VENDOR_ID}`),

  create: (data) =>
    API.post("/payment-milestones", { ...data, VENDOR_ID }),

  update: (id, data) =>
    API.put(`/payment-milestones/${id}`, data),

  remove: (id) =>
    API.delete(`/payment-milestones/${id}`),

  reorder: (items) =>
    API.patch("/payment-milestones/reorder", items),
};
