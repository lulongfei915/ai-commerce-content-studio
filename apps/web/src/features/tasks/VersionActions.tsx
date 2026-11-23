import { useEffect, useState } from 'react';
import { DownloadOutlined } from '@ant-design/icons';
import { apiDelete, apiFetch, apiWrite } from '../../shared/api/client';
import type { Session } from '../auth/session';
import { actionError, type Draft } from '../creation/api';
import { resultPreview, type TaskResult } from '../creation/results';
import { photoPreviewUrl } from '../products/preview';
import type { Task } from './api';

export function VersionActions({
  id,
  task,
  session,
  refresh,
}: {
  id: string;
  task: Task;
  session: Session;
  refresh: () => void;
}) {
  const [asset, setAsset] = useState<TaskResult>();
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [region, setRegion] = useState<number[]>();
  const [revision, setRevision] = useState(0);
  const [lineage, setLineage] = useState<{ parent_version_id?: string }>();
  const token = session.csrf_token;
  const path = `/assets/${id}`;
  const pos = task.positions.find(
    (p) => p.product_id === asset?.product_id && p.purpose === asset?.purpose,
  );
  const adoption = `/delivery-positions/${pos?.id}/adoption`;
  useEffect(() => {
    if (!pos) return;
    const ctl = new AbortController();
    void apiFetch<{ version_id: string; download: string } | null>(adoption, { signal: ctl.signal })
      .then((item) => {
        if (!ctl.signal.aborted) setReceipt(item?.version_id === id ? item.download : '');
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [adoption, pos, id, revision]);
  useEffect(() => {
    const ctl = new AbortController();
    void apiFetch<TaskResult>(path, { signal: ctl.signal })
      .then((value) => {
        if (!ctl.signal.aborted) setAsset(value);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    void apiFetch<NonNullable<typeof lineage>>(path + '/quality', { signal: ctl.signal })
      .then((value) => {
        if (!ctl.signal.aborted) setLineage(value);
      })
      .catch(() => {});
    return () => ctl.abort();
  }, [path, revision]);
  if (!asset) return error ? <p role="alert">{error}</p> : null;
  const product = task.products.find((p) => p.id === asset.product_id);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      await fn();
      setRevision((n) => n + 1);
      refresh();
    } catch (e) {
      setError(actionError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <fieldset className="work-form" disabled={busy}>
      <legend>版本处理</legend>
      {asset.file_version && (
        <a
          target="_blank"
          rel="noreferrer"
          href={
            resultPreview(asset.task_id, id, asset.file_version, asset.version) + '&detailed=true'
          }
        >
          放大查看结果
        </a>
      )}
      {lineage?.parent_version_id && <p>返工来源 · {lineage.parent_version_id}</p>}
      {product?.photos.map((p) => (
        <a
          key={p.file_id}
          href={photoPreviewUrl(product.id, p.file_id)}
          target="_blank"
          rel="noreferrer"
        >
          <img
            width={90}
            src={photoPreviewUrl(product.id, p.file_id)}
            alt={`${product.sku} 实拍 V${p.version}`}
          />
        </a>
      ))}
      {asset.status === 'pending_review' && session.permissions.includes('review') && (
        <>
          <label>
            审核意见
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <details>
            <summary>标注图片区域</summary>
            {['横坐标', '纵坐标', '宽度', '高度'].map((text, i) => (
              <label key={text}>
                {text} %
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={region?.[i] ?? [0, 0, 100, 100][i]}
                  onChange={(e) => {
                    const next = [...(region ?? [0, 0, 100, 100])];
                    next[i] = Number(e.target.value);
                    setRegion(next);
                  }}
                />
              </label>
            ))}
          </details>
          <div className="work-actions">
            {(['approved', 'rejected'] as const).map((decision) => (
              <button
                type="button"
                key={decision}
                disabled={(decision === 'rejected' || !!region) && !reason.trim()}
                onClick={() =>
                  void run(() =>
                    apiWrite(path + '/review', token, {
                      version: asset.version,
                      decision,
                      reason,
                      regions: region
                        ? [
                            {
                              x: region[0] / 100,
                              y: region[1] / 100,
                              width: region[2] / 100,
                              height: region[3] / 100,
                              note: reason,
                            },
                          ]
                        : [],
                    }),
                  )
                }
              >
                {decision === 'approved' ? '批准该版本' : '驳回该版本'}
              </button>
            ))}
          </div>
        </>
      )}
      {asset.status === 'approved' && session.permissions.includes('review') && (
        <details>
          <summary>撤回批准</summary>
          <label>
            撤回原因
            <input value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          <button
            disabled={!reason.trim()}
            onClick={() =>
              void run(() => apiWrite(path + '/revoke', token, { version: asset.version, reason }))
            }
          >
            撤回该版本批准
          </button>
        </details>
      )}
      {asset.status === 'rejected' && session.permissions.includes('create') && (
        <button
          onClick={() =>
            void run(async () => {
              const draft = await apiFetch<Draft>(`/creations/${asset.creation_id}`);
              await apiWrite(path + '/rework', token, {
                expected_version: draft.version,
                idempotency_key: crypto.randomUUID(),
              });
            })
          }
        >
          返工该图片
        </button>
      )}
      {pos && asset.status === 'approved' && session.permissions.includes('adopt') && (
        <>
          <button
            onClick={() =>
              void run(async () => {
                const value = await apiWrite<{ download: string }>(
                  adoption,
                  token,
                  { version_id: id },
                  'PUT',
                );
                setReceipt(value.download);
              })
            }
          >
            采用至交付
          </button>
          {receipt && (
            <button
              onClick={() =>
                void run(async () => {
                  await apiDelete(adoption, token);
                  setReceipt('');
                })
              }
            >
              撤回采用
            </button>
          )}
        </>
      )}
      {asset.status === 'approved' && receipt && session.permissions.includes('download') && (
        <a href={receipt} download>
          <DownloadOutlined /> 下载采用版本
        </a>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
