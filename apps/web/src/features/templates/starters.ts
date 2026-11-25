import { defaults } from '../creation/api';
import type { Template, TemplateContent } from './api';

export function newTemplate(category: TemplateContent['category']): TemplateContent {
  return {
    name: '',
    category,
    purpose: 'main',
    prompt: '以{{商品名称}}实拍为主体，保持{{商品事实}}，柔和光线、干净背景。',
    parameters: { ...defaults, resolution: '2K' },
    check_rules: ['商品一致性必检', '人物一致性（有人物时）', '场景一致性'],
  };
}

export function matchesTemplate(
  template: Template,
  filters: {
    query: string;
    category: string;
    media: string;
    state: string;
  },
) {
  const { query, category, media, state } = filters;
  let status = 'draft';
  if (!template.version) status = 'preset';
  else if (template.published_version) status = template.enabled ? 'published' : 'disabled';
  if (state && state !== status) return false;
  return [template.content, template.published_content].some(
    (content) =>
      content &&
      content.name.toLowerCase().includes(query.trim().toLowerCase()) &&
      (!category || content.category === category) &&
      (!media || media === (content.purpose === 'video' ? 'video' : 'image')),
  );
}

export function starterTemplates(): Template[] {
  return (['apparel', 'beauty'] as const).flatMap((category) =>
    (['main', 'detail', 'video'] as const).map((purpose) => {
      const group = category === 'apparel' ? '鞋服' : '美妆个护';
      const name =
        purpose === 'main'
          ? category === 'apparel'
            ? '轻行系列 · 简约棚拍'
            : '自然植感 · 包装展示'
          : `${group} · ${purpose === 'video' ? '商品视频' : '细节展示'}`;
      return {
        id: `preset-${category}-${purpose}`,
        version: 0,
        published_version: null,
        enabled: false,
        has_unpublished_changes: false,
        content: {
          name,
          category,
          purpose,
          parameters: { ...defaults, resolution: '2K', count: 2 },
          video_parameters:
            purpose === 'video'
              ? { model: 'seedance-2.0', ratio: '9:16', resolution: '720p', duration: 5, count: 1 }
              : null,
          prompt:
            purpose === 'video'
              ? '先展示商品全貌，再平稳过渡到已确认的细节。保持实拍中的商品颜色和结构。'
              : '以商品实拍为主体，使用简洁背景和柔和侧光，保留真实颜色、轮廓与细节。',
          check_rules: ['商品一致性必检', '人物一致性（有人物时）', '场景一致性'],
          case_ids: [],
        },
      };
    }),
  );
}
