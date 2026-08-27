# WoT Blitz Replay Protocol Research Archive

本目录系统记录 WotBTools 对 `.wotbreplay` 的逆向研究。

## 研究原则

- 所有语义区分 `PROVEN / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED`。
- `PROVEN` 必须有真实回放行为闭环；独立 schema、客户端代码、物理效应、多 POV 或 settlement 交叉证据用于加强而不是替代当前版本证据。
- 不允许为了业务方便把未知字段直接命名成猜测语义。
- 所有结论记录适用版本与样本范围；当前 canonical corpus 为 34 个唯一 Blitz 11.19.0 China arena。
- settlement、event stream、multi-POV、外部机制资料必须区分证据来源与精度。
- packet/method/property/component 数字必须按 client version 与 entity class 解释；不能把历史 PC/WoT 数值顺序直接套到当前 Blitz。
- counterexample 必须保留。发现新证据推翻旧解释时，将旧解释标记 `SUPERSEDED/REJECTED`，而不是为了保持旧结论强行解释。

## 权威入口

- `inventory.md`：**当前 canonical 总账**。实现前优先读取；包含所有主要 surface、证据等级、已推翻结论与剩余研究边界。
- `protocol.md`：历史协议总表与早期逆向记录；若与 `inventory.md` 或后续专项 closure 冲突，以当前 evidence closure 为准。
- `container-format.md` / `packet-stream.md`：容器、动态 header 与严格 packet framing。
- `entity-properties.md` / `entity-methods.md`：Type7 / Type8 surface inventory。

## 当前高价值专项文档

### 模块 / 乘员 / damage lifecycle

- `avatar-method16-damage-info.md`：当前 method16 总览。
- `method16-device-crew-code-map.md`：component ID 闭环。
- `method16-damage-state-codeA.md`：damage-state lifecycle。
- `track-side-orientation-closure.md`：34/35 左右履带几何闭环。
- `gun-damage-dispersion-closure.md`：36 Gun 物理效应闭环。
- `fuel-tank-observation-device-closure.md`：33 Fuel Tank / 38 Observation Device 穷举 + 反证闭环。
- `ammo-rack-and-loader-damage-codes.md`：Ammo Rack / Loader 物理验证。
- `recovery-consumable-discriminator.md`：Repair Kit / First Aid / MPRP 与 component state 差分。

### 射击 / 弹道 / 命中结果

- `projectile-lifecycle.md`：method29 launch、shotId、method20 terminal endpoint、method27 terminal branch。
- `avatar-shot-results.md`：**当前 method38 总览**。
- `avatar-shot-result-bitfield.md`：method38 result-bit 证据。
- `method38-result-state-closure.md`：rawState 0/1/2。
- `method38-component-token-namespace.md`：method38 component token namespace。
- `method38-module-damage-probability.md`：模块被命中与模块实际受损概率分离。
- `precision-fire-method38-extension.md`：extension=1 Precision Fire candidate 与 extension=2 Tungsten candidate。
- `type28-ammunition-slot.md`：re-audited recorder ammunition-selection state；324 unique own shots 与 settlement 精确对账。

### 瞄准 / 主炮状态

- `gun-marker-stream.md`：Type31 recorded gun-marker/aim-circle stream。
- `avatar-method36-targeting-info.md`：method36 targeting snapshot。
- `avatar-method36-targeting-crosswalk.md`：历史 `updateTargetingInfo` 架构交叉验证及 ordinal-mapping 反证。
- `type39-aim-camera.md` / `type39-f6-local-gun-pitch.md`：高频 aim/camera/gun geometry。

### 观察 / AoI / 强制点亮

- `type4-visibility-loss.md`：Type4 enemy AoI leave；不是 death。
- `wrapper7-avatar-ready-wrapper16-state.md`：wrapper16 ordinary observed-by-enemy 与 forced-observation state family。
- `avatar-method19-vehicle-misc-status.md`：method19 observed-by-enemy / repair-progress branch。

### HP / 死亡 / settlement

- `actual-hp-type5-settlement.md`：Type5 / live HP / settlement actual HP。
- `death-and-battle-clock.md`：死亡证据与单 POV 亚秒级 coverage boundary。
- `battle-results.md`：settlement protobuf inventory。
- `avatar-method12-battle-feedback-summary.md`：battle-feedback counters；baseType12 exact semantic remains unresolved and old base-defense hypothesis is rejected。

### Type32 / loadout

- `type32-entity-effects.md`：Type32 envelope 与 effect family。
- `consumable-lifecycle.md`：消耗品生命周期。
- `fire-and-repair-states.md`：fire-DOT / repair / extinguish 差分。
- `loadout-materialization.md`：Type5 consumables/provisions/equipment loadout。

## 当前 canonical 结论摘要

### Container / transport

- `.wotbreplay` = ZIP，核心成员 `meta.json` / `data.wotreplay` / `battle_results.dat`。
- packet framing = `payloadLen(u32LE) + type(u32LE) + rawClock(f32LE) + payload`。
- header 长度动态；不能硬编码 packet offset。
- zero-length Type17 合法。
- strict contiguous parse 是正常策略。

### HP / death

- Vehicle prop3 = current HP + terminal sentinel family。
- Type5 materialization = 实际 HP + vehicle/loadout state；不要用 tankopedia base HP 覆盖 replay actual HP。
- 287 个 settled dead combatants 中 283 个有 live 亚秒级 terminal evidence；4 个只有 settlement-second fallback。单 POV 无法保证 100% 亚秒级 death time。

### Current component namespace

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
42 UNKNOWN
43 Loader               PROVEN
```

Mechanical lifecycle:

```text
4  damaged/degraded
5  critical/disabled
18 auto-repaired critical -> damaged
19 fully repaired/clear
```

Crew lifecycle:

```text
10 injured/shell-shocked
22 healed/clear
```

### method38

- recorder outgoing hit/result feedback — PROVEN。
- component token 使用上述相同 component namespace — PROVEN relationship。
- rawState1 = damaged / crew injured — PROVEN relationship。
- rawState2 = critical / disabled — PROVEN relationship。
- rawState0 = component hit/involved but no new persistent negative state — VERY STRONG physical role；exact enum PARTIAL。
- `0x0001` direct kill、`0x0004` fire-start、semantic-group 后 `0x1110` piercing-like relationship 已闭环；其余 individual bits 按专项文档证据等级处理。
- extension1 = Precision Fire proc VERY STRONG / near-PROVEN；HE 仍经过自身伤害后处理。
- extension2 = Tungsten/special-damage provenance VERY STRONG PARTIAL，当前 `n=1`。

### Ammo selection

Type28 = recorder ammo-selection state — PROVEN。严格 own-shot 重算：

```text
324 unique recorder shotIds
= 324 settlement shots
```

wire value 不直接等于 UI shell-list index；命名必须结合 method17 descriptor / versioned shell catalog。

### Visibility

- Type4 = enemy leaves recorder-observed AoI，不是 death。
- wrapper16 state1 = ordinary observed-by-enemy entry/re-entry behavior。
- wrapper16 state8 = hit-applied forced-observation family；exact symbolic enum remains PARTIAL。

## 当前完成标准

PR147 **不以“所有 cosmetic/profile/platform 字段都获得官方内部变量名”作为完成条件**。

当前 34-arena corpus 可以研究收口的条件是：

1. 每个 observed top-level packet/property/method/wrapper/settlement surface 已进入 inventory；
2. 每个 surface 有明确 evidence grade；
3. 已推翻假设明确标记 REJECTED/SUPERSEDED；
4. unresolved 字段保存 raw，并写清需要什么新 sample/schema 才能继续；
5. canonical aggregate 不再互相矛盾；
6. 业务关键 combat facts 不再依赖未经证明的猜测；
7. 生产实现只消费 version-gated PROVEN 或显式批准的 PARTIAL facts。

## 当前剩余研究边界

这些项目仍有研究价值，但在没有新 controlled sample / version-matched schema 的情况下，不应无限阻塞当前 corpus 收口：

- method38 rawState0 exact internal enum name；
- selectionValue2 high result bits 的 individual symbolic names；
- extension2 更多 Tungsten positive samples；
- method36 remaining scalar exact names/units；
- settlement field118 / method12 baseType12 exact statistic identity；
- prop7/8/9 complete low-level element namespace；
- 少量 cosmetic/profile/platform/observer-only 字段。

因此后续工作的正确模式是：**新版本或新 controlled replay 出现时继续补证据，而不是在当前 34 场上为了“100% 命名率”过拟合。**
