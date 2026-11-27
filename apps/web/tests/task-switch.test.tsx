import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import type { Session } from '../src/features/auth/session';
import { defaults, type Draft } from '../src/features/creation/api';
import type { TaskResult } from '../src/features/creation/results';
import type { Task } from '../src/features/tasks/api';
import { Workspace } from '../src/features/tasks/Workspace';

const session: Session = {
  tenant: { id: 'company', slug: 'company', name: '造物' },
  user_id: 'person',
  email: 'person@example.test',
  role: 'designer',
  permissions: ['view', 'create'],
  csrf_token: 'test',
};

function fixture(id: string, name: string, productName: string) {
  const product: Task['products'][number] = {
    id: `product-${id}`, sku: id, name: productName, category: 'apparel',
    version: 1, fact_version: 1, facts: {}, photos: [], readiness: {},
  };
  const task: Task = {
    id, name, version: 1, status: 'draft', products: [product],
    positions: [{ id: `position-${id}`, product_id: product.id, purpose: 'main', status: 'unfilled' }],
  };
  const draft: Draft = {
    id: `draft-${id}`, task_id: id, product_id: product.id, version: 1,
    purpose: 'main', entry: 'quick', slot: 'primary', prompt: `${productName}的已保存提示词`,
    parameters: defaults, references: [], template_id: null, template_version: null, video_parameters: null,
  };
  const result: TaskResult = {
    sku: product.sku, task_id: id, product_id: product.id, creation_id: draft.id,
    asset_id: `asset-${id}`, version_id: `result-${id}`, version: 1, execution_id: `execution-${id}`,
    label: `${productName}的作品`, purpose: 'main', media: 'image', status: 'pending_review',
    file_id: null, file_version: null, previewable: false, referenceable: false,
  };
  return { task, draft, result };
}

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test('switching tasks from the workbench keeps the entry and loads only the target task context', async () => {
  const red = fixture('red', '春季上新', '红色帆布鞋');
  const blue = fixture('blue', '秋季上新', '蓝色帆布鞋');
  const fetchMock = vi.fn<typeof fetch>(async (url) => {
    const path = String(url).split('?')[0];
    if (path === '/api/v1/tasks') return Response.json({ items: [red.task, blue.task], next_cursor: null });
    for (const { task, draft, result } of [red, blue]) {
      const base = `/api/v1/tasks/${task.id}`;
      if (path === base) return Response.json(task);
      if (path === `${base}/creations`) return Response.json([draft]);
      if (path === `${base}/results`) return Response.json([result]);
    }
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetchMock);
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
  render(<Workspace session={session} busy={false} error={null} onLogout={vi.fn()} />);

  const menuTrigger = (current: string) =>
    screen.findByRole('button', { name: `切换任务，当前：${current}` });
  const trigger = await menuTrigger(red.task.name);
  expect(screen.queryByRole('button', { name: '任务设置' })).not.toBeInTheDocument();
  fireEvent.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: '任务设置' }));
  const settings = screen.getByRole('dialog', { name: '任务设置' });
  expect(within(settings).getByRole('button', { name: '修改名称' })).toBeVisible();
  expect(within(settings).getByRole('button', { name: '添加商品到本次制作' })).toBeVisible();
  fireEvent.click(within(settings).getByRole('button', { name: '关闭' }));
  fireEvent.click(trigger);
  const menu = await screen.findByRole('menu');
  expect(within(menu).queryByText('新建制作')).not.toBeInTheDocument();
  fireEvent.click(within(menu).getByText('查看全部'));
  fireEvent.click(await screen.findByRole('button', { name: `继续创作：${blue.task.name}` }));
  expect(await screen.findByText(blue.result.label)).toBeVisible();
  const prompt = await screen.findByRole('textbox', { name: '提示词' });
  await waitFor(() => expect(prompt).toHaveValue(blue.draft.prompt));
  fireEvent.change(prompt, { target: { value: '尚未保存的蓝鞋提示词' } });

  const chooseRed = async () => {
    fireEvent.click(await menuTrigger(blue.task.name));
    fireEvent.click(within(await screen.findByRole('menu')).getByText(red.task.name));
  };
  await chooseRed();
  expect(confirm).toHaveBeenCalledOnce();
  expect(prompt).toHaveValue('尚未保存的蓝鞋提示词');
  expect(screen.getByText(blue.result.label)).toBeVisible();

  confirm.mockReturnValue(true);
  await chooseRed();
  expect(await screen.findByText(red.result.label)).toBeVisible();
  expect(screen.queryByText(blue.result.label)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: '创作商品与用途' })).toHaveDisplayValue(
    '红色帆布鞋 · 主图',
  );
  await waitFor(() => expect(screen.getByRole('textbox', { name: '提示词' })).toHaveValue(red.draft.prompt));
  expect(screen.getByRole('button', { name: '快捷生成' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(screen.getByRole('button', { name: '查看红色帆布鞋实拍与资料' }));
  const product = screen.getByRole('dialog', { name: '商品资料' });
  expect(within(product).getByRole('heading', { name: '红色帆布鞋' })).toBeVisible();
  expect(within(product).queryByText('蓝色帆布鞋')).not.toBeInTheDocument();
  expect(fetchMock.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
});
