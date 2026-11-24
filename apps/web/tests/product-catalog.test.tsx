import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ProductCatalog } from '../src/features/products/ProductCatalog';
import { ProductDetails } from '../src/features/products/ProductDetails';
import type { Product } from '../src/features/products/api';

const product: Product = {
  id: 'shoe',
  sku: 'SHOE-01',
  name: '低帮运动鞋',
  category: 'apparel',
  version: 1,
  fact_version: 1,
  facts: { specification: { value: '米白 · 36–44 码', evidence: '录入人已核对商品信息' } },
  photos: [{ file_id: 'photo', version: 1 }],
  readiness: { main: [] },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('shows confirmed specifications on the card and lets users view and edit the full record', async () => {
  const onEdit = vi.fn();
  const draft: Product = { ...product, id: 'draft', facts: {}, photos: [], name: '商品草稿' };
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      Response.json({
        items: [product, draft],
        next_cursor: null,
      }),
    ),
  );
  render(
    <ProductCatalog
      categories={[{ id: 'apparel', label: '鞋服', fields: [] }]}
      canCreate
      revision={0}
      onCreate={vi.fn()}
      onEdit={onEdit}
      onStart={vi.fn()}
    />,
  );

  expect(await screen.findByText('米白 · 36–44 码')).toBeVisible();
  expect(screen.getByText('已确认')).toBeVisible();
  expect(screen.getByText('待完善')).toBeVisible();
  expect(screen.queryByRole('button', { name: '编辑资料' })).not.toBeInTheDocument();
  fireEvent.click(screen.getAllByRole('button', { name: '查看资料' })[0]);
  const details = screen.getByRole('dialog', { name: '商品资料' });
  expect(within(details).getByText('商品事实已确认')).toBeVisible();
  expect(within(details).getByText('确认规格')).toBeVisible();
  expect(within(details).getByText('录入人已核对商品信息')).toBeVisible();
  expect(within(details).queryByText('商品颜色')).not.toBeInTheDocument();
  fireEvent.click(within(details).getByRole('button', { name: '编辑资料' }));
  expect(onEdit).toHaveBeenCalledWith(product);

  fireEvent.click(screen.getAllByRole('button', { name: '查看资料' })[1]);
  const draftDetails = screen.getByRole('dialog', { name: '商品资料' });
  expect(within(draftDetails).getByText('商品资料待完善')).toBeVisible();
  expect(within(draftDetails).queryByText(/作为生成与人工审核的依据/)).not.toBeInTheDocument();
});

test('shows legacy color, specs and shared evidence in the details and keeps all photos available', () => {
  const onStart = vi.fn();
  render(
    <ProductDetails
      product={{
        ...product,
        photos: [...product.photos, { file_id: 'side', version: 1 }],
        facts: {
          color: { value: '米白', evidence: '商品确认单' },
          size: { value: '36–44 码', evidence: '商品确认单' },
          structure: { value: '低帮', evidence: '商品确认单' },
        },
      }}
      category={{ id: 'apparel', label: '鞋服', fields: [] }}
      onClose={vi.fn()}
      onStart={onStart}
    />,
  );

  expect(screen.getByText('所属品类')).toBeVisible();
  expect(screen.getByText('商品颜色')).toBeVisible();
  expect(screen.getByText('确认规格')).toBeVisible();
  expect(screen.getByText('商品确认单')).toBeVisible();
  expect(screen.getByText('应用边界')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '查看实拍 2' }));
  expect(screen.getByRole('img', { name: '低帮运动鞋实拍 2' })).toHaveAttribute(
    'src',
    expect.stringContaining('/side/'),
  );
  fireEvent.click(screen.getByRole('button', { name: '用此商品创作' }));
  expect(onStart).toHaveBeenCalledOnce();
});
