# Ammo-rack damage and Loader shell-shock — method16 code closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: recorder-vehicle Avatar method16 damage-info events joined to independently proven method35 effective reload-duration updates and Type32 recovery consumables.

## Executive verdict

Two previously unknown method16 `codeB` values are now behaviorally closed:

```text
codeB = 32 -> ammo rack
codeB = 43 -> Loader crew member
```

Their paired `codeA` states are also strongly separated into damage/injury and recovery transitions:

```text
(codeA=4,  codeB=32) -> ammo-rack damaged state onset
(codeA=19, codeB=32) -> ammo-rack damaged state cleared/repaired

(codeA=10, codeB=43) -> Loader shell-shock/injury onset
(codeA=22, codeB=43) -> Loader shell-shock/injury cleared/healed
```

These identities are based on direct vehicle-parameter effects plus the correct recovery-consumable class, not historical numeric transplantation.

## Independent surfaces used

### Avatar method16

Already-proven damage-info body:

```text
vehicleId      : u32
codeA          : u8
codeB          : u8
relatedEntity  : u32
```

On clean damage events:

```text
vehicleId     = victim
relatedEntity = attacker/source
```

Source-less state-clear events commonly use `relatedEntity=0`.

### Avatar method35

Independently proven in the current corpus as:

```text
vehicleEntityId : u32
reloadDuration  : f32
...
```

It carries the current effective full gun reload-duration configuration and reacts exactly to known Adrenaline start/end events.

### Recovery consumables

Type32 mobile flag0 mappings independently proven:

```text
0x0B = Multi-Purpose Restoration Pack
0x0C = First Aid Kit
0x0D = Repair Kit
```

These provide a decisive mechanical-module vs crew-injury discriminator.

## `codeB=32` = ammo rack

### Damage onset

Current recorder-vehicle observations:

```text
(codeA=4, codeB=32) onset records : 12
```

Every one produces an immediate effective reload-duration penalty:

```text
newReload / previousReload = 1.65
12 / 12 exact within float precision
```

Representative examples:

```text
SPHT      8.804916 -> 14.528112  x1.650000
SPHT      8.691794 -> 14.341461  x1.650000
FV215b    6.663264 -> 10.994387  x1.650000
VK 72.01 15.592039 -> 25.726864  x1.650000
```

The same 1.65 factor applies even while another reload modifier is active. Example during Adrenaline:

```text
7.525569 -> 12.417190  x1.650000
```

This proves the damage state acts on the gun loading configuration rather than being an unrelated hit presentation code.

### Repair/clear transition

Current observable clear events:

```text
(codeA=19, codeB=32, relatedEntity=0) : 9
```

All 9 occur exactly with an independently decoded mechanical recovery consumable:

```text
Multi-Purpose Restoration Pack (0x0B) or
Repair Kit                    (0x0D)
```

At the same clock method35 restores the reload duration by the exact inverse factor:

```text
newReload / damagedReload ~= 1 / 1.65
9 / 9 exact within float precision
```

Representative:

```text
14.528112 -> 8.804916
14.341461 -> 8.691794
10.994387 -> 6.663264
```

No First Aid Kit is required for this state.

### Physical identity

Current World of Tanks Blitz gameplay documentation states that a damaged ammo rack reduces gun loading performance, while Repair Kit restores damaged modules. Among the normal mechanical module families, ammo-rack damage is the module effect that directly changes gun reload/loading speed.

Combined evidence:

```text
mechanical damage-info code
+ deterministic reload-duration penalty
+ Repair Kit/MPRP clear
+ exact reload restoration
```

closes:

> method16 `codeB=32` = **ammo rack — PROVEN behavioral identity**.
>
> `(codeA=4, codeB=32)` = **ammo rack damaged onset — PROVEN**.
>
> `(codeA=19, codeB=32)` = **ammo rack damaged-state clear/repair — PROVEN relationship**.

The observed `x1.65` effective duration factor is version/loadout/configuration dependent and must not be encoded as a universal game constant.

## `codeB=43` = Loader crew member

### Injury onset

Current recorder observations:

```text
(codeA=10, codeB=43) onset records : 5
```

All five are associated with a large reload-duration degradation. Four have the method35 update at exactly the same replay clock; the fifth has the reload update approximately 0.09 s later.

Representative effective factors:

```text
7.525569 -> 14.394962  x1.913
8.188572 -> 15.663158  x1.913
8.804916 -> 16.842106  x1.913
```

One battle has overlapping modifiers/damage states and therefore a different observed compound ratio; the direction and recovery behavior remain the same.

### Heal/clear transition

Current clear events:

```text
(codeA=22, codeB=43, relatedEntity=0) : 4
```

All four coincide with a crew-capable recovery consumable:

```text
Multi-Purpose Restoration Pack (0x0B), or
First Aid Kit                   (0x0C)
```

A direct First Aid Kit example restores the reload duration at the same clock.

No Repair-Kit-only clear is observed for this code family.

### Physical identity

Current Blitz support documentation states:

```text
Loader shell-shocked -> reloading speed is reduced
First Aid Kit         -> immediately heals shell-shocked crew members
```

Among crew roles, Loader is the role whose injury directly changes reload speed.

Combined evidence:

```text
crew-recovery consumable class
+ deterministic large reload penalty
+ First Aid/MPRP clear
+ reload restoration
```

closes:

> method16 `codeB=43` = **Loader — PROVEN behavioral identity**.
>
> `(codeA=10, codeB=43)` = **Loader shell-shock/injury onset — PROVEN**.
>
> `(codeA=22, codeB=43)` = **Loader heal/clear transition — PROVEN relationship**.

## Interaction with simultaneous states

Ammo-rack damage, Loader shell-shock and Adrenaline can overlap. Method35 therefore exposes the **effective combined reload duration**, not an isolated base-stat value.

Consumers must reconstruct state transitions rather than derive identity from a hard numeric multiplier.

Safe state model:

```text
ReloadAffectingDamageState {
    rawClockSec
    vehicleEntityId
    ammoRackDamaged : boolean?   // method16 codeB 32 lifecycle
    loaderInjured   : boolean?   // method16 codeB 43 lifecycle
    effectiveReloadDurationSec   // method35
}
```

## Production value

These signals can support evidence-backed AI/playback statements such as:

- ammo rack was damaged at time T and reload duration increased;
- Repair Kit restored the ammo rack at time T;
- Loader was shell-shocked at time T;
- First Aid Kit/MPRP healed the Loader at time T;
- an unusually long reload interval was caused by a proven damage state rather than fabricated from tankopedia base reload.

Do not infer these states from reload duration alone; consume the method16 codes as primary state identity and method35 as physical-effect confirmation.

## Remaining module/crew work

Use the same methodology to close other method16 `codeB` families:

1. mobility effect + Repair Kit -> engine/track candidates;
2. turret-yaw rate effect + Repair Kit -> turret-ring candidate;
3. dispersion/aim effect + Repair Kit -> gun candidate;
4. view/aim/UI effect + First Aid Kit -> commander/gunner candidates;
5. fuel/fire relationship -> fuel-tank candidate.
