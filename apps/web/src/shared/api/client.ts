export const apiPrefix = import.meta.env.VITE_API_PREFIX ?? '/api/v1';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code?: string,
  ) {
    super(`API request failed with status ${status}`);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (typeof init?.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const response = await fetch(`${apiPrefix}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  });
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null);
    const detail = body && typeof body === 'object' && 'detail' in body ? body.detail : undefined;
    const code =
      typeof detail === 'string'
        ? detail
        : detail &&
            typeof detail === 'object' &&
            'code' in detail &&
            typeof detail.code === 'string'
          ? detail.code
          : undefined;
    throw new ApiError(response.status, code);
  }
  return response.json() as Promise<T>;
}

export async function apiDelete(path: string, csrfToken: string): Promise<void> {
  const response = await fetch(`${apiPrefix}${path}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'X-CSRF-Token': csrfToken },
  });
  if (!response.ok) throw new ApiError(response.status);
}
