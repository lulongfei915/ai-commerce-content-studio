import { useEffect, useState } from 'react';

import { ApiError } from '../../shared/api/client';
import { LoginForm } from './LoginForm';
import { getSession, roleLabel, signIn, signOut } from './session';
import type { Credentials, Session } from './session';

export function SessionGate() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void getSession(controller.signal).then((current) => {
      if (!controller.signal.aborted) setSession(current);
    }).catch((cause: unknown) => {
      if (!controller.signal.aborted && !(cause instanceof ApiError && cause.status === 401)) {
        setError('暂时无法连接工作台，请重试。');
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, []);

  async function login(credentials: Credentials) {
    setError(null);
    setBusy(true);
    try {
      setSession(await signIn(credentials));
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 429) setError('尝试次数过多，请稍后重试。');
      else if (cause instanceof ApiError && (cause.status === 401 || cause.status === 422)) {
        setError('请检查公司标识、邮箱、密码和动态验证码。');
      } else setError('登录暂未成功，请稍后重试。');
    } finally {
      setBusy(false);
    }
  }

  async function logout(current: Session) {
    setBusy(true);
    setError(null);
    try {
      await signOut(current);
      setSession(null);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 401) setSession(null);
      else setError('退出未完成，请重试。');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p role="status">正在检查登录状态…</p>;
  if (!session) return <LoginForm busy={busy} error={error} onSubmit={(value) => { void login(value); }} />;
  return (
    <section className="auth-card">
      <h1>{session.tenant.name}</h1>
      <dl className="auth-identity">
        <div><dt>账号</dt><dd>{session.email}</dd></div>
        <div><dt>角色</dt><dd>{roleLabel[session.role]}</dd></div>
        <div><dt>原件下载</dt><dd>{session.permissions.includes('download') ? '已授权' : '未授权'}</dd></div>
      </dl>
      {error && <p className="auth-error" role="alert">{error}</p>}
      <button className="auth-primary" type="button" disabled={busy} onClick={() => { void logout(session); }}>退出登录</button>
    </section>
  );
}
