import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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

afterEach(() => vi.unstubAllGlobals());

test('signs in to the company and sends the session token for logout', async () => {
  const fetchMock = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(null, { status: 401 }))
    .mockResolvedValueOnce(Response.json(session, { status: 201 }))
    .mockResolvedValueOnce(Response.json([]))
    .mockResolvedValueOnce(new Response(null, { status: 204 }));
  vi.stubGlobal('fetch', fetchMock);
  render(<App />);

  expect(await screen.findByRole('heading', { name: '登录工作台' })).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('公司标识'), { target: { value: 'studio' } });
  fireEvent.change(screen.getByLabelText('邮箱'), { target: { value: session.email } });
  fireEvent.change(screen.getByLabelText('密码'), { target: { value: 'test-password' } });
  fireEvent.click(screen.getByRole('button', { name: '登录' }));
  expect(await screen.findByRole('heading', { name: '造物电商' })).toBeInTheDocument();
  expect(screen.getByText('审核员')).toBeInTheDocument();
  expect(new Headers(fetchMock.mock.calls[1][1]?.headers).get('X-Studio-Login')).toBe('1');

  fireEvent.click(screen.getByRole('button', { name: '退出登录' }));
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: '登录工作台' })).toBeInTheDocument(),
  );
  expect(new Headers(fetchMock.mock.calls[3][1]?.headers).get('X-CSRF-Token')).toBe('csrf-test');
});
