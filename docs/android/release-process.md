# Android 发布

## 版本模型

`versionCode` / `versionName` / `nativeBridgeVersion` 单一来源：CI 从 tag 计算并写入
`version.json`；`app/build.gradle.kts` 只读 `-PwotbVersionCode` / `-PwotbVersionName`
（规格 §90）。版本不散落，禁止手工多处修改。

- tag：`android-vX.Y.Z`（如 `android-v1.2.0`）。
- versionCode = `major*1_000_000 + minor*1_000 + patch`（单调递增）。
- 普通 Web deploy 不触发 APK 构建。

## 签名（BLOCKER，规格 §20/§21）

所有正式版本用**同一把 signing key**；换 key 无法覆盖升级。key（`.jks`）与口令**不进 Git**。
CI 临时从 GitHub Secret 还原：

```
ANDROID_KEYSTORE_BASE64 / ANDROID_KEYSTORE_PASSWORD / ANDROID_KEY_ALIAS / ANDROID_KEY_PASSWORD
```

> **警告**：丢失 keystore = 永远无法覆盖升级，只能发更高 versionCode 让用户卸载重装。
> 请把 keystore 备份到安全、非 Git 且可恢复的位置（密码管理器/离线/云盘）。

## 流程（.github/workflows/android-release.yml）

tag `android-v*` → checkout → 解析版本 → frontend test/build 校验 → JDK 21 + Gradle 8.7 →
校验并还原 signing keystore（fail-fast：`ANDROID_KEYSTORE_BASE64`/`ANDROID_KEYSTORE_PASSWORD`/`ANDROID_KEY_ALIAS`/`ANDROID_KEY_PASSWORD`
非空 → `printf '%s'` 解码 Base64 → keystore 非空 → `keytool -list` 以配置 store password 命中配置 alias；全程不打印 secret/密码/Base64/私钥）→
`gradle assembleRelease`（注入 `-PwotbKeystore*`）→ `apksigner verify` →
`sha256sum` → 上传 APK 到 `/opt/wotb/android-release` → `chmod 644` → curl 校验 APK 200 →
**写 version.json（LAST）** → curl 校验 version.json 200。

原子发布顺序（规格 §60）：APK 可访问后才更新 `version.json`，避免「强制更新但 APK 404」。

## 回滚 / 紧急封禁

- 回滚代码：重新发布**更高** versionCode 的修复 APK；禁止自动 downgrade（Android 不会）。
- 紧急封禁某版本：把 `minSupportedVersionCode` 上调（如 `10 → 11`），旧版本启动即进入强制更新
  无法进业务（规格 §62）。

## 前置依赖

首次发布前，`deploy`（nginx `location /download/android/` + compose bind-mount +
`android-release` 宿主目录）必须已上线，否则 `/download/android/*` 会被 SPA fallback 返回
HTML（危险）。该部署随 `deploy.yml`（main 变更）下发。
