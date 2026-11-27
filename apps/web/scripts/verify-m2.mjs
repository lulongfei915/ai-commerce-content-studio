/* global process, console, document, localStorage */
import { chromium, expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { URL } from 'node:url';

const origin = process.env.STUDIO_M2_URL ?? 'http://127.0.0.1:5179';
const password = process.env.STUDIO_M2_PASSWORD;
const output = resolve(import.meta.dirname, '../../../output/playwright/module-m2');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 600 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  const companyField = page.getByLabel('公司标识');
  const emailField = page.getByLabel('邮箱', { exact: true });
  const passwordField = page.getByLabel('密码', { exact: true });
  if (password) {
    await companyField.fill('m2-test');
    await emailField.fill('admin@m2.example.test');
    await passwordField.fill(password);
  } else {
    await expect(companyField).toHaveValue('m2-test');
    await expect(emailField).toHaveValue('admin@m2.example.test');
    await expect(passwordField).not.toHaveValue('');
  }
  await page.getByRole('button', { name: '登录', exact: true }).click();
  const nav = async (label) => {
    const open = page.getByRole('button', { name: '打开工作区导航' });
    if (page.viewportSize().width < 700) await open.click();
    await page.getByRole('navigation', { name: '工作区' })
      .getByRole('button', { name: label, exact: true }).click();
  };
  await expect(page.getByRole('navigation', { name: '工作区' })).toBeVisible({ timeout: 15_000 });
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
  const rows = page.getByRole('list', { name: '生成项清单' }).locator(':scope > li');
  const submit = page.getByRole('button', { name: /生成 \d+ 张图片/ });
  const layout = async (name) => {
    await expect(rows).toHaveCount(5);
    for (const row of await rows.all()) await expect(row).toBeInViewport({ ratio: 1 });
    await expect(submit).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: resolve(output, `${name}.png`) });
  };
  const edit = rows.first().getByRole('button', { name: '编辑', exact: true });
  await edit.click();
  const publicPanel = page.locator('.batch-panel');
  await expect(publicPanel.getByRole('heading', { name: /^01 ·/ })).toBeVisible();
  await expect(publicPanel.getByRole('textbox')).toHaveCount(1);
  await expect(rows.first()).toHaveClass('batch-selected');
  await expect(rows.first()).toContainText(sku.sku);
  await expect(publicPanel.getByRole('button', { name: '添加参考' })).toBeVisible();
  await publicPanel.getByRole('button', { name: '画面规格' }).click();
  await expect(publicPanel.getByRole('group', { name: '画面规格' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(publicPanel.getByRole('group', { name: '画面规格' })).toHaveCount(0);
  await layout('batch-edit-1280x600');
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('请填写提示词');
  await expect(publicPanel.getByRole('heading', { name: /^01 ·/ })).toBeVisible();
  await expect(rows.first()).toHaveClass(/batch-invalid/);
  await expect(publicPanel.getByRole('textbox', { name: '提示词', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(edit).toBeFocused();
  await page.getByRole('button', { name: '调整公共设置' }).click();
  await publicPanel.getByLabel('公共提示词').fill('公共商品图正文');
  await publicPanel.getByLabel('公共比例 / 清晰度').selectOption('3:4/2K');
  await layout('batch-public-1280x600');
  await publicPanel.getByRole('button', { name: '应用到继承项' }).click();
  await expect(rows.last()).toContainText('公共商品图正文');
  const drafts = await api(`/tasks/${task.id}/creations?entry=batch&primary=false`, undefined, 'GET');
  expect(drafts.filter((draft) => draft.purpose !== 'video').map((draft) => draft.parameters))
    .toEqual(Array(5).fill(expect.objectContaining({ ratio: '3:4', resolution: '2K' })));
  await expect(page.getByRole('button', { name: '任务作品' })).toHaveCount(0);
  await expect(rows.locator('.batch-product-thumb')).toHaveCount(0);
  await page.getByRole('tab', { name: '批量视频' }).click();
  await expect(rows).toHaveCount(1);
  await expect(publicPanel.getByRole('button', { name: '成片分镜' })).toBeVisible();
  await publicPanel.getByRole('button', { name: '关闭' }).click();
  await page.setViewportSize({ width: 390, height: 600 });
  await page.getByRole('tab', { name: '批量图片' }).click();
  await expect(rows).toHaveCount(5);
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
  await page.setViewportSize({ width: 320, height: 600 });
  await edit.click();
  await expect(drawer.getByRole('button', { name: '添加参考' })).toBeVisible();
  expect(await drawer.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBeTruthy();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(rows).toHaveCount(5);
  await expect(rows.last()).toContainText('公共商品图正文');

  await page.setViewportSize({ width: 1280, height: 600 });
  const add = page.getByRole('button', { name: '新增图片项' });
  await add.click();
  await expect(rows).toHaveCount(6);
  const selected = publicPanel.getByRole('textbox', { name: '提示词', exact: true });
  await expect(selected).toHaveValue('公共商品图正文');
  await expect(rows.last()).toHaveClass(/batch-selected/);
  await selected.fill('单项提示词');
  await publicPanel.getByLabel('输出张数').selectOption('2');
  await expect(submit).toHaveAccessibleName(/生成 7 张图片/);
  await publicPanel.getByRole('button', { name: '添加参考' }).click();
  await expect(publicPanel.getByText('选择参考', { exact: true })).toBeVisible();
  await expect(publicPanel.getByLabel('上传参考素材'))
    .toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
  await expect(publicPanel.getByRole('button', { name: '添加案例参考' })).toBeVisible();
  await expect(publicPanel.getByRole('heading', { name: '任务作品' })).toBeVisible();
  await expect(publicPanel).toContainText('暂无任务作品');
  await publicPanel.getByRole('button', { name: '返回', exact: true }).click();
  await expect(selected).toHaveValue('单项提示词');
  const copied = page.waitForResponse((response) => response.url().endsWith('/copy'));
  await rows.last().getByRole('button', { name: /更多操作/ }).click();
  await page.getByRole('menuitem', { name: '复制生成项' }).click();
  const copyResponse = await copied;
  expect(copyResponse.ok(), `Copy ${copyResponse.status()} ${await copyResponse.text()}`).toBeTruthy();
  await expect(rows).toHaveCount(7);
  await expect(rows.last()).toHaveClass(/batch-selected/);
  await expect(selected).toHaveValue('单项提示词');
  await expect(publicPanel.getByLabel('输出张数')).toHaveValue('2');
  const rowOrder = await rows.evaluateAll((entries) => entries.map((entry) => entry.id));
  await page.getByRole('button', { name: '调整公共设置' }).click();
  await publicPanel.getByLabel('公共提示词').fill('更新公共提示词');
  await publicPanel.getByRole('button', { name: '应用到继承项' }).click();
  await expect(rows.filter({ hasText: '更新公共提示词' })).toHaveCount(5);
  expect(await rows.evaluateAll((entries) => entries.map((entry) => entry.id))).toEqual(rowOrder);
  await expect(rows.filter({ hasText: '单项提示词' })).toHaveCount(2);
  const rowToDelete = rows.filter({ hasText: '单项提示词' }).last();
  const rowNumber = await rowToDelete.locator('.batch-number').innerText();
  await rowToDelete.getByRole('button', { name: /更多操作/ }).click();
  const [confirmationText] = await Promise.all([
    page.waitForEvent('dialog', { timeout: 8000 }).then(async (confirmation) => {
      const message = confirmation.message();
      await confirmation.dismiss();
      return message;
    }),
    page.getByRole('menuitem', { name: '删除此项' }).click({ timeout: 8000 }),
  ]);
  expect(confirmationText).toContain(`第 ${rowNumber} 项`);
  expect(confirmationText).toContain(sku.name);
  await expect(rows).toHaveCount(7);
  await expect(rowToDelete.getByRole('button', { name: /更多操作/ })).toBeFocused();
  await rowToDelete.getByRole('button', { name: /更多操作/ }).click();
  page.once('dialog', (confirmation) => confirmation.accept());
  await page.getByRole('menuitem', { name: '删除此项' }).click();
  await expect(rows).toHaveCount(6);
  await expect(rows.filter({ hasText: '单项提示词' })).toHaveCount(1);

  const submitted = drafts.find((item) => item.purpose !== 'video');
  const outputFixture = (id, status) => ({
    id, status, error: null, fee_state: 'unverified', provider_id: null,
    reserved_cents: 0, actual_cents: null,
  });
  const job = {
    id: 'batch-verification-job', media: 'image', outputs: [
      outputFixture('already-saved', 'pending_review'),
      outputFixture('save-needs-retry', 'save_failed'),
    ],
  };
  const resultFixture = (id, creation = submitted.id) => ({
    version_id: id, asset_id: `asset-${id}`, version: 1, task_id: task.id,
    product_id: sku.id, sku: sku.sku, purpose: submitted.purpose, creation_id: creation,
    execution_id: creation === submitted.id ? job.id : 'another-job',
    media: 'image', status: 'pending_review', label: id, file_id: `file-${id}`,
    file_version: 1, previewable: true, referenceable: false, width: 384, height: 512,
  });
  const results = [resultFixture('already-saved'), resultFixture('unrelated', 'another-item')];
  await page.route(`**/tasks/${task.id}/results`, (route) => route.fulfill({ json: results }));
  const sampleImage = await readFile(resolve(import.meta.dirname, '../../../prototype/assets/skincare.jpg'));
  const samplePhoto = await readFile(resolve(import.meta.dirname, '../../../prototype/assets/beauty.jpg'));
  await page.route(`**/tasks/${task.id}/results/*/preview?*`, (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: sampleImage }));
  await page.route(`**/tasks/${task.id}`, async (route) => {
    const response = await route.fetch();
    const value = await response.json();
    if (route.request().method() === 'GET') {
      value.products.find((product) => product.id === sku.id).photos = [{ file_id: 'source-photo', version: 1 }];
    }
    return route.fulfill({ response, json: value });
  });
  await page.route('**/products/*/photos/source-photo/preview', (route) =>
    route.fulfill({ contentType: 'image/jpeg', body: samplePhoto }));
  await page.route(`**/batches/image/executions/${job.id}/record`, (route) => route.fulfill({
    json: { execution: job, submitted_at: new Date().toISOString(), inputs: {
      draft: { ...submitted, prompt: '提交时的提示词' }, product_photos: [], references: [],
    } },
  }));
  await page.route('**/assets/already-saved', (route) => route.fulfill({ json: results[0] }));
  await page.route('**/assets/already-saved/quality', (route) => route.fulfill({ json: {} }));
  await page.route('**/assets/already-saved/review', (route) => {
    expect(route.request().postDataJSON()).toMatchObject({ version: 1, decision: 'approved' });
    results[0] = { ...results[0], status: 'approved', referenceable: true };
    return route.fulfill({ json: results[0] });
  });
  await page.route('**/reviews?*', (route) => {
    expect(new URL(route.request().url()).searchParams.get('task_id')).toBe(task.id);
    return route.fulfill({ json: results });
  });
  // Exercise browser routing for a partial result without invoking a paid provider.
  await page.route(`**/tasks/${task.id}/batches/image/executions`, (route) =>
    route.fulfill({ json: [{ item_id: submitted.id, execution: job }] }));
  let retryCalls = 0;
  await page.route('**/outputs/save-needs-retry/retry', (route) => {
    expect(route.request().method()).toBe('POST');
    retryCalls += 1;
    results.push(resultFixture('save-needs-retry'));
    return route.fulfill({ json: { ...job, outputs: [
      job.outputs[0], { ...job.outputs[1], status: 'pending_review' },
    ] } });
  });
  await page.reload();
  const submittedRow = rows.filter({ hasText: '有失败' });
  await submittedRow.getByRole('button', { name: /更多操作/ }).click();
  await expect(page.getByRole('menuitem', { name: '复制生成项' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: '删除此项' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  const resultThumb = submittedRow.getByRole('button', { name: /查看第 .+ 项生成结果/ });
  await expect(resultThumb.locator('img')).toHaveAttribute('src', /\/already-saved\/preview/);
  await expect(rows.filter({ hasText: '未提交' }).first().locator('.batch-product-thumb img'))
    .toHaveAttribute('src', /\/photos\/source-photo\/preview/);
  await resultThumb.click();
  await expect(publicPanel.getByText('生成结果', { exact: true })).toBeVisible();
  await expect(publicPanel.getByText(sku.name, { exact: false })).toBeVisible();
  await expect(publicPanel.getByRole('button', { name: '预览与审核' })).toHaveCount(1);
  await expect(publicPanel.getByRole('img', { name: 'unrelated' })).toHaveCount(0);
  await publicPanel.getByRole('button', { name: '输入与执行记录' }).click();
  const record = page.getByRole('dialog', { name: '生成项 · 输入与执行记录' });
  await expect(record.getByText('提交时的提示词', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(publicPanel.getByRole('button', { name: '输入与执行记录' })).toBeFocused();
  const thumbnail = publicPanel.getByRole('button', { name: '预览第 1 份图片' });
  const assetDrawer = page.getByRole('dialog', { name: '素材详情' });
  await thumbnail.click();
  await expect(assetDrawer.getByRole('img', { name: 'already-saved' })).toBeVisible();
  await expect(assetDrawer.getByText('商品实拍对照')).toBeVisible();
  await assetDrawer.getByRole('button', { name: '查看实拍 1' }).click();
  await expect(assetDrawer.getByRole('img', { name: `${sku.name} · 商品实拍` })).toBeVisible();
  await assetDrawer.getByRole('button', { name: '查看实拍 1' }).click();
  await assetDrawer.getByRole('button', { name: '驳回返工' }).click();
  await expect(assetDrawer.getByLabel('审核意见（驳回必填）')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(thumbnail).toBeFocused();
  await publicPanel.getByRole('button', { name: '只重存' }).click();
  await expect(publicPanel.getByRole('button', { name: '预览与审核' })).toHaveCount(2);
  expect(retryCalls).toBe(1);
  await page.screenshot({ path: resolve(output, 'batch-output-cards-1280x600.png') });
  await page.setViewportSize({ width: 390, height: 600 });
  const detail = drawer.getByRole('button', { name: '预览与审核' }).first();
  await detail.click();
  await expect(assetDrawer.getByRole('button', { name: '批准此版本' })).toBeInViewport();
  const previewBox = await assetDrawer.locator('.asset-detail-preview').boundingBox();
  const headingBox = await assetDrawer.getByRole('heading', { name: new RegExp(sku.name) }).boundingBox();
  expect(headingBox.y).toBeGreaterThan(previewBox.y + previewBox.height);
  await page.screenshot({ path: resolve(output, 'batch-asset-detail-390x600.png') });
  await assetDrawer.getByRole('button', { name: '批准此版本' }).click();
  await expect(assetDrawer.getByText('已批准', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(detail).toBeFocused();
  await expect(drawer.getByRole('list', { name: '逐份进度' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toHaveCount(0);
  await page.getByRole('button', { name: '待审核 2 份' }).click();
  await expect(page.getByRole('heading', { name: '审核中心' })).toBeVisible();
  await expect(page.getByText('unrelated', { exact: true })).toBeVisible();
  await expect(page.getByText('already-saved', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '预览unrelated', exact: true }).click();
  const review = page.getByRole('dialog', { name: '素材审核' });
  await expect(review.getByText('生成结果 · V1')).toBeVisible();
  await expect(review.getByText(`商品实拍 · ${sku.sku}`)).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: /返回创作/ }).click();
  await expect(page.getByRole('tab', { name: '批量图片' })).toBeVisible();
  await rows.filter({ hasText: '单项提示词' }).getByRole('button', { name: '编辑' }).click();
  await drawer.getByRole('button', { name: '添加参考' }).click();
  const referenceList = drawer.getByRole('list', { name: '任务作品' });
  await referenceList.getByRole('button', { name: /already-saved/ }).click();
  await expect(drawer.getByRole('button', { name: '引用到此项' })).toBeEnabled();
  await referenceList.getByRole('button', { name: /unrelated/ }).click();
  await expect(drawer.getByRole('button', { name: '引用到此项' })).toBeDisabled();
  await page.keyboard.press('Escape');

  await page.unroute(`**/tasks/${task.id}/batches/image/executions`);
  await page.unroute(`**/tasks/${task.id}/results`);
  await page.reload();
  await rows.filter({ hasText: '单项提示词' }).getByRole('button', { name: /更多操作/ }).click();
  const deleteAction = page.getByRole('menuitem', { name: '删除此项' });
  await expect(deleteAction).toBeInViewport();
  await expect(page.locator('.ant-dropdown').filter({ has: deleteAction })).toHaveCSS('opacity', '1');
  await page.screenshot({ path: resolve(output, 'batch-row-menu-390x600.png') });
  page.once('dialog', (confirmation) => confirmation.accept());
  await deleteAction.click();
  await expect(rows).toHaveCount(5);
  await page.setViewportSize({ width: 1280, height: 600 });
  await page.reload();
  await expect(rows).toHaveCount(5);
  await expect(submit).toHaveAccessibleName(/生成 5 张图片/);
  const expectedIds = new Set(drafts.filter((draft) => draft.purpose !== 'video').map((draft) => draft.id));
  const realSubmission = process.env.STUDIO_M2_REAL_SUBMIT === '1';
  if (!realSubmission) {
    let queue = [];
    await page.route(`**/tasks/${task.id}/batches/image/executions`, (route) => {
      if (route.request().method() === 'GET') return route.fulfill({ json: queue });
      const { items } = route.request().postDataJSON();
      expect(items).toHaveLength(5);
      expect(new Set(items.map((item) => item.id))).toEqual(expectedIds);
      queue = items.map(({ id }) => ({
        item_id: id,
        execution: { id: `job-${id}`, media: 'image', outputs: [outputFixture(`output-${id}`, 'queued')] },
      }));
      return route.fulfill({ status: 202, json: queue });
    });
  }
  try {
    const accepted = page.waitForResponse((response) =>
      response.request().method() === 'POST' && response.url().endsWith('/batches/image/executions'));
    await submit.click();
    const response = await accepted;
    expect(response.status(), await response.text()).toBe(202);
    const queue = await response.json();
    expect(new Set(queue.map((row) => row.item_id))).toEqual(expectedIds);
    expect(new Set(queue.map((row) => row.execution.id)).size).toBe(5);
    expect(new Set(queue.flatMap((row) => row.execution.outputs.map((item) => item.id))).size)
      .toBe(5);
    expect(queue.every((row) =>
      row.execution.outputs.length === 1 && row.execution.outputs[0].status === 'queued')).toBe(true);
    await expect(rows.getByRole('button', { name: '结果', exact: true })).toHaveCount(5);
    await expect(publicPanel.getByRole('list', { name: '逐份进度' })).toBeVisible();
    await page.screenshot({ path: resolve(output, 'batch-five-queued-1280x600.png') });
  } finally {
    if (realSubmission) {
      const queue = await api(`/tasks/${task.id}/batches/image/executions`, undefined, 'GET');
      for (const { execution } of queue) {
        if (execution.outputs.some((item) => item.status === 'queued')) {
          await api(`/executions/${execution.id}/cancel`);
        }
      }
    }
  }

  if (!process.env.STUDIO_M2_BATCH_ONLY) {
    await page.setViewportSize({ width: 390, height: 600 });
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
  }
  expect(errors).toEqual([]);
  console.log('M2 browser verification passed');
} finally {
  await browser.close();
}
