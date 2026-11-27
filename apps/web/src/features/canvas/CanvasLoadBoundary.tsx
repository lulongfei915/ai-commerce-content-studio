import { Component, type ReactNode } from 'react';

export class CanvasLoadBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <p role="alert" className="work-error">
        画布加载失败。{' '}
        <button type="button" onClick={() => window.location.reload()}>
          刷新页面
        </button>
      </p>
    );
  }
}
