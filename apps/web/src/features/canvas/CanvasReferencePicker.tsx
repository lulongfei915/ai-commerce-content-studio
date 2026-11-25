import { NodeIndexOutlined } from '@ant-design/icons';
import { useState } from 'react';
import { Modal } from '../../shared/ui/Modal';
import { actionError, draftWrite, usageLabel, type Draft } from '../creation/api';
import { nodePreview, type Canvas } from './api';
import { allowedUsages, projectEdges, referenceIssue } from './graph';

export function CanvasReferencePicker({
  canvas,
  draft,
  busy,
  token,
  onSaved,
}: {
  canvas: Canvas;
  draft: Draft;
  busy: boolean;
  token: string;
  onSaved: (updated: Draft) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState('');
  const [usage, setUsage] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const edges = open ? projectEdges(canvas) : [];
  const choices = open
    ? canvas.nodes.filter((node) => node.kind !== 'creation' && !referenceIssue(node, draft, edges))
    : [];
  const source = choices.find((item) => item.id === selected);
  const usages = source ? allowedUsages(source, draft) : [];
  async function attach() {
    if (!source || saving) return;
    setSaving(true);
    setError('');
    try {
      const updated = await draftWrite(draft, token, '/references', {
        kind: source.kind,
        source_id: source.source_id,
        usage: usage || usages[0],
        file_version: source.file_version,
        source_version: source.source_version,
      });
      await onSaved(updated);
      setOpen(false);
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={busy}
        onClick={() => {
          setSelected('');
          setUsage('');
          setError('');
          setOpen(true);
        }}
      >
        <NodeIndexOutlined /> 画布参考
      </button>
      {open && (
        <Modal title="画布参考" onClose={() => setOpen(false)} busy={saving}>
          {!choices.length && <p>当前画布没有可添加到此节点的参考素材。</p>}
          <div className="canvas-photo-picker">
            {choices.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={selected === item.id}
                disabled={saving}
                onClick={() => {
                  setSelected(item.id);
                  setUsage('');
                }}
              >
                {item.previewable && item.file_version && (
                  <img
                    loading="lazy"
                    alt=""
                    src={nodePreview(
                      draft.task_id,
                      item.id,
                      item.file_version,
                      item.source_version ?? undefined,
                    )}
                  />
                )}
                {item.label} · V{item.file_version}
              </button>
            ))}
          </div>
          {source && (
            <label>
              引用用途{' '}
              <select
                disabled={saving}
                value={usage || usages[0]}
                onChange={(event) => setUsage(event.target.value)}
              >
                {usages.map((item) => (
                  <option key={item} value={item}>
                    {usageLabel[item]}
                  </option>
                ))}
              </select>
            </label>
          )}
          {error && (
            <p role="alert" className="work-error">
              {error}
            </p>
          )}
          {!!choices.length && (
            <footer className="work-actions">
              <button
                type="button"
                className="work-primary"
                disabled={!source || saving}
                onClick={() => void attach()}
              >
                添加参考
              </button>
            </footer>
          )}
        </Modal>
      )}
    </>
  );
}
