import API from "./api";

const VENDOR_ID = 1;

export const customFieldService = {
  getFields: (tableName) =>
    API.get(`/custom-fields?table_name=${tableName}&vendor_id=${VENDOR_ID}`),

  createField: (data) =>
    API.post("/custom-fields", { ...data, VENDOR_ID }),

  updateField: (id, data) =>
    API.put(`/custom-fields/${id}`, data),

  deleteField: (id) =>
    API.delete(`/custom-fields/${id}`),

  getValues: (tableName, rowId) =>
    API.get(`/custom-field-values?table_name=${tableName}&row_id=${rowId}`),

  getAllValues: (tableName) =>
    API.get(`/custom-field-values?table_name=${tableName}`),

  upsertValue: (data) =>
    API.post("/custom-field-values", data),

  deleteValue: (id) =>
    API.delete(`/custom-field-values/${id}`),
};
