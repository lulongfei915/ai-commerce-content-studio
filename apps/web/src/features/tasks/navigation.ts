import {
  AuditOutlined,
  BulbOutlined,
  FolderOpenOutlined,
  PictureOutlined,
  SettingOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';

export const navigation = [
  { view: 'tasks', label: '全部任务', Icon: FolderOpenOutlined },
  { view: 'reviews', label: '审核中心', Icon: AuditOutlined },
  { view: 'assets', label: '公司资产', Icon: PictureOutlined },
  { view: 'products', label: '商品资料', Icon: ShoppingOutlined },
  { view: 'cases', label: '案例灵感', Icon: BulbOutlined },
  { view: 'templates', label: '公司模板', Icon: SettingOutlined },
] as const;
