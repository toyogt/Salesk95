export function getCachedOrFetch<T>(
  key: string,
  fetchFn: () => Promise<T>,
  ttlMs = 60_000
): Promise<T> {
  const raw = localStorage.getItem(key);
  if (raw) {
    try {
      const { data, timestamp } = JSON.parse(raw) as { data: T; timestamp: number };
      if (Date.now() - timestamp < ttlMs) return Promise.resolve(data);
    } catch {
      localStorage.removeItem(key);
    }
  }
  return fetchFn().then((data) => {
    localStorage.setItem(key, JSON.stringify({ data, timestamp: Date.now() }));
    return data;
  });
}

export function clearCachePrefix(prefix: string) {
  Object.keys(localStorage).forEach((key) => {
    if (key.startsWith(prefix)) localStorage.removeItem(key);
  });
}
