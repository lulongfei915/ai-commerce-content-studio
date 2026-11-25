import { useEffect, useState } from 'react';
import { apiDelete, apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { Modal } from '../../shared/ui/Modal';
import { roleLabel, type Session } from '../auth/session';
import { actionError } from '../creation/api';

type Member = components['schemas']['MemberView'];
type RecordView = components['schemas']['RecordView'];

function useTeamList<T>(path: string) {
  const [items, setItems] = useState<T[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setLoading(true);
    setError('');
    void apiFetch<T[]>(path, { signal: ctl.signal })
      .then((rows) => {
        if (!ctl.signal.aborted) setItems(rows);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      })
      .finally(() => {
        if (!ctl.signal.aborted) setLoading(false);
      });
    return () => ctl.abort();
  }, [path, revision]);
  return { items, error, loading, reload: () => setRevision((n) => n + 1) };
}

export function CompanyRecords() {
  const { items, error, loading, reload } = useTeamList<RecordView>('/company/records');
  if (error)
    return (
      <p role="alert">
        {error} <button onClick={reload}>重试</button>
      </p>
    );
  if (loading) return <p role="status">正在读取操作记录…</p>;
  return (
    <div className="company-rows">
      {!items.length && <p>暂无操作记录</p>}
      {items.map((r) => (
        <article key={r.id}>
          <div>
            <strong>{r.action}</strong>
            <p>
              {r.actor} · {r.detail}
            </p>
          </div>
          <time>{new Date(`${r.created_at}Z`).toLocaleString('zh-CN')}</time>
        </article>
      ))}
    </div>
  );
}

export function CompanyTeam({ session }: { session: Session }) {
  const { items, loading, error, reload } = useTeamList<Member>('/company/members');
  const [member, setMember] = useState<Member>();
  const [role, setRole] = useState<Session['role']>('viewer');
  const [download, setDownload] = useState(false);
  const [mode, setMode] = useState<'edit' | 'disable' | 'identity'>();
  const [successor, setSuccessor] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const recipients = items.filter(
    (m) => m.id !== member?.id && m.active && ['admin', 'designer'].includes(m.role),
  );
  function open(m: Member, next: 'edit' | 'disable') {
    setMember(m);
    setMode(next);
    setRole(m.role);
    setDownload(m.download_allowed);
    setSuccessor('');
    setFailure('');
  }
  async function save() {
    setBusy(true);
    setFailure('');
    try {
      if (mode === 'identity') {
        await apiDelete('/sessions/current', session.csrf_token);
        window.location.reload();
        return;
      }
      if (!member) return;
      const path = `/company/members/${member.id}`;
      if (mode === 'edit') {
        await apiWrite(
          path,
          session.csrf_token,
          { role, download_allowed: download, expected_version: member.version },
          'PATCH',
        );
      } else {
        await apiWrite(`${path}/disable`, session.csrf_token, {
          expected_version: member.version,
          successor,
        });
      }
      if (member.id === session.user_id) window.location.reload();
      setMode(undefined);
      reload();
    } catch (e) {
      setFailure(actionError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <header className="company-team-heading">
        <div>
          <h3>成员与权限</h3>
          <p>任务和商品可以交接，历史创建与审核身份保留。</p>
        </div>
        <button
          onClick={() => {
            setFailure('');
            setMode('identity');
          }}
        >
          切换登录账号
        </button>
      </header>
      {loading && <p role="status">正在读取成员…</p>}
      {error && (
        <p role="alert">
          {error} <button onClick={reload}>重试</button>
        </p>
      )}
      <div className="company-rows">
        {items.map((m) => (
          <article key={m.id}>
            <div>
              <strong>{m.email}</strong>
              {m.id === session.user_id && <small> · 当前成员</small>}
              <p>
                {roleLabel[m.role]} · {m.active ? '有效' : '已停用'} ·{' '}
                {m.role !== 'viewer' && m.download_allowed ? '允许下载' : '不可下载'}
              </p>
            </div>
            <small>{m.tasks} 个负责任务</small>
            <div className="work-actions">
              <button disabled={!m.active} onClick={() => open(m, 'edit')}>
                权限
              </button>
              <button
                disabled={!m.active || m.id === session.user_id}
                onClick={() => open(m, 'disable')}
              >
                停用并交接
              </button>
            </div>
          </article>
        ))}
      </div>
      {mode && (
        <Modal
          title={
            mode === 'identity' ? '切换登录账号' : mode === 'edit' ? '成员权限' : '停用成员并交接'
          }
          busy={busy}
          onClose={() => setMode(undefined)}
        >
          <div className="work-form">
            {mode === 'identity' ? (
              <p>退出 {session.email} 后，使用其他账号登录。</p>
            ) : (
              <strong>{member?.email}</strong>
            )}
            {mode === 'edit' && (
              <>
                <label>
                  角色
                  <select value={role} onChange={(e) => setRole(e.target.value as Session['role'])}>
                    {Object.entries(roleLabel).map(([id, label]) => (
                      <option key={id} value={id}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="work-check">
                  <input
                    type="checkbox"
                    checked={download}
                    onChange={(e) => setDownload(e.target.checked)}
                  />
                  允许下载（仍受角色限制）
                </label>
              </>
            )}
            {mode === 'disable' && (
              <>
                <label>
                  接手人
                  <select value={successor} onChange={(e) => setSuccessor(e.target.value)}>
                    <option value="">请选择有效接手人</option>
                    {recipients.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.email} · {roleLabel[m.role]}
                      </option>
                    ))}
                  </select>
                </label>
                <p>确认后移交该成员负责的任务和商品，并终止其公司会话。</p>
              </>
            )}
            {failure && <p role="alert">{failure}</p>}
            <div className="work-actions">
              <button disabled={busy} onClick={() => setMode(undefined)}>
                取消
              </button>
              <button
                className="work-primary"
                disabled={busy || (mode === 'disable' && !successor)}
                onClick={() => void save()}
              >
                {mode === 'identity'
                  ? '退出并登录'
                  : mode === 'edit'
                    ? '保存权限'
                    : '确认停用并交接'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
