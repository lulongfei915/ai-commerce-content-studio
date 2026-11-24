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
    await cards.getByRole('button', { name: '查看构图' }).click();
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
    await page.getByRole('button', { name: '查看交付要求' }).click();
    await expect(
      page.getByRole('dialog', { name: '当前交付要求' }).locator('dt').first(),
    ).toBeVisible();
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await expect(page.getByRole('button', { name: '导出交付包' })).toBeDisabled();
    await page.getByLabel('交付任务').getByRole('button').last().click();
    const picker = page.getByRole('dialog', { name: '切换交付任务' });
    const taskOption = picker.getByRole('button', { name: /^查看交付：/ }).first();
    const taskName = (await taskOption.getAttribute('aria-label')).replace('查看交付：', '');
    await taskOption.click();
    await expect(picker).toHaveCount(0);
    await expect(page.getByLabel('交付任务').getByRole('button', { name: taskName })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: /只看待补齐/ })).toBeVisible();
    await page.getByRole('button', { name: '公司素材', exact: true }).click();
    await expect(page.getByLabel('素材审核状态')).toHaveValue('approved');
    await nav('公司管理');
    await page.getByRole('button', { name: '新建模板' }).click();
    await expect(page.getByRole('dialog')).toContainText('默认提示词');
    await page.getByRole('button', { name: '关闭', exact: true }).click();
    await shoot(`company-${width}`);
    await page.getByRole('button', { name: '成员与权限' }).click();
    await expect(page.getByRole('heading', { name: '当前成员' })).toBeVisible();
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
  await expect(page.getByRole('button', { name: '优化提示词' })).toHaveCount(0);
  await shoot('quick-error-1280');
  await page.setViewportSize({ width: 390, height: 640 });
  await expect(feedback).toBeInViewport({ ratio: 1 });
  await shoot('quick-error-390');

  await page.getByRole('button', { name: /创作设置/ }).click();
  const settings = page.getByRole('dialog', { name: '创作设置' });
  await expect(settings.getByRole('button', { name: '优化提示词' })).toBeVisible();
  await expect(settings.getByLabel('解析参考图')).toBeAttached();
  await settings.getByRole('button', { name: '关闭', exact: true }).click();
  blockSubmission = false;
  await generate.click();
  await expect(page.getByRole('button', { name: '制作中', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: '取消排队' })).toBeVisible();
  await expect(page.getByText('图片 1 · 排队中')).toBeInViewport({ ratio: 1 });
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
