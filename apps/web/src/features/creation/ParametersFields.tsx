import { useEffect, useState } from 'react';

import { loadCapabilities } from './api';
import type { Capabilities, Parameters } from './api';

export function ParametersFields({
  value,
  onChange,
}: {
  value: Parameters;
  onChange: (value: Parameters) => void;
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
  return (
    <div className="creative-parameters">
      <label>
        模型
        <input
          readOnly
          value={value.model === 'seedream-5.5' ? 'Seedream 5.5' : (value.model ?? '')}
        />
      </label>
      {capabilities && (
        <label>
          比例 / 清晰度
          <select
            value={`${value.ratio}/${value.resolution}`}
            onChange={(event) => {
              const option = capabilities.sizes.find(
                (size) => `${size.ratio}/${size.resolution}` === event.target.value,
              );
              if (option)
                onChange({ ...value, ratio: option.ratio, resolution: option.resolution });
            }}
          >
            {capabilities.sizes.map((size) => (
              <option
                value={`${size.ratio}/${size.resolution}`}
                key={`${size.ratio}/${size.resolution}`}
              >
                {size.ratio} · {size.resolution} · {size.width}×{size.height}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        张数
        <input
          type="number"
          min={1}
          max={capabilities?.max_outputs ?? 6}
          value={value.count ?? 1}
          onChange={(event) => onChange({ ...value, count: Number(event.target.value) })}
        />
      </label>
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
