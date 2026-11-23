import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import { ImageProduction } from '../src/features/creation/ImageProduction';
import type { Draft } from '../src/features/creation/api';

afterEach(() => {cleanup();vi.unstubAllGlobals();});

test('selecting a prompt card previews it without starting a model call', async () => {
  const fetch = vi.fn(async (path: string) => new Response(JSON.stringify(
    path.endsWith('/prompt-cards') ? [{id:'one',title:'棚拍',version:1,prompt:'白底实拍'}] : []
  )));
  vi.stubGlobal('fetch',fetch);
  const onPrompt=vi.fn();
  const draft={id:'draft-one',task_id:'task-one',version:1,prompt:''} as Draft;
  render(<ImageProduction draft={draft} token="test" disabled={false} onSaved={vi.fn()} onPrompt={onPrompt}/>);
  await screen.findByRole('option',{name:'棚拍 · V1'});
  fireEvent.change(screen.getByRole('combobox',{name:'快捷词卡片'}),{target:{value:'one'}});
  expect(screen.getByText('白底实拍')).toBeVisible();
  expect(onPrompt).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'替换正文'}));
  expect(onPrompt).toHaveBeenCalledWith('白底实拍');
  fireEvent.click(screen.getByRole('button',{name:'优化提示词'}));
  expect(await screen.findByRole('alert')).toHaveTextContent('请先填写并保存提示词');
  expect(fetch).toHaveBeenCalledTimes(3);
});
