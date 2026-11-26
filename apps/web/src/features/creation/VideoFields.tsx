import { useEffect, useState } from 'react';
import { loadCapabilities, type VideoParameters } from './api';

export function VideoFields({
  value,
  onChange,
  group,
}: {
  value: VideoParameters;
  onChange: (value: VideoParameters) => void;
  group?: 'model' | 'specs';
}) {
  const [models, setModels] = useState<string[]>(['seedance-2.0']);
  useEffect(() => {
    const controller = new AbortController();
    void loadCapabilities(controller.signal)
      .then((data) => setModels(data.video_models ?? ['seedance-2.0']))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  const maxDuration = value.model === 'seedance-2.5' ? 30 : 15;
  return (
    <div className="creative-parameters">
      {group !== 'specs' && <label>
        模型
        <select value={value.model} onChange={(event) => {
          const model = event.target.value as VideoParameters['model'];
          onChange({ ...value, model });
        }}>
          <option value="seedance-2.0">Seedance 2.0</option>
          {(models.includes('seedance-2.5') || value.model === 'seedance-2.5') && (
            <option value="seedance-2.5" disabled={!models.includes('seedance-2.5')}>Seedance 2.5</option>
          )}
        </select>
      </label>}
      {group !== 'model' && <><label>
        比例
        <select
          value={value.ratio}
          onChange={(event) =>
            onChange({
              ...value,
              ratio: event.target.value as VideoParameters['ratio'],
            })
          }
        >
          {['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'].map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio}
            </option>
          ))}
          {(value.model === 'seedance-2.5' || value.ratio === 'adaptive') && (
            <option value="adaptive">自适应首帧</option>
          )}
        </select>
      </label>
      <label>
        清晰度
        <select value={value.resolution} onChange={(event) => onChange({
          ...value, resolution: event.target.value as VideoParameters['resolution'],
        })}>
          {['480p', '720p', '1080p', '4k'].map((resolution) => (
            <option key={resolution} value={resolution}>{resolution}</option>
          ))}
        </select>
      </label></>}
      {!group && <label>
        时长
        <select
          value={value.duration}
          onChange={(event) =>
            onChange({
              ...value,
              duration: Number(event.target.value),
            })
          }
        >
          {value.duration > maxDuration && <option value={value.duration} disabled>{value.duration} 秒（超出上限）</option>}
          {Array.from({ length: maxDuration - 3 }, (_, i) => i + 4).map((duration) => (
            <option key={duration} value={duration}>{duration} 秒</option>
          ))}
        </select>
      </label>}
      <label>
        条数
        <select value={value.count} onChange={(event) => onChange({
          ...value, count: Number(event.target.value),
        })}>
          {[1, 2, 3, 4, 5, 6].map((count) => <option key={count} value={count}>{count} 条</option>)}
        </select>
      </label>
    </div>
  );
}
