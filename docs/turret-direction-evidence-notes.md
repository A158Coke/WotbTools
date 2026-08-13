# 真实性门禁 B：炮塔相对方向（turretRelativeYaw）事件流数据源 — 证据笔记

> 状态：**PROBE_RUN / VERDICT = NOT_PROVEN（2026-08-13 量化回填完成）**。探针已在随机战夹具上跑通（Tests run: 1, 0 失败），量化结果见各检查项。
> 日期：2026-08-12（会话）。样本：提交夹具 common/fixtures/replays/random-battle-example.wotbreplay（rift，arenaBonusType=1 随机战，时长≈302.7s）；
> common/data/ 无本地额外样本。
> 探针：java/wotb-core/src/test/java/com/wotb/core/TurretDirectionProbeTest.java（新增，可重复运行；无样本时 Assumptions 自动跳过）。

## 任务定义

- 目标：为「战局回放」双层坦克标记（车体/炮塔独立旋转）找到**按实体分发**的炮塔相对方向数据源。
- 权威约定（docs/current-plan.md 第五节）：hullYaw 直接用 type-10 yaw（禁止移动向量推导）；turretRelativeYaw 必须经真实样本证明；
  turretWorldYaw = normalize(hullYaw + turretRelativeYaw)。
- 候选：type-7 propId=2（平滑变化值，已知与 type-10 yaw/pitch 不一致，误差 80°/148°，疑炮塔朝向未定案）。

## 已有证据（来自 docs/replay-reverse-engineering.md，团队样本 CHRD neptune 9034890693886323 + 随机夹具）

- type-7 属性包结构已确认：`eid(u32) + propId(u32) + valueLen(u32) + value(1-4B)`；propId ∈ {0,1,2,3,4,7,8,9}（不同样本观测子集）。
- propId=2 在团队样本 eid=12558550 上 622 个样本（valueLen=2），按 u16*360/65536 解码后与同车 type-10 pitch 均差 ≈148°（不支持车体 pitch）；
  与 yaw 均差 ≈80°（均值大、分布未知 → 疑独立变化，但未量化 std/连续性/角速度）。
- propId=3 = 当前血量（u16 LE）已确认；propId=4 疑似双态（弹药/炮状态）；0/8 = 标志。
- type-39（120Hz×7 floats）为录像者相机/瞄准流：f0=相机 yaw（度）、f1=相机 pitch、f5/f6=有界角（弧度，疑炮/瞄准方向）——只覆盖录像者，**不能**作全体车辆炮塔方向（任务禁止项）。
- 位置覆盖：本方（录像者队伍）开局完整；敌方静止时不上报 type-10 位置（移动/交火后出现）。

## 探针设计（TurretDirectionProbeTest，按调查清单 10 项）

以下每项写明：方法 / 样本 / 量化输出 / 判定判据。**量化结果列待探针实际运行后回填**（本会话未能执行 mvn，见文末）。

### 检查项 1：字节序 / signed / unsigned / 缩放 / 角度单位

- 方法：对 propId=2 全部样本统计 valueLen 直方图（{1,2,4}）；对每个 valueLen 逐一尝试候选解码：
  - valueLen=4：f32[rad]、f32[deg]、u32*360/2^32、i32*360/2^32；
  - valueLen=2：u16*360/2^16、i16*360/2^16（u16/i16*2π 与 360 等价，不重复）；
  - valueLen=1：u8*360/2^8、i8*360/2^8。
  - 每个候选与同车最近（≤0.5s）type-10 yaw 与 pitch 求角度差（归一到 ±180°），输出 n / meanErr / pct<30°。
- 样本：随机夹具全部车辆 eid（entityToAccount 内）。
- 量化结果：**待运行**（已有先验：u16*360/65536 vs pitch ≈148°、vs yaw ≈80°，团队样本）。
- 判定判据：若某候选与 yaw/pitch 均差极小（<10° 且 pct30 高）→ 该候选就是车体角，prop2 与车体锁定；若均差大但分布集中为「常数偏置」→ 与车体固定偏置；若均差大且分散 → 独立角度量（炮塔候选）。

### 检查项 2：按 entity 分发 / 队伍覆盖

- 方法：每 eid 统计 propId=2 数量、首末时间、span；用 updateArena2（type 8 sub 48）解码 eid→team；标记录像者 eid（meta dbid→account→eid）。
- 输出：逐 eid 表（n/firstT/lastT/span/team/是否录像者）；eids 同时有 type-10 位置与 prop2 的数量。
- 判定判据：若 prop2 只出现在录像者 eid → 与 type-39 同类（客户端专属，否决）；若覆盖双方全部车辆 eid → 按实体分发成立。

### 检查项 3：车体静止时 propId=2 是否独立变化

- 方法：对每车 type-10 位置序列找「静止 run」（连续样本 dt<0.5s、|Δx|,|Δz|<0.05m、|Δyaw|<0.005rad、时长≥3s）；统计 run 内 prop2 的 min/max/range。
- 量化：runs 总数、range>8° 的 run 数（VARYING）。
- 判定判据：静止车体下 prop2 大范围变化 → 独立自由度（炮塔），强证据；恒不变 → 与车体同源或不同步。

### 检查项 4：连续性与 wrap-around

- 方法：逐 eid 相邻 prop2（dt≤0.2s）求解码度差，按 |step| 分桶：<2° / 2-45° / 45-300° / >300°（wrap 特征）；并输出 unwrap 后最大步长。
- 判定判据：若存在大量 ≈±(360-ε) 的跳变（wrap 桶高）且 unwrap 后步长小 → 角度量在 [0,360) 回绕，符合角度语义；若无 wrap 且步长连续 → 非回绕量或非角度。

### 检查项 5：变化速率（角速度）

- 方法：prop2（默认解码 u16*360/65536）相邻样本 |Δ|/dt（dt≤0.2s）→ deg/s 分布（mean/med/p90/p95/max、≤30/45/60°/s 占比）；对照组：同 eid 的 type-10 yaw 角速度。
- 判定判据：Blitz 炮塔旋转约 20-40°/s（重坦更慢、轻坦更快，上限 ~50°/s）。若 prop2 角速度集中在该量级、且明显区别于车体 yaw 角速度（通常更慢/零）→ 炮塔旋转特征；若与 yaw 一致 → 车体角。

### 检查项 6：与同刻 type-10 yaw 的关系（(prop2 - yaw) 分布）

- 方法：逐 eid，prop2（默认解码）与最近（≤0.5s）yaw 的差 Δ = angDiffDeg(prop2, yawDeg)：n / mean / std / min / max。
- 判定判据：std≈0 且均值恒定 → prop2 与车体锁定（车体角 + 常数偏置，非相对炮塔角）；std 大且均值非 0 → prop2 独立于车体（相对角或绝对角候选，需 [7]/[39x] 定方向语义）。

### 检查项 7：录像者开火时刻 prop2 是否指向目标

- 方法：type-23=0（开火）时刻，取录像者 prop2 与位置；其后 ≤2.5s 内 attacker=录像者的 DirectDamageEvent → 目标 eid → 目标位置；计算 bearing（atan2(dz,dx) 与 atan2(dx,dz) 两种约定取较小误差）。
- 输出：每次开火 |prop2-bearing|、|yaw+prop2-bearing|、|yaw-prop2-bearing|；汇总均值。
- 判定判据：若 |prop2-bearing| 小（<15°）→ prop2 为绝对炮塔/炮管方向；若 |yaw+prop2-bearing| 或 |yaw-prop2-bearing| 小 → prop2 为相对炮塔方向（决定加减号）；两者都大 → 与开火无关。

### 检查项 7b：录像者受击时刻攻击者 prop2 是否指向录像者

- 方法：对 victim=录像者的 DirectDamageEvent（配合 type-26 来袭事件窗口），取攻击者 eid 的 prop2/位置与录像者位置，同样计算三种假设误差。
- 判定判据：同 [7]。此检查把锚点扩展到**敌方车辆**（不再限于录像者），是「全体车辆炮塔方向」的关键验证。

### 检查项 8：随机战 vs 团队样本编码一致性

- 方法：本会话仅有随机夹具；common/data 无额外样本 → 输出 valueLen 直方图并注明「仅随机样本，团队样本待补充」。
- 判定：**N/A（样本不足）**——需用户提供训练房/团队回放复跑对比。

### 检查项 9：覆盖与阵亡/观战行为

- 方法：车辆 eid（有 type-10 位置且 e2a 内）中 prop2 覆盖比例；按队伍统计；逐车 prop2 最后时刻 vs 位置最后时刻 gap；录像者（最后 type-31 时刻为存活窗口代理）阵亡后 prop2 是否继续。
- 判定判据：双方车辆均有覆盖且语义一致；阵亡/观战切换后 prop2 不再更新（冻结）或停止 → 生命周期行为合理；若阵亡后继续大幅变化 → 疑伪数据源。

### 检查项 10：hull yaw 验证（type-10 yaw 直接可用性）

- 方法：逐车：yaw/pitch/roll finite 比例、相邻步长 maxStep、静止时 yaw 恒定（静态 std）、移动方向 vs yaw 的两种约定误差（atan2(dz,dx) / atan2(dx,dz)）、|yaw-移动方向|>90° 的样本数（倒车/横移案例）。
- 判定判据：yaw 全 finite、连续（unwrap 后步长小）、静止恒定、移动时与位移方向一致（某约定 meanErr 小）→ yaw=车体朝向权威；出现 |yaw-位移方向|>90° 样本 → 证明 yaw 不是速度向量推导（倒车不翻转车体），hullYaw=type-10 yaw 直接可用。

### 补充检查 [39x]：录像者 prop2 vs type-39 f5/f6（有界弧度角）

- 方法：录像者 prop2（默认解码）与最近（≤0.05s）type-39 f5/f6 的差：|prop2-f5|、|prop2-yaw-f5|、|prop2-f6|、|prop2-yaw-f6|。
- 判定判据：若 |prop2-f5| 小 → 同一物理量（f5 是某绝对角）；若 |prop2-yaw-f5| 小 → f5 为相对角而 prop2 为绝对角（或反之）。此交叉检查可为 [7] 提供独立锚点。

## 运行与复现

```
cd java
$env:JAVA_HOME = Join-Path $env:USERPROFILE '.jdks\jdk-21.0.1'
mvn -s settings.xml test -Dtest=TurretDirectionProbeTest -Dsurefire.failIfNoSpecifiedTests=false
```

- 探针自动发现 common/fixtures/replays 与 common/data 下全部 .wotbreplay；无样本自动跳过（Assumptions）。
- 输出全部以 `== [N] ...` 小节打印（surefire 控制台）。
- 2026-08-12 会话：DSH 运行环境的 pwsh/subagent 工具进入间歇性故障（`invalid arguments: missing required property description`，与内容无关、重试亦不稳定），mvn 未能执行；探针与本文档已就绪，需在工具恢复后运行并回填量化结果。

## 量化结果（2026-08-13，随机战夹具 random-battle-example）

- **[1] valueLen**：prop2 全部 12138 个样本 valueLen=2（u16）；默认解码 u16*360/65536，解码后值域集中在 ≈126–247°（未跨 0/360）。
- **[2] 按实体分发**：16 个车辆 eid 中 14 个有 prop2，**双方各 7/7 全覆盖**（非录像者专属）。
- **[3] 车体静止独立性**：30 个静止段（|dx|,|dz|<0.05m、|dyaw|<0.005rad、≥3s）中 **8 段 prop2 变化 >8°**（最大 76.6°）→ prop2 是独立于车体的自由度。
- **[4] 连续性/wrap**：10333 个相邻差分 100% ≤45°（49.7% <2°），0% 落入 45–300°，**0% wrap 跳变**；unwrap 后最大步长 5.64° → 平滑连续量，但该解码下无回绕。
- **[5] 角速度**：prop2 mean 17.5°/s、p95 38.8、max 68.7（98.1% ≤45°/s）；同车 hull yaw mean 5.2°/s（median 0.0）→ prop2 比车体快得多，落在炮塔旋转量级。
- **[6] (prop2−yaw)**：逐车 std 61–115°、均值 −73～+62° → 与车体不锁定（独立角度量）。
- **[7] 开火指向（决定性阴性）**：38 次开火、9 次命中，命中时刻 mean|prop2−bearing|=87.5°、|yaw+prop2−bearing|=95.5°、|yaw−prop2−bearing|=62.4°——三种假设（绝对炮口 / 相对角加 / 相对角减）**无一指向命中目标**（仅 1 次巧合 0.4°）。炮塔假设必须满足「开火时炮口指向目标」，该约束不成立。
- **[7b] 受击反向**：n=2，mean|prop2−bearing|=58.1°（样本不足，不支持也不排除）。
- **[7c] 开火轨迹**：开火前后 prop2 平滑渐变，无朝目标快照收敛。
- **[8] 编码一致性**：仅随机战样本；团队样本 N/A（需补充训练房回放复跑）。
- **[9] 覆盖/生命周期**：prop2 在部分车辆早于位置流 48–166s 停止（283127381 prop2 止于 97.3s=阵亡 97.4s，但 283127369/283127373 阵亡后仍持续 30s+）；录像者阵亡窗口（last type-31=296.8s）后仍有 26 个 prop2 样本 → 生命周期语义不一致。
- **[10] hull yaw（type-10 yaw）**：全部 14 车 nonFinite=0、相邻最大步长 3.9–9.6°、静止时恒定；倒车/横移案例（|yaw−移动方向|>90°）大量存在（录像者 113/1190）→ **yaw 是车头朝向而非速度向量，hullYaw 可直接用 type-10 yaw（弧度）**。
- **[39x]**：mean|prop2−f5|=175.3°、|prop2−yaw−f5|=110.1° → prop2 与 type-39 f5/f6 非同源量。

## 多样本复跑（2026-08-13，common/data 扩充：6 个 11.18 样本 + 9 个 9.4–10.1 旧版样本）

- **编码稳定性（检查 8 有数据了）**：prop2 全部样本 valueLen=2（u16），从客户端 9.4.0（2022-12）到 11.18.0（2026-08）四年不变；满编战斗（14 车）双方 7/7 全覆盖。
- **开火指向检查（决定性，4 个现代样本 30 次命中）**：
  | 样本 | 命中 | \|prop2−bearing\| | \|yaw+prop2−bearing\| | \|yaw−prop2−bearing\| |
  |---|---|---|---|---|
  | fixture（rift 随机） | 9 | 87.5° | 95.5° | 62.4° |
  | 1535（malinovka 训练） | 6 | 89.1° | 53.0° | 58.5° |
  | 1555（neptune supremacy） | 9 | 77.5° | 111.6° | 68.8° |
  | 1600（neptune supremacy） | 6 | 67.3° | 71.3° | 47.9° |
  三种假设在全部样本上均不指向命中目标（最小均值 47.9°，远大于 <15° 判据）——prop2 不是炮管水平方向的任何简单线性编码。
- **受击反向（7b，4 样本）**：mean 13.1–58.1°（n=2–8/场），同样不支持。
- 旧版样本（9.4–10.1）eid→账号映射缺失，无法跑开火锚点，仅贡献编码稳定性证据。
- 结论不变：**turretRelativeYaw NOT_PROVEN**；**hull yaw（type-10 yaw）PROVEN 可用**（多车 finite/连续/倒车独立）。

## 结论（2026-08-13 最终）

- **turretRelativeYaw 数据源：NOT_PROVEN**。prop2 满足独立自由度/角速度/双方覆盖（检查 2/3/4/5 通过），但**开火指向检查（决定性）失败**——三种角度假设在命中时刻均不指向目标；且无 wrap、值域仅 ≈126–247°、生命周期不一致、仅单样本、与 f5/f6 非同源。不能把它当炮塔相对方向用于生产。
- **hull yaw：PROVEN 可用**——type-10 yaw 全部 finite、连续、静止恒定、与移动向量独立（倒车案例 113/1190），可直接作为车体方向权威源（单位弧度，前端换算）。
- 禁止项维持：不得用 type-39 相机 yaw 冒充炮塔方向；不得固定 turretRelativeYaw=0；不得用移动向量推导 hullYaw。
- 由于门禁 B 未通过，**后端方向播放契约（hullYaw/turretRelativeYaw）与双层坦克标记暂不落地**；hullYaw 证据已备，待 turret 证据补全后一并接入。
- 需要用户补充：① 训练房/团队回放（≥2 场）复跑检查 1–7；② **游戏内录屏**：车体静止、炮塔匀速转动（0°→90°→180°）逐秒标注，校准 prop2 解码与真实炮塔角；③ 开火瞬间录屏（含命中目标方向），验证检查 7 的坐标系约定。
