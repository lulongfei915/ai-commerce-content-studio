import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { ProductEditor } from '../src/features/products/ProductEditor';
import type { Category, Product } from '../src/features/products/api';

const categories: Category[] = [
  {
    id: 'apparel',
    label: '鞋服',
    fields: [
      { key: 'color', label: '颜色', required_for: ['main'] },
      { key: 'material', label: '材质', required_for: [] },
    ],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('saves the single specification field after one confirmation', async () => {
  const onSave = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ id: 'shoe' }));
  vi.stubGlobal('fetch', request);
  render(<ProductEditor categories={categories} token="test" onClose={vi.fn()} onSave={onSave} />);

  fireEvent.change(screen.getByLabelText('商品名称'), { target: { value: '运动鞋' } });
  fireEvent.change(screen.getByLabelText('SKU 编码'), { target: { value: 'SHOE-01' } });
  fireEvent.change(screen.getByLabelText('颜色 / 规格等已知信息'), {
    target: { value: '米白色、低帮、36–44 码' },
  });
  expect(screen.queryByLabelText('颜色的确认依据')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '保存商品' }));
  expect(screen.getByRole('alert')).toHaveTextContent('请核对并确认');
  expect(request).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存商品' }));
  await vi.waitFor(() => expect(onSave).toHaveBeenCalledWith({ id: 'shoe' }, false));
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).facts).toEqual({
    specification: { value: '米白色、低帮、36–44 码', evidence: '录入人已核对商品信息' },
  });
});

test('keeps legacy fact values and sources when the displayed specification is unedited', async () => {
  const product: Product = {
    id: 'shoe',
    sku: 'SHOE-01',
    name: '运动鞋',
    category: 'apparel',
    version: 1,
    fact_version: 1,
    facts: { color: { value: '米白色', evidence: '鞋盒标签' } },
    photos: [],
    readiness: {},
  };
  const onSave = vi.fn();
  const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(product));
  vi.stubGlobal('fetch', request);
  render(
    <ProductEditor
      categories={categories}
      product={product}
      token="test"
      onClose={vi.fn()}
      onSave={onSave}
    />,
  );

  expect(screen.getByLabelText('颜色 / 规格等已知信息')).toHaveValue('颜色：米白色');
  expect(screen.queryByLabelText('颜色的确认依据')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('checkbox', { name: /我已核对/ }));
  fireEvent.click(screen.getByRole('button', { name: '保存商品' }));
  await vi.waitFor(() => expect(onSave).toHaveBeenCalled());
  expect(JSON.parse(String(request.mock.calls[0][1]?.body)).facts).toEqual(product.facts);
});
