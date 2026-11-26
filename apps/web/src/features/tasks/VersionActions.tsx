import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckOutlined, DownloadOutlined } from '@ant-design/icons';
import { apiDelete, apiFetch, apiWrite } from '../../shared/api/client';
import type { Session } from '../auth/session';
import { actionError, type Draft } from '../creation/api';
import { resultPreview, type TaskResult } from '../creation/results';
import { photoPreviewUrl } from '../products/preview';
import type { Task } from './api';
import type { components } from '../../shared/api/generated';

type TimeNote = components['schemas']['TimeNote'];

export function VersionActions({
  id,
  task,
  positionId,
  session,
  refresh,
  reviewFooter,
  onAssetChange,
  onApproved,
}: {
  id: string;
  task: Task;
  positionId?: string;
  session: Session;
  refresh: () => void;
  reviewFooter?: HTMLElement | null;
  onAssetChange?: (asset: TaskResult) => void;
  onApproved?: () => void;
}) {
  const [asset, setAsset] = useState<TaskResult>();
  const [reason, setReason] = useState('');
  const [receipt, setReceipt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [region, setRegion] = useState<number[]>();
  const [timeRange, setTimeRange] = useState<[string, string]>(['', '']);
  const [revision, setRevision] = useState(0);
  const [lineage, setLineage] = useState<{
    parent_version_id?: string;
    storyboard?: components['schemas']['StoryboardView'];
    decision?: { reason?: string; revocation?: { reason?: string }; time_notes?: TimeNote[] };
  }>();
  const token = session.csrf_token;
  const reviewLayout = reviewFooter !== undefined;
  const path = `/assets/${id}`;
  const compatible = task.positions.filter(
    (p) => p.product_id === asset?.product_id && p.purpose === asset?.purpose,
  );
  const pos = reviewLayout
    ? undefined
    : positionId
      ? compatible.find((p) => p.id === positionId)
      : compatible.length === 1
        ? compatible[0]
        : undefined;
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
        if (!ctl.signal.aborted) {
          setAsset(value);
          onAssetChange?.(value);
        }
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
  }, [path, revision, onAssetChange]);
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
  const canReview = asset.status === 'pending_review' && session.permissions.includes('review');
  const isVideo = asset.media === 'video';
  const hasTime = isVideo && timeRange.some(Boolean);
  const start = Number(timeRange[0]);
  const end = Number(timeRange[1]);
  const validTime = !hasTime || (timeRange.every(Boolean) && start >= 0 && end > start &&
    end <= (asset.duration ?? 0) && reason.trim().length > 0 && reason.trim().length <= 500);
  const decisions = reviewLayout
    ? (['rejected', 'approved'] as const)
    : (['approved', 'rejected'] as const);
  const decisionButtons = canReview && (
    <div className={reviewLayout ? 'review-dialog-actions' : 'work-actions'}>
      {decisions.map((decision) => (
        <button
          type="button"
          key={decision}
          className={reviewLayout && decision === 'approved' ? 'work-primary' : undefined}
          disabled={busy || !validTime || ((decision === 'rejected' || !!region) && !reason.trim())}
          onClick={() =>
            void run(async () => {
              await apiWrite(path + '/review', token, {
                version: asset.version,
                decision,
                reason,
                ...(hasTime ? { time_notes: [{ start, end, note: reason }] } : {}),
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
              });
              if (decision === 'approved' && onApproved) {
                onApproved();
              } else if (reviewLayout) {
                const reviewed = { ...asset, status: decision };
                setAsset(reviewed);
                onAssetChange?.(reviewed);
              }
            })
          }
        >
          {reviewLayout && decision === 'approved' && <CheckOutlined aria-hidden="true" />}
          {decision === 'approved'
            ? reviewLayout
              ? '批准此版本'
              : '批准该版本'
            : reviewLayout
              ? '驳回返工'
              : '驳回该版本'}
        </button>
      ))}
    </div>
  );
  return (
    <fieldset className={`work-form${reviewLayout ? ' review-dialog-form' : ''}`} disabled={busy}>
      <legend className={reviewLayout ? 'review-dialog-legend' : undefined}>版本处理</legend>
      {lineage?.decision?.reason && <p>审核意见 · {lineage.decision.reason}</p>}
      {lineage?.decision?.time_notes?.map((note, index) =>
        <p key={index}>{note.start}–{note.end} 秒 · {note.note}</p>,
      )}
      {lineage?.storyboard && <details>
        <summary>生成时确认的分镜</summary>
        <ol>{lineage.storyboard.shots.map((shot, index) => (
          <li key={index}>{shot.duration} 秒 · {shot.visual}{shot.narration && ` · ${shot.narration}`}</li>
        ))}</ol>
      </details>}
      {lineage?.decision?.revocation?.reason && (
        <p>撤回原因 · {lineage.decision.revocation.reason}</p>
      )}
      {!reviewLayout && asset.file_version && (
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
      {!reviewLayout &&
        product?.photos.map((p) => (
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
      {canReview && (
        <>
          <label>
            {reviewLayout ? '审核意见（驳回必填）' : '审核意见'}
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} />
          </label>
          {isVideo && (
            <details>
              <summary>标注视频时间段</summary>
              {['开始秒数', '结束秒数'].map((label, index) => (
                <label key={label}>{label}
                  <input type="number" min={0} max={asset.duration ?? 0} step={0.01}
                    value={timeRange[index]} onChange={(event) => setTimeRange(
                      index === 0 ? [event.target.value, timeRange[1]] : [timeRange[0], event.target.value],
                    )} />
                </label>
              ))}
            </details>
          )}
          {!isVideo && !reviewLayout && (
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
          )}
          {!reviewLayout && decisionButtons}
        </>
      )}
      {reviewFooter && createPortal(decisionButtons, reviewFooter)}
      {asset.status === 'approved' && session.permissions.includes('review') && (
        <details className="review-revocation">
          <summary>撤回批准</summary>
          <div className="review-revocation-fields">
            <label>
              撤回原因
              <input value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button
              type="button"
              disabled={!reason.trim()}
              onClick={() =>
                void run(() =>
                  apiWrite(path + '/revoke', token, { version: asset.version, reason }),
                )
              }
            >
              撤回该版本批准
            </button>
          </div>
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
          {isVideo ? '返工整条视频' : '返工该图片'}
        </button>
      )}
      {pos && (!isVideo || lineage?.storyboard) && asset.status === 'approved' && session.permissions.includes('adopt') && (
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
