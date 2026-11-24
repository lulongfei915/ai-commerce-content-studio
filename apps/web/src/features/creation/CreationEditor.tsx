import { useEffect, useRef, useState } from 'react';
import { AuditOutlined, FileSearchOutlined, UndoOutlined } from '@ant-design/icons';

import { Modal } from '../../shared/ui/Modal';
import { CaseBrowser } from '../cases/CaseBrowser';
import { casePreview } from '../cases/api';
import type { Category, Product } from '../products/api';
import { TemplatePicker } from '../templates/TemplatePicker';
import { ParametersFields } from './ParametersFields';
import { ReferenceStrip } from './ReferenceStrip';
import { InputSnapshotDialog } from './InputSnapshotDialog';
import { CanvasSpecs } from './CanvasSpecs';
import { VideoFields } from './VideoFields';
import { ImageProduction } from './ImageProduction';
import type { ImageExecution } from './useImageExecution';
import { BoundPhotos } from './BoundPhotos';
import {
  actionError,
  checkDraft,
  defaults,
  draftWrite,
  issueText,
  loadSnapshot,
  removeReference,
  saveDraftInputs,
  uploadReference,
  usageLabel,
} from './api';
import type { Draft, DraftEdits, Issue, Reference } from './api';
import './creation.css';

export function CreationEditor({
  draft,
  product,
  categories,
  token,
  onSaved,
  onBusy,
  edits,
  onEdit,
  inCanvas = false,
  previewUrl,
  onLocateReference,
  imageExecution,
}: {
  draft: Draft;
  product: Product;
  categories: Category[];
  token: string;
  onSaved: (draft: Draft) => void;
  onBusy: (busy: boolean) => void;
  edits?: DraftEdits;
  onEdit: (edits: DraftEdits | undefined) => void;
  inCanvas?: boolean;
  previewUrl?: (reference: Reference) => string | undefined;
  onLocateReference?: (reference: Reference) => void;
  imageExecution?: ImageExecution;
}) {
  const values = edits ?? {
    prompt: draft.prompt,
    parameters: draft.parameters ?? defaults,
    video: draft.video_parameters ?? undefined,
  };
  const { prompt, parameters, video } = values;
  const text = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<'case' | 'template'>();
  const [snapshot, setSnapshot] = useState<Awaited<ReturnType<typeof loadSnapshot>>>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Issue[]>();
  const dirty = Boolean(edits);
  const isVideo = draft.purpose === 'video';
  const known = new Set(draft.references.map((ref) => ref.id));
  const dangling = [...prompt.matchAll(/\[\[ref:([^\]\r\n]+)\]\]/g)].some(
    ([, id]) => !known.has(id),
  );
  useEffect(() => {
    onBusy(busy);
    return () => onBusy(false);
  }, [busy, onBusy]);

  function edit(next: DraftEdits) {
    onEdit(
      next.prompt === draft.prompt &&
        JSON.stringify(next.parameters) === JSON.stringify(draft.parameters ?? defaults) &&
        JSON.stringify(next.video) === JSON.stringify(draft.video_parameters ?? undefined)
        ? undefined
        : next,
    );
    setNotice('');
    setIssues(undefined);
  }

  function start() {
    setBusy(true);
    setError('');
    setNotice('');
    setIssues(undefined);
  }
  function run(operation: () => Promise<Draft>, mode: 'save' | 'references' | 'keep' | 'replace') {
    if (busy) return;
    start();
    void operation()
      .then((updated) => {
        if (mode === 'save' || mode === 'replace') onEdit(undefined);
        if (mode === 'keep') {
          onEdit(
            prompt === updated.prompt ? undefined : { ...values, parameters: updated.parameters },
          );
        }
        onSaved(updated);
        setPicker(undefined);
        setNotice(mode === 'save' ? '草稿已保存' : '配置已更新');
      })
      .catch((cause: unknown) => setError(actionError(cause)))
      .finally(() => setBusy(false));
  }
  function insert(ref: Reference) {
    const at = text.current?.selectionStart ?? prompt.length;
    const end = text.current?.selectionEnd ?? at;
    const tag = `[[ref:${ref.id}]]`;
    const next = `${prompt.slice(0, at)}${tag}${prompt.slice(end)}`;
    if (next.length > 6000) return;
    edit({ ...values, prompt: next });
    requestAnimationFrame(() => {
      text.current?.focus();
      text.current?.setSelectionRange(at + tag.length, at + tag.length);
    });
  }
  const promptField = (
    <label className="work-form creative-prompt">
      {!inCanvas && '提示词'}
      <textarea
        aria-label="提示词"
        placeholder={inCanvas ? '描述商品画面，或插入参考素材标签…' : undefined}
        ref={text}
        rows={5}
        maxLength={6000}
        value={prompt}
        disabled={busy}
        onChange={(event) => edit({ ...values, prompt: event.target.value })}
      />
    </label>
  );
  const outputSettings = (
    <fieldset className="work-form creative-output-settings" disabled={busy}>
      {!inCanvas && <legend>{isVideo ? '视频参数' : '图片参数'}</legend>}
      {isVideo && video ? (
        <VideoFields value={video} onChange={(value) => edit({ ...values, video: value })} />
      ) : (
        <ParametersFields
          value={parameters}
          onChange={(value) => edit({ ...values, parameters: value })}
        />
      )}
    </fieldset>
  );

  return (
    <article
      className={`work-form creative-editor${inCanvas ? ' creative-in-canvas' : ' work-card'}`}
      aria-label="创作编辑器"
    >
      <div className="creative-body work-form">
        <div className="creative-product-context">
          <div className="work-row">
            {!inCanvas && <h3>快捷创作</h3>}
            <span className="work-muted">
              {product.sku} · {isVideo ? '视频' : draft.purpose === 'main' ? '主图' : '详情素材'}
            </span>
          </div>
          <BoundPhotos product={product} />
        </div>
        {!inCanvas && (
          <>
            {promptField}
            {outputSettings}
          </>
        )}
        <div className="work-actions creative-reference-actions">
          {!isVideo && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setError('');
                setPicker('template');
              }}
            >
              {draft.template_version ? `切换模板 · V${draft.template_version}` : '应用模板'}
            </button>
          )}
          {draft.template_id && (
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(() => draftWrite(draft, token, '/template/clear', {}), 'references')
              }
            >
              取消应用模板
            </button>
          )}
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setError('');
              setPicker('case');
            }}
          >
            添加案例
          </button>
          <label className="creative-upload">
            上传参考图
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (!file) return;
                if (file.size > 10 * 1024 * 1024) {
                  setError('参考图片不能超过 10 MB。');
                  return;
                }
                run(() => uploadReference(draft, token, file), 'references');
              }}
            />
          </label>
        </div>
        {!!draft.references.length && inCanvas && (
          <ReferenceStrip
            references={draft.references}
            busy={busy}
            video={isVideo}
            preview={previewUrl}
            insert={insert}
            locate={onLocateReference}
            remove={(ref) => run(() => removeReference(draft, token, ref.id), 'references')}
            updateUsage={(ref, usage) =>
              run(
                () => draftWrite(draft, token, `/references/${ref.id}`, { usage }, 'PATCH'),
                'references',
              )
            }
          />
        )}
        {!!draft.references.length && !inCanvas && (
          <ul className="creative-references" aria-label="参考素材">
            {draft.references.map((ref, index) => {
              const src =
                previewUrl?.(ref) ??
                (ref.kind === 'case' && !inCanvas ? casePreview(ref.source_id) : undefined);
              return (
                <li key={ref.id}>
                  {src && ref.media !== 'video' && <img src={src} loading="lazy" alt="" />}
                  <span>
                    参考 {index + 1} · {ref.label}{' '}
                    <small>
                      {usageLabel[ref.usage ?? 'expression']} · 文件 V{ref.file_version}
                    </small>
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => insert(ref)}
                    aria-label={`插入参考 ${index + 1} 标签`}
                  >
                    插入标签
                  </button>
                  {ref.origin === 'independent' && (
                    <>
                      <select
                        aria-label={`参考 ${index + 1} 用途`}
                        value={ref.usage ?? 'expression'}
                        disabled={busy}
                        onChange={(event) =>
                          run(
                            () =>
                              draftWrite(
                                draft,
                                token,
                                `/references/${ref.id}`,
                                { usage: event.target.value },
                                'PATCH',
                              ),
                            'references',
                          )
                        }
                      >
                        {Object.entries(usageLabel)
                          .filter(
                            ([usage]) =>
                              usage === ref.usage ||
                              (usage !== 'product' &&
                                (isVideo || !['first_frame', 'last_frame'].includes(usage))),
                          )
                          .map(([usage, label]) => (
                            <option key={usage} value={usage}>
                              {label}
                            </option>
                          ))}
                      </select>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          run(() => removeReference(draft, token, ref.id), 'references')
                        }
                        aria-label={`移除参考 ${index + 1}`}
                      >
                        移除
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
        {inCanvas && (
          <>
            {promptField}
            <CanvasSpecs parameters={parameters} video={video}>
              {outputSettings}
            </CanvasSpecs>
          </>
        )}
        {dangling && (
          <p role="alert" className="work-error">
            提示词含已移除的引用标签。
          </p>
        )}
        {!picker && error && (
          <p role="alert" className="work-error">
            {error}
          </p>
        )}
        {notice && (
          <p role="status" className="work-muted">
            {notice}
          </p>
        )}
        {issues &&
          (issues.length ? (
            <ul className="work-error" aria-label="生成前检查结果">
              {issues.map((issue) => (
                <li key={`${issue.field}:${issue.code}`}>{issueText(issue)}</li>
              ))}
            </ul>
          ) : (
            <p role="status">已保存的草稿通过生成前检查。</p>
          ))}
      </div>
      {!isVideo && draft.entry !== 'batch' && (
        <ImageProduction
          key={draft.id}
          draft={draft}
          token={token}
          disabled={busy || dirty || dangling}
          onSaved={onSaved}
          onPrompt={(value) => edit({ ...values, prompt: value })}
          execution={imageExecution}
        />
      )}
      <footer className="work-actions creative-footer">
        {inCanvas && (
          <button
            type="button"
            aria-label="核对生成输入"
            title="核对生成输入"
            disabled={busy || dirty || dangling}
            onClick={() => {
              start();
              void loadSnapshot(draft)
                .then(setSnapshot)
                .catch((cause: unknown) => setError(actionError(cause)))
                .finally(() => setBusy(false));
            }}
          >
            <FileSearchOutlined />
          </button>
        )}
        {inCanvas && (
          <button
            type="button"
            aria-label="恢复默认参数"
            title="恢复默认参数"
            disabled={busy}
            onClick={() =>
              edit({
                ...values,
                parameters: defaults,
                video: isVideo
                  ? {
                      model: 'seedance-2.0',
                      ratio: '16:9',
                      resolution: '720p',
                      duration: 5,
                      count: 1,
                    }
                  : undefined,
              })
            }
          >
            <UndoOutlined />
          </button>
        )}
        <button
          type="button"
          aria-label="检查已保存草稿"
          title="检查已保存草稿"
          disabled={busy || dirty}
          onClick={() => {
            start();
            void checkDraft(draft)
              .then((result) => setIssues(result.issues))
              .catch((cause: unknown) => setError(actionError(cause)))
              .finally(() => setBusy(false));
          }}
        >
          {inCanvas ? <AuditOutlined /> : '检查已保存草稿'}
        </button>
        <button
          type="button"
          className="work-primary"
          disabled={busy || !dirty}
          onClick={() => run(() => saveDraftInputs(draft, token, values), 'save')}
        >
          保存草稿
        </button>
      </footer>
      {picker === 'case' && (
        <Modal title="添加案例参考" onClose={() => setPicker(undefined)} busy={busy}>
          <CaseBrowser
            categories={categories}
            category={product.category}
            purpose={draft.purpose}
            imageOnly={!isVideo}
            allowVideo={isVideo}
            disabled={busy}
            onPick={(item) =>
              run(
                () => draftWrite(draft, token, '/references', { kind: 'case', source_id: item.id }),
                'references',
              )
            }
          />
          {error && (
            <p role="alert" className="work-error">
              {error}
            </p>
          )}
        </Modal>
      )}
      {picker === 'template' && (
        <TemplatePicker
          category={product.category}
          purpose={draft.purpose}
          hasPrompt={Boolean(prompt.trim())}
          busy={busy}
          error={error}
          onClose={() => setPicker(undefined)}
          onApply={(template, action) => {
            run(
              () =>
                draftWrite(draft, token, '/template', {
                  template_id: template.id,
                  template_version: template.published_version,
                  prompt_action: action,
                }),
              action,
            );
          }}
        />
      )}
      {snapshot && (
        <InputSnapshotDialog
          snapshot={snapshot}
          sku={product.sku}
          onClose={() => setSnapshot(undefined)}
        />
      )}
    </article>
  );
}
