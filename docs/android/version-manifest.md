# Android version.json 契约

位置：`https://wotbtools.com/download/android/version.json`（同源静态文件）。

```json
{
  "schemaVersion": 1,
  "latestVersionCode": 2000000,
  "latestVersionName": "2.0.0",
  "minSupportedVersionCode": 2000000,
  "nativeBridgeVersion": 2,
  "sourceSha": "<40-char commit sha>",
  "apkUrl": "https://wotbtools.com/download/android/wotbtools-android-v2.0.0.apk",
  "sha256": "<64-char lowercase hex>",
  "publishedAt": "2026-01-01T00:00:00Z",
  "releaseNotes": ""
}
```

`latestVersionCode`、`latestVersionName` 来自 staged 源码（tag target）的 `android/gradle.properties`；
`nativeBridgeVersion` 来自同一 source 的 `contracts/android-native-bridge.json`；`sourceSha` 是生成 APK
所 checkout 的精确 commit。workflow 只有在**两阶段**都通过之后才写入 manifest：

1. **stage**（main 合并后自动）：构建/签名 → 上传清华副本 → 两台 origin 从副本拉取 seed
   （逐跳 SHA-256 校验，见 [release-process.md](release-process.md)）→ 建 tag，并写一份 staging evidence
   `/download/android/wotbtools-android-v<版本>.staging.json`（记录 versionCode/versionName/
   sourceSha/tag/apkUrl/sha256/stagedAt）；**此时 production `version.json` 不变**。
2. **publish**（真机 A14 验证后手工 `mode=publish, version=<已 staged 版本>`）：以 **staged release
   身份**为发布权威 —— 显式版本决定 immutable tag 与 APK/evidence 名，tag target 的源码给出
   versionCode/bridge/Agent pin，再与 staging evidence、线上 APK 字节逐一比对（绝不重建、
   绝不 repoint tag、绝不改 evidence），并校验 Keycloak 的 `wotbtools-android` 可用、production
   frontend 支持本次 bridge 版本 + `native-auth` 且 ancestry 满足
   `staged source ─ frontend build ─ main`、`minSupportedVersionCode` 覆盖 breaking bridge cutover，
   全部成立后才写 `version.json`（`sourceSha` 记录 **APK 的 staged source**，不是发布当刻的 main
   HEAD）并回读核验。真机验证期间 main 前进不会作废已 staged 的版本：当前 main 只提供策略与
   历史，发布候选来自操作者给出的版本。

因此 `version.json` 是**唯一**的强制更新 commit point：真机验证未做或失败时，旧客户端读到的仍是
上一份 manifest。协议细节见 [`release-process.md`](release-process.md)。

> 上面的 `minSupportedVersionCode=2000000` 是 Android 2.0 的 cutover 取值：manifest 一旦指向
> bridge v2 的客户端，前端就不再服务 bridge v1，因此旧版必须是强制更新。该值来自 GitHub Actions
> variable `ANDROID_MIN_SUPPORTED_VERSION_CODE`（不在仓库内），设置时机见
> [`release-process.md`](release-process.md)。

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | ✓ | 固定 `1` |
| `latestVersionCode` | ✓ | 由 committed semver 确定，单调递增 |
| `latestVersionName` | ✓ | committed `wotbVersion` |
| `minSupportedVersionCode` | ✓ | 低于该值触发强制更新，与发布版本独立 |
| `nativeBridgeVersion` | ✓ | JSON Bridge contract 版本 |
| `sourceSha` | ✓ | APK source/tag target 的完整 SHA |
| `apkUrl` | ✓ | APK 同源地址 |
| `sha256` | ✓ | APK 完整性校验值 |
| `publishedAt` | ✓ | ISO-8601 UTC |
| `releaseNotes` | ✗ | 展示用发布说明 |

production 比较为：仓库版本大于 manifest 才发布；相同版本验证不可变 APK 后 no-op；仓库版本
小于 production 直接拒绝。`forceUpdate` 不属于契约，强制更新由
`installedVersionCode < minSupportedVersionCode` 派生。
