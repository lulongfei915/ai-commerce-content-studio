import { useEffect, useRef, useState } from 'react';
import { FileImageOutlined, PlayCircleOutlined, UndoOutlined } from '@ant-design/icons';
import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { statusLabel } from '../canvas/status';
import { actionError, type Draft } from './api';
import { uploadMedia } from '../../shared/api/upload';
import { CompanyAssetPicker } from './CompanyAssetPicker';

type Job = components['schemas']['ExecutionState'];
type Card = components['schemas']['Card'];
type Suggestion = components['schemas']['AssistanceView'];
const active = new Set(['queued', 'generating', 'saving']);

export function ImageProduction({
  draft,
  token,
  disabled,
  onSaved,
  onPrompt,
}: {
  draft: Draft;
  token: string;
  disabled: boolean;
  onSaved: (draft: Draft) => void;
  onPrompt: (text: string) => void;
}) {
  const [job, setJob] = useState<Job>();
  const [cards, setCards] = useState<Card[]>([]);
  const [cardId, setCardId] = useState('');
  const [assist, setAssist] = useState<Suggestion>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = useRef('');
  const mounted = useRef(false);
  const card = cards.find((c) => c.id === cardId);
  const path = `/creations/${draft.id}`;
  useEffect(() => {
    mounted.current = true;
    const ctl = new AbortController();
    void apiFetch<Suggestion[]>(path + '/assistances', { signal: ctl.signal })
      .then((items) => {
        if (!ctl.signal.aborted) setAssist((current) => current ?? items[0]);
      })
      .catch(() => {});
    void apiFetch<Job[]>(path + '/executions', { signal: ctl.signal })
      .then((items) => {
        if (!ctl.signal.aborted) setJob((current) => current ?? items[0]);
      })
      .catch(() => {});
    void apiFetch<Card[]>('/prompt-cards', { signal: ctl.signal })
      .then((items) => {
        if (!ctl.signal.aborted) setCards(items);
      })
      .catch(() => {});
    return () => {
      mounted.current = false;
      ctl.abort();
    };
  }, [path]);
  useEffect(() => {
    key.current = '';
  }, [draft.version]);
  useEffect(() => {
    if (!job?.outputs.some((o) => active.has(o.status))) return;
    const ctl = new AbortController();
    const timer = window.setInterval(() => {
      void apiFetch<Job>(`/executions/${job.id}`, { signal: ctl.signal })
        .then((next) => {
          if (ctl.signal.aborted) return;
          setJob(next);
          if (!next.outputs.some((o) => active.has(o.status)))
            window.dispatchEvent(new CustomEvent('studio-results', { detail: draft.task_id }));
        })
        .catch(() => {});
    }, 2000);
    return () => {
      clearInterval(timer);
      ctl.abort();
    };
  }, [job, draft.task_id]);
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e) {
      if (mounted.current) setError(actionError(e));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }
  async function requestSuggestion(file?: File) {
    const reference = file
      ? { kind: 'upload', source_id: await uploadMedia(file, token) }
      : undefined;
    const item = await apiWrite<Suggestion>(path + '/assistances', token, {
      kind: file ? 'reference' : 'optimize',
      expected_version: draft.version,
      reference,
    });
    if (mounted.current) {
      setAssist(item);
      if (item.status !== 'ready') setError('辅助调用待核实，请查看调用记录。');
    }
  }
  return (
    <fieldset className="work-form" disabled={busy || disabled}>
      <legend>图片制作</legend>
      <div className="work-actions">
        <CompanyAssetPicker draft={draft} token={token} onSaved={onSaved} />
        <select aria-label="快捷词卡片" value={cardId} onChange={(e) => setCardId(e.target.value)}>
          <option value="">选择快捷词</option>
          {cards.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title} · V{c.version}
            </option>
          ))}
        </select>
        {card && (
          <>
            <span>{card.prompt}</span>
            <button type="button" onClick={() => onPrompt(card.prompt)}>
              替换正文
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() =>
            draft.prompt.trim()
              ? void run(() => requestSuggestion())
              : setError('请先填写并保存提示词。')
          }
        >
          优化提示词
        </button>
        <label>
          <FileImageOutlined /> 解析参考图
          <input
            aria-label="解析参考图"
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (file) void run(() => requestSuggestion(file));
            }}
          />
        </label>
      </div>
      {assist?.suggestion && (
        <div>
          <p>{assist.suggestion}</p>
          <button
            type="button"
            disabled={assist.status !== 'ready' || draft.version !== assist.source_version}
            onClick={() =>
              void run(async () => {
                const updated = await apiWrite<Draft>(`/assistances/${assist.id}/apply`, token);
                if (mounted.current) {
                  onSaved(updated);
                  setAssist({ ...assist, status: 'applied' });
                }
              })
            }
          >
            采用建议
          </button>
          <button
            type="button"
            title="撤销建议"
            aria-label="撤销建议"
            disabled={assist.status !== 'applied'}
            onClick={() =>
              void run(async () => {
                const updated = await apiWrite<Draft>(`/assistances/${assist.id}/undo`, token);
                if (mounted.current) {
                  onSaved(updated);
                  setAssist(undefined);
                }
              })
            }
          >
            <UndoOutlined />
          </button>
        </div>
      )}
      <div className="work-actions">
        <button
          type="button"
          disabled={job?.outputs.some((o) => active.has(o.status))}
          onClick={() =>
            void run(async () => {
              key.current ||= crypto.randomUUID();
              const next = await apiWrite<Job>(path + '/executions', token, {
                expected_version: draft.version,
                idempotency_key: key.current,
              });
              key.current = '';
              setJob(next);
            })
          }
        >
          <PlayCircleOutlined /> 生成图片
        </button>
        {job?.outputs.some((o) => o.status === 'queued') && (
          <button
            type="button"
            onClick={() =>
              void run(async () =>
                setJob(await apiWrite<Job>(`/executions/${job.id}/cancel`, token)),
              )
            }
          >
            取消排队
          </button>
        )}
      </div>
      {job?.outputs.map((o, i) => (
        <div key={o.id}>
          图片 {i + 1} · {statusLabel[o.status] ?? o.status}
          {['generation_failed', 'save_failed'].includes(o.status) && (
            <button
              type="button"
              onClick={() =>
                void run(async () => setJob(await apiWrite<Job>(`/outputs/${o.id}/retry`, token)))
              }
            >
              重试该步骤
            </button>
          )}
        </div>
      ))}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
