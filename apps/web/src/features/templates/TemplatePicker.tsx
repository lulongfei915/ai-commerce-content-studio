import { useCallback, useState } from 'react';

import { Modal } from '../../shared/ui/Modal';
import { useSearchPage } from '../../shared/ui/useSearchPage';
import { casePreview } from '../cases/api';
import { listTemplates } from './api';
import type { Template } from './api';

export function TemplatePicker({
  category,
  purpose,
  hasPrompt,
  busy,
  error,
  onClose,
  onApply,
  onClear,
}: {
  category: string;
  purpose: string;
  hasPrompt: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onApply: (template: Template, action: 'keep' | 'replace') => void;
  onClear?: () => void;
}) {
  const load = useCallback(
    (_query: string, cursor: string | null, signal: AbortSignal) =>
      listTemplates(false, cursor, signal, category, purpose),
    [category, purpose],
  );
  const page = useSearchPage(load);
  const [selected, setSelected] = useState<Template>();
  const [action, setAction] = useState<'keep' | 'replace'>(hasPrompt ? 'keep' : 'replace');
  return (
    <Modal title="应用公司模板" onClose={onClose} busy={busy}>
      <div className="work-form">
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
          <p className="work-muted">当前用途没有可用的公司模板。</p>
        )}
        {page.items.map((template) => (
          <label className="work-check" key={template.id}>
            <input
              type="radio"
              name="template"
              disabled={busy}
              checked={selected?.id === template.id}
              onChange={() => setSelected(template)}
            />
            {template.content.name} · V{template.published_version}
          </label>
        ))}
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
        {selected && (
          <div className="work-card work-form">
            <p className="creative-prewrap">{selected.content.prompt}</p>
            <p>
              {selected.content.purpose === 'video'
                ? `将应用 ${selected.content.video_parameters?.ratio} · ${selected.content.video_parameters?.resolution} · ${selected.content.video_parameters?.duration} 秒`
                : `将应用 ${selected.content.parameters?.ratio} · ${selected.content.parameters?.resolution} · ${selected.content.parameters?.count} 张`}
            </p>
            {!!selected.content.case_ids?.length && (
              <div className="photo-list" aria-label="模板附带案例">
                {selected.content.case_ids.map((id, index) => (
                  <img key={id} src={casePreview(id)} alt={`附带案例 ${index + 1}`} />
                ))}
              </div>
            )}
            {hasPrompt && (
              <label>
                正文处理
                <select
                  disabled={busy}
                  value={action}
                  onChange={(event) =>
                    setAction(event.target.value === 'replace' ? 'replace' : 'keep')
                  }
                >
                  <option value="keep">保留当前提示词</option>
                  <option value="replace">替换为模板提示词</option>
                </select>
              </label>
            )}
          </div>
        )}
        {error && (
          <p role="alert" className="work-error">
            {error}
          </p>
        )}
        <div className="work-actions">
          {onClear && (
            <button type="button" disabled={busy} onClick={onClear}>
              取消应用模板
            </button>
          )}
          <button
            type="button"
            className="work-primary"
            disabled={busy || !selected}
            onClick={() => {
              if (selected) onApply(selected, action);
            }}
          >
            确认应用
          </button>
        </div>
      </div>
    </Modal>
  );
}
