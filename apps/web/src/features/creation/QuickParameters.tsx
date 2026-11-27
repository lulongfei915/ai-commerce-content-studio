import { useEffect, useState, type ReactNode } from 'react';
import { AppstoreOutlined, BorderOutlined, CheckOutlined } from '@ant-design/icons';
import { QuickParameterPopover } from './QuickParameterPopover';
import {
  imageModelLabel, loadCapabilities, type Capabilities, type DraftEdits, type VideoParameters,
} from './api';
import './quick-parameters.css';

type Field = 'model' | 'specs' | 'count' | 'duration';
type TargetSpec = { ratio: string; resolution: string };
const providerLabels = { ark: '火山方舟', 'gpt-image': 'GPT Image' };
const qualityLabels: Record<string, string> = {
  auto: '自动', low: '低', medium: '中', high: '高', xhigh: '超高', max: '最高',
};
const videoLabels: Record<NonNullable<VideoParameters['model']>, string> = {
  'seedance-2.0': 'Seedance 2.0', 'seedance-2.5': 'Seedance 2.5',
};
const videoRatios = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'] as const;
const videoResolutions = ['480p', '720p', '1080p', '4k'] as const;
const ratioLabel = (ratio: string) => ratio === 'adaptive' ? '自适应' : ratio;
const resolutionLabel = (resolution: string) => resolution === '4k' ? '4K' : resolution;

function ratioShape(ratio: string) {
  const [width, height] = ratio.split(':').map(Number);
  const longest = Math.max(width, height);
  return longest > 0 ? { width: 22 * width / longest, height: 22 * height / longest } : undefined;
}

function RatioOptions<T extends string>({
  options, value, onChange,
}: { options: readonly T[]; value: string; onChange: (option: T) => void }) {
  return (
    <div className="quick-parameter-section" role="group" aria-label="画面比例">
      <span className="quick-parameter-label">画面比例</span>
      <div className="quick-ratio-options">
        {options.map((ratio) => (
          <button key={ratio} type="button" aria-pressed={ratio === value} onClick={() => onChange(ratio)}>
            <span className="quick-ratio-icon" aria-hidden="true">
              <span data-adaptive={ratio === 'adaptive' || undefined} style={ratioShape(ratio)} />
            </span>
            {ratioLabel(ratio)}
          </button>
        ))}
      </div>
    </div>
  );
}

function ChoiceOptions<T extends string | number>({
  options, value, onChange, label, caption = String,
}: {
  options: readonly T[];
  value: T;
  onChange: (option: T) => void;
  label?: string;
  caption?: (option: T) => string;
}) {
  return (
    <div className="quick-parameter-section" role={label ? 'group' : undefined} aria-label={label}>
      {label && <span className="quick-parameter-label">{label}</span>}
      <div className="quick-value-options">
        {options.map((option) => (
          <button key={option} type="button" aria-pressed={option === value} onClick={() => onChange(option)}>
            {caption(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

export function QuickParameters({
  value, onChange, disabled, targetSpec, canvas,
}: {
  value: DraftEdits;
  onChange: (value: DraftEdits) => void;
  disabled: boolean;
  targetSpec?: TargetSpec;
  canvas?: {
    onReset: () => void;
  };
}) {
  const [active, setActive] = useState<Field>();
  const [capabilities, setCapabilities] = useState<Capabilities>();
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void loadCapabilities(controller.signal).then((loaded) => {
      if (!controller.signal.aborted) setCapabilities(loaded);
    }).catch(() => {
      if (!controller.signal.aborted) setError(true);
    });
    return () => controller.abort();
  }, [retry]);

  const { parameters, video } = value;
  const spec = video ?? parameters;
  const models = capabilities?.models ?? [];
  const provider = parameters.provider ?? 'ark';
  const model = models.find((item) => item.provider === provider && item.model === parameters.model);
  const sizes = model?.sizes ?? (provider === 'ark' && !models.length ? capabilities?.sizes ?? [] : []);
  const size = sizes.find((item) => item.ratio === parameters.ratio && item.resolution === parameters.resolution);
  const sizeMatches = (item: TargetSpec, target: TargetSpec) =>
    item.ratio === target.ratio && item.resolution === target.resolution;
  const count = spec.count ?? 1;
  const countLabel = (option: number) => `${option} ${video ? '条' : '张'}`;
  const counts = Array.from({ length: video ? 6 : capabilities?.max_outputs ?? 6 }, (_, i) => i + 1);
  const specText = `${ratioLabel(spec.ratio)} · ${resolutionLabel(spec.resolution)}`;

  function popover(field: Field) {
    return {
      disabled,
      anchored: Boolean(canvas),
      open: !disabled && active === field,
      onOpen: (open: boolean) => setActive((current) => open ? field : current === field ? undefined : current),
    };
  }

  const capabilityStatus = error ? (
    <button type="button" onClick={() => { setError(false); setRetry((current) => current + 1); }}>
      加载失败，重试
    </button>
  ) : !capabilities ? <span className="quick-parameter-label" role="status">正在读取可用选项…</span> : null;

  function modelOptions(close: () => void) {
    if (capabilityStatus) return capabilityStatus;
    if (video) {
      const available = (capabilities?.video_models ?? ['seedance-2.0'])
        .filter((id): id is keyof typeof videoLabels => Object.hasOwn(videoLabels, id));
      return (available.length ? available : ['seedance-2.0'] as const).map((id) => (
        <ModelChoice key={id} label={videoLabels[id]} provider={providerLabels.ark} selected={id === video.model}
          onClick={() => {
            if (id !== video.model) onChange({ ...value, video: {
              ...video,
              model: id,
              ratio: id === 'seedance-2.0' && video.ratio === 'adaptive' ? '16:9' : video.ratio,
              duration: Math.min(video.duration ?? 5, id === 'seedance-2.5' ? 30 : 15),
            } });
            close();
          }} />
      ));
    }
    if (!models.length) {
      return <ModelChoice label={imageModelLabel(parameters.model)} provider={providerLabels[provider]} withIcon={Boolean(canvas)}
        selected onClick={close} />;
    }
    return models.map((item) => {
      const selected = item === model;
      const nextSize = item.sizes.find((option) => sizeMatches(option, targetSpec ?? parameters))
        ?? (!targetSpec ? item.sizes.find((option) => option.ratio === parameters.ratio) ?? item.sizes[0] : undefined);
      return (
        <ModelChoice key={`${item.provider}:${item.model}`} label={item.label} withIcon={Boolean(canvas)}
          provider={providerLabels[item.provider]} selected={selected} disabled={!nextSize}
          onClick={() => {
            if (!selected && nextSize) onChange({ ...value, parameters: {
              ...parameters,
              provider: item.provider, model: item.model,
              ratio: nextSize.ratio, resolution: nextSize.resolution,
              quality: parameters.quality && item.qualities.includes(parameters.quality)
                ? parameters.quality : (item.default_quality ?? null),
            } });
            close();
          }} />
      );
    });
  }

  function specOptions(): ReactNode {
    if (video) {
      const ratios = video.model === 'seedance-2.5' ? [...videoRatios, 'adaptive'] as const : videoRatios;
      return <>
        <RatioOptions options={ratios} value={video.ratio}
          onChange={(ratio) => onChange({ ...value, video: { ...video, ratio } })} />
        <ChoiceOptions options={videoResolutions} value={video.resolution} label="清晰度"
          caption={resolutionLabel}
          onChange={(resolution) => onChange({ ...value, video: { ...video, resolution } })} />
      </>;
    }
    if (capabilityStatus) return capabilityStatus;
    const ratios = [...new Set(sizes.map((item) => item.ratio))];
    const resolutions = sizes.filter((item) => item.ratio === parameters.ratio).map((item) => item.resolution);
    return <>
      {targetSpec ? (
        <span className="quick-parameter-label">交付规格 · {targetSpec.ratio} · {targetSpec.resolution}</span>
      ) : ratios.length ? (
        <>
          <RatioOptions options={ratios} value={parameters.ratio} onChange={(ratio) => {
            const next = sizes.find((item) => item.ratio === ratio && item.resolution === parameters.resolution)
              ?? sizes.find((item) => item.ratio === ratio);
            if (next) onChange({ ...value, parameters: { ...parameters, ratio, resolution: next.resolution } });
          }} />
          {resolutions.length > 0 && (
            <ChoiceOptions options={resolutions} value={parameters.resolution} label="清晰度"
              onChange={(resolution) => onChange({ ...value, parameters: { ...parameters, resolution } })} />
          )}
        </>
      ) : <span className="quick-parameter-label" role="status">当前模型无可用画面规格</span>}
      {size && <output className="quick-parameter-label">{size.width} × {size.height}</output>}
      {model && model.qualities.length > 0 && (
        <ChoiceOptions options={model.qualities} value={parameters.quality ?? model.default_quality ?? ''}
          label="生成质量" caption={(quality) => qualityLabels[quality] ?? quality}
          onChange={(quality) => onChange({ ...value, parameters: { ...parameters, quality } })} />
      )}
    </>;
  }

  return (
    <>
      <QuickParameterPopover label="生成模型" value={video ? videoLabels[video.model ?? 'seedance-2.0']
        : model?.label ?? imageModelLabel(parameters.model)} width="wide"
        icon={canvas && <AppstoreOutlined aria-hidden="true" />} {...popover('model')}>
        {modelOptions}
      </QuickParameterPopover>
      <QuickParameterPopover label="画面规格" value={canvas ? `${specText} · ${countLabel(count)}` : specText}
        width="wide" icon={canvas && <BorderOutlined aria-hidden="true" />} {...popover('specs')}>
        {() => (
          <>
            {specOptions()}
            {canvas && (
              <>
                {!capabilityStatus && (
                  <ChoiceOptions options={counts} value={count} label="生成张数" caption={countLabel}
                    onChange={(next) => onChange({ ...value, parameters: { ...parameters, count: next } })} />
                )}
                <div className="canvas-spec-actions">
                  <button type="button" onClick={canvas.onReset}>恢复默认参数</button>
                </div>
              </>
            )}
          </>
        )}
      </QuickParameterPopover>
      {video && (
        <QuickParameterPopover label="视频时长" value={`${video.duration ?? 5} 秒`} width="wide" {...popover('duration')}>
          {(close) => <ChoiceOptions
            options={Array.from({ length: (video.model === 'seedance-2.5' ? 30 : 15) - 3 }, (_, i) => i + 4)}
            value={video.duration ?? 5} caption={(seconds) => `${seconds} 秒`}
            onChange={(duration) => { onChange({ ...value, video: { ...video, duration } }); close(); }} />}
        </QuickParameterPopover>
      )}
      {!canvas && <QuickParameterPopover label={video ? '生成条数' : '生成张数'} value={countLabel(count)} {...popover('count')}>
        {(close) => <ChoiceOptions options={counts}
          value={count} caption={countLabel} onChange={(next) => {
            onChange(video ? { ...value, video: { ...video, count: next } }
              : { ...value, parameters: { ...parameters, count: next } });
            close();
          }} />}
      </QuickParameterPopover>}
    </>
  );
}

function ModelChoice({
  label, provider, selected, disabled, withIcon, onClick,
}: {
  label: string;
  provider: string;
  selected: boolean;
  disabled?: boolean;
  withIcon?: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="quick-model-option" aria-pressed={selected} disabled={disabled} onClick={onClick}>
      {withIcon && <span className="canvas-model-icon"><AppstoreOutlined aria-hidden="true" /></span>}
      <span className="quick-model-name">{label}<small>{provider}</small></span>
      {selected && <CheckOutlined aria-hidden="true" />}
    </button>
  );
}
