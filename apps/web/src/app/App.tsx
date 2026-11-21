import { Layout, Typography } from 'antd';

import '../styles/global.css';

const { Header, Content } = Layout;

export function App() {
  return (
    <Layout className="studio-shell">
      <Header className="studio-header">
        <Typography.Title level={3}>造物 Studio</Typography.Title>
        <Typography.Text>电商素材生产工作台</Typography.Text>
      </Header>
      <Content className="studio-content">
        <Typography.Title level={2}>准备开始创作</Typography.Title>
        <Typography.Paragraph>
          正式工程已启动。后续模块会在这里接入商品、任务、生成、画布、审核与交付流程。
        </Typography.Paragraph>
      </Content>
    </Layout>
  );
}
