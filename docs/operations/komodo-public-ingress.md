# Komodo 公网入口

Komodo 控制平面在 Yecao 上**私有**运行（`deploy/komodo`）：Core 只绑定
WireGuard 地址 `10.20.0.2:9120`，MongoDB 不发布任何宿主端口。
本文覆盖其上的公网入口，该入口完全由 TX Caddy 网关拥有。

```text
Browser
   ↓
https://komodo.wotbtools.com
   ↓
TX Caddy  118.25.18.105:443
   ↓ WireGuard
10.20.0.2:9120
   ↓
Komodo Core（Yecao，私有）
```

## 职责归属

| 关注点 | 负责方 |
| --- | --- |
| `komodo.wotbtools.com` DNS 记录 | Komodo controller OpenTofu root（`infra/tofu/komodo`） |
| TLS 证书 + 公网 HTTP ingress | TX Caddy owner（`deploy/tx/Caddyfile`、`.github/workflows/caddy.yml`） |
| Komodo Core / MongoDB 运行时、已部署的 release | Komodo controller owner（`deploy/komodo`、`.github/workflows/komodo-controller.yml`） |
| WireGuard 传输 | 现有 host/network ownership |

这些边界是刻意的，并由契约测试强制：

- **Caddy 从不读取 Komodo 的 release pin。** Caddy 拥有的是*「公网流量是否正确到达私有 Core」*，
  而不是*「部署的是哪个 Core release」*。这正是 `deploy/komodo/**` **不**作为 Caddy 生产输入的原因：
  Komodo 版本升级本身不得让网关重跑或失败。
- **Komodo 文档不是 Komodo 生产输入。** 本文件放在 `docs/` 下，正是为了让文档变更无法触发
  Komodo controller 路径过滤下的 Core/Mongo/DNS reconcile。

## 路由

`deploy/tx/Caddyfile`：

```caddy
komodo.wotbtools.com {
	reverse_proxy 10.20.0.2:9120
}
```

Host header 保持原样，因为 `KOMODO_HOST` 已经是 `https://komodo.wotbtools.com`。Caddy 通过其常规
自动 HTTPS 流程获取证书；DNS 记录已经指向 TX（`118.25.18.105`），因此不需要任何手工证书操作。
Yecao 上不发布任何 Komodo 相关内容，也没有中间容器代理它。

## 验证

`.github/workflows/caddy.yml` 按以下顺序分两层证明该路由，因此失败可归因：

1. **私有上游（TX → WireGuard → Yecao）。**
   `http://10.20.0.2:9120/version` 必须应答并报告语义化版本
   （`^[0-9]+\.[0-9]+\.[0-9]+$`）。失败报告为
   **WireGuard / Yecao / Komodo Core** 问题。
2. **经可信 TLS 的公网路由。**
   `https://komodo.wotbtools.com/version` 必须返回**与私有上游报告的完全相同的值**，
   并且 `https://komodo.wotbtools.com/` 必须应答。
   失败报告为 **Caddy / TLS / DNS** 问题，并打印 Caddy 容器日志尾部。

把公网值与私有值比较——而不是与某个版本常量比较——才是可长期成立的 Caddy 不变量：Caddy 无需
知道部署的 Core 是 `2.3.3`、`2.4.0` 还是其他版本。`/version` 在 Komodo 2.3.3 中无需认证，
因此从不使用管理员凭据，也从不关闭 TLS 校验（契约测试禁止 `curl -k` / `--insecure`）。

重试预算限定在 SSH 步骤的 `command_timeout: 30m` 之内（私有 10 × 12 s、公网 20 × 12 s，
外加既有检查）。

### 路由清单守卫

`deploy/tx/validate-caddy-config.sh` 在每次 staged Caddy 上线（PR CI 与生产）之前运行，
并断言已评审的 public site 清单：

- `wotbtools.com` → `wotb-frontend:80`
- `auth.wotbtools.com` → `keycloak:8080`
- `monitor.wotbtools.com` → `10.20.0.2:3000`
- `komodo.wotbtools.com` → `10.20.0.2:9120`
- `www.wotbtools.com` → 永久重定向到 `https://wotbtools.com`
- TX 本地的 `/_wotb/ready` readiness 面仍然存在
- 任何位置都**没有 Yecao 公网地址**，且没有已评审集合之外的上游

只有在此之后，它才通过 compose service 定义运行真正的 `caddy validate`。PR CI（`ci-caddy.yml`）
调用完全相同的入口，因此 pull request 验证的内容就是生产 stage 的内容。本地 fixture 位于
`deploy/test-caddy-route-inventory.sh`。

既有网关检查（www/HTTP 重定向、`/api/health`、Keycloak OIDC discovery、`assetlinks.json`）
保持原有顺序与内容，因此 Komodo 问题永远不会掩盖网关回归。

## 人工验收

```sh
curl -fsS https://komodo.wotbtools.com/version   # the deployed Core release, e.g. 2.3.3
curl -fsSI https://komodo.wotbtools.com/         # successful HTTP response
```

然后打开 `https://komodo.wotbtools.com`，用现有 `KOMODO_INIT_ADMIN_PASSWORD` 以 `admin` 登录。
管理员密码从不在 CI 中打印或存储。

## 失败语义

| 情形 | 行为 |
| --- | --- |
| TX 无法访问 Core | Caddy 验证失败并给出 WireGuard/Yecao/Core 消息。不会自动触碰任何 Komodo 运行时 |
| Core 返回非语义化版本 | 同上（私有层要求语义化版本） |
| 公网 HTTPS 可用但报告不同版本 | Caddy 验证失败并给出 Caddy/TLS/DNS 消息，同时打印 Caddy 日志尾部 |
| 部署后公网 HTTPS 失败 | workflow 失败；私有层成功永远不算公网成功 |
| Caddy 配置无效 | `validate-caddy-config.sh` 在 staging 阶段失败，因此线上网关不会被 promote |
| DNS 不可用 | 本 ingress owner 从不创建或改写 DNS；该记录仍由 OpenTofu 拥有 |

## 回滚 / 退役公网入口

当前 Caddy route inventory 把 `komodo.wotbtools.com` 作为强制 reviewed route：
`deploy/tx/validate-caddy-config.sh` 要求该 upstream 存在，
`deploy/test-caddy-route-inventory.sh` 明确拒绝删除该 site block 的 Caddyfile，
Caddy workflow 也继续探测该 public endpoint。因此不能只删 Caddy site block。

退役公网入口必须在同一个已评审改动中同步：

1. 修改/删除 `deploy/tx/Caddyfile` 的 `komodo.wotbtools.com` site block；
2. 更新 `deploy/tx/validate-caddy-config.sh` 的 route inventory；
3. 更新 `deploy/test-caddy-route-inventory.sh` 的 fixture 与断言；
4. 更新 `.github/workflows/caddy.yml`（及 `ci-caddy.yml`）中要求该 endpoint 的探针；
5. 运行 Caddy config 与 route inventory 回归。

DNS 记录和私有 Komodo Core 可以保留；它们不依赖公网 Caddy route。

## 不在范围内

Periphery、TX/Yecao server registration、Resource Sync、Stacks、Deployments、
Actions、Procedures、任何 workload 迁移、Komodo 管理的 Caddy 或 OpenTofu、
OIDC/SSO，以及任何 Mongo/Komodo 备份策略。
