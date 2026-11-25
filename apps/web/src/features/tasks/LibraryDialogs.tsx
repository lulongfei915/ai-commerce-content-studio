import { useEffect, useState } from 'react';
import { apiFetch, apiWrite } from '../../shared/api/client';
import type { components } from '../../shared/api/generated';
import { Modal } from '../../shared/ui/Modal';
import { actionError, draftWrite, type Draft } from '../creation/api';
import { resultPreview, type TaskResult } from '../creation/results';
import { statusLabel } from '../canvas/status';
import { purposeLabel, type Task } from './api';

function useLibraryData<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const ctl = new AbortController();
    setData(undefined);
    setError('');
    void apiFetch<T>(path, { signal: ctl.signal })
      .then((value) => {
        if (!ctl.signal.aborted) setData(value);
      })
      .catch((e) => {
        if (!ctl.signal.aborted) setError(actionError(e));
      });
    return () => ctl.abort();
  }, [path, attempt]);
  return { data, error, retry: () => setAttempt((n) => n + 1) };
}

export function LibrarySource({
  item,
  canUse,
  canPlay,
  close,
  reference,
}: {
  item: TaskResult;
  canUse: boolean;
  canPlay: boolean;
  close: () => void;
  reference: () => void;
}) {
  const { data, error, retry } = useLibraryData<components['schemas']['SourceDetails']>(
    `/assets/${item.version_id}/source`,
  );
  const preview =
    item.previewable && item.file_version
      ? resultPreview(item.task_id, item.version_id, item.file_version, item.version)
      : undefined;
  return (
    <Modal title="公司素材 · 来源与版本" className="library-dialog" onClose={close}>
      <div className="library-dialog-body">
        {preview &&
          (item.media === 'image' ? (
            <img
              className="library-source-preview"
              src={preview + '&detailed=true'}
              alt={item.label}
            />
          ) : (
            canPlay && <video className="library-source-preview" controls src={preview} />
          ))}
        {error ? (
          <p role="alert">
            {error} <button onClick={retry}>重试</button>
          </p>
        ) : !data ? (
          <p role="status">正在读取来源…</p>
        ) : (
          <dl>
            {Object.entries({
              素材: `${item.label} · V${item.version}`,
              来源任务: data.task,
              商品: data.product,
              创建人: data.creator ?? '历史成员未记录',
              模板版本: data.template,
              输入依据: data.evidence,
              审核状态: data.referenceable
                ? '已批准，可作为表达参考'
                : `${statusLabel[data.status] ?? data.status}，当前不可引用`,
              使用范围: '商品成品限同 SKU 引用，新输出须重新审核。',
            }).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <footer>
        <button onClick={close}>关闭</button>
        <button
          className="work-primary"
          disabled={!canUse || !data?.referenceable}
          onClick={reference}
        >
          引用至制作
        </button>
      </footer>
    </Modal>
  );
}

export function LibraryReference({
  item,
  task,
  token,
  close,
  saved,
}: {
  item: TaskResult;
  task: Task;
  token: string;
  close: () => void;
  saved: (draft: Draft, updatedTask?: Task) => void;
}) {
  const { data, error, retry } = useLibraryData<Draft[]>(
    `/assets/${item.version_id}/reference-targets?task_id=${encodeURIComponent(task.id)}`,
  );
  const [id, setId] = useState('');
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState('');
  const [requestId] = useState(() => crypto.randomUUID());
  const needsProduct = !task.products.some((product) => product.id === item.product_id);
  const canCreate = data?.length === 0 && !!item.file_version;
  const target = data?.find((d) => d.id === id) ?? data?.[0];
  async function confirm() {
    if ((!target && !canCreate) || busy) return;
    setBusy(true);
    setFailure('');
    try {
      if (!target) {
        const result = await apiWrite<components['schemas']['ReferencedDraft']>(
          `/assets/${item.version_id}/reference-draft`, token, {
            task_id: task.id, request_id: requestId, expected_version: task.version,
            source_version: item.version, file_version: item.file_version, add_product: needsProduct,
          },
        );
        saved(result.draft, result.task);
        return;
      }
      saved(
        await draftWrite(target, token, '/references', {
          kind: 'result',
          source_id: item.version_id,
          file_version: item.file_version,
          source_version: item.version,
          company_library: true,
        }),
      );
    } catch (e) {
      setFailure(actionError(e));
      retry();
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="引用到当前制作" className="library-dialog" busy={busy} onClose={close}>
      <div className="library-dialog-body work-form">
        <p>
          来源：{item.task_name ?? item.task_id} · V{item.version}
          <br />
          目标任务：{task.name}。仅列出同 SKU、媒体兼容的可编辑草稿。
        </p>
        {target ? (
          <label>
            引用至
            <select disabled={busy} value={target.id} onChange={(e) => setId(e.target.value)}>
              {data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {{ quick: '快捷生成', canvas: '画布节点', batch: '批量项' }[d.entry ?? 'quick']} ·{' '}
                  {item.sku} · {purposeLabel[d.purpose]} · {d.prompt?.slice(0, 24) || d.id}
                </option>
              ))}
            </select>
          </label>
        ) : error ? (
          <p role="alert">
            {error} <button onClick={retry}>重试</button>
          </p>
        ) : (
          <p>
            {data
              ? `当前任务没有可引用的草稿。${needsProduct ? `确认后将商品 ${item.sku} 加入当前任务，按现有交付要求添加位置，并` : `可为 ${item.sku} `}新建快捷草稿，将本素材作为表达参考。`
              : '正在读取制作目标…'}
          </p>
        )}
        <p>引用保留来源和版本，新输出独立审核和采用。批量项将替换已有的独立表达参考。</p>
        {failure && <p role="alert">{failure}</p>}
      </div>
      <footer>
        <button disabled={busy} onClick={close}>
          取消
        </button>
        <button className="work-primary" disabled={(!target && !canCreate) || busy} onClick={() => void confirm()}>
          {busy ? '正在引用…' : canCreate ? (needsProduct ? '添加商品并新建草稿引用' : '新建草稿并引用') : '确认引用'}
        </button>
      </footer>
    </Modal>
  );
}
