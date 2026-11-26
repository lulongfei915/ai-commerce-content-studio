import { useEffect, useState } from 'react';
import { ArrowRightOutlined, ThunderboltOutlined } from '@ant-design/icons';

import { checkDraft, issueText, type Draft, type Issue } from './api';

export function BatchReadiness({ draft }: { draft: Draft }) {
  const [issues, setIssues] = useState<Issue[]>();
  const [error, setError] = useState(false);
  useEffect(() => {
    const request = new AbortController();
    void checkDraft(draft, request.signal)
      .then((value) => {
        if (!request.signal.aborted) setIssues(value.issues);
      })
      .catch(() => {
        if (!request.signal.aborted) setError(true);
      });
    return () => request.abort();
  }, [draft]);
  const first = issues?.[0];
  const label = error ? '核对未完成' : first ? issueText(first) : issues ? '输入已核对' : '正在核对输入…';
  return <small title={issues?.map(issueText).join(' · ')}>{label.replace(/^[\w.]+ · /, '')}</small>;
}
export function BatchSubmit({ pending, total, image, disabled, onSubmit }: {
  pending: Draft[];
  total: number;
  image: boolean;
  disabled: boolean;
  onSubmit: () => void;
}) {
  const unit = image ? '张' : '条';
  return (
    <footer className="batch-submit">
      <strong aria-live="polite">
        {new Set(pending.map((item) => item.product_id)).size} 个 SKU · 待提交 {pending.length} 项 · 共 {total} {unit}
      </strong>
      <button type="button" className="work-primary" disabled={disabled || !pending.length} onClick={onSubmit}>
        <ThunderboltOutlined /> 生成 {total} {unit}{image ? '图片' : '视频'} <ArrowRightOutlined />
      </button>
    </footer>
  );
}
