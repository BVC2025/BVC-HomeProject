import API from "./api";

const VENDOR_ID = 1;

export const employeeService = {
  getAll: ({ departmentId, roleId, status = "ACTIVE", vendorId = VENDOR_ID } = {}) => {
    const params = { vendor_id: vendorId, status };
    if (departmentId) params.department_id = departmentId;
    if (roleId) params.role_id = roleId;
    return API.get("/employees", { params });
  },
};
