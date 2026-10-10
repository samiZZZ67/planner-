/**
 * API Client Utility
 * Automatically handles NEXT_PUBLIC_API_URL resolution, cross-origin credentials,
 * and Bearer token authentication so phone and PC can communicate with the backend.
 */

export function getApiUrl(path: string): string {
  let base = (process.env.NEXT_PUBLIC_API_URL || '').trim();

  // Allow client-side runtime override if saved in localStorage
  if (typeof window !== 'undefined' && !base) {
    const customApi = localStorage.getItem('np_custom_api_url');
    if (customApi) {
      base = customApi.trim();
    }
  }

  base = base.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return base ? `${base}${cleanPath}` : cleanPath;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const url = getApiUrl(path);
  const headers = new Headers(options.headers || {});

  // Attach session token as Bearer header if present in localStorage
  if (typeof window !== 'undefined') {
    try {
      const token = localStorage.getItem('np_session_token');
      if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
    } catch {
      // Storage access may be restricted in some embedded webviews
    }
  }

  const finalOptions: RequestInit = {
    ...options,
    headers,
    credentials: options.credentials || 'include',
  };

  return fetch(url, finalOptions);
}
