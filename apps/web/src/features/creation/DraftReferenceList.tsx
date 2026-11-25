import { casePreview } from '../cases/api';
import { usageLabel, type Draft, type Reference } from './api';

export function DraftReferenceList({
  draft,
  busy,
  preview,
  insert,
  remove,
  updateUsage,
}: {
  draft: Draft;
  busy: boolean;
  preview?: (ref: Reference) => string | undefined;
  insert: (ref: Reference) => void;
  remove: (ref: Reference) => void;
  updateUsage: (ref: Reference, usage: string) => void;
}) {
  return (
    <ul className="creative-references" aria-label="参考素材">
      {draft.references.map((ref, index) => {
        const src =
          preview?.(ref) ?? (ref.kind === 'case' ? casePreview(ref.source_id) : undefined);
        return (
          <li key={ref.id}>
            {src && ref.media !== 'video' && <img src={src} loading="lazy" alt="" />}
            <span>
              参考 {index + 1} · {ref.label}{' '}
              <small>
                {usageLabel[ref.usage ?? 'expression']} · 文件 V{ref.file_version}
              </small>
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => insert(ref)}
              aria-label={`插入参考 ${index + 1} 标签`}
            >
              插入标签
            </button>
            {ref.origin === 'independent' && (
              <>
                <select
                  aria-label={`参考 ${index + 1} 用途`}
                  value={ref.usage ?? 'expression'}
                  disabled={busy}
                  onChange={(event) => updateUsage(ref, event.target.value)}
                >
                  {Object.entries(usageLabel)
                    .filter(
                      ([usage]) =>
                        usage === ref.usage ||
                        (usage !== 'product' &&
                          (draft.purpose === 'video' ||
                            !['first_frame', 'last_frame'].includes(usage))),
                    )
                    .map(([usage, label]) => (
                      <option key={usage} value={usage}>
                        {label}
                      </option>
                    ))}
                </select>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`移除参考 ${index + 1}`}
                  onClick={() => remove(ref)}
                >
                  移除
                </button>
              </>
            )}
          </li>
        );
      })}
    </ul>
  );
}
