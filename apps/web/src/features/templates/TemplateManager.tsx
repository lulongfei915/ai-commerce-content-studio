import { useCallback, useState } from 'react';

import { Modal } from '../../shared/ui/Modal';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { CaseBrowser } from '../cases/CaseBrowser';
import { ParametersFields } from '../creation/ParametersFields';
import { actionError, defaults } from '../creation/api';
import type { Category } from '../products/api';
import { listTemplates, loadTemplateVersion, templateAction, writeTemplate } from './api';
import type { Template, TemplateContent } from './api';

export function TemplateManager({ categories, token }: { categories: Category[]; token: string }) {
  const load = useCallback(
    (_query: string, cursor: string | null, signal: AbortSignal) =>
      listTemplates(true, cursor, signal),
    [],
  );
  const page = useSearchPage(load);
  const [editor, setEditor] = useState<TemplateContent>();
  const [item, setItem] = useState<Template>();
  const [history, setHistory] = useState<{ number: number; content: TemplateContent }>();
  const [stop, setStop] = useState<Template>();
  const [pickCases, setPickCases] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  function run<T>(operation: () => Promise<T>, success: (value: T) => void) {
    setBusy(true);
    setError('');
    void operation()
      .then(success)
      .catch((cause: unknown) => setError(actionError(cause)))
      .finally(() => setBusy(false));
  }
  function open(template?: Template) {
    setError('');
    setItem(template);
    setEditor(
      template?.content ?? {
        name: '',
        category: categories[0].id,
        purpose: 'main',
        prompt: '',
        parameters: defaults,
      },
    );
  }
  return (
    <section className="work-form" aria-label="公司模板">
      <div className="work-actions">
        <button
          type="button"
          disabled={!categories.length || busy}
          className="work-primary"
          onClick={() => open()}
        >
          新建模板
        </button>
      </div>
      {page.loading && <p role="status">正在加载模板…</p>}
      {page.error && (
        <p role="alert" className="work-error">
          模板未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {!page.loading && !page.error && !page.items.length && (
        <p className="work-muted">还没有公司模板。</p>
      )}
      {!editor && !stop && error && (
        <p role="alert" className="work-error">
          {error}
        </p>
      )}
      {page.items.map((template) => (
        <article key={template.id} className="work-card work-row">
          <div>
            <h3>{template.content.name}</h3>
            <p className="work-muted">
              {template.published_version
                ? `已发布 V${template.published_version} · ${template.enabled ? '启用' : '停用'}`
                : '未发布'}
            </p>
          </div>
          <div className="work-actions">
            <button type="button" disabled={busy} onClick={() => open(template)}>
              编辑草稿
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => run(() => templateAction(token, template, 'publish'), page.reload)}
            >
              发布新版本
            </button>
            {template.published_version !== null && (
              <>
                <label>
                  版本{' '}
                  <select
                    aria-label={`${template.content.name}历史版本`}
                    value=""
                    disabled={busy}
                    onChange={(event) => {
                      const number = Number(event.target.value);
                      if (number)
                        run(
                          () => loadTemplateVersion(template.id, number),
                          (content) => setHistory({ number, content }),
                        );
                    }}
                  >
                    <option value="">查看历史</option>
                    {Array.from({ length: template.published_version }, (_, index) => (
                      <option key={index} value={index + 1}>
                        V{index + 1}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    if (template.enabled) {
                      setError('');
                      setStop(template);
                    } else run(() => templateAction(token, template, 'status'), page.reload);
                  }}
                >
                  {template.enabled ? '停用' : '重新启用'}
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      <div className="work-actions">
        {page.hasPrevious && (
          <button type="button" onClick={page.first}>
            回到首页
          </button>
        )}
        {page.next && (
          <button type="button" onClick={page.more}>
            下一页
          </button>
        )}
      </div>
      {history && (
        <Modal
          title={`${history.content.name} · V${history.number}`}
          onClose={() => setHistory(undefined)}
        >
          <div className="work-form">
            <p className="creative-prewrap">{history.content.prompt}</p>
            <p>
              {history.content.parameters?.ratio} · {history.content.parameters?.resolution} ·{' '}
              {history.content.parameters?.count} 张
            </p>
            {!!history.content.check_rules?.length && (
              <ul>
                {history.content.check_rules.map((rule, index) => (
                  <li key={index}>{rule}</li>
                ))}
              </ul>
            )}
          </div>
        </Modal>
      )}
      {stop && (
        <Modal title="停用公司模板" onClose={() => setStop(undefined)} busy={busy}>
          <div className="work-form">
            <p>停用后，使用此模板的草稿需重新选择模板或取消应用，才能提交生成。</p>
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                run(
                  () => templateAction(token, stop, 'status'),
                  () => {
                    setStop(undefined);
                    page.reload();
                  },
                )
              }
            >
              确认停用
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={item ? '编辑模板草稿' : '新建公司模板'}
          onClose={() => setEditor(undefined)}
          busy={busy}
        >
          <form
            className="work-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy)
                run(
                  () => writeTemplate(token, editor, item),
                  () => {
                    setEditor(undefined);
                    page.reload();
                  },
                );
            }}
          >
            <fieldset className="work-form" disabled={busy}>
              <label>
                模板名称
                <input
                  required
                  maxLength={120}
                  value={editor.name}
                  onChange={(event) => setEditor({ ...editor, name: event.target.value })}
                />
              </label>
              <div className="work-grid">
                <label>
                  适用品类
                  <select
                    value={editor.category}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        category: event.target.value as Category['id'],
                        case_ids: [],
                      })
                    }
                  >
                    {categories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  用途
                  <select
                    value={editor.purpose}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        purpose: event.target.value as TemplateContent['purpose'],
                      })
                    }
                  >
                    <option value="main">主图</option>
                    <option value="detail">详情素材</option>
                  </select>
                </label>
              </div>
              <label>
                默认提示词
                <textarea
                  rows={4}
                  maxLength={6000}
                  value={editor.prompt ?? ''}
                  onChange={(event) => setEditor({ ...editor, prompt: event.target.value })}
                />
              </label>
              <ParametersFields
                value={editor.parameters ?? defaults}
                onChange={(parameters) => setEditor({ ...editor, parameters })}
              />
              <label>
                人工审核要点（每行一条）
                <textarea
                  rows={3}
                  defaultValue={editor.check_rules?.join('\n')}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      check_rules: event.target.value
                        .split('\n')
                        .map((line) => line.trim())
                        .filter(Boolean),
                    })
                  }
                />
              </label>
              <button type="button" onClick={() => setPickCases(true)}>
                管理附带案例 · {editor.case_ids?.length ?? 0}
              </button>
            </fieldset>
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            <div className="work-actions">
              <button type="submit" className="work-primary" disabled={busy}>
                保存模板草稿
              </button>
            </div>
          </form>
        </Modal>
      )}
      {editor && pickCases && (
        <Modal title="模板附带案例" onClose={() => setPickCases(false)}>
          <CaseBrowser
            categories={categories}
            category={editor.category}
            purpose={editor.purpose}
            imageOnly
            selected={editor.case_ids}
            onPick={(entry) => {
              const ids = editor.case_ids ?? [];
              setEditor({
                ...editor,
                case_ids: ids.includes(entry.id)
                  ? ids.filter((id) => id !== entry.id)
                  : [...ids, entry.id],
              });
            }}
          />
          <button type="button" onClick={() => setPickCases(false)}>
            完成选择
          </button>
        </Modal>
      )}
    </section>
  );
}
