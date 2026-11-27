import { useCallback, useRef, useState } from 'react';
import type { XYPosition } from '@xyflow/react';
import { actionError, saveDraftInputs } from '../creation/api';
import type { CanvasProps } from './CanvasPage';
import type { AddKind } from './CanvasTools';

export type PanelState =
  | { kind: AddKind; position?: XYPosition }
  | { kind: 'edit' | 'preview'; id: string }
  | { kind: 'connect'; source: string; target: string };

export function useCanvasDraftPanel(
  { drafts, edits, busy, session, onBusy, onEdit, onSaved }: CanvasProps,
  onError: (message: string) => void,
) {
  const [panel, setPanel] = useState<PanelState>();
  const saving = useRef(false);
  const draft = panel?.kind === 'edit'
    ? drafts.find((item) => `creation:${item.id}` === panel.id)
    : undefined;
  const changes = draft && edits[draft.id];
  const token = session.csrf_token;

  const changePanel = useCallback(async (next?: PanelState, after?: () => void) => {
    if (saving.current) return;
    if (draft && next?.kind === 'edit' && next.id === `creation:${draft.id}`) return;
    if (draft && busy) return;
    if (draft && changes) {
      saving.current = true;
      onBusy(true);
      onError('');
      try {
        const saved = await saveDraftInputs(draft, token, changes);
        onSaved(saved);
        onEdit(draft.id, undefined);
      } catch (cause) {
        onError(`草稿保存失败。${actionError(cause)}`);
        return;
      } finally {
        saving.current = false;
        onBusy(false);
      }
    }
    setPanel(next);
    after?.();
  }, [busy, changes, draft, onBusy, onEdit, onError, onSaved, token]);

  return [panel, changePanel] as const;
}
