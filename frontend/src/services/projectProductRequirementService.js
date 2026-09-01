import API from "./api";

export const projectProductRequirementService = {
  getByProject: (projectId) =>
    API.get(`/projects/${projectId}/product-requirements`),
};
