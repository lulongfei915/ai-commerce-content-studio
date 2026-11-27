import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import { TaskStudio } from '../src/features/tasks/TaskStudio';

vi.mock('../src/features/canvas/CanvasPage', () => {
  throw new TypeError('Failed to fetch dynamically imported module');
});

test('keeps the task navigation usable when the canvas module fails to load', async () => {
  const onBack = vi.fn();
  const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
  try {
    render(
      <TaskStudio
        entry="canvas"
        task={{ id: 'task', name: '画布测试任务', status: 'active', version: 1, products: [], positions: [] }}
        session={{
          user_id: 'person',
          email: 'studio@example.test',
          tenant: { id: 'company', slug: 'studio', name: '造物电商' },
          role: 'designer',
          permissions: ['view', 'create'],
          csrf_token: 'csrf-test',
        }}
        categories={[]}
        onBack={onBack}
        onNew={vi.fn()}
        onDirty={vi.fn()}
        onProductSaved={vi.fn()}
      >
        <div />
      </TaskStudio>,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('画布加载失败');
    expect(screen.getByRole('button', { name: '刷新页面' })).toBeVisible();
    expect(screen.getByRole('heading', { name: '画布测试任务' })).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: '返回工作台' }));
    expect(onBack).toHaveBeenCalledOnce();
  } finally {
    consoleError.mockRestore();
  }
});
