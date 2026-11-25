import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { InspirationGallery } from '../src/features/cases/InspirationGallery';
import { CompanyResults } from '../src/features/tasks/CompanyResults';
import { TemplateManager } from '../src/features/templates/TemplateManager';
import type { Task } from '../src/features/tasks/api';
import type { Session } from '../src/features/auth/session';

const task: Task = {
  id: 'task',
  name: '商品上新',
  status: 'draft',
  version: 1,
  products: [
    {
      id: 'shoe',
      name: '帆布鞋',
      sku: 'SHOE',
      category: 'apparel',
      facts: {},
      photos: [],
      fact_version: 1,
      version: 1,
      readiness: {},
    },
  ],
  positions: [{ id: 'pos', product_id: 'shoe', purpose: 'main', status: 'unfilled' }],
};
const session: Session = {
  role: 'viewer',
  csrf_token: 'test',
  permissions: ['view'],
  email: 'viewer@example.test',
  user_id: 'viewer',
  tenant: { id: 't', name: '测试公司', slug: 't' },
};
const categories = [{ id: 'apparel' as const, label: '鞋服', fields: [] }];
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test('gallery sends a licensed company case only to the explicitly selected compatible draft', async () => {
  let write;
  let removal;
  const canvas = {
    id: 'canvas',
    product_id: 'shoe',
    purpose: 'main',
    entry: 'canvas',
    version: 7,
    references: [],
    prompt: '自然光',
  };
  const item = {
    id: 'case',
    name: '侧光测试案例',
    category: 'apparel',
    source: '工作室',
    media: 'image',
    usage_scope: '内部',
    usage_purposes: ['main'],
  };
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/cases?'))
      return Response.json({
        items: [item, { ...item, id: 'restricted', usage_scope: null }],
        next_cursor: null,
      });
    if (url.includes('/creations?'))
      return Response.json(url.includes('entry=canvas') ? [canvas] : []);
    if (url.endsWith('/canvas/references')) {
      write = JSON.parse(String(init.body));
      return Response.json({
        ...canvas,
        version: 8,
        references: [{ id: 'ref', kind: 'case', source_id: 'case', origin: 'independent' }],
      });
    }
    if (init.method === 'DELETE') {
      removal = url;
      return Response.json({ ...canvas, version: 9 });
    }
    return new Response(null, { status: 404 });
  });
  render(
    <InspirationGallery
      categories={categories}
      current={task}
      revision={0}
      token="csrf"
      canCreate
      canPlayVideo
    />,
  );
  await screen.findAllByText('侧光测试案例');
  expect(screen.getAllByRole('button', { name: '暂不可引用' })).toHaveLength(7);
  fireEvent.click(screen.getByRole('button', { name: '添加参考' }));
  await screen.findByRole('option', { name: /画布.*SHOE/ });
  fireEvent.click(screen.getByRole('button', { name: '确认添加' }));
  await screen.findByText('已添加至目标草稿');
  expect(screen.getByRole('button', { name: '已添加' })).toBeEnabled();
  expect(write).toEqual({ expected_version: 7, kind: 'case', source_id: 'case' });
  fireEvent.click(screen.getByRole('button', { name: '已添加' }));
  fireEvent.click(await screen.findByRole('button', { name: '确认移除' }));
  await screen.findByText('已从目标草稿移除');
  expect(removal).toMatch(/\/canvas\/references\/ref\?expected_version=8$/);
});

test('delivery counts a receipt only for an approved version and limits viewer actions', async () => {
  let approved = false;
  const asset = () => ({
    version_id: 'v1',
    task_id: 'task',
    creation_id: 'c',
    product_id: 'shoe',
    purpose: 'main',
    label: '白底图',
    sku: 'SHOE',
    version: 1,
    status: approved ? 'approved' : 'revoked',
    media: 'image',
    previewable: true,
    file_version: null,
  });
  vi.stubGlobal('fetch', async (url: string) => {
    if (url.includes('/adoption')) return Response.json({ version_id: 'v1', download: '/private' });
    if (url.includes('/assets?')) return Response.json([asset()]);
    if (url.endsWith('/tasks/task')) return Response.json(task);
    if (url.endsWith('/assets/v1')) return Response.json(asset());
    if (url.endsWith('/quality')) return Response.json({ decision: { reason: '已核对' } });
    return new Response(null, { status: 404 });
  });
  const renderPage = () =>
    render(<CompanyResults session={session} current={task} review={false} onReturn={() => {}} />);
  const first = renderPage();
  expect(await screen.findByText('0/1 已配齐')).toBeVisible();
  expect(screen.getByText('已撤回')).toBeVisible();
  first.unmount();
  approved = true;
  renderPage();
  expect(await screen.findByText('1/1 已配齐')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '查看版本' }));
  await screen.findByText('审核意见 · 已核对');
  expect(screen.queryByRole('button', { name: '采用至交付' })).toBeNull();
  expect(screen.queryByRole('link', { name: /^下载/ })).toBeNull();
});

test('version details withdraw the selected position when two slots share a purpose', async () => {
  const slots = ['first', 'second'].map((id) => ({ ...task.positions[0], id }));
  const current = { ...task, positions: slots };
  const asset = {
    version_id: 'v',
    task_id: task.id,
    product_id: 'shoe',
    purpose: 'main',
    label: '白底图',
    sku: 'SHOE',
    version: 1,
    status: 'approved',
    media: 'image',
    previewable: true,
  };
  let withdrawn = '';
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/adoption')) {
      if (init.method === 'DELETE') {
        withdrawn = url;
        return new Response(null, { status: 204 });
      }
      return Response.json(
        url.includes('/second/') && !withdrawn ? { version_id: 'v', download: '/v' } : null,
      );
    }
    if (url.includes('/assets?')) return Response.json([asset]);
    if (url.endsWith('/tasks/task')) return Response.json(current);
    if (url.endsWith('/assets/v')) return Response.json(asset);
    return Response.json({});
  });
  render(
    <CompanyResults
      current={current}
      session={{ ...session, permissions: ['adopt', 'view'] }}
      review={false}
      onReturn={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '查看版本' }));
  fireEvent.click(await screen.findByRole('button', { name: '撤回采用' }));
  await waitFor(() => expect(withdrawn).toMatch(/\/second\/adoption$/));
});

test('review dialog compares the result with product photos and submits a versioned decision', async () => {
  const current = {
    ...task,
    products: [{ ...task.products[0], photos: [{ file_id: 'photo', version: 1 }] }],
  };
  const asset = {
    version_id: 'v2',
    task_id: task.id,
    product_id: 'shoe',
    purpose: 'main',
    label: '白底图',
    sku: 'SHOE',
    version: 2,
    status: 'pending_review',
    media: 'image',
    previewable: true,
    file_version: 1,
  };
  const decide = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.includes('/reviews?')) return Response.json([asset]);
    if (url.endsWith('/tasks/task')) return Response.json(current);
    if (url.endsWith('/assets/v2')) return Response.json(asset);
    if (url.endsWith('/quality')) return Response.json({ quality: { summary: 'AI 初检通过' } });
    if (url.endsWith('/adoption')) return Response.json(null);
    if (url.endsWith('/assets/v2/review')) {
      decide(JSON.parse(String(init.body)));
      asset.status = 'rejected';
      return Response.json({ status: asset.status });
    }
    return new Response(null, { status: 404 });
  });
  render(
    <CompanyResults
      review
      session={{ ...session, permissions: ['view', 'review'] }}
      current={current}
      onReturn={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '开始审核' }));
  const dialog = within(screen.getByRole('dialog', { name: '素材审核' }));
  await dialog.findByText('生成结果 · V2');
  expect(await dialog.findByText('商品实拍 · SHOE')).toBeVisible();
  expect(dialog.getByRole('img', { name: '帆布鞋 · 商品实拍' })).toBeVisible();
  expect(dialog.queryByText(/AI 初检/)).not.toBeInTheDocument();
  expect(dialog.queryByText('标注图片区域')).not.toBeInTheDocument();
  const reject = await dialog.findByRole('button', { name: '驳回返工' });
  expect(reject).toBeDisabled();
  expect(dialog.getByRole('button', { name: '批准此版本' })).toBeEnabled();
  const reason = dialog.getByRole('textbox', { name: '审核意见（驳回必填）' });
  fireEvent.change(reason, { target: { value: '   ' } });
  expect(reject).toBeDisabled();
  fireEvent.change(reason, { target: { value: '主体与实拍不一致' } });
  expect(reject).toBeEnabled();
  fireEvent.click(reject);
  await waitFor(() =>
    expect(decide).toHaveBeenCalledWith({
      decision: 'rejected',
      version: 2,
      reason: '主体与实拍不一致',
      regions: [],
    }),
  );
  await dialog.findByText('已驳回');
});

test('approval closes the review dialog and moves the asset to the approved queue', async () => {
  const asset = {
    version_id: 'v2',
    task_id: task.id,
    creation_id: 'c',
    product_id: 'shoe',
    purpose: 'main',
    label: '白底图',
    sku: 'SHOE',
    version: 2,
    status: 'pending_review',
    media: 'image',
    previewable: true,
    file_version: 1,
  };
  const writes = vi.fn();
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (init.method && init.method !== 'GET') writes(url, JSON.parse(String(init.body)));
    if (url.includes('/reviews?')) return Response.json([asset]);
    if (url.endsWith('/tasks/task')) return Response.json(task);
    if (url.endsWith('/assets/v2')) return Response.json(asset);
    if (url.endsWith('/quality')) return Response.json({});
    if (url.endsWith('/adoption')) return Response.json(null);
    if (url.endsWith('/assets/v2/review')) {
      asset.status = 'approved';
      return Response.json({ status: asset.status });
    }
    return new Response(null, { status: 404 });
  });
  render(
    <CompanyResults
      review
      session={{ ...session, permissions: ['view', 'review', 'adopt'] }}
      current={task}
      onReturn={() => {}}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '开始审核' }));
  fireEvent.click(await screen.findByRole('button', { name: '批准此版本' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  expect(screen.getByText('已批准', { selector: '[role="status"]' })).toBeVisible();
  await screen.findByRole('button', { name: '待审核 0' });
  expect(screen.queryByText('白底图')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '已批准 1' }));
  expect(await screen.findByText('白底图')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '查看详情' }));
  const details = within(screen.getByRole('dialog', { name: '素材详情' }));
  expect(await details.findByText('撤回批准')).toBeVisible();
  expect(details.queryByRole('button', { name: '采用至交付' })).not.toBeInTheDocument();
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes).toHaveBeenCalledWith(expect.stringMatching(/\/assets\/v2\/review$/), {
    decision: 'approved',
    version: 2,
    reason: '',
    regions: [],
  });
});

test('delivery can adopt a compatible approved version and offers to create an empty position', async () => {
  const current: Task = {
    ...task,
    positions: [
      ...task.positions,
      { id: 'detail', product_id: 'shoe', purpose: 'detail', status: 'unfilled' },
    ],
  };
  const create = vi.fn();
  let adoption: { version_id: string; download: string } | null = null;
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/pos/adoption')) {
      if (init.method === 'PUT') {
        adoption = { version_id: JSON.parse(String(init.body)).version_id, download: '/private' };
      }
      return Response.json(adoption);
    }
    if (url.endsWith('/detail/adoption')) return Response.json(null);
    if (url.includes('/assets?')) {
      return Response.json([
        {
          version_id: 'v1',
          task_id: task.id,
          product_id: 'shoe',
          purpose: 'main',
          label: '白底图',
          sku: 'SHOE',
          version: 1,
          status: 'approved',
          media: 'image',
          previewable: true,
        },
      ]);
    }
    return new Response(null, { status: 404 });
  });
  render(
    <CompanyResults
      review={false}
      session={{ ...session, permissions: ['view', 'create', 'adopt', 'download'] }}
      current={current}
      onReturn={() => {}}
      onCreatePosition={create}
    />,
  );
  fireEvent.click(await screen.findByRole('button', { name: '制作此位置' }));
  expect(create).toHaveBeenCalledWith('detail');
  fireEvent.click(screen.getByRole('button', { name: '选择交付版本' }));
  fireEvent.click(screen.getByRole('button', { name: '确认选择' }));
  expect(await screen.findByText('1/2 已配齐')).toBeVisible();
  expect(screen.getByText('可交付', { exact: true })).toBeVisible();
  expect(screen.getByRole('link', { name: '下载交付版本' })).toHaveAttribute('href', '/private');
  fireEvent.click(screen.getByRole('checkbox', { name: /只看待补齐/ }));
  expect(screen.queryByRole('heading', { name: '商品主图' })).toBeNull();
});

test('company management can open an immutable published version from the records tab', async () => {
  vi.stubGlobal('fetch', async (url: string) =>
    url.endsWith('/company/records')
      ? Response.json([])
      : url.endsWith('/versions/1')
        ? Response.json({
            name: '标准主图',
            category: 'apparel',
            purpose: 'main',
            prompt: '已发布的提示词',
          })
        : Response.json({
            items: [
              {
                id: 'tpl',
                published_version: 1,
                enabled: true,
                version: 3,
                published_content: { name: '标准主图', category: 'apparel', purpose: 'main' },
                has_unpublished_changes: true,
                content: { name: '下一版草稿', category: 'apparel', purpose: 'main' },
              },
            ],
          }),
  );
  render(
    <TemplateManager
      categories={categories}
      session={{ ...session, role: 'admin', permissions: ['manage'] }}
    />,
  );
  await screen.findByRole('heading', { name: '标准主图' });
  expect(screen.getByText('有待发布修改')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: '操作记录' }));
  fireEvent.change(screen.getByLabelText('已发布版本'), { target: { value: '1' } });
  await waitFor(() => expect(screen.getByRole('dialog')).toHaveTextContent('已发布的提示词'));
});
