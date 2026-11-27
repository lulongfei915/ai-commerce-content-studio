import { useState } from 'react';
import { Dropdown } from 'antd';
import { DownOutlined } from '@ant-design/icons';

import type { Session } from '../auth/session';
import type { Task } from './api';
import { readRecentTasks } from './entryPreference';

export function TaskSwitcher({ task, session, onSelect, onAll, onSettings }: {
  task: Task;
  session: Session;
  onSelect: (id: string) => void;
  onAll: () => void;
  onSettings?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const recent = [task, ...readRecentTasks(session).filter(({ id }) => id !== task.id)].slice(0, 6);

  return (
    <Dropdown
      trigger={['click']}
      placement="bottomLeft"
      overlayClassName="studio-task-menu"
      autoFocus
      open={open}
      onOpenChange={setOpen}
      menu={{
        selectedKeys: [`task:${task.id}`],
        items: [
          {
            type: 'group',
            label: '最近任务',
            children: recent.map(({ id, name }) => ({
              key: `task:${id}`,
              label: <span className="studio-task-menu-name" title={name}>{name}</span>,
            })),
          },
          { type: 'divider' },
          ...(onSettings ? [{ key: 'settings', label: '任务设置' }] : []),
          { key: 'all', label: '查看全部' },
        ],
        onClick: ({ key }) => {
          setOpen(false);
          if (key === 'all') onAll();
          else if (key === 'settings') onSettings?.();
          else if (key !== `task:${task.id}`) onSelect(key.slice('task:'.length));
        },
      }}
    >
      <button
        type="button"
        className="studio-task-trigger"
        title={task.name}
        aria-label={`切换任务，当前：${task.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span>{task.name}</span>
        <DownOutlined aria-hidden="true" />
      </button>
    </Dropdown>
  );
}
