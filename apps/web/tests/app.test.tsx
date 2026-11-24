import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { App } from '../src/app/App';

const session = {
  user_id: 'person',
  email: 'studio@example.test',
  tenant: { id: 'company', slug: 'studio', name: '造物电商' },
  role: 'reviewer',
  permissions: ['view', 'review'],
  csrf_token: 'csrf-test',
};

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

test('signs in to the company and sends the session token for logout', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json(session, { status: 201 }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(Response.json({ items: [], next_cursor: null }))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('公司标识'), { target: { value: 'studio' } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: session.email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  const account = await screen.findByRole('button', { name: 'studio，审核员，账号菜单' });
  expect(screen.queryByText('退出登录')).not.toBeInTheDocument();
  expect(screen.getByText('审核员')).toBeInTheDocument();
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-Studio-Login')).toBe('1');

  fireEvent.click(account);
  await waitFor(() => expect(screen.getByText('造物电商')).toBeVisible());
  fireEvent.click(await screen.findByRole('menuitem', { name: /退出登录/ }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '登录工作台' })).toBeInTheDocument(),
  );
  const logout = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/sessions/current'));
  expect(new Headers(logout?.[1]?.headers).get('X-CSRF-Token')).toBe('csrf-test');
});

test('sidebar restores the last available creation entry for each company member', async () => {
  const creator = { ...session, role: 'designer', permissions: ['view', 'create'] };
  let member = creator;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      if (url.endsWith('/me')) return Response.json(member);
      if (url.endsWith('/tasks')) return Response.json({ items: [], next_cursor: null });
      return Response.json([]);
    }),
  );
  const sidebar = () => within(screen.getByRole('navigation', { name: '工作区' }));
  const active = (name: string) =>
    expect(sidebar().getByRole('button', { name })).toHaveAttribute(
      'aria-current',
      'page',
    );
  const first = render(<App />);
  await screen.findByRole('navigation', { name: '工作区' });
  active('快捷生成');
  fireEvent.click(sidebar().getByRole('button', { name: '批量制作' }));
  active('批量制作');
  fireEvent.click(sidebar().getByRole('button', { name: '画布' }));
  active('画布');
  first.unmount();

  member = { ...creator, user_id: 'other' };
  const second = render(<App />);
  await screen.findByRole('navigation', { name: '工作区' });
  active('快捷生成');
  second.unmount();

  member = creator;
  const restored = render(<App />);
  await screen.findByRole('navigation', { name: '工作区' });
  active('画布');
  fireEvent.click(sidebar().getByRole('button', { name: '批量制作' }));
  restored.unmount();

  member = session;
  render(<App />);
  await screen.findByRole('navigation', { name: '工作区' });
  active('快捷生成');
  expect(sidebar().getByRole('button', { name: '批量制作' })).toBeDisabled();
});
