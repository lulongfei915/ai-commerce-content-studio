import type { Category } from '../products/api';
import type { Template, TemplateContent } from './api';

function specs(content: TemplateContent) {
  if (content.purpose === 'video' && content.video_parameters) {
    const v = content.video_parameters;
    return `${v.ratio} · ${v.resolution} · ${v.count} 份 · ${v.duration}s`;
  }
  const p = content.parameters;
  return p && [p.ratio, p.resolution, `${p.count ?? 1} 份`].filter(Boolean).join(' · ');
}

export function TemplateDetails({
  content,
  number,
  categories,
}: {
  content: TemplateContent;
  number: number | null;
  categories: Category[];
}) {
  return (
    <div className="work-form">
      <h3>
        {content.name} · {number ? `V${number}` : '未发布草稿'}
      </h3>
      <dl className="delivery-requirements">
        <div>
          <dt>适用范围</dt>
          <dd>
            {categories.find((c) => c.id === content.category)?.label ?? content.category} ·
            {content.purpose === 'video'
              ? '视频 · 带货视频'
              : content.purpose === 'main'
                ? '图片 · 商品主图'
                : '图片 · 详情素材'}
          </dd>
        </div>
        <div>
          <dt>默认模型</dt>
          <dd>
            {content.purpose === 'video'
              ? content.video_parameters?.model
              : content.parameters?.model}
          </dd>
        </div>
        <div>
          <dt>画面规格</dt>
          <dd>{specs(content)}</dd>
        </div>
        <div>
          <dt>人工审核要点</dt>
          <dd>{content.check_rules?.join(' · ') || '未填写'}</dd>
        </div>
        <div>
          <dt>默认提示词</dt>
          <dd className="creative-prewrap">{content.prompt}</dd>
        </div>
      </dl>
    </div>
  );
}

export function TemplateCard({
  template: t,
  categories,
  busy,
  details,
  versions,
  edit,
  publish,
  toggle,
}: {
  template: Template;
  categories: Category[];
  busy: boolean;
  details: () => void;
  versions: () => void;
  edit: () => void;
  publish: () => void;
  toggle: () => void;
}) {
  const content = t.published_content ?? t.content;
  return (
    <article className="resource-slot company-template">
      <header>
        <small>
          {categories.find((c) => c.id === content.category)?.label ?? content.category} ·{' '}
          {content.purpose === 'video' ? '视频' : '图片'}
        </small>
        <b>
          {!t.version ? '预设' : t.published_version ? (t.enabled ? '已发布' : '已停用') : '草稿'}
        </b>
      </header>
      <h3>{content.name}</h3>
      {t.has_unpublished_changes && <small>有待发布修改</small>}
      <small>
        {content.purpose === 'video'
          ? '带货视频'
          : content.purpose === 'main'
            ? '商品主图'
            : '详情素材'}
      </small>
      <p>{specs(content)}</p>
      <footer>
        <small>{t.published_version ? `已发布 V${t.published_version}` : '尚未发布'}</small>
        <div className="work-actions">
          <button disabled={busy} onClick={details}>
            查看配置
          </button>
          <button disabled={busy || !t.published_version} onClick={versions}>
            版本记录
          </button>
          <button disabled={busy} onClick={edit}>
            编辑
          </button>
          <button disabled={busy} onClick={publish}>
            发布新版本
          </button>
          {!!t.published_version && (
            <button disabled={busy} onClick={toggle}>
              {t.enabled ? '停用' : '启用'}
            </button>
          )}
        </div>
      </footer>
    </article>
  );
}
