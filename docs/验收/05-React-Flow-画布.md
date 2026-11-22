# M1-05 React Flow 画布验收

2026-11-22。在 Apple M2 本地环境使用实际 React 应用、FastAPI、MySQL、Redis 和 MinIO。Chromium `158.0.8127.18` 以桌面及手机视口运行。样品来自仓库原型素材，包含不同颜色 SKU 和 20 份通过私有文件接口上传的媒体，共 3,305,000 字节。

| 验收 | 实测 |
| --- | --- |
| AC-03、04、35 | 图片与视频节点使用共用草稿。图片提示词和参数可在画布内编辑，未保存正文转到快捷入口后仍可继续修改。视频节点可配置比例和时长。读取场景及结果节点按任务、草稿和执行 ID 归属。 |
| AC-04、21 | 拖动、平移、缩放、适应全部、关系高亮及整理通过。布局和个人视口分别持久化，浏览器刷新后恢复。外部更新产生 409，显式加载服务器版后可继续编辑。注入 503 后显示未保存并可重试。 |
| AC-05、35 | 实拍连线、缩略图、引用标签和输入核对共享引用 ID。移除引用保留手写正文，悬空标签阻止核对。接口拒绝跨 SKU、未就绪、循环、未批准及以原始文件 ID 代替结果的引用。 |
| AC-21 | 浏览器验收脚本未观察到任何生成或执行请求。画布操作只写入空间偏好、布局或共用草稿。 |
| 焦点和小屏 | 浮层和嵌套核对面板顺序响应 Escape。关闭后返回触发节点，输入时 Backspace 不删除节点。手机尺寸下核对入口可通过浮层内部滚动到达。 |

| 50 节点、100 连线、20 缩略图 | 采样数 | 响应 p95 | 交互帧率 | 最长长任务 | JS 堆抽样 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1280×600 | 81 | 9.1 ms | 60.0 fps | 0 ms | 47.4 MB |
| 390×844 | 81 | 9.4 ms | 60.0 fps | 0 ms | 50.4 MB |

响应计时从真实浏览器输入事件到节点或视口的 DOM 样式修改。帧率由交互时段的 `requestAnimationFrame` 采样计算。长任务通过 Chromium `PerformanceObserver` 采集。两种尺寸均达到 100 ms、30 fps 和 200 ms 门槛。手机数据来自桌面 Chromium 的 390×844 视口，真机容量纳入模块 17。

六类状态截图、手机截图及原始性能结果位于 `.artifacts/module05/`。脚本可重新生成这些证据。使用测试工作区账号配置 `STUDIO_CANVAS_TENANT`、`STUDIO_CANVAS_EMAIL` 和 `STUDIO_CANVAS_PASSWORD`，通过 `STUDIO_CANVAS_URL` 指定工作台地址。

```bash
pnpm --dir apps/web exec node scripts/verify-canvas.mjs
pnpm --dir apps/web lint
pnpm --dir apps/web test
pnpm --dir apps/web build
pnpm --dir apps/web check:lines
uv run --project apps/server pytest apps/server/tests
uv run --project apps/server ruff check apps/server/app apps/server/tests
uv run --project apps/server mypy --config-file apps/server/pyproject.toml apps/server/app
uv run --project apps/server alembic -c apps/server/alembic.ini upgrade head
uv run --project apps/server alembic -c apps/server/alembic.ini check
```

后端 41 项测试和前端 2 项测试通过。MySQL 从空库迁移到 `0005_canvas`，Alembic 检查未发现缺少的迁移。

真实图片提交由模块 06 接入，批准结果作为公司资产的生产闭环由模块 09 验证，视频生成及成片由模块 13、14 接入。当前输入核对读取固定版本和用途，结果归属、审核门槛及循环校验使用预置输出记录验证。
