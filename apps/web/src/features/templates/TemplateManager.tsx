import { useCallback, useState } from 'react';
import { PlusOutlined, QuestionCircleOutlined, SearchOutlined } from '@ant-design/icons';
import type { Session } from '../auth/session';
import { CompanyRecords, CompanyTeam } from './CompanyTeam';

import { Modal } from '../../shared/ui/Modal';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { CaseBrowser } from '../cases/CaseBrowser';
import { TemplateFields } from './TemplateFields';
import { actionError } from '../creation/api';
import type { Category } from '../products/api';
import { listTemplates, loadTemplateVersion, templateAction, writeTemplate } from './api';
import type { Template, TemplateContent } from './api';
import { TemplateCard, TemplateDetails } from './TemplateCard';
import { starterTemplates, matchesTemplate, newTemplate } from './starters';
import './company.css';

export function TemplateManager({
  categories,
  session,
}: {
  categories: Category[];
  session: Session;
}) {
  const token = session.csrf_token;
  const [tab, setTab] = useState('模板与标准');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('');
  const [state, setState] = useState('');
  const [media, setMedia] = useState('');
  const [help, setHelp] = useState(false);
  const [details, setDetails] = useState<{
    content: TemplateContent;
    number: number | null;
    item: Template;
  }>();
  const [versions, setVersions] = useState<Template>();
  const [publish, setPublish] = useState<{
    name: string;
    version: number;
    item?: Template;
    edits?: TemplateContent;
  }>();
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
  const presets = !page.loading && !page.error && !page.hasPrevious && !page.items.length;
  const catalog = presets
    ? starterTemplates().filter((t) => categories.some((c) => c.id === t.content.category))
    : page.items;
  const templates = catalog.filter(t => matchesTemplate(t, { query, category, media, state }));
  function clearFilters() {
    setCategory('');
    setMedia('');
    setState('');
    setQuery('');
  }
  function showDetails(t: Template) {
    const number = t.published_version;
    run(
      () => (number ? loadTemplateVersion(t.id, number) : Promise.resolve(t.content)),
      (content) => setDetails({ content, number, item: t }),
    );
  }

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
    setItem(template?.version ? template : undefined);
    setEditor(template?.content ?? newTemplate(categories[0].id));
  }
  return (
    <section className="resource-section company-management" aria-label="公司模板">
      <header className="resource-heading">
        <h2>公司管理</h2>
        <div className="work-actions">
          <small>{session.tenant.name}</small>
          <button onClick={() => setHelp(true)}>
            <QuestionCircleOutlined /> 使用说明
          </button>
        </div>
      </header>
      <div className="resource-tabs" aria-label="公司管理分类" role="group">
        {['模板与标准', '成员与权限', '操作记录'].map((label) => (
          <button key={label} aria-pressed={label === tab} onClick={() => setTab(label)}>
            {label}
            {label === '模板与标准' && (
              <small>
                {' '}
                {catalog.length}
                {page.next ? '+' : ''}
              </small>
            )}
          </button>
        ))}
      </div>
      {tab === '成员与权限' && <CompanyTeam session={session} />}
      {tab === '操作记录' && (
        <section className="resource-section">
          <CompanyRecords />
          <h3>模板发布记录</h3>
          {page.items
            .filter((t) => t.published_version)
            .map((t) => (
              <article key={t.id} className="resource-slot">
                <strong>{t.published_content?.name ?? t.content.name}</strong>
                <label>
                  已发布版本{' '}
                  <select
                    value=""
                    onChange={(e) => {
                      const number = Number(e.target.value);
                      if (number)
                        run(
                          () => loadTemplateVersion(t.id, number),
                          (content) => setHistory({ number, content }),
                        );
                    }}
                  >
                    <option value="">查看记录</option>
                    {Array.from({ length: t.published_version ?? 0 }, (_, i) => (
                      <option key={i} value={i + 1}>
                        V{i + 1}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          {!page.loading && !page.error && !page.items.some((t) => t.published_version) && (
            <p className="resource-empty">本页暂无模板发布记录</p>
          )}
        </section>
      )}
      {tab === '模板与标准' && (
        <div className="resource-toolbar company-template-toolbar">
          <label className="resource-search">
            <SearchOutlined />
            <input
              aria-label="搜索模板名称"
              placeholder="搜索模板名称"
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <select
            aria-label="模板品类"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            <option value="">全部品类</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
          <select aria-label="模板媒体" value={media} onChange={(e) => setMedia(e.target.value)}>
            <option value="">全部媒体</option>
            <option value="image">图片</option>
            <option value="video">视频</option>
          </select>
          <select aria-label="模板状态" value={state} onChange={(e) => setState(e.target.value)}>
            <option value="">全部状态</option>
            {presets && <option value="preset">预设</option>}
            <option value="draft">草稿</option>
            <option value="published">已发布</option>
            <option value="disabled">已停用</option>
          </select>
          <button
            type="button"
            disabled={!categories.length || busy}
            className="work-primary"
            onClick={() => open()}
          >
            <PlusOutlined /> 新增模板
          </button>
        </div>
      )}
      {page.loading && <p role="status">正在加载模板…</p>}
      {page.error && (
        <p role="alert" className="work-error">
          模板未加载。{' '}
          <button type="button" onClick={page.reload}>
            重试
          </button>
        </p>
      )}
      {tab === '模板与标准' && !page.loading && !page.error && !templates.length && (
        <p className="resource-empty">暂无符合条件的公司模板。</p>
      )}
      {!editor && !stop && !publish && error && (
        <p role="alert" className="work-error">
          {error}
        </p>
      )}
      {tab === '模板与标准' && (
        <>
          <div className="company-count">
            <small role="status">
              {page.hasPrevious || page.next ? '本页' : '显示'} {templates.length} /{' '}
              {catalog.length} 个模板
            </small>
            {(query || category || state || media) && (
              <button onClick={clearFilters}>清空筛选</button>
            )}
          </div>
          <div className="resource-template-grid company-template-grid">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                categories={categories}
                busy={busy}
                details={() => showDetails(template)}
                versions={() => setVersions(template)}
                edit={() => open(template)}
                toggle={() => {
                  setError('');
                  setStop(template);
                }}
                publish={() => {
                  setError('');
                  setPublish({
                    item: presets ? undefined : template,
                    edits: presets ? template.content : undefined,
                    name: template.content.name,
                    version: (template.published_version ?? 0) + 1,
                  });
                }}
              />
            ))}
          </div>
        </>
      )}
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
      {help && (
        <Modal title="公司管理说明" onClose={() => setHelp(false)}>
          <p>
            保存草稿后可继续编辑。确认发布时生成新版本，历史制作保留原版本。停用模板会阻止使用该模板的新提交。
          </p>
        </Modal>
      )}
      {details && (
        <Modal title="模板配置" onClose={() => setDetails(undefined)}>
          <TemplateDetails
            content={details.content}
            number={details.number}
            categories={categories}
          />
          <button
            onClick={() => {
              open(details.item);
              setDetails(undefined);
            }}
          >
            编辑模板
          </button>
        </Modal>
      )}
      {versions && (
        <Modal title="模板版本记录" onClose={() => setVersions(undefined)}>
          <div className="work-form">
            {Array.from({ length: versions.published_version ?? 0 }, (_, i) => {
              const number = versions.published_version! - i;
              return (
                <button
                  key={number}
                  disabled={busy}
                  onClick={() =>
                    run(
                      () => loadTemplateVersion(versions.id, number),
                      (content) => setHistory({ number, content }),
                    )
                  }
                >
                  查看 V{number}
                </button>
              );
            })}
            {error && <p role="alert">{error}</p>}
          </div>
        </Modal>
      )}
      {history && (
        <Modal
          title={`${history.content.name} · V${history.number}`}
          onClose={() => setHistory(undefined)}
        >
          <TemplateDetails
            content={history.content}
            number={history.number}
            categories={categories}
          />
        </Modal>
      )}
      {stop && (
        <Modal
          title={stop.enabled ? '停用公司模板' : '启用公司模板'}
          onClose={() => setStop(undefined)}
          busy={busy}
        >
          <div className="work-form">
            <p>
              {stop.enabled
                ? '停用后，使用此模板的草稿需重新选择模板或取消应用，才能提交生成。'
                : '启用后，成员可选择最新发布版本。'}
            </p>
            <button disabled={busy} onClick={() => setStop(undefined)}>
              取消
            </button>
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
              {stop.enabled ? '确认停用' : '确认启用'}
            </button>
          </div>
        </Modal>
      )}
      {editor && (
        <Modal
          title={item ? '编辑公司模板' : '新增公司模板'}
          className="company-editor-dialog"
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
            <div className="company-editor-body">
            <p>保存草稿不会影响已发布版本。商品名称、SKU 与事实可使用变量，实际采用时带入。</p>
            <TemplateFields
              editor={editor}
              setEditor={setEditor}
              categories={categories}
              busy={busy}
              onCases={() => setPickCases(true)}
            />
            {error && (
              <p role="alert" className="work-error">
                {error}
              </p>
            )}
            </div>
            <div className="work-actions company-editor-footer">
              <button type="button" disabled={busy} onClick={() => setEditor(undefined)}>
                取消
              </button>
              <button type="submit" disabled={busy}>
                保存草稿
              </button>
              <button
                type="button"
                className="work-primary"
                disabled={busy}
                onClick={() => {
                  if (!editor.name.trim() || !editor.prompt?.trim()) {
                    setError(!editor.name.trim() ? '请填写模板名称。' : '请填写默认提示词。');
                    return;
                  }
                  setError('');
                  setPublish({
                    item,
                    edits: editor,
                    name: editor.name,
                    version: (item?.published_version ?? 0) + 1,
                  });
                }}
              >
                发布版本
              </button>
            </div>
          </form>
        </Modal>
      )}
      {publish && (
        <Modal title="确认发布模板" busy={busy} onClose={() => setPublish(undefined)}>
          <div className="work-form">
            <p>
              将「{publish.name}」发布为 V{publish.version}？现有制作保留原版本。
            </p>
            {error && <p role="alert">{error}</p>}
            <div className="work-actions">
              <button disabled={busy} onClick={() => setPublish(undefined)}>
                {editor ? '返回编辑' : '取消'}
              </button>
              <button
                className="work-primary"
                disabled={busy}
                onClick={() =>
                  run(
                    async () => {
                      let target = publish.item;
                      if (publish.edits) {
                        target = await writeTemplate(token, publish.edits, target);
                        setItem(target);
                        setPublish({ ...publish, edits: undefined, item: target });
                      }
                      return templateAction(token, target!, 'publish');
                    },
                    () => {
                      setPublish(undefined);
                      setEditor(undefined);
                      page.reload();
                    },
                  )
                }
              >
                确认发布
              </button>
            </div>
          </div>
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
