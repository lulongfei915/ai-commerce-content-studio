# ADR 0001 · 方舟视频生成使用 REST API

状态：已采用。首轮使用 Seedance 2.0（`doubao-seedance-2-0-260128`）。

后端已经依赖 `httpx`，图片生成也通过 HTTP 适配器接入。视频验证需要创建任务、按 ID 查询和下载三个步骤。SDK 可提供供应商封装的请求类型与方法，不过本轮接口数量少，沿用 `httpx` 可复用现有依赖，并让超时、限流和重复提交的处理在适配器中明确可见。

服务端适配器负责构建文本请求、解析任务状态及提取供应商错误码。烟测命令提交一次付费任务，输出任务 ID，轮询并下载至本地忽略目录。已有任务可按 ID 接续。媒体下载使用独立客户端，方舟 API Key 仅用于任务接口。接口字段变化由项目维护并通过契约测试验证。

方舟参考：[创建任务](https://docs.volcengine.com/docs/ark/create-video-generation-task-api?lang=zh) · [查询任务](https://docs.volcengine.com/docs/ark/get-video-generation-task-api?lang=zh) · [Seedance 2.0 指南](../模型使用指南/Seedance-2.0-系列模型使用指南.md)
