import { useEffect, useState } from 'react';

import { imageModelLabel, loadCapabilities } from './api';
import type { Capabilities, ImageModelOption, Parameters } from './api';

const providerLabels = { ark: '火山方舟', 'gpt-image': 'GPT Image' };
const qualityLabels: Record<string, string> = {
  auto: '自动',
  low: '低',
  medium: '中',
  high: '高',
  xhigh: '超高',
  max: '最高',
};

function sizeKey(size: Pick<Parameters, 'ratio' | 'resolution'>) {
  return `${size.ratio}/${size.resolution}`;
}

export function ParametersFields({
  value,
  onChange,
  group,
}: {
  value: Parameters;
  onChange: (value: Parameters) => void;
  group?: 'model' | 'specs';
}) {
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadCapabilities(controller.signal)
      .then(setCapabilities)
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      });
    return () => controller.abort();
  }, [retry]);

  const provider = value.provider ?? 'ark';
  const models = capabilities?.models ?? [];
  const providers = [...new Set(models.map((item) => item.provider))];
  const options = models.filter((item) => item.provider === provider);
  const model = options.find((item) => item.model === value.model);
  const sizes = model?.sizes ?? (provider === 'ark' && !models.length ? capabilities?.sizes : []);
  const size = sizes?.find((item) => sizeKey(item) === sizeKey(value));

  function selectModel(next: ImageModelOption) {
    const nextSize = next.sizes.find((item) => sizeKey(item) === sizeKey(value)) ?? next.sizes[0];
    if (!nextSize) return;
    onChange({
      ...value,
      provider: next.provider,
      model: next.model,
      ratio: nextSize.ratio,
      resolution: nextSize.resolution,
      quality: value.quality && next.qualities.includes(value.quality)
        ? value.quality : (next.default_quality ?? null),
    });
  }

  return (
    <div className="creative-parameters image-parameters">
      {group !== 'specs' && providers.length > 0 && (
        <label>
          供应商
          <select
            value={provider}
            onChange={(event) => {
              const next = models.find((item) => item.provider === event.target.value);
              if (next) selectModel(next);
            }}
          >
            {!providers.includes(provider) && (
              <option value={provider} disabled>{providerLabels[provider]}（不可用）</option>
            )}
            {providers.map((item) => (
              <option key={item} value={item}>{providerLabels[item]}</option>
            ))}
          </select>
        </label>
      )}
      {group !== 'specs' && <label>
        模型
        {options.length > 0 ? (
          <select
            value={value.model}
            onChange={(event) => {
              const next = options.find((item) => item.model === event.target.value);
              if (next) selectModel(next);
            }}
          >
            {!model && <option value={value.model} disabled>{value.model}（不可用）</option>}
            {options.map((item) => (
              <option key={item.model} value={item.model}>{item.label}</option>
            ))}
          </select>
        ) : (
          <input
            readOnly
            value={imageModelLabel(value.model) ?? ''}
          />
        )}
      </label>}
      {group !== 'model' && !!sizes?.length && (
        <label>
          比例 / 清晰度
          <select
            value={sizeKey(value)}
            onChange={(event) => {
              const option = sizes.find((item) => sizeKey(item) === event.target.value);
              if (option)
                onChange({ ...value, ratio: option.ratio, resolution: option.resolution });
            }}
          >
            {!size && <option value={sizeKey(value)} disabled>{sizeKey(value)}（不可用）</option>}
            {sizes.map((item) => (
              <option value={sizeKey(item)} key={sizeKey(item)}>
                {item.ratio} · {item.resolution} · {item.width}×{item.height}
              </option>
            ))}
          </select>
        </label>
      )}
      {group !== 'model' && !!model?.qualities.length && (
        <label>
          质量
          <select
            value={value.quality ?? model.default_quality ?? ''}
            onChange={(event) => onChange({ ...value, quality: event.target.value })}
          >
            {value.quality && !model.qualities.includes(value.quality) && (
              <option value={value.quality} disabled>{value.quality}（不可用）</option>
            )}
            {model.qualities.map((quality) => (
              <option key={quality} value={quality}>{qualityLabels[quality] ?? quality}</option>
            ))}
          </select>
        </label>
      )}
      {!group && <label>
        张数
        <input
          type="number"
          min={1}
          max={capabilities?.max_outputs ?? 6}
          value={value.count ?? 1}
          onChange={(event) => onChange({ ...value, count: Number(event.target.value) })}
        />
      </label>}
      {error && (
        <button
          type="button"
          onClick={() => {
            setError(false);
            setRetry((item) => item + 1);
          }}
        >
          重新加载可用规格
        </button>
      )}
    </div>
  );
}
