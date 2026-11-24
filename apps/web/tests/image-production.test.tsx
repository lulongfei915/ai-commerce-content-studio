import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ImageProduction } from '../src/features/creation/ImageProduction';
import { QuickCreation } from '../src/features/creation/QuickCreation';
import { defaults, type Draft } from '../src/features/creation/api';
import type { Product } from '../src/features/products/api';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('selecting a prompt card previews it without starting a model call', async () => {
  const fetch = vi.fn(
    async (path: string) =>
      new Response(
        JSON.stringify(
          path.endsWith('/prompt-cards')
            ? [{ id: 'one', title: '棚拍', version: 1, prompt: '白底实拍' }]
            : [],
        ),
      ),
  );
  vi.stubGlobal('fetch', fetch);
  const onPrompt = vi.fn();
  const draft = { id: 'draft-one', task_id: 'task-one', version: 1, prompt: '' } as Draft;
  render(
    <ImageProduction
      draft={draft}
      token="test"
      disabled={false}
      onSaved={vi.fn()}
      onPrompt={onPrompt}
    />,
  );
  await screen.findByRole('option', { name: '棚拍 · V1' });
  fireEvent.change(screen.getByRole('combobox', { name: '快捷词卡片' }), {
    target: { value: 'one' },
  });
  expect(screen.getByText('白底实拍')).toBeVisible();
  expect(onPrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: '替换正文' }));
  expect(onPrompt).toHaveBeenCalledWith('白底实拍');
  fireEvent.click(screen.getByRole('button', { name: '优化提示词' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('请先填写并保存提示词');
  expect(fetch).toHaveBeenCalledTimes(3);
});

test('quick generation saves edits before submitting and retries with the same request key', async () => {
  const product: Product = {
    id: 'sku-1',
    sku: 'TEST-SHOE',
    name: '测试鞋',
    category: 'apparel',
    version: 1,
    fact_version: 1,
    facts: {},
    photos: [],
    readiness: {},
  };
  const draft: Draft = {
    id: 'draft-one',
    task_id: 'task-one',
    version: 1,
    prompt: '',
    references: [],
    product_id: product.id,
    purpose: 'main',
    entry: 'quick',
    slot: 'primary',
    parameters: defaults,
    template_id: null,
    template_version: null,
    video_parameters: null,
  };
  const writes: { method?: string; body: Record<string, unknown> }[] = [];
  vi.stubGlobal('fetch', async (_path: string, init: RequestInit) => {
    if (init.method === 'PATCH' || init.method === 'POST') {
      writes.push({ method: init.method, body: JSON.parse(String(init.body)) });
      if (init.method === 'PATCH')
        return Response.json({ ...draft, prompt: '柔和侧光', version: 2 });
      if (writes.length === 2) throw new TypeError('提交响应丢失');
      return Response.json({ id: 'job-one', outputs: [{ id: 'output-one', status: 'queued' }] });
    }
    return Response.json([]);
  });
  const props = {
    product,
    purpose: 'main' as const,
    editorId: draft.id,
    categories: [],
    token: 'test',
    busy: false,
    loading: false,
    onCreate: async () => draft,
    onEdit: vi.fn(),
    onBusy: vi.fn(),
    onSaved: vi.fn(),
  };
  const edits = { prompt: '柔和侧光', parameters: defaults };
  const page = render(<QuickCreation {...props} edits={edits} />);
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('提交响应丢失');
  expect(writes[0]).toEqual({ method: 'PATCH', body: { ...edits, expected_version: 1 } });
  expect(writes[1]).toEqual({
    method: 'POST',
    body: { expected_version: 2, idempotency_key: expect.any(String) },
  });
  const updated = props.onSaved.mock.calls[0][0] as Draft;
  page.rerender(<QuickCreation {...props} selected={updated} />);
  expect(screen.getByRole('alert').closest('.studio-composer')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '优化提示词' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('解析参考图')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(await screen.findByRole('button', { name: '取消排队' })).toBeVisible();
  expect(writes.slice(2)).toEqual([writes[1]]);
  expect(screen.getByRole('button', { name: '制作中' })).toBeDisabled();
});
