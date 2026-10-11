# Android 发布

## 版本与 Bridge 契约

`android/gradle.properties:wotbVersion=X.Y.Z` 是**当前源码**版本，
`versionCode=major*1_000_000+minor*1_000+patch`。stage 阶段以它为准，不接受版本覆盖；
publish 阶段的候选版本改由操作者显式指定（见下节）。
本轮新手引导与累计回放功能更新以 **2.2.0 / 2002000** 作为源码发布版本；
实际发布仍须按下面的 stage、真机验证与 publish 流程完成。
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
| stage | 校验 source/version/contract/cutover → 构建完整 Android bundle → 签名 APK → 核验 APK 内容、签名和 SHA → 上传清华副本 → **两台 origin 从副本拉取 seed（逐跳 SHA-256）** → immutable APK/tag/evidence；不写 production version.json |
| publish | `workflow_dispatch(mode=publish, version=X)`：X 的 immutable tag 决定候选 → 核验 tag target 源码、evidence、APK 字节与内嵌 bundle → Keycloak/API/资产就绪探测 → 最后上传 version.json；不重建、不重新签名 APK |

生产版本较旧时继续，相同版本验证元数据和 SHA 后 no-op，较新则拒绝回滚。
Tag 不得 repoint；已有 APK SHA 不同则拒绝覆盖。已有 staging evidence 必须与本次实际 APK
身份逐字段匹配，重跑保留其原始 `stagedAt`，不能用新身份覆盖旧证据。

### APK 公网下载卸载（清华云盘直链）

TX1 出口公网带宽有限且会被 15MB 的 APK 下载打满，stage 阶段以 `TSINGHUA_CLOUD_TOKEN`
把 APK 传进清华云盘
`个人资料库 /wotbtools-android/` 目录（`replace=1` 覆盖同名文件；`reuse=1` 只是幂等令牌，**不是**覆盖开关——缺 `replace` 时同名上传会被改名 `filename (1).apk`，固定下载路径拿不到新副本）。TX1 Caddy 把
`/download/android/*.apk` 302 到该目录的分享直链
`https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/<apkName>&dl=1`，
分享链接无过期、不随版本变化，新增版本只需把文件放进目录即可生效。

**两台 origin 的 APK 由该副本 seed（2026-10-08 优化）**：跨洋只发生一次——runner 只把 APK
上传到清华副本（实测 15MB ≈ 75–108s），随后 TX1/TX2 各自从分享直链**拉取**（实测
0.70s / 0.81s，≈19–22 MB/s），取代旧的 `appleboy/scp-action` 直推（drone-scp 的 SFTP
单流，美区 runner → 境内 VPS 实测 12.6–13.8 KB/s，15MB 要 18–21 分钟 × 2 台，占 stage
job 约 89%）。拉取侧四道边界：
① 就地 `sha256sum -c` 比对 staged SHA，不符即删临时文件并 fail-closed——绝不把坏字节
落成 origin（旧 scp 直推上传后不校验 origin 字节，这是顺带补上的缺口）；② 先写
`*.partial.<pid>` 再同目录 **hard link（`ln`）原子 no-clobber 落位**：nginx 永不读到半截
文件，且目标已被并发写入时 `ln` 原子失败、绝不覆盖（旧 scp 中断会留下半截文件并被
nginx 服务，且直推是覆盖写）；③ `ln` 失败即比对目标现有 SHA-256——与 staged SHA 相同视为
「并发进程已放入同一份 immutable 字节」（视为已完成），不同则打印
`immutable origin conflict … refusing to overwrite` 并 fail-closed；④ 触发条件仍是 origin
`apk_absent`（幂等：equal 跳过、清华 `replace=1` 覆盖自愈）。
②③ 一起覆盖了 classify 快照与落位之间窗口内的第三方写入（manual SSH / 恢复脚本等）：
「classify 发现 absent」不再是覆盖许可，immutability 由落位本身保证。

**Origin 与分发副本是两个身份，判定源必须分开：**

- Origin identity：TX1/TX2 上的 immutable APK 本体。stage 的 absent/equal/conflict 分类
  用 **SSH 直查两台 origin**（远端 `sha256sum`），conflict 仍然 fail-closed。绝不用公网 URL
  做该判定——`*.apk` 已被 302 到网盘，副本损坏时公网 URL 会把 rerun 误判成 conflict
  直接失败，而能修复副本的清华覆盖上传又被同一失败挡在后面，不可自愈。SSH 探测协议还
  区分「远端显式回答文件不存在」与「探测本身失败」，后者直接失败本步骤，绝不降级成 absent
  （否则 seed 会覆盖一个 SHA 不符的 origin 文件，销毁 immutable 冲突证据）。
- Distribution replica：清华云盘。不参与 immutable 判定；stage 每次执行都会 `replace=1` 覆盖同名文件（`reuse=1` 幂等令牌）
  覆盖上传 + 「分享直链下载回来 SHA-256 与 staged APK 一致」校验，因此副本缺失/损坏在
  任意重跑中都会被无条件修复（「重跑安全」指的就是这一层）。它同时是 **origin 的冷启动源**
  （两台 origin 从这里 seed）；副本字节若损坏，seed 步骤的就地 SHA 校验会在写入 origin 前拦下
  （fail-closed），不会污染 immutable 权威。
- 公网 URL（wotbtools.com → 302 → 网盘）只做最终端到端复核，从不作为状态判定源。

- URL 契约不变：`version.json` 的 `apkUrl` 仍是 `https://wotbtools.com/download/android/<apk>`，
  客户端跟着 302 走；`/download/android/version.json` 与 `*.staging.json` **不在**重定向范围内，
  仍由 TX1/TX2 前端源站服务（deploy 预检的运行时内容一致性比对不受影响）。
- fail-closed：该云盘部署「上传成功也返回 HTTP 400」是已知怪癖，workflow 不以响应码判定成败，
  以「分享直链下载回来 SHA-256 与 staged APK 一致」为唯一门禁。
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

### 证据的存续：两台 origin 都必须持续可读，且安装与换树互斥

publish 的第一步就是按公开 URL 取证据（`https://wotbtools.com/download/android/<STAGING>`，经 Caddy
在 TX1/TX2 之间负载），因此证据不是「写一次就结束」的中间产物：

- stage 先把它传进各自宿主**不被服务**的中转目录（`/opt/wotb-tx{,2}/android-evidence.incoming`），
  再由 `deploy/tx/install-staging-evidence.sh` 在**宿主部署锁**（TX1 `/opt/wotb-tx/.deploy.lock`、
  TX2 `/opt/wotb-tx2/.deploy.lock`）下同文件系统 rename 进被服务目录。锁下 rename 同时给两侧保证：
  安装与 Replica 的「扫描 → 整树替换」互斥，且读取侧永远看不到半截 JSON。
- TX2 那棵树由 Frontend Replica 的 `deploy/tx/k7c-sync-runtime-content.sh` 整树替换，而该调用已在
  `exec 9>/opt/wotb-tx2/.deploy.lock` + `flock` 内（锁覆盖 sync 的扫描与 swap）。它按设计只复制
  当前公开面（`version.json` + 该 manifest 指向的 APK），`*.staging.json` 是唯一例外：未发布版本的
  记录必须整份带走，否则证据在发布前消失，公开 URL 退化成按 origin 掷硬币（2026-10-09 实测：
  stage 08:57 自校验通过，Replica 08:57 换树删掉 TX2 副本，publish 09:00 抽到 TX2 得到 404 而
  fail closed）。只把复制点前移到 swap 前一刻**不够**：扫描结束后、换树前落地的写入仍会随旧树进
  `.previous`，互斥才是那个不变量（评审 P1）。K7C 侧口径见
  [operations/komodo-k7c-frontend-cutover.md](../operations/komodo-k7c-frontend-cutover.md)。
- 不变量由 `deploy/test-k7c-runtime-content.sh` 锁定：静态部分断言 Replica 在同一步里先取锁再跑
  sync、stage 只经安装器在锁下落位、证据绝不直接 scp 进被服务目录；行为部分用真实脚本跑真实流程
  （换树后未发布证据仍在、历史 APK 不进树、安装器在锁被占住时不可见且不落位、缺锁/缺目录/非证据
  文件一律 fail closed）。
- 人工执行 sync 必须自备同一把锁（`WOTB_TX_DEPLOY_LOCK_FILE=/opt/wotb-tx2/.deploy.lock bash
  deploy/tx/with-deploy-lock.sh …`），否则会重新引入与 stage 安装的交错。
- 因此 publish 第一步的 404 有两个已知含义：该版本从未 stage，或某台 origin 缺文件。先确认两台
  的文件是否都在，再按 stage 流程重跑该版本；**不要**在证据缺失时绕过 publish 的身份校验
  手工写 `version.json`。
- stage 末尾的「Verify production staging evidence」只对公开 URL 取样一次，命中任一 origin 即通过：
  它证明「至少一台在服务」，两台的一致性由上面的锁 + 不变量 + 契约测试保证，而不是由那次取样保证。

## 发布前真实依赖

所有探测只读且有超时，任何失败都阻止写 production version.json：

1. Keycloak `wotbtools-android` public client 与 private-scheme redirect 可用，认证走 PKCE。
2. `/api/users/profile` 真实 OPTIONS：Origin 为 appassets，Authorization 等请求头允许，
   GET/POST/PUT/PATCH/DELETE/OPTIONS 允许；ACAO 必须精确等于 appassets，不能是 wildcard，
   不启用 credentialed CORS。无 Bearer 的同一路由 GET 必须返回 401 且携带正确 CORS，证明 backend 可达。
3. APK 资产源是**本机路径** `/agent-assets`（bundle identity 钉死，见 `android_contract.py`），
   由 Native `AgentAssetProxy` 直连对象存储——原生代码不受 CORS 约束，因此本项探测的是
   **对象存储匿名可读性**：`https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com/index.json`
   GET 成功且返回 JSON object（readiness 步骤里的 `COS_BASE` 与 `AgentAssetProxy.kt` 的
   `COS_BASE` 一致，换 origin 两处同步，见 docs/operations/agent-asset-origin.md）。
   CORS/Expose-Headers 对 Android 资产链路不再适用；Gateway `/agent-assets` 反代仅服务
   未升级的旧版本 APK（历史背景：旧 APK 的 WebView fetch 走该反代并依赖网关 CORS，
   这也是旧版第 3 条探测网关 exact-origin CORS 的原因）。
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
