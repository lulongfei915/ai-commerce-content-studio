import type { ComponentProps } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ImageProduction } from '../src/features/creation/ImageProduction';
import { QuickCreation } from '../src/features/creation/QuickCreation';
import { defaults, type Draft } from '../src/features/creation/api';
import type { TaskResult } from '../src/features/creation/results';
import { useImageExecution } from '../src/features/creation/useImageExecution';
import type { Product } from '../src/features/products/api';
import { StudioResults } from '../src/features/tasks/StudioResults';
import { TaskStudio } from '../src/features/tasks/TaskStudio';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

function QuickEditorFixture(
  props: Omit<ComponentProps<typeof QuickCreation>, 'execution' | 'onSubmitting'>,
) {
  const execution = useImageExecution(props.selected, props.token);
  return (
    <>
      <QuickCreation {...props} execution={execution} onSubmitting={vi.fn()} />
      <StudioResults results={[]} taskId="task-one" imageExecution={execution} />
    </>
  );
}

test('quick generation reserves result slots before submission and replaces them in place', async () => {
  const product: Product = {
    id: 'sku',
    sku: 'TEST',
    name: '帆布鞋',
    category: 'apparel',
    version: 1,
    fact_version: 1,
    facts: {},
    photos: [],
    readiness: {},
  };
  const draft: Draft = {
    id: 'draft',
    task_id: 'task',
    version: 1,
    prompt: '自然光',
    references: [],
    product_id: product.id,
    purpose: 'main',
    entry: 'quick',
    slot: 'primary',
    parameters: { ...defaults, count: 2 },
    template_id: null,
    template_version: null,
    video_parameters: null,
  };
  const previous: TaskResult = {
    sku: product.sku,
    task_id: 'task',
    product_id: product.id,
    creation_id: draft.id,
    execution_id: 'old',
    version_id: 'older',
    asset_id: 'asset-old',
    version: 1,
    purpose: 'main',
    label: 'older.png',
    media: 'image',
    status: 'approved',
    file_id: 'old-file',
    file_version: 1,
    previewable: true,
    referenceable: true,
  };
  const result = {
    ...previous,
    version_id: 'out-1',
    execution_id: 'job',
    asset_id: 'asset-new',
    label: 'new.png',
    status: 'pending_review',
  };
  const submission = deferredResponse();
  const refreshed = deferredResponse();
  let resultReads = 0;
  vi.stubGlobal('fetch', async (path: string, init?: RequestInit) => {
    if (path.endsWith('/results') && ++resultReads > 1) return refreshed.promise;
    if (path.endsWith('/results')) return Response.json([previous]);
    if (path.includes('/creations?')) return Response.json([draft]);
    if (path.endsWith('/creations/draft/executions'))
      return init?.method === 'POST' ? submission.promise : Response.json([]);
    if (path.endsWith('/executions/job'))
      return Response.json({
        id: 'job',
        outputs: [
          { id: 'out-1', status: 'pending_review' },
          { id: 'out-2', status: 'generation_failed' },
        ],
      });
    return new Response(null, { status: 404 });
  });
  render(
    <TaskStudio
      session={{
        csrf_token: 'test',
        permissions: ['view', 'create'],
        role: 'admin',
        user_id: 'user',
        email: 'creator@example.test',
        tenant: { id: 'company', name: '测试公司', slug: 'company' },
      }}
      task={{
        id: 'task',
        name: '测试',
        version: 1,
        status: 'draft',
        products: [product],
        positions: [{ id: 'pos', product_id: product.id, purpose: 'main', status: 'unfilled' }],
      }}
      entry="quick"
      categories={[]}
      onDirty={vi.fn()}
      onBack={vi.fn()}
      onNew={vi.fn()}
      onProductSaved={vi.fn()}
    >
      <div />
    </TaskStudio>,
  );
  const gallery = await screen.findByRole('region', { name: '创作结果' });
  const cards = () => within(gallery).getAllByRole('article');
  fireEvent.click(await screen.findByRole('button', { name: '生成图片' }));
  expect(cards()).toHaveLength(3);
  expect(cards()[0]).toHaveTextContent('提交中');
  expect(cards()[1]).toHaveTextContent('提交中');
  expect(cards()[2]).toHaveTextContent('older.png');
  submission.resolve(
    Response.json({
      id: 'job',
      outputs: [
        { id: 'out-1', status: 'generating' },
        { id: 'out-2', status: 'queued' },
      ],
    }),
  );
  await within(gallery).findByText('生成中');
  expect(within(cards()[1]).getByRole('button', { name: '取消排队' })).toBeVisible();
  const firstCard = cards()[0];
  await within(gallery).findByText('载入图片中', {}, { timeout: 3500 });
  expect(cards()[0]).toBe(firstCard);
  expect(within(cards()[1]).getByRole('button', { name: '重试该步骤' })).toBeEnabled();
  refreshed.resolve(Response.json([previous, result]));
  expect(await within(cards()[0]).findByRole('img', { name: 'new.png' })).toBeVisible();
  expect(cards()).toHaveLength(3);
  expect(cards()[0]).toBe(firstCard);
  expect(cards()[2]).toHaveTextContent('older.png');
}, 6000);

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
    onProductSaved: vi.fn(),
  };
  const edits = { prompt: '柔和侧光', parameters: defaults };
  const page = render(<QuickEditorFixture {...props} edits={edits} />);
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('提交响应丢失');
  expect(writes[0]).toEqual({ method: 'PATCH', body: { ...edits, expected_version: 1 } });
  expect(writes[1]).toEqual({
    method: 'POST',
    body: { expected_version: 2, idempotency_key: expect.any(String) },
  });
  const updated = props.onSaved.mock.calls[0][0] as Draft;
  page.rerender(<QuickEditorFixture {...props} selected={updated} />);
  expect(screen.getByRole('alert').closest('.studio-composer')).not.toBeNull();
  expect(screen.queryByRole('button', { name: '优化提示词' })).not.toBeInTheDocument();
  expect(screen.queryByLabelText('解析参考图')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '生成图片' }));
  expect(await screen.findByRole('button', { name: '取消排队' })).toBeVisible();
  expect(writes.slice(2)).toEqual([writes[1]]);
  expect(screen.getByRole('button', { name: '制作中' })).toBeDisabled();
});

test('quick image materials show selected product photos and allow removing them', async () => {
  const product = {
    id: 'sku-1',
    sku: 'SHOE',
    name: '帆布鞋',
    category: 'apparel',
    version: 1,
    fact_version: 1,
    facts: {},
    readiness: {},
    photos: [
      { file_id: 'front', version: 2 },
      { file_id: 'side', version: 1 },
    ],
  } satisfies Product;
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
  const selected: Draft = {
    ...draft,
    version: 2,
    references: [
      {
        id: 'ref-front',
        kind: 'upload',
        usage: 'product',
        origin: 'independent',
        source_id: 'front',
        file_id: 'front',
        file_version: 2,
        source_version: 2,
        label: 'front.png',
        media: 'image',
      },
    ],
  };
  const fetch = vi.fn(async (_url: string, req?: RequestInit) => {
    if (req?.method === 'POST') return Response.json(selected);
    if (req?.method === 'DELETE') return Response.json({ ...draft, version: 3 });
    return Response.json([]);
  });
  vi.stubGlobal('fetch', fetch);
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
    onProductSaved: vi.fn(),
  };
  const page = render(<QuickEditorFixture {...props} selected={draft} />);
  expect(screen.queryByRole('list', { name: '本次生成素材' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '添加素材' }));
  const dialog = screen.getByRole('dialog', { name: '添加素材' });
  fireEvent.click(within(dialog).getByRole('button', { name: '参考图' }));
  expect(within(dialog).getByLabelText('上传参考图')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: '商品实拍' }));
  fireEvent.click(within(dialog).getByRole('button', { name: '添加实拍 1' }));
  await vi.waitFor(() => expect(props.onSaved).toHaveBeenCalledWith(selected));
  const add = fetch.mock.calls.find(([, req]) => req?.method === 'POST');
  expect(JSON.parse(String(add?.[1]?.body))).toEqual({
    expected_version: 1,
    kind: 'upload',
    usage: 'product',
    source_id: 'front',
    file_version: 2,
  });
  page.rerender(<QuickEditorFixture {...props} selected={selected} />);
  const materials = screen.getByRole('list', { name: '本次生成素材' });
  expect(within(materials).getByText('商品实拍')).toBeVisible();
  expect(within(materials).getByRole('img', { name: 'front.png' })).toBeVisible();
  fireEvent.click(within(materials).getByRole('button', { name: '移除 front.png' }));
  await vi.waitFor(() => expect(props.onSaved).toHaveBeenLastCalledWith({ ...draft, version: 3 }));

  const updated = {
    ...product,
    version: 2,
    fact_version: 2,
    photos: [...product.photos, { file_id: 'new-photo', version: 1 }],
  };
  fetch.mockImplementation(async (url, req) => {
    if (url.endsWith('/files/uploads')) {
      return Response.json({ id: 'new-photo', upload_path: '/upload-new-photo' });
    }
    if (req?.method === 'PUT') return new Response(null, { status: 204 });
    if (url.endsWith('/complete')) return Response.json({ id: 'new-photo' });
    if (url.endsWith('/facts')) return Response.json(updated);
    if (url.endsWith('/references')) return Response.json(selected);
    return Response.json([]);
  });
  page.rerender(<QuickEditorFixture {...props} selected={{ ...draft, version: 3 }} />);
  fireEvent.click(screen.getByRole('button', { name: '添加素材' }));
  fireEvent.change(screen.getByLabelText('上传并绑定商品实拍'), {
    target: { files: [new File(['xyz'], 'new.png', { type: 'image/png' })] },
  });
  await vi.waitFor(() => expect(props.onProductSaved).toHaveBeenCalledWith(updated));
  await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  const facts = fetch.mock.calls.find(([url]) => url.endsWith('/facts'));
  expect(JSON.parse(String(facts?.[1]?.body))).toEqual({
    expected_version: 1,
    photo_ids: ['front', 'side', 'new-photo'],
  });
  const attach = fetch.mock.calls.filter(([url]) => url.endsWith('/references')).at(-1);
  expect(JSON.parse(String(attach?.[1]?.body))).toMatchObject({
    expected_version: 3,
    source_id: 'new-photo',
    usage: 'product',
    file_version: 1,
  });
});
