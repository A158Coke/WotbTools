# Android 发布

## 版本与 Bridge 契约

`android/gradle.properties:wotbVersion=X.Y.Z` 是**当前源码**版本，
`versionCode=major*1_000_000+minor*1_000+patch`。stage 阶段以它为准，不接受版本覆盖；
publish 阶段的候选版本改由操作者显式指定（见下节）。
截至 2026-10-20，本候选源码为 **3.15.2 / 3015002**（`android/gradle.properties`），推荐卡片视觉修复见 [3.15.2](releases/3.15.2.md)。
保留 main 已合并的 3.12.0 联赛回放开赛时刻/显示与录入时区/小组号选填/三语术语修正与 71 条已核实回放、
3.11.2 推荐内容管理权限 cutover、3.11.1 3D 回放可见性/地图资产加载修复、3.10.1 全等级坦克百科资料修复
（基础资料覆盖 tiers 1–10，装备/补给建模仍限 7–10），以及 3.10.0 共享选车菜单、搜索别名、动能弹外部模块
转正/口径碾压修复，3.9.1 积分榜公开展示优化、3.9.0 工具栏折叠、3.8.1 地球图标和此前推荐目录等功能，
以及上游 **v0.4.9** WASM pin。3.12.0 已被 #672 占用，不能复用来发布本 bundle。
3.11.2 的内容管理权限修正：内容域入口与请求所有权改认 `content-admin`，`tournament-admin` 不再获得内容管理；
旧 APK 继续按 `tournament-admin` 判定，因此只持有 `content-admin` 的管理员需要更新 APK 才能管理内容；
全站管理员由 Keycloak composite 展开同时具备两个角色，不受影响。后端先行部署不会让旧 APK 失去目录。
`android-v3.10.0`、`android-v3.11.0` 与 `android-v3.11.2` 已固定旧源码身份；对应版本不能复用来发布新 bundle。
3.13.0 改变随 APK 打包的装甲查看器判定/概率与场景运行时：Armor Inspector 逐层概率、BlitzKit 逐层转正/2×、
确定性 1× 热力图、相机标定与主题场景。这是 bundled frontend/scene runtime 的行为变更，不改 wire / Bridge，
在 main 的 3.12.0 之后按 **minor** 递增为 **3.13.0**，说明见 [3.13.0](releases/3.13.0.md)。
Native Bridge 仍为 v3，最低支持版本门槛保持 `3000000`，不为这次功能强制升级。
3.12.0 保留上述 3.11.2 内容管理权限修复，新增联赛回放的可选开赛时刻、显示和录入时区切换、小组号选填，以及三语术语修正；按新增中小功能选 **minor**（3.11.2 → 3.12.0），详见 [3.12.0](releases/3.12.0.md)。
3.12.0 新增 71 条已核实回放；加上原有国服 3 条，共 74 条中英标题，20 个赛事均填完整三语名称。具体战斗时刻未知时留空，不补占位时间。
#683 已先合入 main，源码版本为 3.13.0；本次内容接口清理以它为基线递增为 **3.13.1 / 3013001**，说明见 [3.13.1](releases/3.13.1.md)。
用户确认被清理的旧联赛/推荐接口仅内部使用、尚无用户使用，本次明确例外选 patch，不升 major、不强制升级；一般版本规则不变。
本候选继承 3.13.0 的装甲查看器改动以及此前联赛三语、时间和初始化事实；不复用旧候选号，不修改历史迁移。
`android-v3.13.1` tag 已指向 `1f00bc66e75890cbe8bc116307cebffcb5ee403f`（3.13.1 已取得 immutable release identity），不能复用来承载新的 bundled frontend：
PR #688 修复教程导出/焦点与 Escape、名人堂上传弹层键盘、AI 复盘原始 Markdown 残留与战队汇总三语表头，随 APK 打包后按 **patch** 递增为 **3.13.2 / 3013002**，说明见 [3.13.2](releases/3.13.2.md)。
本次不改 Native Bridge（保持 v3）、不改 `contracts/android-native-bridge.json`、不抬 `ANDROID_MIN_SUPPORTED_VERSION_CODE`，只声明新的候选版本。
3.13.2 不涉及后端切换，仍按 stage、真机验收、publish 发布，本次不修改生产变量。
`android-v3.13.2` tag 已指向 `7749b77ada9770785f45fcbe206a30816e7af20a`（3.13.2 已取得 immutable release identity），不能复用来承载新的 bundled frontend：
PR #670 修复教程内登录 OIDC 回跳后丢失教程位置，随 APK 打包后按 **patch** 递增为 **3.13.3 / 3013003**，说明见 [3.13.3](releases/3.13.3.md)。
本次不改 Native Bridge（保持 v3）、不改 `contracts/android-native-bridge.json`、不抬 `ANDROID_MIN_SUPPORTED_VERSION_CODE`，只声明新的候选版本。
3.13.3 不涉及后端切换，仍按 stage、真机验收、publish 发布，本次不修改生产变量。
`android-v3.13.3` tag 已指向 `b333c8c8b21a7a500ae33db99fa80fefd6fff1fa`（3.13.3 已取得 immutable release identity），不能复用来承载新的 bundled frontend：
PR #685 重做首页 IA（纯展示页、Android 条件渲染、reduced-motion、Intl 数字与 `/api/hof` 合同消费），随 APK 打包后按 **minor** 递增为 **3.14.0 / 3014000**，说明见 [3.14.0](releases/3.14.0.md)。
3.14.0 已取得 immutable release identity 且已被 3.14.1 取代；不再 stage / publish 3.14.0（3014000 < 当前门槛 3014002）。
PR #694 修复移动端装甲查看器热力图面法线精度回归（`dFdx/dFdy` → flat `vNormal` + highp 视线方向），随 APK 打包后按 **patch** 递增为 **3.14.1 / 3014001**，说明见 [3.14.1](releases/3.14.1.md)。
本次不改 Native Bridge（保持 v3）、不改 `contracts/android-native-bridge.json`；按用户明确指令把 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 从 `3000000` 抬到 **`3014001`**，这是 patch 强制更新的显式例外（见下）。
3.14.1 已取得 immutable release identity（staged）；其发布流程已被 3.14.2 候选取代，不再 stage/publish 3.14.1（3014001 < 3014002，会被 floor guard 拒绝）。门槛只在 publish 时写入 production `version.json`，stage 不写。
3.14.1 已取得 immutable release identity（staged）；本次装甲查看器显示调整（相机 product 显示缩放 + 横屏手机平板式布局 + WebGL context-lost 错误反馈/重建重试）按 **patch** 递增为 **3.14.2 / 3014002**，说明见 [3.14.2](releases/3.14.2.md)。
本次不改 Native Bridge（保持 v3）、不改 `contracts/android-native-bridge.json`；按用户指令把 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 从 `3014001` 抬到 **`3014002`**（= 本版本 versionCode），这是 patch 强制更新的显式例外延续（见下）。3.14.1 不再 publish（3014001 < 3014002，会被 floor guard 拒绝）。
3.14.2 继承 3.14.1 并成为当前候选；3.14.1 若尚未 publish，由 3.14.2 取代，不再 stage/publish 旧候选。
`android-v3.14.2` tag 已指向 `5ae0cc36cf494e20dbde421d78b64263956e416f`（3.14.2 已取得 immutable release identity），不能复用来承载新的 bundled frontend：
PR #701 把装甲查看器结果卡改为概率链驱动（AP/APCR/HEAT 与命中首个 Primary 的 HE；含 0% 层链保留、纯外部命中回退确定性、同名板 occurrence 匹配与 `>99%` 显示边界），并在 Web 首页 Hero 增加 Android 下载按钮，随 APK 打包后按 **minor** 递增为 **3.15.0 / 3015000**，说明见 [3.15.0](releases/3.15.0.md)。
本次不改 Native Bridge（保持 v3）、不改 `contracts/android-native-bridge.json`；不抬 `ANDROID_MIN_SUPPORTED_VERSION_CODE`（3.14.2 的门槛继续生效），只声明新的候选版本。
3.15.0 成为当前候选；3.14.2 若尚未 publish，由 3.15.0 取代，不再 stage/publish 旧候选。
这不是线上已发布版本的证明。线上版本以 production `version.json` 回读为准，
实际发布仍须按下面的 stage、真机验证与 publish 流程完成。
`contracts/android-native-bridge.json` 是协议 SSOT；Gradle、Native 与前端声明必须一致。

Native Bridge 为 **v3**（3.0.0 起）：可信本地 origin 是 LocalRuntimeServer 的固定 loopback
`http://127.0.0.1:21653`，transport 是 GeckoView 内置扩展；RPC 方法 / 参数 / 结果 / capability 与 v2 完全相同。
v2 → v3 只因 origin 与 synthetic resource URL 改变（`android_contract.py` 把 origin 变化判为 breaking）。
前端随 APK 打包、与 Native 同版本发布，因此只声明 `[3]`；`guard_bridge_covered` 因此要求
`ANDROID_MIN_SUPPORTED_VERSION_CODE ≥ 3000000`，与 major 规则一致。注意该守卫在 **stage preflight 与
publish 两处都执行**：floor 是 stage prerequisite，必须在合并（触发自动 stage）之前设好，见下节
「强制更新门槛（minSupportedVersionCode）的抬升」。删除方法、改变参数/字段类型等
breaking 变更仍须递增 bridgeVersion 并同步 Native/FE。版本已经产生 immutable tag、immutable origin APK
或 staging evidence 后不能复用；修改 runtime 必须选新版本。

PR B 的初始候选版本是 **2.0.1 / 2000001**。2026-10-03 的只读审计确认它没有 tag/release，
公开 APK 与 staging evidence 均为 404；已 staged 的 2.0.0 属于 PR A，不能作为 local-first APK 发布。

## 版本号递增规则（major / minor / patch）

2026-10-14 用户裁示。每个改动 Android 运行时的 PR 递增 `wotbVersion` 时，按**变更等级**选位，
而不是一律 +1 patch；强制更新门槛默认只随 major 抬升（用户明确指令的 patch/minor 例外见下）。

| 等级 | 适用变更 | 示例 | 强制更新门槛 |
|---|---|---|---|
| **major** | breaking change（含 Native Bridge wire breaking、需要新客户端才能正确工作的数据/接口契约变化）、重大功能、删除功能、中大型 bug 修复 | `3.0.0` | **必须抬到该 major 的 `X.0.0`**：`ANDROID_MIN_SUPPORTED_VERSION_CODE` = `X×1_000_000`（`3000000`），随 publish 写入 |
| **minor** | 增加中小功能 | `2.6.0` | 不抬，保持现值（旧客户端只收到可选更新提示） |
| **patch** | 小 bug 修复 | `2.3.4` | 默认不抬、不强制升级；用户明确要求强制更新时为例外（见下） |

**用户指令例外（2026-10-19，3.14.1 / 3.14.2）**：用户明确要求把强制更新门槛抬到当前候选时，patch/minor 也可以抬；必须在 PR 描述、release notes 与历史门槛列表写明理由。3.14.1 是首个此类例外：`ANDROID_MIN_SUPPORTED_VERSION_CODE=3014001`（= latest）；3.14.2 继续按用户指令抬到 **`3014002`**（= latest），覆盖 patch 默认不抬门槛的惯例。

- **归零**：minor 递增时 patch 归 0；major 递增时 minor、patch 都归 0。
- **取最高**：一个 PR 同时含多个等级的改动，按最高等级递增。两次 publish 之间合并的多个 PR 各自在
  当时的 committed 版本上按自己的等级递增，最终发布版本自然体现其中最高的等级。
- **版本号在候选取得 immutable release identity 时才被消耗，不是每个 review commit 都消耗**
  （Version number is consumed when a release candidate acquires an immutable release identity,
  not for every review commit）：`wotbVersion` 固定的是**发布身份**，不是提交序号。同一个尚未形成
  immutable identity 的 PR / release candidate，在 code review、测试或真机验收过程中发生的修复
  **不因此自动递增 patch**，保持在**原计划版本**——例如 3.0.0 候选在合并前修掉了 blob 下载导航、
  响应体 ownership、下载与 picker 互斥、prompt 生命周期等 blocker，最终发布的仍然是 **3.0.0**，
  而不是 3.0.1 / 3.0.2 / 3.0.3（这些版本从未存在过）。
  一旦下列**任一**条件成立，候选版本即被锁定（version identity consumed），此后任何会改变该 staged
  Android candidate / APK identity 的源码或 release input 修改，都必须使用**更高的** `wotbVersion`：
  ① 已创建 immutable release tag（`android-vX.Y.Z`）；② staged APK 已在**任意一台** immutable origin
  （TX1 **或** TX2 的 no-clobber origin 路径）成功落位并通过 SHA-256 核验——**不需要等两台都完成**；
  ③ 已写出 staging evidence；④ production `version.json` 已 publish。
  （Any successfully materialized and SHA-256 verified APK on an immutable origin consumes the version identity.）
  **注意：不是只有 publish 之后才锁版本**——stage 阶段的 tag / 任一台 origin 上的 APK / staging evidence
  同样是 immutable identity。只有这些条件**全部尚未成立**时，同一 release PR 的 pre-release fix 才保留原版本
  ——PR 合并前（还没有 stage）通常不存在任何 immutable identity，review 修复因此不需要 bump。
  清华云盘副本（distribution replica）**不是** identity authority：它是可 `replace=1` 覆盖的分发副本 +
  origin 冷启动源，上传并核验副本本身不消耗版本（判定源划分见下文「Origin 与分发副本是两个身份」）。
  但只要**任意一台** origin 已从该副本 seed 并 no-clobber 落位成功，版本即锁定（上列 ②）。
- **锁定后哪些修改必须换版本**：会改变已锁定 Android candidate identity 的修改——Android Native 代码与
  `android/app/**`、Android 构建输入（Gradle 配置 / 依赖版本 / 工具链）、进入 APK 的 bundled frontend /
  WASM / 资产与 Android 专用生成 bundle、Native Bridge contract 与 `bridgeVersion`、以及 tag target 中任何会改变
  staged APK 字节或身份的 release input。与已 staged Android artifact 无关的修改——docs-only、Caddy-only、
  observability-only、无关后端 / 基础设施修复、不改变 staged 字节与身份的 workflow / policy 修复——可以让
  main 前进，**本身不消耗新的 Android 版本**（unrelated main evolution does not by itself consume a new Android
  version）。已完整 stage 的候选照常按自己的 tag target 发布，并且仍要通过 publish 的 ancestry / 当前 policy /
  bridge compatibility / minSupported / CORS 等就绪探测 / staged identity 守卫，没有跳过守卫的例外。
  - 允许：3.0.0 stage 成功 → Caddy 部署失败 → 只修改 `deploy/tx/Caddyfile` → main 前进 → Caddy 部署成功 →
    publish 已 staged 的 3.0.0（Caddy-only 修改没有改变 staged 3.0.0 artifact）。
  - 不允许：3.0.0 stage 成功 → 修改 `GeckoWebRuntime` / bundled frontend / Bridge contract → 仍复用 3.0.0。
    这种情况必须使用更高版本。
- **「版本已锁定」不等于「stage 已完成」**：
  - *version identity consumed*：上列四项**任一**出现即成立；
  - *stage distribution complete*：TX1 **和** TX2 都落位并核验、公网回读核验、tag、staging evidence
    全部成功。两台 origin 都成功只是 stage 分发要求完成，**不是** identity 首次成立的时点。

  partial-stage 例子：build A → TX1 seed 成功 → TX2 seed 失败 → stage 整体失败。此时 3.0.0 **已经被锁定**
  ——TX1 上已有 3.0.0 APK（build A 的 SHA）。若随后修改源码得到 build B 仍想复用 3.0.0，stage 的
  「Classify origin APK on TX1/TX2」会发现 TX1 现有 SHA ≠ build B 的 SHA → immutable conflict → fail-closed。
  补齐 TX2 只能对**同一提交**（build A 的源码提交）幂等重跑 stage：stage 只从 `origin/main` HEAD 构建，且 APK
  内嵌 `buildCommit`。main 一旦前进（哪怕只是 docs / Caddy 修改），重跑构建出的 APK 字节就不同，TX1 classify
  同样 conflict，这时只能换更高版本——这是部分 stage 无法补齐的结果，不是无关修改本身消耗了版本。
- **stage 失败后能否复用同一版本：不能只看 workflow conclusion**（A failed stage may still have consumed
  the version if an immutable artifact was already materialized），逐项只读检查：
  - tag `android-vX.Y.Z` 是否已存在（`git ls-remote --tags origin android-vX.Y.Z`）；
  - TX1 origin 是否已有 `wotbtools-android-vX.Y.Z.apk`；
  - TX2 origin 是否已有该 APK（两项都以 stage 日志「Classify origin APK on TX1/TX2」的 SSH 直查结果为准；
    不要用公网 URL 判断——它被 302 到可覆盖的清华副本）；
  - staging evidence `wotbtools-android-vX.Y.Z.staging.json` 是否已存在；
  - production `version.json` 是否已 publish 该版本。

  全部不存在 → 版本尚未被消耗，可以继续修复并复用；任意一项存在 → 版本已锁：已完整 stage 的候选可以照常
  publish（main 上的无关修改不影响它）；部分 stage 只有在 `origin/main` 仍是原提交时才能幂等重跑补齐；任何会
  改变 candidate identity 的修改都必须使用更高版本。也就是：PR 合并前的 review fix 通常保持原版本；合并后
  stage 一旦部分成功，就可能已经锁定版本，此后改变 Android candidate 的修改不能再复用 3.0.0。
- **bug 的大小**：中大型 = 影响核心结果的正确性或可用性（回放/统计/判定结果错误、崩溃、无法登录、
  数据丢失等），或旧客户端继续使用会持续得到错误结果；小 = 显示/样式/边缘场景，影响面有限。拿不准时
  由用户裁定——等级决定是否强制全部用户更新，是产品决策。
- **记录**：PR 描述写明所选等级与理由；`docs/android/releases/<版本>.md` 的
  `Minimum supported version` 行与等级一致（major 写 `raised to <新 versionCode> (<版本>)`，
  minor/patch 写 `unchanged at …`）。
- **门槛按发布候选相对线上版本判定（批量发布）**：两次 publish 之间可以合并多个 PR，最终只 publish
  其中最新的候选。门槛义务看**候选 major 与线上 `version.json` 的 `latestVersionName` major** 的比较，
  不看候选自身最后一次递增的等级：
  - 候选 major **大于**线上 major（中间合并过尚未发布的 major）⇒ publish 前必须把门槛设为候选 major 的
    `X.0.0`（`X×1_000_000`）——**即使候选本身是 minor/patch**。例：线上 2.3.3，先合并 3.0.0、再合并
    3.0.1，只 publish 3.0.1 ⇒ 门槛 = `3000000`，旧客户端被强制更新到 3.0.1；未发布的 major 的强制义务
    由最终候选继承，不会因为候选是 patch 而丢失。
  - 候选与线上**同 major** ⇒ 默认不得改动门槛（minor/patch 不强制）；用户明确指令的例外见上（3.14.1 / 3014001；3.14.2 / 3014002）。
  - 包含 Native Bridge wire breaking 时，门槛还须满足 publish 现有的 bridge / cutover 守卫（以守卫为准）。
  现有 publish 守卫在 bridge 不变时**不会**从历史推导未发布 major 的门槛要求（只校验门槛 ≤ 候选
  versionCode），这一步由操作者按本条执行。也可以选择先 publish 每个 major 再发布后续 minor/patch；
  在没有更严格的 bridge / cutover 要求时两种做法的门槛结果相同，合并发布的 wire-breaking 候选仍以
  守卫的实际要求为准。
- **major 的发布动作（顺序固定）**：① **先把仓库变量 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 设为
  `X×1_000_000`** → ② 合并候选 PR → ③ 合并到 main 后由正式 workflow 自动执行：Android 自动 stage，以及
  该 PR 一并带来的基础设施改动（如 3.0 的 `@androidLoopback` 由 `caddy.yml` 部署）→ ④ 等两者**都**成功 →
  ⑤ 真机验收 → ⑥ `publish(version=<候选>)`。变量必须在合并/stage **之前**设置——stage preflight 本身就跑
  `guard_min_supported` / `guard_local_first_cutover` / `guard_bridge_covered`，floor 没到位会 fail-closed，
  所以它不只是 publish 的前提。随候选 PR 一起改的基础设施**只能**在合并后由 main-only 的正式 workflow 部署
  （`caddy.yml` 的手动 dispatch 也只接受 `refs/heads/main` 且做 freshness 校验），不要求、也不允许在合并前
  部署——不要手工 SSH 改生产、不要从 PR 分支复制文件、不要放宽 workflow 门禁。步骤见下文
  「强制更新门槛（minSupportedVersionCode）的抬升」与「3.0.0（GeckoView）发布与回滚」。
- **发布说明**：继承门槛的 minor/patch 候选，`Minimum supported version` 行写
  `raised to X000000 (X.0.0 floor, inherited from unpublished X.0.0)`。
- **生效范围**：本规则自 2026-10-14 起生效；此前的版本（如 2.2.12、2.3.0 以 patch/minor 携带门槛抬升）
  按当时口径保留，不追溯。

## 两阶段发布（stage → publish）

`.github/workflows/android-release.yml` 的默认 mode 是 `stage`；`publish` 只能手工续跑。

| 阶段 | 行为 |
|---|---|
| stage | 校验 source/version/contract/**cutover（`guard_min_supported` + `guard_local_first_cutover` + `guard_bridge_covered`，因此 major/bridge cutover 的 floor 必须在合并/stage 之前设好）** → 构建完整 Android bundle → 签名 APK → 核验 APK 内容、签名和 SHA → 上传清华副本（distribution replica，可覆盖，不锁定版本）→ **TX1、TX2 依次从副本拉取 seed（逐跳 SHA-256，no-clobber 落位；任意一台落位即消耗版本号）** → immutable APK/tag/evidence；不写 production version.json |
| publish | `workflow_dispatch(mode=publish, version=X)`：X 的 immutable tag 决定候选 → 核验 tag target 源码、evidence、APK 字节与内嵌 bundle → Keycloak/API/资产就绪探测 → 最后上传 version.json；不重建、不重新签名 APK |

生产版本较旧时继续，相同版本验证元数据和 SHA 后 no-op，较新则拒绝回滚。
Tag 不得 repoint；已有 APK SHA 不同则拒绝覆盖。已有 staging evidence 必须与本次实际 APK
身份逐字段匹配，重跑保留其原始 `stagedAt`，不能用新身份覆盖旧证据。

### 构建身份的确定性（stage 重跑 ⇒ 同一 APK）

`frontend/vite.config.js` 的 `buildIdentity()` 把构建身份写进 bundle：`version.json` 与
`define __BUILD_TIME__`（后者内联进入口 chunk，入口内容一变会**沿 import 图级联改名**）。
因此 `buildTime` **必须是确定性的**——优先级：`SOURCE_DATE_EPOCH`（unix 秒）→ 当前 checkout 的
commit 时间 → 才回落 wall-clock（此时该构建不可逐字节复现，仅作诊断）。

- **Android bundle**（`npm run build:android`，有 .git）自动取 commit 时间 ⇒ 同一 commit + 同输入
  ⇒ 逐字节相同的 bundle/APK（stage 重跑不会再撞 immutable conflict）；
- **任何 Docker 构建**（生产镜像由仓库外构建方按本 Dockerfile 构建）必须传
  `--build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)`；`Dockerfile.frontend` 已声明该 ARG
  并转 ENV，CI 侧的 `ci-frontend.yml` 已接上。未传时回落 wall-clock，该镜像不可复现。
- 回归锁：`frontend/src/vite-proxy.test.js` 断言 `SOURCE_DATE_EPOCH` 固定 ⇒ `buildTime` 同值。

### APK 公网下载卸载（清华云盘直链）

TX1 出口公网带宽有限且会被 APK 下载打满（APK 随内嵌 bundle 增长：2026-10-16 起 2D 底图与 Web 同字节，bundle 资产约 40 MiB——见 [architecture.md](architecture.md) §2D 底图随包），stage 阶段以 `TSINGHUA_CLOUD_TOKEN`
把 APK 传进清华云盘
`个人资料库 /wotbtools-android/` 目录（`replace=1` 覆盖同名文件；`reuse=1` 只是幂等令牌，**不是**覆盖开关——缺 `replace` 时同名上传会被改名 `filename (1).apk`，固定下载路径拿不到新副本）。TX1 Caddy 把
`/download/android/*.apk` 302 到该目录的分享直链
`https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/<apkName>&dl=1`，
分享链接无过期、不随版本变化，新增版本只需把文件放进目录即可生效。

**两台 origin 的 APK 由该副本 seed（2026-10-08 优化）**：跨洋只发生一次——runner 只把 APK
上传到清华副本（实测 15MB ≈ 75–108s；**2026-10-16 起 APK 随内嵌 bundle 增大——2D 底图改为与
Web 同字节，bundle 资产约 40 MiB，下列耗时按体积比例放大**），随后 TX1/TX2 各自从分享直链**拉取**（实测
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

- Origin identity：TX1/TX2 上的 immutable APK 本体；**任意一台**落位成功即消耗该版本号（见上文
  「版本号递增规则」的 partial-stage 例子）。stage 的 absent/equal/conflict 分类
  用 **SSH 直查两台 origin**（远端 `sha256sum`），conflict 仍然 fail-closed。绝不用公网 URL
  做该判定——`*.apk` 已被 302 到网盘，副本损坏时公网 URL 会把 rerun 误判成 conflict
  直接失败，而能修复副本的清华覆盖上传又被同一失败挡在后面，不可自愈。SSH 探测协议还
  区分「远端显式回答文件不存在」与「探测本身失败」，后者直接失败本步骤，绝不降级成 absent
  （否则 seed 会覆盖一个 SHA 不符的 origin 文件，销毁 immutable 冲突证据）。
- Distribution replica：清华云盘。不参与 immutable 判定；stage 每次执行都会 `replace=1` 覆盖同名文件（`reuse=1` 幂等令牌）
  覆盖上传 + 「分享直链下载回来 SHA-256 与 staged APK 一致」校验，因此副本缺失/损坏在
  任意重跑中都会被无条件修复（「重跑安全」指的就是这一层），上传并核验副本本身不消耗版本号。它同时是 **origin 的冷启动源**
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

### 卸载链路体检（offload probe）

`runner → 清华网盘` 的直接上传是全链路最慢的一段：2026-10-16 实测同尺寸（201276631 B，
GeckoView 双 ABI）用掉 2058s（≈98 KB/s，占 `--max-time 2700` 的 76%），当天 12:11 的 stage
直接超时失败（run 38898856907，step `Upload APK to Tsinghua Cloud`）。同一台网盘**读**侧并不慢
（TX1 拉 201276631 B 用 16.3s ≈ 12.3 MB/s，runner 走公网直链回读 ~10 MB/s）——瓶颈是那台校园
Seafile 的**国际入口**，不是跨洋本身。因此候选方案是把「写」这一跳挪到境内主机
（runner → 上海 COS → TX1 → 网盘）：`.github/workflows/android-offload-probe.yml` 是它的第一步，
**只取数字**，不动发布路径。

何时跑：`workflow_dispatch`（凭据读取 repository-level Actions secrets / variables，与部署/备份共用
`production-maintenance` 队列，并与 `android-release` 用 job 级 `concurrency` **互斥**——两边写同一门
Seafile 网盘，重叠会让探针数字失真，也会挤占发布那条已经贴着 `--max-time 2700` 的上传）。它要求
dispatched SHA == 当前 `main`（运行期间 main 一前进即失败），不写 version.json / tag / staging
evidence，不 seed origin，只在网盘上写一个 `_offload-probe-<run>.bin` 探针对象并**必须确认删除**
（`.bin` 不在 Caddy 的 `*.apk` 重定向范围内，即使残留也不会被当成 APK 分发；但删不掉就是红的——
scratch-object 契约不允许静默残留）。

它测四件事：

1. **runner → COS**：单流（1 part）与 8 路分片各一次。分片并发是 Seafile 那条单个 multipart POST
   没有的杠杆——链路差时靠它把最坏情况压回可重试的量级。缺 `secrets.COS_RELEASE_SECRET_ID` /
   `secrets.COS_RELEASE_SECRET_KEY` / `vars.COS_RELEASE_BUCKET` 时该段跳过（`::notice::`），其余段照测；
   `vars.COS_REGION` 缺省 `ap-shanghai`。凭证按最小权限建：发布专用桶（与资产桶
   `wotbtools-assets-*` **分开**）的 `android/*` 前缀 `PutObject` / `GetObject` / `HeadObject` /
   `DeleteObject`，外加分片上传必需的 `InitiateMultipartUpload` / `UploadPart` /
   `CompleteMultipartUpload` / `AbortMultipartUpload`、枚举未完成分片用的 `ListMultipartUploads`，
   以及续传路径的 `ListParts`（`GITHUB_RUN_ID` 在 rerun 时不变 ⇒ 同名 key，SDK 发现未完成分片会先
   `list_parts` 再续传）。缺分片动作时 8 路分片测量会 AccessDenied、只剩单流数字；缺 `HeadObject` 时
   上传后的 HEAD 回读与清理确认会失败——HEAD 在 CAM 里不被 `GetObject` 覆盖；不给 ListBucket。
   SDK 版本在 workflow 内固定（`cos-python-sdk-v5==1.9.44`，升级需改代码评审），避免带着生产凭证
   自动执行上游新版本。
2. **COS → TX1**：主机从预签名直链拉回 + `sha256sum -c`，并打印该主机把 COS 域名解析到**内网还是
   公网**（同地域内网流量免费；跨地域不支持内网，故发布桶应与 TX 主机同地域）。
3. **TX1 → 清华网盘**：与 `android-release.yml` 同一协议（upload-link → multipart `replace=1`），
   记录 `speed_upload`；token 优先取主机上的 `/etc/wotb-tx/tsinghua-cloud.token`（0600，目标形态），
   缺失时回落到 ssh env 里的仓库 secret，并打印实际来源——便于确认「token 收敛到主机」的进度。
4. **分享直链回读 + 删除**：与发布路径同一权威——下载回来 SHA-256 一致才算过；随后删除探针对象，并以
   **Seafile API 的 file-detail 明确回 404** 作为**权威缺席证据**（不是靠公开页面的字节数推断），公开直链
   只作旁证（它若仍服务探针字节即与 404 矛盾 ⇒ 判为未证明）；连不上 / 401 / 403 / 5xx 一律「未证明」，
   3 次重试后仍不成立即变红并在错误信息里给出对象路径。**run 被 cancel 时 `always()` 步骤不执行**，
   可能留下探针对象与未完成分片——对象名可在日志里查到、`.bin` 不在 `*.apk` 重定向内，按名手动删除即可
   （未完成分片另可由 `AbortMultipartUpload` 或桶生命周期清理）。

判据（写进 job summary）：两段都 ≥ 2 MiB/s ⇒ 采纳「TX1 落地」方案；0.3–2 MiB/s ⇒ 采纳，但后续
host 侧脚本需要调并发/超时；< 0.3 MiB/s ⇒ 改由 TX2 推，或换对象存储。探针预算按 192 MiB 场景给足
（job 90 分钟；COS 拉取 900s、网盘推送 1800s、回读 3×300s），所以「链路已严重退化」时仍能拿到数字；
真到上限以下跑不完时按低于判据记负，且退出路径上的 trap 仍会删掉探针对象。
**本探针只测量**：把 runner
直传改成 TX1 落地（步骤重排、host 侧脚本、token 收敛）是后续工作；在那之前
`android-release.yml` 的直传路径仍是唯一发布路径。

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
2. `/api/users/profile` 真实 OPTIONS：Origin 为 staging evidence 的 `runtimeOrigin`（3.0 起
   `http://127.0.0.1:21653`，2.x 为 appassets），Authorization 等请求头允许，
   GET/POST/PUT/PATCH/DELETE/OPTIONS 允许；ACAO 必须精确等于该 origin，不能是 wildcard，
   不启用 credentialed CORS。无 Bearer 的同一路由 GET 必须返回 401 且携带正确 CORS，证明 backend 可达。
   `deploy/tx/Caddyfile` 同时放行两个 exact origin（`@android` 与 `@androidLoopback`，字段逐一相同，
   `validate-caddy-config.sh` 对两者做同样校验）；新 origin 的 Caddy 改动必须在 publish 前已部署。
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

## 强制更新门槛（minSupportedVersionCode）的抬升

门槛值来自 GitHub Actions variable `ANDROID_MIN_SUPPORTED_VERSION_CODE`（**不在仓库内**，见
`gh variable list`），但它**只能随一次"严格更新版本"的 publish 写进 version.json**：
`classify_prod` 把 `minSupportedVersionCode` 计入同版本一致性判定，对 production 同版本直接注入
新门槛会得到 `prod_equal_conflict`（fail-closed）——同位改写被刻意禁止，抬门槛必然伴随一次
新版本发布。按「版本号递增规则」，抬门槛默认只在发布候选的 major 高于线上 major 时发生（含继承未发布 major 的 minor/patch 候选），门槛值为候选 major 的 `X.0.0`；用户明确指令的 patch/minor 例外（3.14.1 → `3014001`；3.14.2 → `3014002`）见「版本号递增规则」。最小动作四步（**顺序不可交换**）：

1. 按变更等级递增 `android/gradle.properties:wotbVersion`（major，或同一未发布 major 之后的 minor/patch 候选；Version-as-Code，普通 PR），先不合并；
2. **先把变量设为目标门槛值**（`guard_min_supported` 校验 ≤ 新版本 code）——对 bridge / major cutover
   这是 **stage prerequisite**：变量仍是旧 major 门槛时，合并触发的自动 stage 会在
   `guard_bridge_covered` 上 fail-closed；
3. 合并 main → 自动 stage（构建/签名/上传/seed/tag/evidence，不写 `version.json`）；若该 PR 同时带有
   基础设施改动（例如 Caddy），由对应的 main-only workflow 在合并后自动部署，两者都成功后才进入下一步；
4. 真机验收通过后 `workflow_dispatch(mode=publish, version=<新版本>)` 写新 manifest（publish 身份核验不变）。

设置变量本身**不动** production `version.json`，因此**不会立刻**强制线上旧客户端更新——真正影响
客户端的 commit point 仍是 publish 最后写入 `version.json`。但变量设为 `X×1_000_000` 之后，
**不要再 stage / publish 任何低于该门槛的旧 major 候选**；这是有意的 cutover。若顺序搞错导致
stage fail-closed，修好变量后对同一版本幂等重跑即可（恢复路径，不是正常流程）——floor 守卫在 stage
preflight 就失败，发生在任何 immutable artifact 之前，版本未被消耗。

客户端语义（`MainActivity.onVersionReady`，读 `version.json`）：
`installedVersionCode < minSupportedVersionCode` ⇒ **强制更新**屏（阻塞入口）；
`installedVersionCode < latestVersionCode` ⇒ 仅可选更新提示；其余不动。

历次门槛：
- 2001012（2.1.12；2026-10-07 设定，至 2026-10-12 生效值）；
- **2002002（2.2.2；2026-10-12 抬升，由 2.2.3 版本携带发布）** —— 所有低于 2.2.2 的客户端
  强制更新到当时最新版本：2.2.2 是首个携带新 WASM 引擎（Agent v0.4.4：作者车 type=10 接收
  突发时间轴重建）与履带印数据面/运行时口径的版本，旧客户端不再受支持。2.2.2 客户端只收到
  可选更新提示（不强制）。
- **2002012（2.2.12；2026-10-13 抬升，由 2.2.12 自身携带发布）** —— 所有低于 2.2.12 的客户端
  强制更新到 2.2.12：该版本的内嵌运行时携带 Agent v0.4.6（动态装甲 `armorsStates` 状态时间轴
  按 propID 16 解码）与新版穿透热力图管线（含交战距离衰减）。本次发布 latest 即门槛
  （latestVersionCode = minSupportedVersionCode = 2002012）：已安装 2.2.12 的客户端两个判定
  条件都不成立，**不显示任何更新提示**（不强制）；此后若 latest 继续升高且门槛仍 ≤ 2002012，
  2.2.12 客户端才会收到可选更新提示。
- **2003000（2.3.0；2026-10-13 抬升，由 2.3.0 自身携带发布）** —— 所有低于 2.3.0 的客户端
  强制更新到 2.3.0（含 2.2.12）：该版本的内嵌运行时携带 3D 战斗特效写实化（弹道曳光/炮口焰/
  命中烟/击毁爆炸，按画质分档）。本次发布 latest 即门槛（latestVersionCode =
  minSupportedVersionCode = 2003000）：已安装 2.3.0 的客户端不显示任何更新提示（不强制）；
  此后若 latest 继续升高且门槛仍 ≤ 2003000，2.3.0 客户端才会收到可选更新提示。
- **3014001（3.14.1；2026-10-19 抬升，由 3.14.1 自身携带发布）** —— 所有低于 3.14.1 的客户端
  强制更新到 3.14.1（此前门槛为 3.0.0 的 3000000）。本次是**用户指令的 patch 例外**，覆盖
  “patch 默认不抬门槛”的惯例：3.13.x 起移动端装甲查看器热力图在 `mediump`（移动 GPU 为 fp16）
  下出现可见错乱，产品要求全员升级。本次发布 latest 即门槛
  （latestVersionCode = minSupportedVersionCode = 3014001）：已安装 3.14.1 的客户端不显示任何
  更新提示（不强制）。
- **3014002（3.14.2；2026-10-19 抬升，由 3.14.2 自身携带发布）** —— 所有低于 3.14.2 的客户端
  强制更新到 3.14.2（此前门槛 3014001）。本次是**用户指令的 patch 例外延续**：相机距离缩放、
  横屏手机布局与 WebGL context-lost 错误反馈要求全员升级。本次发布 latest 即门槛
  （latestVersionCode = minSupportedVersionCode = 3014002）：已安装 3.14.2 的客户端不显示任何
  更新提示（不强制）。3.14.1 不再 publish（3014001 < 3014002，会被 floor guard 拒绝）。

## Rollout 与验证

stage 不探测 API CORS、asset gateway 或 Keycloak client；它们是 **publish** 的就绪前提（publish 的
readiness 步骤会 fail-closed）。随候选 PR 一起修改的网关配置由合并后的 main-only workflow 部署，必须在
publish 之前成功。完成 B13/B14 物理 Android 矩阵后才手工 `workflow_dispatch(mode=publish, version=<已 staged 版本>)`。
没有物理设备时不能把真机项目标为 PASS，production version.json 保持不变。

`scripts/android-release/test-release.sh` 覆盖版本/幂等分类、cutover floor、schema2 stage/publish
roundtrip、每个证据字段被破坏时 fail-closed、APK 文件损坏、真实版本不符、CORS wildcard/
credentials/headers/methods/HTTP 错误；同时锁定 publish 不重建与 version.json 最后写入，并覆盖
publish 候选解析（staged 2.0.1 + main 已到 2.0.2 仍选中 2.0.1、缺版本、未 staged 版本、
tag target 版本不符、staged 源码不自洽）。
`scripts/ci/test-workflow-contract.sh` 校验 owner 与实际 workflow 接线（含显式 `version` 输入、
publish 不读当前 main 版本、version.json 由 staged 身份写出）。
CI 还构建 debug APK，验证本地启动/Bridge/replay 合约及离线 bundle；真机仍负责实际 GeckoView 渲染、
OEM Intent、native auth/refresh/process-death、飞行模式冷启动与本地回放全链路。

## 3.0.0（GeckoView）发布与回滚

**APK 体积**：自带 GeckoView 后 release APK 约 160 MiB（双 ARM ABI，native libs 压缩打包）+ 前端 bundle，
是 2.x（≈15 MB）的十倍以上。`android-release.yml` 已按此放宽：stage job 120 分钟、清华上传显式
`--max-time 2700`、副本与生产 APK 回读 `--max-time 900`、publish job 90 分钟。实测 release APK 若
超过 250 MB，先回到产品决策（例如只保留 arm64），不要只调超时。

**canonical cutover 顺序**（唯一 runbook）：

1. **手动把 GitHub Repository Variable `ANDROID_MIN_SUPPORTED_VERSION_CODE` 设为 `3000000`**；
2. 合并 PR #628 / Android 3.0.0 candidate（`android/gradle.properties` 的 `wotbVersion=3.0.0`）到 main；
3. 合并后 main 自动触发两条正式 workflow：
   - **Caddy Gateway**（`caddy.yml`，因 `deploy/tx/Caddyfile` 变更触发）部署含 `@androidLoopback` 的网关；
   - **Release / Android** 自动 stage 3.0.0（构建/签名/上传副本/依次 seed TX1、TX2/公网回读/tag/staging evidence）；
4. 等**两者都成功**（Caddy production deployment success + Android 3.0.0 stage success）；
5. 真机验收与网络观察（下节）；
6. 验收通过后 `workflow_dispatch(mode=publish, version=3.0.0)`。

为什么变量在 merge 之前：stage preflight 自己执行 `guard_min_supported` /
`guard_local_first_cutover` / `guard_bridge_covered`，对 FE 只支持 bridge v3 的 3.0.0，floor 是
**stage prerequisite**，不只是 publish prerequisite —— 变量仍是 2.x 门槛时合并触发的自动 stage 会
fail-closed。门槛要求的就是候选自身的 versionCode `3000000`，不会要求 `3000001` / `3000002` / `3000003`。
若顺序搞错、stage 因 floor fail-closed，把变量设为 `3000000` 后对同一版本幂等重跑 stage 即可（恢复路径，
不是正常流程；floor 失败发生在 stage preflight，早于任何 immutable artifact，版本未被消耗）。

为什么 Caddy 不需要（也不能）在 merge 之前部署：`@androidLoopback` 本身就在 PR #628 里，而 `caddy.yml`
只在 main 上运行（push 触发；手动 dispatch 也必须来自 `refs/heads/main` 且通过 freshness 校验，stale
source 不允许改生产）。合并前把 PR 分支的网关配置弄上生产只能靠手工 SSH、复制文件或放宽门禁，这些都会
破坏 IaC / production freshness 边界，禁止这样做。

为什么这个顺序安全：

- 设置变量本身**不修改** production `version.json`，不会强制线上 2.x 用户更新；
- 合并后 Caddy 部署与 Android stage 各自独立（`production-maintenance` 与 `android-release` 两个
  concurrency 组，Caddy 可能排在其他生产维护任务之后），谁先完成都可以；
- stage 只做构建 / 签名 / seed / tag / evidence，**不** publish `version.json`；
- Android 客户端 rollout 的唯一 commit point 是 `publish(version=3.0.0)` 最后写入 production `version.json`
  （它不是整个生产环境的唯一变更点：Caddy 网关的生产变更在合并后就已发生，早于 publish）——只有它之后，
  floor `3000000` 才真正作用到 2.x 客户端。publish 的 readiness 步骤会探测 loopback origin 的 CORS，
  Caddy 未部署成功时 fail-closed。

因此只要求 Caddy production deployment 与 Android stage 都在真机验收 / publish **之前**成功；
**从变量设为 `3000000` 起不要再 stage / publish 任何 2.x 候选**——这是有意的 cutover。

**真机验收（发布阻塞项）**：至少 Android 9 问题机 + 一台 Android 13+，记录型号 / Android / ABI /
GeckoView 版本 / APK SHA：问题机 CSS 正常且不再闪退；冷启动与飞行模式启动；重启后偏好保留；单 / 多文件导入、
分享 / 打开 replay、目录导入；WASM 解析、统计、Rating、2D、3D / Armor / 贴图；fullscreen 进出与 Back；
横竖屏；连续切换 replay；前后台切换（含被系统回收后恢复）；断网 / 恢复；QQ 登录 → 回跳 → 登出；
网页 PNG blob 导出、HoF replay 下载（核对文件内容 / 文件名 / MIME）、保存取消与失败后重试；
select 打开时页面导航、选项更新后导航、file picker 打开时导航及迟到结果（新页面不可收到旧文件）；
检查更新 → 下载 → 安装（含 2.3.7 覆盖安装 3.0.0）；外链交系统浏览器；软键盘不遮挡输入。
再用 PCAPdroid 等免 root 工具观察一次「冷启动 → 闲置 → replay → 3D → 登录」的出站流量：只应出现
wotbtools.com / 对象存储 / auth / 下载源；出现 Mozilla / Google 服务流量时先用 GeckoView 公开设置关闭，
关不掉就阻塞发布。

**blob 下载派发（发布阻塞项，CI 不覆盖）**：GeckoView 的下载先过
`NavigationDelegate.onLoadRequest`，之后才进 `ContentDelegate.onExternalResponse`。仓库里的 JVM unit test
只锁定 URL policy（`NavigationPolicy`）与响应体 ownership（`LocalRuntimeServer`），**没有** GeckoView
instrumentation / runtime smoke，所以 **CI 绿灯不代表真机上的 blob 下载链路已验证**。发布前必须在真机
逐项确认「网页 PNG blob 导出 / HoF replay 下载 / tournament XLSX 导出 → 保存成功」，并核对文件内容 /
文件名 / MIME 正确、取消与失败后可重试；任一项不通过即阻塞发布。

**GeckoView 升级**：只用 stable channel 与精确版本（`android/app/build.gradle.kts` 的 `geckoViewVersion`）。
每次升级是一次独立的 Android minor 发布（至少每季度一次；遇关键安全修复立即），升级时同时检查 AAR 的
`minCompileSdk` 与 Kotlin metadata 版本是否要求工具链跟进。

**回滚（3.0 发布后不能回到 2.x）**：floor 一旦为 3000000，2.x 不再是合法的生产回滚目标；
`version.json` 也不能指回 2.x、不能复用 `android-v3.0.0` tag、不能手工上传 APK。

- **Tier A（首选）**：只换引擎——写一个 System WebView 版适配器，加载同一 `http://127.0.0.1:21653`
  （AndroidX `addWebMessageListener` 支持 IP + 端口的 origin rule），复用 LocalRuntimeServer 与全部 Native
  能力，补 `onRenderProcessGone`。contract v3 / 前端 / CORS 都不变，因此不触发 bridge gate；
  发布一个高于当前 production 的新版本，版本等级按实际修复严重度重新分类，floor 按上文版本规则计算；
  同 major 的 minor/patch 不抬 floor，跨 major 的候选继承对应 major 的强制升级义务。
- **Tier B（最后手段）**：恢复 2.4.0 runtime（appassets + WebViewAssetLoader）。contract 的 origin 再次改变，
  必须 bridge 4、前端 `[4]`；发布版本与 floor 按上文 wire breaking 的 major 规则计算，且依赖 Caddy
  仍保留 appassets CORS（因此 3.0 之后不要急于删除
  `@android`）。

## 签名与基础设施

正式版本保持同一 signing key。keystore/口令来自 GitHub Secrets，证书 SHA-256 来自 GitHub
Variable；缺失或不匹配均 fail-closed。`/download/android/` 的 bind mount 必须先上线。
`version.json` 是唯一强制更新 commit point，必须在上述身份与就绪检查之后作为最后一次上传。
