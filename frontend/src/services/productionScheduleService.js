import API from "./api";

/**
 * Wraps the Automatic Production Scheduling backend contracts:
 *  - Production Schedule proposals (payment-milestone-triggered) and their
 *    Approve/Reject workflow.
 *  - The read-only Customer Project Task Timeline (Gantt chart data source),
 *    generated once a schedule is approved.
 *
 * See backend contract in the feature spec — paths/fields are used exactly
 * as documented there, no invented alternatives.
 */
export const productionScheduleService = {
  // params: { status, vendor_id } — both optional.
  listSchedules: (params = {}) =>
    API.get("/production-schedules", { params }),

  getSchedule: (id) =>
    API.get(`/production-schedules/${id}`),

  approveSchedule: (id) =>
    API.post(`/production-schedules/${id}/approve`),

  // data: { new_start_date: "YYYY-MM-DD", reason?: string }
  rejectSchedule: (id, data) =>
    API.post(`/production-schedules/${id}/reject`, data),

  // Manually (re)trigger proposal generation for an assignment that doesn't
  // have a schedule yet.
  generateSchedule: (assignmentId) =>
    API.post("/production-schedules/generate", { assignment_id: assignmentId }),

  // params: assignment_id, customer_id, project_id, employee_id, department_id,
  // role_id, status, project_unit_number, date_from, date_to — all optional,
  // combined with AND.
  listCustomerProjectTasks: (params = {}) =>
    API.get("/customer-project-tasks", { params }),
};
