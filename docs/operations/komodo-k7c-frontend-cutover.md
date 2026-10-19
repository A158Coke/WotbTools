# TX1 / TX2 Frontend 生产拓扑

当前公开 `wotbtools.com` frontend 是 TX1 + TX2 双实例生产池，Caddy 在 TX1 上拥有公网 80/443。

## 当前拓扑

```text
公网
  -> TX1 Caddy（80/443）
       -> TX1 frontend 10.20.0.1:8081  weight 2（约 20%）
       -> TX2 frontend 10.20.0.3:8081  weight 8（约 80%）
          健康检查：/version.json
```

- 两个 peer 都通过 `/version.json` 主动健康检查；不健康 peer 会被移出选择。
- Caddy 仍是 TX1 单点公网 ingress；当前拓扑提供 frontend workload 冗余，不提供 gateway 节点冗余。
- Business API、Keycloak、PostgreSQL 与 AI 的 placement 不随 frontend pool 改变。

## 发布 ownership

Frontend release 路径固定为：

```text
GitHub main
  -> 精确镜像源码到 Gitee
  -> TX1 从 Gitee 拉取并构建
  -> TX1 发布 immutable frontend image 到 TCR
  -> TX1 部署该 immutable artifact
  -> Frontend Replica 解析同一 published artifact
  -> TX2 直接从 TCR 拉取
  -> TX2 部署精确 immutable digest
  -> 校验 TX1/TX2 version parity
```

- TCR 是 TX2 的 release-artifact authority；TX2 不通过检查 TX1 运行容器推导部署镜像。
- Komodo 只保留 TX2 Stack 的声明式元数据与运行时可见性；该 Stack 的 polling、webhook 部署与自动 workload 更新保持关闭，镜像 rollout 由 `.github/workflows/frontend-replica.yml` 执行，避免与生产 Frontend Replica 竞争。

## Runtime content ownership

Frontend image 不是全部生产面。当前 Android 公网下载面是 host-owned runtime content；Sponsor QR 不属于 host content——它在构建期从固定 Release asset 注入，随 Frontend image / APK 发布（见 [sponsor-runtime-content.md](sponsor-runtime-content.md)）。

TX2 本地复制根为 `/opt/wotb-tx2/runtime-content`，只复制当前公开生产面：

- Android `version.json`；
- 该 manifest 实际引用的 APK。

历史 APK 不复制。`*.staging.json` 是唯一例外：android-release stage 在 `/opt/wotb-tx2/.deploy.lock` 下原子写入 staged-but-unpublished release identity，publish 阶段通过公网 URL 读回；Sync 在同一把锁下携带现有记录，保证 install 与整树替换互斥。TX2 从不 bind-mount `/opt/wotb-tx`，也不直接读取 TX1 文件系统。细则见 [android/release-process.md](../android/release-process.md)「证据的存续」。

Frontend Replica workflow 在 TX2 被接受前刷新该 runtime content。

## 回滚边界

- 通过修改已评审的 Caddy pool，可把任一 frontend peer 移出公网选择。
- TX1 保持完整 frontend 实例。
- TX2 可从 immutable TCR artifact + 本地复制的当前 runtime content 重建。
- frontend 回滚不移动 Business API、Keycloak、PostgreSQL 与 AI。

## 当前已知边界

K7C 起，稳态镜像/版本 parity 与双实例健康检查由上述 owner 保证；但一次 frontend release 仍可能有 TX1 已更新、TX2 正在 reconcile 同一 TCR artifact 的短暂混合版本窗口。消除该窗口需要单独的 drain/reweight 或 blue-green rollout 设计，不属于当前生产契约。
