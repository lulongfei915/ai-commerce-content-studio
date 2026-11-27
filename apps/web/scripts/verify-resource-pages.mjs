/* global document, process, console, URL */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const origin = process.env.STUDIO_PREVIEW_URL ?? 'http://127.0.0.1:5177';
const output = resolve(import.meta.dirname, '../../../output/playwright/module09');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('response', (r) => {
    if (r.url().includes('/api/v1/') && r.status() >= 400 && !r.url().endsWith('/me')) {
      errors.push(`${r.status()} ${new URL(r.url()).pathname}`);
    }
  });
  await page.goto(origin);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const nav = async (label) => {
    const open = page.getByRole('button', { name: '打开工作区导航' });
    if (await open.isVisible()) await open.click();
    await page
      .getByRole('navigation', { name: '工作区' })
      .getByRole('button', { name: label, exact: true })
      .click();
  };
  const shoot = async (name) => {
    assert.ok(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
      ),
      name,
    );
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  };
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 800 });
    await nav('案例灵感');
    const cards = page.locator('.resource-card');
    await expect(cards.filter({ hasText: '留白之间，自在生长' })).toBeVisible();
    await expect
      .poll(() =>
        cards
          .first()
          .locator('img')
          .evaluate((img) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await shoot(`cases-${width}`);
    await page.setViewportSize({ width, height: width < 500 ? 520 : 640 });
    await page.getByRole('button', { name: '新增案例', exact: true }).click();
    const createCase = page.getByRole('dialog', { name: '新增案例' });
    const saveCase = createCase.getByRole('button', { name: '保存案例' });
    await expect(saveCase).toBeInViewport({ ratio: 1 });
    await expect(createCase.getByRole('button', { name: '取消' })).toBeInViewport({ ratio: 1 });
    await expect(createCase.getByText('使用范围为空时，案例只能浏览。')).toBeInViewport({
      ratio: 1,
    });
    await expect(createCase.getByText('案例名称', { exact: true })).toBeInViewport({ ratio: 1 });
    for (const field of await createCase.locator('input, select').all()) {
      await expect(field).toBeInViewport({ ratio: 1 });
    }
    assert.ok(
      await createCase
        .locator('.case-form-body')
        .evaluate((body) => body.scrollTop === 0 && body.scrollHeight <= body.clientHeight),
      'The case form opens fully visible without scrolling',
    );
    await shoot(`case-create-${width}`);
    await createCase.getByRole('textbox', { name: '案例名称' }).fill('浏览器校验案例');
    await createCase.getByRole('textbox', { name: '案例来源' }).fill('本地测试');
    await createCase
      .getByLabel('案例文件')
      .setInputFiles(resolve(import.meta.dirname, '../../../prototype/assets/sneaker-studio.jpg'));
    await createCase.getByRole('textbox', { name: '确认的使用范围' }).fill('内部');
    await saveCase.click();
    await expect(createCase.getByRole('alert')).toHaveText('请选择授权用途。');
    await expect(saveCase).toBeInViewport({ ratio: 1 });
    await createCase.getByRole('button', { name: '取消' }).click();
    await expect(createCase).toHaveCount(0);
    await expect(page.getByRole('button', { name: '新增案例', exact: true })).toBeFocused();
    await page.setViewportSize({ width, height: 800 });
    await page.getByRole('searchbox', { name: '搜索案例' }).fill('暖色侧光');
    await expect(cards).toHaveCount(1);
    await expect(cards.getByRole('button', { name: '暂不可引用' })).toBeDisabled();
    await cards.getByRole('button', { name: '预览一束光里的自然感' }).click();
    await expect(page.getByRole('dialog')).toContainText('一束光里的自然感');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索案例' }).fill('');
    await page
      .getByRole('group', { name: '案例媒体' })
      .getByRole('button', { name: '视频' })
      .click();
    await expect(cards.filter({ hasText: '示例分镜' })).toHaveCount(1);
    await nav('审核中心');
    await expect(page.getByRole('group', { name: '审核状态' })).toBeVisible();
    await page
      .getByRole('group', { name: '审核状态' })
      .getByRole('button', { name: /全部/ })
      .click();
    await expect(page.getByText('正在加载…', { exact: true })).toHaveCount(0);
    await shoot(`review-${width}`);
    await nav('资产与交付');
    await expect(page.getByRole('heading', { name: '资产与交付' })).toBeVisible();
    await page.getByRole('checkbox', { name: /只看待补齐/ }).check();
    await shoot(`delivery-${width}`);
    await page.getByRole('button', { name: '配置交付要求' }).click();
    const plan = page.getByRole('dialog', { name: '配置交付要求' });
    await expect(plan.getByLabel('模块名称').first()).toBeVisible();
    await expect(plan.getByRole('button', { name: '核对并保存' })).toBeInViewport({ratio: 1});
    await shoot(`requirements-${width}`);
    const original = await plan.locator('fieldset').count();
    await plan.getByRole('button', { name: '详情模块', exact: true }).click();
    const added = plan.locator('fieldset').last();
    await expect(added.getByLabel('画面比例')).toHaveValue('1:1');
    await expect(added.getByLabel('清晰度')).toHaveValue('2K');
    await added.getByLabel('用途').selectOption('video');
    await expect(added.getByLabel('画面比例')).toHaveValue('9:16');
    await expect(added.getByLabel('清晰度')).toHaveValue('1080p');
    await expect(added.getByLabel('视频总时长')).toHaveValue('12');
    await added.getByLabel('模块名称').fill('验收用视频');
    await added.getByLabel('数量').fill('3');
    await plan.getByRole('button', {name:'核对并保存'}).click();
    const reviewPlan = page.getByRole('dialog', {name:'确认交付要求'});
    await expect(reviewPlan).toContainText(`共 ${original + 1} 项要求`);
    await reviewPlan.getByRole('button', {name:'返回修改'}).click();
    await expect(added.getByLabel('数量')).toHaveValue('3');
    await added.getByRole('button', {name:'移除'}).click();
    await expect(plan.locator('fieldset')).toHaveCount(original);
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('button', { name: /导出.*交付包/ })).toBeVisible();
    await page.getByLabel('交付任务').getByRole('button').last().click();
    const picker = page.getByRole('dialog', { name: '切换交付任务' });
    const taskOption = picker.getByRole('button', { name: /^查看交付：/ }).first();
    const taskName = (await taskOption.getAttribute('aria-label')).replace('查看交付：', '');
    await taskOption.click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByLabel('交付任务').getByRole('button', { name: taskName })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /只看待补齐/ })).toBeVisible();
    await page.getByRole('button', { name: '公司素材', exact: true }).click();
    await expect(page.getByText(/跨任务浏览 ·/)).toBeVisible();
    await expect(page.locator('.library-count')).toBeVisible();
    const countBox = await page.locator('.library-count').boundingBox();
    const chipBox = await page.getByRole('button', { name: /仅已批准/ }).boundingBox();
    assert.ok(chipBox.y >= countBox.y + countBox.height);
    await expect.poll(() => page.locator('.library-gallery img').first().evaluate(img => img.naturalWidth)).toBeGreaterThan(0);
    await shoot(`library-filters-${width}`);
    await page.getByRole('button', { name: '更多筛选' }).click();
    await expect(page.getByLabel('素材审核状态')).toHaveValue('approved');
    const libraryCard = page.locator('.library-gallery article').first();
    await libraryCard.getByRole('button', { name: '来源与版本', exact: true }).click();
    const source = page.getByRole('dialog', { name: '公司素材 · 来源与版本' });
    await expect(source.getByText('输入依据', { exact: true })).toBeVisible();
    await expect
      .poll(() => source.locator('img').evaluate((img) => img.naturalWidth))
      .toBeGreaterThan(0);
    await expect(source.getByText('采用至交付')).toHaveCount(0);
    await shoot(`library-source-${width}`);
    await source.getByRole('button', { name: '引用至制作' }).click();
    const target = page.getByRole('dialog', { name: '引用到当前制作' });
    await expect(target.getByText(/正在读取制作目标/)).toHaveCount(0);
    await expect(target.getByRole('button', { name: /确认引用|新建草稿.*引用/ })).toBeEnabled();
    await shoot(`library-target-${width}`);
    await target.getByRole('button', { name: '取消' }).click();
    await libraryCard.getByRole('button', { name: '引用至制作', exact: true }).click();
    await expect(target).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByLabel('素材审核状态').selectOption('revoked');
    await page.getByRole('button', { name: '重置筛选' }).click();
    await expect(page.getByLabel('素材审核状态')).toHaveValue('approved');
    // Exercise the missing-SKU path without adding products to the live preview task.
    const targetsPath = '**/api/v1/assets/*/reference-targets?*';
    const createPath = '**/api/v1/assets/*/reference-draft';
    const draftsPath = '**/api/v1/tasks/*/creations?*';
    const skuCard = page.locator('.library-gallery article').filter({ hasText: 'RED-MWT13A3G' }).first();
    let created;
    await page.route(targetsPath, route => route.fulfill({ json: [] }));
    await page.route(createPath, async route => {
      const body = route.request().postDataJSON();
      const assetUrl = route.request().url().replace(/\/reference-draft$/, '');
      const asset = await (await page.request.get(assetUrl)).json();
      const getTask = async id => (await page.request.get(`${origin}/api/v1/tasks/${id}`)).json();
      const task = await getTask(body.task_id);
      const source = await getTask(asset.task_id);
      if (body.add_product) task.products.push(source.products.find(p => p.id === asset.product_id));
      created = {
        ...await (await page.request.get(`${origin}/api/v1/creations/${asset.creation_id}`)).json(),
        id: 'reference-flow-test', task_id: task.id, entry: 'quick', slot: 'test', prompt: '引用验证',
      };
      return route.fulfill({ json: { draft: created, task } });
    });
    await page.route(draftsPath, route => created
      ? route.fulfill({ json: [created] })
      : route.fallback());
    await page.route('**/api/v1/creations/reference-flow-test/**', route => route.fulfill({ json: [] }));
    await skuCard.getByRole('button', { name: '引用至制作' }).click();
    await target.getByRole('button', { name: /新建草稿.*引用/ }).click();
    await expect(target).toHaveCount(0);
    await expect(page.getByLabel('创作商品与用途')).toHaveValue('reference-flow-test');
    await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('引用验证');
    for (const pattern of [targetsPath, createPath, draftsPath, '**/api/v1/creations/reference-flow-test/**']) {
      await page.unroute(pattern);
    }
    await nav('公司管理');
    const preset = page.locator('.company-template').filter({ hasText: '预设' }).first();
    if (await preset.isVisible()) {
      await preset.getByRole('button', { name: '查看配置' }).click();
      await page.getByRole('button', { name: '编辑模板' }).click();
      await page.getByRole('combobox', { name: '媒体', exact: true }).selectOption('video');
      await expect(page.getByRole('combobox', { name: '时长' })).toBeVisible();
      await page.getByRole('button', { name: '发布版本', exact: true }).click();
      await expect(page.getByRole('dialog', { name: '确认发布模板' })).toBeVisible();
      await page.getByRole('button', { name: '返回编辑' }).click();
      await page.getByRole('button', { name: '取消', exact: true }).click();
    }
    await page.getByRole('button', { name: '新增模板' }).click();
    await expect(page.getByRole('dialog')).toContainText('默认提示词');
    const newTemplate = page.getByRole('dialog', { name: '新增公司模板' });
    await expect(newTemplate.getByRole('textbox', { name: '模板名称' })).toBeFocused();
    await expect(newTemplate.getByRole('textbox', { name: /默认提示词/ })).toHaveValue(
      /{{商品名称}}/,
    );
    await expect(newTemplate.getByRole('button', { name: '保存草稿' })).toBeInViewport({
      ratio: 1,
    });
    await shoot(`template-create-${width}`);
    await newTemplate.getByRole('textbox', { name: '模板名称' }).fill('浏览器核对模板');
    await newTemplate.getByRole('combobox', { name: '媒体', exact: true }).selectOption('video');
    await newTemplate.getByRole('combobox', { name: '时长' }).selectOption('10');
    await newTemplate.getByRole('button', { name: '发布版本' }).click();
    await page.getByRole('button', { name: '返回编辑' }).click();
    await expect(newTemplate.getByRole('combobox', { name: '时长' })).toHaveValue('10');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await shoot(`company-${width}`);
    await page.getByRole('button', { name: '成员与权限' }).click();
    await expect(page.getByRole('heading', { name: '成员与权限' })).toBeVisible();
    await page.getByRole('button', { name: '权限', exact: true }).first().click();
    await expect(page.getByRole('dialog', { name: '成员权限' })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '操作记录' }).click();
    await expect(page.getByRole('heading', { name: '模板发布记录' })).toBeVisible();
    await nav('商品资料');
    await expect(page.getByRole('heading', { name: '商品资料', exact: true })).toBeVisible();
    await nav('快捷生成');
  }

  // Exercise the composer with simulated queue responses and leave the live workspace untouched.
  await page.setViewportSize({ width: 1280, height: 640 });
  await nav('资产与交付');
  const slots = page
    .locator('.delivery-position')
    .filter({
      has: page.getByRole('heading', { name: '商品主图', exact: true }),
    })
    .filter({ has: page.getByRole('button', { name: '制作此位置' }) });
  const slot = slots.last();
  await expect(slot).toBeVisible();
  const product = await slot.locator('xpath=ancestor::section[1]/header//h3').textContent();
  await slot.getByRole('button', { name: '制作此位置' }).click();
  const selector = page.getByRole('combobox', { name: '创作商品与用途' });
  await expect(selector.locator('option:checked')).toHaveText(`${product} · 主图`);
  const writes = [];
  const prompt = '生成一只猫';
  let blockSubmission = true;
  let fixture = {
    id: 'preview-quick-draft',
    task_id: 'preview-quick-task',
    product_id: 'preview-product',
    purpose: 'main',
    slot: 'primary',
    entry: 'quick',
    prompt: '',
    references: [],
    version: 1,
    template_id: null,
    template_version: null,
    video_parameters: null,
    parameters: { model: 'seedream-5.5', ratio: '1:1', resolution: '1K', count: 1 },
  };
  const queued = { id: 'preview-quick-job', outputs: [{ id: 'preview-output', status: 'queued' }] };
  await page.route('**/api/v1/tasks/*/creations', (route) => {
    const request = route.request();
    if (request.method() !== 'POST') return route.fallback();
    fixture = {
      ...fixture,
      product_id: request.postDataJSON().product_id,
      task_id: new URL(request.url()).pathname.split('/').at(-2),
    };
    return route.fulfill({ status: 201, json: fixture });
  });
  await page.route('**/api/v1/creations/**', async (route) => {
    const request = route.request();
    const method = request.method();
    if (method === 'PATCH') {
      const data = request.postDataJSON();
      writes.push({ method, data });
      const id = new URL(request.url()).pathname.split('/').at(-1);
      const draft =
        id === fixture.id ? fixture : await (await page.request.get(request.url())).json();
      return route.fulfill({
        json: {
          ...draft,
          prompt: data.prompt,
          parameters: data.parameters,
          version: data.expected_version + 1,
        },
      });
    }
    if (method === 'POST' && request.url().endsWith('/executions')) {
      writes.push({ method, data: request.postDataJSON() });
      if (blockSubmission) {
        return route.fulfill({ status: 402, json: { detail: 'budget_not_configured' } });
      }
      return route.fulfill({ status: 202, json: queued });
    }
    if (request.url().includes('/preview-quick-draft/')) return route.fulfill({ json: [] });
    return route.fallback();
  });
  await page.route('**/api/v1/executions/preview-quick-job', (route) =>
    route.fulfill({ json: queued }),
  );
  const generate = page.getByRole('button', { name: '生成图片', exact: true });
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(prompt);
  await expect(generate).toBeEnabled();
  await shoot('quick-generate-1280');
  await generate.click();
  const feedback = page.locator('.studio-composer').getByRole('alert');
  await expect(feedback).toContainText('Studio 尚未配置调用额度');
  await expect(page.locator('.studio-toolbar').getByRole('button', { name: '优化提示词' })).toBeVisible();
  await shoot('quick-error-1280');
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(feedback).toBeInViewport({ ratio: 1 });
  await shoot('quick-error-390');

  await expect(page.getByRole('button', { name: '更多创作操作' })).toHaveCount(0);
  blockSubmission = false;
  await generate.click();
  await expect(page.getByRole('button', { name: '制作中', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消排队' })).toBeVisible();
  const queuedStatus = page
    .getByRole('region', { name: '创作结果' })
    .getByRole('status')
    .filter({ hasText: '排队中' });
  await queuedStatus.scrollIntoViewIfNeeded();
  await expect(queuedStatus).toBeVisible();
  await expect(queuedStatus).toHaveText('排队中');
  await expect
    .poll(() =>
      queuedStatus.evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const rect = range.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.top >= 0 &&
          rect.bottom <= document.documentElement.clientHeight &&
          rect.left >= 0 &&
          rect.right <= document.documentElement.clientWidth
        );
      }),
    )
    .toBe(true);
  await shoot('quick-queued-390');
  await page.setViewportSize({ width: 1280, height: 640 });
  await shoot('quick-queued-1280');
  assert.deepEqual(
    writes.map(({ method }) => method),
    ['PATCH', 'POST', 'POST'],
  );
  assert.equal(writes[0].data.prompt, prompt);
  assert.equal(writes[1].data.expected_version, writes[0].data.expected_version + 1);
  assert.ok(writes[1].data.idempotency_key);
  assert.deepEqual(writes[1], writes[2]);
  assert.equal(errors.length, 1, JSON.stringify(errors));
  assert.match(errors[0], /^402 \/api\/v1\/creations\/[^/]+\/executions$/);
  console.log('Four sidebar workflows and direct image submission passed:', output);
} finally {
  await browser.close();
}
