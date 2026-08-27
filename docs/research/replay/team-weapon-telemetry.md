# Arena wrapper 15 — team weapon/reload telemetry

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This document records an empirical protocol family discovered under Avatar Type-8 method 48 / wrapper 15 / protobuf root field 14. The outer wrapper's original Blitz symbolic enum name is not yet independently available, so the document uses a descriptive research name rather than inventing an RPC symbol.

## Target scope

All 8,050 wrapper-15 records in the current corpus target entities on the recorder's **own team**:

```text
own-team target : 8,050
enemy target    : 0
```

This immediately rejects the earlier generic-enemy-visibility hypothesis for this wrapper in the current training corpus.

## Record shape

Observed inner records use:

```text
field1 : vehicle/entity ID
field2 : optional small state/event code
field3 : optional float32 timing/value
field4 : optional small state/event code
```

The important point is that field2 and field4 are not interchangeable: observed records can carry field2 only, field4 only, or both in some families.

## field2 = 3 — one observed event per shot

This is the strongest closed relationship.

For the recorder vehicle, where Type23 provides an independent shot/projectile lifecycle and settlement provides authoritative `shots`:

```text
sum(wrapper15 field2=3 for recorder) = 432
sum(settlement shots for recorder)   = 432
```

Per replay:

```text
44 / 44 recorder battles:
count(field2=3) == settlement shots
```

Across all own-team settled vehicles:

```text
308 player/replay rows checked
254 exact count matches overall
257 rows have at least one observed field2=3
254 / 257 of those are exact count matches
remaining three rows are short by only 1, 1 and 2 events
```

Rows with zero observed events are consistent with POV/event-stream coverage limits; they must not be interpreted as zero shots because settlement proves otherwise.

Verdict:

> `field2=3` is a **shot-associated team telemetry event** — `PROVEN` on the current corpus.

It is not the raw firing instant itself. For the recorder it is delivered near the Type23 projectile-resolution/impact side of the shot lifecycle:

```text
median |Δt| to nearest Type23 payload=1 ≈ 0.137 s
≈79.9% within 0.25 s
≈97.0% within 1.0 s
```

By contrast, distance to Type23 payload=0 (the firing/in-flight transition) has median ≈1.86 s.

Therefore the event is best described as **shot-associated telemetry delivered around projectile resolution**, not as an exact fire timestamp.

## field3 on field2=3 — reload/gun-cycle duration family

Every observed `field2=3` record carries float32 field3.

The values form extremely stable vehicle-specific duration clusters. Examples by settlement vehicle compact-descriptor ID:

```text
vehicle 29985:
  8.705 s (167 observations)
  8.592 s (63)
  7.426 s (50)
  7.329 s (22)
  ...

vehicle 6929:
  10.723 s (34)
   9.150 s (10)

vehicle 6225:
   7.696 s (22)
   6.563 s (9)

vehicle 3937:
  10.448 s (10)
   8.915 s (4)

vehicle 58641:
  15.492 s (3)
  13.227 s (1)
```

The paired low/high modes have a remarkably consistent ratio:

```text
7.426 / 8.705  ≈ 0.8531
7.329 / 8.592  ≈ 0.8530
9.150 / 10.723 ≈ 0.8533
6.563 / 7.696  ≈ 0.8528
8.915 / 10.448 ≈ 0.8533
13.227 / 15.492≈ 0.8538
```

That is a repeated ~14.6–14.7% reduction across unrelated vehicles. This is characteristic of the same gun-cycle/reload quantity under a reload-speed modifier rather than a random shot-result scalar.

Additional timing evidence: for many records, a later field4 state transition occurs approximately `field3` seconds after the `field2=3` event; overlap and subsequent state changes create ambiguous pairings in rapid/modified firing sequences, so field4's exact enum semantics remain separate.

Verdict:

> field3 in the `field2=3` family is a **vehicle gun reload / shot-cycle duration telemetry value** — `PROVEN/PARTIAL`.

The physical quantity is closed to the reload/gun-cycle family by shot-count identity, vehicle-stable duration clusters and repeated common modifier ratio. The exact UI/server name and whether the scalar is nominal reload, post-resolution reload telemetry, or a related gun-cycle timer remains `PARTIAL` until a current Blitz schema symbol is recovered.

## The ~0.853 fast mode — Adrenaline correlation

A targeted follow-up tested whether the repeated fast reload mode could instead be the conditional low-HP crew skill commonly described as Adrenaline Rush / Desperate (`破釜沉舟`). The current corpus rejects that hypothesis.

For recorder vehicles with both a dynamic normal/fast reload mode and usable HP observations:

```text
32 fast-mode sessions have a reliable pre-session HP ratio
0 / 32 occur at <= 15% HP
0 / 32 occur at <= 10% HP
0 / 32 occur at <= 7% HP
29 / 32 occur above 25% HP
```

Several sessions begin at effectively full observed HP; others begin around 70–90% HP. Therefore the ~0.853 mode cannot be caused by a low-HP-only crew skill in this corpus.

The observed effective reload-speed increase is:

```text
normalDuration / fastDuration - 1

mean   ≈ +17.223%
median ≈ +17.229%
range  ≈ +17.129% ... +17.259%
```

Independent World of Tanks Blitz balance documentation specifies Adrenaline as a temporary **+17% gun reload-speed** consumable with a **20 s** active duration in the relevant modern balance family. A +17% speed modifier predicts a duration multiplier of:

```text
1 / 1.17 ≈ 0.85470
```

The replay-observed multiplier is:

```text
mean   ≈ 0.85307
median ≈ 0.85303
range  ≈ 0.85281 ... 0.85376
```

This is within roughly two-tenths of one percentage point in speed-space and is stable across unrelated vehicles/base reload values.

A duration-window test was also applied to recorder fast-mode sessions that have both a preceding normal shot and a following normal shot. For each session we ask whether there exists a single 20-second active interval such that all observed fast shots are inside the interval while the adjacent normal shots are outside it:

```text
20 s window feasible: 33 / 33 sessions
15 s window feasible: 30 / 33
26 s window feasible: 21 / 33
```

The 20-second model is therefore the only tested fixed duration that explains all fully bounded recorder sessions in this corpus.

Verdict:

> The ~0.853 dynamic fast mode is **strongly identified with the Adrenaline consumable effect** and the low-HP crew-skill hypothesis is `REJECTED` for this corpus.

Promotion is intentionally kept at `PROVEN correlation / PARTIAL protocol identity`, not final symbolic `PROVEN`, because the replay event that explicitly carries the consumable/equipment identifier has not yet been independently decoded and linked to each activation. In particular, wrapper12 must **not** currently be labelled as an Adrenaline activation stream merely because historical `ARENA_UPDATE` enum value 12 is named `COMBAT_EQUIPMENT_USED`; the observed wrapper12 sequences do not provide stable per-player activation alignment in this corpus.

Safe consumer statement today:

```text
wrapper15 field2=3 field3 fast mode
  -> temporary ~17.2% reload-speed increase
  -> behavior and 20 s window match modern Blitz Adrenaline
  -> not a low-HP-only crew-skill effect
```

The remaining protocol task is to recover the explicit consumable/equipment activation identity and join it to this reload telemetry.

## field2 = 5 — death/terminal weapon-state transition

A second strong relationship exists with own-team vehicle deaths.

For every own-team death that has a wrapper-6 `VEHICLE_KILLED` event in the current corpus:

```text
190 / 190 deaths have field2=5 wrapper-15 telemetry
```

The closest field2=5 record occurs after the wrapper-6 kill event by:

```text
median ≈ +0.100 s
all 190 / 190 within 0.2 s
observed range ≈ +0.075 ... +0.134 s
```

Each dead vehicle commonly receives 2–3 field2=5 records, so this is not a second independent death source. It is a weapon/team-status subsystem reacting to vehicle termination.

Verdict:

> `field2=5` is a **death/terminal transition in this telemetry subsystem** — `PROVEN relationship`, exact enum label `PARTIAL`.

It must not replace wrapper6/settlement as the authoritative killer/death-reason source.

## Other field2/field4 states

Observed field2 totals:

```text
3 : 2408
4 :  934
5 :  861
6 :  689
7 :  419
```

Records without field2 but with field4 are also common. Current field3 ranges:

```text
field2=3 : 4.07 .. 17.59 s
field2=4 : -0.039 .. 25.31
field2=5 : 5.17 .. 25.01 when present
field2=6 : 0.837 .. 17.33
field2=7 : 2.627 .. 4.400
```

These states likely represent transitions/modifiers inside the same team weapon/reload telemetry system, but the corpus does not yet justify assigning names such as reload-start, reload-complete, ammo-rack penalty, adrenaline, clip state, or shell switch to specific codes.

Those names remain hypotheses until isolated by controlled or independently schematized evidence.

## Important negative conclusions

Wrapper15 is **not** currently supported as:

- a generic enemy visibility/spotted stream — all current targets are own-team;
- an authoritative shot timestamp — field2=3 arrives around projectile resolution, not the initial Type23 firing transition;
- authoritative damage/penetration evidence — shot-count correlation does not encode HP loss;
- an independent death source — field2=5 is downstream of the already-authoritative death chain;
- a low-HP crew-skill stream for the ~0.853 fast mode — high-HP/full-HP counterexamples reject that explanation.

## Consumer guidance

Current safe facts:

```text
wrapper15 / field2=3
  -> observed own-team shot telemetry
  -> field3 is reload/gun-cycle-duration family
  -> dynamic ~0.853 mode matches the modern Adrenaline reload-speed effect

wrapper15 / field2=5
  -> own-team terminal/death reaction state
```

Until remaining state codes are closed, production reconstruction should preserve them as raw typed telemetry and avoid user-visible names beyond these proven relationships.
