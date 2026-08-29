# Android 发布

## 一键发布（推荐入口）

维护者只需在 GitHub Actions 页面操作：

1. 确认 `main` 分支 CI green。
2. `Actions` → **Android Release** → `Run workflow`。
3. 输入版本号（`版本` 字段），例如 `1.0.2`。
4. 点 `Run workflow`，等待绿色。
5. 在真机上做 smoke。

Workflow 自动完成（按真实执行顺序）：版本格式 fail-fast（含 minor/patch 0..999 与
versionCode 范围校验）→ 固定使用 `main` HEAD → **preflight 幂等分类**（生产最新版本
> 本次 → 回滚拒绝；== 本次且 metadata 一致 → `already-published` 安全成功，不再构建；
== 但 metadata 不一致 → 拒绝；< 本次 → 进入发布）+ `minSupportedVersionCode` 校验 →
frontend 校验 → signing secret/keystore/alias fail-fast → `gradle assembleRelease` →
`apksigner verify` + 签名证书 SHA-256 固定校验 → SHA-256 单源 → **生产 APK 幂等分类**
（不存在 → 上传；存在且 SHA == 本次 → 复用不覆盖；存在但 SHA 不同 → immutable 冲突拒绝）
→ scp 上传 `/opt/wotb/android-release` → `chmod 644` → 生产 APK HTTP 200 + 非空 + SHA 比对
→ **tag 幂等**（仅 dispatch：不存在 → 创建；已存在且指向本次 commit → 复用；指向其它 commit
→ 拒绝 repoint）→ **最后写 `version.json`** → 生产 `version.json` jq 内容比对 →
`$GITHUB_STEP_SUMMARY`。任一关键校验失败即终态失败，fail-closed，不自动覆盖/不降级。

### 失败重跑 / 幂等语义

- 已完全发布：preflight 判定 `already-published` → 安全成功（no-op），不重新构建。
- APK 上传后失败：重跑同一版本，生产 APK 已存在；若重构建 SHA 与原 APK 相同 → 复用；
  若不同 → 按 immutable 规则失败（不会覆盖、不会双写）。
- tag 后失败：重跑时 tag 已存在且指向本次 commit → 复用；指向其它 commit → 失败。
- version.json 前失败：APK/tag 已就位，重跑只补写 `version.json`（LAST/最后发布）。

## 兼容入口：`android-v*` tag push

仍支持 `git tag android-vX.Y.Z && git push origin android-vX.Y.Z` 直接触发发布，逻辑与
一键入口完全一致（走同一套 metadata / guards / 发布协议），二者不会维护两份发布实现。
建议日常使用一键入口。

## 版本模型

`versionCode` / `versionName` / `nativeBridgeVersion` 单一来源：CI 统一解析并写入
`version.json`；`app/build.gradle.kts` 只读 `-PwotbVersionCode` / `-PwotbVersionName`
。版本不散落，禁止手工多处修改。

- 版本号必须是 `X.Y.Z`，每段为 `0` 或非零开头的整数（拒绝 `1.0.02` / `01.0.2` 等前导零，
  避免同一 versionCode 对应多个 versionName）。
- `minor` / `patch` 必须在 `0..999`，最终 versionCode 必须在 `1..2_100_000_000`（Android /
  Play Store 合法范围）；越界即 fail-fast。
- tag：`android-vX.Y.Z`（如 `android-v1.2.0`）。
- versionCode = `major*1_000_000 + minor*1_000 + patch`（单调递增）。
- 普通 Web deploy 不触发 APK 构建。

## 签名（BLOCKER）

所有正式版本用**同一把 signing key**；换 key 无法覆盖升级。key（`.jks`）与口令**不进 Git**。
CI 临时从 GitHub Secret 还原：

```
ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
```

`ANDROID_SIGNING_CERT_SHA256` 是 GitHub Actions **Variable**（public 证书指纹，不是 secret）。
首次配置需从已知生产签名证书提取。Workflow 在 build 后比对 APK signer 证书 SHA-256 与该
Variable，未配置或指纹不匹配即刻失败，不允许 fallback/skip。

> **警告**：丢失 keystore = 永远无法覆盖升级，只能发更高 versionCode 让用户卸载重装。
> 请把 keystore 备份到安全、非 Git 且可恢复的位置（密码管理器/离线/云盘）。

## 流程（.github/workflows/android-release.yml）

`workflow_dispatch`（或 `android-v*` tag）→ checkout `main`（dispatch）/tag commit（push）→
解析 + 严格校验版本（格式 + minor/patch 0..999 + versionCode 范围）→ 校验 source 为
`main` HEAD → **preflight 幂等分类**（见上，决定 `publish` 或 `already-published`）→
frontend `npm ci/test/build` → JDK 21 + Gradle 8.7 → 校验并还原 signing keystore
（fail-fast：4 个 secret 非空 → `printf '%s'` 解码 Base64 → keystore 非空 →
`keytool -list` 命中 alias；全程不打印 secret/密码/Base64/私钥）→ `gradle assembleRelease`
（注入 `-PwotbKeystore*`）→ `apksigner verify --verbose --print-certs` + 证书指纹比对 →
`sha256sum` 单源 → **生产 APK 幂等分类**（不存在/同 SHA/异 SHA 三分支）→ scp 上传
`/opt/wotb/android-release`（仅不存在时）→ `chmod 644` → 生产 APK HTTP 200 + 非空 + SHA 比对
→ **tag 幂等**（仅 dispatch）→ **写 `version.json`（LAST）** → scp 上传 → 生产
`version.json` jq 内容比对 → 汇总。

原子发布顺序：APK 可访问且内容校验通过后才更新 `version.json`，避免「强制更新但 APK 404 /
内容不一致」。

## 回滚 / 紧急封禁

- 回滚代码：重新发布**更高** versionCode 的修复 APK；禁止自动 downgrade（Android 不会）。
- 紧急封禁某版本：把 `minSupportedVersionCode` 上调（如 `1000000 → 1001000`），旧版本启动即
  进入强制更新无法进业务。

## 前置依赖

- `deploy`（nginx `location /download/android/` + compose bind-mount + `android-release`
  宿主目录）必须已上线，否则 `/download/android/*` 会被 SPA fallback 返回 HTML（危险）。
  该部署随 `deploy.yml`（main 变更）下发。
- 发布前必须配置 GitHub Variable `ANDROID_SIGNING_CERT_SHA256`（否则新 workflow 首跑按
  fail-closed 失败）。请在公共证书信息允许范围内从生产 APK 或已知 keystore 提取该指纹。
