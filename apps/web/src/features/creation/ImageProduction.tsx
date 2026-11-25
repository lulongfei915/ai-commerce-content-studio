import { useEffect, useRef, useState } from 'react';
import { FileImageOutlined, PlayCircleOutlined, UndoOutlined } from '@ant-design/icons';
import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { actionError, type Draft } from './api';
import { uploadMedia } from '../../shared/api/upload';
import { CompanyAssetPicker } from './CompanyAssetPicker';
import { useImageExecution, type ImageExecution } from './useImageExecution';
import { ImageExecutionStatus } from './ImageExecutionStatus';

type Card = components['schemas']['Card'];
type Suggestion = components['schemas']['AssistanceView'];

export function ImageProduction({
  draft,
  token,
  disabled,
  onSaved,
  onPrompt,
  execution,
  promptToolsOnly = false,
  unsaved = false,
}: {
  draft: Draft;
  token: string;
  disabled: boolean;
  onSaved: (draft: Draft) => void;
  onPrompt: (text: string) => void;
  execution?: ImageExecution;
  promptToolsOnly?: boolean;
  unsaved?: boolean;
}) {
  const localExecution = useImageExecution(execution ? undefined : draft, token);
  const [cards, setCards] = useState<Card[]>([]);
  const [cardId, setCardId] = useState('');
  const [assist, setAssist] = useState<Suggestion>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
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
    <fieldset className="work-form image-tools" disabled={busy || disabled}>
      <legend>图片工具</legend>
      <div className="image-tools-actions">
        {!promptToolsOnly && <CompanyAssetPicker draft={draft} token={token} onSaved={onSaved} />}
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
          disabled={unsaved}
          onClick={() =>
            draft.prompt.trim()
              ? void run(() => requestSuggestion())
              : setError('请先填写并保存提示词。')
          }
        >
          优化提示词
        </button>
        <label className="image-analysis-upload">
          <FileImageOutlined aria-hidden="true" /> 解析参考图
          <input
            disabled={unsaved}
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
            disabled={unsaved || assist.status !== 'ready' || draft.version !== assist.source_version}
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
            disabled={unsaved || assist.status !== 'applied'}
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
      {!execution && (
        <>
          <div className="work-actions">
            <button
              type="button"
              disabled={localExecution.inProgress}
              onClick={() => void run(() => localExecution.submit(draft))}
            >
              <PlayCircleOutlined /> 生成图片
            </button>
          </div>
          <ImageExecutionStatus execution={localExecution} disabled={busy || disabled} />
        </>
      )}
      {error && <p role="alert">{error}</p>}
    </fieldset>
  );
}
