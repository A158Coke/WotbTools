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

**前端不再支持的 bridge 版本必须靠强制更新收敛**：前端 `SUPPORTED_NATIVE_BRIDGE_VERSIONS`
是「这个 Web 版本还能服务哪些 Native 世代」的唯一声明。当一次发布把线上正在使用的
`version.json:nativeBridgeVersion` 从前端支持集合里移除时（Android 2.0：1 → 2），
`guard_bridge_covered` 要求 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 已经 ≥ 本次发布的
`versionCode`；否则 release 在 build 之前 fail closed，并给出需要设置的确切变量值。
这条 guard 存在的理由：不设变量时 manifest 会带着默认 `1000000` 发布，1.4.x 客户端只会看到
「可选更新」，可以继续用一个本前端已经无法服务的 wire contract。

## 自动发布与恢复

`.github/workflows/android-release.yml` 监听 `main` push；`workflow_dispatch` 只用于重跑/恢复，
没有版本输入，`android-vX.Y.Z` tag push 保留为兼容入口。所有入口 checkout 固定 source SHA，
版本来自 committed properties，tag 必须与该版本一致。生产比较规则为：仓库版本较新则发布，
相同则验证不可变 APK 后安全 no-op，仓库版本较旧则 fail-closed；`ANDROID_MIN_SUPPORTED_VERSION_CODE`
仍独立控制强制更新门槛。

发布顺序是：source/contract/version gate → production preflight（含 bridge cutover guard）
→ FE test/build → signed APK build → certificate/SHA 校验 → immutable APK 上传 → nginx 可读性
→ 线上 APK HTTP 200 + SHA 核验 → tag → **Keycloak runtime client 探测** → 最后写 `version.json`，
再做线上内容核验。`version.json` 的 `nativeBridgeVersion` 从 contract 读取，并记录 `sourceSha`；
它不会由 workflow 中的硬编码覆盖。任何 APK、tag、版本元数据冲突都拒绝覆盖或降级。

**APK staging 与 manifest publication 是分离的两步**：APK 落在最终确定性 URL
（`/download/android/wotbtools-android-v<wotbVersion>.apk`）并可公开访问，但客户端只有读到
`version.json` 才会更新 —— 因此 `version.json` 是唯一的 commit point，先 staging 后发布是安全的。

**发布前必须证明新客户端真的能用**：写 `version.json` 之前，workflow 用只读 GET 探测
`https://auth.wotbtools.com/realms/wotbtools/protocol/openid-connect/auth`
（`client_id=wotbtools-android` + 已注册的 redirect URI + `code_challenge_method=S256`），
要求 200 且不是 `Client not found` / `Invalid parameter: redirect_uri` 错误页，
最多重试约 22 分钟（吃 Keycloak apply 与本次 release 并发的时间差）。探测不通过就不发布
manifest —— 强制更新的目标不能是一个还没上线的认证路径。

## PR 门禁与 rollout

CI 的 Android Contract job 校验严格 semver、版本 code 公式、runtime change 必须递增版本、
bridge breaking change 必须递增 bridgeVersion、Gradle/contract/FE 三方一致，并覆盖 test-only、
docs-only、optional additive、breaking header/field、生产版本 older/equal/newer 分类。
`scripts/android-release/test-release.sh` 另外固定 bridge cutover guard 的五种取值
（已配置 / 未配置 / 前端仍支持旧版本 / 首次发布 / bridge 未变）。

兼容 rollout 顺序：先发布同时支持旧版和新版 Bridge 的 FE，再发布 Native Android；不能兼容时
先提高 `minSupportedVersionCode`，不得让线上旧 App 静默请求新协议。

**Android 2.0 的既有 cutover 例外（已落地）**：前端只支持 bridge v2，bridge v1 客户端属于
「不支持的 Android 客户端」—— 它们在 WebView 内**不会**回退到 keycloak-js，只会看到需要更新；
登录链本身由原生 OIDC 承担，因此 cutover 的权威顺序是：

```text
1. 设置 GitHub Actions variable ANDROID_MIN_SUPPORTED_VERSION_CODE = 2000000（2.0.0 的 versionCode）
2. merge PR A（同时触发 keycloak.yml apply client、frontend.yml 发布 FE、android-release 构建 2.0.0）
3. android-release 最后一步探测 runtime client 通过后才写 version.json
4. 1.x 客户端读到新 manifest → 强制更新到 2.0.0
```

第 1 步必须先于 merge：它只影响下一次发布的 manifest，不会提前打断任何在线用户；漏做则
release 在 preflight 直接失败（`guard_bridge_covered`），不会静默发布一个不强制更新的 manifest。

## 签名与前置条件

正式版本使用同一 signing key。keystore 与口令只来自 GitHub Secrets，证书 SHA-256 来自
GitHub Variable；缺失或不匹配均 fail-closed。`deploy` 必须先把 nginx 的
`/download/android/` 与宿主 bind mount 正确上线，否则版本 manifest 不能安全发布。
