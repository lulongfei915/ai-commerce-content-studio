import type { ReactNode } from 'react';
import { imageModelLabel } from './api';
import type { Parameters, VideoParameters } from './api';

export function CanvasSpecs({
  parameters,
  video,
  children,
}: {
  parameters: Parameters;
  video?: VideoParameters;
  children: ReactNode;
}) {
  const spec = video ?? parameters;
  return (
    <details className="canvas-specs">
      <summary>
        <span>{video ? '视频参数' : '图片参数'}</span> ·{' '}
        {video ? 'Seedance 2.0' : imageModelLabel(parameters.model)} ·{' '}
        {spec.ratio} · {spec.resolution} · {video ? `${video.duration}s` : `${parameters.count} 张`}
      </summary>
      {children}
    </details>
  );
}
