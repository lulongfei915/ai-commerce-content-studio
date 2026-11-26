/* global process, console, localStorage */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.STUDIO_M3_URL ?? 'http://127.0.0.1:5180';
const password = process.env.STUDIO_M3_PASSWORD;
if (!password) throw new Error('Use a test workspace without a generation worker.');
const output = resolve(import.meta.dirname, '../../../output/playwright/module-m3');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 700 } });
  page.setDefaultTimeout(10000);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('公司标识').fill('m3-test');
  await page.getByLabel('邮箱', { exact: true }).fill('admin@m3.example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  await expect(page.locator('.workspace')).toBeVisible();
  const session = await (await page.request.get(`${origin}/api/v1/me`)).json();
  const api = async (path, data, status = 201) => {
    const response = await page.request.post(`${origin}/api/v1${path}`, {
      data, headers: { 'X-CSRF-Token': session.csrf_token, Origin: origin },
    });
    expect(response.status(), await response.text()).toBe(status);
    return response.json();
  };
  const sku = await api('/products', {
    sku: `M3-${Date.now()}`, name: '视频验收样品', category: 'apparel',
  });
  const task = await api('/tasks', {
    product_ids: [sku.id], contents: ['video'], name: `M3 ${sku.sku}`,
  });
  const drafts = {};
  for (const entry of ['quick', 'canvas', 'batch']) {
    drafts[entry] = await api(`/tasks/${task.id}/creations`, {
      product_id: sku.id, purpose: 'video', prompt: '用自然光展示商品轮廓',
      entry, primary: entry !== 'batch',
      ...(entry === 'batch' ? { position_id: task.positions[0].id } : {}),
    });
  }
  async function visit(entry) {
    await page.evaluate(({ session, taskId, entry }) => {
      const scope = `${session.tenant.id}:${session.user_id}`;
      localStorage.setItem(`zaowu-studio-task:${scope}`, taskId);
      localStorage.setItem(`zaowu-studio-entry:${scope}`, entry);
    }, { session, taskId: task.id, entry });
    await page.reload();
  }
  async function confirm(entry) {
    await page.getByRole('button', { name: '成片分镜', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: `${sku.sku} · 成片分镜` });
    const submit = dialog.getByRole('button', { name: '确认成片分镜' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('画面', { exact: true }).fill(`${entry} 商品全景`);
    await dialog.getByLabel('时长（秒）').fill('4');
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('时长（秒）').fill('5');
    await expect(submit).toBeEnabled();
    await page.screenshot({ path: resolve(output, `${entry}.png`) });
    await submit.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: '已确认分镜' })).toBeVisible();
  }

  await visit('quick');
  const continueTask = page.getByRole('button', { name: `继续创作：${task.name}` });
  const settings = page.getByRole('button', { name: /创作设置/ });
  await expect(settings.or(continueTask).first()).toBeVisible();
  if (await continueTask.isVisible()) await continueTask.click();
  await settings.click();
  await page.getByRole('button', { name: '优化提示词' }).waitFor();
  await confirm('quick');
  await page.keyboard.press('Escape');

  await visit('canvas');
  await page.locator(`.react-flow__node[data-id="creation:${drafts.canvas.id}"]`).dblclick();
  await page.getByRole('button', { name: '提示词工具' }).waitFor();
  await confirm('canvas');

  await visit('batch');
  const edit = page.getByRole('list', { name: /生成项清单|批量清单/ })
    .getByRole('button', { name: '编辑' });
  if (!(await page.getByRole('button', { name: '成片分镜', exact: true }).isVisible())) await edit.click();
  await page.getByRole('button', { name: '优化提示词' }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await confirm('batch');
  await page.keyboard.press('Escape');
  const submit = page.locator('.batch-submit button');
  await expect(submit).toBeEnabled();
  const [accepted] = await Promise.all([
    page.waitForResponse((response) => response.request().method() === 'POST' &&
      response.url().includes('/batches/video/executions')),
    submit.click(),
  ]);
  expect(accepted.status(), await accepted.text()).toBe(202);
  expect(errors).toEqual([]);
  console.log('M3 quick, canvas, batch storyboard passed; batch queued on mobile.');
} finally {
  await browser.close();
}
