import { useEffect, useState } from 'react';

export type SearchLoader<T> = (
  query: string,
  cursor: string | null,
  signal: AbortSignal,
) => Promise<{ items: T[]; next_cursor?: string | null }>;

export function useSearchPage<T>(load: SearchLoader<T>, revision = 0) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<T[]>([]);
  const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const request = new AbortController();
    void load(query, cursor, request.signal)
      .then((result) => {
        if (request.signal.aborted) return;
        setItems(result.items);
        setNext(result.next_cursor ?? null);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!request.signal.aborted) setLoading(false);
      });
    return () => request.abort();
  }, [load, query, cursor, retry, revision]);

  return {
    items,
    next,
    loading,
    error,
    search(value: string) {
      const term = value.trim();
      if (term === query && !cursor) return;
      setLoading(true);
      setError(false);
      setNext(null);
      setItems([]);
      setCursor(null);
      setQuery(term);
    },
    more() {
      setLoading(true);
      setError(false);
      setCursor(next);
    },
    first() {
      setLoading(true);
      setError(false);
      setCursor(null);
    },
    hasPrevious: cursor !== null,
    reload() {
      setLoading(true);
      setError(false);
      setNext(null);
      setItems([]);
      setCursor(null);
      setRetry((value) => value + 1);
    },
  };
}
