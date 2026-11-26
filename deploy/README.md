# 造物 Studio 部署与恢复

## 安装与升级

SaaS 和私有化使用同一对版本化镜像及同一 Alembic 链。SaaS 配置托管 MySQL、独立 Redis、私有 S3 兼容存储及至少两个 API 副本。私有化为每套安装配置独立的数据库、Redis、桶和主机名。开发用 `docker-compose.yml` 的默认凭据仅用于本地开发。

1. 从 `.env.release.example` 准备 `deploy/.env.release`，权限设为 `0600`。填写正式镜像标签或摘要、数据库连接、Redis、对象存储和 HTTPS 来源。配置文件用百分号编码数据库口令中的 URL 保留字符。迁移账号使用单独的 DDL 权限，API 账号使用业务所需 DML 权限。
2. 在 `STUDIO_TLS_DIR` 放置 `fullchain.pem` 和 `privkey.pem`。Nginx 默认只绑定回环地址。对外发布时设置 `STUDIO_BIND_ADDRESS`，并在防火墙及负载均衡器上限制入口。MySQL、Redis、API 与 Worker 无宿主机发布端口。对象桶启用版本保护及私有访问。Seedance 私有视频参考需要供应商可达的 `STORAGE_SIGNED_ENDPOINT` HTTPS 地址，并保留签名所需的主机与路径。
3. 创建 `STUDIO_LICENSE_DIR`。私有化设 `DEPLOYMENT_MODE=private`，填写 `INSTALLATION_ID`，在目录放入 `license.json` 与 `studio.pub`。签发方持有 Ed25519 私钥。收件方用可信渠道获取 32 字节公钥，配置文件挂载为只读。许可证载荷含 `product`、`installation_id`、带时区的 `expires_at`，签名覆盖载荷原始字节，文件将载荷和签名分别 Base64 编为 `payload` 和 `signature`。续期以原子替换方式更新文件。
4. 用 `compose config --quiet` 检查配置。联网构建时附加 `-f deploy/compose.build.yml` 并构建 `migrate edge`。离线安装使用构建方提供的镜像归档及摘要，`docker load` 后使用 `up --pull never`。也可将已验证的 `apps/web/dist` 通过 `Dockerfile.edge --target prebuilt --build-context studio_dist=apps/web/dist` 打包。
5. 保持 `PAID_CALLS_PAUSED=true`，运行一次迁移，再启动运行时服务。`migrate` 成功且 API 健康后入口启动。首次安装用 `docker compose ... exec api python -m app.entrypoints.bootstrap_tenant` 初始化首位管理员。验证 HTTPS、登录、媒体读写和恢复状态后再启用付费调用。

```bash
release() { docker compose -f deploy/compose.release.yml --env-file deploy/.env.release "$@"; }
release config --quiet
release up --pull never -d --scale api=2 --scale worker=2
release ps -a
release exec -T worker celery -A app.entrypoints.worker:celery_app inspect ping
```

升级前停入口以停止写入，停调度后让 Worker 正常退出，再停止 API 并制作联合备份。保留旧版本镜像与配置，在隔离环境用备份做升级演练。上线时保持付费暂停，运行新版 `migrate`，用上面的命令重建各服务并执行读写烟测。涉及结构变更时，以已验证备份作为回退基础。

## 联合备份与恢复

1. 记录写入冻结时刻，停 `edge`、`scheduler`、`api` 与 `worker`，确认无其他数据库或桶写入方。用 `umask 077` 创建备份目录。使用带凭据保护的 MySQL 客户端配置，制作包含 binlog 坐标的 `mysql.sql`。
2. 用备份账号及同一套数据库、对象配置运行 `python -m app.entrypoints.recovery capture <目录>`。命令需要 `PAID_CALLS_PAUSED=true`，保存现存对象的版本 ID、大小和 SHA-256，同时校验就绪媒体均已入包。将目录加密后存入隔离备份位置并监视作业退出状态。按留存计划维护 MySQL binlog 和对象版本。
3. 准备空的隔离库、已开启版本保护的空桶和空 Redis。使用目标配置及 `PAID_CALLS_PAUSED=true` 运行 `recovery restore <目录>` 校验备份并恢复对象，然后导入同目录的 `mysql.sql`。运行 `recovery verify <目录>` 对比数据库行、归档引用和对象 SHA-256。开始升级或其他数据写入前完成该比较。
4. 如需恢复到全量备份之后的时间，按记录的坐标应用连续 binlog，同时选择该时间点对应的对象版本。对这一目标时间点重新核对业务行、引用和对象哈希。共享库单租户场景在隔离库恢复，按已确认的租户映射回灌。
5. 保持付费暂停，运行 `recovery providers`，比对供应商侧请求 ID、状态和账单。覆盖快照前仍在飞的输出，以及快照之后供应商已受理的调用，含辅助模型。恢复库里的 `queued` 也可能在原环境已经发送。对未知记录保持暂停，通过已有对账接口登记证据。若数据库记录已丢失，先恢复对应 binlog 或补齐可审计的记录映射。用空队列启动，验证读写和已发调用的查单、归档，再恢复派发。

```bash
mysqldump --defaults-extra-file=/secure/backup.cnf --single-transaction \
  --source-data=2 --set-gtid-purged=OFF --no-tablespaces studio > "$backup_dir/mysql.sql"
PAID_CALLS_PAUSED=true python -m app.entrypoints.recovery capture "$backup_dir"
PAID_CALLS_PAUSED=true python -m app.entrypoints.recovery restore "$backup_dir"
mysql --defaults-extra-file=/secure/restore.cnf studio_restore < "$backup_dir/mysql.sql"
PAID_CALLS_PAUSED=true python -m app.entrypoints.recovery verify "$backup_dir"
python -m app.entrypoints.recovery providers
```

本机浏览器原型记录只有在来源、授权和版本映射获确认后才进入迁移。正式 MySQL 历史库走原有 Alembic 链，核对原任务、草稿、人工批准与采用记录。迁移保留已有初检证据，缺少证据时进入待复核或不可用状态。

## 监控与诊断

用 `python -m app.entrypoints.recovery metrics` 将聚合计数接入采集器的 textfile collector，命令失败时上报采集失败。用边缘结构化日志统计 HTTP 5xx 和耗时，用 Celery `inspect ping` 检查 Worker。告警至少关注队列持续增长、未知调用、归档失败、未核实费用持续增长、备份失败和恢复时间超标。按目标流量和支持时段确认阈值与值班通知。诊断包包含镜像摘要、Alembic revision、聚合计数和脱敏日志。

在目标 SaaS 演练时记录故障时间、最后可恢复点、验证通过及恢复派发的时间，对照 RPO 15 分钟及 RTO 4 小时目标。
