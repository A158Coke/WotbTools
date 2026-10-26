# TX2 production worker 与 Frontend replica

TX2 当前承担三类已评审的生产职责：

1. **production-worker owner** 建立 host 前置条件：Docker / Compose、registry mirror、root TCR 凭据生成、主机锁，以及 Periphery / WireGuard 回归。它不创建或迁移任何 workload。
2. **frontend-replica owner** 把 TX2 接入生产 Frontend 双实例池：TX1 Caddy 是唯一公网入口，按权重把流量分给 TX1 Frontend（weight 2）与 TX2 Frontend（weight 8），对两个 peer 做 `/version.json` active health check。TX2 拉取与 TX1 相同的 immutable TCR artifact，不从 TX1 运行容器复制状态。
3. **Frontend image build（Frontend owner）** 在 TX2 上执行 `frontend.yml` 的 immutable 镜像构建与 TCR 发布；TX1 仍负责部署与公网入口。TX2 只提供构建算力，不因此获得 Frontend 部署 owner。

```text
TX2_PRODUCTION_WORKER_READY  → host capability proven
K7C frontend replica         → active production workload
Frontend image build         → immutable TCR artifact（TX1/TX2 共同消费）
```

## 目标能力与边界

```text
Komodo Core
    ↓
TX2 Periphery（已生产验证）
    ↓
root Docker 执行上下文
    ↓
Docker Compose v2
    ↓
已认证的 TCR 私有镜像拉取
    ↓
frontend-replica：与 TX1 相同的 immutable Frontend artifact
```

`production-worker` 只建立最后两个箭头之外的全部 host 前置条件，并证明私有镜像可以被 root 上下文认证拉取。它不创建 Komodo Stack，不启用 ResourceSync 自动 apply，不改 `infra/komodo/resources/**`，也不部署 frontend-replica。

TX2 上唯一由生产 workflow 部署的 workload 是 Frontend replica：`frontend-replica.yml` 在 Frontend 发布成功后解析同一 TCR artifact，部署到 `/opt/wotb-tx2/frontend-replica`，并验证 TX2 的 `/version.json` 与 API health。Business API / Keycloak / PostgreSQL / Caddy 仍在 TX1；AI service 位于 Yecao（`10.20.0.2:8089`），既不在 TX1 也不在 TX2。

## lifecycle 与 workload 的 ownership 区分

| Owner | 拥有 | 不拥有 |
|---|---|---|
| `deploy/periphery/**` + `komodo-periphery.yml` | Periphery 二进制、配置、systemd 生命周期、身份、Core 信任、onboarding | 通用 Docker 主机 provisioning |
| **`deploy/production-worker/**` + `production-worker.yml`** | TX2 的 host Docker 前置条件：Compose 能力、`/etc/docker/daemon.json` 的已评审 mirror、**root 执行上下文的 TCR pull 凭据** | Periphery、Komodo Core、Caddy、Frontend、Business API、Keycloak、PostgreSQL、AI、DNS、OpenTofu state、任何 workload |
| **`frontend-replica.yml`** | TX2 Frontend 双实例副本：解析并拉取与 TX1 相同的 immutable TCR artifact、部署 `/opt/wotb-tx2/frontend-replica`、验证 peer `/version.json` 与 API health | Frontend 镜像构建与 TCR 发布（Frontend owner；构建机 = TX2）、Caddy ingress、其它服务、host 前置条件 |
| **`frontend.yml`** | Frontend immutable 镜像构建（TX2）与 TCR 发布；TX1 上的部署/健康检查仍由同一 workflow 的 deploy job 拥有 | TX2 host 前置条件、Frontend replica 落地、Caddy ingress |

### Frontend 构建机 placement（2026-10-26）

Frontend Docker 镜像在 **TX2** 构建，而不是 TX1：

- TX1 为 1.9 GiB RAM（2 vCPU），常驻 Business API / Keycloak / PostgreSQL / Caddy / Frontend；#753（Reka / VueUse / motion-v）之后 `vite build` 的 V8 old-space 需求约 1.05 GiB。
- TX1 上以 1152 MiB 堆试跑时只剩 174 MiB available / 229 MiB free swap，会威胁生产容器；默认堆则直接 OOM。
- TX2 为 3.6 GiB RAM / 4 vCPU，同一 commit 的完整 Docker 构建（含 WASM 与资产源校验）通过，构建后仍有 2.9 GiB available，未消耗 swap。
- 构建产物仍发布到同一 immutable TCR tag；TX1 的 deploy job 与 Caddy 入口不变。TX2 的 build cache / `build.lock` 与 TX1 的 Business API builder 分离。

TX2 没有额外的 Komodo Stack / ResourceSync workload owner；除 Frontend replica 外，任何新 workload 都需要先经过 Designer / approved plan 与相应 owner workflow。

`deploy/production-worker/**` 的任何改动只触发 production-worker owner（生产 reconcile）与
`ci-production-worker.yml`（PR 校验）；`frontend-replica.yml` 只由 Frontend workflow_run 或
manual dispatch 触发。两者的改动都不会触发 frontend / business-api / keycloak / caddy /
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
| WireGuard 回归 | 期望地址仍在、当前 service-plane endpoint 可达（`10.20.0.1:8087`、`10.20.0.1:8080`、`10.20.0.2:8089`） | 任一失败 ⇒ fail closed |
| 不创建 workload | reconcile 前后运行中的容器集合必须完全一致 | 变化 ⇒ fail closed |

Docker daemon 只在 `daemon.json` **确实发生变化**时重启（mirror 只在启动时读取）；重启前会记录
当前运行容器数量，且 reconcile 绝不 `docker system prune`、不删除任何容器/镜像/网络/卷。

## 安全边界：为什么是 root，以及为什么凭据不在 Git / Compose / Komodo 里

Komodo Periphery 以 **root** 操作 Docker，因此私有生产镜像的凭据必须存在于 **root 的 Docker
凭据存储**里，而不是某个交互账号的 store。`deploy/tx/publish-loaded-image-to-tcr.sh` 已经确立
同一条边界（“Docker reads TCR credentials only from this host's credential store”）；TX2 拥有
自己的这一份，而不是从 TX1 复制。

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

凭据来源是repository-level Actions `secrets.TCR_USERNAME` /
`secrets.TCR_PASSWORD`（registry 与 namespace 复用既有的 `vars.TCR_REGISTRY` /
`vars.TCR_NAMESPACE`）。跨 sudo 只按名字 `--preserve-env`，不经 argv、磁盘或日志。

### 凭据生成（credential generation）：desired state 的权威输入

凭据的**生成号**决定收敛，认证只是额外功能验证。repository-level Actions 配置提供
`vars.TCR_CREDENTIAL_VERSION`（**非密**、正整数、reviewed）与 `secrets.TCR_USERNAME` /
`secrets.TCR_PASSWORD`；host 在 state root 记录自己实际应用的生成号：

```text
/var/lib/wotbtools-production-worker/tcr-credential-version     (root:root, 0600)
```

只有当 **① root 凭据文件结构安全 ② 记录生成号 == 期望生成号 ③ 该凭据能认证到私有验证镜像**
三者同时成立时才不重写。否则一律执行：登录到临时 0700 `DOCKER_CONFIG` → 结构校验产出的
config → 原子安装 `/root/.docker/config.json` → 用已安装的 root config 验证 manifest/私有镜像
→ **验证通过后才原子推进生成号**。

关键语义：**新生成号必须强制登录/重写，即使旧凭据仍然可用**（轮换窗口内旧凭据通常会继续有效，
若只看认证就会永远停在旧 secret 上）。生成号在验证通过前绝不推进；登录或安装后验证失败时：
先前凭据会被恢复、生成号保持不变、**不输出 `TX2_PRODUCTION_WORKER_READY`**。

### 凭据生命周期

| 阶段 | 行为 |
|---|---|
| provision | 首次 reconcile：缺失时用 secret 登录并原子写入 root store，随后记录生成号 |
| rotate | 期望生成号变化即触发（与旧凭据是否仍可用无关）；登录 → 结构校验 → 原子替换 → 验证 → 记录新生成号 |
| verify | 每次 reconcile 都重新断言权限/所有权/单一 registry + **记录生成号 == 期望生成号** + 私有镜像 manifest/pull |
| revoke | 删除 `/root/.docker/config.json`（或轮换 TCR 侧凭据）即可；不需要重建主机 |
| reconcile | 幂等：生成号未变且凭据可用且结构安全时不重写、不重启 Docker、不重装 Compose |

### 正常轮换步骤

```text
1. 在 TCR 侧 provision / 启用新凭据（旧凭据暂时保持有效）
2. 更新 repository-level Actions secrets.TCR_USERNAME / secrets.TCR_PASSWORD
3. 递增 vars.TCR_CREDENTIAL_VERSION（例如 2 → 3）
4. 运行 Production Worker reconcile（merge 后自动触发，或手工 dispatch）
5. 确认输出 TX2_PRODUCTION_WORKER_READY，且 host 上的 tcr-credential-version == 新值
6. 确认无异常后吊销旧 TCR 凭据
```

第 3 步是关键：只改 secret 而不递增生成号不会触发重写（host 会认为已收敛）。第 6 步之前旧凭据
仍需有效，否则轮换窗口内的拉取会失败。若登录失败或安装后验证失败，manifest 会在日志中给出原因，
host 保持旧凭据与旧生成号 —— 不会报告 ready，也不会虚报新生成号。

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
2. GitHub：repository-level Actions 必须提供 secrets.TCR_USERNAME / secrets.TCR_PASSWORD，
   以及 vars.TCR_CREDENTIAL_VERSION（正整数生成号；缺失或非法即 fail closed）；
   仓库 variables TCR_REGISTRY / TCR_NAMESPACE 必须指向 TCR
3. dispatch `Production Worker`（或在 main 上改动 deploy/production-worker/** 触发）
   → 冻结 exact main → 读取 TX2 profile → 准备 staging root → stage 本 owner 的脚本
   → 取 TX2 主机锁 → install（Compose / mirror / root 凭据）→ verify
4. 期望输出 TX2_PRODUCTION_WORKER_READY；任一检查失败都会 fail closed，不会留下
   “部分 ready” 状态
```

没有 Compose、mirror 或凭据需要手工保留：它们全部由该 owner 重建。

## 仍未授权

```text
把 Business API / Keycloak / PostgreSQL / Caddy 放到 TX2
改变 AI service 的生产归属（当前 Yecao，`10.20.0.2:8089`）
创建/采纳除已有 Frontend replica 之外的生产 Komodo Stack
修改 K6B placement、Caddy upstream、DNS 或公网流量（已评审的 K7C frontend pool 除外）
启用 ResourceSync 自动 apply、managed=true、delete=true
```

## 参考

- Periphery 边界：`docs/operations/komodo-periphery.md`
- Komodo 声明式资源（K4.1）：`docs/operations/komodo-resource-sync.md`
- TX service plane 与 K6B baseline：`docs/operations/tx-service-plane.md`
- Frontend replica owner：`.github/workflows/frontend-replica.yml`
- 当前 TX1 + TX2 Frontend 双实例拓扑：`docs/architecture/TECHNICAL_EVOLUTION.md`
