# Android 发布

## 版本与 Bridge 契约

`android/gradle.properties:wotbVersion=X.Y.Z` 是**当前源码**版本，
`versionCode=major*1_000_000+minor*1_000+patch`。stage 阶段以它为准，不接受版本覆盖；
publish 阶段的候选版本改由操作者显式指定（见下节）。
`contracts/android-native-bridge.json` 是协议 SSOT；Gradle、Native 与前端声明必须一致。

Native Bridge 保持 v2，Android 使用可信本地 origin `https://appassets.androidplatform.net`。
新增受信任 origin 不改变 RPC schema；删除方法、改变参数/字段类型等真实 breaking 变更仍须
递增 bridgeVersion 并同步 Native/FE。版本已经产生 immutable tag、APK 或 staging evidence
后不能复用；修改 runtime 必须选新版本。

PR B 的初始候选版本是 **2.0.1 / 2000001**。2026-10-03 的只读审计确认它没有 tag/release，
公开 APK 与 staging evidence 均为 404；已 staged 的 2.0.0 属于 PR A，不能作为 local-first APK 发布。

## 两阶段发布（stage → publish）

`.github/workflows/android-release.yml` 的默认 mode 是 `stage`；`publish` 只能手工续跑。

| 阶段 | 行为 |
|---|---|
| stage | 校验 source/version/contract/cutover → 构建完整 Android bundle → 签名 APK → 核验 APK 内容、签名和 SHA → immutable APK/tag/evidence；不写 production version.json |
| publish | `workflow_dispatch(mode=publish, version=X)`：X 的 immutable tag 决定候选 → 核验 tag target 源码、evidence、APK 字节与内嵌 bundle → Keycloak/API/资产就绪探测 → 最后上传 version.json；不重建、不重新签名 APK |

生产版本较旧时继续，相同版本验证元数据和 SHA 后 no-op，较新则拒绝回滚。
Tag 不得 repoint；已有 APK SHA 不同则拒绝覆盖。已有 staging evidence 必须与本次实际 APK
身份逐字段匹配，重跑保留其原始 `stagedAt`，不能用新身份覆盖旧证据。

### APK 公网下载卸载（清华云盘直链）

TX1 出口公网带宽有限且会被 15MB 的 APK 下载打满，stage 阶段在把 immutable APK 传到
TX1/TX2 之后，还会以 `TSINGHUA_CLOUD_TOKEN` 把同一 APK 传进清华云盘
`个人资料库 /wotbtools-android/` 目录（`reuse=1` 幂等覆盖）。TX1 Caddy 把
`/download/android/*.apk` 302 到该目录的分享直链
`https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/<apkName>&dl=1`，
分享链接无过期、不随版本变化，新增版本只需把文件放进目录即可生效。

- URL 契约不变：`version.json` 的 `apkUrl` 仍是 `https://wotbtools.com/download/android/<apk>`，
  客户端跟着 302 走；`/download/android/version.json` 与 `*.staging.json` **不在**重定向范围内，
  仍由 TX1/TX2 前端源站服务（deploy 预检的运行时内容一致性比对不受影响）。
- fail-closed：该云盘部署「上传成功也返回 HTTP 400」是已知怪癖，workflow 不以响应码判定成败，
  以「分享直链下载回来 SHA-256 与 staged APK 一致」为唯一门禁；随后的 production APK 校验
  顺着 302 对公网 URL 做全链路复核。
- 若更换网盘目录或分享链接，必须同步修改 TX1 Caddyfile 的 redir 目标与 workflow 步骤里的
  `REPO_ID` / 分享 token，两边一一对应。

### publish 的候选身份：显式版本，不是当前 main

```text
stage        → 产生不可变候选 X（tag android-vX + staging evidence X + APK X）
publish(X)   → 以 X 为候选发布；当前 main 可能已经走到 Y（Y > X）
```

`workflow_dispatch` 的 `version` 输入是 publish 的**唯一**候选入口：

- `mode=stage`：`version` 必须留空 / 被显式忽略，版本权威仍是当前 main 的 `android/gradle.properties`；
- `mode=publish`：`version` **必填**。GitHub 的 input schema 无法表达条件必填，因此 publish job 的
  第一步就 fail closed（空值或非 `X.Y.Z` 直接失败），绝不从当前 main 推导候选。

由 `version=X` 直接推导 `TAG=android-vX`、`APK=wotbtools-android-vX.apk`、
`STAGING=wotbtools-android-vX.staging.json`，再取 tag target 源码（`git archive`）读取
`android/gradle.properties`、`contracts/android-native-bridge.json`、`deploy/agent/source.json`，
得到真实的 versionName/versionCode/bridge/Agent pin。工作区的 `android/gradle.properties`
**不参与**候选身份。

当前 main 在 publish 里只负责**策略与历史**：ancestry（`tag target` 必须是 `origin/main` 祖先）、
`ANDROID_MIN_SUPPORTED_VERSION_CODE` / cutover floor、runtime compatibility（staged contract 必须
与当前 main 的 contract 一致，否则 bridge 已前进 → 拒绝）、以及 workflow 代码本身。

因此 X 在 main 前进到 Y 之后仍然可发布，当且仅当：
X 的 tag target 是当前 main 的祖先 ∧ X 身份自洽（版本/tag/evidence/APK badging/sourceSha/bridge/Agent/
bundle manifest 完全一致）∧ 当前策略允许 X（minSupported、bridge coverage）∧ 生产就绪探测通过。

任何 mismatch（请求版本 ≠ tag target 版本，请求版本 ≠ evidence/APK 版本，APK versionCode ≠
staged 源码 versionCode）一律 fail closed；`version.json` 依旧是最后一次写入。

## Schema 2 staging evidence

公开路径为 `/download/android/wotbtools-android-v<版本>.staging.json`。
证据的每个身份字段都由实际 APK 核验，并在 publish 再次验证：

| 字段 | 校验来源 |
|---|---|
| schemaVersion | 必须为 2；PR A schema 1 不能证明 local-first 运行面 |
| versionCode/versionName | staged 源码 `android/gradle.properties`（tag target）与 `aapt dump badging` 读取的 APK AndroidManifest |
| nativeBridgeVersion | immutable tag 的 bridge contract 与 APK manifest 的支持版本 |
| sourceSha/tag | immutable tag commit、APK bundle 的 buildCommit、当前 main ancestry |
| apkName/apkUrl/sha256 | 确定性发布路径与公开 APK 实际字节 |
| bundleManifestSha256 | APK 内 `assets/web/bundle-manifest.json` 的实际字节 SHA-256 |
| bundleFileCount | APK 中 assets/web 文件数，包含 bundle-manifest.json；bundle 自身 fileCount 不包含它 |
| agentWasmRelease/agentWasmCommit | tag 的 deploy/agent/source.json、bundle 身份与 pinned JS/WASM 文件 |
| runtimeOrigin/apiOrigin/assetOrigin | trusted local origin、生产 API、reviewed 固定资产 gateway |
| nativeRuntime | bridge 支持集合、native-auth capability、auth methods 与 auth event，和 tag contract 一致 |
| stagedAt | 格式合法的 UTC 时间，重跑保留 |

Bundle schema 2 的 `files` 清单列出每个内容文件的路径、大小、SHA-256。校验器对 APK 内完整
文件集合逐项核验，同时检查 entry/WASM hash、总大小和数量；工作区里的清单不能代替 APK 内容。
stage/publish/debug CI 都复用 `scripts/android-release/android_contract.py bundle`。

发布权威是已 staged APK，不是当前 main HEAD：tag target 必须包含在当前 main 历史里，但 main
可以在真机验证期间继续前进（`stage X` 之后 main 升到 `Y` 仍然允许 `publish(version=X)`）。
Android Vue 已在 APK 内，发布不依赖生产 Web `/version.json`
或 Web build commit；Web 与 Android 是独立发布产物。

## 发布前真实依赖

所有探测只读且有超时，任何失败都阻止写 production version.json：

1. Keycloak `wotbtools-android` public client 与 private-scheme redirect 可用，认证走 PKCE。
2. `/api/users/profile` 真实 OPTIONS：Origin 为 appassets，Authorization 等请求头允许，
   GET/POST/PUT/PATCH/DELETE/OPTIONS 允许；ACAO 必须精确等于 appassets，不能是 wildcard，
   不启用 credentialed CORS。无 Bearer 的同一路由 GET 必须返回 401 且携带正确 CORS，证明 backend 可达。
3. APK 声明的 `https://wotbtools.com/agent-assets/index.json` GET 成功，返回 JSON object，
   并允许精确 appassets origin。受信任响应必须 expose Content-Disposition、X-Request-ID 和 X-Map-Meta，
   使 3D 地图元数据可由本地 WebView 读取。Gateway 在 Web catch-all 前固定转发已审计资产源，
   剥离 `/agent-assets` 前缀；不使用 arbitrary URL proxy。
4. `ANDROID_MIN_SUPPORTED_VERSION_CODE >= 2000001` 且不超过 latestVersionCode。
   Bridge 已是 v2 也不能绕过这条门槛：PR A 2.0.0 仍依赖远程 Web frontend。
   后续 patch 可保持 2000001 floor，不要求每次 patch 强制全部客户端更新。

Native Bearer runtime 请求头集合为 Authorization、Content-Type、Content-Encoding、Accept；
Content-Encoding 用于 AI gzip。跨站 Cookie 和 WebView Keycloak 不属于这条发布链。

## Rollout 与验证

先上线 production API exact-origin CORS、reviewed asset gateway 与 Keycloak client，再 stage。
完成 B13/B14 物理 Android 矩阵后才手工 `workflow_dispatch(mode=publish, version=<已 staged 版本>)`。
没有物理设备时不能把真机项目标为 PASS，production version.json 保持不变。

`scripts/android-release/test-release.sh` 覆盖版本/幂等分类、cutover floor、schema2 stage/publish
roundtrip、每个证据字段被破坏时 fail-closed、APK 文件损坏、真实版本不符、CORS wildcard/
credentials/headers/methods/HTTP 错误；同时锁定 publish 不重建与 version.json 最后写入，并覆盖
publish 候选解析（staged 2.0.1 + main 已到 2.0.2 仍选中 2.0.1、缺版本、未 staged 版本、
tag target 版本不符、staged 源码不自洽）。
`scripts/ci/test-workflow-contract.sh` 校验 owner 与实际 workflow 接线（含显式 `version` 输入、
publish 不读当前 main 版本、version.json 由 staged 身份写出）。
CI 还构建 debug APK，验证本地启动/Bridge/replay 合约及离线 bundle；真机仍负责实际 WebView、
OEM Intent、native auth/refresh/process-death、飞行模式冷启动与本地回放全链路。

## 签名与基础设施

正式版本保持同一 signing key。keystore/口令来自 GitHub Secrets，证书 SHA-256 来自 GitHub
Variable；缺失或不匹配均 fail-closed。`/download/android/` 的 bind mount 必须先上线。
`version.json` 是唯一强制更新 commit point，必须在上述身份与就绪检查之后作为最后一次上传。
