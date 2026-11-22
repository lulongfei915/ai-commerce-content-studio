import { useCallback, useRef, useState } from 'react';

import { ApiError } from '../../shared/api/client';

export type SaveState = 'saved' | 'saving' | 'error' | 'conflict';

export function useVersionedSave<T>(
  base: T,
  initialVersion: number,
  persist: (version: number, value: T) => Promise<{ version: number }>,
) {
  const [value, setValue] = useState(base);
  const [state, setState] = useState<SaveState>('saved');
  const version = useRef(initialVersion);
  const queued = useRef<{ value: T }>();
  const sending = useRef(false);
  const blocked = useRef(false);
  const persistRef = useRef(persist);
  persistRef.current = persist;

  const flush = useCallback(async () => {
    if (sending.current || blocked.current || !queued.current) return;
    sending.current = true;
    setState('saving');
    try {
      while (queued.current) {
        const job: { value: T } = queued.current;
        const saved = await persistRef.current(version.current, job.value);
        version.current = saved.version;
        if (queued.current === job) queued.current = undefined;
      }
      setState('saved');
    } catch (cause) {
      const conflict = cause instanceof ApiError && cause.status === 409;
      blocked.current = conflict;
      setState(conflict ? 'conflict' : 'error');
    } finally {
      sending.current = false;
    }
  }, []);

  const save = useCallback(
    (next: T) => {
      queued.current = { value: next };
      setValue(next);
      void flush();
    },
    [flush],
  );

  const reset = useCallback((next: T, revision: number) => {
    queued.current = undefined;
    blocked.current = false;
    version.current = revision;
    setValue(next);
    setState('saved');
  }, []);

  return { value, state, save, reset, retry: flush };
}
