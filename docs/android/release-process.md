# Android 发布

## 版本与 Bridge 契约

Android 生产版本只从已提交文件读取：`android/gradle.properties` 的
`wotbVersion=X.Y.Z` 计算 `versionName` 与
`versionCode=major*1_000_000+minor*1_000+patch`。正常构建禁止依赖
`-PwotbVersionCode` / `-PwotbVersionName`；仅保留 `-PwotbVersionOverride` 作为本地开发
实验参数，生产 workflow 不传入任何版本覆盖参数。

`contracts/android-native-bridge.json` 是 Native Bridge 的机器可读唯一协议来源。
`wotbNativeBridgeVersion` 必须与它一致，前端 `nativeBridgeContract.js` 声明支持的版本也由
CI 精确校验。Native 运行时通过 `getBridgeVersion` 暴露实际版本；版本不兼容时前端停止
replay 导入并提示需要升级 Native client，不静默把协议错误当成普通导入失败。

协议的 breaking inspector 会比较 PR base 与 HEAD：删除/重命名 method、删除或改变字段类型、
新增必填参数/请求头、改变 synthetic resource URL/方法/失败语义都要求递增
`bridgeVersion`。独立新增 method 或新增 optional 字段不要求递增。Android Native、FE
兼容声明与 contract 必须在同一个 PR 中完成。

## 自动发布与恢复

`.github/workflows/android-release.yml` 监听 `main` push；`workflow_dispatch` 只用于重跑/恢复，
没有版本输入，`android-vX.Y.Z` tag push 保留为兼容入口。所有入口 checkout 固定 source SHA，
版本来自 committed properties，tag 必须与该版本一致。生产比较规则为：仓库版本较新则发布，
相同则验证不可变 APK 后安全 no-op，仓库版本较旧则 fail-closed；`ANDROID_MIN_SUPPORTED_VERSION_CODE`
仍独立控制强制更新门槛。

发布顺序是：source/contract/version gate → production preflight → FE test/build → signed APK
build → certificate/SHA 校验 → immutable APK 上传 → tag → 最后写 `version.json`，再做线上内容
核验。`version.json` 的 `nativeBridgeVersion` 从 contract 读取，并记录 `sourceSha`；它不会由
workflow 中的硬编码覆盖。任何 APK、tag、版本元数据冲突都拒绝覆盖或降级。

## PR 门禁与 rollout

CI 的 Android Contract job 校验严格 semver、版本 code 公式、runtime change 必须递增版本、
bridge breaking change 必须递增 bridgeVersion、Gradle/contract/FE 三方一致，并覆盖 test-only、
docs-only、optional additive、breaking header/field、生产版本 older/equal/newer 分类。

兼容 rollout 顺序：先发布同时支持旧版和新版 Bridge 的 FE，再发布 Native Android；不能兼容时
先提高 `minSupportedVersionCode`，不得让线上旧 App 静默请求新协议。

## 签名与前置条件

正式版本使用同一 signing key。keystore 与口令只来自 GitHub Secrets，证书 SHA-256 来自
GitHub Variable；缺失或不匹配均 fail-closed。`deploy` 必须先把 nginx 的
`/download/android/` 与宿主 bind mount 正确上线，否则版本 manifest 不能安全发布。
