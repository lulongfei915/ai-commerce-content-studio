import {
  AppstoreAddOutlined,
  CodeSandboxOutlined,
  SafetyCertificateOutlined,
  SlidersOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';

export const navigation = [
  { view: 'products', label: '商品资料', Icon: ShoppingOutlined },
  { view: 'cases', label: '案例灵感', Icon: AppstoreAddOutlined },
  { view: 'reviews', label: '审核中心', Icon: SafetyCertificateOutlined },
  { view: 'assets', label: '资产与交付', Icon: CodeSandboxOutlined },
  { view: 'templates', label: '公司管理', Icon: SlidersOutlined },
] as const;

export function isCreationEntry(view: string): view is 'quick' | 'canvas' | 'batch' {
  return view === 'quick' || view === 'canvas' || view === 'batch';
}
