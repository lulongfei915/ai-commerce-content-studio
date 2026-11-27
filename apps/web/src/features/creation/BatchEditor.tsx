import { useEffect, useState, type ReactNode } from 'react';
import { DownOutlined, PlusOutlined, RightOutlined, ThunderboltOutlined, UndoOutlined } from '@ant-design/icons';

import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { isSelectPickerOpen } from '../../shared/ui/selectPicker';
import { CaseBrowser } from '../cases/CaseBrowser';
import type { Category, Product } from '../products/api';
import { photoPreviewUrl } from '../products/preview';
import { TemplatePicker } from '../templates/TemplatePicker';
import { actionError, addProductPhotoReference, defaultVideo, defaults, draftWrite, imageModelLabel, referencePreview, removeReference,
  saveDraftInputs, uploadReference, type Draft, type DraftEdits } from './api';
import { BatchPhoto } from './BatchList';
import { DraftReferenceList } from './DraftReferenceList';
import { ParametersFields } from './ParametersFields';
import { StoryboardControl } from './StoryboardControl';
import { VideoFields } from './VideoFields';

const presets = {
  image: [
    ['简洁棚拍', '使用干净的棚拍背景与柔和光线，保持商品外观与实拍一致。'],
    ['日常场景', '将商品置于自然的日常场景中，背景保持克制。'],
    ['细节特写', '聚焦实拍中可确认的结构细节，避免添加未知材质或功能。'],
  ],
  video: [
    ['全貌到细节', '先展示商品全貌，再平稳推进到可确认的细节。'],
    ['平稳环绕', '使用平稳的环绕镜头，保持商品轮廓与比例一致。'],
    ['细节展示', '以短镜头展示实拍中可确认的细节。'],
  ],
};

type Suggestion = components['schemas']['AssistanceView'];
type PromptCard = components['schemas']['Card'];

export function BatchEditor({ draft, product, categories, token, purpose, busy, edits, onEdit,
  onSaved, onBusy, onScope, onReferences, references }: {
  draft: Draft;
  product: Product;
  categories: Category[];
  token: string;
  purpose: string;
  busy: boolean;
  edits?: DraftEdits;
  onEdit: (edits: DraftEdits | undefined) => void;
  onSaved: (draft: Draft) => void;
  onBusy: (busy: boolean) => void;
  onScope: () => void;
  onReferences: () => void;
  references?: ReactNode;
}) {
  const isVideo = draft.purpose === 'video';
  const original = {
    prompt: draft.prompt, parameters: draft.parameters ?? defaults,
    video: isVideo ? draft.video_parameters ?? defaultVideo : undefined,
  };
  const value = edits ?? original;
  const specs = value.video ?? value.parameters;
  const [template, setTemplate] = useState(false);
  const [browsingCase, setBrowsingCase] = useState(false);
  const [parameterMenu, setParameterMenu] = useState<'model' | 'specs'>();
  const [issue, setIssue] = useState('');
  const [undo, setUndo] = useState<string>();
  const [suggestion, setSuggestion] = useState<Suggestion>();
  const [cards, setCards] = useState<PromptCard[]>();
  const path = `/creations/${draft.id}/assistances`;
  const inherited = !draft.batch_overrides?.includes('prompt') && value.prompt === original.prompt;
  const availablePhotos = product.photos.filter(
    (photo) => !draft.references.some((reference) => reference.file_id === photo.file_id),
  );

  useEffect(() => {
    if (references) return;
    const request = new AbortController();
    void apiFetch<Suggestion[]>(path, { signal: request.signal }).then(([latest]) => {
      if (!request.signal.aborted) setSuggestion(latest);
    }).catch(() => {});
    return () => request.abort();
  }, [path, references]);

  function edit(next: DraftEdits) {
    onEdit(JSON.stringify(next) === JSON.stringify(original) ? undefined : next);
    setIssue('');
  }

  function append(text: string) {
    const prompt = [value.prompt.trimEnd(), text].filter(Boolean).join('\n');
    if (prompt.length > 6000) {
      setIssue('提示词最多 6000 字，请先精简。');
      return;
    }
    setUndo(value.prompt);
    edit({ ...value, prompt });
  }

  async function run(action: () => Promise<void>) {
    if (busy) return;
    onBusy(true);
    setIssue('');
    try {
      await action();
    } catch (cause) {
      setIssue(actionError(cause));
    } finally {
      onBusy(false);
    }
  }

  async function prepare() {
    if (!edits) return draft;
    const saved = await saveDraftInputs(draft, token, edits);
    onSaved(saved);
    onEdit(undefined);
    return saved;
  }

  const pane = references ? (
    <div className="work-form batch-reference-view">
      {availablePhotos.length > 0 && <div className="batch-photo-options">
        <strong>商品实拍</strong>
        {availablePhotos.map((photo, index) => (
          <button key={photo.file_id} type="button" className="batch-plain" disabled={busy}
            onClick={() => void run(async () => {
              onSaved(await addProductPhotoReference(await prepare(), token, photo));
            })}>
            <img src={photoPreviewUrl(product.id, photo.file_id)} alt="" />
            添加实拍 {index + 1}
          </button>
        ))}
      </div>}
      <label className="creative-upload">
        上传参考素材
        <input type="file" accept={`image/jpeg,image/png,image/webp${isVideo ? ',video/mp4' : ''}`} disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (!file) return;
            void run(async () => onSaved(await uploadReference(await prepare(), token, file)));
          }} />
      </label>
      {draft.references.length > 0 && <DraftReferenceList draft={draft} busy={busy}
        preview={(ref) => referencePreview(draft, ref)}
        insert={(ref) => append(`[[ref:${ref.id}]]`)}
        remove={(ref) => void run(async () => onSaved(await removeReference(await prepare(), token, ref.id)))}
        updateUsage={(ref, usage) => void run(async () => {
          onSaved(await draftWrite(await prepare(), token, `/references/${ref.id}`, { usage }, 'PATCH'));
        })} />}
      <button type="button" onClick={() => setBrowsingCase(!browsingCase)} disabled={busy}
        aria-expanded={browsingCase}>
        <PlusOutlined /> 添加案例参考
      </button>
      {browsingCase && <CaseBrowser categories={categories} category={product.category}
        purpose={draft.purpose} imageOnly={!isVideo} allowVideo={isVideo} disabled={busy}
        onPick={(item) => void run(async () => {
          onSaved(await draftWrite(await prepare(), token, '/references', { kind: 'case', source_id: item.id }));
          setBrowsingCase(false);
        })} />}
      {references}
    </div>
  ) : (
    <>
      <button type="button" className="batch-plain batch-context" aria-label="商品与用途"
        onClick={onScope} disabled={busy}>
        <BatchPhoto product={product} />
        <span><strong>{product.name}</strong><small>{product.sku} · {purpose}</small></span>
        <RightOutlined />
      </button>
      <div className="batch-composer">
        <div className="batch-composer-heading">
          <label htmlFor={`batch-prompt-${draft.id}`}>提示词</label>
          <small>{inherited ? '沿用公共默认' : '已单独调整'}</small>
        </div>
        <textarea id={`batch-prompt-${draft.id}`} maxLength={6000} disabled={busy}
          placeholder={isVideo ? '描述镜头、动作与场景。' : '描述画面、光线与构图，也可以添加参考素材。'}
          value={value.prompt} onChange={(event) => edit({ ...value, prompt: event.target.value })} />
        <div className="batch-composer-tools">
          <button type="button" className="batch-plain" disabled={busy} onClick={onReferences}>
            {draft.references[0]?.media === 'image'
              ? <img src={referencePreview(draft, draft.references[0])} alt="" />
              : <PlusOutlined />}
            {draft.references.length ? `参考 · ${draft.references.length}` : '添加参考'}
          </button>
          <button type="button" className="batch-plain" disabled={busy || !value.prompt.trim()}
            onClick={() => void run(async () => {
              const saved = await prepare();
              setSuggestion(await apiWrite<Suggestion>(path, token, {
                kind: 'optimize', expected_version: saved.version,
              }));
            })}><ThunderboltOutlined /> 优化提示词</button>
        </div>
        <div className="batch-parameter-bar" onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setParameterMenu(undefined);
        }} onKeyDown={(event) => {
          if (event.key !== 'Escape' || !parameterMenu || isSelectPickerOpen(event.target)) return;
          event.currentTarget.querySelector<HTMLButtonElement>('[aria-expanded="true"]')?.focus();
          setParameterMenu(undefined);
          event.preventDefault();
          event.stopPropagation();
        }}>
          <button type="button" className="batch-plain" aria-label="生成模型"
            aria-expanded={parameterMenu === 'model'} disabled={busy}
            onClick={() => setParameterMenu(parameterMenu === 'model' ? undefined : 'model')}>
            {value.video ? (value.video.model === 'seedance-2.5' ? 'Seedance 2.5' : 'Seedance 2.0')
              : imageModelLabel(value.parameters.model)} <DownOutlined />
          </button>
          <button type="button" className="batch-plain" aria-label="画面规格"
            aria-expanded={parameterMenu === 'specs'} disabled={busy}
            onClick={() => setParameterMenu(parameterMenu === 'specs' ? undefined : 'specs')}>
            {specs.ratio} · {specs.resolution}{value.video ? ` · ${value.video.duration}s` : ''} <DownOutlined />
          </button>
          <select aria-label={isVideo ? '输出条数' : '输出张数'} disabled={busy} value={specs.count ?? 1}
            onChange={(event) => {
              const count = Number(event.target.value);
              if (value.video) edit({ ...value, video: { ...value.video, count } });
              else edit({ ...value, parameters: { ...value.parameters, count } });
            }}>
            {[1, 2, 3, 4, 5, 6].map((count) => (
              <option key={count} value={count}>{count} {isVideo ? '条' : '张'}</option>
            ))}
          </select>
          {parameterMenu && <fieldset className="batch-parameter-popover work-form" disabled={busy}
            aria-label={parameterMenu === 'model' ? '生成模型' : '画面规格'}>
            {value.video ? <VideoFields value={value.video} group={parameterMenu}
              onChange={(video) => edit({ ...value, video })} />
              : <ParametersFields value={value.parameters} group={parameterMenu}
                onChange={(parameters) => edit({ ...value, parameters })} />}
          </fieldset>}
        </div>
      </div>
      <div className="batch-template-line">
        <small>{draft.template_version ? `公司模板 · V${draft.template_version}` : '未选模板'}</small>
        <button type="button" className="batch-plain" disabled={busy} onClick={() => setTemplate(true)}>选择公司模板</button>
        {draft.template_id && <button type="button" className="batch-plain" disabled={busy}
          onClick={() => void run(async () => onSaved(await draftWrite(await prepare(), token, '/template/clear', {})))}>
          移除模板
        </button>}
      </div>
      <div className="batch-shortcuts">
        {presets[isVideo ? 'video' : 'image'].map(([label, text]) => (
          <button key={label} type="button" className="batch-plain" disabled={busy} onClick={() => append(text)}>{label}</button>
        ))}
        <button type="button" className="batch-plain" disabled={busy} onClick={onReferences}>更多灵感 <RightOutlined /></button>
        <details>
          <summary onClick={() => {
            if (!cards) void apiFetch<PromptCard[]>('/prompt-cards').then(setCards)
              .catch(() => setIssue('快捷词未加载。'));
          }}>快捷词 <DownOutlined /></summary>
          <div className="batch-parameter-popover">
            {cards?.filter((card) => (card.media ?? 'image') === (isVideo ? 'video' : 'image'))
              .map((card) => <button key={card.id} type="button" className="batch-plain"
              disabled={busy} onClick={() => append(card.prompt)}>{card.title}</button>)}
            {cards?.length === 0 && <small>暂无快捷词</small>}
          </div>
        </details>
        {undo !== undefined && <button type="button" className="batch-plain batch-icon" title="撤销追加提示词"
          aria-label="撤销追加提示词" disabled={busy} onClick={() => {
            edit({ ...value, prompt: undo });
            setUndo(undefined);
          }}><UndoOutlined /></button>}
      </div>
      {suggestion?.suggestion && (
        <div className="batch-suggestion">
          <p>{suggestion.suggestion}</p>
          <button type="button" className="batch-plain"
            disabled={busy || Boolean(edits) || (suggestion.status === 'ready'
              ? draft.version !== suggestion.source_version : suggestion.status !== 'applied')}
            onClick={() => void run(async () => {
              const apply = suggestion.status === 'ready';
              onSaved(await apiWrite<Draft>(`/assistances/${suggestion.id}/${apply ? 'apply' : 'undo'}`, token));
              setSuggestion(apply ? { ...suggestion, status: 'applied' } : undefined);
            })}>{suggestion.status === 'applied' ? '撤销建议' : '采用建议'}</button>
        </div>
      )}
      {suggestion && !suggestion.suggestion && <small>提示词建议尚未就绪</small>}
      <div className="work-actions batch-editor-actions">
        {value.video && <StoryboardControl draft={draft} product={product} video={value.video}
          token={token} busy={busy} dirty={Boolean(edits)} prepare={async () => {
            onBusy(true);
            try { return await prepare(); } finally { onBusy(false); }
          }} onSaved={onSaved} />}
        {edits && <button type="button" className="batch-plain" disabled={busy}
          onClick={() => void run(async () => { await prepare(); })}>保存草稿</button>}
      </div>
    </>
  );
  return (
    <div className="batch-compose-area" aria-label="创作编辑器">
      {pane}
      {issue && !template && <p role="alert" className="work-error">{issue}</p>}
      {template && <TemplatePicker category={product.category} purpose={draft.purpose}
        hasPrompt={Boolean(value.prompt.trim())} busy={busy} error={issue} onClose={() => setTemplate(false)}
        onApply={(selected, action) => void run(async () => {
          const saved = await prepare();
          onSaved(await draftWrite(saved, token, '/template', {
            template_id: selected.id, template_version: selected.published_version, prompt_action: action,
          }));
          setTemplate(false);
        })} />}
    </div>
  );
}
