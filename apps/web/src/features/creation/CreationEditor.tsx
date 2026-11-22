import { useEffect, useState } from 'react';

import { uploadMedia } from '../../shared/api/upload';
import { Modal } from '../../shared/ui/Modal';
import { CaseBrowser } from '../cases/CaseBrowser';
import { casePreview } from '../cases/api';
import type { Category, Product } from '../products/api';
import { photoPreviewUrl } from '../products/preview';
import { TemplatePicker } from '../templates/TemplatePicker';
import { ParametersFields } from './ParametersFields';
import { actionError, checkDraft, defaults, draftWrite, issueText, removeReference } from './api';
import type { Draft, Issue, Parameters } from './api';
import './creation.css';

export function CreationEditor({
  draft,
  product,
  categories,
  token,
  onSaved,
  onDirty,
}: {
  draft: Draft;
  product: Product;
  categories: Category[];
  token: string;
  onSaved: (draft: Draft) => void;
  onDirty: (dirty: boolean) => void;
}) {
  const [prompt, setPrompt] = useState(draft.prompt);
  const [parameters, setParameters] = useState<Parameters>(draft.parameters ?? defaults);
  const [picker, setPicker] = useState<'case' | 'template'>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [issues, setIssues] = useState<Issue[]>();
  const dirty =
    prompt !== draft.prompt || JSON.stringify(parameters) !== JSON.stringify(draft.parameters);
  useEffect(() => {
    onDirty(dirty || busy);
    return () => onDirty(false);
  }, [dirty, busy, onDirty]);

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
        if (mode === 'save' || mode === 'replace') setPrompt(updated.prompt);
        if (mode !== 'references') setParameters(updated.parameters);
        onSaved(updated);
        setPicker(undefined);
        setNotice(mode === 'save' ? '草稿已保存' : '配置已更新');
      })
      .catch((cause: unknown) => setError(actionError(cause)))
      .finally(() => setBusy(false));
  }
  return (
    <article className="work-card work-form creative-editor" aria-label="快捷创作编辑器">
      <div className="work-row">
        <h3>快捷创作</h3>
        <span className="work-muted">
          {product.sku} · {draft.purpose === 'main' ? '主图' : '详情素材'}
        </span>
      </div>
      <div className="photo-list" aria-label="已绑定商品实拍">
        {product.photos.map((photo, index) => (
          <img
            key={photo.file_id}
            src={photoPreviewUrl(product.id, photo.file_id)}
            alt={`${product.name}实拍 ${index + 1}`}
          />
        ))}
      </div>
      <label className="work-form creative-prompt">
        提示词
        <textarea
          rows={5}
          maxLength={6000}
          value={prompt}
          disabled={busy}
          onChange={(event) => {
            setPrompt(event.target.value);
            setNotice('');
            setIssues(undefined);
          }}
        />
      </label>
      <fieldset className="work-form" disabled={busy}>
        <legend>图片参数</legend>
        <ParametersFields
          value={parameters}
          onChange={(value) => {
            setParameters(value);
            setNotice('');
            setIssues(undefined);
          }}
        />
      </fieldset>
      <div className="work-actions">
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
        {draft.template_id && (
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
              run(
                async () =>
                  draftWrite(draft, token, '/references', {
                    kind: 'upload',
                    source_id: await uploadMedia(file, token),
                  }),
                'references',
              );
            }}
          />
        </label>
      </div>
      {!!draft.references.length && (
        <ul className="creative-references">
          {draft.references.map((ref, index) => (
            <li key={ref.id}>
              {ref.kind === 'case' && <img src={casePreview(ref.source_id)} alt="" />}
              <span>
                参考 {index + 1} · {ref.label}{' '}
                <small>
                  {ref.origin === 'template' ? '模板附带' : '独立参考'} · 文件 V{ref.file_version}
                </small>
              </span>
              {ref.origin === 'independent' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run(() => removeReference(draft, token, ref.id), 'references')}
                  aria-label={`移除参考 ${index + 1}`}
                >
                  移除
                </button>
              )}
            </li>
          ))}
        </ul>
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
      <footer className="work-actions">
        <button
          type="button"
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
        <button
          type="button"
          className="work-primary"
          disabled={busy || !dirty}
          onClick={() =>
            run(() => draftWrite(draft, token, '', { prompt, parameters }, 'PATCH'), 'save')
          }
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
            imageOnly
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
