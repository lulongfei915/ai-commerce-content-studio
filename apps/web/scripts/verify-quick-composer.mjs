/* global console, document, FormData, getComputedStyle, localStorage, process, URL */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.env.STUDIO_QUICK_URL ?? 'http://127.0.0.1:5179';
const artifacts = resolve(import.meta.dirname, '../../../output/playwright/quick-composer');
const fixtureAssets = resolve(import.meta.dirname, '../../../prototype/assets');
const fixturePhoto = resolve(fixtureAssets, 'sneaker-white.jpg');
const artwork = ['sneaker-white', 'sneaker-studio', 'sneaker-pair', 'sneaker-tan'];
const product = {
  id: 'p', sku: 'SHOE-01', name: '浅色帆布鞋', category: 'apparel', version: 1,
  fact_version: 1, facts: {}, readiness: {}, photos: [],
};
const square = { ratio: '1:1', resolution: '1K', width: 1024, height: 1024 };
const wide = { ratio: '16:9', resolution: '2K', width: 2560, height: 1440 };
const portrait = { ratio: '9:16', resolution: '2K', width: 1440, height: 2560 };
const parameters = { provider: 'ark', model: 'seedream-5.5', ratio: '1:1', resolution: '1K', count: 1 };
const videoParameters = { model: 'seedance-2.0', ratio: '16:9', resolution: '720p', duration: 5, count: 1 };
const capabilities = {
  model: parameters.model, sizes: [square, wide, portrait], max_outputs: 6,
  video_models: ['seedance-2.0', 'seedance-2.5'],
  models: [
    { provider: 'ark', model: parameters.model, label: 'Seedream 5.5',
      sizes: [square, wide, portrait], qualities: [], default_quality: null },
    { provider: 'gpt-image', model: 'gpt-image-2', label: 'GPT Image 2',
      sizes: [square], qualities: ['low', 'high'], default_quality: 'low' },
  ],
};
const reference = {
  id: 'reference', kind: 'upload', origin: 'independent', usage: 'expression',
  source_id: 'file', file_id: 'file', file_version: 1, source_version: 1,
  label: 'sneaker-white.jpg', media: 'image',
};

async function checkSelectStyle(select, screenshot, focusColor = 'rgb(82, 126, 61)') {
  const page = select.page();
  await expect(select).toHaveCSS('appearance', 'base-select');
  await select.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(select).toBeFocused();
  await expect(select).toHaveCSS('outline-color', focusColor);
  await select.click();
  await expect.poll(() => select.evaluate((field) => field.matches(':open'))).toBe(true);
  expect(await select.evaluate((field) =>
    getComputedStyle(field, '::picker(select)').borderRadius)).toBe('8px');
  const focused = select.locator('option:focus-visible');
  const selected = select.locator('option:checked');
  await expect(focused).toHaveCSS('outline-style', 'none');
  await expect(focused).toHaveCSS('border-top-width', '0px');
  expect(await selected.evaluate((option) => getComputedStyle(option, '::checkmark').display)).toBe('none');
  await expect(selected).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('ArrowDown');
  expect(await focused.evaluate((option) => getComputedStyle(option).backgroundColor))
    .not.toBe(await selected.evaluate((option) => getComputedStyle(option).backgroundColor));
  await page.keyboard.press('ArrowUp');
  await page.screenshot({ path: resolve(artifacts, screenshot) });
  await page.keyboard.press('Escape');
  await expect.poll(() => select.evaluate((field) => field.matches(':open'))).toBe(false);
  await expect(select).toBeFocused();
}

await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  for (const [width, media] of [[1600, 'image'], [1280, 'image'], [390, 'image'], [320, 'image'], [390, 'video']]) {
    const purpose = media === 'image' ? 'main' : 'video';
    const task = {
      id: 't', name: '快捷生成验收', products: [product], version: 1, status: 'draft',
      positions: [{ id: 'slot', product_id: product.id, purpose, status: 'unfilled' }],
    };
    let draft = {
      id: 'd', task_id: 't', product_id: product.id, entry: 'quick', purpose, slot: 'primary',
      version: 1, prompt: '', parameters, references: [], template_id: null, template_version: null,
      video_parameters: media === 'video' ? videoParameters : null,
    };
    const writes = [];
    const errors = [];
    let draftCreated = width !== 1600;
    let job;
    let originalPrompt;
    const optimizedPrompt = '柔和自然光，突出帆布鞋的纹理与轮廓。';
    const templatePrompt = '使用模板提示词展示鞋面。';
    const templateParameters = { ...parameters, ratio: '9:16', resolution: '2K', count: 2 };
    const page = await browser.newPage({ viewport: { width, height: width === 320 ? 568 : 800 } });
    page.on('pageerror', (error) => errors.push(error.message));
    await page.addInitScript(() => {
      localStorage.setItem('zaowu-studio-entry:studio:user', 'quick');
      localStorage.setItem('zaowu-studio-task:studio:user', 't');
    });
    await page.route('**/api/v1/**', async (route) => {
      const request = route.request();
      const path = new URL(request.url()).pathname.replace('/api/v1', '');
      const method = request.method();
      const reply = (json) => route.fulfill({ json });
      if (path === '/me') return reply({
        tenant: { id: 'studio', slug: 'studio', name: '造物' }, user_id: 'user',
        email: 'test@example.test', csrf_token: 'test', role: 'admin', permissions: ['view', 'create', 'manage'],
      });
      if (path === '/tasks') return reply({ items: [task], next_cursor: null });
      if (path === '/products/categories') return reply([
        { id: 'apparel', label: '鞋服' }, { id: 'beauty', label: '美妆个护' },
      ]);
      if (path === '/products') return reply({ items: [], next_cursor: null });
      if (path === '/tasks/t') return reply(task);
      if (path === '/tasks/t/canvas') return reply({
        nodes: [], edges: [], creations: [], layout: { positions: [], version: 0 },
        viewport: { x: 0, y: 0, zoom: 1, version: 0 },
      });
      if (path === '/tasks/t/batches/image') return reply({
        prompt: '', ratio: '1:1', resolution: '1K', count: 1, version: 0,
      });
      if (path === '/tasks/t/results') return reply(artwork.map((name, index) => ({
        asset_id: `asset-${index}`, version_id: name, label: `帆布鞋 · 方案 ${index + 1}`,
        media: 'image', status: 'pending_review', version: 1, file_version: 1, previewable: true,
      })));
      const artworkName = path.split('/').at(-2);
      if (path.startsWith('/tasks/t/results/') && artwork.includes(artworkName)) {
        return route.fulfill({ path: resolve(fixtureAssets, `${artworkName}.jpg`), contentType: 'image/jpeg' });
      }
      if (path === '/tasks/t/creations' && method === 'GET') return reply(draftCreated ? [draft] : []);
      if (path === '/creation-capabilities') return reply(capabilities);
      if (path === '/cases') return reply({ items: [], next_cursor: null });
      if (path === '/templates') return reply({
        items: [{ id: 'template', published_version: 1, content: {
          name: '商品摄影', purpose, prompt: templatePrompt, parameters: templateParameters,
        } }],
        next_cursor: null,
      });
      if (path.endsWith('/preview')) return route.fulfill({ path: fixturePhoto, contentType: 'image/jpeg' });
      if (path === '/executions/job') return reply(job);
      if (method === 'GET') return reply([]);

      writes.push(`${method} ${path}`);
      if (path === '/tasks/t/creations') {
        expect(draftCreated).toBe(false);
        expect(request.postDataJSON()).toMatchObject({ product_id: product.id, purpose, entry: 'quick' });
        draftCreated = true;
        return reply(draft);
      }
      if (path === '/files/uploads') return reply({ id: 'file', upload_path: '/api/v1/upload-fixture' });
      if (path === '/upload-fixture') return route.fulfill({ status: 204 });
      if (path === '/files/file/complete') return reply({ id: 'file' });
      if (path === '/creations/d/references') {
        expect(request.postDataJSON()).toMatchObject({ source_id: reference.source_id, expected_version: draft.version });
        draft = { ...draft, references: [reference], version: draft.version + 1 };
        return reply(draft);
      }
      if (path === '/creations/d' && method === 'PATCH') {
        const { expected_version, ...changes } = request.postDataJSON();
        expect(expected_version).toBe(draft.version);
        draft = { ...draft, ...changes, version: draft.version + 1 };
        return reply(draft);
      }
      if (path === '/creations/d/template') {
        const data = request.postDataJSON();
        expect(data).toMatchObject({
          expected_version: draft.version, template_id: 'template', template_version: 1,
        });
        draft = {
          ...draft, template_id: 'template', template_version: 1, version: draft.version + 1,
          parameters: templateParameters,
          prompt: data.prompt_action === 'replace' ? templatePrompt : draft.prompt,
        };
        return reply(draft);
      }
      if (path === '/creations/d/template/clear') {
        expect(request.postDataJSON()).toEqual({ expected_version: draft.version });
        draft = { ...draft, template_id: null, template_version: null, version: draft.version + 1 };
        return reply(draft);
      }
      if (path === '/creations/d/assistances') {
        expect(draft.prompt).toBe('柔和自然光下展示鞋面细节。');
        expect(request.postDataJSON()).toEqual({ kind: 'optimize', expected_version: draft.version });
        originalPrompt = draft.prompt;
        return reply({ id: 'assist', source_version: draft.version, status: 'ready', suggestion: optimizedPrompt });
      }
      if (path === '/assistances/assist/apply' || path === '/assistances/assist/undo') {
        draft = { ...draft, version: draft.version + 1,
          prompt: path.endsWith('/apply') ? optimizedPrompt : originalPrompt };
        return reply(draft);
      }
      if (path === '/creations/d/storyboard') {
        const { expected_version, position_id, shots } = request.postDataJSON();
        expect(expected_version).toBe(draft.version);
        expect(shots).toMatchObject([{ duration: 10, visual: '展示商品正面' }]);
        const version = draft.version + 1;
        draft = { ...draft, version, storyboard: {
          position_id, shots, confirmed_version: version, product_fact_version: 1, position_version: [],
        } };
        return reply(draft);
      }
      if (path === '/creations/d/executions') {
        expect(request.postDataJSON()).toMatchObject({ expected_version: draft.version, idempotency_key: expect.any(String) });
        const count = media === 'video' ? draft.video_parameters.count : draft.parameters.count;
        job = { id: 'job', media, outputs: Array.from({ length: count }, (_, i) => ({ id: `out-${i}`, status: 'queued' })) };
        return reply(job);
      }
      throw new Error(`Unexpected write ${method} ${path}`);
    });

    await page.goto(origin);
    const editor = page.getByRole('region', { name: '快捷创作' });
    const prompt = editor.getByRole('textbox', { name: '提示词' });
    await expect(prompt).toBeEnabled();
    const composer = editor.locator('.studio-composer');
    const attachment = editor.getByRole('button', { name: '参考素材' });
    const frame = await composer.boundingBox();
    const input = await prompt.boundingBox();
    const tile = await attachment.boundingBox();
    const results = page.getByRole('region', { name: '创作结果' });
    const resultsBox = await results.boundingBox();
    const inset = width >= 1100 ? 32 : 0;
    expect(frame.x - resultsBox.x).toBeCloseTo(inset);
    expect(resultsBox.x + resultsBox.width - frame.x - frame.width).toBeCloseTo(inset);
    expect(resultsBox.width).toBeLessThanOrEqual(1000);
    const shortcuts = await editor.locator('.studio-shortcuts').boundingBox();
    expect(shortcuts.x).toBeCloseTo(frame.x);
    expect(shortcuts.width).toBeCloseTo(frame.width);
    if (width >= 1280) {
      expect(resultsBox.width).toBeCloseTo(1000);
      expect(frame.height).toBeLessThanOrEqual(120);
      const generate = await editor.getByRole('button', { name: '生成图片', exact: true }).boundingBox();
      expect(Math.abs(frame.x + frame.width - generate.x - generate.width)).toBeLessThanOrEqual(16);
    }
    const cards = results.getByRole('article');
    await expect(cards).toHaveCount(4);
    await expect(results.getByRole('button', { name: /筛选$/ })).toHaveCount(0);
    const status = results.locator(':scope > header').getByRole('combobox', { name: '审核状态' });
    await expect(status).toBeVisible();
    await expect(status).toHaveValue('');
    const tabsBox = await results.locator('.studio-tabs').boundingBox();
    const statusBox = await status.boundingBox();
    expect(statusBox.y).toBeLessThan(tabsBox.y + tabsBox.height);
    const firstCardTop = await cards.first().evaluate((card) => card.offsetTop);
    await status.click();
    await expect.poll(() => status.evaluate((field) => field.matches(':open'))).toBe(true);
    expect(await cards.first().evaluate((card) => card.offsetTop)).toBe(firstCardTop);
    await page.keyboard.press('Escape');
    await checkSelectStyle(status, `select-review-${width}-${media}.png`);
    await page.keyboard.press('Space');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    await expect(status).toHaveValue('rejected');
    await expect(cards).toHaveCount(0);
    await status.selectOption('');
    await expect(cards).toHaveCount(4);
    const boxes = await Promise.all((await cards.all()).map((card) => card.boundingBox()));
    if (width >= 1280) {
      expect(boxes.every((box) => box.y === boxes[0].y && box.width >= 230)).toBe(true);
    } else {
      expect(boxes[0].y).toBe(boxes[1].y);
      expect(boxes[2].y).toBeGreaterThan(boxes[0].y);
      expect(boxes[2].y).toBe(boxes[3].y);
    }
    await expect.poll(() => results.locator('.studio-art img')
      .evaluateAll((images) => images.every((image) => image.naturalWidth > 0))).toBe(true);
    expect(tile.x + tile.width).toBeLessThanOrEqual(input.x);
    expect(tile.y).toBeLessThan(input.y + input.height);
    expect(tile.y + tile.height).toBeGreaterThan(input.y);
    const toolbar = editor.locator('.studio-toolbar');
    await expect(toolbar).toHaveCSS('border-top-width', '0px');
    await expect(toolbar).toHaveCSS('column-gap', '4px');
    await expect(editor.getByRole('button', { name: '更多创作操作' })).toHaveCount(0);
    const optimize = toolbar.getByRole('button', { name: '优化提示词', exact: true });
    const applyTemplate = toolbar.getByRole('button', { name: '应用模板', exact: true });
    await expect(optimize).toBeVisible();
    await expect(optimize).toBeDisabled();
    await expect(applyTemplate).toBeVisible();
    await page.screenshot({ path: resolve(artifacts, `${media}-${width}-composer.png`) });
    const model = editor.getByRole('button', { name: /生成模型/ });
    const specs = editor.getByRole('button', { name: /画面规格/ });
    const count = editor.getByRole('button', { name: /生成张数|生成条数/ });
    await expect(editor.getByRole('button', { name: '创作设置', exact: true })).toHaveCount(0);
    await model.click();
    const modelOptions = editor.getByRole('group', { name: '生成模型' });
    await expect(modelOptions.getByText('火山方舟').first()).toBeVisible();
    if (media === 'image') {
      await modelOptions.getByRole('button', { name: /GPT Image 2/ }).click();
      await expect(model).toHaveText('GPT Image 2');
      await model.click();
      await modelOptions.getByRole('button', { name: /Seedream 5.5/ }).click();
    } else {
      await modelOptions.getByRole('button', { name: /Seedance 2.5/ }).click();
      await expect(model).toHaveText('Seedance 2.5');
      await expect(model).toBeFocused();
      await editor.getByRole('button', { name: /视频时长/ }).click();
      await editor.getByRole('button', { name: '10 秒', exact: true }).click();
    }
    await specs.click();
    const dimensions = editor.getByRole('group', { name: '画面规格', exact: true });
    await dimensions.getByRole('button', { name: '9:16', exact: true }).click();
    if (media === 'image') {
      await expect(specs).toHaveText('9:16 · 2K');
      await expect(dimensions.getByText('1440 × 2560')).toBeVisible();
    } else {
      await dimensions.getByRole('button', { name: '1080p', exact: true }).click();
      await expect(specs).toHaveText('9:16 · 1080p');
    }
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(dimensions).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(artifacts, `${media}-${width}-specs.png`) });
    await page.keyboard.press('Escape');
    await expect(dimensions).toHaveCount(0);
    await expect(specs).toBeFocused();
    await count.click();
    await editor.getByRole('button', { name: media === 'image' ? '2 张' : '2 条', exact: true }).click();
    await expect(count).toHaveText(media === 'image' ? '2 张' : '2 条');
    expect(writes).toEqual([]);
    await specs.click();
    await prompt.click();
    await expect(dimensions).toHaveCount(0);
    await expect(prompt).toHaveCSS('outline-style', 'none');
    await expect(composer).toHaveCSS('border-top-color', 'rgb(82, 126, 61)');
    await prompt.fill('柔和自然光下展示鞋面细节。');
    if (width === 1280) {
      await prompt.blur();
      await page.screenshot({ path: resolve(artifacts, 'image-1280-prompt.png') });
    }

    if (media === 'image') {
      await optimize.click();
      const suggestion = page.getByRole('dialog', { name: '优化提示词' });
      await expect(suggestion.getByText(optimizedPrompt)).toBeVisible();
      expect(draft.prompt).toBe('柔和自然光下展示鞋面细节。');
      expect(writes).toEqual([
        ...(width === 1600 ? ['POST /tasks/t/creations'] : []),
        'PATCH /creations/d',
        'POST /creations/d/assistances',
      ]);
      await suggestion.getByRole('button', { name: '采用建议' }).click();
      await expect(prompt).toHaveValue(optimizedPrompt);
      await suggestion.getByRole('button', { name: '撤销建议' }).click();
      await expect(prompt).toHaveValue(originalPrompt);
      await suggestion.getByRole('button', { name: '关闭' }).click();

      await editor.getByRole('button', { name: '参考素材' }).click();
      const materials = page.getByRole('dialog', { name: '添加素材' });
      await materials.getByRole('button', { name: '参考图' }).click();
      await materials.getByLabel('上传参考图').setInputFiles(fixturePhoto);
      await expect(materials).toHaveCount(0);
      const thumbnail = editor.getByRole('img', { name: reference.label });
      await expect.poll(() => thumbnail.evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
      const editedPrompt = '保留这段尚未保存的正文。';
      await prompt.fill(editedPrompt);
      const templatePicker = page.getByRole('dialog', { name: '应用公司模板' });
      await applyTemplate.click();
      await templatePicker.getByRole('radio', { name: '商品摄影 · V1' }).check();
      await expect(templatePicker.getByLabel('正文处理')).toHaveValue('keep');
      await templatePicker.getByRole('button', { name: '确认应用' }).click();
      await expect(templatePicker).toHaveCount(0);
      await expect(prompt).toHaveValue(editedPrompt);
      await toolbar.getByRole('button', { name: /切换模板/ }).click();
      await templatePicker.getByRole('radio', { name: '商品摄影 · V1' }).check();
      await templatePicker.getByLabel('正文处理').selectOption('replace');
      await templatePicker.getByRole('button', { name: '确认应用' }).click();
      await expect(prompt).toHaveValue(templatePrompt);
      await toolbar.getByRole('button', { name: /切换模板/ }).click();
      await templatePicker.getByRole('button', { name: '取消应用模板' }).click();
      await expect(prompt).toHaveValue(templatePrompt);
      await expect(applyTemplate).toBeVisible();
    } else {
      await editor.getByRole('button', { name: '成片分镜' }).click();
      const storyboard = page.getByRole('dialog', { name: /成片分镜/ });
      await storyboard.getByLabel('画面', { exact: true }).fill('展示商品正面');
      await storyboard.getByRole('button', { name: '确认成片分镜' }).click();
      await expect(editor.getByRole('button', { name: '已确认分镜' })).toBeVisible();
    }

    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await editor.getByRole('button', { name: media === 'image' ? '生成图片' : '生成视频', exact: true }).click();
    await expect(page.getByRole('button', { name: '取消排队' })).toBeVisible();
    expect(writes.filter((item) => /^PATCH |\/executions$/.test(item)).slice(-2))
      .toEqual(['PATCH /creations/d', 'POST /creations/d/executions']);
    if (media === 'image') {
      expect(draft.parameters).toMatchObject({ ratio: '9:16', resolution: '2K', count: 2 });
    } else {
      expect(draft.video_parameters).toEqual({
        model: 'seedance-2.5', ratio: '9:16', resolution: '1080p', duration: 10, count: 2,
      });
    }
    const nav = async (name) => {
      const openNav = page.getByRole('button', { name: '打开工作区导航' });
      if (await openNav.isVisible()) await openNav.click();
      await page.getByRole('navigation', { name: '工作区' }).getByRole('button', { name, exact: true }).click();
    };
    await nav('案例灵感');
    const category = page.getByRole('combobox', { name: '筛选案例品类' });
    await checkSelectStyle(category, `select-cases-${width}-${media}.png`);
    const caseCount = await page.locator('.resource-card').count();
    await category.click();
    await category.getByRole('option', { name: '鞋服' }).click();
    await expect.poll(() => page.locator('.resource-card').count()).toBeLessThan(caseCount);
    if (media === 'image' && (width === 1280 || width === 390)) {
      await page.getByRole('button', { name: '新增案例' }).click();
      const dialog = page.getByRole('dialog', { name: '新增案例' });
      const formCategory = dialog.getByRole('combobox', { name: '案例品类' });
      await checkSelectStyle(formCategory, `select-case-dialog-${width}.png`);
      await formCategory.click();
      await formCategory.getByRole('option', { name: '美妆个护' }).click();
      expect(await formCategory.evaluate((field) => new FormData(field.form).get('category'))).toBe('beauty');
      await dialog.getByRole('button', { name: '取消' }).click();
      await nav('商品资料');
      await page.getByRole('button', { name: '添加商品' }).click();
      const productDialog = page.getByRole('dialog', { name: '添加新商品' });
      await checkSelectStyle(productDialog.getByRole('combobox', { name: '商品品类' }),
        `select-product-${width}.png`);
      await productDialog.getByRole('button', { name: '关闭', exact: true }).click();
      await nav('公司管理');
      await checkSelectStyle(page.getByRole('combobox', { name: '模板状态' }),
        `select-template-${width}.png`);
      await nav('资产与交付');
      await page.getByRole('button', { name: '公司素材', exact: true }).click();
      await page.getByRole('button', { name: '更多筛选' }).click();
      await checkSelectStyle(page.getByRole('combobox', { name: '素材审核状态' }),
        `select-library-${width}.png`);
      await nav('批量制作');
      await page.getByRole('button', { name: '调整公共设置' }).click();
      const batchSize = page.getByRole('combobox', { name: '公共比例 / 清晰度' });
      await checkSelectStyle(batchSize, `select-batch-${width}.png`);
      await page.keyboard.press('Escape');
      await expect(batchSize).toHaveCount(0);
      await nav('画布');
      const sku = page.getByRole('combobox', { name: '画布 SKU' });
      await expect(sku).toHaveCSS('background-color', 'rgb(37, 39, 42)');
      await checkSelectStyle(sku, `select-canvas-${width}.png`, 'rgb(232, 232, 232)');
    }
    expect(errors).toEqual([]);
    await page.close();
    console.log(`${width}px ${media}: quick composer passed`);
  }
} finally {
  await browser.close();
}
