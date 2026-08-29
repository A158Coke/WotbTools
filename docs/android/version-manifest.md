# Android version.json 契约

位置：`https://wotbtools.com/download/android/version.json`（同源静态文件）。

```json
{
  "schemaVersion": 1,
  "latestVersionCode": 12,
  "latestVersionName": "1.2.0",
  "minSupportedVersionCode": 10,
  "nativeBridgeVersion": 1,
  "apkUrl": "https://wotbtools.com/download/android/wotbtools-android-v1.2.0.apk",
  "sha256": "<hex>",
  "publishedAt": "2026-08-28T00:00:00Z",
  "releaseNotes": "修复 Android 回放导入问题"
}
```

## 字段

| 字段 | 必填 | 说明 |
|---|---|---|
| `schemaVersion` | ✓ | 固定 `1` |
| `latestVersionCode` | ✓ | 最新 versionCode（单调递增） |
| `latestVersionName` | ✓ | 最新 versionName（如 `1.2.0`） |
| `minSupportedVersionCode` | ✓ | 低于该值 → 强制更新 |
| `nativeBridgeVersion` | ✓ | Native Bridge 版本（capability 探测用） |
| `apkUrl` | ✓ | APK 同源地址 |
| `sha256` | ✓ | APK 完整性 sha256 小写 hex |
| `publishedAt` | ✓ | ISO-8601 UTC |
| `releaseNotes` | ✗ | 发布说明（下载页展示） |

不做 `forceUpdate` 这类重复状态（规格 §13）；强制更新由
`installed < minSupportedVersionCode` 派生。

## 来源

下载页与 App updater 共用同一份 `version.json`（规格 §91）。由
`android-release.yml` 在 APK 上传且可访问后再生成/发布（原子发布，规格 §60）。手工/回滚调整也只改
`latestVersionCode` / `minSupportedVersionCode` / `apkUrl`，不得引入 `forceUpdate`。

## nginx 托管

`deploy/nginx/nginx.conf`：

- `location = /download/android/version.json` → `no-store`（App 每次启动拉最新）
- `location /download/android/` → `try_files $uri =404`（不 fallback 到 SPA index.html）

compose 把宿主 `/opt/wotb/android-release` bind-mount 到容器
`/usr/share/nginx/html/download/android`（read-only）。
