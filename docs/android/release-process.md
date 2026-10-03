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

## 两阶段发布（stage → publish）

`.github/workflows/android-release.yml` 监听 `main` push（`android/gradle.properties` 变化）与
`android-v*` tag push，并提供 `workflow_dispatch` 手工入口。手工入口有一个 `mode` 输入：

| mode | job | 做什么 |
|---|---|---|
| `stage`（默认） | `stage` | 构建 / 签名 / 上传 immutable APK / 建 tag / 写 **staging evidence**。**绝不写 production `version.json`** |
| `publish` | `publish` | 真机 A14 验证通过后手工续跑：复用已经 staged 的 APK，证明四件事后写 `version.json`（唯一 commit point） |

所有入口 checkout 固定 source SHA，版本来自 committed properties，tag 必须与该版本一致。
生产比较规则为：仓库版本较新则继续，相同则验证不可变 APK 后安全 no-op，仓库版本较旧则 fail-closed。

### 阶段 1：stage（自动）

```text
source/contract/version gate
→ production preflight（幂等分类 + tag 冲突检查）
→ FE test/build（bridge 契约一致性）
→ signed APK build → certificate/SHA 校验
→ immutable APK 上传（确定性 URL）→ nginx 可读
→ 线上 APK HTTP 200 + SHA 核验
→ tag（已存在则校验指向，绝不 repoint）
→ staging evidence 写入/上传/线上核验
```

**staging evidence**（`/download/android/wotbtools-android-v<版本>.staging.json`）是不可变产物身份记录：
`versionCode` / `versionName` / `nativeBridgeVersion` / `sourceSha` / `tag` / `apkName` / `apkUrl` /
`sha256` / `stagedAt`。它存在的唯一目的：让阶段 2 在不重建 APK 的前提下证明「要广播的那个 APK 就是
验证过的那个」。stage 全程不触碰 production `version.json`。

### 阶段 2：publish（手工，真机验证之后）

```text
手工触发 mode=publish（checkout 当前 main 只用于 committed 元数据与 ancestry 历史）
→ contract/version gate
→ 解析 staged release 身份：
      versionName/versionCode（committed）→ immutable tag → tag target = STAGED_SOURCE
      → staging evidence.sourceSha 必须 == STAGED_SOURCE
      → 线上 APK 字节 SHA-256 必须 == evidence.sha256（绝不重建）
      → guard_staged_release_identity（tag / evidence / APK 三者一致；绝不 repoint、绝不替换）
→ minSupportedVersionCode 必须覆盖这次 breaking bridge cutover（guard_min_supported
   + guard_bridge_covered）
→ production Keycloak 有可用的 wotbtools-android（只读 GET 认证端点探测）
→ production frontend 声明支持本次 bridge 版本 + native-auth
   + guard_release_ancestry（见下）
→ 写 version.json（sourceSha = STAGED_SOURCE）→ 上传 → 线上内容核验（LAST）
```

**发布权威是已 staged 的 release 身份，不是当前 main HEAD。** Android 的版本 / tag / APK 身份都是
immutable：真机验证期间 main 完全可能前进（`A → B`），那**不能**让一个已经 staged 且验证过的版本
作废（也无法从 `B` 重新 staged 同一个 2.0.0）。因此要求的是：

```text
A = STAGED_SOURCE（tag 指向的 commit）
B = 当前 origin/main

android-v<版本> 指向 A
∧ staging evidence.sourceSha == A
∧ 线上 APK SHA-256 == evidence.sha256
∧ A 是 B 的祖先或相等（git merge-base --is-ancestor A origin/main）
```

`A == B` 从来不是要求；main 前进只影响 `A` 必须仍在 main 历史里。

**前端 ancestry 方向**（`guard_release_ancestry`，历史模型 `A ─ F ─ B`，F = 线上前端 build）：

```text
A 是 origin/main 的祖先或相等      （staged 版本属于当前 main 线）
A 是 F 的祖先或相等                （前端**包含** Android 2.0 认证 cutover）
F 是 origin/main 的祖先或相等      （前端是真实主线构建，不是分支/未知来源）
```

即：线上前端**可以**比 staged Android 更新（只要包含它），但不可以更旧、不可以来自 main 之外。

最终发布不变量（全部成立才写 manifest）：

```text
staged APK 身份正确（tag / evidence / APK SHA 三者一致，source 在 main 线内）
  ∧ production Keycloak 有可用的 wotbtools-android
  ∧ production frontend 支持 Bridge v2 + native-auth 且 ancestry 满足 A ─ F ─ B
  ∧ minSupportedVersionCode 覆盖本次 breaking bridge cutover
  ⇒ 才发布 version.json
```

**「四个 IdP 真机验证失败 ⇒ NO RELEASE」是 workflow 强制的，不是约定**：merge 之后的自动阶段
只做 staging，`version.json` 只能由 `mode=publish` 的手工续跑写入；真机验证未做或失败时，
production manifest 保持原样，1.x 客户端不会被推向一个尚未验证的客户端。

### 为什么前端就绪检查是机器可验证的

`frontend.yml` / `keycloak.yml` / Android release 是三条**互相独立**的 push workflow，不存在执行
顺序保证（不用时序假设当就绪证据）。前端 build 生成的 `/version.json`（不可缓存）包含：

```json
{
  "buildCommit": "<40 位 source SHA>",
  "buildTime": "...",
  "nativeRuntime": {
    "supportedBridgeVersions": [2],
    "nativeAuthCapability": "native-auth",
    "authChangedGlobal": "wotbtoolsOnAuthChanged",
    "nativeAuthMethods": ["authGetAccessToken", "authGetState", "authLogin", "authLogout"]
  }
}
```

`nativeRuntime` 直接取自 `frontend/src/platform/nativeBridgeContract.js`（bridge 契约声明的 SSOT），
因此不会与 bundle 里真正运行的常量漂移；`frontend/src/vite-proxy.test.js` 固定这条投影与
`contracts/android-native-bridge.json` 的一致性。publish 阶段只读地断言这个文件，不依赖任何时间/顺序假设。

## PR 门禁与 rollout

CI 的 Android Contract job 校验严格 semver、版本 code 公式、runtime change 必须递增版本、
bridge breaking change 必须递增 bridgeVersion、Gradle/contract/FE 三方一致，并覆盖 test-only、
docs-only、optional additive、breaking header/field、生产版本 older/equal/newer 分类。
`scripts/android-release/test-release.sh` 另外固定：

- bridge cutover guard 的五种取值（已配置 / 未配置 / 前端仍支持旧版本 / 首次发布 / bridge 未变）；
- **两阶段协议本身**：stage 不得写 `version.json`、必须产出 staging evidence 并核验公开 APK；
  publish 必须只能手工触发、必须复用 staged APK（不得出现构建/签名路径）、必须校验 staged 身份 /
  Keycloak client / production frontend native 运行面 / minSupported cutover，且 `version.json`
  的上传必须是最后一次产物写入。

兼容 rollout 顺序：先发布同时支持旧版和新版 Bridge 的 FE，再发布 Native Android；不能兼容时
先提高 `minSupportedVersionCode`，不得让线上旧 App 静默请求新协议。

**Android 2.0 的 cutover 顺序（已由 workflow 强制）**：前端只支持 bridge v2，bridge v1 客户端属于
「不支持的 Android 客户端」—— 它们在 WebView 内**不会**回退到 keycloak-js，只会看到需要更新；
登录链本身由原生 OIDC 承担，因此权威顺序是：

```text
1. 设置 GitHub Actions variable ANDROID_MIN_SUPPORTED_VERSION_CODE = 2000000（2.0.0 的 versionCode）
2. merge PR A
   → keycloak.yml apply wotbtools-android client
   → frontend.yml 发布支持 Bridge v2 + native-auth 的前端
   → android-release 自动进入 stage：构建 2.0.0、上传 APK、建 tag、写 staging evidence
     （production version.json 不变 → 1.x 此时仍可正常使用旧版本）
3. 真机 A14 矩阵：QQ 首登 / QQ 已授权 / WG ASIA / WG EU / WG NA / 取消 / 错误回调 / logout→再登录 /
   换账号 / refresh / process death / HTTPS App Link / private scheme / 登录中收 replay / 未登录 replay
4. 全部通过后手工 dispatch android-release（mode=publish）
   → 校验 staged 身份 + Keycloak client + 前端 native 运行面 + minSupported 覆盖
   → 写 version.json（commit point）
5. 1.x 客户端读到新 manifest → 强制更新到 2.0.0
```

第 1 步必须先于 merge：它只影响下一次发布的 manifest，不会提前打断任何在线用户；漏做则
publish 在 `guard_bridge_covered` 直接失败，不会静默发布一个不强制更新的 manifest。

## 签名与前置条件

正式版本使用同一 signing key。keystore 与口令只来自 GitHub Secrets，证书 SHA-256 来自
GitHub Variable；缺失或不匹配均 fail-closed。`deploy` 必须先把 nginx 的
`/download/android/` 与宿主 bind mount 正确上线，否则版本 manifest 不能安全发布。
