/* global process, console, document, localStorage */
import { chromium, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';

const origin = process.env.STUDIO_M2_URL ?? 'http://127.0.0.1:5179';
const password = process.env.STUDIO_M2_PASSWORD;
if (!password) throw new Error('STUDIO_M2_PASSWORD is required for the isolated acceptance tenant');
const output = resolve(import.meta.dirname, '../../../output/playwright/module-m2');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  await page.getByLabel('公司标识').fill('m2-test');
  await page.getByLabel('邮箱', { exact: true }).fill('admin@m2.example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const nav = async (label) => {
    const open = page.getByRole('button', { name: '打开工作区导航' });
    if (page.viewportSize().width < 700) await open.click();
    await page.getByRole('navigation', { name: '工作区' })
      .getByRole('button', { name: label, exact: true }).click();
  };
  await expect(page.getByRole('navigation', { name: '工作区' })).toBeVisible();
  const me = await page.request.get(`${origin}/api/v1/me`);
  expect(me.ok()).toBeTruthy();
  const session = await me.json();
  const api = async (path, data, method = 'POST') => {
    const response = await page.request.fetch(`${origin}/api/v1${path}`, {
      method,
      data,
      headers: { 'X-CSRF-Token': session.csrf_token, Origin: origin },
    });
    expect(response.ok(), `${path} ${response.status()} ${await response.text()}`).toBeTruthy();
    return response.json();
  };
  const marker = Date.now();
  const sku = await api('/products', {
    sku: `M2-${marker}`, name: '本地验收样本', category: 'apparel',
  });
  const task = await api('/tasks', {
    product_ids: [sku.id], contents: ['main', 'detail', 'video'], name: `M2 批量 ${marker}`,
  });
  const configured = await api(`/tasks/${task.id}/requirements`, {
    expected_version: task.version,
    rows: [
      { product_id: sku.id, purpose: 'main', module: '商品主图', count: 2 },
      { product_id: sku.id, purpose: 'detail', module: '商品细节', count: 3 },
      { product_id: sku.id, purpose: 'video', module: '带货视频', count: 1 },
    ],
  }, 'PUT');
  for (const position of configured.positions) {
    await api(`/tasks/${task.id}/creations`, {
      product_id: sku.id, position_id: position.id, purpose: position.purpose,
      entry: 'batch', primary: false,
    });
  }
  await page.evaluate(({ session, taskId }) => {
    const scope = `${session.tenant.id}:${session.user_id}`;
    localStorage.setItem(`zaowu-studio-task:${scope}`, taskId);
    localStorage.setItem(`zaowu-studio-entry:${scope}`, 'batch');
  }, { session, taskId: task.id });
  await page.reload();
  const rows = page.getByRole('list', { name: '批量清单' }).locator(':scope > li');
  const submit = page.getByRole('button', { name: '提交批量图片' });
  const layout = async (name) => {
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  };
  const edit = rows.first().getByRole('button', { name: '编辑', exact: true });
  await edit.click();
  await expect(page.locator('.batch-panel').getByRole('textbox', { name: '提示词', exact: true }))
    .toBeVisible();
  await layout('batch-edit-1280x600');
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await page.getByRole('button', { name: '公共设置' }).click();
  const publicPanel = page.locator('.batch-panel');
  await publicPanel.getByLabel('公共提示词').fill('公共商品图正文');
  await publicPanel.getByLabel('公共比例 / 清晰度').selectOption('3:4/2K');
  await layout('batch-public-1280x600');
  await publicPanel.getByRole('button', { name: '应用到继承项' }).click();
  await expect(rows.last()).toContainText('公共商品图正文');
  const drafts = await api(`/tasks/${task.id}/creations?entry=batch&primary=false`, undefined, 'GET');
  expect(drafts.filter((draft) => draft.purpose !== 'video').map((draft) => draft.parameters))
    .toEqual(Array(5).fill(expect.objectContaining({ ratio: '3:4', resolution: '2K' })));
  await page.getByRole('button', { name: '任务作品' }).click();
  await expect(publicPanel).toContainText('暂无任务作品');
  await layout('batch-results-1280x600');
  await page.keyboard.press('Escape');
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('请补齐');
  await expect(publicPanel.getByRole('heading', { name: /编辑/ })).toBeVisible();
  await expect(rows.first()).toHaveClass('batch-invalid');
  await page.keyboard.press('Escape');
  await expect(rows.first()).toBeFocused();
  await page.getByRole('button', { name: '视频', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: '图片', exact: true }).click();
  await expect(rows).toHaveCount(5);
  await page.setViewportSize({ width: 390, height: 600 });
  await edit.click();
  const drawer = page.getByRole('dialog');
  await expect(drawer).toBeVisible();
  const box = await drawer.boundingBox();
  expect(box.y + box.height).toBeCloseTo(600, 0);
  await expect(drawer.getByLabel('提示词', { exact: true })).toHaveValue('公共商品图正文');
  for (let index = 0; index < 25; index++) {
    await page.keyboard.press('Tab');
    expect(await drawer.evaluate((node) => node.contains(document.activeElement) ||
      document.activeElement === document.body)).toBeTruthy();
  }
  await page.screenshot({ path: resolve(output, 'batch-drawer-390x600.png') });
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await expect(edit).toBeFocused();
  await page.reload();
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText('公共商品图正文');

  await nav('公司管理');
  await page.getByRole('button', { name: '成员与权限' }).click();
  const entry = page.locator('.company-rows article').filter({ hasText: 'reviewer@m2.example.test' });
  const disable = entry.getByRole('button', { name: '停用并交接' });
  await disable.click();
  const handover = page.getByRole('dialog', { name: '停用成员并交接' });
  await expect(handover.getByRole('button', { name: '确认停用并交接' })).toBeInViewport();
  await page.screenshot({ path: resolve(output, 'team-handover-390x600.png') });
  await page.keyboard.press('Escape');
  await expect(disable).toBeFocused();
  await disable.click();
  await handover.getByLabel('接手人').selectOption('browser-designer');
  await handover.getByRole('button', { name: '确认停用并交接' }).click();
  await expect(entry).toContainText('已停用');
  await page.reload();
  await nav('公司管理');
  await page.getByRole('button', { name: '成员与权限' }).click();
  await expect(entry).toContainText('已停用');
  expect(errors).toEqual([]);
  console.log('M2 browser verification passed');
} finally {
  await browser.close();
}
