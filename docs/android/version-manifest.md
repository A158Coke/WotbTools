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

`latestVersionCode`、`latestVersionName` 来自 committed `android/gradle.properties`；
`nativeBridgeVersion` 来自 `contracts/android-native-bridge.json`；`sourceSha` 是生成 APK
所 checkout 的精确 commit。workflow 只有在 APK 可访问且 SHA 校验通过、并且
`wotbtools-android` 运行时 client 探测通过之后，才写入 manifest。

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
