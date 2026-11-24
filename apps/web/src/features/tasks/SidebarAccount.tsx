import { useState } from 'react';
import { Dropdown, Modal } from 'antd';
import { LogoutOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import { roleLabel, type Session } from '../auth/session';

export function SidebarAccount({
  session, busy, onLogout,
}: {
  session: Session;
  busy: boolean;
  onLogout: () => void;
}) {
  const [guideOpen, setGuideOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const name = session.email.split('@')[0];
  const role = roleLabel[session.role];

  return (
    <footer className="work-account">
      <button type="button" className="work-guide" aria-label="使用指南" title="使用指南"
        onClick={() => setGuideOpen(true)}>
        <QuestionCircleOutlined aria-hidden="true" />
        <span className="work-nav-label">使用指南</span>
      </button>
      <Dropdown
        trigger={['click']}
        placement="topLeft"
        autoFocus
        open={menuOpen}
        onOpenChange={setMenuOpen}
        menu={{
          items: [
            { type: 'group', key: 'identity', label: (
              <div className="work-account-info">
                <strong>{session.tenant.name}</strong>
                <span>{session.email}</span>
                <span>原件下载{session.permissions.includes('download') ? '已授权' : '未授权'}</span>
              </div>
            ), children: [] },
            { type: 'divider' },
            { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, disabled: busy },
          ],
          onClick: () => { setMenuOpen(false); onLogout(); },
        }}
      >
        <button type="button" className="work-profile" aria-label={`${name}，${role}，账号菜单`}
          title={`${name} · ${role}`} aria-haspopup="menu" aria-expanded={menuOpen}>
          <span className="work-avatar" aria-hidden="true">{Array.from(name)[0]?.toUpperCase()}</span>
          <span className="work-profile-details"><strong>{name}</strong><small>{role}</small></span>
        </button>
      </Dropdown>
      <Modal open={guideOpen} title="使用指南" footer={null} onCancel={() => setGuideOpen(false)}>
        <p><strong>准备商品</strong> 在「商品资料」中核对 SKU 和商品实拍。</p>
        <p><strong>开始创作</strong> 在「全部任务」中选择任务，按需要使用快捷生成、画布或批量制作。</p>
        <p><strong>审核与交付</strong> 在「审核中心」处理待审素材，在「资产与交付」查看可用成果。</p>
      </Modal>
    </footer>
  );
}
