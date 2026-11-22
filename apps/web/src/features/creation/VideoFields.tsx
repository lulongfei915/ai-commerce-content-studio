import type { VideoParameters } from './api';

export function VideoFields({
  value,
  onChange,
}: {
  value: VideoParameters;
  onChange: (value: VideoParameters) => void;
}) {
  return (
    <div className="creative-parameters">
      <label>
        模型
        <input readOnly value="Seedance 2.0" />
      </label>
      <label>
        比例 / 清晰度
        <select
          value={value.ratio}
          onChange={(event) =>
            onChange({
              ...value,
              ratio: event.target.value as VideoParameters['ratio'],
            })
          }
        >
          {['16:9', '9:16', '1:1'].map((ratio) => (
            <option key={ratio} value={ratio}>
              {ratio} · 720p
            </option>
          ))}
        </select>
      </label>
      <label>
        时长
        <select
          value={value.duration}
          onChange={(event) =>
            onChange({
              ...value,
              duration: event.target.value === '10' ? 10 : 5,
            })
          }
        >
          <option value={5}>5 秒</option>
          <option value={10}>10 秒</option>
        </select>
      </label>
    </div>
  );
}
