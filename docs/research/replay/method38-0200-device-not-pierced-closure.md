# Avatar method38 `0x0200` closure — projectile device-not-pierced branch

> Scope: WoT Blitz `11.19.0_china_apple`.
>
> Controlled replay: `abx.wotbreplay`.
>
> SHA-256: `a8c523d9fbec95358c61eddc7c054627b9dca83dac01188d03a2f0ab32f3ee29`.
>
> Recorder: `CHRD-A158布丁`, vehicle `G190_VK_1602_Quby`.
>
> Target: Maus.
>
> User-declared experiment: first burst group aimed at the Maus Gun/barrel; second burst group aimed at the Maus Fuel Tank.

## Executive verdict

The previously unobserved current Blitz 11.19 `method38.resultFlags16` bit `0x0200` now has a controlled positive sample.

Current physical interpretation:

> `0x0200` = **internal device/module encountered by projectile but not pierced / projectile device-not-pierced branch — PROVEN current controlled physical role**.

The exact private Wargaming enum symbol remains version/private-source scoped. Historical WoT constants use the symbolic name `DEVICE_NOT_PIERCED_BY_PROJECTILE`; that historical name is retained only as an architecture cross-check. The promotion to `PROVEN` is based on current Blitz controlled behavior.

---

## 1. Replay structure

The replay contains exactly 30 recorder projectile launches and exactly 30 Avatar method38 result packets.

Every recorder `method29` launch is paired with a method38 result at the same replay clock:

```text
method29 launches        30
method38 results         30
same-clock pairs         30 / 30
```

The two user-declared target phases are separated by a clean ~18-second gap:

```text
Gun/barrel phase     ~41.695 .. 49.498 s   15 projectiles
Fuel Tank phase      ~67.697 .. 72.698 s   15 projectiles
```

Victim entity is constant across all 30 method38 packets:

```text
victimVehicleId = 1860284
```

---

## 2. Gun/barrel phase

The first 15 projectiles produce the following method38 results:

```text
41.694912  0x0000  []
41.802582  0x0100  [(36,0)]
42.002132  0x0100  [(36,0)]
42.202698  0x0000  []
42.403339  0x0100  [(36,0)]

45.804531  0x0000  []
45.903915  0x0100  [(36,0)]
46.096470  0x0000  []
46.304604  0x0000  []
46.504677  0x0000  []

48.797237  0x0240  []
48.897179  0x0080  []
49.097801  0x0080  []
49.297192  0x0080  []
49.497616  0x0080  []
```

Known current meanings independently established before this replay:

```text
0x0040 = zero-damage-factor / spaced layer pierced by projectile
0x0080 = zero-damage-factor / spaced layer not pierced by projectile
0x0100 = internal device/module pierced or positively involved by projectile
component 36 = Gun
rawState 0 = component involved/hit, no new persistent negative state
```

The critical new packet is:

```text
48.797237
flags = 0x0240
      = 0x0200 | 0x0040
resultCount = 0
```

It occurs inside the controlled Gun/barrel phase, immediately followed by four `0x0080` zero-DF non-pierce outcomes in the same aimed region.

The first part of the same phase independently demonstrates successful Gun-device involvement:

```text
0x0100 + componentToken 36 + rawState 0
```

Therefore the experiment contains both sides of the discriminator in one current-version replay:

```text
projectile positively reaches/pierces Gun device branch
-> 0x0100 + component 36

projectile traverses a zero-DF layer but the device branch does not pierce
-> 0x0040 + 0x0200
```

This is the current controlled positive sample that was missing from the archive.

---

## 3. Fuel Tank phase as independent control

The second 15-projectile phase was aimed at the Maus Fuel Tank and produces a completely different, internally coherent signature:

```text
67.697243  0x0110  [(33,0)]
67.804581  0x0010  []
68.005119  0x0110  [(33,0)]
68.197510  0x0110  [(33,0)] modifier [1]
68.404755  0x0110  [(33,0)]

69.898026  0x0110  [(33,1)]
69.998009  0x0110  [(33,1)]
70.197510  0x0010  []
70.397942  0x0110  [(33,1)]
70.606583  0x0010  []

71.998718  0x0110  [(33,1)]
72.107162  0x0110  [(33,1)]
72.298058  0x0010  []
72.498901  0x0010  []
72.698303  0x0114  [(33,1)]
```

Known identities:

```text
0x0010 = positive material/vehicle penetration by projectile
0x0100 = internal device/module pierced or positively involved
component 33 = Fuel Tank
rawState 0 = involved/no new persistent negative state
rawState 1 = module damaged
0x0004 = fire started
modifier 1 = Precision Fire proc
```

Thus the second phase supplies a strong same-replay control showing the ordinary successful internal-device path:

```text
0x0110 = 0x0100 | 0x0010
component 33
rawState 0/1
```

The `0x0200` bit appears only in the Gun/barrel phase and is absent from the repeated successful Fuel Tank penetration/damage sequence.

---

## 4. Historical architecture cross-check

Historical Wargaming hit-flag constants expose the adjacent projectile-device pair:

```text
DEVICE_PIERCED_BY_PROJECTILE      = 0x0100
DEVICE_NOT_PIERCED_BY_PROJECTILE  = 0x0200
```

Current Blitz had already behaviorally closed `0x0100`; until this replay, current `0x0200` had no positive sample and therefore remained UNKNOWN.

The controlled current replay now provides the missing behavioral match. Historical naming is corroborative rather than the sole basis for the conclusion.

---

## 5. Current low-16 method38 map implication

The current projectile/device region is now closed as:

```text
0x0040 zero-DF/spaced layer pierced by projectile          PROVEN
0x0080 zero-DF/spaced layer not pierced by projectile      PROVEN
0x0100 internal device/module pierced/involved projectile  PROVEN
0x0200 internal device/module not pierced by projectile    PROVEN controlled
0x0400 chassis/track damaged by projectile                 PROVEN
0x0800 Gun damaged by projectile                           PROVEN
```

`0x0200` must no longer be listed as `UNKNOWN`, `unobserved`, or a P1 research target in authoritative current documentation.

---

## 6. Production-safe semantics

Safe current decoder label:

```text
0x0200 -> DEVICE_NOT_PIERCED_BY_PROJECTILE
```

If avoiding historical private-symbol naming in production DTOs, use a physical label such as:

```text
PROJECTILE_DEVICE_NOT_PIERCED
```

Recommended interpretation:

```text
flags & 0x0200 != 0
-> projectile resolution encountered an internal device/module branch that did not pierce
```

Do not equate it with generic vehicle armor non-penetration (`0x0020`) or zero-DF/spaced-armor non-penetration (`0x0080`). These are independent resolution layers.

---

## 7. Research gate

Before this replay:

```text
P1: method38 0x0200 current positive sample = OPEN
```

After this controlled replay:

```text
P1: method38 0x0200 current positive sample = CLOSED
```

Combined with the separately closed Type10 movement P1 and method36 high-value physical roles, there is no remaining known P0/P1 replay-protocol semantic blocker for the current 11.19 WotBTools business scope.

Remaining work is documentation convergence, P2/private-symbol recovery, low-frequency/unobserved enums, and future-version regression rather than an unresolved core gameplay surface.
