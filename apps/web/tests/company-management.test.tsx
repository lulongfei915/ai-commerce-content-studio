import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { TemplateManager } from '../src/features/templates/TemplateManager';
import type { Session } from '../src/features/auth/session';

const session: Session = {
  role: 'admin',
  csrf_token: 'test',
  permissions: ['view', 'manage', 'create', 'review', 'adopt', 'download'],
  email: 'admin@example.test',
  user_id: 'admin',
  tenant: { id: 't', name: '本机团队演示', slug: 't' },
};

const categories = [{ id: 'apparel' as const, label: '鞋服', fields: [] }];

const template = {
  id: 'template-1',
  version: 2,
  enabled: true,
  published_version: 1,
  content: {
    name: '轻行系列 · 简约棚拍',
    category: 'apparel' as const,
    purpose: 'main' as const,
    prompt: '保持商品外观，以柔和光线完成主图。',
    parameters: {
      provider: 'ark' as const,
      model: 'seedream-5.5',
      ratio: '1:1' as const,
      resolution: '1K' as const,
      count: 2,
    },
    case_ids: [],
    check_rules: ['商品一致性必检'],
  },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderManager() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/templates?')) {
        return Response.json({ items: [template], next_cursor: null });
      }
      if (url.endsWith('/versions/1')) return Response.json(template.content);
      if (init?.method === 'POST' && url.endsWith('/publish')) {
        return Response.json({ ...template, version: 3, published_version: 2 });
      }
      return new Response(null, { status: 404 });
    }),
  );
  render(<TemplateManager categories={categories} session={session} />);
}

test('opens the template configuration details from a template card', async () => {
  renderManager();

  const card = await screen.findByRole('article');
  fireEvent.click(within(card).getByRole('button', { name: '查看配置' }));

  expect(await screen.findByRole('dialog', { name: '模板配置' })).toHaveTextContent(
    '保持商品外观，以柔和光线完成主图。',
  );
});

test('requires confirmation before publishing a template version', async () => {
  renderManager();

  const card = await screen.findByRole('article');
  fireEvent.click(within(card).getByRole('button', { name: '发布新版本' }));

  const dialog = await screen.findByRole('dialog', { name: '确认发布模板' });
  expect(dialog).toHaveTextContent('V2');
  expect(fetch).not.toHaveBeenCalledWith(expect.stringContaining('/publish'), expect.anything());

  fireEvent.click(within(dialog).getByRole('button', { name: '确认发布' }));
  await waitFor(() =>
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining('/publish'),
      expect.objectContaining({ method: 'POST' }),
    ),
  );
});
