# Battle Playback HD Basemaps + 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — REVIEW FIX IN PROGRESS

## 范围

- 29/29 HD basemap 均由对应原图独立生成，原图永久保留为 rollback/source-of-truth。
- HD 资源增加 deterministic gate：coverage、SHA-256、实际 WebP 尺寸、严格 2× frame、无 crop/aspect drift、mapImages import coverage、单图 5 MiB / 4× growth budget。
- terrain attitude 继续复用 authoritative heightfield + canonical hull yaw + 真实车辆 footprint；不伪造 replay Z。
- 新增 yaw=90°、反向 sign、45° diagonal 的局部轴回归测试。
- 29/29 source ↔ HD 视觉几何仍需人工 QA；`geometryTransform=NONE` 不作为视觉真实性证明。

---
# Battle Playback 2.5D Vehicle Terrain Attitude

## 状态

IMPLEMENTED — READY FOR PR REVIEW

## 范围

- 保持现有 2D hull/turret 与 Tier X dedicated top-view assets，不引入 3D 坦克模型。
- 复用 2.5D authoritative terrain heightfield，在车辆 footprint 的前/后/左/右采样地面高度。
- hull yaw 仅负责把 terrain slope 转到车辆局部轴；pitch/roll 只作用于 `.pb-graphics`。
- HP、标签、hitbox、selected/recorder、碰撞布局继续 screen-aligned，不随车体倾斜。
- 视觉 pitch/roll 做轻度放大并分别 clamp ±14° / ±10°；不伪造 replay Z。

## 验收

- [x] 上坡/下坡可见车头抬起/下压；横坡可见轻微 roll。
- [x] flat terrain = 0° attitude。
- [x] marker 真实 footprint 继续来自现有 `vehicleMarkerSizing` SSOT。
- [x] 无 heightfield 或无可靠 hull yaw 时退化为原 2D marker，不猜方向。
- [x] targeted unit tests 覆盖 pitch/roll/clamp 与 graphics-only transform。

---
# Team AI Tactical Review v0.1

## 状态

IMPLEMENTED IN WORKTREE — READY FOR REVIEW

## 范围

- 保留现有 Canonical BattleTimeline → deterministic evidence → Team Call #2 → grounding validator 架构。
- 通过 `AiPromptLibrary` include 注入 team-execution、position-tempo、hp-trades、mode-objectives 四个紧凑模块。
- 修正 `primaryDiagnosis`：表示本场最重要结论，不强制制造错误；保留 JSON 字段避免无关契约变更。
- 明确 Strategic Prior 只是战略基线/可能性空间，不是实际队伍计划；禁止推断语音、call、通信或指挥责任。
- 复用现有中性 timeline/evidence（进入时序、空间分离、局部人数、信息更新、点数与交火），不建立第二套 episode 或后端战术 verdict。
- 增加三语 prompt contract、golden cases、validator/no-fault 回归，并同步 AI 架构与 Team Review 文档。

## 验收标准

1. Team prompt 含四个模块，EN/RU 本地化不残留中文模块规则。
2. Prompt 明确 evidence-insufficient → skip、operation vs decision、position > kill、HP/gun value、commitment/half-commit、rotation/tempo 及模式目标经验规则。
3. Prompt 不把最新到达者自动定责，不把 Strategic Prior 当实际计划，不推断 communication/call。
4. `primaryDiagnosis` 可自然表达无明显确认错误/关键成功因素/对手处理更好；validator 仍要求结构完整与 grounding。
5. Golden cases A–H 注册并通过 deterministic prompt harness；相关单测通过。
6. 文档与实现一致；不新增 backend tactical verdict。

## 实施与验证记录

- [x] 从 `main` 建立独立 worktree `feature/team-ai-tactical-review-v01`。
- [x] 添加四个模块化 ZH prompt 资源与 EN/RU localization anchors。
- [x] 更新 Team prompt、主诊断/Strategic Prior 契约与核心 envelope 文档。
- [x] 更新 docs/architecture/ai-review.md 与 docs/features/team-ai-review.md。
- [x] 添加/更新 deterministic tests 与 golden cases。
- [x] 运行 targeted Maven tests（Web 15/15、Core validator 80/80）。
- [x] 完成 review-fix / code-smell / review-with-docs 自审闭环；OCR workspace preview 识别 11 个 reviewable 文件，未发现 blocker。

## 结果边界

- 本 worktree 未执行 DeepSeek live provider evaluation；该项仅作未来手动诊断工具，默认永远 skip，不进入 CI 或 PR 合并条件。A–H 的 deterministic static prompt/evidence contract 是本 PR 的 merge gate；live scenario 只提供 facts，expected behavior 仅存在于 assertions。
---
# 3D Battle Playback First — PR1 Client Map Research

## 状态

**COMPLETE / PR1 GATE PASS / PR247 REVIEW FIXES APPLIED / PR2 HANDOFF READY**

PR #247 已完成 Client Map Research 主目标，并闭环 review 发现的 2 个 MAJOR + 1 个 MINOR，以及复审发现的 raw `.sc2` default-discovery BLOCKER。

## 核心 contract

```text
SC2 Entity
  -> RenderComponent
  -> Mesh
  -> RenderObject initial visibility
  -> active RenderBatch (LOD/switch, shared -1)
  -> rb.datasource
  -> companion SCG
  -> unique PolygonGroup #id
  -> vertices / indices
```

### Canal / `18_canal_cn`

- recursive SC2 entities：2,725
- SCG PolygonGroups：237
- datasource exact match：237 / 237
- unmatched / unreferenced：0 / 0
- schema v3 geometry：70
- Mesh instances：590
- positions：85,028 / 1,020,336 bytes
- indices：156,543 / 626,172 bytes
- invisible RenderObject skipped：363
- selected diagnostic State 0：347
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

### Port Bay / `14_port_pt`

- recursive SC2 entities：3,890
- SCG PolygonGroups：217
- datasource exact match：217 / 217
- unmatched / unreferenced：0 / 0
- schema v3 geometry：80
- Mesh instances：1,326
- positions：65,291 / 783,492 bytes
- indices：123,054 / 492,216 bytes
- invisible RenderObject skipped：713
- selected diagnostic State 0：596
- selected diagnostic State 1：0
- mutually-exclusive overlap：0

## DAVA selection semantics

```text
(batch.lodIndex == requestedLod OR batch.lodIndex == -1)
AND
(batch.switchIndex == requestedSwitch OR batch.switchIndex == -1)
```

```text
RenderObject::VISIBLE = 1 << 0
explicit ro.flags -> require bit 0
missing ro.flags  -> visible by RenderObject::Load default
```

Production selector 不读取 `State 0` / `State 1` filename。

## PR247 review closure

### MAJOR 1 + 复审 BLOCKER — raw `.sc2`

- `.dvpl` member 才调用 `decode_dvpl`；
- raw `.sc2` 直接传给 `read_sc2`；
- 默认 exact main discovery 同时支持 `.sc2.dvpl` / `.sc2`；
- exact main 不存在时，fallback discovery 同时支持 `.sc2.dvpl` / `.sc2`；
- `inspect_map_scene.py` 与 `inspect_map_state_switchers.py` 使用相同 discovery contract；
- state-switcher inspector 新增 `--scene`，多 SC2 场景可显式选择；
- regression test 覆盖 raw `.sc2` exact、raw fallback、state explicit override；
- `inspect_map_scene.main()` 端到端测试验证不传 `--scene` 时 `Maps/99_test/99_test.sc2` raw bytes 原样进入 `read_sc2`。

### MAJOR 2 — duplicate PolygonGroup id

- `wotb_scg.read_scg()` 在共享 parser boundary 校验所有可解码 `#id` 唯一；
- duplicate id 直接 `Sc2ParseError` fail-fast；
- 错误包含 duplicate id 与两个 PolygonGroup index；
- exporter 使用共享 `polygon_groups_by_id()`，不再静默覆盖；
- SCG inspector 同样无法让 duplicate id 进入 set-based cross-check；
- regression test 覆盖 duplicate id。

### MINOR — nested scene entities

- scene inspector 改为 recursive `#hierarchy` traversal；
- report schema v3；
- `sceneTraversal.mode = recursive #hierarchy`；
- target component sample 包含 `entityPath`；
- regression test 覆盖 nested RenderComponent / CollisionTypeComponent。

## PR2 handoff

```text
SC2 + companion SCG + heightmap + existing map semantics
  -> deterministic renderer-neutral manifest
  -> shared local static geometry buffers
  -> initially-visible instance transforms
  -> terrain representation
  -> canonical world bounds / coordinate metadata
  -> transformed world-AABB sanity report
```

Canal + Port Bay 继续作为双地图 gate。

## Collision / nav 边界

- `CollisionTypeComponent` metadata 已证明；独立 gameplay collision mesh 未证明；
- `.mkm/.lka` 与 TerrainData association 已证明；navmesh/passability semantics 未证明；
- visual PR2 不消费未经证明的数据。

## PR1 DoD

- [x] Maps.zip inventory
- [x] terrain + coordinate baseline
- [x] SCPG / PolygonGroup parser
- [x] recursive SC2 datasource ↔ SCG exact link
- [x] vertex/index decoder
- [x] unique PolygonGroup id invariant
- [x] RenderBatch shared `-1` contract
- [x] initial RenderObject visibility contract
- [x] raw `.sc2` / `.sc2.dvpl` decode + default discovery + fallback
- [x] state-switcher explicit scene override
- [x] recursive scene inspector
- [x] Canal schema v3 final gate
- [x] Port Bay schema v3 final gate
- [x] collision/nav research boundary
- [x] PR247 review findings closure

**PR1 blocker = 0. PR2 handoff ready.**

---

# Team AI Review v0.3：降低过度压缩，提升完整战术解释

## 状态

IMPLEMENTED — TARGETED TESTS PASS — LIVE PROVIDER NOT RUN

## 执行记录

- [x] 从最新 `origin/main` 创建独立 worktree 与 `feat/ai-review-v03-complete-explanation` 分支。
- [x] 审计 Team prompt、reasoning contract、三语 localizer 与 Team Call #2 输出上限；未修改 backend tactical inference。
- [x] 将输出目标调整为 selective but complete：关键 episode 完整解释 Information/Objectives/Local/Propagation 因果，保留反 timeline-dump 约束。
- [x] 将「重点复查」与「高贡献者」明确为有 structural evidence 时才输出的可选 section，并同步三语 prompt contract。
- [x] 将 Team Call #2 默认专用输出上限调整为 8192 tokens，并更新 deterministic prompt tests 与三份指定文档。
- [x] targeted tests：139 tests pass；首轮使用项目 settings.xml 遇到 Aliyun TLS PKIX，改用本机 Maven cache 后完成验证。
- [x] review-fix / review-with-docs / code-smell：OCR reviewable 2/2，excluded 文件人工审查，Blocker count 0。
- [x] commit / push / PR：`4c5ead50` 已推送，PR #258 已创建。

---

# Team AI Review Quality Harness v1

## 状态

IMPLEMENTED IN WORKTREE — TARGETED TESTS PASS — LIVE PROVIDER NOT RUN

## 执行记录

- [x] 从 `origin/main` 创建独立 worktree 与 `feat/team-ai-review-quality-harness-v1` 分支。
- [x] 添加 additive `evidenceBasis`、推理顺序和 deterministic shortcut contract。
- [x] 添加 6 个真实回放 gold case 与 production-chain offline harness。
- [x] 添加显式 opt-in real-replay benchmark、runs/report/baseline metadata 约定及 0-token isolation guard。
- [x] 更新 AI 架构、Team review、evaluation operations 与 changelog 文档。
- [x] targeted Maven tests 通过；未调用 DeepSeek / ai-live。
