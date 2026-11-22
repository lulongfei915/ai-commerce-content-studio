import { Layout, Typography } from 'antd';

import { SessionGate } from '../features/auth/SessionGate';
import '../styles/global.css';

const { Header, Content } = Layout;

export function App() {
  return (
    <Layout className="studio-shell">
      <Header className="studio-header">
        <Typography.Title level={3}>造物 Studio</Typography.Title>
        <Typography.Text>电商素材生产工作台</Typography.Text>
      </Header>
      <Content className="studio-content"><SessionGate /></Content>
    </Layout>
  );
}
