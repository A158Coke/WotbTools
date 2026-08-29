# Android Replay Intent

## 支持通道（V1 单个）

- **App 内选择**：现有 Vue `<input type="file" accept=".wotbreplay">`（`FileUploader.vue`）。
- **Share to WotBTools**：`ACTION_SEND`，`content://` URI。
- **Open With WotBTools**：`ACTION_VIEW`，文件管理器 → `content://` URI。

`ReplayIntentHandler` 只提取 `name/uri/size`，**不解析 replay**；业务校验（`.wotbreplay`、
20 MiB / 100 文件 / 200 MiB）沿用现有 `frontend/src/utils/replayUpload.js` 与后端 validator
（Kotlin 不复制，规格 §40）。

## 交接机制（避免 Base64，规格 §38/§39）

```text
ACTION_SEND / ACTION_VIEW
  → external content URI（ContentResolver 读取，不依赖真实路径）
  → 最小验证(.wotbreplay) + 复制到 app private cache
  → app-owned FileProvider URI（不把任意 external content:// URI 直接交给 WebView）
  → NativeBridge 持有 pendingReplay
  → Vue 端 useNativeReplayImport 点击隐藏 <input type="file" accept=".wotbreplay">
  → WebView onShowFileChooser 把该 FileProvider URI 回传给 input
  → 现有 FileUploader → validateReplaySelection → /api/replay/processing-jobs
```

非 `.wotbreplay` candidate 安全忽略（返回 null，不交给 Web upload pipeline）。`allowContentAccess=false`
与 app-owned FileProvider URI 兼容（不再依赖 WebView 直接读取 external content URI）。上传/消费完成后
清理缓存文件，启动时清理 orphan cache。

Web 端**不跨页跳转到上传页**：导入发生在 Replay Payload 页，直接消费 pending replay
（Cold/Warm/Background 三种生命周期均覆盖，规格 §43–§45）。

## 生命周期

- Cold Start：`onCreate` 解析 intent → 存 pending → 启动门禁 → Web ready → 导入。
- Warm Start：`onNewIntent` → `window.wotbtoolsOnReplay` 通知 Web 导入。
- Background Resume：webview 已存在，`onResume` 后由 `useNativeReplayImport` 消费。

## 待真机验证（规格 §35 / §84）

`.wotbreplay` 无可靠标准 MIME。实现用保守默认，最终按真实 WoT Blitz Android 导出记录
`action / mime / scheme / URI / displayName / size / flags` 调优 Intent Filter；
禁止未经验证用 `*/*`，避免出现在无关分享菜单。模拟器不能代表真机 Intent 行为。
