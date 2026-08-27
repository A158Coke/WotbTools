# Vehicle loadout materialization — Type5 / Type32 consumables, provisions and equipment

> Scope: Blitz 11.19 China replay corpus plus one independent T-100 LT replay sample.
>
> This document records only loadout structure that is directly supported by replay bytes and behavioral closure. Exact item names remain version-gated where the current catalog mapping is not yet refreshed for 11.19.

## Executive verdict

Current Vehicle Type5 materialization does not carry only transform/HP state. It also exposes a compact battle-loadout descriptor.

For currently studied Tier X vehicle materializations, two immediately useful surfaces are present:

```text
6 × compact item descriptors
9-character ASCII equipment-selection string
```

The first surface cross-closes with Type32 item initialization/lifecycle traffic and behaves as the vehicle's 3 consumable + 3 provision slots.

The second surface is exactly 9 characters long and behaves as the 9 equipment-choice slots.

Verdict:

> **battle loadout is directly materialized in the replay — PROVEN structural/behavioral family**.
>
> This is materially stronger than inferring loadout only from derived stats such as HP/reload.

# Six item descriptors — consumables + provisions

## T-100 LT natural sample

The independent T-100 LT replay contains six Type5 item descriptors for the recorder vehicle:

```text
09
0A
0B
10
17
1D
```

The same six wire codes are represented by Type32 initialization/state traffic for that vehicle.

Known dynamic identities from independent lifecycle closure:

```text
0x09 = Adrenaline
0x0A = Engine Power Boost
0x0B = Multi-Purpose Restoration Pack
```

The remaining three codes have initialization/static behavior rather than activation/end lifecycle in this sample and are therefore provision-slot candidates:

```text
0x10
0x17
0x1D
```

Exact provision names are intentionally deferred until the refreshed 11.19 item catalog is available and the wire-code mapping is independently closed.

## Structural interpretation

The six-item shape is consistent with the current Blitz battle-loadout model:

```text
3 consumable slots
3 provision slots
```

A safe classification rule is behavioral rather than numeric:

```text
Type32 item with activation/active-end lifecycle
  -> consumable

Type32 init/static-only item without activation lifecycle
  -> provision candidate
```

This avoids hard-coding unsupported names from stale catalog values.

Verdict:

> Type5 six-item descriptor = **consumable/provision battle-loadout surface — PROVEN family**.
>
> Exact per-code symbolic mapping remains item-specific and version-gated.

# Nine-character equipment selection string

Immediately after the six-item descriptor family, current vehicle Type5 materialization contains an ASCII string of length 9.

Across the studied allied Tier X population:

```text
observed strings : 245
length == 9      : 245 / 245
```

Representative T-100 LT value:

```text
dmrhotiqe
```

Each character position has a very small stable value domain, consistent with one selection value per equipment slot.

Observed positional domains in the current corpus include:

```text
slot0: d / g
slot1: l / m
slot2: r / s / {
slot3: h / k
slot4: n / o
slot5: t / u
slot6: i / j
slot7: p / q
slot8: e / v
```

Some positions can carry vehicle-specific alternatives, so a position may have more than the normal left/right pair.

Verdict:

> 9-char string = **nine equipment-slot selections — PROVEN behavioral structure**.

Exact char -> equipment symbolic mapping is being closed slot by slot.

# Proven equipment slot mappings

## slot4 — Vitality slot 2 family

A natural SPHT population provides a clean HP contrast.

```text
equipmentString[4] = n
opening actual HP  = 3400
13 / 13

equipmentString[4] = o
opening actual HP  = 3570
96 / 96
```

The current equipment grid's Vitality slot 2 alternatives are Enhanced Armor vs Improved Assembly, and only the assembly branch directly increases vehicle HP.

Therefore current behavioral mapping is:

```text
slot4 n = ENHANCED_ARMOR
slot4 o = IMPROVED_ASSEMBLY
```

Verdict:

> **PROVEN behavioral mapping for current corpus/version**.

The observed SPHT and T-100 LT HP uplift is approximately 5% in current 11.19 replay evidence. Catalog numeric values must be refreshed independently rather than forcing an older percentage onto the replay.

## slot8 — Specialization slot 3 family

The current slot alternatives are the consumable-duration branch and consumable-cooldown branch.

T-100 LT sample:

```text
equipmentString[8] = e
Adrenaline state2 -> state3 active window ~= 26.5 s
```

A 20-second base duration multiplied by the High-End Consumables duration modifier is consistent with this observed active window.

Current corpus records using the alternate character show the ordinary ~20-second Adrenaline active window.

Therefore:

```text
slot8 e = HIGH_END_CONSUMABLES
slot8 v = CONSUMABLE_DELIVERY_SYSTEM
```

Verdict:

> **PROVEN behavioral mapping for current corpus/version**.

# Important product consequence

WotBTools no longer needs to treat equipment/provision reconstruction as purely statistical inference.

The safe architecture is now:

```text
Replay Type5
  -> raw loadout descriptor
     -> six item wire codes
     -> nine equipment selection chars

Type32 / HP / reload / movement / consumable timing
  -> behavioral validation and exact effect reconstruction
```

This enables future product features such as:

- display actual battle consumables/provisions/equipment when mappings are proven;
- explain observed HP/reload/consumable-duration differences using the real loadout;
- avoid guessing equipment solely from final stats;
- preserve unknown raw codes until a current-version mapping is proven.

# Scope boundary

This PR remains protocol research, not production implementation.

Do not:

- expose stale catalog names/percentages as 11.19 truth;
- guess provision names from old IDs;
- assume equipment character mappings are stable across future client versions;
- infer an enemy loadout from absence of Type5 materialization.

# Remaining work

1. refresh against the current 11.19 `equipment.json` / `provisions.json` catalog once available;
2. map the remaining equipment slots `0/1/2/3/5/6/7` using physical replay effects and vehicle availability constraints;
3. map provision wire codes such as `0x10/0x17/0x1D` to current logical provision IDs;
4. validate whether enemy Type5 materialization carries the same complete 6+9 loadout descriptor;
5. establish exact byte offsets/version gates for the loadout section within each Type5 vehicle payload variant;
6. preserve raw descriptor values for unsupported versions rather than silently translating them.
