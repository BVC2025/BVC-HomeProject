import API from "./api";

export const taskGroupService = {
  getByProject: (projectId) =>
    API.get(`/projects/${projectId}/task-groups`),

  create: (projectId, data) =>
    API.post(`/projects/${projectId}/task-groups`, data),

  update: (projectId, groupId, data) =>
    API.put(`/projects/${projectId}/task-groups/${groupId}`, data),

  remove: (projectId, groupId) =>
    API.delete(`/projects/${projectId}/task-groups/${groupId}`),
};
