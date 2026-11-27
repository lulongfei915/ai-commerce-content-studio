import { useEffect, useRef, useState, type ReactNode } from 'react';

import { Modal } from '../../shared/ui/Modal';
import { CaseBrowser } from '../cases/CaseBrowser';
import { DraftReferenceList } from './DraftReferenceList';
import type { Category, Product } from '../products/api';
import { TemplatePicker } from '../templates/TemplatePicker';
import { ParametersFields } from './ParametersFields';
import { ReferenceStrip } from './ReferenceStrip';
import { CanvasComposer } from './CanvasComposer';
import { CanvasPromptField, DraftPromptField, type CanvasMentionMaterial } from './CanvasPromptField';
import { VideoFields } from './VideoFields';
import { ImageProduction } from './ImageProduction';
import type { ImageExecution } from './useImageExecution';
import { StoryboardControl } from './StoryboardControl';
import { BoundPhotos } from './BoundPhotos';
import {
  actionError,
  addProductPhotoReference,
  checkDraft,
  defaultVideo,
  defaults,
  draftWrite,
  issueText,
  removeReference,
  saveDraftInputs,
  uploadReference,
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
  quickTools = false,
  externalBusy = false,
  previewUrl,
  onLocateReference,
  imageExecution,
  canvasReference,
  mentionMaterials = [],
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
  quickTools?: boolean;
  externalBusy?: boolean;
  previewUrl?: (reference: Reference) => string | undefined;
  onLocateReference?: (reference: Reference) => void;
  imageExecution?: ImageExecution;
  canvasReference?: ReactNode;
  mentionMaterials?: CanvasMentionMaterial[];
}) {
  const isVideo = draft.purpose === 'video';
  const savedVideo = isVideo ? (draft.video_parameters ?? defaultVideo) : undefined;
  const values = edits ?? {
    prompt: draft.prompt,
    parameters: draft.parameters ?? defaults,
    video: savedVideo,
  };
  const { prompt, parameters } = values;
  const video = values.video ?? savedVideo;
  const text = useRef<HTMLTextAreaElement>(null);
  const [picker, setPicker] = useState<'case' | 'template'>();
  const [working, setBusy] = useState(false);
  const busy = working || externalBusy;
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Issue[]>();
  const dirty = Boolean(edits);
  const known = new Set(draft.references.map((ref) => ref.id));
  const dangling = [...prompt.matchAll(/\[\[ref:([^\]\r\n]+)\]\]/g)].some(
    ([, id]) => !known.has(id),
  );
  useEffect(() => {
    onBusy(working);
    return () => onBusy(false);
  }, [working, onBusy]);

  function edit(next: DraftEdits) {
    onEdit(
      next.prompt === draft.prompt &&
        JSON.stringify(next.parameters) === JSON.stringify(draft.parameters ?? defaults) &&
        JSON.stringify(next.video ?? savedVideo) === JSON.stringify(savedVideo)
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
            prompt === updated.prompt
              ? undefined
              : {
                  prompt,
                  parameters: updated.parameters ?? defaults,
                  video: isVideo ? (updated.video_parameters ?? defaultVideo) : undefined,
                },
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
  const promptField = inCanvas ? (
    <CanvasPromptField
      text={text}
      prompt={prompt}
      video={isVideo}
      busy={busy}
      references={draft.references}
      materials={mentionMaterials}
      preview={previewUrl}
      onChange={(value) => edit({ ...values, prompt: value })}
      onAttach={async (attach) => {
        start();
        try {
          const { updated, ref } = await attach();
          onSaved(updated);
          return ref;
        } finally {
          setBusy(false);
        }
      }}
    />
  ) : (
    <DraftPromptField text={text} prompt={prompt} busy={busy}
      onChange={(value) => edit({ ...values, prompt: value })} />
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

  const strip = !!draft.references.length && inCanvas && (
    <ReferenceStrip
      references={draft.references}
      busy={busy}
      preview={previewUrl}
      insert={insert}
      locate={onLocateReference}
      remove={(ref) => run(() => removeReference(draft, token, ref.id), 'references')}
    />
  );
  function upload(file?: File) {
    if (!file) return;
    const videoFile = isVideo && file.type === 'video/mp4';
    if (file.size > (videoFile ? 100 : 10) * 1024 * 1024) {
      setError(videoFile ? '参考视频不能超过 100 MB。' : '参考图片不能超过 10 MB。');
      return;
    }
    run(() => uploadReference(draft, token, file), 'references');
  }
  const feedback = (
    <>
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
    </>
  );
  const legacyBody = !inCanvas && (
    <div className="creative-body work-form">
      {!quickTools && <div className="creative-product-context">
        <div className="work-row">
          {draft.entry !== 'batch' && <h3>快捷创作</h3>}
          <span className="work-muted">
            {product.sku} · {isVideo ? '视频' : draft.purpose === 'main' ? '主图' : '详情素材'}
          </span>
        </div>
        {(isVideo || draft.entry === 'canvas' || draft.entry === 'batch') && (
          <BoundPhotos product={product} />
        )}
      </div>}
      {!quickTools && promptField}
      {!quickTools && outputSettings}
      <div className="work-actions creative-reference-actions">
        {!quickTools && (
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
        {!quickTools && draft.template_id && (
          <button
            type="button"
            disabled={busy}
            onClick={() => run(() => draftWrite(draft, token, '/template/clear', {}), 'references')}
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
        {(isVideo || draft.entry !== 'batch') && <label className="creative-upload">
          {isVideo ? '上传参考素材' : '上传参考图'}
          <input
            type="file"
            accept={`image/jpeg,image/png,image/webp${isVideo ? ',video/mp4' : ''}`}
            disabled={busy}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              upload(file);
            }}
          />
        </label>}
      </div>
      {!!draft.references.length && (
        <DraftReferenceList
          draft={draft}
          busy={busy}
          preview={previewUrl}
          insert={insert}
          remove={(ref) => run(() => removeReference(draft, token, ref.id), 'references')}
          updateUsage={(ref, usage) =>
            run(
              () => draftWrite(draft, token, `/references/${ref.id}`, { usage }, 'PATCH'),
              'references',
            )
          }
        />
      )}
      {feedback}
    </div>
  );
  async function prepareDraft() {
    if (!dirty) return draft;
    const saved = await saveDraftInputs(draft, token, values);
    onSaved(saved);
    onEdit(undefined);
    return saved;
  }

  function resetParameters() {
    edit({
      ...values,
      parameters: defaults,
      video: isVideo ? defaultVideo : undefined,
    });
  }

  const saveDraft = (
    <button
      type="button"
      className="work-primary"
      disabled={busy || !dirty}
      onClick={() => run(() => saveDraftInputs(draft, token, values), 'save')}
    >
      保存草稿
    </button>
  );
  const draftActions = !inCanvas && (
    <>
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
        检查已保存草稿
      </button>
      {saveDraft}
    </>
  );
  const storyboard = isVideo && video && (
    <StoryboardControl draft={draft} product={product} token={token} video={video}
      busy={busy} dirty={dirty}
      prepare={prepareDraft}
      onSaved={onSaved} />
  );

  return (
    <article
      className={`work-form creative-editor${inCanvas ? ' creative-in-canvas' : ' work-card'}`}
      aria-label="创作编辑器"
    >
      {inCanvas ? (
        <CanvasComposer
          draft={draft}
          product={product}
          token={token}
          values={{ ...values, video }}
          busy={busy}
          dangling={dangling}
          promptField={promptField}
          references={strip}
          canvasReference={canvasReference}
          settings={outputSettings}
          storyboard={storyboard}
          feedback={feedback}
          onSaved={onSaved}
          onPrompt={(value) => edit({ ...values, prompt: value })}
          onChangeParameters={edit}
          onTemplate={() => setPicker('template')}
          onCase={() => setPicker('case')}
          onClearTemplate={() =>
            run(() => draftWrite(draft, token, '/template/clear', {}), 'references')
          }
          onUpload={upload}
          onPickPhoto={(photo) =>
            run(() => addProductPhotoReference(draft, token, photo), 'references')
          }
          onResetParameters={resetParameters}
          onPreparePromptTools={async () => {
            if (!dirty) return true;
            start();
            try {
              await prepareDraft();
              return true;
            } catch (cause) {
              setError(actionError(cause));
              return false;
            } finally {
              setBusy(false);
            }
          }}
          onGenerate={async (submit) => {
            start();
            try {
              const saved = dirty ? await saveDraftInputs(draft, token, values) : draft;
              try {
                await submit(saved);
              } finally {
                onSaved(saved);
                if (dirty) onEdit(undefined);
              }
            } catch (cause) {
              setError(actionError(cause));
            } finally {
              setBusy(false);
            }
          }}
        />
      ) : (
        <>
          {legacyBody}
          {(!isVideo || draft.entry === 'batch' || draft.entry === 'quick') && (
            <ImageProduction
              key={draft.id}
              draft={draft}
              token={token}
              disabled={busy || dangling}
              unsaved={dirty}
              promptToolsOnly={quickTools || isVideo || draft.entry === 'batch'}
              showAssistance={!quickTools}
              onSaved={onSaved}
              onPrompt={(value) => edit({ ...values, prompt: value })}
              execution={imageExecution}
            />
          )}
          <footer className="work-actions creative-footer">{!quickTools && storyboard}{draftActions}</footer>
        </>
      )}
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
    </article>
  );
}
