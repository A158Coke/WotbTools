# Type28 target-lock hypothesis — SUPERSEDED

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> This file is retained as a research-history correction. The former PC-style target-lock/auto-aim interpretation is **SUPERSEDED**. Current China Blitz mobile-corpus evidence instead proves Type28 as the recorder ammunition slot/selection index. See `type28-ammunition-slot.md`.

## Why the target-lock hypothesis was rejected

A historical Wargaming PC client exposes replay target-lock feedback with states:

```text
TARGET_UNLOCKED = 0
TARGET_LOCKED   = 1
TARGET_LOST     = 2
```

Type28 also uses the observed integer domain `{0,1,2}`, so the numeric match initially looked compelling.

That was not sufficient evidence for Blitz. The canonical corpus is WoT Blitz China mobile gameplay, where the PC right-click target-lock producer path is not established. Numeric-domain equality across a platform-specific historical feature cannot establish current Blitz semantics.

Therefore these former claims are rejected:

```text
Type28 = target-lock / auto-aim feedback
0 = unlocked
1 = locked
2 = target lost
```

Verdict on that hypothesis:

> **SUPERSEDED / NOT CURRENT BLITZ SEMANTICS**.

## Current semantic replacement

Current mobile-corpus joins now independently prove that Type28 is ammunition-selection state:

```text
payload : u32 LE
observed values : 0, 1, 2
```

The proof uses only current China Blitz replay surfaces:

1. identify the recorder vehicle by the independently proven Avatar property9 ↔ Vehicle property2 turret-yaw mirror;
2. restrict Avatar method29 projectile-launch records to `shooterId == recorderVehicleEntity`;
3. close the resulting unique own-shot count against settlement shots;
4. join each own shot to Type28 state and method17 ammunition descriptor;
5. observe stable per-vehicle slot → ammunition-descriptor/projectile-velocity families.

Full evidence is in:

```text
docs/research/replay/type28-ammunition-slot.md
```

## Research rule reinforced

Historical PC code is useful for framing/schema hypotheses, but platform-specific semantics require current Blitz evidence. A matching enum domain alone is not enough.
