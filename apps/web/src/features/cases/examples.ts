import shoe from '../tasks/sneaker-studio.jpg';
import jacket from './jacket.jpg';
import beauty from './beauty.jpg';
import skincare from './skincare.jpg';
import pair from './sneaker-pair.jpg';
import tan from './sneaker-tan.jpg';

// Prototype artwork is a public study of composition, without a production license.
export const examples = [
  {
    name: '留白之间，自在生长',
    features: '悬浮构图 · 自然侧光',
    category: 'apparel',
    image: shoe,
    media: 'image',
  },
  {
    name: '把日常，穿成风格',
    features: '人物中景 · 克制色调',
    category: 'apparel',
    image: jacket,
    media: 'image',
  },
  {
    name: '一束光里的自然感',
    features: '植物投影 · 暖色侧光',
    category: 'beauty',
    image: beauty,
    media: 'image',
  },
  {
    name: '色彩，恰到好处',
    features: '色块构成 · 柔和配色',
    category: 'beauty',
    image: skincare,
    media: 'image',
  },
  {
    name: '从全貌，到每处细节',
    features: '全貌定场 · 细节过渡',
    category: 'apparel',
    image: pair,
    media: 'video',
  },
  {
    name: '复古暖调 · 商品质感',
    features: '斜向构图 · 织物暖调',
    category: 'apparel',
    image: tan,
    media: 'image',
  },
] as const;
