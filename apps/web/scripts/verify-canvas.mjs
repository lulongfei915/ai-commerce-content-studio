/* global process, URL, document, MutationObserver, performance, PerformanceObserver, requestAnimationFrame, window, cancelAnimationFrame, console */
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium, expect } from '@playwright/test';

const origin = process.env.STUDIO_CANVAS_URL ?? 'http://127.0.0.1:5176';
const artifacts = resolve(import.meta.dirname, '../../../.artifacts/module05');
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

async function openTask(name, client = page) {
  await client.getByRole('button', { name: '全部任务', exact: true }).click();
  const search = client.getByRole('searchbox', { name: '搜索任务、商品或 SKU' });
  await search.fill(name);
  await search.press('Enter');
  await client.getByRole('button', { name: `继续创作：${name}` }).click();
  await client.getByRole('button', { name: '画布', exact: true }).click();
  await expect(client.getByRole('region', { name: '制作画布' })).toBeVisible();
}

const node = (id, client = page) => client.locator(`.react-flow__node[data-id="${id}"]:visible`);
const panel = () => page.getByRole('dialog');
const shoot = (name, client = page) =>
  client.screenshot({ path: resolve(artifacts, `${name}.png`) });

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
        x >= canvasBox.x && x < canvasBox.x + canvasBox.width - 35 &&
        y >= canvasBox.y && y < canvasBox.y + canvasBox.height - 30 &&
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
  assert.notEqual(await node(drag.id, client).evaluate((item) => item.style.transform), drag.transform);
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
  await page.keyboard.press('Escape');
  await expect(panel()).toHaveCount(0);
  const canvasPath = `/tasks/${scenario.id}/canvas`;
  const firstDraft = (await api(canvasPath)).creations[0];
  await expect(node(`creation:${firstDraft.id}`)).toBeFocused();
  await page.getByRole('button', { name: '快捷创作', exact: true }).click();
  await expect(page.getByLabel('提示词')).toHaveValue(prompt);
  await page.getByRole('button', { name: '保存草稿', exact: true }).click();
  await expect(page.getByText('草稿已保存', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '画布', exact: true }).click();
  await page.getByRole('button', { name: '适应全部', exact: true }).click();
  await expect(page.getByText('视口已保存', { exact: true })).toBeVisible();
  await node(`upload:${redPhoto.id}`).click();
  await page.getByRole('button', { name: '引用节点', exact: true }).click();
  await node(`creation:${firstDraft.id}`).click();
  await panel().getByRole('button', { name: '连接参考', exact: true }).click();
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await node(`creation:${firstDraft.id}`).dblclick();
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
  await openTask(scenario.name);
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

  const mobilePage = await context.newPage();
  await mobilePage.setViewportSize({ width: 390, height: 844 });
  await mobilePage.goto(origin);
  await openTask(benchmark.name, mobilePage);
  await mobilePage.getByRole('button', { name: '适应全部', exact: true }).click();
  await expectCanvasMedia(mobilePage);
  const mobile = await measure(mobilePage);
  const mobileNode = node(`creation:${baseDrafts[10].id}`, mobilePage);
  await mobilePage.getByRole('button', { name: '适应全部', exact: true }).click();
  await mobileNode.dblclick();
  const mobilePanel = mobilePage.getByRole('dialog');
  await expect(mobilePanel.getByLabel('提示词')).toBeVisible();
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
