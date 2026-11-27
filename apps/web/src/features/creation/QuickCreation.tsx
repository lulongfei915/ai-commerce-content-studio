import { useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  PictureOutlined,
  PlusOutlined,
  ProfileOutlined,
  ThunderboltOutlined,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { Modal } from '../../shared/ui/Modal';
import { updateFacts, uploadPhoto, type Category, type Product } from '../products/api';
import { TemplatePicker } from '../templates/TemplatePicker';
import type { Template } from '../templates/api';
import { QuickMaterials, SelectedQuickMaterials } from './QuickMaterials';
import { QuickParameters } from './QuickParameters';
import { StoryboardDialog } from './StoryboardControl';
import {
  actionError,
  addProductPhotoReference,
  defaults,
  draftWrite,
  removeReference,
  saveDraftInputs,
  uploadReference,
  type Draft,
  type DraftEdits,
} from './api';
import type { ImageExecution } from './useImageExecution';

type Props = {
  product: Product;
  purpose: Draft['purpose'];
  editorId: string;
  categories: Category[];
  token: string;
  selected?: Draft;
  targetSpec?: { ratio: string; resolution: string };
  edits?: DraftEdits;
  busy: boolean;
  loading: boolean;
  onCreate: (
    product: string,
    purpose: Draft['purpose'],
    primary: boolean,
  ) => Promise<Draft | undefined>;
  onSaved: (draft: Draft) => void;
  onProductSaved: (product: Product) => void;
  onEdit: (id: string, edits: DraftEdits | undefined) => void;
  onBusy: (busy: boolean) => void;
  execution: ImageExecution;
  onSubmitting: (count: number, media: 'image' | 'video') => void;
};

export function QuickCreation({
  product,
  purpose,
  editorId,
  categories,
  token,
  selected,
  targetSpec,
  edits,
  busy,
  loading,
  onCreate,
  onSaved,
  onProductSaved,
  onEdit,
  onBusy,
  execution,
  onSubmitting,
}: Props) {
  const [panel, setPanel] = useState<'storyboard' | 'product' | 'reference' | 'optimize' | 'template'>();
  const [feedback, setFeedback] = useState<{ id: string; message: string; error?: boolean }>();
  const [suggestion, setSuggestion] = useState<components['schemas']['AssistanceView']>();
  const isVideo = purpose === 'video';
  const working = useRef(false);
  const preferred = selected?.parameters ?? defaults;
  const base: DraftEdits = edits ?? {
    prompt: selected?.prompt ?? '',
    parameters: preferred,
    video: selected?.video_parameters ?? undefined,
  };
  const value: DraftEdits = isVideo
    ? { ...base, video: base.video ?? selected?.video_parameters ??
      { model: 'seedance-2.0', ratio: '16:9', resolution: '720p', duration: 5, count: 1 } }
    : { ...base, video: undefined, parameters: targetSpec ? { ...base.parameters, ...targetSpec } : base.parameters };
  const spec = value.video ?? value.parameters;
  const labels = isVideo
    ? ['商品环绕', '细节推进', '分镜展示']
    : ['简洁棚拍', '生活场景', '细节特写'];
  const phrases = isVideo
    ? [
        '镜头平稳环绕，展示商品全貌。',
        '镜头缓慢推进，展现实拍可见的细节。',
        '从全貌切入细节，再回到完整商品。',
      ]
    : [
        '简洁暖灰背景，柔和自然光，突出商品真实轮廓与细节，画面留出适当呼吸空间。',
        '置于符合实际用途的日常场景中，采用自然光，保持商品颜色和结构一致。',
        '近距离拍摄商品结构，用柔和侧光表现层次。',
      ];
  const references = selected?.references ?? [];
  const hasPhotos = references.some((ref) => ref.usage === 'product');
  const prompts = phrases.map(
    (phrase) => `以${product.name}${hasPhotos ? '实拍' : ''}为主体，${phrase}`,
  );
  const disabled = busy || loading;
  const editorFeedback = feedback?.id === editorId ? feedback : undefined;

  function change(next: DraftEdits) {
    onEdit(editorId, next);
    setFeedback(undefined);
  }
  async function withDraft(operation: (draft: Draft) => Promise<void>, outputCount = 0) {
    if (disabled || working.current) return;
    working.current = true;
    onBusy(true);
    const media = isVideo ? 'video' : 'image';
    if (outputCount) onSubmitting(outputCount, media);
    setFeedback(undefined);
    let id = editorId;
    try {
      const draft = selected ?? (await onCreate(product.id, purpose, true));
      if (!draft) {
        setPanel((current) => current === 'template' || current === 'optimize' ? undefined : current);
        return;
      }
      id = draft.id;
      if (editorId !== id && edits) {
        onEdit(id, edits);
        onEdit(editorId, undefined);
      }
      await operation(draft);
    } catch (cause) {
      setFeedback({ id, message: actionError(cause), error: true });
    } finally {
      working.current = false;
      if (outputCount) onSubmitting(0, media);
      onBusy(false);
    }
  }

  async function saveInputs(draft: Draft) {
    const hasTargetSpec = !isVideo && targetSpec && (
      draft.parameters.ratio !== targetSpec.ratio ||
      draft.parameters.resolution !== targetSpec.resolution
    );
    if (!edits && !hasTargetSpec) return draft;
    const updated = await saveDraftInputs(draft, token, value);
    onSaved(updated);
    onEdit(draft.id, undefined);
    return updated;
  }

  function closePromptTool() {
    setPanel(undefined);
    setFeedback(undefined);
    setSuggestion(undefined);
  }

  function optimizePrompt() {
    setSuggestion(undefined);
    setPanel('optimize');
    void withDraft(async (draft) => {
      const saved = await saveInputs(draft);
      const result = await apiWrite<components['schemas']['AssistanceView']>(
        `/creations/${saved.id}/assistances`,
        token,
        { kind: 'optimize', expected_version: saved.version },
      );
      setSuggestion(result);
    });
  }

  function updateSuggestion(action: 'apply' | 'undo') {
    if (!suggestion) return;
    void withDraft(async () => {
      const updated = await apiWrite<Draft>(`/assistances/${suggestion.id}/${action}`, token);
      onSaved(updated);
      setSuggestion({ ...suggestion, status: action === 'apply' ? 'applied' : 'undone' });
    });
  }

  function applyTemplate(template: Template, action: 'keep' | 'replace') {
    void withDraft(async (draft) => {
      const updated = await draftWrite(draft, token, '/template', {
        template_id: template.id,
        template_version: template.published_version,
        prompt_action: action,
      });
      onSaved(updated);
      onEdit(draft.id, action === 'keep' && value.prompt !== updated.prompt
        ? {
            prompt: value.prompt,
            parameters: updated.parameters,
            video: updated.video_parameters ?? undefined,
          }
        : undefined);
      closePromptTool();
    });
  }

  function addMaterial(operation: (draft: Draft) => Promise<Draft>) {
    void withDraft(async (draft) => {
      onSaved(await operation(draft));
      setPanel(undefined);
    });
  }

  function uploadMaterial(file: File, asProductPhoto: boolean) {
    const videoFile = isVideo && !asProductPhoto && file.type === 'video/mp4';
    if (file.size > (videoFile ? 100 : 10) * 1024 * 1024) {
      setFeedback({ id: editorId, message: videoFile ? '视频不能超过 100 MB。' : '图片不能超过 10 MB。', error: true });
      return;
    }
    addMaterial(async (draft) => {
      if (!asProductPhoto) return uploadReference(draft, token, file);
      const id = await uploadPhoto(file, token);
      const updated = await updateFacts(
        product.id,
        {
          expected_version: product.version,
          photo_ids: [...product.photos.map((photo) => photo.file_id), id],
        },
        token,
      );
      onProductSaved(updated);
      const photo = updated.photos.find((item) => item.file_id === id);
      if (!photo) throw new Error('找不到刚上传的商品实拍。');
      try {
        return await addProductPhotoReference(draft, token, photo);
      } catch (cause) {
        throw new Error(
          `实拍已保存到商品资料。加入本次生成失败，可重新选择该实拍。${actionError(cause)}`,
        );
      }
    });
  }
  return (
    <section className="studio-quick" aria-label="快捷创作">
      <div className="studio-composer">
        <div className="studio-editor-row">
          <button
            type="button"
            className="studio-reference"
            aria-label="参考素材"
            title="参考素材"
            disabled={disabled}
            onClick={() => setPanel(isVideo ? 'reference' : 'product')}
          >
            <PlusOutlined aria-hidden="true" />
          </button>
          <div className="studio-input">
            <textarea
              aria-label="提示词"
              maxLength={6000}
              rows={2}
              disabled={disabled}
              value={value.prompt}
              placeholder={isVideo ? '描述你想生成的视频画面' : '描述你想生成的画面'}
              onChange={(e) => change({ ...value, prompt: e.target.value })}
            />
            {selected && (
              <SelectedQuickMaterials
                draft={selected}
                disabled={disabled}
                remove={(ref) =>
                  void withDraft(async (draft) => onSaved(await removeReference(draft, token, ref.id)))
                }
              />
            )}
          </div>
        </div>
        <div className="studio-toolbar">
          <b>
            {isVideo ? <VideoCameraOutlined aria-hidden="true" /> : <PictureOutlined aria-hidden="true" />}{' '}
            {isVideo ? '视频生成' : '图片生成'}
          </b>
          <QuickParameters key={editorId} value={value} targetSpec={targetSpec} disabled={disabled} onChange={change} />
          <div className="studio-prompt-actions">
            <button type="button" aria-haspopup="dialog" disabled={disabled || !value.prompt.trim()}
              onClick={optimizePrompt}>
              <ThunderboltOutlined aria-hidden="true" /> 优化提示词
            </button>
            <button type="button" aria-haspopup="dialog" disabled={disabled} onClick={() => {
              setFeedback(undefined);
              setPanel('template');
            }}>
              <FileTextOutlined aria-hidden="true" />{' '}
              {selected?.template_version ? `切换模板 · V${selected.template_version}` : '应用模板'}
            </button>
          </div>
          {isVideo && (
            <button type="button" disabled={disabled} onClick={() => void withDraft(async () => setPanel('storyboard'))}>
              <ProfileOutlined aria-hidden="true" />{' '}
              {selected?.storyboard && !edits && selected.storyboard.confirmed_version === selected.version &&
                selected.storyboard.product_fact_version === product.fact_version ? '已确认分镜' : '成片分镜'}
            </button>
          )}
          <button
            type="button"
            className="work-primary studio-save"
            disabled={disabled || execution.inProgress || !value.prompt.trim()}
            onClick={() =>
              void withDraft(
                async (draft) => {
                  const updated = await saveInputs(draft);
                  await execution.submit(updated);
                },
                spec.count ?? 1,
              )
            }
          >
            <ArrowRightOutlined aria-hidden="true" />{' '}
            {execution.inProgress ? '制作中' : isVideo ? '生成视频' : '生成图片'}
          </button>
        </div>
        {editorFeedback && panel !== 'optimize' && panel !== 'template' && (
          <div
            className="studio-generation-feedback"
            data-error={editorFeedback.error || undefined}
            role={editorFeedback.error ? 'alert' : 'status'}
          >
            {editorFeedback.error && <ExclamationCircleOutlined aria-hidden="true" />}
            <span>{editorFeedback.message}</span>
          </div>
        )}
      </div>
      <div className="studio-shortcuts" aria-label="快捷提示词">
        {labels.map((label, i) => (
          <button
            key={label}
            disabled={disabled}
            aria-pressed={value.prompt === prompts[i]}
            onClick={() => change({ ...value, prompt: prompts[i] })}
          >
            / &nbsp;{label}
          </button>
        ))}
        <button disabled={disabled} onClick={() => setPanel('reference')}>
          更多灵感 ›
        </button>
      </div>
      {(panel === 'product' || panel === 'reference') && (
        <QuickMaterials
          product={product}
          purpose={purpose}
          categories={categories}
          references={references}
          startWith={panel}
          busy={disabled}
          error={feedback?.error ? feedback.message : undefined}
          onClose={() => {
            setPanel(undefined);
            setFeedback(undefined);
          }}
          onPhoto={(photo) => addMaterial((draft) => addProductPhotoReference(draft, token, photo))}
          onUploadPhoto={(file) => uploadMaterial(file, true)}
          onUpload={(file) => uploadMaterial(file, false)}
          onCase={(id) =>
            addMaterial((draft) =>
              draftWrite(draft, token, '/references', { kind: 'case', source_id: id }),
            )
          }
        />
      )}
      {panel === 'template' && (
        <TemplatePicker
          category={product.category}
          purpose={purpose}
          hasPrompt={Boolean(value.prompt.trim())}
          busy={busy}
          error={editorFeedback?.message ?? ''}
          onClose={closePromptTool}
          onApply={applyTemplate}
          onClear={selected?.template_id ? () => void withDraft(async (draft) => {
            onSaved(await draftWrite(draft, token, '/template/clear', {}));
            closePromptTool();
          }) : undefined}
        />
      )}
      {panel === 'optimize' && (
        <Modal title="优化提示词" busy={busy} onClose={closePromptTool}>
          <div className="work-form">
            {busy && !suggestion && <p role="status">正在优化提示词…</p>}
            {editorFeedback?.error && <p role="alert" className="work-error">{editorFeedback.message}</p>}
            {suggestion?.status === 'unverified' && (
              <p role="alert" className="work-error">辅助调用待核实，请查看调用记录。</p>
            )}
            {suggestion?.suggestion && <p className="creative-prewrap">{suggestion.suggestion}</p>}
            {suggestion?.status === 'ready' && (
              <div className="work-actions">
                <button type="button" className="work-primary"
                  disabled={busy || !!edits || suggestion.source_version !== selected?.version}
                  onClick={() => updateSuggestion('apply')}>
                  采用建议
                </button>
              </div>
            )}
            {suggestion?.status === 'applied' && (
              <div className="work-actions">
                <span role="status">已采用建议</span>
                <button type="button" disabled={busy} onClick={() => updateSuggestion('undo')}>
                  撤销建议
                </button>
              </div>
            )}
            {suggestion?.status === 'undone' && <p role="status">已恢复原提示词</p>}
          </div>
        </Modal>
      )}
      {panel === 'storyboard' && selected && value.video && (
        <StoryboardDialog draft={selected} product={product} video={value.video} token={token}
          prepare={() => saveInputs(selected)} onSaved={onSaved} onClose={() => setPanel(undefined)} />
      )}
    </section>
  );
}
