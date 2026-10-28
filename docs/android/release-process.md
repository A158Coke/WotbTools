# Android 发布

## 版本与 Bridge 契约

`android/gradle.properties:wotbVersion=X.Y.Z` 是**当前源码**版本，
`versionCode=major*1_000_000+minor*1_000+patch`。stage 阶段以它为准，不接受版本覆盖；
publish 阶段的候选版本改由操作者显式指定（见下节）。
当前源码版本：**3.17.12 / 3017012**（`android/gradle.properties`）。
`android-v3.17.9` / `android-v3.17.10` 已有 immutable release identity，
**不得 publish / 不得复用**；版本化记录见 [3.17.9](releases/3.17.9.md)、
[3.17.10](releases/3.17.10.md)、[3.17.11](releases/3.17.11.md) 与 [3.17.12](releases/3.17.12.md)。
3.16.0 已按联赛回放同页展开/整类删除与视觉优化发布（tag `android-v3.16.0`，对应 `6f5ca3ca`），其 APK 早于 #703 的装甲合并，不能复用该版本承载 armor 修复。
3.17.0 承载 bundled armor viewer 的 HE/HESH 800 射线溅射、结果卡/热力图重做与装甲判定修复（双面间隙甲、二次跳弹、gun_mask 裁切、无效 HE fail-closed），按 **minor** 选位，详见 [3.17.0](releases/3.17.0.md)。
3.17.1 修复 HE 溅射三态语义（零有效样本=0、采样器不可用显式报错、客户端不再单射线兜底），按 **patch** 递增，说明见 [3.17.1](releases/3.17.1.md)。影响限于 HE 命中履带/炮管/间隙甲等主装全在爆炸半径外的边缘场景，不强制旧客户端更新，门槛保持 `3015003`。
3.17.2 将新 APK 的 Native 3D 资产 upstream 与 Web 统一到 Alibaba origin；本机 `/agent-assets` 路由、Native Bridge v3、ETag 磁盘缓存与 stale-cache fallback 不变。旧 APK 仍按已编译 origin 访问 COS，COS 暂留作旧客户端与回滚，详见 [3.17.2](releases/3.17.2.md)。
3.17.3 修复固定战斗室（GLB 无 `turret_NN` 的 44 台 AT-SPG）装甲查看器拖曳炮管失效；scene-runtime 改动按 **patch** 递增，说明见 [3.17.3](releases/3.17.3.md)。不改变 Native Bridge 与最低支持门槛。
Native Bridge 保持 v3；最低支持门槛保持 **3015003**，不回退也不额外抬高。后端新增接口必须先就绪，再切换网页或发布 APK。
版本声明不代表已 stage、Android 真机验收或 publish。
保留 main 已合并的 3.12.0 联赛回放开赛时刻/显示与录入时区/小组号选填/三语术语修正与 71 条已核实回放、
3.11.2 推荐内容管理权限 cutover、3.11.1 3D 回放可见性/地图资产加载修复、3.10.1 全等级坦克百科资料修复
（基础资料覆盖 tiers 1–10，装备/补给建模仍限 7–10），以及 3.10.0 共享选车菜单、搜索别名、动能弹外部模块
转正/口径碾压修复，3.9.1 积分榜公开展示优化、3.9.0 工具栏折叠、3.8.1 地球图标和此前推荐目录等功能，
以及上游 **v0.4.10** WASM pin。3.12.0 已被 #672 占用，不能复用来发布本 bundle。
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

每个改动 Android 运行时的 PR 递增 `wotbVersion` 时，按**变更等级**选位，而不是一律 +1 patch；强制更新门槛默认只随 major 抬升（用户明确指令的 patch/minor 例外见下）。

| 等级 | 适用变更 | 示例 | 强制更新门槛 |
|---|---|---|---|
| **major** | breaking change（含 Native Bridge wire breaking、需要新客户端才能正确工作的数据/接口契约变化）、重大功能、删除功能、中大型 bug 修复 | `X.0.0` | **必须抬到该 major 的 `X.0.0`**：`ANDROID_MIN_SUPPORTED_VERSION_CODE` = `X×1_000_000`，随 publish 写入 |
| **minor** | 增加中小功能 | `X.Y.0` | 不抬，保持现值（旧客户端只收到可选更新提示） |
| **patch** | 小 bug 修复 | `X.Y.Z` | 默认不抬、不强制升级；用户明确要求强制更新时为例外（见下） |

**用户指令例外**：用户明确要求把强制更新门槛抬到当前候选时，patch/minor 也可以抬；必须在 PR 描述、release notes 与门槛变更记录写明理由。该例外覆盖 patch 默认不抬门槛的惯例，但不改变 major 的默认义务。

**用户指令例外（2026-10-20，3.15.3）**：PR #713 按用户裁定保留 patch 等级，同时按其明确要求把门槛从 `3014002` 抬到 **`3015003`**，强制旧客户端更新到包含共面续飞判定修复的版本；不再为旧候选维持此次错误判定行为。此门槛随 3.15.3 的 publish 写入线上 `version.json`。

- **归零**：minor 递增时 patch 归 0；major 递增时 minor、patch 都归 0。
- **取最高**：一个 PR 同时含多个等级的改动，按最高等级递增。两次 publish 之间合并的多个 PR 各自在当时的 committed 版本上按自己的等级递增，最终发布版本自然体现其中最高的等级。
- **版本号在候选取得 immutable release identity 时才被消耗，不是每个 review commit 都消耗**：`wotbVersion` 固定的是**发布身份**，不是提交序号。同一个尚未形成 immutable identity 的 PR / release candidate，在 code review、测试或真机验收过程中发生的修复**不因此自动递增 patch**，保持在**原计划版本**。
  一旦下列**任一**条件成立，候选版本即被锁定（version identity consumed），此后任何会改变该 staged Android candidate / APK identity 的源码或 release input 修改，都必须使用**更高的** `wotbVersion`：
  ① 已创建 immutable release tag（`android-vX.Y.Z`）；② staged APK 已在**任意一台** immutable origin（TX1 **或** TX2 的 no-clobber origin 路径）成功落位并通过 SHA-256 核验——**不需要等两台都完成**；③ 已写出 staging evidence；④ production `version.json` 已 publish。
  **注意：不是只有 publish 之后才锁版本**——stage 阶段的 tag / 任一台 origin 上的 APK / staging evidence 同样是 immutable identity。只有这些条件**全部尚未成立**时，同一 release PR 的 pre-release fix 才保留原版本——PR 合并前（还没有 stage）通常不存在任何 immutable identity，review 修复因此不需要 bump。
  清华云盘副本（distribution replica）**不是** identity authority：它是可 `replace=1` 覆盖的分发副本 + origin 冷启动源，上传并核验副本本身不消耗版本（判定源划分见下文「Origin 与分发副本是两个身份」）。但只要**任意一台** origin 已从该副本 seed 并 no-clobber 落位成功，版本即锁定（上列 ②）。
- **锁定后哪些修改必须换版本**：会改变已锁定 Android candidate identity 的修改——Android Native 代码与 `android/app/**`、Android 构建输入（Gradle 配置 / 依赖版本 / 工具链）、进入 APK 的 bundled frontend / WASM / 资产与 Android 专用生成 bundle、Native Bridge contract 与 `bridgeVersion`、以及 tag target 中任何会改变 staged APK 字节或身份的 release input。与已 staged Android artifact 无关的修改——docs-only、Caddy-only、observability-only、无关后端 / 基础设施修复、不改变 staged 字节与身份的 workflow / policy 修复——可以让 main 前进，**本身不消耗新的 Android 版本**（与 Android 无关的 main 前进本身不消耗新的 Android 版本）。已完整 stage 的候选照常按自己的 tag target 发布，并且仍要通过 publish 的 ancestry / 当前 policy / bridge compatibility / minSupported / CORS 等就绪探测 / staged identity 守卫，没有跳过守卫的例外。
  - 允许：候选 X stage 成功 → 仅修改不进入 APK 的部署配置（例如 `deploy/tx/Caddyfile`）→ main 前进 → 部署成功 → publish 已 staged 的 X。
  - 不允许：候选 X stage 成功 → 修改 `GeckoWebRuntime` / bundled frontend / Bridge contract → 仍复用 X。这种情况必须使用更高版本。
- **「版本已锁定」不等于「stage 已完成」**：
  - *version identity consumed*：上列四项**任一**出现即成立；
  - *stage distribution complete*：TX1 **和** TX2 都落位并核验、公网回读核验、tag、staging evidence 全部成功。两台 origin 都成功只是 stage 分发要求完成，**不是** identity 首次成立的时点。
- **partial-stage 的处理**：build A → TX1 seed 成功 → TX2 seed 失败 → stage 整体失败。此时候选版本**已经被锁定**——TX1 上已有该版本的 APK（build A 的 SHA）。若随后修改源码得到 build B 仍想复用同一版本，stage 的「Classify origin APK on TX1/TX2」会发现 TX1 现有 SHA ≠ build B 的 SHA → immutable conflict → fail-closed。补齐 TX2 只能对**同一提交**（build A 的源码提交）幂等重跑 stage：main 触发的 stage 只从 `origin/main` HEAD 构建，且 APK 内嵌 `buildCommit`。main 一旦前进（哪怕只是 docs / Caddy 修改），重跑构建出的 APK 字节就不同，TX1 classify 同样 conflict，这时只能换更高版本——这是部分 stage 无法补齐的结果，不是无关修改本身消耗了版本。
- **stage 失败后能否复用同一版本：不能只看 workflow conclusion**（A failed stage may still have consumed the version if an immutable artifact was already materialized），逐项只读检查：
  - tag `android-vX.Y.Z` 是否已存在（`git ls-remote --tags origin android-vX.Y.Z`）；
  - TX1 origin 是否已有 `wotbtools-android-vX.Y.Z.apk`；
  - TX2 origin 是否已有该 APK（两项都以 stage 日志「Classify origin APK on TX1/TX2」的 SSH 直查结果为准；不要用公网 URL 判断——它被 302 到可覆盖的清华副本）；
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
  - 候选与线上**同 major** ⇒ 默认不得改动门槛（minor/patch 不强制）；用户明确指令的例外见上（3.14.1 / 3014001；3.14.2 / 3014002；3.15.3 / 3015003）。
  - 包含 Native Bridge wire breaking 时，门槛还须满足 publish 现有的 bridge / cutover 守卫（以守卫为准）。
  - 现有 publish 守卫在 bridge 不变时**不会**从历史推导未发布 major 的门槛要求（只校验门槛 ≤ 候选 versionCode），这一步由操作者按本条执行。也可以选择先 publish 每个 major 再发布后续 minor/patch；在没有更严格的 bridge / cutover 要求时两种做法的门槛结果相同。
- **major 的发布动作（顺序固定）**：① **先把仓库变量 `ANDROID_MIN_SUPPORTED_VERSION_CODE` 设为 `X×1_000_000`** → ② 合并候选 PR → ③ 合并到 main 后由正式 workflow 自动执行：Android 自动 stage，以及该 PR 一并带来的基础设施改动（如 Caddy）→ ④ 等两者**都**成功 → ⑤ 真机验收 → ⑥ `publish(version=<候选>)`。变量必须在合并/stage **之前**设置——stage preflight 本身就跑 `guard_min_supported` / `guard_local_first_cutover` / `guard_bridge_covered`，floor 没到位会 fail-closed，所以它不只是 publish 的前提。随候选 PR 一起改的基础设施**只能**在合并后由 main-only 的正式 workflow 部署（`caddy.yml` 的手动 dispatch 也只接受 `refs/heads/main` 且做 freshness 校验），不要求、也不允许在合并前部署——不要手工 SSH 改生产、不要从 PR 分支复制文件、不要放宽 workflow 门禁。
- **发布说明**：继承门槛的 minor/patch 候选，`Minimum supported version` 行写 `raised to X000000 (X.0.0 floor, inherited from unpublished X.0.0)`。

## 两阶段发布（stage → publish）

`.github/workflows/android-release.yml` 的默认 mode 是 `stage`；`publish` 只能手工续跑。`stage` 的版本权威是当前 checkout 的 `android/gradle.properties`；主路径是 main 合并后自动 stage，手动 dispatch 要求 dispatched SHA == 当前 `origin/main`。`android/gradle.properties` 变更或 `android-v*` tag 也可触发，tag 入口要求 tag 名与 committed `wotbVersion` 一致。

| 阶段 | 行为 |
|---|---|
| stage | 校验 source/version/contract 与 **cutover 守卫**（`guard_min_supported` + `guard_local_first_cutover` + `guard_bridge_covered`，因此 major/bridge cutover 的 floor 必须在合并/stage 之前设好）→ 构建完整 Android bundle → 签名 APK → 核验 APK 内容、签名和 SHA → 上传清华副本（distribution replica，可覆盖，不锁定版本）→ **TX1、TX2 依次从副本拉取 seed（逐跳 SHA-256，no-clobber 落位；任意一台落位即消耗版本号）** → 公网回读核验 → immutable APK/tag/evidence；不写 production version.json |
| publish | `workflow_dispatch(mode=publish, version=X)`：X 的 immutable tag 决定候选 → 核验 tag target 源码、evidence、APK 字节与内嵌 bundle → Keycloak/API/资产就绪探测 → 最后上传 version.json；不重建、不重新签名 APK |

stage 的 APK 门禁顺序是：APK 内容/签名 → bundled frontend/WASM/Agent pin → SHA-256 → 公网回读。publish 的顺序是：`version` 非空且合法 → tag target 源码 → staging evidence → APK badging/SHA/bundle manifest → 当前 main ancestry/policy → Keycloak/API/资产就绪 → `version.json` 最后写入；任一步失败都不写 `version.json`。

生产版本较旧时继续，相同版本验证元数据和 SHA 后 no-op，较新则拒绝回滚。Tag 不得 repoint；已有 APK SHA 不同则拒绝覆盖。已有 staging evidence 必须与该次实际 APK 身份逐字段匹配，重跑保留其原始 `stagedAt`，不能用新身份覆盖旧证据。

失败语义：stage 失败不写 production `version.json`；部分成功可能已锁版本（见上文）；publish 在写 `version.json` 前失败时生产版本保持不变，对同一 X 幂等重跑安全；tag/APK/evidence/版本 mismatch 一律 fail closed；production 已是更高版本时拒绝回滚；证据 404 先确认两台 origin 文件，不能用绕过身份校验的方式手写 `version.json`。

### 构建身份的确定性（stage 重跑 ⇒ 同一 APK）

`frontend/vite.config.js` 的 `buildIdentity()` 把构建身份写进 bundle：`version.json` 与 `define __BUILD_TIME__`（后者内联进入口 chunk，入口内容一变会**沿 import 图级联改名**）。因此 `buildTime` **必须是确定性的**——优先级：`SOURCE_DATE_EPOCH`（unix 秒）→ 当前 checkout 的 commit 时间 → 才回落 wall-clock（此时该构建不可逐字节复现，仅作诊断）。

- **Android bundle**（`pnpm run build:android`，有 .git）自动取 commit 时间 ⇒ 同一 commit + 同输入 ⇒ 逐字节相同的 bundle/APK（stage 重跑不会再撞 immutable conflict）。
- **任何 Docker 构建**（生产镜像由仓库外构建方按本 Dockerfile 构建）必须传 `--build-arg SOURCE_DATE_EPOCH=$(git log -1 --format=%ct)`；`Dockerfile.frontend` 已声明该 ARG 并转 ENV，CI 侧的 `ci-frontend.yml` 已接上。未传时回落 wall-clock，该镜像不可复现。
- 回归锁：`frontend/src/vite-proxy.test.js` 断言 `SOURCE_DATE_EPOCH` 固定 ⇒ `buildTime` 同值。

### APK 公网下载卸载（清华云盘直链）

TX1 出口公网带宽有限且会被 APK 下载打满；APK 随内嵌 bundle 增大（2D 底图与 Web 同字节，bundle 资产约 40 MiB，见 [architecture.md](architecture.md) §2D 底图随包）。stage 阶段以 `TSINGHUA_CLOUD_TOKEN` 把 APK 传进清华云盘 `个人资料库 /wotbtools-android/` 目录（`replace=1` 覆盖同名文件；`reuse=1` 只是幂等令牌，**不是**覆盖开关——缺 `replace` 时同名上传会被改名 `filename (1).apk`，固定下载路径拿不到新副本）。TX1 Caddy 把 `/download/android/*.apk` 302 到该目录的分享直链 `https://cloud.tsinghua.edu.cn/d/909496de42424204ae11/files/?p=/<apkName>&dl=1`，分享链接无过期、不随版本变化，新增版本只需把文件放进目录即可生效。

**两台 origin 的 APK 由该副本 seed**：跨洋只发生一次——runner 只把 APK 上传到清华副本，随后 TX1/TX2 各自从分享直链**拉取**。拉取侧四道边界：

1. 就地 `sha256sum -c` 比对 staged SHA，不符即删临时文件并 fail-closed——绝不把坏字节落成 origin；
2. 先写 `*.partial.<pid>` 再同目录 **hard link（`ln`）原子 no-clobber 落位**：nginx 永不读到半截文件，且目标已被并发写入时 `ln` 原子失败、绝不覆盖；
3. `ln` 失败即比对目标现有 SHA-256——与 staged SHA 相同视为「并发进程已放入同一份 immutable 字节」（视为已完成），不同则打印 `immutable origin conflict … refusing to overwrite` 并 fail-closed；
4. 触发条件仍是 origin `apk_absent`（幂等：equal 跳过、清华 `replace=1` 覆盖自愈）。

②③ 一起覆盖了 classify 快照与落位之间窗口内的第三方写入（manual SSH / 恢复脚本等）：「classify 发现 absent」不再是覆盖许可，immutability 由落位本身保证。

**Origin 与分发副本是两个身份，判定源必须分开：**

- Origin identity：TX1/TX2 上的 immutable APK 本体；**任意一台**落位成功即消耗该版本号（见上文「版本号递增规则」的 partial-stage 处理）。stage 的 absent/equal/conflict 分类用 **SSH 直查两台 origin**（远端 `sha256sum`），conflict 仍然 fail-closed。绝不用公网 URL 做该判定——`*.apk` 已被 302 到网盘，副本损坏时公网 URL 会把 rerun 误判成 conflict 直接失败，而能修复副本的清华覆盖上传又被同一失败挡在后面，不可自愈。SSH 探测协议还区分「远端显式回答文件不存在」与「探测本身失败」，后者直接失败本步骤，绝不降级成 absent（否则 seed 会覆盖一个 SHA 不符的 origin 文件，销毁 immutable 冲突证据）。
- Distribution replica：清华云盘。不参与 immutable 判定；stage 每次执行都会 `replace=1` 覆盖同名文件并校验「分享直链下载回来 SHA-256 与 staged APK 一致」，因此副本缺失/损坏在任意重跑中都会被无条件修复（「重跑安全」指的就是这一层），上传并核验副本本身不消耗版本号。它同时是 **origin 的冷启动源**（两台 origin 从这里 seed）；副本字节若损坏，seed 步骤的就地 SHA 校验会在写入 origin 前拦下（fail-closed），不会污染 immutable 权威。
- 公网 URL（wotbtools.com → 302 → 网盘）只做最终端到端复核，从不作为状态判定源。

- URL 契约不变：`version.json` 的 `apkUrl` 仍是 `https://wotbtools.com/download/android/<apk>`，客户端跟着 302 走；`/download/android/version.json` 与 `*.staging.json` **不在**重定向范围内，仍由 TX1/TX2 前端源站服务（deploy 预检的运行时内容一致性比对不受影响）。
- fail-closed：该云盘部署「上传成功也返回 HTTP 400」是已知怪癖，workflow 不以响应码判定成败，以「分享直链下载回来 SHA-256 与 staged APK 一致」为唯一门禁。
- 若更换网盘目录或分享链接，必须同步修改 TX1 Caddyfile 的 redir 目标与 workflow 步骤里的 `REPO_ID` / 分享 token，两边一一对应。

### 卸载链路体检（offload probe）

`.github/workflows/android-offload-probe.yml` 是 **runner → 上海 COS → TX1 → 清华网盘** 这条链路的 link-health probe。它只取数字，不改变发布路径：`workflow_dispatch` 手工触发，读取 repository-level Actions secrets / variables，与部署/备份共用 `production-maintenance` 队列，并与 `android-release` 用 job 级 `concurrency` **互斥**（两边写同一 Seafile 网盘）。它要求 dispatched SHA == 当前 `main`，不写 version.json / tag / staging evidence，不 seed origin；只在网盘上写一个 `_offload-probe-<run>.bin` 探针对象并**必须确认删除**（`.bin` 不在 Caddy 的 `*.apk` 重定向范围内，即使残留也不会被当成 APK 分发；但删不掉就是红的——scratch-object 契约不允许静默残留）。

它测四段：runner → COS（单流/分片）、COS → TX1（预签名直链 + SHA 校验）、TX1 → 清华网盘（upload-link + multipart `replace=1`）、分享直链回读 + 删除（以 Seafile API file-detail 404 为权威缺席证据；公开直链只作旁证）。缺 COS 凭据时该段跳过并 `::notice::`，其余段照测。判据：两段都 ≥ 2 MiB/s ⇒ 采纳；0.3–2 MiB/s ⇒ 采纳但需调 host 侧并发/超时；< 0.3 MiB/s ⇒ 改由 TX2 推或换对象存储。本探针只测量，发布仍走 `android-release.yml` 的直传路径。

### publish 的候选身份：显式版本，不是当前 main

```text
stage        → 产生不可变候选 X（tag android-vX + staging evidence X + APK X）
publish(X)   → 以 X 为候选发布；当前 main 可能已经走到 Y（Y > X）
```

`workflow_dispatch` 的 `version` 输入是 publish 的**唯一**候选入口：

- `mode=stage`：`version` 必须留空 / 被显式忽略，版本权威仍是当前 main 的 `android/gradle.properties`；
- `mode=publish`：`version` **必填**。GitHub 的 input schema 无法表达条件必填，因此 publish job 的第一步就 fail closed（空值或非 `X.Y.Z` 直接失败），绝不从当前 main 推导候选。

由 `version=X` 直接推导 `TAG=android-vX`、`APK=wotbtools-android-vX.apk`、`STAGING=wotbtools-android-vX.staging.json`，再取 tag target 源码（`git archive`）读取 `android/gradle.properties`、`contracts/android-native-bridge.json`、`deploy/agent/source.json`，得到真实的 versionName/versionCode/bridge/Agent pin。工作区的 `android/gradle.properties` **不参与**候选身份。

当前 main 在 publish 里只负责**策略与祖先关系**：ancestry（`tag target` 必须是 `origin/main` 祖先）、`ANDROID_MIN_SUPPORTED_VERSION_CODE` / cutover floor、runtime compatibility（staged contract 必须与当前 main 的 contract 一致，否则 bridge 已前进 → 拒绝）、以及 workflow 代码本身。

因此 X 在 main 前进到 Y 之后仍然可发布，当且仅当：X 的 tag target 是当前 main 的祖先 ∧ X 身份自洽（版本/tag/evidence/APK badging/sourceSha/bridge/Agent/bundle manifest 完全一致）∧ 当前策略允许 X（minSupported、bridge coverage）∧ 生产就绪探测通过。

任何 mismatch（请求版本 ≠ tag target 版本，请求版本 ≠ evidence/APK 版本，APK versionCode ≠ staged 源码 versionCode）一律 fail closed；`version.json` 依旧是最后一次写入。

## Schema 2 staging evidence

公开路径为 `/download/android/wotbtools-android-v<版本>.staging.json`。证据的每个身份字段都由实际 APK 核验，并在 publish 再次验证：

| 字段 | 校验来源 |
|---|---|
| schemaVersion | 必须为 2；schema 1 不被接受 |
| versionCode/versionName | staged 源码 `android/gradle.properties`（tag target）与 `aapt dump badging` 读取的 APK AndroidManifest |
| nativeBridgeVersion | immutable tag 的 bridge contract 与 APK manifest 的支持版本 |
| sourceSha/tag | immutable tag commit、APK bundle 的 buildCommit、当前 main ancestry |
| apkName/apkUrl/sha256 | 确定性发布路径与公开 APK 实际字节 |
| bundleManifestSha256 | APK 内 `assets/web/bundle-manifest.json` 的实际字节 SHA-256 |
| bundleFileCount | APK 中 assets/web 文件数，包含 bundle-manifest.json；bundle 自身 fileCount 不包含它 |
| agentWasmRelease/agentWasmCommit | tag 的 deploy/agent/source.json、bundle 身份与 pinned JS/WASM 文件 |
| runtimeOrigin/apiOrigin/assetOrigin | trusted local origin、生产 API、reviewed 资产源（`/agent-assets` 或 legacy gateway） |
| nativeRuntime | bridge 支持集合、native-auth capability、auth methods 与 auth event，和 tag contract 一致 |
| stagedAt | 格式合法的 UTC 时间，重跑保留 |

Bundle schema 2 的 `files` 清单列出每个内容文件的路径、大小、SHA-256。校验器对 APK 内完整文件集合逐项核验，同时检查 entry/WASM hash、总大小和数量；工作区里的清单不能代替 APK 内容。stage/publish/debug CI 都复用 `scripts/android-release/android_contract.py bundle`。

发布权威是已 staged APK，不是当前 main HEAD：tag target 必须包含在当前 main 历史里，但 main 可以在真机验证期间继续前进（`stage X` 之后 main 升到 `Y` 仍然允许 `publish(version=X)`）。Android Vue 已在 APK 内，发布不依赖生产 Web `/version.json` 或 Web build commit；Web 与 Android 是独立发布产物。

### 证据的存续

publish 的第一步就是按公开 URL 取证据（`https://wotbtools.com/download/android/<STAGING>`，经 Caddy 在 TX1/TX2 之间负载），因此证据不是「写一次就结束」的中间产物：

- stage 先把它传进各自宿主**不被服务**的中转目录（`/opt/wotb-tx{,2}/android-evidence.incoming`），再由 `deploy/tx/install-staging-evidence.sh` 在**宿主部署锁**（TX1 `/opt/wotb-tx/.deploy.lock`、TX2 `/opt/wotb-tx2/.deploy.lock`）下同文件系统 rename 进被服务目录。锁下 rename 同时给两侧保证：安装与 Replica 的「扫描 → 整树替换」互斥，且读取侧永远看不到半截 JSON。
- TX2 那棵树由 Frontend Replica 的 `deploy/tx/k7c-sync-runtime-content.sh` 整树替换，而该调用已在 `exec 9>/opt/wotb-tx2/.deploy.lock` + `flock` 内（锁覆盖 sync 的扫描与 swap）。它按设计只复制当前公开面（`version.json` + 该 manifest 指向的 APK），`*.staging.json` 是唯一例外：未发布版本的记录必须整份带走，否则证据在发布前消失，公开 URL 退化成按 origin 掷硬币。只把复制点前移到 swap 前一刻**不够**：扫描结束后、换树前落地的写入仍会随旧树进 `.previous`，互斥才是那个不变量。K7C 侧口径见 [operations/komodo-k7c-frontend-cutover.md](../operations/komodo-k7c-frontend-cutover.md)。
- 不变量由 `deploy/test-k7c-runtime-content.sh` 锁定：静态部分断言 Replica 在同一步里先取锁再跑 sync、stage 只经安装器在锁下落位、证据绝不直接 scp 进被服务目录；行为部分用真实脚本跑真实流程（换树后未发布证据仍在、已发布 APK 不进树、安装器在锁被占住时不可见且不落位、缺锁/缺目录/非证据文件一律 fail closed）。
- 人工执行 sync 必须自备同一把锁（`WOTB_TX_DEPLOY_LOCK_FILE=/opt/wotb-tx2/.deploy.lock bash deploy/tx/with-deploy-lock.sh …`），否则会重新引入与 stage 安装的交错。
- 因此 publish 第一步的 404 有两个已知含义：该版本从未 stage，或某台 origin 缺文件。先确认两台的文件是否都在，再按 stage 流程重跑该版本；**不要**在证据缺失时绕过 publish 的身份校验手工写 `version.json`。
- stage 末尾的「Verify production staging evidence」只对公开 URL 取样一次，命中任一 origin 即通过：它证明「至少一台在服务」，两台的一致性由上面的锁 + 不变量 + 契约测试保证，而不是由那次取样保证。

## 发布前真实依赖

所有探测只读且有超时，任何失败都阻止写 production version.json：

1. Keycloak `wotbtools-android` public client 与 private-scheme redirect 可用，认证走 PKCE。
2. `/api/users/profile` 真实 OPTIONS：Origin 为 staging evidence 的 `runtimeOrigin`（3.0 起 `http://127.0.0.1:21653`，2.x 为 appassets），Authorization 等请求头允许，GET/POST/PUT/PATCH/DELETE/OPTIONS 允许；ACAO 必须精确等于该 origin，不能是 wildcard，不启用 credentialed CORS。无 Bearer 的同一路由 GET 必须返回 401 且携带正确 CORS，证明 backend 可达。`deploy/tx/Caddyfile` 同时放行两个 exact origin（`@android` 与 `@androidLoopback`，字段逐一相同，`validate-caddy-config.sh` 对两者做同样校验）；新 origin 的 Caddy 改动必须在 publish 前已部署。
3. APK 资产源是**本机路径** `/agent-assets`（bundle identity 钉死，见 `android_contract.py`），由 Native `AgentAssetProxy` 直连对象存储。publish 从已验证的 immutable release tag 中读取候选 APK 对应的 `AgentAssetProxy.kt`，只接受 Alibaba origin `https://assets.wotbtools.com`（新版本）或 legacy COS origin `https://wotbtools-assets-1478073677.cos.ap-shanghai.myqcloud.com`（旧 staged APK），再对相应 origin 的 `index.json` 执行 GET 并要求返回 JSON object。这样 main 前进不会让旧 staged APK 错探新 origin。Native 资产请求不受 CORS 约束；gateway `/agent-assets` 只服务仍使用 legacy gateway identity 的旧 APK。详见 [资产源运维说明](../operations/agent-asset-origin.md)。
4. `ANDROID_MIN_SUPPORTED_VERSION_CODE >= 3015003` 且不超过 `latestVersionCode`；实际生效值由 repository variable 决定。Native Bridge 保持 v3。

Native Bearer runtime 请求头集合为 Authorization、Content-Type、Content-Encoding、Accept；Content-Encoding 用于 AI gzip。跨站 Cookie 和 WebView Keycloak 不属于这条发布链。

## 强制更新门槛（minSupportedVersionCode）的抬升

门槛值来自 GitHub Actions variable `ANDROID_MIN_SUPPORTED_VERSION_CODE`（**不在仓库内**，见
`gh variable list`），但它**只能随一次"严格更新版本"的 publish 写进 version.json**：
`classify_prod` 把 `minSupportedVersionCode` 计入同版本一致性判定，对 production 同版本直接注入
新门槛会得到 `prod_equal_conflict`（fail-closed）——同位改写被刻意禁止，抬门槛必然伴随一次
新版本发布。按「版本号递增规则」，抬门槛默认只在发布候选的 major 高于线上 major 时发生（含继承未发布 major 的 minor/patch 候选），门槛值为候选 major 的 `X.0.0`；用户明确指令的 patch/minor 例外（3.14.1 → `3014001`；3.14.2 → `3014002`；3.15.3 → `3015003`）见「版本号递增规则」。最小动作四步（**顺序不可交换**）：

1. 按变更等级递增 `android/gradle.properties:wotbVersion`（major，或同一未发布 major 之后的 minor/patch 候选；Version-as-Code，普通 PR），先不合并；
2. **先把变量设为目标门槛值**（`guard_min_supported` 校验 ≤ 新版本 code）——对 bridge / major cutover 这是 **stage prerequisite**：变量仍是旧 major 门槛时，合并触发的自动 stage 会在 `guard_bridge_covered` 上 fail-closed；
3. 合并 main → 自动 stage（构建/签名/上传/seed/tag/evidence，不写 `version.json`）；若该 PR 同时带有基础设施改动（例如 Caddy），由对应的 main-only workflow 在合并后自动部署，两者都成功后才进入下一步；
4. 真机验收通过后 `workflow_dispatch(mode=publish, version=<新版本>)` 写新 manifest（publish 身份核验不变）。

设置变量本身**不动** production `version.json`，因此**不会立刻**强制线上旧客户端更新——真正影响客户端的 commit point 仍是 publish 最后写入 `version.json`。但变量设为 `X×1_000_000` 之后，**不要再 stage / publish 任何低于该门槛的旧 major 候选**；这是有意的 cutover。若顺序搞错导致 stage fail-closed，修好变量后对同一版本幂等重跑即可（恢复路径，不是正常流程）——floor 守卫在 stage preflight 就失败，发生在任何 immutable artifact 之前，版本未被消耗。

客户端语义（`MainActivity.onVersionReady`，读 `version.json`）：`installedVersionCode < minSupportedVersionCode` ⇒ **强制更新**屏（阻塞入口）；`installedVersionCode < latestVersionCode` ⇒ 仅可选更新提示；其余不动。

- **3017007（3.17.7；2026-10-27 用户要求，随本候选 publish 生效）** —— 用户指令的 patch 强制更新例外延续：所有低于 3.17.7 的客户端必须升级，以取得隐藏段（盲炮）掉血在二次点亮兑现的血量链修复。目标为 `latestVersionCode = minSupportedVersionCode = 3017007`；设置仓库变量或完成 stage 均不代表该门槛已经对线上客户端生效。
- **3015003（3.15.3；2026-10-20 用户要求，随本候选 publish 生效）** —— 本次是用户指令的 patch 强制更新例外：所有低于 3.15.3 的客户端必须升级，以取得共面续飞判定修复。目标为 `latestVersionCode = minSupportedVersionCode = 3015003`；设置仓库变量或完成 stage 均不代表该门槛已经对线上客户端生效。

## Rollout 与验证

### 物理 Android 发布验收矩阵（每个 production release 必跑）

publish 之前必须在至少一台 Android 9 问题机 + 一台 Android 13+ 真机上完成，记录型号 / Android / ABI / GeckoView 版本 / APK SHA。CI 只构建 debug APK 与 JVM 单测，不覆盖以下真机项：

- **启动与基础运行**：冷启动、飞行模式启动、重启后偏好保留。
- **认证**：QQ 登录 → 回跳 → 登出；登录态刷新；授权中 process death/resume；expired token offline。
- **回放**：单/多文件导入、分享/打开 replay、目录导入、WASM 解析、统计、Rating、2D、3D / Armor / 贴图、连续切换 replay、前后台切换（含系统回收恢复）、断网 / 恢复。
- **导出 / 下载（GeckoView blob 链）**：网页 PNG blob 导出、HoF replay 下载、tournament XLSX 导出 → 保存成功；核对文件内容 / 文件名 / MIME；取消与失败后重试。
- **文件选择 / 导航**：select 打开时页面导航、选项更新后导航、file picker 打开时导航及迟到结果（新页面不可收到旧文件）。
- **更新**：检查更新 → 下载 → 安装（含旧版本覆盖安装当前版本）；外链交系统浏览器；软键盘不遮挡输入。
- **出站网络**：用 PCAPdroid 等免 root 工具观察一次「冷启动 → 闲置 → replay → 3D → 登录」；只应出现 wotbtools.com / 对象存储 / auth / 下载源；出现 Mozilla / Google 服务流量时先用 GeckoView 公开设置关闭，关不掉即阻塞发布。
- **界面**：fullscreen 进出与 Back、横竖屏、软键盘。

没有物理设备时不能把真机项目标为 PASS，production `version.json` 保持不变。

stage 不探测 API CORS、asset gateway 或 Keycloak client；它们是 **publish** 的就绪前提（publish 的 readiness 步骤会 fail-closed）。随候选 PR 一起修改的网关配置由合并后的 main-only workflow 部署，必须在 publish 之前成功。完成物理 Android 矩阵后才手工 `workflow_dispatch(mode=publish, version=<已 staged 版本>)`。没有物理设备时不能把真机项目标为 PASS，production version.json 保持不变。

`scripts/android-release/test-release.sh` 覆盖版本/幂等分类、cutover floor、schema2 stage/publish roundtrip、每个证据字段被破坏时 fail-closed、APK 文件损坏、真实版本不符、CORS wildcard/credentials/headers/methods/HTTP 错误；同时锁定 publish 不重建与 version.json 最后写入，并覆盖 publish 候选解析（显式 staged 版本优先于已前进的 main、缺版本、未 staged 版本、tag target 版本不符、staged 源码不自洽）。`scripts/ci/test-workflow-contract.sh` 校验 owner 与实际 workflow 接线（含显式 `version` 输入、publish 不读当前 main 版本、version.json 由 staged 身份写出）。

CI 还构建 debug APK，验证本地启动/Bridge/replay 合约及离线 bundle；真机仍负责实际 GeckoView 渲染、OEM Intent、native auth/refresh/process-death、飞行模式冷启动与本地回放全链路。

## 构建约束、运行时升级与回滚

**APK 体积与超时**：release APK 自带 GeckoView（双 ARM ABI）与完整 frontend bundle，约 200 MB 量级。`android-release.yml` 按此设置 stage job 120 分钟、清华上传 `--max-time 2700`、副本与生产 APK 回读 `--max-time 900`、publish job 90 分钟。release APK 若异常膨胀，先回到产品决策（例如只保留 arm64），不要只调超时。

**GeckoView 升级**：只用 stable channel 与精确版本（`android/app/build.gradle.kts` 的 `geckoViewVersion`）。每次升级是一次独立的 Android minor 发布（至少每季度一次；遇关键安全修复立即），升级时同时检查 AAR 的 `minCompileSdk` 与 Kotlin metadata 版本是否要求工具链跟进。

**回滚**：floor 一旦为 `3000000` 或更高，2.x 不再是合法的生产回滚目标；`version.json` 也不能指回 2.x、不能复用已存在的 immutable release tag、不能手工上传 APK。

- **Tier A（首选）**：只换引擎——写一个 System WebView 版适配器，加载同一 `http://127.0.0.1:21653`（AndroidX `addWebMessageListener` 支持 IP + 端口的 origin rule），复用 LocalRuntimeServer 与全部 Native 能力，补 `onRenderProcessGone`。contract v3 / 前端 / CORS 都不变，因此不触发 bridge gate；发布一个高于当前 production 的新版本，版本等级按实际修复严重度重新分类，floor 按上文版本规则计算；同 major 的 minor/patch 不抬 floor，跨 major 的候选继承对应 major 的强制升级义务。
- **Tier B（最后手段）**：恢复 appassets + WebViewAssetLoader runtime。contract 的 origin 再次改变，必须 bridge 4、前端 `[4]`；发布版本与 floor 按上文 wire breaking 的 major 规则计算，且依赖 Caddy 仍保留 appassets CORS（因此不要急于删除 `@android`）。

## 签名与基础设施

正式版本保持同一 signing key。keystore/口令来自 GitHub Secrets，证书 SHA-256 来自 GitHub Variable；缺失或不匹配均 fail-closed。`/download/android/` 的 bind mount 必须先上线。`version.json` 是唯一强制更新 commit point，必须在上述身份与就绪检查之后作为最后一次上传。
