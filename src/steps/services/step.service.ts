import { request } from '../../shared/http';
import type { Step } from '../../shared/types';

/**
 * Step search is derived from flow graphs in MinIO (no separate steps table).
 */
export const stepService = {
  search: (params: { projectId: number; name: string }) =>
    request<Step[]>(
      `/flows?projectId=${params.projectId}&name=${encodeURIComponent(params.name)}`,
    ),
};
