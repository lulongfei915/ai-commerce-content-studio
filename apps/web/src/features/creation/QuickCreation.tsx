import { useRef, useState } from 'react';
import {
  ArrowRightOutlined,
  ControlOutlined,
  ExclamationCircleOutlined,
  PictureOutlined,
  PlusOutlined,
  VideoCameraOutlined,
  DownOutlined,
  AppstoreOutlined,
} from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import { updateFacts, uploadPhoto, type Category, type Product } from '../products/api';
import { CreationEditor } from './CreationEditor';
import { ParametersFields } from './ParametersFields';
import { QuickMaterials, SelectedQuickMaterials } from './QuickMaterials';
import { VideoFields } from './VideoFields';
import {
  actionError,
  addProductPhotoReference,
  defaults,
  draftWrite,
  imageModelLabel,
  referencePreview,
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
  const [panel, setPanel] = useState<'settings' | 'specs' | 'product' | 'reference'>();
  const [feedback, setFeedback] = useState<{ id: string; message: string; error?: boolean }>();
  const isVideo = purpose === 'video';
  const working = useRef(false);
  const value: DraftEdits = edits ?? {
    prompt: selected?.prompt ?? '',
    parameters: selected?.parameters ?? defaults,
    video:
      selected?.video_parameters ??
      (isVideo
        ? { model: 'seedance-2.0', ratio: '16:9', resolution: '720p', duration: 5, count: 1 }
        : undefined),
  };
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
      if (!draft) return;
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
    if (!edits) return draft;
    const updated = await saveDraftInputs(draft, token, edits);
    onSaved(updated);
    onEdit(draft.id, undefined);
    return updated;
  }

  function addMaterial(operation: (draft: Draft) => Promise<Draft>) {
    void withDraft(async (draft) => {
      onSaved(await operation(draft));
      setPanel(undefined);
    });
  }

  function uploadMaterial(file: File, asProductPhoto: boolean) {
    if (file.size > 10 * 1024 * 1024) {
      setFeedback({ id: editorId, message: '图片不能超过 10 MB。', error: true });
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
        <div className="studio-input">
          <button
            className="studio-reference"
            disabled={disabled}
            aria-label={isVideo ? '参考素材' : '添加素材'}
            onClick={() => setPanel(isVideo ? 'reference' : 'product')}
          >
            <PlusOutlined aria-hidden="true" />
            <span>
              {isVideo ? '参考素材' : '添加素材'}
              {references.length ? ` ${references.length}` : ''}
            </span>
          </button>
          <textarea
            aria-label="提示词"
            maxLength={6000}
            disabled={disabled}
            value={value.prompt}
            placeholder={
              hasPhotos
                ? `描述你想要的画面，或添加参考。商品外观以${product.name}实拍为准。`
                : '描述你想要的画面，也可以添加参考素材。'
            }
            onChange={(e) => change({ ...value, prompt: e.target.value })}
          />
        </div>
        {selected && (
          <SelectedQuickMaterials
            draft={selected}
            disabled={disabled}
            remove={(ref) =>
              void withDraft(async (draft) => onSaved(await removeReference(draft, token, ref.id)))
            }
          />
        )}
        <div className="studio-toolbar">
          <b>
            {isVideo ? <VideoCameraOutlined /> : <PictureOutlined />}{' '}
            {isVideo ? '视频生成' : '图片生成'}
          </b>
          <span>
            <AppstoreOutlined />{' '}
            {isVideo ? 'Seedance 2.0' : imageModelLabel(value.parameters.model)}
          </span>
          <button disabled={disabled} onClick={() => setPanel('specs')}>
            {spec.ratio} · {spec.resolution} <DownOutlined />
          </button>
          <button disabled={disabled} onClick={() => setPanel('specs')}>
            {spec.count} {isVideo ? '条' : '张'} <DownOutlined />
          </button>
          <button
            disabled={disabled}
            onClick={() => void withDraft(async () => setPanel('settings'))}
          >
            <ControlOutlined /> 创作设置
          </button>
          <button
            className="work-primary studio-save"
            disabled={disabled || execution.inProgress || !value.prompt.trim()}
            onClick={() =>
              void withDraft(
                async (draft) => {
                  const updated = await saveInputs(draft);
                  await execution.submit(updated);
                },
                spec.count,
              )
            }
          >
            <ArrowRightOutlined aria-hidden="true" />{' '}
            {execution.inProgress ? '制作中' : isVideo ? '生成视频' : '生成图片'}
          </button>
        </div>
        {feedback?.id === editorId && (
          <div
            className="studio-generation-feedback"
            data-error={feedback.error || undefined}
            role={feedback.error ? 'alert' : 'status'}
          >
            {feedback.error && <ExclamationCircleOutlined aria-hidden="true" />}
            <span>{feedback.message}</span>
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
      {panel === 'specs' && (
        <Modal title="画面规格" onClose={() => setPanel(undefined)}>
          <div className="work-form">
            {value.video ? (
              <VideoFields value={value.video} onChange={(video) => change({ ...value, video })} />
            ) : (
              <ParametersFields
                value={value.parameters}
                onChange={(parameters) => change({ ...value, parameters })}
              />
            )}
          </div>
        </Modal>
      )}
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
      {panel === 'settings' && selected && (
        <Modal title="创作设置" busy={busy} onClose={() => setPanel(undefined)}>
          <CreationEditor
            draft={selected}
            product={product}
            token={token}
            categories={categories}
            edits={edits}
            onEdit={(next) => onEdit(editorId, next)}
            onSaved={onSaved}
            onBusy={onBusy}
            imageExecution={execution}
            previewUrl={isVideo ? undefined : (ref) => referencePreview(selected, ref)}
          />
        </Modal>
      )}
    </section>
  );
}
