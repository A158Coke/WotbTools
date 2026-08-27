# Controlled replay probes — Maus modules, TVP armor interactions, WZ-120 HE

> Client: Blitz `11.19.0_china_apple`
>
> These three replays were recorded deliberately to isolate previously unresolved protocol branches. They are controlled evidence and are stronger than ordinary corpus correlation where the tested mechanic is known by construction.

## 1. Maus — Observation Device and Fuel Tank

Replay vehicle: `Maus`.

### Observation Device

Observed recorder-local component lifecycle:

```text
38.441s  method16 codeA=5,  codeB=38
         Type32 token 0x26 (=38)

44.844s  method16 codeA=18, codeB=38
```

The probe was deliberately aimed at the observation-device hit region.

This is a direct controlled positive sample for:

```text
codeB=38 = Observation Device
```

and independently reproduces the already proven lifecycle:

```text
codeA=5  = critical/disabled
codeA=18 = automatic recovery to damaged/degraded operational
```

Verdict: `38 = Observation Device` — **PROVEN controlled positive sample, current 11.19**.

### Fuel Tank

Observed lifecycle:

```text
62.243s  method16 codeA=4, codeB=33
         -> common damaged Fuel Tank

65.342s  method16 codeA=8, codeB=33
         Type32 short state `9c04`

65.843s  Vehicle method1 causeFlag=1
66.343s  Vehicle method1 causeFlag=1
         -> consecutive fire-DOT HP losses
```

This is the missing direct positive closure for `33 = Fuel Tank`.

The `codeA=8, codeB=33` transition occurs immediately before the fire-DOT sequence. Safe current interpretation:

```text
codeA=8 on Fuel Tank
= fuel-tank ignition / fire-start transition family
```

The exact private enum name remains unknown, but the physical relationship is **PROVEN controlled behavior**.

Verdict:

```text
codeB=33 = Fuel Tank      PROVEN direct controlled ignition closure
codeA=8 + codeB=33        PROVEN fuel-tank ignition/fire-start relationship
```

Do not generalize `codeA=8` to every mechanical component until another component emits it.

---

## 2. TVP T 50/51 — Ricochet, spaced armor, gun mantlet

Replay vehicle: `Cz04_T50_51`.

The probe deliberately followed the planned sequence: create ricochets by angle, reduce the angle until penetration, then test spaced-armor / mantlet interactions.

### Ricochet closure

Three controlled ricochet results:

```text
38.392s  flags = 0x0028
55.891s  flags = 0x0028
61.794s  flags = 0x0028
```

`0x0028 = 0x0020 | 0x0008`.

Because the observed UI/game result was ricochet by construction and the bit repeats on all controlled samples:

```text
0x0008 = RICOCHET
```

Verdict: **PROVEN controlled behavior**.

`0x0020` remains the projectile non-penetration/material-stop branch and is independently reinforced by the WZ-120 HE thick-armor probe below.

### Transition to penetration

The first successful penetration after reducing angle:

```text
80.793s
flags      = 0x0110
HP damage  = yes
result     = RightTrack:rawState0
```

This gives another direct demonstration that a component can be traversed/involved without receiving persistent module damage:

```text
0x0100 + component rawState0
= component/device path involved
  but its independent module-damage roll did not create a negative state
```

### Spaced armor and mantlet

Controlled spaced-armor result:

```text
84.086s
flags                 = 0x0050
                      = 0x0010 | 0x0040
HP damage             = yes
method8 collision part = 1
```

Controlled gun-mantlet/multi-layer result:

```text
87.588s
flags                 = 0x00C0
                      = 0x0040 | 0x0080
HP damage             = no
method8 collision part = 3  // independently gun/mantlet-like collision partition
```

The behavior matches the historical physical roles exactly, but the verdict is based on current controlled behavior rather than ordinal transplant:

```text
0x0040 = zero-damage-factor / spaced-armor layer pierced by projectile
0x0080 = zero-damage-factor / spaced-armor layer not pierced by projectile
```

The `0x0040|0x0080` mantlet case is especially diagnostic: one zero-damage-factor collision layer is traversed while another stops the projectile, with no HP loss.

Verdict:

```text
0x0040  PROVEN controlled current physical role
0x0080  PROVEN controlled current physical role
```

---

## 3. WZ-120 — controlled HE resolution branches

Replay vehicle: `Ch18_WZ-120`.

Six shots deliberately followed the planned HE matrix:

1. thin-armor/direct HE penetration;
2. thick-armor non-penetration;
3. track hit;
4. spaced-armor / mantlet interaction;
5. ground-near-target splash;
6. ground shot with no effective damage.

### Shot matrix

```text
34.391s  direct HE penetration
flags = 0xD010
      = 0x8000 | 0x4000 | 0x1000 | 0x0010
HP damage = yes
components = RightTrack:0, LeftTrack:1, Engine:0

45.588s  thick armor non-penetration
flags = 0x0020
HP damage = no
components = none

54.492s  track hit
flags = 0x1500
      = 0x1000 | 0x0400 | 0x0100
HP damage = yes
component = LeftTrack:2

63.387s  spaced/mantlet HE interaction
flags = 0x6080
      = 0x4000 | 0x2000 | 0x0080
HP damage = no
component = LeftTrack:1
method8 collision part = 3

72.391s  ground-near-target splash
primary affected target flags = 0xD000
                             = 0x8000 | 0x4000 | 0x1000
HP damage = yes
component = RightTrack:1
additional nearby method38 result also observed

81.295s  ground shot / no effective damage
flags = 0x0000
HP damage = no
```

### Explosion high-bit closure

The pure ground-splash positive sample is the strongest discriminator because it carries no projectile-penetration bit but does carry the explosion family:

```text
0xD000 = 0x8000 | 0x4000 | 0x1000
```

Combining the direct-penetration, track, mantlet and pure-splash probes produces the current physical map:

```text
0x1000 = positive-damage-factor material penetrated/resolved by explosion
0x2000 = zero-damage-factor armor/spaced layer penetrated/resolved by explosion
0x4000 = internal component/device pierced/involved by explosion
0x8000 = internal component/device damaged by explosion
```

Confidence:

```text
0x1000  PROVEN controlled explosion-material relationship
0x2000  PROVEN current controlled sample / global low-N boundary
0x4000  PROVEN controlled explosion-component relationship
0x8000  PROVEN controlled explosion-component-damage relationship
```

The exact private constant names remain version-scoped, but these physical semantics are now directly observed.

### Structural consequence

Current Blitz 11.19 behavior is consistent with the following compact hit-flag family:

```text
0x0008 ricochet
0x0010 positive material penetration by projectile
0x0020 non-penetration/material stop by projectile
0x0040 zero-DF/spaced armor pierced by projectile
0x0080 zero-DF/spaced armor not pierced by projectile
0x0100 device/component pierced/involved by projectile
0x0200 currently unobserved / preserve raw
0x0400 chassis/track damaged by projectile
0x0800 gun damaged by projectile
0x1000 positive-DF material explosion branch
0x2000 zero-DF armor explosion branch
0x4000 device/component pierced/involved by explosion
0x8000 device/component damaged by explosion
```

This sequence is compatible with a compacted descendant of historical Wargaming `VEHICLE_HIT_FLAGS`, but production naming must remain current-version evidence based.

## Production impact

These controlled probes materially improve:

- ricochet vs ordinary non-penetration classification;
- spaced armor / mantlet interpretation;
- HE direct penetration vs splash reconstruction;
- module damage source distinction (projectile vs explosion);
- direct Fuel Tank ignition reconstruction;
- direct Observation Device identity validation;
- AI Review explanations of why a shot dealt no HP damage despite contacting armor/components.

All raw bits/states should still be preserved for version gating.