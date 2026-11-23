import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';

import { LoginForm } from '../src/features/auth/LoginForm';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

test.each([
  { dev: true, configured: true },
  { dev: true, configured: false },
  { dev: false, configured: true },
])('prefills login only in configured development (dev=$dev, configured=$configured)', ({ dev, configured }) => {
  vi.stubEnv('DEV', dev);
  const fields = [
    ['公司标识', 'VITE_STUDIO_DEMO_COMPANY', 'demo-studio'],
    ['邮箱', 'VITE_STUDIO_DEMO_EMAIL', 'demo@example.test'],
    ['密码', 'VITE_STUDIO_DEMO_PASSWORD', 'demo-password'],
  ] as const;
  for (const [, variable, value] of fields) {
    vi.stubEnv(variable, configured ? value : undefined);
  }

  render(<LoginForm busy={false} error={null} onSubmit={vi.fn()} />);

  for (const [label, , value] of fields) {
    expect(screen.getByLabelText(label)).toHaveValue(dev && configured ? value : '');
  }
});
