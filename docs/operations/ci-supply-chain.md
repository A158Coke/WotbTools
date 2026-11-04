# CI 供应链加固基线（issue #738）

本文是 CI / supply-chain 加固的**当前状态与例外清单**（不是总账）：policy、pin 状态、
provenance 覆盖与各例外的理由。改动任何一条前先改这里。

## 1. Action pinning

**Policy**：`.github/workflows/*.yml` 里所有第三方 `uses:` 一律 pin 到 immutable commit
SHA，行尾保留 `# v<版本>` 注释维持版本可读性。第一方复用 workflow（`./.github/workflows/ci-*.yml`）
**不 pin**——它们是仓库内文件，随提交天然不可变；PR CI 的 workflow 文件取自 merge ref，
不存在 tag 漂移面。

- `scripts/ci/test-workflow-contract.sh` 锁 pin 形态：`dorny/paths-filter@[0-9a-f]{40}`、
  appleboy ssh/scp、actions/checkout 与 android-release 的 setup-node 断言都只接受
  40-hex SHA；用 tag 引用会 fail。
- 升级 action 版本的流程：改 tag 注释与 SHA 一起提 PR（用 `git ls-remote` 取
  `refs/tags/<ver>^{}` 的 peeled commit）。

## 2. Permissions

全部 workflow 已声明显式 `permissions`（无缺失项，2026-11 审计）。`contents: write`
持有者均为真写场景：`android-release.yml`（创建 release tag）、`asset-origin.yml` /
`gitee-mirror.yml`（transport ref 发布）、`update-{tankopedia,equipment,crew-skills}.yml`
（数据提交）。

**例外（特殊权限清单）**：

| 项 | 权限 | 理由 |
|---|---|---|
| `android-release.yml` stage job | `id-token: write` + `attestations: write` | APK build provenance attestation（见 §3）——OIDC 换取不可伪造的构建来源证明，不接触任何 secret，不扩大其它暴露面 |
| `codeql.yml` analyze job | `security-events: write` | 上传 SARIF 到 code scanning |

## 3. Artifact provenance

**APK**（`android-release.yml` stage）：对已签名 release APK 运行
`actions/attest-build-provenance`。验证：

```bash
gh attestation verify <apk-file> --repo A158Coke/WotbTools
```

结果绑定 source commit 与 producing workflow run；docker 镜像走 TX 内网
digest-pinned 分发（`repo@sha256:<digest>`），不在 GitHub attestation 面内。

## 4. CodeQL SAST

`.github/workflows/codeql.yml`：Java（build-mode: none）+ JavaScript/TypeScript 双矩阵，
push main + 每周计划 + 手动 dispatch。**observe 阶段**：finding 只进 code scanning UI，
不进 required gate（#738 口径：稳定低误报后才考虑接入）。

**受控 canary**：`scripts/codeql-probe/js-probe.js` 是刻意注入的注入模式（纯 Node 侧，
无消费方），其 `js/code-injection` alert 必须持续存在于 code scanning alerts——它是
「扫描真实工作」的持续证据；alert 消失 = 扫描链路断裂，先查 workflow 再查 query 套件。
扫描排除面：`frontend/dist/**`、`contracts/http/generated/**`、`frontend/src/api/generated/**`、
archfixture 测试资源。
