/* global process, localStorage, document, URL, console */
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.env.STUDIO_CANVAS_URL ?? 'http://127.0.0.1:5178';
const artifacts = resolve(import.meta.dirname, '../../../output/playwright/canvas-image');
const fixturePhoto = resolve(import.meta.dirname, '../../../prototype/assets/sneaker-white.jpg');
const product = {
  id: 'p',
  sku: 'SHOE-01',
  name: '浅色帆布鞋',
  category: 'apparel',
  version: 1,
  facts: {},
  readiness: {},
  photos: [{ file_id: 'photo', version: 1 }],
};
const task = {
  id: 't',
  name: '浅色帆布鞋 · 春季主图',
  products: [product],
  version: 1,
  status: 'draft',
  positions: [{ id: 'position', product_id: product.id, purpose: 'main', status: 'unfilled' }],
};
const size = { ratio: '1:1', resolution: '1K', width: 1024, height: 1024 };
const parameters = {
  provider: 'ark',
  model: 'seedream-5.5',
  ratio: '1:1',
  resolution: '1K',
  count: 1,
};
const defaultVideo = {
  model: 'seedance-2.0',
  ratio: '16:9',
  resolution: '720p',
  duration: 5,
  count: 1,
};
const videoTemplate = {
  id: 'video-template',
  published_version: 1,
  content: {
    name: '商品运镜',
    purpose: 'video',
    prompt: '镜头围绕商品。',
    video_parameters: { ...defaultVideo, ratio: '1:1' },
  },
};
const initialDraft = {
  id: 'd',
  task_id: 't',
  product_id: 'p',
  entry: 'canvas',
  purpose: 'main',
  slot: 'primary',
  version: 1,
  prompt: '',
  parameters,
  references: [],
};
const creation = {
  id: 'creation:d',
  kind: 'creation',
  source_id: 'd',
  media: 'image',
  label: '图片生成',
  product_id: 'p',
  status: 'draft',
};
const source = {
  id: 'upload:photo',
  kind: 'upload',
  source_id: 'photo',
  file_id: 'photo',
  file_version: 1,
  media: 'image',
  label: '帆布鞋实拍',
  product_id: 'p',
  referenceable: true,
  previewable: true,
  status: 'ready',
};
const positions = [
  { id: creation.id, x: 300, y: 220 },
  { id: source.id, x: -500, y: 270 },
];
const initialCamera = { x: 300, y: 70, zoom: 0.45, version: 1 };
const writes = [];
const errors = [];
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const width of [1280, 390, 320]) {
    let video = false;
    let quick = false;
    let videoReady = false;
    let draft = { ...initialDraft };
    writes.length = 0;
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 800 } });
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(() => {
      const key = 'zaowu-studio-entry:studio:user';
      if (!localStorage.getItem(key)) localStorage.setItem(key, 'canvas');
    });
    await page.route('**/api/v1/**', async (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname.replace('/api/v1', '');
      const method = req.method();
      const ok = (json) => route.fulfill({ json });
      if (path === '/me')
        return ok({
          tenant: { id: 'studio', slug: 'studio', name: '造物' },
          user_id: 'user',
          email: 'test@example.test',
          csrf_token: 'test',
          role: 'admin',
          permissions: ['view', 'create', 'download'],
        });
      if (path === '/tasks') return ok({ items: [task], next_cursor: null });
      if (path === '/tasks/t')
        return ok(quick ? {
          ...task,
          positions: [{ ...task.positions[0], purpose: 'video' }],
        } : task);
      if (path === '/tasks/t/creations') return ok(quick ? [draft] : []);
      if (path === '/executions/job' && quick) {
        const status = videoReady ? 'pending_review' : 'generating';
        return ok({ id: 'job', media: 'video', outputs: [{ id: 'o', status }] });
      }
      if (path === '/tasks/t/results') {
        return ok(videoReady ? [{
          asset_id: 'asset', version_id: 'o', version: 1, file_version: 1,
          label: '验证视频.mp4', media: 'video', status: 'pending_review', previewable: true,
        }] : []);
      }
      if (path === '/templates')
        return ok({ items: video ? [videoTemplate] : [], next_cursor: null });
      if (path === '/cases') return ok({ items: [], next_cursor: null });
      if (path.includes('/preview'))
        return route.fulfill({ path: fixturePhoto, contentType: 'image/jpeg' });
      if (path === '/tasks/t/canvas')
        return ok({
          nodes: [video ? { ...creation, label: '视频生成', media: 'video' } : creation, source],
          creations: [draft],
          layout: { positions, version: 1 },
          viewport: width === 1280 ? initialCamera : { ...initialCamera, x: 15 },
          edges: draft.references.map((ref) => ({
            id: ref.id,
            source: source.id,
            target: creation.id,
            usage: ref.usage,
          })),
        });
      if (path === '/creation-capabilities')
        return ok({
          max_outputs: 6,
          sizes: [size],
          models: [{ ...parameters, label: 'Seedream 5.5', qualities: [], sizes: [size] }],
        });
      if (path === '/creations/d/input-snapshot')
        return ok({
          draft,
          product_fact_version: 1,
          product_photos: product.photos.filter((photo) =>
            draft.references.some(
              (ref) => ref.file_id === photo.file_id && ref.usage === 'product',
            ),
          ),
          references: draft.references,
        });
      if (method === 'GET') return ok([]);
      const body = req.postDataJSON();
      writes.push({ method, path, body });
      if (path === '/creations/d/references') {
        assert.equal(body.usage, video ? 'first_frame' : 'product');
        assert.equal(body.source_id, source.source_id);
        assert.equal(body.file_version, source.file_version);
        draft = {
          ...draft,
          version: draft.version + 1,
          references: [{ ...source, id: 'ref-photo', usage: body.usage, origin: 'independent' }],
        };
        return ok(draft);
      }
      if (path === '/creations/d' && method === 'PATCH') {
        assert.equal(body.expected_version, draft.version);
        draft = {
          ...draft,
          version: draft.version + 1,
          prompt: body.prompt,
          ...(video
            ? { video_parameters: body.video_parameters }
            : { parameters: body.parameters }),
        };
        return ok(draft);
      }
      if (path === '/creations/d/template') {
        assert.equal(body.prompt_action, 'keep');
        draft = {
          ...draft,
          template_id: videoTemplate.id,
          template_version: videoTemplate.published_version,
          version: draft.version + 1,
          video_parameters: videoTemplate.content.video_parameters,
        };
        return ok(draft);
      }
      if (path === '/creations/d/executions') {
        if (!video && writes.filter((item) => item.path === path).length === 1)
          return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
        return ok({ id: 'job', media: video ? 'video' : 'image', outputs: [{ id: 'o', status: 'queued' }] });
      }
      throw new Error(`Unexpected write ${method} ${path}`);
    });

    await page.goto(origin);
    const target = page.locator('.react-flow__node[data-id="creation:d"]');
    const composer = page.getByRole('dialog', { name: '图片生成', exact: true });
    const zoom = page.getByLabel('缩放倍率');
    await target.click();
    await expect(zoom).not.toHaveText('45%');
    await composer
      .getByRole('textbox', { name: '提示词' })
      .fill('自然侧光，保留鞋面纹理，背景简洁。');
    await expect(composer.getByRole('button', { name: '生成 1 张' })).toBeInViewport({ ratio: 1 });
    const sourceTools = composer
      .getByRole('group', { name: '编辑工具' })
      .getByRole('group', { name: '创作素材' });
    for (const name of ['商品实拍', '应用模板', '添加案例', '公司资产']) {
      const tool = sourceTools.getByRole('button', { name, exact: true });
      await expect(tool).toBeVisible();
      await expect(tool).toHaveAttribute('title', name);
      await expect(tool).toHaveText('');
    }
    const footer = composer.getByRole('group', { name: '生成设置' });
    await expect(footer.getByRole('button')).toHaveCount(3);
    await expect(footer.getByRole('button', { name: '保存草稿' })).toHaveText('保存草稿');
    await expect(composer.getByRole('button', { name: '展开输入框' })).toHaveCount(0);
    await expect
      .poll(() => sourceTools.locator('img').evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    if (width !== 320)
      await page.screenshot({
        path: resolve(artifacts, width === 1280 ? 'desktop.png' : 'mobile.png'),
      });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      true,
    );
    const preview = await target.boundingBox();
    const panel = await composer.boundingBox();
    assert(
      preview.y + preview.height < panel.y,
      'Editor should leave the selected preview visible',
    );
    await sourceTools.getByRole('button', { name: '商品实拍' }).click();
    await expect(
      page.getByRole('dialog', { name: '商品实拍' }).getByText('实拍 1 · V1'),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    for (const [name, title] of [
      ['应用模板', '应用公司模板'],
      ['添加案例', '添加案例参考'],
      ['公司资产', '引用公司资产'],
    ]) {
      await sourceTools.getByRole('button', { name, exact: true }).click();
      await expect(page.getByRole('dialog', { name: title, exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
    }
    const pick = page.getByRole('dialog', { name: '画布参考' });
    await sourceTools.getByRole('button', { name: '商品实拍' }).click();
    await page
      .getByRole('dialog', { name: '商品实拍' })
      .getByRole('button', { name: '添加实拍 1', exact: true })
      .click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    await composer.getByRole('button', { name: '插入参考 1 标签' }).click();
    await expect(composer.getByLabel('提示词', { exact: true })).toHaveValue(
      /\[\[ref:ref-photo\]\]/,
    );
    await footer.getByRole('button', { name: '保存草稿' }).click();
    await expect(composer.getByText('草稿已保存')).toBeVisible();
    await composer.getByRole('button', { name: '图片参数' }).click();
    const settings = page.getByRole('dialog', { name: '图片参数' });
    await settings.getByRole('button', { name: '核对生成输入' }).click();
    const snapshot = page.getByRole('dialog', { name: '生成输入核对' });
    await expect(snapshot.getByText('商品实拍 1 张')).toBeVisible();
    await page.keyboard.press('Escape');
    await composer.getByRole('button', { name: '图片参数' }).click();
    const count = settings.getByLabel('张数');
    await count.fill('2');
    await expect(settings.getByRole('button', { name: '核对生成输入' })).toBeDisabled();
    await settings.getByRole('button', { name: '恢复默认参数' }).click();
    await expect(count).toHaveValue('1');
    await count.fill('2');
    await page.keyboard.press('Escape');
    const generate = composer.getByRole('button', { name: '生成 2 张' });
    await generate.click();
    await expect(composer.getByRole('alert')).toBeVisible();
    await generate.click();
    await expect(composer.getByRole('button', { name: '生成中' })).toBeDisabled();
    await expect(composer.getByRole('button', { name: '取消排队' })).toBeVisible();
    assert.deepEqual(
      writes.map((w) => w.method),
      ['POST', 'PATCH', 'PATCH', 'POST', 'POST'],
    );
    assert.equal(writes[3].body.expected_version, draft.version);
    assert.equal(draft.parameters.count, 2);
    assert.deepEqual(writes[3], writes[4]);
    await page.keyboard.press('Escape');
    await expect(composer).toHaveCount(0);
    await expect(target).toBeFocused();
    await expect(zoom).toHaveText('45%');

    video = true;
    writes.length = 0;
    draft = {
      ...draft,
      purpose: 'video',
      version: 1,
      prompt: '',
      references: [],
      video_parameters: defaultVideo,
    };
    await page.reload();
    await target.click();
    const videoComposer = page.getByRole('dialog', { name: '视频生成', exact: true });
    await expect(zoom).not.toHaveText('45%');
    const videoToolbar = videoComposer.getByRole('group', { name: '编辑工具' });
    await expect(videoToolbar.getByRole('button', { name: '商品实拍' })).toBeVisible();
    const videoFooter = videoComposer.getByRole('group', { name: '生成设置' });
    const videoSpec = videoFooter.getByRole('button', { name: '视频参数' });
    await expect(videoSpec).toContainText('Seedance 2.0');
    await expect(videoSpec).toContainText('16:9 · 720p · 5s · 1 条');
    await expect(videoFooter.getByRole('button', { name: '生成视频' })).toBeDisabled();
    await expect(videoFooter.getByRole('button')).toHaveCount(3);
    await videoToolbar.getByRole('button', { name: '画布参考' }).click();
    await pick.getByRole('button', { name: /帆布鞋实拍/ }).click();
    await pick.getByLabel('引用用途').selectOption('first_frame');
    await pick.getByRole('button', { name: '添加参考' }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const videoPrompt = videoComposer.getByRole('textbox', { name: '提示词' });
    await videoPrompt.fill('镜头缓慢推进，展示鞋面纹理。');
    await videoSpec.click();
    const videoSettings = page.getByRole('dialog', { name: '视频参数' });
    await videoSettings.getByLabel('比例 / 清晰度').selectOption('9:16');
    await videoSettings.getByLabel('时长').selectOption('10');
    await page.keyboard.press('Escape');
    await expect(videoSpec).toContainText('9:16 · 720p · 10s · 1 条');
    const generateVideo = videoFooter.getByRole('button', { name: '生成视频' });
    await expect(generateVideo).toBeInViewport({ ratio: 1 });
    const videoPreview = await target.boundingBox();
    const videoPanel = await videoComposer.boundingBox();
    assert(videoPreview.y + videoPreview.height < videoPanel.y);
    if (width !== 320)
      await page.screenshot({
        path: resolve(artifacts, width === 1280 ? 'video-desktop.png' : 'video-mobile.png'),
      });
    await generateVideo.click();
    await expect(videoComposer.getByText('视频 1 · 排队中')).toBeVisible();
    assert.deepEqual(
      writes.map(({ method, path }) => [method, path]),
      [
        ['POST', '/creations/d/references'],
        ['PATCH', '/creations/d'],
        ['POST', '/creations/d/executions'],
      ],
    );
    assert.equal(writes[1].body.video_parameters.ratio, '9:16');
    assert.equal(writes[1].body.video_parameters.duration, 10);
    assert.equal(writes[2].body.expected_version, draft.version);
    await page.keyboard.press('Escape');
    await expect(zoom).toHaveText('45%');
    await target.click();
    await expect(videoPrompt).toHaveValue('镜头缓慢推进，展示鞋面纹理。');
    await videoPrompt.fill('补充商品细节特写。');
    await videoToolbar.getByRole('button', { name: '应用模板' }).click();
    const templatePicker = page.getByRole('dialog', { name: '应用公司模板' });
    await templatePicker.getByRole('radio', { name: '商品运镜 · V1' }).check();
    await templatePicker.getByRole('button', { name: '确认应用' }).click();
    await expect(videoPrompt).toHaveValue('补充商品细节特写。');
    await expect(videoSpec).toContainText('1:1 · 720p · 5s · 1 条');
    if (width === 1280) {
      quick = true;
      writes.length = 0;
      draft = {
        ...initialDraft, entry: 'quick', purpose: 'video', video_parameters: defaultVideo,
      };
      await page.evaluate(() => localStorage.setItem('zaowu-studio-entry:studio:user', 'quick'));
      await page.reload();
      const quickEditor = page.getByRole('region', { name: '快捷创作' });
      await quickEditor.getByRole('textbox', { name: '提示词' }).fill('镜头跟随人物缓慢前进。');
      const quickGenerate = quickEditor.getByRole('button', { name: '生成视频' });
      await expect(quickGenerate).toBeEnabled();
      await page.screenshot({ path: resolve(artifacts, 'video-quick.png') });
      await quickGenerate.click();
      const results = page.getByRole('region', { name: '创作结果' });
      await results.getByRole('button', { name: '视频', exact: true }).click();
      await expect(results.getByText('视频 1', { exact: true })).toBeVisible();
      await expect(results.getByText('生成中', { exact: true })).toBeVisible();
      videoReady = true;
      await results.getByRole('button', { name: '查看 验证视频.mp4' }).click();
      const player = page.getByRole('dialog', { name: '验证视频.mp4' }).locator('video');
      await expect(player).toHaveAttribute('controls', '');
      await expect(player).toHaveAttribute('src', /\/results\/o\/preview/);
      assert.deepEqual(writes.map(({ method }) => method), ['PATCH', 'POST']);
      assert.equal(writes[1].body.expected_version, draft.version);
    }
    await page.close();
    console.log(
      `${width}px: canvas image and video generation passed${quick ? ', including quick video playback' : ''}.`,
    );
  }
  assert.deepEqual(errors, []);
} finally {
  await browser.close();
}
