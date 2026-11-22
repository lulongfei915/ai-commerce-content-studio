import type { FormEvent } from 'react';

import type { Credentials } from './session';

export function LoginForm({ busy, error, onSubmit }: {
  busy: boolean;
  error: string | null;
  onSubmit: (credentials: Credentials) => void;
}) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const otp = String(data.get('otp') ?? '').trim();
    onSubmit({
      tenant_slug: String(data.get('company') ?? '').trim(),
      email: String(data.get('email') ?? '').trim(),
      password: String(data.get('password') ?? ''),
      otp: otp || undefined,
    });
  }

  return (
    <section className="auth-card" aria-labelledby="login-title">
      <h1 id="login-title">登录工作台</h1>
      <form onSubmit={submit}>
        <label>公司标识<input name="company" type="text" maxLength={64} required autoCapitalize="none" /></label>
        <label>邮箱<input name="email" type="email" maxLength={254} autoComplete="username" required /></label>
        <label>密码<input name="password" type="password" maxLength={256} autoComplete="current-password" required /></label>
        <details>
          <summary>使用动态验证码</summary>
          <label>动态验证码<input name="otp" inputMode="numeric" autoComplete="one-time-code" maxLength={6} /></label>
        </details>
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-primary" disabled={busy} type="submit">{busy ? '登录中…' : '登录'}</button>
      </form>
    </section>
  );
}
