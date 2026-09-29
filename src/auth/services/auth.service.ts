import { request } from '../../shared/http';
import {
  clearAuthSession,
  setAuthSession,
  type AuthSession,
} from '../authSession';

export type OrgUser = {
  id: number;
  name: string;
  email: string;
  organizationId: number | null;
};

/**
 * Login / register against Nest auth endpoints and store the JWT session.
 */
export const authService = {
  registerOrganization: async (data: {
    name: string;
    email: string;
    password: string;
  }): Promise<AuthSession> => {
    const session = await request<AuthSession>('/auth/register/organization', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthSession(session);
    return session;
  },

  /** Single portal — always authenticates as a user. */
  login: async (data: {
    email: string;
    password: string;
  }): Promise<AuthSession> => {
    const session = await request<AuthSession>('/auth/login', {
      method: 'POST',
      body: JSON.stringify(data),
    });
    setAuthSession(session);
    return session;
  },

  logout: () => {
    clearAuthSession();
  },

  listUsers: () => request<OrgUser[]>('/users'),

  createUser: (data: { name: string; email: string; password: string }) =>
    request<OrgUser>('/users', { method: 'POST', body: JSON.stringify(data) }),

  deleteUser: (id: number) =>
    request<{ ok: boolean }>(`/users/${id}`, { method: 'DELETE' }),
};
