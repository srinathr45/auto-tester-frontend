import { request } from '../../shared/http';
import type { Flow, FlowGraph } from '../../shared/types';

export const flowService = {
  getByProject: (projectId: number) =>
    request<Flow[]>(`/flows?projectId=${projectId}`),

  getById: (id: number) => request<Flow>(`/flows/${id}`),

  create: (data: {
    projectId: number;
    name: string;
    description?: string;
    steps?: FlowGraph;
  }) => request<Flow>('/flows', { method: 'POST', body: JSON.stringify(data) }),

  update: (
    id: number,
    data: Partial<{ name: string; description: string; steps: FlowGraph }>,
  ) => request<Flow>(`/flows/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

  remove: (id: number) => request<void>(`/flows/${id}`, { method: 'DELETE' }),
};
