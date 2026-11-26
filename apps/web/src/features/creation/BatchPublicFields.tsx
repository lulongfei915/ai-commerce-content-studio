import { useEffect, useState } from 'react';
import { defaults, loadCapabilities, type Capabilities } from './api';
import type { BatchConfig } from './useBatchProgress';

export function BatchPublicFields({ config, image, busy, onChange }: {
  config: BatchConfig;
  image: boolean;
  busy: boolean;
  onChange: (config: BatchConfig) => void;
}) {
  const [sizes, setSizes] = useState<Capabilities['sizes']>();
  useEffect(() => {
    if (!image) return;
    const request = new AbortController();
    void loadCapabilities(request.signal).then((data) => setSizes(data.sizes)).catch(() => {});
    return () => request.abort();
  }, [image]);

  return (
    <>
      <label>
        公共提示词
        <textarea rows={5} value={config.prompt} maxLength={6000} disabled={busy}
          onChange={(event) => onChange({ ...config, prompt: event.target.value })} />
      </label>
      {image && (
        <label>
          公共比例 / 清晰度
          <select
            disabled={busy || !sizes}
            value={`${config.ratio ?? defaults.ratio}/${config.resolution ?? defaults.resolution}`}
            onChange={(event) => {
              const size = sizes?.find((item) => `${item.ratio}/${item.resolution}` === event.target.value);
              if (size) onChange({ ...config, ratio: size.ratio, resolution: size.resolution });
            }}
          >
            {(sizes ?? [{ ratio: config.ratio ?? defaults.ratio,
              resolution: config.resolution ?? defaults.resolution }]).map(({ ratio, resolution }) => (
              <option value={`${ratio}/${resolution}`} key={`${ratio}/${resolution}`}>
                {ratio} · {resolution}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        每项产出
        <input type="number" min={1} max={image ? 6 : 1} value={config.count} required
          disabled={busy || !image}
          onChange={(event) => onChange({ ...config, count: Number(event.target.value) })} />
      </label>
    </>
  );
}
