import { FileImageOutlined, VideoCameraOutlined } from '@ant-design/icons';
import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { actionError, type Draft, type Reference } from './api';
import './canvas-prompt.css';

type Material = {
  id: string;
  media: string;
  label: string;
  preview?: string;
};
export type CanvasMentionMaterial = Material & {
  attach: () => Promise<{ updated: Draft; ref: Reference }>;
};

type Choice = Material & { reference?: Reference; attach?: CanvasMentionMaterial['attach'] };
type Mention = { start: number; end: number; query: string };

function mentionAt(field: HTMLTextAreaElement): Mention | undefined {
  const end = field.selectionStart;
  if (end !== field.selectionEnd) return;
  const match = /[@＠]([^\s@＠[\]，。！？、；：,!?;:]*)$/.exec(field.value.slice(0, end));
  if (match) return { start: match.index, end, query: match[1] };
}

const promptLimit = 6000;
const referenceTag = (id: string) => `[[ref:${id}]]`;

type PromptFieldProps = {
  text: RefObject<HTMLTextAreaElement>;
  prompt: string;
  busy: boolean;
  onChange: (prompt: string) => void;
};

export function DraftPromptField({ text, prompt, busy, onChange }: PromptFieldProps) {
  return (
    <label className="work-form creative-prompt">
      提示词
      <textarea
        aria-label="提示词"
        ref={text}
        rows={5}
        maxLength={promptLimit}
        value={prompt}
        disabled={busy}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    </label>
  );
}

export function CanvasPromptField({
  text, prompt, video, busy, references, materials, preview, onChange, onAttach,
}: PromptFieldProps & {
  video: boolean;
  references: Reference[];
  materials: CanvasMentionMaterial[];
  preview?: (ref: Reference) => string | undefined;
  onAttach: (attach: CanvasMentionMaterial['attach']) => Promise<Reference>;
}) {
  const id = useId();
  const popup = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const [mention, setMention] = useState<Mention>();
  const [index, setIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const query = mention?.query.toLocaleLowerCase() ?? '';
  const matches = (label: string) => label.toLocaleLowerCase().includes(query);
  const linked: Choice[] = mention ? references.filter((ref) => matches(ref.label)).map((ref) => ({
    id: ref.id, media: ref.media, label: ref.label, preview: preview?.(ref), reference: ref,
  })) : [];
  const available: Choice[] = mention ? materials.filter((material) => matches(material.label)) : [];
  const choices = [...linked, ...available];
  const active = Math.min(index, choices.length - 1);
  const open = Boolean(mention);

  useLayoutEffect(() => {
    const field = text.current;
    const menu = popup.current;
    if (!open || !field || !menu) return;
    function place() {
      if (!field || !menu) return;
      const bounds = field.getBoundingClientRect();
      const viewport = window.visualViewport;
      const top = viewport?.offsetTop ?? 0;
      const bottom = top + (viewport?.height ?? window.innerHeight);
      const above = bounds.top - top - 14;
      const below = bottom - bounds.bottom - 14;
      const flip = above >= Math.min(menu.scrollHeight, 220) || above > below;
      menu.style.maxHeight = `${Math.max(0, Math.min(220, flip ? above : below))}px`;
      menu.style.top = `${flip ? bounds.top - menu.offsetHeight - 6 : bounds.bottom + 6}px`;
      menu.style.left = `${Math.max(8, Math.min(bounds.left, document.documentElement.clientWidth - menu.offsetWidth - 8))}px`;
    }
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [choices.length, error, open, text]);

  useLayoutEffect(() => {
    const menu = popup.current;
    const row = document.getElementById(`${id}-${active}`);
    if (!menu || !row) return;
    const bounds = menu.getBoundingClientRect();
    const item = row.getBoundingClientRect();
    if (item.top < bounds.top) menu.scrollTop -= bounds.top - item.top;
    if (item.bottom > bounds.bottom) menu.scrollTop += item.bottom - bounds.bottom;
  }, [active, id, query]);

  function sync(field: HTMLTextAreaElement) {
    setMention(composing.current ? undefined : mentionAt(field));
    setIndex(0);
    setError('');
  }

  async function choose(choice: Choice) {
    if (!mention || busy || pending) return;
    const { start, end } = mention;
    // New reference IDs are UUIDs. Reserve token space before attaching a new source.
    const idLength = choice.reference?.id.length ?? 36;
    if (prompt.length - (end - start) + idLength + referenceTag('').length > promptLimit) {
      setError('提示词空间不足，无法插入引用。');
      return;
    }
    setPending(true);
    setError('');
    try {
      const ref = choice.reference ?? (choice.attach && await onAttach(choice.attach));
      if (!ref) return;
      const tag = referenceTag(ref.id);
      onChange(`${prompt.slice(0, start)}${tag}${prompt.slice(end)}`);
      setMention(undefined);
      requestAnimationFrame(() => {
        text.current?.focus({ preventScroll: true });
        text.current?.setSelectionRange(start + tag.length, start + tag.length);
      });
    } catch (cause) {
      setError(actionError(cause));
    } finally {
      setPending(false);
    }
  }

  function rows(items: Choice[], offset: number) {
    return items.map((item, i) => {
      const position = i + offset;
      return (
        <button
          key={item.id}
          id={`${id}-${position}`}
          type="button"
          role="option"
          aria-selected={position === active}
          aria-disabled={pending || busy}
          tabIndex={-1}
          title={item.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => void choose(item)}
        >
          <span className="canvas-mention-preview" aria-hidden="true">
            {item.media === 'video' ? <VideoCameraOutlined /> : item.preview
              ? <img src={item.preview} alt="" loading="lazy" /> : <FileImageOutlined />}
          </span>
          <span className="canvas-mention-label">{item.label}</span>
        </button>
      );
    });
  }

  return (
    <div className="work-form creative-prompt" data-reference-mention-open={open || undefined}>
      <textarea
        aria-label="提示词"
        aria-autocomplete="list"
        aria-controls={open ? id : undefined}
        aria-activedescendant={open && active >= 0 ? `${id}-${active}` : undefined}
        placeholder={video ? '描述商品视频的场景、动作和镜头运动…' : '描述你想生成的商品画面，例如背景、光线和构图…'}
        ref={text}
        rows={5}
        maxLength={promptLimit}
        value={prompt}
        readOnly={busy || pending}
        onChange={(event) => {
          onChange(event.currentTarget.value);
          sync(event.currentTarget);
        }}
        onSelect={(event) => {
          if (!open || pending || composing.current) return;
          const next = mentionAt(event.currentTarget);
          if (next?.start !== mention?.start || next?.end !== mention?.end) sync(event.currentTarget);
        }}
        onCompositionStart={() => {
          composing.current = true;
          setMention(undefined);
        }}
        onCompositionEnd={(event) => {
          composing.current = false;
          sync(event.currentTarget);
        }}
        onBlur={(event) => {
          if (!popup.current?.contains(event.relatedTarget)) setMention(undefined);
        }}
        onKeyDown={(event) => {
          if (!open || composing.current || event.nativeEvent.isComposing) return;
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            if (!pending) setMention(undefined);
          } else if (event.key === 'Enter' && active >= 0 && !event.shiftKey) {
            event.preventDefault();
            void choose(choices[active]);
          } else if (choices.length && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault();
            const step = event.key === 'ArrowDown' ? 1 : -1;
            setIndex((active + step + choices.length) % choices.length);
          }
        }}
      />
      {open && (
        <div className="canvas-mention-popup" ref={popup}>
          <div id={id} role="listbox" aria-label="画布素材" aria-busy={pending}>
            {!!linked.length && (
              <div role="group" aria-label="已引用">
                <div className="canvas-mention-caption" aria-hidden="true">已引用</div>
                {rows(linked, 0)}
              </div>
            )}
            {!!available.length && (
              <div role="group" aria-label="画布素材">
                <div className="canvas-mention-caption" aria-hidden="true">画布素材</div>
                {rows(available, linked.length)}
              </div>
            )}
          </div>
          {!choices.length && <p role="status">没有匹配的画布素材</p>}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </div>
  );
}
