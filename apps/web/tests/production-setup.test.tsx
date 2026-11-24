import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { App } from '../src/app/App';

const selectedProduct = {
  id: 'red',
  sku: 'SHOE-RED',
  name: '红色帆布鞋',
  category: 'apparel',
  version: 1,
  fact_version: 1,
  facts: {},
  photos: [],
  readiness: { main: ['photo_required'] },
};
const session = {
  user_id: 'person',
  email: 'studio@example.test',
  tenant: { id: 'company', slug: 'studio', name: '造物电商' },
  role: 'designer',
  permissions: ['view', 'create'],
  csrf_token: 'csrf-test',
};

afterEach(() => vi.unstubAllGlobals());

test('starting from a catalog product preselects it and keeps the chosen scope when returning from the editor', async () => {
  let payload: unknown;
  const fetchMock = vi.fn<typeof fetch>(async (url, init) => {
    const path = String(url).split('?')[0];
    switch (path) {
      case '/api/v1/me':
        return Response.json(session);
      case '/api/v1/products/categories':
        return Response.json([{ id: 'apparel', label: '鞋服', fields: [] }]);
      case '/api/v1/products':
        return Response.json({ items: [selectedProduct], next_cursor: null });
      case '/api/v1/tasks':
        if (init?.method === 'POST') {
          payload = JSON.parse(String(init.body));
          return Response.json(
            {
              id: 'task',
              name: '上新一组',
              status: 'draft',
              version: 1,
              products: [selectedProduct],
              positions: [
                { id: 'position', product_id: 'red', purpose: 'main', status: 'unfilled' },
              ],
            },
            { status: 201 },
          );
        }
        return Response.json({ items: [], next_cursor: null });
      default:
        return new Response(null, { status: 404 });
    }
  });
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  const nav = await screen.findByRole('navigation', { name: '工作区' });
  fireEvent.click(within(nav).getByRole('button', { name: '商品资料' }));
  fireEvent.click(await screen.findByRole('button', { name: '用此商品制作' }));
  const setup = screen.getByRole('dialog', { name: '新建制作' });
  expect(within(setup).getByRole('checkbox', { name: /红色帆布鞋/ })).toBeChecked();
  expect(within(setup).getByRole('checkbox', { name: '商品主图' })).toBeChecked();
  expect(within(setup).getByText('已选 1 件：红色帆布鞋')).toBeVisible();
  fireEvent.click(within(setup).getByRole('checkbox', { name: '商品主图' }));
  expect(within(setup).getByRole('button', { name: '进入制作' })).toBeDisabled();
  fireEvent.click(within(setup).getByRole('checkbox', { name: '商品主图' }));
  fireEvent.click(within(setup).getByText('制作名称', { exact: true }));
  fireEvent.change(within(setup).getByLabelText('任务名称'), { target: { value: '上新一组' } });
  fireEvent.click(within(setup).getByRole('button', { name: '添加新商品' }));
  const editor = await screen.findByRole('dialog', { name: '添加新商品' });
  fireEvent.click(within(editor).getByRole('button', { name: '关闭' }));
  expect(within(setup).getByRole('checkbox', { name: /红色帆布鞋/ })).toBeChecked();
  expect(within(setup).getByRole('checkbox', { name: '商品主图' })).toBeChecked();
  expect(within(setup).getByLabelText('任务名称')).toHaveValue('上新一组');
  fireEvent.click(within(setup).getByRole('button', { name: '进入制作' }));
  expect(await screen.findByRole('heading', { name: '上新一组' })).toBeInTheDocument();
  expect(payload).toEqual({ product_ids: ['red'], contents: ['main'], name: '上新一组' });
});
