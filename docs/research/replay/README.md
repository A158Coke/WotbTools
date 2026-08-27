# WoT Blitz Replay Protocol Research Archive

本目录系统记录 WotBTools 对 `.wotbreplay` 的逆向研究。

> 当前 canonical corpus：34 个唯一 Blitz `11.19.0_china` arena。
>
> 当前状态：**RESEARCH-COMPLETE for the observed 11.19 corpus**。
>
> 这里的 complete 指所有 observed surface 已 inventory、分级、反证或边界化；不是声称拿到了所有 Wargaming 私有变量名。

## 研究原则

- 所有语义使用 `PROVEN / VERY STRONG PARTIAL / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED`。
- `PROVEN` 必须有当前 replay 行为闭环；schema、客户端代码、物理效应、多 POV、settlement 只用于独立加强。
- UNKNOWN 不为了业务方便强行命名。
- packet/method/property/component 数字按 client version + entity class 解释；历史 PC/WoT ordinal 不能直接套当前 Blitz。
- counterexample 必须保留；被新证据推翻的解释标 `SUPERSEDED/REJECTED`。
- single-POV/AoI 缺失属于信息边界时明确记录，不伪造 100%。

## 权威读取顺序

后续实现/审查必须按这个顺序读：

1. `inventory.md` — **当前 canonical 总账**，当前事实入口。
2. `research-completion-audit-11.19.md` — completion gate、剩余 external-evidence boundaries。
3. 对应专项 closure 文档 — 某个字段/机制的完整证据链。
4. `protocol.md`、早期 broad summary / probe 文档 — 研究轨迹与历史上下文；若冲突，以 1–3 为准。

早期文档可以保留当时的假设和探索过程，不应脱离 `inventory.md` 单独作为生产事实来源。

## 核心专项 closure

### 模块 / 乘员 / damage lifecycle

- `method16-device-crew-code-map.md` — component ID 真源。
- `method16-damage-state-codeA.md` — damage-state lifecycle。
- `track-side-orientation-closure.md` — 34/35 左右履带 target-local geometry 闭环。
- `gun-damage-dispersion-closure.md` — 36 Gun 物理效应闭环。
- `fuel-tank-observation-device-closure.md` — 33 Fuel Tank / 38 Observation Device。
- `ammo-rack-and-loader-damage-codes.md` — Ammo Rack / Loader。
- `recovery-consumable-discriminator.md` — Repair Kit / First Aid / MPRP 差分。

Current component namespace：

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
39 Commander            PROVEN
40 Driver               PROVEN
41 Gunner               PROVEN
42 UNKNOWN / unobserved
43 Loader               PROVEN
```

### 射击 / 弹道 / hit result

- `projectile-lifecycle.md` — method29 launch / shotId / method20 terminal / method27 branch。
- `avatar-shot-results.md` — method38 broad structure/history；当前精确语义以以下专项 closure 为准。
- `method38-current-hit-flag-reconstruction.md` — **当前 low-16 hit-flag 真源**。
- `method38-result-state-closure.md` — rawState 0/1/2。
- `method38-component-token-namespace.md` — method38 component namespace。
- `method38-component-hit-damage-roll.md` — module hit ≠ module damage，damage-probability physical model。
- `precision-fire-method38-extension.md` — extension1 Precision Fire candidate / extension2 Tungsten candidate。
- `type28-ammunition-slot.md` — re-audited ammunition-selection state；324 unique own shots == settlement。

Current method38 highlights：

```text
0x0001 direct terminal shell kill                         PROVEN
0x0004 fire started                                      PROVEN current samples
0x0010 projectile penetration/material-positive branch  PROVEN relationship
0x0020 non-penetration/material-stop branch              VERY STRONG
0x0100 internal component/device involvement             PROVEN relationship
0x0400 track/chassis damaged result                      PROVEN relationship
0x0800 Gun-damaged result                                PROVEN samples / n=2 global boundary
0x1000 special/HE-family explosion-material branch       VERY STRONG
0x2000 special/HE-family explosion-armor branch          PARTIAL n=1
0x4000 special/HE-family internal-component branch       PROVEN relationship
```

```text
rawState0 -> component hit/involved; no new persistent negative state
rawState1 -> damaged / crew injured
rawState2 -> critical / disabled
```

### 瞄准 / 主炮状态

- `gun-marker-stream.md` — Type31 recorded aim-circle stream。
- `avatar-method36-targeting-info.md` — method36 targeting snapshot。
- `avatar-method36-targeting-crosswalk.md` — historical architecture cross-check + ordinal rejection。
- `type39-aim-camera.md` / `type39-f6-local-gun-pitch.md` — aim/camera/gun geometry。

Key facts：

- Type31 = aiming-circle size，**不是 penetration probability**。
- method36 shot boundary = `PRE -> method29 launch -> POST`。
- Gun damage 使 `field6.field1` 精确 ×2，Repair Kit 恢复 baseline。

### Visibility / AoI / forced observation

- `visibility-lifecycle.md` — Type4 AoI leave → hidden → Type33/Type5 re-entry。
- `visibility.md` — visibility evidence/early research context。
- `wrapper7-avatar-ready-wrapper16-state.md` — wrapper16 ordinary observation / forced-observation state family。
- `avatar-method19-vehicle-misc-status.md` — observed-by-enemy / repair-progress branches。

Type4 = enemy leaves recorder-observed AoI — PROVEN，**不是 death**。

### HP / death / settlement

- `actual-hp-type5-settlement.md` — actual HP closure。
- `death-and-battle-clock.md` — live death evidence与 single-POV boundary。
- `battle-results.md` — settlement protobuf inventory。
- `field118-basetype12-boundary.md` — field118/baseType12 closed UNKNOWN boundary。
- `method12-spotted-and-assist-counters.md` — spotted / assistance counter closures。
- `wrapper6-secondary-assist-attribution.md` — >50% majority-damage kill-notification assister。

Death precision：

```text
settled dead combatants 287
live sub-second terminal 283 = 98.61%
settlement-second fallback 4 = 1.39%
```

不要从单 POV 声称 100% 亚秒 death time。

### Type32 / loadout

- `type32-entity-effects.md` — Type32 envelope/effect families。
- `consumable-lifecycle.md` — consumable lifecycle。
- `fire-and-repair-states.md` — fire / repair / extinguish 差分。
- `loadout-materialization.md` — Type5 consumables/provisions/equipment loadout。

## Canonical consistency

```text
unique arenas                     34
settled players                  476
unique recorder shots            324
settlement recorder shots        324
method38 recorder hits           295
settlement recorder hits         295
```

旧 Type28 per-vehicle 表（总和 341）已 `SUPERSEDED`；当前 324-shot ledger 是唯一 canonical 基准。

## 已明确推翻、不得恢复的解释

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED
method38 0x1000 == current universal Gun-damage bit       REJECTED
Tankopedia base HP == replay actual HP source             REJECTED as primary replay source
single replay POV guarantees 100% sub-second death        REJECTED
```

## Closed UNKNOWN / PARTIAL boundaries

这些不是当前 34-arena corpus completion blocker；继续推进需要 controlled replay、新低频样本或 version-matched schema/string：

- method38 rawState0 exact private enum name；
- extension1/2 exact private enum；
- low-N/unobserved method38 flag global validation；
- method36 remaining scalar exact names/units；
- settlement field118/baseType12 exact statistic name；
- Vehicle prop7/8/9 complete token namespace；
- component ID42；
- corpus 未出现的 deathReason；
- cosmetic/profile/platform/observer-only exact symbols。

它们均已 raw-preserved，并在 inventory/专项文档中写清 promotion 所需证据。

## Completion verdict

当前 11.19 canonical corpus：

```text
observed-surface inventory blockers       0
canonical-count contradiction blockers   0
business-critical semantic blockers      0
single-POV information boundaries        documented
private-symbol/schema boundaries          documented / non-blocking

STATUS: RESEARCH-COMPLETE FOR CURRENT CORPUS
```

后续工作已经从“继续猜同一批 34 场”切换为 **new evidence acquisition**：新 controlled replay、新 mechanics、新版本或 version-matched schema 到来时再继续补证据。
