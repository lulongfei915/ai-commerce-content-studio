import { useEffect, useState } from 'react';
import { defaults, loadCapabilities, type Capabilities } from '../creation/api';
import type { Category } from '../products/api';
import type { TemplateContent } from './api';
const productRule = '商品一致性必检';
const checks = ['人物一致性（有人物时）', '场景一致性'];
export function TemplateFields({
  editor,
  setEditor,
  categories,
  busy,
  onCases,
}: {
  editor: TemplateContent;
  setEditor: (value: TemplateContent) => void;
  categories: Category[];
  busy: boolean;
  onCases: () => void;
}) {
  const rules = editor.check_rules ?? [];
  const [caps, setCaps] = useState<Capabilities>();
  const [retry, setRetry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const ctl = new AbortController();
    void loadCapabilities(ctl.signal)
      .then(setCaps)
      .catch(() => {
        if (!ctl.signal.aborted) setFailed(true);
      });
    return () => ctl.abort();
  }, [retry]);
  const image = editor.parameters ?? defaults;
  const video = editor.purpose === 'video' ? editor.video_parameters : null;
  const models = caps?.models ?? [];
  const model = models.find((m) => m.model === image.model);
  const sizes = model?.sizes ?? caps?.sizes ?? [];
  const resolutions = sizes.filter((s) => s.ratio === image.ratio);
  const custom = rules.filter((rule) => rule !== productRule && !checks.includes(rule));
  function writeRules(selected: string[], extra: string[]) {
    setEditor({ ...editor, check_rules: [...new Set([productRule, ...selected, ...extra])] });
  }
  return (
    <fieldset className="work-form company-editor-fields" disabled={busy}>
      <label>
        模板名称
        <input
          required
          data-initial-focus
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
          媒体
          <select
            value={editor.purpose === 'video' ? 'video' : 'image'}
            onChange={(e) =>
              setEditor({
                ...editor,
                purpose: e.target.value === 'video' ? 'video' : 'main',
                case_ids: [],
                video_parameters:
                  e.target.value === 'video'
                    ? {
                        model: 'seedance-2.0',
                        ratio: '9:16',
                        resolution: '720p',
                        duration: 5,
                        count: 1,
                      }
                    : null,
              })
            }
          >
            <option value="image">图片</option>
            <option value="video">视频</option>
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
            {editor.purpose === 'video' ? (
              <option value="video">带货视频</option>
            ) : (
              <>
                <option value="main">商品主图</option>
                <option value="detail">详情素材</option>
              </>
            )}
          </select>
        </label>
        <label>
          模型
          {video ? (
            <select aria-label="模型" value={video.model} onChange={() => {}}>
              <option value="seedance-2.0">公司默认模型</option>
            </select>
          ) : (
            <select
              value={image.model}
              onChange={(e) => {
                const next = models.find((m) => m.model === e.target.value);
                if (!next) return;
                const size =
                  next.sizes.find(
                    (s) => s.ratio === image.ratio && s.resolution === image.resolution,
                  ) ?? next.sizes[0];
                setEditor({
                  ...editor,
                  parameters: {
                    ...image,
                    provider: next.provider,
                    model: next.model,
                    ratio: size.ratio,
                    resolution: size.resolution,
                    quality: next.default_quality ?? null,
                  },
                });
              }}
            >
              {!model && (
                <option value={image.model}>
                  {image.model === defaults.model ? '公司默认模型' : image.model}
                </option>
              )}
              {models.map((m) => (
                <option key={m.model} value={m.model}>
                  {m.model === defaults.model ? '公司默认模型' : m.label}
                </option>
              ))}
            </select>
          )}
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
        <small>{'支持 {{商品名称}}、{{SKU}}、{{商品事实}}'}</small>
      </label>
      <div className="work-grid">
        <label>
          画面比例
          <select
            value={video?.ratio ?? image.ratio}
            onChange={(e) => {
              if (video)
                return setEditor({
                  ...editor,
                  video_parameters: { ...video, ratio: e.target.value as typeof video.ratio },
                });
              const size =
                sizes.find(
                  (s) => s.ratio === e.target.value && s.resolution === image.resolution,
                ) ?? sizes.find((s) => s.ratio === e.target.value);
              if (size)
                setEditor({
                  ...editor,
                  parameters: { ...image, ratio: size.ratio, resolution: size.resolution },
                });
            }}
          >
            {(video
              ? ['16:9', '9:16', '1:1']
              : [...new Set([image.ratio, ...sizes.map((s) => s.ratio)])]
            ).map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        </label>
        <label>
          清晰度
          <select
            value={video?.resolution ?? image.resolution}
            onChange={(e) => {
              const size = resolutions.find((s) => s.resolution === e.target.value);
              if (!video && size)
                setEditor({ ...editor, parameters: { ...image, resolution: size.resolution } });
            }}
          >
            {video ? (
              <option>{video.resolution}</option>
            ) : (
              <>
                {!resolutions.some((s) => s.resolution === image.resolution) && (
                  <option>{image.resolution}</option>
                )}
                {resolutions.map((s) => (
                  <option key={s.resolution} value={s.resolution}>
                    {s.width} × {s.height}
                  </option>
                ))}
              </>
            )}
          </select>
        </label>
        <label>
          默认数量
          <input
            type="number"
            min={1}
            max={video ? 1 : (caps?.max_outputs ?? 6)}
            readOnly={!!video}
            value={video?.count ?? image.count ?? 1}
            onChange={(e) =>
              setEditor({ ...editor, parameters: { ...image, count: Number(e.target.value) } })
            }
          />
        </label>
        {video && (
          <label>
            总时长
            <select
              aria-label="时长"
              value={video.duration}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  video_parameters: { ...video, duration: e.target.value === '10' ? 10 : 5 },
                })
              }
            >
              <option value={5}>5 秒</option>
              <option value={10}>10 秒</option>
            </select>
          </label>
        )}
        {!video && !!model?.qualities.length && (
          <label>
            质量
            <select
              value={image.quality ?? model.default_quality ?? ''}
              onChange={(e) =>
                setEditor({
                  ...editor,
                  parameters: { ...image, quality: e.target.value as typeof image.quality },
                })
              }
            >
              {model.qualities.map((q) => (
                <option key={q}>{q}</option>
              ))}
            </select>
          </label>
        )}
      </div>
      {failed && (
        <button
          type="button"
          onClick={() => {
            setFailed(false);
            setRetry((n) => n + 1);
          }}
        >
          重新加载可用规格
        </button>
      )}
      <fieldset className="work-form">
        <legend>人工审核要点</legend>
        <label className="work-check">
          <input type="checkbox" checked disabled />
          商品一致性（必检）
        </label>
        {checks.map((rule) => (
          <label className="work-check" key={rule}>
            <input
              type="checkbox"
              checked={rules.includes(rule)}
              onChange={(e) =>
                writeRules(
                  checks.filter((check) =>
                    check === rule ? e.target.checked : rules.includes(check),
                  ),
                  custom,
                )
              }
            />
            {rule}
          </label>
        ))}
      </fieldset>
      <details>
        <summary>其他审核要点与附带案例</summary>
        <label>
          其他审核要点（每行一条）
          <textarea
            rows={3}
            defaultValue={custom.join('\n')}
            onChange={(event) =>
              writeRules(
                checks.filter((check) => rules.includes(check)),
                event.target.value
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean),
              )
            }
          />
        </label>
        <button type="button" onClick={onCases}>
          管理附带案例 · {editor.case_ids?.length ?? 0}
        </button>
      </details>
    </fieldset>
  );
}
