# WoT Blitz Replay Protocol Research Archive

本目录系统记录 WotBTools 对 `.wotbreplay` 的逆向研究。

> 基础 canonical corpus：34 个唯一 Blitz `11.19.0_china` arena。
>
> 后续 controlled probes：drowning、FV215b 弹种切换、Tungsten、Precision Fire + Tungsten 同时触发、Maus Observation Device/Fuel Tank、TVP ricochet/spaced armor/mantlet、WZ-120 HE matrix、method36 horizontal/vertical angular-speed probes 等。
>
> 当前状态：**PRODUCTION-USABLE REFERENCE FOR OBSERVED 11.19 SURFACES**。
>
> 这里的 complete/usable 不代表拿到了所有 Wargaming 私有变量名；它表示当前高价值 gameplay surfaces 已有足够证据用于 parser、battle reconstruction、HP/death、shot result、module/crew、ammo、targeting 与 AI Review fact extraction。

## 权威读取顺序

后续实现、审查和继续研究必须按以下顺序读：

1. **`WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md`** — 当前完整 implementation-oriented reference；新维护者优先读这一份。
2. `inventory.md` — 原 34-arena canonical ledger 与 surface inventory。
3. `research-completion-audit-11.19.md` — 原 corpus completion gate 与 evidence boundaries。
4. 对应专项 closure 文档 — 某个字段/机制的完整证据链、controlled probe 和 counterexample。
5. `protocol.md`、早期 broad summary/probe 文档 — 研究轨迹与历史上下文；若冲突，以 1–4 为准。

早期文档允许保留当时的错误假设，前提是已经被后续 closure 标记为 `SUPERSEDED/REJECTED`。不要脱离权威读取顺序单独把旧笔记当生产事实。

## 研究原则

- 语义等级：`PROVEN / VERY STRONG PARTIAL / PARTIAL / UNKNOWN / SUPERSEDED / REJECTED`。
- `PROVEN` 必须依赖当前 replay 行为闭环；历史 PC/WoT schema 只能做架构 cross-check。
- numeric packet/method/property/component ID 全部按 client version + entity class 解释。
- UNKNOWN 不为了业务方便强行命名。
- raw fields 必须保留。
- single-POV/AoI 是真实信息边界，不伪造 omniscient telemetry。
- controlled replay 优先于相关性猜测。

## 当前核心事实摘要

### Container / framing

```text
.wotbreplay = ZIP
meta.json
data.wotreplay
battle_results.dat
```

`data.wotreplay` packet framing：

```text
payloadLen  u32 LE
type        u32 LE
rawClockSec f32 LE
payload     bytes[payloadLen]
```

Header 长度动态，不能 hard-code packet-stream offset。

### Projectile / shot lifecycle

```text
Vehicle method0 firing
-> Avatar method29 launch + shotId + launchPoint + launchVelocity
-> Avatar method20 terminal endpoint
-> Avatar method27 explosion/terminal-resolution branch when present
```

method29 是全局 observed projectile feed；必须先过滤 recorder shooter identity。

### Ammunition

```text
Type28 = recorder ammunition selection state          PROVEN
Avatar method17 = shell descriptor / ammo inventory  PROVEN behavioral identity
```

FV215b controlled 11.19 mapping：

```text
Type28=0 -> 0x003C5A0A -> AP
Type28=1 -> 0x00465A0A -> APCR
Type28=2 -> 0x003B5A0A -> HESH / HE-family
```

不要把该映射推广为所有车辆的 UI-slot rule。

### Component namespace

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN direct controlled
34 Right Track         PROVEN
35 Left Track          PROVEN
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN direct controlled
39 Commander           PROVEN
40 Driver              PROVEN
41 Gunner               PROVEN
42 UNKNOWN / unobserved
43 Loader               PROVEN
```

### method16 state lifecycle

```text
4  damaged/degraded operational
5  critical/disabled
18 automatic critical self-repair -> damaged
19 fully repaired/cleared
10 crew injured/shell-shocked
22 crew healed/cleared
```

Controlled Fuel Tank probe also establishes：

```text
codeA=8 with component33
-> Fuel Tank ignition / fire-start transition family
```

### method38 current structure

旧的 “optional single extension” 模型已 `SUPERSEDED`。

Current safe model：

```text
victimVehicleId  u32
resultFlags16    u16
headerHi16Raw    u16
resultCount      u8
repeat resultCount:
  componentToken u8
  rawState       u8
modifierCount    u8
repeat modifierCount:
  modifierId     u32 LE
```

### method38 resultFlags16

```text
0x0001 direct terminal shell kill                         PROVEN
0x0002 target already dead before attack                  PROVEN sample / low-N
0x0004 fire started                                       PROVEN
0x0008 ricochet                                           PROVEN controlled
0x0010 positive projectile material/vehicle penetration   PROVEN
0x0020 projectile non-penetration/material stop           PROVEN controlled
0x0040 zero-DF/spaced armor layer pierced                 PROVEN controlled
0x0080 zero-DF/spaced armor layer not pierced             PROVEN controlled
0x0100 internal component/device involved by projectile   PROVEN
0x0200 UNKNOWN / no positive current sample               preserve raw
0x0400 chassis/track damaged by projectile                PROVEN
0x0800 Gun damaged by projectile                          PROVEN current samples / low-N
0x1000 positive-DF material explosion branch              PROVEN controlled
0x2000 zero-DF/spaced armor explosion branch              PROVEN controlled sample / low-N
0x4000 component/device involved by explosion             PROVEN controlled
0x8000 component/device damaged by explosion              PROVEN controlled
```

### method38 rawState

```text
0 -> component hit/involved; no newly observed persistent negative state
1 -> module damaged / crew injured
2 -> critical / disabled
```

Module hit != module damage；damage probability 按 component 独立 resolve。

### method38 special modifiers

Controlled replay 已关闭：

```text
modifierId 1 = Precision Fire  PROVEN
modifierId 2 = Tungsten Shells PROVEN
```

同一发可以同时出现：

```text
modifierCount=2
modifiers=[1,2]
```

因此：

```text
single optional extension                       SUPERSEDED
Precision Fire / Tungsten mutually exclusive    REJECTED
combined proc encoded as 3                      REJECTED current controlled sample
```

### Targeting

```text
Type31 = aiming-circle size                     PROVEN
Type39 f5 = turret/gun relative yaw family      PROVEN relationship
Type39 f6 = local gun pitch                     PROVEN relationship
```

Avatar method36：

```text
root.field1 = current turret/gun relative yaw        PROVEN
root.field2 = current gun pitch                      PROVEN
root.field3 = max horizontal turret/gun angular speed PROVEN controlled, rad/s
root.field4 = max vertical gun angular speed          PROVEN controlled, rad/s
```

Gun damage 使 method36 dispersion-like scalar精确 ×2，Repair Kit 恢复 baseline。

### HP / death

Actual replay HP 优先于 Tankopedia base HP。

Death 不得定义成 `HP<=0`。Controlled drowning：

```text
causeFlag=5  = DROWNING
 deathReason=5 = DROWNING
terminal HP 仍为正数
```

原 canonical corpus death precision：

```text
settled dead combatants 287
live sub-second terminal 283 = 98.61%
settlement-second fallback 4 = 1.39%
```

single POV 不得声称 100% 亚秒 death time。

### Visibility / AoI

```text
Type4 -> leaves recorder-observed AoI
Type33 + Type5 -> later materialization/re-entry
```

`Type4 == death` 已 `REJECTED`。

## Canonical consistency

```text
unique arenas                     34
settled players                  476
unique recorder shots            324
settlement recorder shots        324
method38 recorder hits           295
settlement recorder hits         295
```

旧 Type28 per-vehicle 表（总和 341）已 `SUPERSEDED`。

## 已明确推翻、不得恢复的解释

```text
Type4 == death                                             REJECTED
Type28 == target lock / auto aim                          REJECTED
41 == Radioman / 42 == Gunner                             SUPERSEDED
34/35 exact side unresolved                               SUPERSEDED
baseType12 == base defended / dropped capture points      REJECTED
all method38 32 header bits == one homogeneous hit enum   REJECTED
historical PC upper hit-flag ordinals == current Blitz    REJECTED
method38 0x1000 == universal Gun-damage bit               REJECTED
Tankopedia base HP == replay actual HP source             REJECTED as primary
single replay POV guarantees 100% sub-second death        REJECTED
method38 tail == one optional u32 extension               SUPERSEDED
Precision Fire/Tungsten mutually exclusive                REJECTED
combined Precision Fire + Tungsten == modifier3           REJECTED current probe
```

## 当前剩余边界

这些不是 parser/business blocker：

```text
method38 0x0200 positive sample
component ID42 exact identity/private symbol
method36 remaining scalar private names/units
method38 rawState0 exact private enum name
method16 sparse transition-code private names
settlement field118/baseType12 exact statistic name
Vehicle prop7/8/9 complete token namespaces
method17 initialization/feed tail exact fields
unobserved deathReason/causeFlag values
observer-only/cosmetic/platform symbols
cross-version numeric stability
```

未来新 evidence 应 raw-preserve、version-gate，并同步更新 focused closure + `WOTB_REPLAY_PROTOCOL_11_19_COMPLETE_REFERENCE.md`。

## 当前结论

当前 11.19 replay research 已足够支持：

```text
回放解析
战局重建
HP 时间线
死亡时间/死亡原因
弹种与 ammunition state
projectile lifecycle
跳弹/未穿/间隙装甲/炮盾/HE splash
模块/乘员 hit/damage/critical/repair
Precision Fire / Tungsten
瞄准方向与炮口俯仰
visibility/AoI boundary
AI Review authoritative fact extraction
```

剩余主要是 **私有命名、低频未见值和未来版本验证**，而不是核心 replay telemetry 缺失。
