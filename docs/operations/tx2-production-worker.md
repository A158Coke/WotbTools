# TX2 production worker（K7A）

K7A 为 **TX2** 建立仓库拥有的 “未来可跑生产 workload” 主机前置条件。它**不**迁移、部署、
adopt、搬迁任何生产 workload，也**不**改变 K6B placement、DNS 或公网流量。

```text
K7A IMPLEMENTED / NOT PRODUCTION ACCEPTED
```

在 merge + 生产 reconcile + runtime acceptance 通过之前，本文不写 `K7A COMPLETE`。

## 目标能力与边界

```text
Komodo Core
    ↓
TX2 Periphery（K3.3，已生产验证）
    ↓
root Docker 执行上下文
    ↓
Docker Compose v2
    ↓
已认证的 TCR 私有镜像拉取
    ↓
（K7B 才会创建的真实 WotBTools 生产容器）
```

K7A **只**建立最后两个箭头之外的全部前置条件，并证明私有镜像可以被 root 上下文认证拉取。
它不创建 Komodo Stack，不启用 ResourceSync 自动 apply，不改 `infra/komodo/resources/**`。

## 三个 lifecycle 的 ownership 区分

| Owner | 拥有 | 不拥有 |
|---|---|---|
| `deploy/periphery/**` + `komodo-periphery.yml` | Periphery 二进制、配置、systemd 生命周期、身份、Core 信任、onboarding | 通用 Docker 主机 provisioning |
| **`deploy/production-worker/**` + `production-worker.yml`（K7A）** | TX2 的 host Docker 前置条件：Compose 能力、`/etc/docker/daemon.json` 的已评审 mirror、**root 执行上下文的 TCR pull 凭据** | Periphery、Komodo Core、Caddy、Frontend、Business API、Keycloak、PostgreSQL、AI、DNS、OpenTofu state、任何 workload |
| 未来的 Komodo workload owner（K7B） | Stack / Deployment / ResourceSync 内容 | 本文件的 host 前置条件 |

`deploy/production-worker/**` 的任何改动只触发 production-worker owner（生产 reconcile）与
`ci-production-worker.yml`（PR 校验），不会触发 frontend / business-api / keycloak / caddy /
postgres / Komodo owner；反之 workload 改动也不会触发 worker reconcile。该互相隔离由
`scripts/ci/test-workflow-contract.sh` 与 `.github/ci-owner-paths.yml` 断言。

## TX2 前置条件（reconcile 拥有并验证）

| 前置条件 | desired state | 失败行为 |
|---|---|---|
| Docker | 已安装且 daemon healthy | fail closed |
| Docker Compose v2 | 发行版包 `docker-compose-v2`（capability-based，不 pin 版本）；`docker compose version` 与 `docker compose ls --all --format json` 都必须可用 | fail closed（含安装失败、插件不可用） |
| Docker Hub mirror | `/etc/docker/daemon.json` **恰好**包含 `registry-mirrors: ["https://mirror.ccs.tencentyun.com"]`（root:root, 0644, 原子写入） | 文件损坏/未知 key ⇒ fail closed；值漂移 ⇒ 纠正 |
| TCR pull 凭据 | root 的 Docker 凭据存储（`/root/.docker/config.json`, root:root, 0600；目录 0700），只含 `vars.TCR_REGISTRY` 一个 registry | 缺失/不安全权限/外来 registry ⇒ fail closed |
| 私有镜像可拉取 | 用当前 main 约定的私有镜像 `wotbtools-frontend:latest` 做 manifest 解析 **与真实 pull** | 任一失败 ⇒ fail closed |
| 主机锁 | 复用 `/opt/wotb-tx2/.deploy.lock`（TX2 deploy owner 拥有，不新建 worker 专用锁） | 缺失/被占用 ⇒ fail closed |
| Periphery 回归 | unit active/enabled、有出站 Core 连接、**没有** `:8120` 监听、身份/信任/配置文件仍在 | 任一失败 ⇒ fail closed |
| WireGuard 回归 | 期望地址仍在、K6B 冻结的 service-plane endpoint 可达（`10.20.0.1:8087`、`10.20.0.1:8080`、`10.20.0.2:8089`） | 任一失败 ⇒ fail closed |
| 不创建 workload | reconcile 前后运行中的容器集合必须完全一致 | 变化 ⇒ fail closed |

Docker daemon 只在 `daemon.json` **确实发生变化**时重启（mirror 只在启动时读取）；重启前会记录
当前运行容器数量，且 reconcile 绝不 `docker system prune`、不删除任何容器/镜像/网络/卷。

## 安全边界：为什么是 root，以及为什么凭据不在 Git / Compose / Komodo 里

Komodo Periphery 以 **root** 操作 Docker，因此私有生产镜像的凭据必须存在于 **root 的 Docker
凭据存储**里，而不是某个交互账号的 store。`deploy/tx/publish-loaded-image-to-tcr.sh` 已经确立
同一条边界（“Docker reads TCR credentials only from this host's credential store”）；K7A 让
TX2 拥有自己的这一份，而不是从 TX1 复制。

凭据因此**绝不**出现在：

```text
infra/komodo/resources/**        （K4.1 只有 Servers + ResourceSync，且 managed=false / delete=false / webhook=false）
deploy/periphery/**              （Periphery 配置/身份/onboarding key 与 registry 无关）
Compose YAML                     （不用 registry secret 注入）
仓库内任何 tracked 文件            （契约测试会扫描提交内容）
命令参数                          （只经 stdin；`--password` 从不出现在 argv）
日志                              （host 侧关闭 tracing，登录只用 --password-stdin）
staging 目录                      （只 stage 脚本；临时凭据目录 0700 且立即删除）
```

凭据来源是受保护 `tx-production` environment 的 `secrets.TCR_USERNAME` /
`secrets.TCR_PASSWORD`（registry 与 namespace 复用既有的 `vars.TCR_REGISTRY` /
`vars.TCR_NAMESPACE`）。跨 sudo 只按名字 `--preserve-env`，不经 argv、磁盘或日志。

### 凭据生命周期

| 阶段 | 行为 |
|---|---|
| provision | 首次 reconcile：缺失时用 secret 登录并原子写入 root store |
| rotate | GitHub secret 变更后重新 dispatch：仅在既有凭据**不再能认证**时才重新登录并原子替换 |
| verify | 每次 reconcile 都重新断言权限/所有权/单一 registry + 私有镜像 manifest/pull |
| revoke | 删除 `/root/.docker/config.json`（或轮换 TCR 侧凭据）即可；不需要重建主机 |
| reconcile | 幂等：凭据仍有效时不重写、不重启 Docker、不重装 Compose |

## 验证与 token

host 侧 `verify.sh` 逐项输出并只在全部通过时打印最终 token（也是 reconcile 的最后一行）：

```text
docker-daemon: PASS
docker-compose-v2: PASS
docker-hub-mirror: PASS
tcr-root-credential: PASS
private-image-pull: PASS
periphery-regression: PASS
wireguard-regression: PASS
no-workload-created: PASS

TX2_PRODUCTION_WORKER_READY
```

`TX2_PRODUCTION_WORKER_READY` 只属于这个 owner；TX1 生产拓扑继续使用自己的
`TX_RUNTIME_READY`（runtime gate），两者不可互换。

## 从零重建 TX2 到 ready

```text
1. 主机：Ubuntu + Docker（发行版或官方安装，二者都行）+ WireGuard 身份 + TX2 deploy-owned
   /opt/wotb-tx2/（含 .deploy.lock）；Periphery 由 komodo-periphery.yml 独立 reconcile
2. GitHub：`tx-production` environment 必须提供 secrets.TCR_USERNAME / secrets.TCR_PASSWORD；
   仓库 variables TCR_REGISTRY / TCR_NAMESPACE 必须指向 TCR
3. dispatch `Production Worker`（或在 main 上改动 deploy/production-worker/** 触发）
   → 冻结 exact main → 读取 TX2 profile → 准备 staging root → stage 本 owner 的脚本
   → 取 TX2 主机锁 → install（Compose / mirror / root 凭据）→ verify
4. 期望输出 TX2_PRODUCTION_WORKER_READY；任一检查失败都会 fail closed，不会留下
   “部分 ready” 状态
```

没有 Compose、mirror 或凭据需要手工保留：它们全部由该 owner 重建。

## 仍未授权（K7B 及以后）

```text
创建/采纳生产 Komodo Stack
把 Frontend / Business API / Keycloak / PostgreSQL / Caddy / AI 放到 TX2
修改任何 K6B placement、Caddy upstream、DNS 或公网流量
启用 ResourceSync 自动 apply、managed=true、delete=true
```

## 参考

- 前置条件的 K5 历史状态：`docs/operations/komodo-k5-runtime-acceptance.md`
- Periphery 边界：`docs/operations/komodo-periphery.md`
- Komodo 声明式资源（K4.1）：`docs/operations/komodo-resource-sync.md`
- TX service plane 与 K6B baseline：`docs/operations/tx-service-plane.md`
