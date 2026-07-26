import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const proxyPath = import.meta.env.VITE_API_PROXY as string | undefined;

if (!url || !anonKey) {
  console.warn(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Copy web/.env.example to web/.env.local'
  );
}

function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const parsed = new URL(requestUrl);
  const isAuth = parsed.pathname.startsWith('/auth/v1/');
  const type = isAuth ? 'auth' : 'rest';
  const apiPath = parsed.pathname.replace(isAuth ? '/auth/v1/' : '/rest/v1/', '');

  const proxyUrl = new URL(proxyPath!, window.location.origin);
  proxyUrl.searchParams.set('type', type);
  proxyUrl.searchParams.set('path', apiPath);
  parsed.searchParams.forEach((value, key) => {
    proxyUrl.searchParams.append(key, value);
  });

  return fetch(proxyUrl.toString(), init);
}

export const supabase: SupabaseClient = createClient(url ?? '', anonKey ?? '', {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
  },
  global: proxyPath
    ? {
        fetch: proxyFetch,
      }
    : undefined,
});
