import { useRef, useState, type ReactNode } from 'react';
import {
  AppstoreOutlined,
  BulbOutlined,
  CameraOutlined,
  CloseCircleOutlined,
  DownOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  PlusOutlined,
  ThunderboltFilled,
  VideoCameraOutlined,
} from '@ant-design/icons';
import { Modal } from '../../shared/ui/Modal';
import type { Product } from '../products/api';
import { photoPreviewUrl } from '../products/preview';
import type { Draft, DraftEdits } from './api';
import { CompanyAssetPicker } from './CompanyAssetPicker';
import { ImageExecutionStatus } from './ImageExecutionStatus';
import { ImageProduction } from './ImageProduction';
import { QuickParameters } from './QuickParameters';
import { useImageExecution } from './useImageExecution';
import './canvas-composer.css';

type Props = {
  draft: Draft;
  product: Product;
  token: string;
  values: DraftEdits;
  busy: boolean;
  dangling: boolean;
  promptField: ReactNode;
  references: ReactNode;
  canvasReference?: ReactNode;
  settings: ReactNode;
  storyboard?: ReactNode;
  feedback: ReactNode;
  onSaved: (draft: Draft) => void;
  onPrompt: (prompt: string) => void;
  onChangeParameters: (values: DraftEdits) => void;
  onTemplate: () => void;
  onClearTemplate: () => void;
  onCase: () => void;
  onUpload: (file?: File) => void;
  onPickPhoto: (photo: Product['photos'][number]) => void;
  onResetParameters: () => void;
  onPreparePromptTools: () => Promise<boolean>;
  onGenerate: (submit: (draft: Draft) => Promise<void>) => Promise<void>;
};

export function CanvasComposer(props: Props) {
  const { draft, product, token, values, busy } = props;
  const [section, setSection] = useState<'photos' | 'specs' | 'tools'>();
  const upload = useRef<HTMLInputElement>(null);
  const isVideo = draft.purpose === 'video';
  const execution = useImageExecution(draft, token);
  const parameters = values.parameters;
  const video = values.video;
  const photo = product.photos[0];
  const generating = execution.inProgress;
  const templateLabel = draft.template_version
    ? `切换模板 · V${draft.template_version}`
    : '应用模板';

  return (
    <div className="canvas-composer" data-media={isVideo ? 'video' : 'image'}>
      <div className="composer-writing-surface">
        <div className="composer-prompt-actions" role="group" aria-label="编辑工具">
          <button type="button" disabled={busy} onClick={() => upload.current?.click()}>
            <PlusOutlined /> {isVideo ? '上传参考素材' : '上传参考图'}
          </button>
          <input
            type="file"
            hidden
            ref={upload}
            aria-label={isVideo ? '上传参考素材' : '上传参考图'}
            accept={`image/jpeg,image/png,image/webp${isVideo ? ',video/mp4' : ''}`}
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              props.onUpload(file);
            }}
          />
          {props.canvasReference}
          <button type="button" disabled={busy || props.dangling} onClick={async () => {
            if (await props.onPreparePromptTools()) setSection('tools');
          }}>
            <BulbOutlined /> 提示词工具
          </button>
          <div className="composer-source-tools" role="group" aria-label="创作素材">
            <button
              type="button"
              disabled={busy}
              title="商品实拍"
              aria-label="商品实拍"
              onClick={() => setSection('photos')}
            >
              {photo ? (
                <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" />
              ) : (
                <CameraOutlined aria-hidden="true" />
              )}
            </button>
            <button
              type="button"
              disabled={busy}
              title={templateLabel}
              aria-label={templateLabel}
              onClick={props.onTemplate}
            >
              <AppstoreOutlined aria-hidden="true" />
            </button>
            {draft.template_id && (
              <button
                type="button"
                disabled={busy}
                title="取消应用模板"
                aria-label="取消应用模板"
                onClick={props.onClearTemplate}
              >
                <CloseCircleOutlined aria-hidden="true" />
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              title="添加案例"
              aria-label="添加案例"
              onClick={props.onCase}
            >
              <PictureOutlined aria-hidden="true" />
            </button>
            <CompanyAssetPicker draft={draft} token={token} onSaved={props.onSaved} disabled={busy}>
              <FolderOpenOutlined aria-hidden="true" />
            </CompanyAssetPicker>
          </div>
        </div>
        {props.references}
        {props.promptField}
        <div className="composer-feedback" aria-live="polite">
          {props.feedback}
          <ImageExecutionStatus execution={execution} disabled={busy} />
        </div>
        <footer className="composer-bar" role="group" aria-label="生成设置">
          {isVideo ? (
            <button
              className="composer-spec-trigger"
              type="button"
              disabled={busy}
              aria-label="视频参数"
              title="选择模型与画面规格"
              onClick={() => setSection('specs')}
            >
              <span><VideoCameraOutlined aria-hidden="true" /> Seedance 2.0</span>
              {video && <span className="composer-spec-size">
                {`${video.ratio} · ${video.resolution} · ${video.duration}s · ${video.count} 条`}
              </span>}
              <DownOutlined aria-hidden="true" />
            </button>
          ) : (
            <div className="canvas-image-parameters">
              <QuickParameters value={values} onChange={props.onChangeParameters} disabled={busy}
                canvas={{ onReset: props.onResetParameters }} />
            </div>
          )}
          <div className="composer-submit-actions">
            {props.storyboard}
            <button
              type="button"
              className="image-generate"
              disabled={busy || generating || props.dangling || !values.prompt.trim()}
              onClick={() => void props.onGenerate(execution.submit)}
            >
              <ThunderboltFilled aria-hidden="true" />{' '}
              {generating ? '生成中' : isVideo ? '生成视频' : `生成 ${parameters.count} 张`}
            </button>
          </div>
        </footer>
      </div>
      {section === 'photos' && (
        <Modal title="商品实拍" onClose={() => setSection(undefined)}>
          <p>
            {product.name} · {product.sku}
          </p>
          <div className="composer-bound-photos">
            {product.photos.map((item, index) => {
              const added = draft.references.some((ref) => ref.file_id === item.file_id);
              return (
                <figure key={item.file_id}>
                  <img
                    src={photoPreviewUrl(product.id, item.file_id)}
                    alt={`${product.name}实拍 ${index + 1}`}
                  />
                  <figcaption>
                    实拍 {index + 1} · V{item.version}
                  </figcaption>
                  <button
                    type="button"
                    disabled={busy || added}
                    onClick={() => {
                      setSection(undefined);
                      props.onPickPhoto(item);
                    }}
                  >
                    {added ? `已添加实拍 ${index + 1}` : `添加实拍 ${index + 1}`}
                  </button>
                </figure>
              );
            })}
          </div>
          {!photo && <p>此商品暂无实拍。</p>}
        </Modal>
      )}
      {section === 'specs' && (
        <Modal title="视频参数" onClose={() => setSection(undefined)}>
          {props.settings}
          <div className="work-actions">
            <button type="button" disabled={busy} onClick={props.onResetParameters}>
              恢复默认参数
            </button>
          </div>
        </Modal>
      )}
      {section === 'tools' && (
        <Modal title="提示词工具" onClose={() => setSection(undefined)}>
          <ImageProduction
            draft={draft}
            token={token}
            execution={execution}
            promptToolsOnly
            disabled={busy || props.dangling}
            onSaved={props.onSaved}
            onPrompt={(value) => {
              props.onPrompt(value);
              setSection(undefined);
            }}
          />
        </Modal>
      )}
    </div>
  );
}
