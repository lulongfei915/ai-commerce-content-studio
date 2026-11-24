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
import type { Category, Product } from '../products/api';
import { CaseBrowser } from '../cases/CaseBrowser';
import { CreationEditor } from './CreationEditor';
import { ImageExecutionStatus } from './ImageExecutionStatus';
import { ParametersFields } from './ParametersFields';
import { VideoFields } from './VideoFields';
import {
  actionError,
  defaults,
  draftWrite,
  saveDraftInputs,
  type Draft,
  type DraftEdits,
} from './api';
import { useImageExecution } from './useImageExecution';

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
  onEdit: (id: string, edits: DraftEdits | undefined) => void;
  onBusy: (busy: boolean) => void;
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
  onEdit,
  onBusy,
}: Props) {
  const [panel, setPanel] = useState<'settings' | 'case' | 'specs'>();
  const [feedback, setFeedback] = useState<{ id: string; message: string; error?: boolean }>();
  const isVideo = purpose === 'video';
  const execution = useImageExecution(isVideo ? undefined : selected, token);
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
        '近距离拍摄实拍可见的结构，用柔和侧光表现层次。',
      ];
  const hasPhotos = product.photos.length > 0;
  const prompts = phrases.map(
    (phrase) => `以${product.name}${hasPhotos ? '实拍' : ''}为主体，${phrase}`,
  );
  const disabled = busy || loading;

  function change(next: DraftEdits) {
    onEdit(editorId, next);
    setFeedback(undefined);
  }
  async function withDraft(operation: (draft: Draft) => Promise<void>) {
    if (disabled || working.current) return;
    working.current = true;
    onBusy(true);
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
  return (
    <section className="studio-quick" aria-label="快捷创作">
      <div className="studio-composer">
        <div className="studio-input">
          <button className="studio-reference" disabled={disabled} onClick={() => setPanel('case')}>
            <PlusOutlined />
            <span>
              参考素材{selected?.references.length ? ` ${selected.references.length}` : ''}
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
        <div className="studio-toolbar">
          <b>
            {isVideo ? <VideoCameraOutlined /> : <PictureOutlined />}{' '}
            {isVideo ? '视频生成' : '图片生成'}
          </b>
          <span>
            <AppstoreOutlined /> {isVideo ? 'Seedance 2.0' : 'Seedream 5.5'}
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
            disabled={disabled || (isVideo ? !edits : execution.inProgress || !value.prompt.trim())}
            onClick={() =>
              void withDraft(async (draft) => {
                setFeedback(undefined);
                const updated = await saveInputs(draft);
                if (isVideo) {
                  setFeedback({ id: draft.id, message: '草稿已保存' });
                  return;
                }
                await execution.submit(updated);
              })
            }
          >
            <ArrowRightOutlined aria-hidden="true" />{' '}
            {isVideo ? '保存草稿' : execution.inProgress ? '制作中' : '生成图片'}
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
        <button disabled={disabled} onClick={() => setPanel('case')}>
          更多灵感 ›
        </button>
      </div>
      {selected && !isVideo && execution.job && (
        <ImageExecutionStatus
          key={`${selected.id}:${execution.job.id}`}
          execution={execution}
          disabled={disabled}
        />
      )}
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
      {panel === 'case' && (
        <Modal title="添加案例参考" busy={busy} onClose={() => setPanel(undefined)}>
          <CaseBrowser
            categories={categories}
            category={product.category}
            purpose={purpose}
            imageOnly={!isVideo}
            allowVideo={isVideo}
            disabled={busy}
            onPick={(item) =>
              void withDraft(async (draft) => {
                onSaved(
                  await draftWrite(draft, token, '/references', {
                    kind: 'case',
                    source_id: item.id,
                  }),
                );
                setPanel(undefined);
              })
            }
          />
          {feedback?.error && <p role="alert">{feedback.message}</p>}
        </Modal>
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
          />
        </Modal>
      )}
    </section>
  );
}
