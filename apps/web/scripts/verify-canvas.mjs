/* global process, URL, document, MutationObserver, performance, PerformanceObserver, requestAnimationFrame, window, cancelAnimationFrame, console */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.env.STUDIO_CANVAS_URL ?? 'http://127.0.0.1:5176';
const root = resolve(import.meta.dirname, '../../..');
const artifacts = resolve(root, '.artifacts/module05/follow-up');
const assets = resolve(import.meta.dirname, '../../../prototype/assets');
const tenant = process.env.STUDIO_CANVAS_TENANT;
const email = process.env.STUDIO_CANVAS_EMAIL;
const password = process.env.STUDIO_CANVAS_PASSWORD;
assert(tenant && email && password, 'Provide credentials for an isolated test workspace.');
await mkdir(artifacts, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.STUDIO_CANVAS_CHROMIUM || undefined,
});
const context = await browser.newContext({ viewport: { width: 1280, height: 600 } });
const page = await context.newPage();
context.setDefaultTimeout(7000);
const errors = [];
const modelRequests = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('request', (request) => {
  if (/\/(executions|generate|ark)(?:\/|$)/.test(new URL(request.url()).pathname)) {
    modelRequests.push(request.url());
  }
});
const tag = Date.now().toString(36);
let token;

async function api(path, method = 'GET', data, status = 200) {
  const response = await context.request.fetch(`${origin}/api/v1${path}`, {
    method,
    data,
    headers: { 'X-CSRF-Token': token ?? '', Origin: origin },
  });
  assert.equal(response.status(), status, `${method} ${path}: ${await response.text()}`);
  return response.json();
}

async function upload(name, filename) {
  const bytes = await readFile(resolve(assets, filename));
  const item = await api(
    '/files/uploads',
    'POST',
    {
      filename: name,
      content_type: 'image/jpeg',
      size_bytes: bytes.length,
    },
    201,
  );
  const written = await context.request.put(`${origin}${item.upload_path}`, {
    data: bytes,
    headers: { 'Content-Type': 'image/jpeg', 'X-CSRF-Token': token, Origin: origin },
  });
  assert.equal(written.status(), 204, await written.text());
  const media = await api(`/files/${item.id}/complete`, 'POST');
  return { ...media, bytes: bytes.length };
}

async function navigateEntry(entry, client = page) {
  const returnButton = client.getByRole('button', { name: '返回工作台', exact: true });
  if (await returnButton.isVisible()) await returnButton.click();
  const destination = client.getByRole('button', { name: entry, exact: true });
  if (!(await destination.isVisible())) {
    await client.getByRole('button', { name: '打开工作区导航' }).click();
  }
  await destination.click();
}

async function openTask(name, client = page) {
  await expect(client.locator('.workspace')).toBeVisible();
  await navigateEntry('全部任务', client);
  const search = client.getByRole('searchbox', { name: '搜索任务、商品或 SKU' });
  await search.fill(name);
  await search.press('Enter');
  await client.getByRole('button', { name: `继续创作：${name}` }).click();
  await expect(client.getByRole('heading', { name, exact: true })).toBeVisible();
  if (!(await client.getByRole('button', { name: '返回工作台' }).isVisible())) {
    await navigateEntry('画布', client);
  }
  await expect(client.getByRole('region', { name: '制作画布' })).toBeVisible();
}

const node = (id, client = page) => client.locator(`.react-flow__node[data-id="${id}"]:visible`);
const panel = () => page.getByRole('dialog');
const shoot = (name, client = page) =>
  client.screenshot({ path: resolve(artifacts, `${name}.png`) });

async function verifySharedResults(task, sku, canvasDraft, quickDraft) {
  const base = `/tasks/${task.id}`;
  const seed = async (version, draft, status, title) => {
    const file = await upload(`${title}.jpg`, 'sneaker-red.jpg');
    execFileSync(
      'uv',
      ['run', '--project', 'apps/server', 'python',
        'apps/server/tests/module05/browser_fixture.py', 'result', version, draft.id, file.id, status],
      { cwd: root, env: { ...process.env, PYTHONPATH: resolve(root, 'apps/server') } },
    );
    return version;
  };
  const fixtures = [
    { owner: canvasDraft, status: 'needs_review', name: '画布作品' },
    { owner: quickDraft, status: 'approved', name: '快捷作品' },
    { owner: quickDraft, status: 'needs_review', name: '快捷待审作品' },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    fixture.version = await seed(
      `m105-${tag}-${index}`, fixture.owner, fixture.status, fixture.name,
    );
  }
  const results = await api(`${base}/results`);
  const [canvas, quick, pending] = fixtures.map((fixture) =>
    results.find((item) => item.version_id === fixture.version),
  );
  const locator = (client, result) => client.locator(`[data-version-id="${result.version_id}"]`);
  const preview = async (client, result) => {
    await expect(locator(client, result)).toHaveAttribute('data-asset-id', result.asset_id);
    await locator(client, result).getByRole('button').first().click();
    const image = client.getByRole('dialog').getByRole('img', { name: result.label, exact: true });
    await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBeGreaterThan(0);
    return image.getAttribute('src');
  };

  await openTask(task.name);
  await navigateEntry('快捷生成');
  await page.getByRole('button', { name: '收起侧栏' }).click();
  await expect(page.locator('.workspace')).toHaveAttribute('data-sidebar-collapsed', 'true');
  const sharedUrl = await preview(page, canvas);
  await page.keyboard.press('Escape');
  const count = (await api(`${base}/canvas`)).nodes.length;
  await navigateEntry('画布');
  await expect(page.getByRole('region', { name: '制作画布' })).toBeVisible();
  await page.getByRole('button', { name: '任务作品' }).click();
  assert.equal(await preview(page, canvas), sharedUrl);
  assert.equal((await api(`${base}/canvas`)).nodes.length, count);
  await preview(page, pending);
  await expect(panel().getByRole('button', { name: '引用到画布' })).toBeDisabled();
  await preview(page, quick);
  await shoot('08-canvas-shared-results');
  await panel().getByRole('button', { name: '引用到画布' }).click();
  await expect.poll(async () => (await api(`${base}/canvas`)).nodes.length).toBe(count + 1);
  await page.getByRole('button', { name: '适应全部', exact: true }).click();
  await node(`result:${quick.version_id}`).click();
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '移除素材节点' }).click();
  await expect.poll(async () => (await api(`${base}/canvas`)).nodes.length).toBe(count);
  assert.deepEqual(await api(`${base}/results`), results);
  await navigateEntry('快捷生成');
  await preview(page, quick);
  await page.keyboard.press('Escape');
  await navigateEntry('批量制作');
  for (const position of task.positions.filter((item) => item.purpose === 'main')) {
    await page.getByLabel('批量商品与用途').selectOption(position.id);
    await page.getByRole('button', { name: '加入批量清单' }).click();
    await expect(page.locator('.batch-items li button').first()).toBeEnabled();
  }
  await expect(page.getByLabel('批量汇总')).toHaveText('2 个 SKU · 预计 2 份产出');
  const target = page.locator('.batch-items li').filter({ hasText: sku });
  await target.getByRole('button', { name: '复用草稿' }).click();
  await panel().getByLabel('来源草稿').selectOption(quickDraft.id);
  await panel().getByRole('button', { name: '覆盖此项配置' }).click();
  await expect(target).toContainText(quickDraft.prompt);
  await target.getByRole('button', { name: '编辑', exact: true }).click();
  await panel().getByLabel('提示词').fill('批量单项覆盖');
  await panel().getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(panel().getByText('草稿已保存')).toBeVisible();
  await page.keyboard.press('Escape');
  assert.equal((await api(`/creations/${quickDraft.id}`)).prompt, quickDraft.prompt);
  await page.getByRole('button', { name: '任务作品' }).click();
  assert.equal(await preview(page, canvas), sharedUrl);
  await shoot('09-batch-shared-results');
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.getByRole('heading', { name: '批量制作', exact: true })).toBeVisible();
  await expect(target).toContainText('批量单项覆盖');
  await target.getByRole('button', { name: '引用作品' }).click();
  await preview(page, quick);
  await panel().getByRole('button', { name: '引用到此项' }).click();
  await expect(panel()).toHaveCount(0);
  const batchDraft = (await api(`${base}/creations?entry=batch`)).find(
    (item) => item.product_id === quickDraft.product_id,
  );
  assert.equal(batchDraft.references[0].source_id, quick.version_id);
  assert.equal(batchDraft.references[0].file_id, quick.file_id);
  assert.deepEqual(await api(`${base}/results`), results);
  assert.equal((await api(`${base}/canvas`)).nodes.length, count);

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(origin);
  await expect(mobile.getByRole('heading', { name: '批量制作', exact: true })).toBeVisible();
  await mobile.getByRole('button', { name: '任务作品' }).click();
  assert.equal(await preview(mobile, canvas), sharedUrl);
  await shoot('10-mobile-shared-results', mobile);
  await mobile.keyboard.press('Escape');
  await navigateEntry('画布', mobile);
  await expect(mobile.getByRole('region', { name: '制作画布' })).toBeVisible();
  await mobile.getByRole('button', { name: '返回工作台' }).click();
  await expect(mobile.getByRole('heading', { name: task.name, exact: true })).toBeVisible();
  await mobile.close();
  const batchVersion = await seed(`m105-${tag}-batch`, batchDraft, 'approved', '批量作品');
  const finalResults = await api(`${base}/results`);
  const batch = finalResults.find((item) => item.version_id === batchVersion);
  await navigateEntry('快捷生成');
  const batchUrl = await preview(page, batch);
  await page.keyboard.press('Escape');
  await navigateEntry('画布');
  await expect(page.getByRole('region', { name: '制作画布' })).toBeVisible();
  await page.getByRole('button', { name: '任务作品' }).click();
  assert.equal(await preview(page, batch), batchUrl);
  await page.keyboard.press('Escape');
  assert.equal((await api(`${base}/canvas`)).nodes.length, count);
  assert.deepEqual(await api(`${base}/results`), finalResults);
  return {
    versions: finalResults.map(({ asset_id, version_id, file_id, status }) => ({
      asset_id,
      version_id,
      file_id,
      status,
    })),
    nodesBefore: count,
    nodesAfterPreview: count,
    nodesWithReference: count + 1,
    nodesAfter: count,
  };
}

async function expectCanvasMedia(client) {
  await expect
    .poll(
      () =>
        client
          .locator('.canvas-node img')
          .evaluateAll(
            (images) => images.filter((image) => image.complete && image.naturalWidth > 0).length,
          ),
      { timeout: 20_000 },
    )
    .toBe(20);
}

async function measure(client) {
  await client.evaluate(() => {
    const times = [];
    const frames = [];
    const long = [];
    let operation;
    let lastFrame;
    let frame;
    const stage = document.querySelector('.canvas-stage');
    const viewport = stage.querySelector('.react-flow__viewport');
    const changed = new MutationObserver(() => {
      if (operation !== undefined) {
        times.push(performance.now() - operation);
        operation = undefined;
      }
    });
    changed.observe(viewport, { attributes: true, subtree: true, attributeFilter: ['style'] });
    const sample = (event) => {
      if (event.type !== 'pointermove' || event.buttons) operation = performance.now();
    };
    stage.addEventListener('wheel', sample, true);
    stage.addEventListener('pointermove', sample, true);
    const tasks = new PerformanceObserver((list) =>
      long.push(...list.getEntries().map((entry) => entry.duration)),
    );
    tasks.observe({ entryTypes: ['longtask'] });
    function tick(at) {
      if (lastFrame !== undefined) frames.push(at - lastFrame);
      lastFrame = at;
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    window.finishCanvasMeasure = () => {
      cancelAnimationFrame(frame);
      changed.disconnect();
      tasks.disconnect();
      stage.removeEventListener('wheel', sample, true);
      stage.removeEventListener('pointermove', sample, true);
      const sorted = times.toSorted((a, b) => a - b);
      return {
        samples: times.length,
        p95Ms: Number((sorted[Math.ceil(sorted.length * 0.95) - 1] ?? Infinity).toFixed(2)),
        fps: Number(((1000 * frames.length) / frames.reduce((sum, ms) => sum + ms, 0)).toFixed(1)),
        longestTaskMs: Math.max(0, ...long),
        heapBytes: performance.memory?.usedJSHeapSize ?? null,
      };
    };
  });
  const canvas = await client.locator('.canvas-stage').boundingBox();
  const x = canvas.x + canvas.width * 0.55;
  const y = canvas.y + canvas.height * 0.45;
  await client.mouse.move(x, y);
  for (let i = 0; i < 25; i++) await client.mouse.wheel(0, i % 2 ? 60 : -60);
  await client.mouse.move(x, y);
  await client.mouse.down({ button: 'middle' });
  await client.mouse.move(x + 110, y + 15, { steps: 20 });
  await client.mouse.move(x, y, { steps: 20 });
  await client.mouse.up({ button: 'middle' });
  const drag = await client.locator('.canvas-node-creation').evaluateAll((cards, canvasBox) => {
    for (const card of cards) {
      const bounds = card.getBoundingClientRect();
      const x = bounds.x + bounds.width / 2;
      const y = bounds.y + bounds.height / 2;
      if (
        x >= canvasBox.x &&
        x < canvasBox.x + canvasBox.width - 35 &&
        y >= canvasBox.y &&
        y < canvasBox.y + canvasBox.height - 30 &&
        card.contains(document.elementFromPoint(x, y))
      ) {
        const wrapper = card.closest('.react-flow__node');
        return { x, y, id: wrapper.dataset.id, transform: wrapper.style.transform };
      }
    }
    return null;
  }, canvas);
  assert(drag, 'Expected a generation node inside the test viewport.');
  await client.mouse.move(drag.x, drag.y);
  await client.mouse.down();
  await client.mouse.move(drag.x + 32, drag.y + 18, { steps: 16 });
  await client.mouse.up();
  assert.notEqual(
    await node(drag.id, client).evaluate((item) => item.style.transform),
    drag.transform,
  );
  return client.evaluate(() => window.finishCanvasMeasure());
}

try {
  await page.goto(origin);
  await page.getByLabel('公司标识').fill(tenant);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.getByRole('button', { name: '全部任务', exact: true })).toBeVisible();
  token = (await api('/me')).csrf_token;
  const redPhoto = await upload('红色实拍.jpg', 'sneaker-red.jpg');
  const bluePhoto = await upload('蓝色样品.jpg', 'sneaker-white.jpg');
  const facts = Object.fromEntries(
    ['color', 'size', 'structure', 'selling_point'].map((key) => [
      key,
      { value: '样品已核对', evidence: '样品记录' },
    ]),
  );
  const red = await api(
    '/products',
    'POST',
    {
      sku: `RED-${tag}`,
      name: '红色帆布鞋',
      category: 'apparel',
      photo_ids: [redPhoto.id],
      facts,
    },
    201,
  );
  const blue = await api(
    '/products',
    'POST',
    {
      sku: `BLUE-${tag}`,
      name: '浅色帆布鞋',
      category: 'apparel',
      photo_ids: [bluePhoto.id],
    },
    201,
  );
  const createTask = (name) =>
    api(
      '/tasks',
      'POST',
      {
        name: `${name} ${tag}`,
        product_ids: [red.id, blue.id],
        contents: ['main', 'video'],
      },
      201,
    );
  const scenario = await createTask('M1-05 图片和视频');
  const benchmark = await createTask('M1-05 容量验证');
  await openTask(scenario.name);
  await expect(page.getByRole('navigation', { name: '工作区' })).toBeHidden();
  await expect(page.getByRole('button', { name: '返回工作台' })).toBeVisible();
  await expect(page.getByRole('navigation', { name: '创作入口' })).toHaveCount(0);
  await expect(page.getByLabel('缩放倍率')).toHaveText(/%/);
  const stage = page.locator('.canvas-stage');
  const stageBox = await stage.boundingBox();
  assert(stageBox.width === 1280 && stageBox.height === 600, 'Canvas should fill the workspace.');
  await page.mouse.dblclick(stageBox.x + stageBox.width - 12, stageBox.y + stageBox.height - 110);
  const pointerMenu = page.getByRole('group', { name: '添加节点' });
  await expect(pointerMenu).toBeVisible();
  const menuBox = await pointerMenu.boundingBox();
  assert(menuBox.x > stageBox.x + stageBox.width / 2);
  assert(menuBox.x + menuBox.width <= stageBox.x + stageBox.width);
  assert(menuBox.y + menuBox.height <= stageBox.y + stageBox.height);
  await page.keyboard.press('Escape');
  await expect(pointerMenu).toHaveCount(0);
  await shoot('01-empty');
  await page.getByRole('button', { name: '添加商品素材', exact: true }).click();
  await panel()
    .getByRole('button', { name: /实拍 1/ })
    .click();
  await expect(node(`upload:${redPhoto.id}`)).toBeVisible();
  await expect
    .poll(() =>
      node(`upload:${redPhoto.id}`)
        .locator('img')
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await shoot('03-add-menu');
  await page.getByRole('button', { name: '图片生成', exact: true }).click();
  await panel().getByRole('button', { name: '新建图片节点' }).click();
  await expect(panel().getByLabel('提示词')).toBeVisible();
  const prompt = '红帆布鞋棚拍，保留商品实际颜色与鞋型。';
  await panel().getByLabel('提示词').fill(prompt);
  await panel().getByLabel('提示词').press('Backspace');
  await panel().getByLabel('提示词').fill(prompt);
  await shoot('02-image-editor');
  const specs = panel().locator('.canvas-specs summary');
  await specs.click();
  await expect(panel().getByLabel('比例 / 清晰度')).toBeVisible();
  const editorBox = await panel().boundingBox();
  const selectedBox = await page.locator('.react-flow__node.canvas-focused').boundingBox();
  assert(
    editorBox.y >= selectedBox.y + selectedBox.height ||
      editorBox.y + editorBox.height <= selectedBox.y ||
      editorBox.x >= selectedBox.x + selectedBox.width ||
      editorBox.x + editorBox.width <= selectedBox.x,
    'Expanded editor must leave the selected node visible.',
  );
  await specs.click();
  await panel().getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(panel().getByText('草稿已保存')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0);
  const canvasPath = `/tasks/${scenario.id}/canvas`;
  const firstDraft = (await api(canvasPath)).creations[0];
  await expect(node(`creation:${firstDraft.id}`)).toBeFocused();
  await page.getByRole('button', { name: '返回工作台' }).click();
  const quickPrompt = '快捷草稿使用独立提示词';
  await expect(page.getByRole('textbox', { name: '提示词', exact: true })).toHaveValue('');
  await page.getByRole('textbox', { name: '提示词', exact: true }).fill(quickPrompt);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  const [quickDraft] = await api(`/tasks/${scenario.id}/creations?entry=quick`);
  assert.notEqual(quickDraft.id, firstDraft.id);
  assert.equal(firstDraft.prompt, prompt);
  await navigateEntry('画布');
  await page.getByRole('button', { name: '适应全部', exact: true }).click();
  await expect(page.getByText('视口已保存', { exact: true })).toBeVisible();
  await node(`creation:${firstDraft.id}`).click();
  await expect(panel().getByLabel('提示词')).toHaveValue(prompt);
  await page.keyboard.press('Escape');
  await node(`upload:${redPhoto.id}`).click();
  const nodeBox = await node(`upload:${redPhoto.id}`).boundingBox();
  const toolBox = await page.getByLabel('节点操作').boundingBox();
  assert(Math.abs(toolBox.x + toolBox.width / 2 - nodeBox.x - nodeBox.width / 2) < 30);
  await page.getByRole('button', { name: '引用节点', exact: true }).click();
  await node(`creation:${firstDraft.id}`).click();
  await panel().getByRole('button', { name: '连接参考', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await node(`creation:${firstDraft.id}`).click();
  await expect(panel().getByRole('button', { name: '保存草稿', exact: true })).toBeInViewport();
  await panel().getByRole('button', { name: '插入参考 1 标签' }).click();
  await panel().getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(panel().getByText('草稿已保存')).toBeVisible();
  await panel().getByRole('button', { name: '核对生成输入', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '生成输入核对' }).getByText(/商品实拍 1 张/),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(1);
  await panel().getByRole('button', { name: '移除参考 1' }).click();
  await expect(panel().getByText('提示词含已移除的引用标签。')).toBeVisible();
  await expect(panel().getByRole('button', { name: '关闭画布浮层' })).toBeEnabled();
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0);
  await expect(page.locator('.react-flow__edge')).toHaveCount(0);
  await page.getByRole('button', { name: '添加节点', exact: true }).click();
  await page.getByRole('button', { name: '视频生成', exact: true }).click();
  await panel().getByRole('button', { name: '新建视频节点' }).click();
  await expect(panel().getByText('视频参数', { exact: true })).toBeVisible();
  await shoot('04-video-editor');
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0);

  await expect(page.getByText('布局已保存', { exact: true })).toBeVisible();
  const beforeConflict = await api(canvasPath);
  await api(`${canvasPath}/layout`, 'PUT', {
    expected_version: beforeConflict.layout.version,
    positions: beforeConflict.layout.positions.map((point) =>
      point.id === `creation:${firstDraft.id}` ? { ...point, x: point.x + 48 } : point,
    ),
  });
  await page.getByRole('button', { name: '整理节点' }).click();
  await expect(page.getByText('布局版本冲突')).toBeVisible();
  await page.getByRole('button', { name: '载入服务器版本', exact: true }).click();
  await expect(page.getByText('布局已保存', { exact: true })).toBeVisible();
  const intercept = '**/canvas/layout';
  await page.route(
    intercept,
    (route) => route.fulfill({ status: 503, json: { detail: 'fixture' } }),
    { times: 1 },
  );
  await page.getByRole('button', { name: '整理节点' }).click();
  await expect(page.getByText('布局未保存')).toBeVisible();
  await page
    .locator('.canvas-save-error')
    .getByRole('button', { name: '重试', exact: true })
    .click();
  await expect(page.getByText('布局已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '缩小', exact: true }).click();
  await expect
    .poll(async () => (await api(canvasPath)).viewport?.version)
    .toBeGreaterThan(beforeConflict.viewport.version);
  await expect(page.getByText('视口已保存', { exact: true })).toBeVisible();
  const restored = await api(canvasPath);
  await page.reload();
  await expect(page.getByRole('heading', { name: scenario.name, exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '制作画布' })).toBeVisible();
  assert.deepEqual(await api(canvasPath), restored);
  const spatial = await page.locator('.react-flow__viewport').evaluate((element) => {
    const matrix = new window.DOMMatrix(window.getComputedStyle(element).transform);
    return { x: matrix.e, y: matrix.f, zoom: matrix.a };
  });
  for (const key of ['x', 'y', 'zoom'])
    assert(Math.abs(spatial[key] - restored.viewport[key]) < 0.01);

  const media = await Promise.all(
    Array.from({ length: 20 }, (_, index) =>
      upload(
        `参考图 ${index + 1}.jpg`,
        ['jacket.jpg', 'sneaker-red.jpg', 'sneaker-studio.jpg', 'sneaker-tan.jpg'][index % 4],
      ),
    ),
  );
  const benchPath = `/tasks/${benchmark.id}/canvas`;
  const baseDrafts = await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      api(
        `/tasks/${benchmark.id}/creations`,
        'POST',
        {
          product_id: red.id,
          purpose: index === 0 ? 'video' : 'main',
          primary: false,
          entry: 'canvas',
          prompt: `素材组合 ${index + 1}`,
        },
        201,
      ),
    ),
  );
  await Promise.all(
    baseDrafts.slice(0, 20).map(async (draft, index) => {
      for (let offset = 0; offset < 5; offset++) {
        draft = await api(`/creations/${draft.id}/references`, 'POST', {
          expected_version: draft.version,
          kind: 'upload',
          source_id: media[(index + offset) % 20].id,
        });
      }
    }),
  );
  const positions = [
    ...media.map((file, index) => ({
      id: `upload:${file.id}`,
      x: (index % 4) * 250,
      y: Math.floor(index / 4) * 190,
    })),
    ...baseDrafts.map((draft, index) => ({
      id: `creation:${draft.id}`,
      x: 1150 + (index % 6) * 255,
      y: Math.floor(index / 6) * 190,
    })),
  ];
  await api(`${benchPath}/layout`, 'PUT', { expected_version: 0, positions });
  await openTask(benchmark.name);
  await expect(page.locator('.react-flow__node:visible')).toHaveCount(50);
  await expect(page.locator('.react-flow__edge')).toHaveCount(100);
  await expectCanvasMedia(page);
  await node(`creation:${baseDrafts[0].id}`).dblclick();
  await expect(panel().getByRole('button', { name: /插入参考 .* 标签/ })).toHaveCount(5);
  await panel()
    .getByRole('button', { name: /插入参考 .* 标签/ })
    .first()
    .scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      panel()
        .locator('.creative-references img')
        .first()
        .evaluate((image) => image.naturalWidth),
    )
    .toBeGreaterThan(0);
  await shoot('05-video-references');
  await page.keyboard.press('Escape');
  await node(`creation:${baseDrafts[10].id}`).dblclick();
  await expect(panel().getByRole('button', { name: /插入参考 .* 标签/ })).toHaveCount(5);
  await panel()
    .getByRole('button', { name: /插入参考 .* 标签/ })
    .first()
    .scrollIntoViewIfNeeded();
  await shoot('06-image-assets');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '仅显示选中关系', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(5);
  await page.getByRole('button', { name: '仅显示选中关系', exact: true }).click();
  await page.getByRole('button', { name: '适应全部', exact: true }).click();
  const desktop = await measure(page);

  const shared = process.env.DATABASE_URL
    ? await verifySharedResults(scenario, red.sku, firstDraft, quickDraft)
    : undefined;
  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(origin);
  await expect(mobilePage.getByRole('region', { name: '制作画布' })).toBeVisible();
  await openTask(benchmark.name, mobilePage);
  await mobilePage.getByRole('button', { name: '适应全部', exact: true }).click();
  await expectCanvasMedia(mobilePage);
  const mobile = await measure(mobilePage);
  const mobileNode = node(`creation:${baseDrafts[10].id}`, mobilePage);
  await mobilePage.getByRole('button', { name: '适应全部', exact: true }).click();
  await mobileNode.dblclick();
  const mobilePanel = mobilePage.getByRole('dialog');
  await expect(mobilePanel.getByLabel('提示词')).toBeInViewport();
  await mobilePanel
    .getByRole('button', { name: '核对生成输入', exact: true })
    .scrollIntoViewIfNeeded();
  await expect(
    mobilePanel.getByRole('button', { name: '核对生成输入', exact: true }),
  ).toBeInViewport();
  const bounds = await mobilePanel.boundingBox();
  assert(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y + bounds.height <= 845);
  await shoot('07-mobile', mobilePage);
  const result = {
    browser: browser.version(),
    nodes: 50,
    edges: 100,
    thumbnails: 20,
    inputBytes: media.reduce((total, item) => total + item.bytes, 0),
    desktop,
    mobile,
    modelRequests,
    errors,
    shared,
  };
  await writeFile(resolve(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(result);
  assert.deepEqual(errors, []);
  assert.deepEqual(modelRequests, []);
  for (const stats of [desktop, mobile]) {
    assert(
      stats.samples >= 10 && stats.p95Ms <= 100 && stats.fps >= 30 && stats.longestTaskMs <= 200,
    );
  }
} catch (error) {
  await shoot('failure').catch(() => {});
  throw error;
} finally {
  await browser.close();
}
