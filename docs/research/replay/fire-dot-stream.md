# Fire ignition and DOT reconstruction

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> This chapter separates the observed fire-ignition event from subsequent periodic HP damage. It builds on settlement `deathReason=1 = fire`, the Type32 short `...04` family and the consumable differential recorded in `fire-and-repair-states.md`.

## Executive verdict

Current mobile Type32 `flag=1` short bodies in the `...04` family are not repeated periodic fire ticks. In the current corpus they mark the **fire ignition/start-side damage event**:

```text
mobile ...04 events observed : 23
same rawClock Vehicle method8 direct-hit event : 23 / 23
same rawClock Type7 prop3 HP update            : 23 / 23
```

Observed short bodies are:

```text
9c 04      : 21
9d 80 04   :  2
```

After ignition, the continuing burn normally appears as Type7 `propId=3` current-HP decreases at approximately half-second cadence. Those later DOT ticks do **not** repeat the `...04` short event and do not carry a new matching direct-hit method8 event.

Verdict:

> Type32 mobile short `...04` = **fire ignition/start-family evidence — PROVEN behavioral role on the current corpus**.

The exact symbolic event name and the distinction between `9c04` and `9d8004` remain `PARTIAL`.

## Ignition versus periodic DOT

The canonical observed sequence is:

```text
direct shell hit
  Vehicle method8
  Type7 prop3 HP update
  Type32 short ...04
        |
        v
vehicle burning
  Type7 prop3 HP decreases only
  approximately every 0.5 s
  no repeated ...04 required
        |
        +--> natural expiry / death
        |
        +--> Multi-Purpose Restoration Pack 0x0B
             periodic DOT terminates
```

This matters because a parser must not count every later HP tick as another projectile hit.

## DOT timing

Eight current fire sequences are sufficiently complete and free of overlapping new direct-hit method8 events to inspect natural/death burn timing.

Across 30 usable inter-tick intervals:

```text
median interval ~= 0.500 s
```

Non-lethal natural sequences in the current sample persist for roughly `3.4 .. 4.5 s`. Low-HP vehicles can terminate sooner by death, so this range must **not** be promoted to a universal configured fire duration.

Representative observed sequences:

```text
HP 2043
+0.492 -> 1966  (-77)
+0.984 -> 1899  (-67)
+1.584 -> 1841  (-58)
+1.984 -> 1792  (-49)
+2.485 -> 1753  (-39)
+2.985 -> 1723  (-30)
+3.585 -> 1702  (-21)
+3.985 -> 1691  (-11)
+4.494 -> 1689  ( -2)
```

```text
HP 1598
+~0.5 -> 1525 (-73)
        1461 (-64)
        1407 (-54)
        1362 (-45)
        1326 (-36)
        1300 (-26)
        1283 (-17)
        1275 ( -8)
```

The per-tick HP loss decreases through the burn in these examples. Consumers should reconstruct observed damage from HP deltas rather than derive a universal fire formula from this corpus.

## Separating direct hit from fire damage

Safe evidence rule for an observed burn:

1. use Type32 short `...04` plus same-clock direct-damage method8 as the ignition/start anchor;
2. Type7 `prop3` remains authoritative for actual HP;
3. subsequent `prop3` decreases without a new direct-hit method8 in the same damage window can be attributed to the active fire-DOT stream while the burn remains open;
4. if another direct hit arrives during the burn, preserve both evidence sources and fail closed when an individual HP delta cannot be uniquely partitioned;
5. settlement remains authoritative for the final `deathReason=fire` fact.

This supports an evidence-aware reconstruction such as:

```text
shell direct HP loss : observed from the ignition HP window
fire DOT HP loss     : sum of later fire-only prop3 deltas
```

without trusting the Type8 raw protocol value as damage.

## Extinguish boundary

Type32 consumable `0x0B` (Multi-Purpose Restoration Pack) is a reliable observed early-stop boundary.

Among 14 fire events followed shortly by `0x0B`, after excluding new method8 direct hits:

```text
13 / 14 have no later independent periodic HP-loss tick
1 / 14 has one HP update exactly at the activation clock
```

The same-clock edge is consistent with an already scheduled/in-flight burn update and does not demonstrate continuing burn after activation.

By contrast, both observed `0x0D` Repair Kit activations during fire are followed by multiple further half-second HP-loss ticks. Therefore Repair Kit is **not** a fire-stop boundary.

## No separate observed short fire-tick / fire-stop packet

Current corpus evidence does not show:

- a repeated Type32 short `...04` for each periodic burn tick; or
- a consistent Type32 mobile short-body fire-stop packet aligned with `0x0B` extinguish.

Safe current model:

```text
FIRE_START_OBSERVED
  source: Type32 short ...04 + same-clock direct-hit evidence

FIRE_DOT_OBSERVED
  source: authoritative prop3 HP deltas during the open burn

FIRE_STOP_OBSERVED
  source: 0x0B activation + cessation of periodic HP loss
  or natural cessation / terminal death
```

The engine may have an internal fire-stop RPC not represented on this replay surface; absence of a decoded short packet must not be converted into a fabricated packet identity.

## Consumer implications

### AI Review

When evidence is complete, it is safe to distinguish:

```text
"The shell caused X observed HP loss and ignited the vehicle; the subsequent fire caused Y additional observed HP loss."
```

Do not report a synthetic formula-derived burn value when HP evidence is incomplete or an overlapping direct hit makes attribution ambiguous.

### Battle playback

- start the observed burn at the `...04` ignition event;
- apply authoritative HP samples rather than simulated fire damage;
- terminate the observed burn at MPRP activation when the DOT stream stops, natural cessation, or death;
- preserve source/confidence and AoI boundaries.

## Remaining work

1. determine the exact symbolic encoding and difference between `9c04` and `9d8004`;
2. test fire ignition and extinguish behavior on additional versions and random-battle samples;
3. determine whether a separate fire-stop RPC exists elsewhere in the 11.19 stream;
4. join ignition to projectile terminal geometry when the firing projectile is observable;
5. keep damage partition fail-closed when fire and new direct hits overlap.
