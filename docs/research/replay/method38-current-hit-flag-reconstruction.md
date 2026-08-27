# Method38 current hit-flag reconstruction — Blitz 11.19 China

> Base corpus: canonical 34 unique arenas, 324 unique recorder shots, 295 recorder hit-feedback records.
>
> Additional controlled probes: TVP T 50/51 ricochet/spaced-armor/mantlet and WZ-120 HE interaction matrix recorded on Blitz `11.19.0_china_apple`.
>
> Scope: low-16 `resultFlags16` in Avatar method38. Numeric values are current-version evidence only.

## Executive verdict

The current Blitz 11.19 bit layout is behaviorally compatible with a compacted descendant of historical Wargaming `VEHICLE_HIT_FLAGS`, but the decoder is based on current replay behavior, not ordinal transplant.

Current physical map:

```text
0x0001  direct terminal shell kill                                      PROVEN
0x0002  target already dead before attack                              PROVEN sample / low-N
0x0004  fire started                                                    PROVEN
0x0008  ricochet                                                        PROVEN controlled
0x0010  positive material/vehicle penetration by projectile             PROVEN relationship
0x0020  projectile non-penetration / material stop                      PROVEN controlled relationship
0x0040  zero-damage-factor / spaced-armor layer pierced by projectile   PROVEN controlled
0x0080  zero-damage-factor / spaced-armor layer not pierced             PROVEN controlled
0x0100  internal component/device pierced or involved by projectile      PROVEN relationship
0x0200  unobserved in current evidence                                  UNKNOWN / preserve raw
0x0400  chassis/track damaged by projectile                             PROVEN
0x0800  gun damaged by projectile                                       PROVEN observed samples / global low-N
0x1000  positive-DF material resolved/penetrated by explosion            PROVEN controlled
0x2000  zero-DF armor/spaced layer resolved/penetrated by explosion      PROVEN controlled sample / global low-N
0x4000  internal component/device pierced or involved by explosion       PROVEN controlled
0x8000  internal component/device damaged by explosion                   PROVEN controlled
```

Exact private enum symbol names remain version-scoped.

## Low bits

### `0x0008` — ricochet

The TVP controlled probe deliberately created ricochets by maintaining a high impact angle and then reducing the angle until penetration.

Three ricochet results are identical:

```text
38.392s  flags = 0x0028
55.891s  flags = 0x0028
61.794s  flags = 0x0028
```

`0x0028 = 0x0020 | 0x0008`.

Because the physical result was controlled and repeated, `0x0008 = RICOCHET` is **PROVEN current behavior**.

### `0x0010` / `0x0020`

The same probe transitions to a successful penetration:

```text
80.793s
flags = 0x0110
HP damage = yes
```

The WZ-120 controlled HE thick-armor shot independently gives:

```text
45.588s
flags = 0x0020
HP damage = no
```

Thus:

```text
0x0010 -> positive material/vehicle penetration by projectile
0x0020 -> non-penetration/material-stop branch
```

The exact internal material wording is private, but the physical distinction is current-version PROVEN.

## Spaced armor / zero-damage-factor armor

The TVP probe explicitly tested a spaced-armor region and a gun mantlet after the ricochet sequence.

### `0x0040`

Controlled spaced-armor penetration:

```text
84.086s
flags = 0x0050
      = 0x0010 | 0x0040
HP damage = yes
method8 collision partition = 1
```

This is the positive zero-damage-factor armor-layer traversal branch.

Verdict:

> `0x0040` = **zero-damage-factor / spaced-armor layer pierced by projectile — PROVEN controlled behavior**.

### `0x0080`

Controlled mantlet/multi-layer result:

```text
87.588s
flags = 0x00C0
      = 0x0040 | 0x0080
HP damage = no
method8 collision partition = 3  // gun/mantlet-like partition
```

The combination is physically diagnostic: one zero-DF collision layer is traversed and another stops the projectile.

The WZ-120 HE mantlet/spaced probe independently contains `0x0080` as well.

Verdict:

> `0x0080` = **zero-damage-factor / spaced-armor layer not pierced by projectile — PROVEN controlled behavior**.

## Projectile component/device bits

### `0x0100`

Across the canonical corpus, `0x0100` is associated with internal result tokens spanning the known component namespace.

The TVP first successful penetration gives a direct controlled example:

```text
flags = 0x0110
result = RightTrack:rawState0
HP damage = yes
```

This also reinforces the independent rule that component involvement does not guarantee persistent module damage.

Verdict:

> `0x0100` = **component/device pierced or involved by projectile — PROVEN relationship**.

### `0x0200`

No current canonical or controlled sample has yet produced this bit.

Historical layouts make a device-not-pierced role plausible, but there is no current positive observation. Keep it raw:

> `0x0200` = **UNKNOWN / unobserved current 11.19**.

### `0x0400`

Canonical evidence already closes this bit to track/chassis damage. Controlled WZ-120 HE track testing reproduces it:

```text
54.492s
flags = 0x1500
      = 0x1000 | 0x0400 | 0x0100
component = LeftTrack:rawState2
```

Verdict:

> `0x0400` = **chassis/track damaged by projectile — PROVEN**.

### `0x0800`

Canonical current samples contain `0x0800` only with Gun token 36 in damaged state.

Verdict:

> `0x0800` = **Gun damaged by projectile — PROVEN on observed current samples; global sample count remains low**.

## Explosion high bits — controlled WZ-120 HE closure

The WZ-120 replay deliberately executed six HE cases:

1. direct HE penetration on penetrable armor;
2. thick-armor non-penetration;
3. track hit;
4. spaced-armor/mantlet interaction;
5. ground-near-target splash;
6. ground shot with no effective damage.

Observed result matrix:

```text
34.391s direct HE penetration
flags = 0xD010
      = 0x8000 | 0x4000 | 0x1000 | 0x0010
HP damage = yes
components = RightTrack:0, LeftTrack:1, Engine:0

45.588s thick armor non-penetration
flags = 0x0020
HP damage = no

54.492s track hit
flags = 0x1500
      = 0x1000 | 0x0400 | 0x0100
HP damage = yes
component = LeftTrack:2

63.387s spaced/mantlet interaction
flags = 0x6080
      = 0x4000 | 0x2000 | 0x0080
HP damage = no
component = LeftTrack:1
method8 collision partition = 3

72.391s ground-near-target splash
flags = 0xD000
      = 0x8000 | 0x4000 | 0x1000
HP damage = yes
component = RightTrack:1

81.295s ground no effective damage
flags = 0x0000
HP damage = no
```

The pure splash sample is especially important: it has no projectile-penetration bits but still carries `0x1000|0x4000|0x8000`, proving that these are explosion-resolution branches rather than generic projectile bits.

### `0x1000`

Appears on direct HE penetration, track interaction and pure ground splash.

Verdict:

> `0x1000` = **positive-damage-factor material resolved/penetrated by explosion — PROVEN controlled physical relationship**.

### `0x2000`

The controlled spaced/mantlet HE case carries `0x2000` together with projectile-side `0x0080` and explosion-side component involvement.

Verdict:

> `0x2000` = **zero-damage-factor armor/spaced layer resolved/penetrated by explosion — PROVEN current controlled sample; global low-N boundary**.

### `0x4000`

Appears on direct HE penetration, mantlet/spaced interaction and pure splash whenever the explosion path reaches internal component/device results.

Verdict:

> `0x4000` = **internal component/device pierced or involved by explosion — PROVEN controlled relationship**.

### `0x8000`

This bit was unobserved in the original 34-arena canonical corpus but appears in the controlled WZ-120 HE direct-penetration and pure-splash samples. Both include persistent negative component outcomes.

Verdict:

> `0x8000` = **internal component/device damaged by explosion — PROVEN controlled relationship**.

## Structural reconstruction

Current behavior is consistent with this compact family:

```text
0x0100 component/device pierced by projectile
0x0200 component/device not-pierced candidate — unobserved, do not name in production
0x0400 chassis/track damaged by projectile
0x0800 gun damaged by projectile
0x1000 positive-DF material explosion branch
0x2000 zero-DF armor explosion branch
0x4000 component/device explosion involvement
0x8000 component/device explosion damage
```

This resembles a compacted descendant of historical Wargaming hit flags. Historical structure is useful as a cross-check only; current controlled evidence is authoritative.

## Consumer model

```text
ShotResultFlags {
    raw16
    directKill
    targetAlreadyDead
    fireStarted
    ricochet
    projectileMaterialPierced
    projectileMaterialStopped
    projectileZeroDfArmorPierced
    projectileZeroDfArmorNotPierced
    projectileComponentInvolvement
    projectileTrackChassisDamage
    projectileGunDamage
    explosionMaterialPositiveDf
    explosionZeroDfArmor
    explosionComponentInvolvement
    explosionComponentDamage
    confidenceByFact
}
```

Do not collapse the bitfield into one mutually exclusive enum. One hit can legitimately contain several orthogonal resolution facts.

## Remaining closure

1. obtain a current positive `0x0200` sample;
2. enlarge the current Gun-damage (`0x0800`) population;
3. recover version-matched Blitz 11.19 private enum/schema names if possible;
4. validate the same physical mapping on another client version before widening numeric support.
