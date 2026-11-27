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
const sizes = [
  size,
  { ratio: '1:1', resolution: '1.5K', width: 1536, height: 1536 },
  { ratio: '1:1', resolution: '2K', width: 2048, height: 2048 },
  { ratio: '9:16', resolution: '2K', width: 1440, height: 2560 },
  { ratio: '16:9', resolution: '2K', width: 2560, height: 1440 },
  { ratio: '3:4', resolution: '2K', width: 1728, height: 2304 },
  { ratio: '4:3', resolution: '2K', width: 2304, height: 1728 },
];
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
  { id: source.id, x: 78, y: 220 },
];
const initialCamera = { x: 300, y: 70, zoom: 0.45, version: 1 };
const writes = [];
const errors = [];
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const width of [1280, 390, 320]) {
    let empty = true;
    let video = false;
    let quick = false;
    let videoReady = false;
    let failReference = width === 1280;
    let failDraftSave = width === 1280;
    let draft = { ...initialDraft };
    writes.length = 0;
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 800 } });
    page.on('pageerror', (e) => {
      errors.push(e.message);
      console.error(e);
    });
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
          nodes: empty ? [] : [video ? { ...creation, label: '视频生成', media: 'video' } : creation, source],
          creations: empty ? [] : [draft],
          layout: { positions: empty ? [] : positions, version: 1 },
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
          sizes,
          models: [
            { provider: 'ark', model: parameters.model, label: 'Seedream 5.5', qualities: [], default_quality: null, sizes },
            { provider: 'gpt-image', model: 'gpt-image-2', label: 'gpt-image-2',
              qualities: ['low', 'high'], default_quality: 'low', sizes: [size] },
          ],
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
      if (path === '/tasks/t/canvas/viewport' && method === 'PUT') {
        const { x, y, zoom, expected_version } = req.postDataJSON();
        return ok({ x, y, zoom, version: expected_version + 1 });
      }
      if (method === 'GET') return ok([]);
      if (path === '/creations/d/references' && failReference) {
        failReference = false;
        return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
      }
      if (path === '/creations/d' && method === 'PATCH' && failDraftSave) {
        failDraftSave = false;
        return route.fulfill({ status: 503, json: { detail: 'unavailable' } });
      }
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
      if (path === '/creations/d/references/ref-photo' && method === 'DELETE') {
        assert.equal(new URL(req.url()).searchParams.get('expected_version'), String(draft.version));
        draft = { ...draft, version: draft.version + 1, references: [] };
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
    const start = page.getByRole('group', { name: '开始创作' });
    const hint = start.getByText('双击画布，添加节点');
    const entries = start.getByRole('button');
    await expect(entries).toHaveCount(3, { timeout: 15000 }).catch(async (error) => {
      console.error(await page.locator('body').innerText());
      throw error;
    });
    const hintBox = await hint.boundingBox();
    for (const entry of await entries.all()) {
      const bounds = await entry.boundingBox();
      assert(bounds.y > hintBox.y + hintBox.height, 'The hint must sit above the entry buttons');
      await expect(entry).toBeInViewport({ ratio: 1 });
      await expect(entry.locator('.anticon')).toHaveCSS('color', 'rgb(228, 228, 228)');
      await expect(entry.locator('.anticon')).toHaveCSS('background-color', 'rgb(45, 45, 45)');
    }
    await expect(page.getByRole('button', { name: '选择节点', exact: true }))
      .toHaveCSS('background-color', 'rgb(232, 232, 232)');
    await page.screenshot({ path: resolve(artifacts, `empty-${width}.png`) });
    const addNode = page.getByRole('button', { name: '添加节点', exact: true });
    await addNode.hover();
    const addTip = page.getByRole('tooltip', { name: '添加节点', exact: true });
    await expect(addTip).toBeVisible();
    const tipBox = await addTip.boundingBox();
    const addBox = await addNode.boundingBox();
    assert(tipBox.y + tipBox.height <= addBox.y, 'The tooltip must sit above the toolbar');
    await expect(addTip).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(artifacts, `tools-${width}.png`) });
    const focusNode = page.getByRole('button', { name: '定位选中节点' });
    await expect(focusNode).toBeDisabled();
    await focusNode.locator('..').hover();
    const focusTip = page.getByRole('tooltip', { name: '定位选中节点', exact: true });
    await expect(focusTip).toBeInViewport({ ratio: 1 });
    await hint.hover();
    await expect(addTip).toBeHidden();
    await expect(focusTip).toBeHidden();
    await addNode.focus();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('tooltip', { name: '任务作品', exact: true })).toBeVisible();
    await start.getByRole('button', { name: '添加商品素材' }).click();
    await expect(page.getByRole('dialog', { name: '添加商品素材' })).toBeVisible();
    await page.keyboard.press('Escape');
    empty = false;
    await page.reload();
    const target = page.locator('.react-flow__node[data-id="creation:d"]');
    const composer = page.getByRole('dialog', { name: '图片生成', exact: true });
    const zoom = page.getByLabel('缩放倍率');
    await expect(target.locator('.canvas-node-media')).toBeVisible();
    await expect(target.locator('.canvas-node-heading')).toContainText('草稿');
    await expect(target.locator('.canvas-node-meta')).toHaveCount(0);
    await target.click();
    await expect(zoom).not.toHaveText('45%');
    await expect(composer.getByRole('button', { name: '生成 1 张' })).toBeDisabled();
    await expect(composer.getByRole('alert')).toHaveCount(0);
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
    const modelTrigger = footer.getByRole('button', { name: /生成模型/ });
    const specTrigger = footer.getByRole('button', { name: /画面规格/ });
    await expect(modelTrigger).toContainText('Seedream 5.5');
    await modelTrigger.click();
    const models = composer.getByRole('group', { name: '生成模型' });
    await expect(models.getByRole('button', { name: /Seedream 5.5/, pressed: true })).toBeVisible();
    await expect(models).toBeInViewport({ ratio: 1 });
    if (width === 1280) await page.screenshot({ path: resolve(artifacts, 'image-models.png') });
    await page.keyboard.press('Escape');
    await expect(modelTrigger).toBeFocused();
    await expect(composer).toBeVisible();
    await modelTrigger.click();
    await models.getByRole('button', { name: /gpt-image-2/i }).click();
    await expect(modelTrigger).toContainText('gpt-image-2');
    await specTrigger.click();
    const settings = composer.getByRole('group', { name: '画面规格', exact: true });
    await expect(settings.getByRole('button', { name: '低', pressed: true })).toBeVisible();
    await expect(settings.getByRole('button', { name: '16:9', exact: true })).toHaveCount(0);
    await settings.getByRole('button', { name: '恢复默认参数' }).click();
    await expect(modelTrigger).toContainText('Seedream 5.5');
    await page.keyboard.press('Escape');
    await expect(footer.getByRole('button', { name: '保存草稿' })).toHaveCount(0);
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
    const prompt = composer.getByRole('textbox', { name: '提示词' });
    const mentionList = page.getByRole('listbox', { name: '画布素材' });
    await prompt.fill('保留前文 @找不到');
    await expect(page.getByText('没有匹配的画布素材')).toBeVisible();
    await prompt.press('Escape');
    await expect(mentionList).toHaveCount(0);
    await expect(prompt).toBeFocused();
    await prompt.fill('保留前文，保留后文。');
    await prompt.evaluate((field) => field.setSelectionRange(4, 4));
    await page.keyboard.insertText('@');
    if (width === 1280) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Input.imeSetComposition', { text: 'fanbu', selectionStart: 5, selectionEnd: 5 });
      await expect(mentionList).toHaveCount(0);
      await cdp.send('Input.insertText', { text: '帆布' });
      await cdp.detach();
    } else {
      await page.keyboard.insertText('帆布');
    }
    await expect(mentionList).toBeInViewport({ ratio: 1 });
    const option = mentionList.getByRole('option', { name: '帆布鞋实拍' });
    await expect(option).toHaveAttribute('aria-selected', 'true');
    await page.screenshot({ path: resolve(artifacts, `reference-mention-${width}.png`) });
    await prompt.press('Enter');
    if (width === 1280) {
      await expect(page.locator('.canvas-mention-popup').getByRole('alert')).toBeVisible();
      await expect(prompt).toHaveValue('保留前文@帆布，保留后文。');
      await prompt.press('Enter');
    }
    await expect(prompt).toHaveValue('保留前文[[ref:ref-photo]]，保留后文。');
    await expect(prompt).toBeFocused();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const assetNode = page.locator('.react-flow__node[data-id="upload:photo"]');
    const assetFrame = assetNode.locator('.canvas-node-media');
    const assetImage = assetFrame.locator('img');
    await expect(assetNode.locator('.canvas-node-meta')).toHaveCount(0);
    await expect(assetImage).toHaveCSS('object-fit', 'cover');
    await expect.poll(() => assetFrame.evaluate((frame) =>
      frame.clientHeight === frame.querySelector('img').clientHeight && frame.clientHeight >= 80,
    )).toBe(true);
    if (width === 1280) await expect(assetFrame).toBeInViewport({ ratio: 1 });
    const link = page.locator('.react-flow__edge');
    await expect(link).toHaveAttribute('aria-label', '商品实拍');
    await expect(link.locator('.react-flow__edge-text')).toBeHidden();
    await expect(link.locator('.react-flow__edge-path')).toHaveCSS('stroke-width', '1.5px');
    const thumb = composer.getByRole('button', { name: '插入参考 1 标签' });
    const locate = composer.getByRole('button', { name: '定位参考 1' });
    const remove = composer.getByRole('button', { name: '移除参考 1' });
    await page.mouse.move(width - 1, 120);
    await expect(locate).toHaveCSS('opacity', '0');
    await thumb.hover();
    await expect(locate).toHaveCSS('opacity', '1');
    await expect(remove).toHaveCSS('opacity', '1');
    const [thumbBox, locateBox, removeBox] = await Promise.all(
      [thumb, locate, remove].map((item) => item.boundingBox()),
    );
    assert(locateBox.x > thumbBox.x + thumbBox.width / 2);
    assert.equal(locateBox.x, removeBox.x);
    assert(locateBox.y < thumbBox.y + thumbBox.height / 2);
    assert(removeBox.y > thumbBox.y + thumbBox.height / 2);
    await locate.hover();
    await expect(page.getByRole('tooltip', { name: '定位来源' })).toBeVisible();
    if (width === 1280) await page.screenshot({ path: resolve(artifacts, 'reference-actions.png') });
    await prompt.fill('@');
    await expect(mentionList.getByText('已引用', { exact: true })).toBeVisible();
    await mentionList.getByRole('option', { name: /帆布鞋实拍/ }).click();
    await expect(prompt).toHaveValue('[[ref:ref-photo]]');
    assert.equal(writes.filter((item) => item.path === '/creations/d/references').length, 1);
    await page.mouse.move(width - 1, 120);
    await page.screenshot({ path: resolve(artifacts, `reference-${width}.png`) });
    await composer.getByRole('button', { name: '插入参考 1 标签' }).click();
    await expect(composer.getByLabel('提示词', { exact: true })).toHaveValue(
      /\[\[ref:ref-photo\]\]/,
    );
    const draftPrompt = await prompt.inputValue();
    const closeComposer = composer.getByRole('button', { name: '关闭画布浮层' });
    await closeComposer.click();
    if (width === 1280) {
      await expect(page.getByRole('alert').filter({ hasText: '草稿保存失败' })).toBeVisible();
      await expect(prompt).toHaveValue(draftPrompt);
      await closeComposer.click();
    }
    await expect(composer).toHaveCount(0);
    assert.equal(draft.prompt, draftPrompt);
    await page.reload();
    await target.click();
    await expect(prompt).toHaveValue(draftPrompt);
    await specTrigger.click();
    await expect(settings.getByRole('button', { name: '核对生成输入' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await specTrigger.click();
    await settings.getByRole('button', { name: '16:9', exact: true }).click();
    await expect(specTrigger).toContainText('16:9 · 2K');
    await expect(settings).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(artifacts, `image-specs-${width}.png`) });
    const count = settings.getByRole('group', { name: '生成张数' });
    await count.getByRole('button', { name: '2 张', exact: true }).click();
    await settings.getByRole('button', { name: '恢复默认参数' }).click();
    await expect(count.getByRole('button', { name: '1 张', pressed: true })).toBeVisible();
    await count.getByRole('button', { name: '2 张', exact: true }).click();
    await page.keyboard.press('Escape');
    await expect(specTrigger).toBeFocused();
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
    if (width === 1280) {
      await target.click();
      const toolPrompt = `${draftPrompt}，加强鞋底细节。`;
      await prompt.fill(toolPrompt);
      await composer.getByRole('button', { name: '提示词工具' }).click();
      const tools = page.getByRole('dialog', { name: '提示词工具' });
      await expect(tools.getByRole('button', { name: '优化提示词' })).toBeEnabled();
      assert.equal(draft.prompt, toolPrompt);
      await page.keyboard.press('Escape');
      await thumb.hover();
      await locate.click();
      await expect(composer).toHaveCount(0);
      await expect(assetNode).toHaveClass(/canvas-focused/);
      await target.click();
      await thumb.hover();
      await remove.hover();
      await expect(page.getByRole('tooltip', { name: '移除参考' })).toBeVisible();
      await remove.click();
      await expect(thumb).toHaveCount(0);
      await expect(link).toHaveCount(0);
      await expect(composer.getByText('提示词含已移除的引用标签。')).toBeVisible();
    }
    console.log(`${width}px: image node, parameter popovers, save and generation passed.`);

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
    await expect(videoFooter.getByRole('button', { name: '成片分镜' })).toBeVisible();
    await expect(videoFooter.getByRole('button', { name: '保存草稿' })).toHaveCount(0);
    await videoToolbar.getByRole('button', { name: '画布参考' }).click();
    await pick.getByRole('button', { name: /帆布鞋实拍/ }).click();
    await pick.getByLabel('引用用途').selectOption('first_frame');
    await pick.getByRole('button', { name: '添加参考' }).click();
    await expect(page.locator('.react-flow__edge')).toHaveCount(1);
    const videoPrompt = videoComposer.getByRole('textbox', { name: '提示词' });
    await videoPrompt.fill('镜头缓慢推进，展示鞋面纹理。');
    await videoSpec.click();
    const videoSettings = page.getByRole('dialog', { name: '视频参数' });
    await expect(videoSettings.getByRole('button', { name: '核对生成输入' })).toHaveCount(0);
    await videoSettings.getByRole('combobox').filter({
      has: page.getByRole('option', { name: '9:16', exact: true }),
    }).selectOption('9:16');
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
