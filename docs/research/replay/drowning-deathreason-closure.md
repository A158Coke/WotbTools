# Controlled drowning death — causeFlag/deathReason closure

> Source: user-supplied controlled Blitz `11.19.0_china_apple` training-room replay.
>
> Arena: `1177261030226562830`
>
> Vehicle: `Ch18_WZ-120`
>
> User-labelled experiment: deliberate self-drowning after driving into deep water.

## Executive verdict

The controlled replay closes a previously unobserved death-cause value:

```text
Vehicle method1 causeFlag = 5
wrapper6 field4 deathReason = 5
PlayerResults field105 = 5
```

All three independent surfaces converge on the same controlled gameplay cause.

> **death/cause value 5 = drowning / water death — PROVEN for current Blitz 11.19.**

This sample also proves that a vehicle may be dead while retaining positive HP. HP depletion is therefore not a universal death predicate.

## Controlled replay metadata

```text
version          = 11.19.0_china_apple
map              = port
arenaBonusType   = 2 (training)
player            = CHRD-A158布丁
vehicle           = Ch18_WZ-120
arenaUniqueId     = 1177261030226562830
battleDuration    ~= 59.98 s
```

The user explicitly states that the vehicle was intentionally drowned by driving/jumping into deep water.

Opening UI screenshot shows actual battle HP:

```text
1733 / 1733
```

## Live death boundary

At replay clock:

```text
57.293694 s
```

the recorder vehicle (`entityId=284089141`) emits Vehicle method1 with the already-proven 7-byte HP/source/cause shape:

```text
currentHpRaw = 1693
sourceEntity = 284089141   // self
causeFlag    = 5
```

Important observations:

1. the damage/death source is self;
2. the vehicle still has positive HP (`1693`);
3. the new cause value is `5`;
4. no ordinary HP-to-zero transition precedes the death.

At the same boundary, recorder/vehicle terminal presentation changes occur, including vehicle active-state termination.

## wrapper6 kill/death-feed closure

Same-clock Avatar method48 wrapper6 decodes to:

```text
victim      = 284089141
killer      = 284089141
field3      = absent
field4      = 5
```

The wrapper6 field4 role is independently closed as optional non-default `deathReason`.

Therefore the controlled drowning event yields:

```text
wrapper6.deathReason = 5
```

with self as both victim and killer.

## Settlement closure

`battle_results.dat` contains one PlayerResults row for the recorder:

```text
field1   = 1693
field11  = 40
field23  = 366
field24  = 48
field25  = 284089141
field101 = 3115055801
field102 = 2
field103 = 1841
field105 = 5
field106 = 182264
```

Relevant cross-surface facts:

```text
settlement field25 killerID = self
settlement field105         = 5
settlement field1           = 1693 (positive)
```

The three death-cause surfaces therefore agree exactly:

```text
live Vehicle method1 causeFlag = 5
live wrapper6 deathReason      = 5
settlement PlayerResults 105   = 5
```

## Positive-HP death consequence

This controlled sample disproves any universal rule of the form:

```text
dead <=> currentHp <= 0
```

For drowning:

```text
pre-death/opening HP = 1733
settlement damageReceived = 40
remaining HP at death = 1693
```

and the vehicle is nevertheless terminal/dead because the death reason is drowning.

Safe policy:

```text
Death state must be derived from explicit terminal/death surfaces.
HP <= 0 is sufficient evidence for ordinary HP-depletion deaths,
but positive HP does not imply alive when a non-HP terminal deathReason exists.
```

This matters for:

- exact death-time reconstruction;
- AI Review causal explanation;
- battle playback;
- settlement alive/dead classification;
- suicide/environmental-death statistics.

## Current death/cause map extension

Previously closed Vehicle method1 cause values:

```text
0 direct/default combat damage
1 fire
2 ramming
3 world/self-environment impact
```

New controlled closure:

```text
5 drowning / water death
```

Do not infer the unobserved value `4` from ordinal order. Preserve it raw until independently observed.

## Verdict

> `Vehicle method1 causeFlag=5` = **DROWNING — PROVEN controlled current-version sample**.

> `wrapper6 field4=5` = **DROWNING deathReason — PROVEN controlled current-version sample**.

> `PlayerResults field105=5` = **DROWNING deathReason — PROVEN controlled current-version sample**.

> **Positive-HP terminal death exists — PROVEN.**
