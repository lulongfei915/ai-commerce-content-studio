import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { apiFetch } from '../../shared/api/client';
import { Modal } from '../../shared/ui/Modal';
import { draftWrite, actionError, type Draft } from './api';
import { resultPreview, type TaskResult } from './results';

export function CompanyAssetPicker({
  draft,
  token,
  onSaved,
  children,
  disabled,
}: {
  draft: Draft;
  token: string;
  onSaved: (draft: Draft) => void;
  children?: ReactNode;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<TaskResult[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    const ctl = new AbortController();
    void apiFetch<TaskResult[]>(
      `/assets?status=approved&product_id=${encodeURIComponent(draft.product_id)}`,
      { signal: ctl.signal },
    )
      .then((data) => {
        if (!ctl.signal.aborted) setItems(data);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    return () => ctl.abort();
  }, [open, draft.product_id]);
  return (
    <>
      <button type="button" disabled={disabled} title="公司资产" aria-label="公司资产"
        onClick={() => setOpen(true)}>
        {children ?? '公司资产'}
      </button>
      {open && (
        <Modal title="引用公司资产" busy={busy} onClose={() => setOpen(false)}>
          <label>
            检索文件或来源任务
            <input value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <ul>
            {items
              .filter((a) => a.media === 'image' && `${a.label} ${a.task_id}`.includes(query))
              .map((a) => (
                <li key={a.version_id}>
                  {a.file_version && (
                    <img
                      width={80}
                      src={resultPreview(a.task_id, a.version_id, a.file_version, a.version)}
                      alt={a.label}
                    />
                  )}
                  <span>
                    {a.label} · V{a.version} · {a.task_id}
                  </span>
                  <button
                    disabled={busy || !a.referenceable || a.creation_id === draft.id}
                    onClick={() => {
                      setBusy(true);
                      void draftWrite(draft, token, '/references', {
                        kind: 'result',
                        source_id: a.version_id,
                        source_version: a.version,
                        file_version: a.file_version,
                      })
                        .then((value) => {
                          onSaved(value);
                          setOpen(false);
                        })
                        .catch((e) => setError(actionError(e)))
                        .finally(() => setBusy(false));
                    }}
                  >
                    引用
                  </button>
                </li>
              ))}
          </ul>
          {!items.length && <p>暂无已批准的同 SKU 资产</p>}
          {error && <p role="alert">{error}</p>}
        </Modal>
      )}
    </>
  );
}
