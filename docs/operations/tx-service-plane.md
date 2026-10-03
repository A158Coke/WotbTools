# TX1 WireGuard service plane（K6A）

K6A 在 TX1 现有 Docker-local production plane 之外增加私有跨宿主入口。
这些 Compose 定义需合并后经各服务 owner 部署；本文件是验收流程，不是生产已完成证明。
K6A COMPLETE 必须同时证明新 WG plane 与原有 production plane 正常。

## Endpoint contract

| Service | TX1 WG TCP endpoint | Container port | 保留的 loopback administration |
|---|---|---|---|
| Frontend | 10.20.0.1:8081 | 80 | — |
| Business API app | 10.20.0.1:8087 | 8087 | — |
| Business API management | 10.20.0.1:8088 | 8088 | — |
| Keycloak | 10.20.0.1:8080 | 8080 | 127.0.0.1:18080 |
| Keycloak PostgreSQL | 10.20.0.1:15432 | 5432 | 127.0.0.1:15432 |
| Business PostgreSQL | 10.20.0.1:25432 | 5432 | 127.0.0.1:25432 |

Loopback 供宿主本地管理/OpenTofu；WG endpoint 供私有跨宿主访问。唯一公网 HTTP/HTTPS
ingress 仍是 Caddy 的 80/443。UFW inactive 不允许使用 wildcard/public bind；
服务入口只接受表中精确 TCP 绑定，禁止 `0.0.0.0`、`::`、公网 IP 或裸 `5432` 发布。
两套 PostgreSQL 可同时在不同宿主地址上使用相同的各自 host port。

现有生产依赖仍为 frontend → `http://business-api:8087`、business-api →
`business-postgres` / `http://keycloak:8080`、Keycloak →
`jdbc:postgresql://keycloak-postgres:5432/...`。Caddy 的 Web/Auth upstream 保持
`wotb-frontend:80` / `keycloak:8080`；monitor/komodo upstream 保持
`10.20.0.2:3000` / `10.20.0.2:9120`。Yecao AI `10.20.0.2:8089` 与 Loki
`10.20.0.2:3100` 也保持原样。K6A 不引入 logical endpoint 变量，不迁移任何 workload。

## Repository acceptance

`deploy/tx/runtime-check-lib.sh:assert_tx_service_ports` 比较 native Compose JSON 的
host IP、published port、target、protocol 与数量，声明顺序不影响结果。
staged deploy 对 selected owner 在 live promote/recreate 前使用同一校验；runtime readiness
使用 `wireguard-service-plane` token 检查全部五个 owner。它替代旧的
`postgres-loopback` / `business-postgres-loopback` / `keycloak-admin-loopback` token。
原有 Docker-local HTTP/DB/业务 E2E 与受信任公网 TLS 探针继续使用；配置通过不代表 WG 实际可达。

复用的 CI 入口：

```bash
bash deploy/test-tx-runtime-config.sh
bash deploy/test-tx-runtime-check.sh
bash deploy/test-business-postgres-runtime.sh
```

前两个 fixture 分别证明 real rendered Compose/selected-owner gate 与 readiness failure。
mutation checks 覆盖缺少 WG/loopback 入口、通配/公网/无地址绑定、错误端口、UDP、重复绑定与
app/management target 混用。PostgreSQL smoke 继续使用 disposable loopback DB，验证
ownership、provider、备份恢复；不连接生产 DB。仓库 deployment validation 由 PR CI 执行。

## Post-merge production acceptance

通过现有服务 owner workflows 部署五个受影响服务；published-port 变化会 recreate 容器，
可能有短暂中断。数据库卷、512m Business PostgreSQL 限制、OpenTofu ownership/state、备份模型
均不变。不要顺带改 DNS、WG 配置、Caddy 路由、Komodo/Periphery 或生产 dependency。

TX1 先检查地址与 listener：

```bash
ip -4 addr show wg0
ss -lntp | grep -E ':(8080|8081|8087|8088|18080|15432|25432)\b'
```

预期为表中六个 WG endpoint 与三个 loopback endpoint，零新增 wildcard/public listener。
Docker 若禁用 userland proxy，`ss` 可能不显示 NAT publication；同时用各 owner 的
`docker compose ... config --format json` 和运行容器
`docker inspect --format '{{json .HostConfig.PortBindings}}' <container>` 核对精确实际绑定，
并通过下述跨宿主探测证明可达；不要仅靠配置推断连通性。

从 TX2 与 Yecao 分别执行：

```bash
curl -fsS http://10.20.0.1:8080/realms/wotbtools/.well-known/openid-configuration
curl -fsS http://10.20.0.1:8087/api/health
curl -fsS http://10.20.0.1:8088/actuator/health
curl -fsS -H 'Host: wotbtools.com' http://10.20.0.1:8081/api/health
nc -vz 10.20.0.1 15432
nc -vz 10.20.0.1 25432
```

若无 nc，可用宿主可用的等效 TCP probe；只测试 TCP connect，不为验收登录生产数据库。
8087 app 的健康路径是 `/api/health`；8088 是 management `/actuator/health`，不可混用。

随后检查现有公网路径与只读 E2E：

```bash
curl -fsS https://wotbtools.com/ >/dev/null
curl -fsS https://auth.wotbtools.com/realms/wotbtools/.well-known/openid-configuration >/dev/null
```

用现有 secret 注入流程执行 TX `deploy/tx/runtime-check.sh`，要求 `TX_RUNTIME_READY`；
不得关闭 TLS 验证或打印凭据。验收记录应保存部署 SHA、actual bindings、TX2/Yecao probe、
public TLS 与 E2E 结果；所有条件同时通过且 workload 未移动后才记为 K6A COMPLETE。

## Rollback and next phase

回退 K6A 提交，经同一批服务 owner 重新部署，移除新增 WG 绑定并保留原有管理入口。
消费者尚未切换，卷、DNS、Caddy 与数据不变，因此无需数据迁移。遵守现有宿主部署锁，
手工 mutation 必须通过 `bash /opt/wotb-tx/deploy/with-deploy-lock.sh <command...>`。
生产验收通过后，K6B 才引入 configurable logical endpoints 并切换消费者；
之后 K7 才进行首个真实 Komodo workload migration。
