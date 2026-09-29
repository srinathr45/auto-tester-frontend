import { request } from '../../shared/http';
import type { Project } from '../../shared/types';

export const projectService = {
  getAll: () => request<Project[]>('/projects'),

  create: (data: { name: string; description?: string; url: string }) =>
    request<Project>('/projects', { method: 'POST', body: JSON.stringify(data) }),

  remove: (id: number) => request<void>(`/projects/${id}`, { method: 'DELETE' }),
};
