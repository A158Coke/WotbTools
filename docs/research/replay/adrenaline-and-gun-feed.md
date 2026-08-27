# Adrenaline and gun-feed negative-control study

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This note is a focused follow-up to `team-weapon-telemetry.md`. It tests whether the repeated ~0.853 reload-duration mode under wrapper15 can be attributed to Adrenaline rather than a low-HP crew skill, and uses non-single-shot vehicles as negative controls.

## Background

For own-team single-shot vehicles, wrapper15 / `field2=3` is already independently tied to one observed telemetry event per settled shot. Its `field3` value forms vehicle-stable reload/gun-cycle duration modes.

Across unrelated vehicles the fast/normal duration ratio repeatedly clusters near:

```text
fast / normal ~= 0.853
```

which corresponds to an effective reload-speed increase of roughly +17.2%.

## Low-HP crew-skill hypothesis rejected

Recorder sessions with dynamic normal/fast modes and usable HP observations were tested against the proposed low-HP-only skill explanation (`破釜沉舟` / Adrenaline-Rush-like effect).

```text
reliable fast-mode sessions checked : 32
at <= 15% HP                       : 0 / 32
at <= 10% HP                       : 0 / 32
at <=  7% HP                       : 0 / 32
above 25% HP                       : 29 / 32
```

Several fast-mode sessions begin at effectively full HP; several others begin around 70–90% HP.

Verdict:

> The ~0.853 mode is **not** a low-HP-only crew-skill effect in this corpus — `REJECTED`.

## Vehicle-capability negative control

The supplied WotBTools tankopedia snapshot exposes both `allowedConsumables` and `allowedEquipment` per tier-X vehicle.

The two observed vehicles that behave as the clearest non-single-shot controls are:

```text
4481  Kranvagn
20097 Felice
```

For both vehicles the tankopedia data does **not** list `ADRENALINE`, and does not list `GUN_RAMMER` in the equipment set.

Replay telemetry for the same two vehicle IDs shows:

```text
Kranvagn (4481)
  wrapper15 field2=3 records : 0
  wrapper15 field2=4 records : 6
  wrapper15 field2=6 records : 391
  wrapper15 field2=7 records : 232
  field2=7 field3            : 2.627 s, 232 / 232

Felice (20097)
  wrapper15 field2=3 records : 0
  wrapper15 field2=4 records : 3
  wrapper15 field2=6 records : 98
  wrapper15 field2=7 records : 73
  field2=7 field3            : 4.400 s, 73 / 73
```

This rejects the interpretation that wrapper15 `field2=3` is a universal firing event for every gun-feed system. The protocol is a **gun-feed-family-specific state machine**.

## field2=7 — non-single-shot firing / gun-cycle transition

A player/replay count comparison against settlement `shots`, restricted to rows where this own-team telemetry is actually visible, gives:

Kranvagn, 29 visible player/replay rows:

```text
field2=7 count - settlement shots

 0 : 6 rows
-1 : 8 rows
-2 : 8 rows
-3 : 3 rows
larger shortfalls : only a few rows
```

Felice, 10 visible player/replay rows:

```text
field2=7 count - settlement shots

 0 : 4 rows
-1 : 5 rows
-3 : 1 row
```

Where counts differ, replay field2=7 is normally shorter than settlement rather than greater, matching known POV/event-stream truncation behavior.

The timing value is vehicle-invariant:

```text
Kranvagn field2=7 field3 = 2.627 s  (232 / 232)
Felice   field2=7 field3 = 4.400 s   (73 / 73)
```

The state sequence provides a much stronger closure than counts alone.

For each field2=7 event, the next typed wrapper15 event is almost always field2=6 after approximately exactly the field2=7 `field3` duration:

```text
Kranvagn
  field2=7 events                        : 232
  next typed event is field2=6           : 227
  field2=7 -> field2=6 median delta      : ~2.599 s
  observed delta range                   : ~2.546 .. 2.648 s
  advertised field3                      : 2.627 s

Felice
  field2=7 events                        : 73
  next typed event is field2=6           : 70
  field2=7 -> field2=6 median delta      : ~4.400 s
  observed delta range                   : ~4.377 .. 4.427 s
  advertised field3                      : 4.400 s
```

The handful of sequences that terminate into field2=5 are explained by the already-proven vehicle-death reaction state rather than a conflicting gun transition.

Therefore:

> `field2=7` is a **non-single-shot firing/post-shot gun-cycle transition**, and `field3` is its post-shot minimum cycle interval — `PROVEN physical relationship` on Kranvagn/Felice current samples.

The exact current Blitz symbolic enum name remains `PARTIAL`.

## field4 on field2=7 — remaining loaded-shell state

The optional small `field4` value on field2=7 exhibits a strict decrement pattern across consecutive firing cycles.

Observed distributions:

```text
Kranvagn field2=7 field4:
  2 : 146
  1 :  86

Felice field2=7 field4:
  3 : 44
  2 : 18
  1 : 11
```

Representative real sequences:

```text
Kranvagn
field2=7  field3=2.627  field4=2
  -> ~2.6 s
field2=6  field3=6.563  field4=2
field2=7  field3=2.627  field4=1
  -> ~2.6 s
field2=6  field3=9.375  field4=1
field2=6  field3=13.025 field4=absent

Felice
field2=7  field3=4.400  field4=3
  -> ~4.4 s
field2=6  field3=7.243  field4=3
...
field2=7  field3=4.400  field4=2
field2=6  field3=9.054  field4=2
field2=7  field3=4.400  field4=1
field2=6  field3=10.865 field4=1
field2=6  field3=17.103 field4=absent
```

The same flag value is preserved across the field2=7 -> field2=6 transition:

```text
Kranvagn matched 7->6 pairs:
  2 -> 2 : 145
  1 -> 1 :  82

Felice matched 7->6 pairs:
  3 -> 3 : 44
  2 -> 2 : 17
  1 -> 1 :  9
```

This is the expected behavior of a **remaining loaded-shell / feed-stage state** after a shot. The value decrements as the weapon consumes ready shells and governs which subsequent replenishment-time tier is active.

Verdict:

> wrapper15 `field4` in the field2=7/6 non-single-shot family is a **loaded-shell/feed-stage counter** — `PROVEN physical role / PARTIAL exact symbolic name`.

Do not generalize the numeric maximum (`2` for Kranvagn, `3` for Felice) into a universal magazine size without version-matched vehicle/feed metadata.

## field2=6 — shell replenishment / feed-recovery timer family

Conditioning field2=6 `field3` on the loaded-shell/feed-stage counter reveals discrete timer tiers.

Kranvagn dominant modes:

```text
field4=2 : 6.563 s  (197 observations)
field4=1 : 9.375 s  (107)
field4 absent : 13.025 s (43)
```

A secondary equipment/configuration family appears at approximately:

```text
6.103 / 8.719 / 12.106 s
```

Felice dominant modes:

```text
field4=3 : 7.243 / 7.337 s
field4=2 : 9.054 / 9.172 s
field4=1 : 10.865 s
field4 absent : ~17.103 s
```

The timer systematically grows as the ready-shell/feed-stage count falls. Together with the preceding field2=7 shot transition, this is not a generic cooldown scalar.

Verdict:

> `field2=6` is a **non-single-shot shell-replenishment / feed-recovery timer family** — `PROVEN physical relationship / PARTIAL exact symbolic name`.

The protocol distinguishes at least two timing concepts for these guns:

```text
field2=7 field3
  = fixed post-shot / between-shot gun-cycle interval

field2=6 field3
  = shell replenishment / feed recovery duration selected by loaded-shell stage
```

This is compatible with an autoloading/autoreloading feed mechanism, but the archive intentionally describes the measured physical role rather than asserting a vehicle-marketing mechanism name that has not been independently version-matched.

## Positive control: Adrenaline-capable single-shot vehicles

The current corpus contains repeated ~0.853 fast/normal pairs for these settlement vehicle IDs:

```text
29985 SPHT
6929  Maus
6225  FV215b
19537 Vickers Light
15697 Chieftain Mk. 6
28689 Rhm. Pzw.
6145  IS-4
3937  Ho-Ri
58641 VK 72.01 K
13825 T-62A
19969 unresolved-current-tankopedia identity
```

For every named vehicle above that is present in the current WotBTools tier-X tankopedia snapshot, `allowedConsumables` includes `ADRENALINE`; these same conventional single-shot records also expose `GUN_RAMMER` in their allowed equipment family.

The unresolved settlement vehicle `19969` is now localized to one replay/player (`_Moony`, arena `9851673216824251`) but is not present in the current tier-X tankopedia snapshot used for this archive. It remains an explicit version/reference-data gap rather than being guessed.

Examples of observed paired durations:

```text
SPHT       8.705 -> 7.426  ratio 0.85307
Maus      10.723 -> 9.150  ratio 0.85331
FV215b     7.696 -> 6.563  ratio 0.85278
Ho-Ri     10.448 -> 8.915  ratio 0.85327
VK 72.01  15.492 -> 13.227 ratio 0.85380
```

## Duration-window test

For recorder fast-mode sessions with both a preceding normal shot and a following normal shot, a fixed-duration interval was tested against all observed fast/normal states.

```text
20 s window feasible : 33 / 33 sessions
15 s window feasible : 30 / 33
26 s window feasible : 21 / 33
```

Combined with the vehicle-capability negative control and the ~+17.2% measured speed increase, this strongly identifies the fast mode as the **Adrenaline reload modifier effect** for the current corpus.

Verdict:

> `~0.853 fast mode == Adrenaline effect` — **PROVEN behavioral identity for the current corpus**, while the exact replay RPC/state carrying the consumable activation ID remains `PARTIAL`.

## Important correction: field2=4 is NOT Adrenaline activation

A timing probe found wrapper15 `field2=4` inside every tightly bounded recorder Adrenaline onset interval (`33/33`). That relationship is real, but the non-single-shot negative controls disprove an identity mapping:

```text
Kranvagn : field2=4 exists while ADRENALINE is not allowed
Felice   : field2=4 exists while ADRENALINE is not allowed
```

Therefore:

> `wrapper15 field2=4 == Adrenaline activated` is **REJECTED**.

The safer interpretation is a generic weapon/reload-state transition. Exact enum label remains `PARTIAL`.

## Protocol implications

Production decoders must not model wrapper15 as one flat event type. Current evidence requires a gun-feed-aware state machine:

```text
single-shot
  field2=3 + field3
    -> shot-associated reload/gun-cycle duration
    -> dynamic ~0.853 mode identifies Adrenaline effect

non-single-shot
  field2=7 + field3 + field4
    -> firing/post-shot transition
    -> fixed between-shot cycle interval
    -> loaded-shell/feed-stage counter

  field2=6 + field3 + field4
    -> shell replenishment/feed-recovery state
    -> stage-dependent replenishment duration

common state
  field2=4
    -> generic weapon/reload-state transition
    -> NOT Adrenaline-only
```

## Remaining work

1. Resolve settlement vehicle ID `19969` against a version-matched Blitz vehicle definition.
2. Recover the current Blitz symbolic enum/schema for wrapper15 state codes.
3. Decode the explicit consumable/equipment activation identity if present elsewhere in the stream.
4. Acquire additional non-single-shot replay samples to verify the field6/7 state machine across other feed mechanisms.
5. Explain secondary Kranvagn/Felice timer modes through exact equipment/provision/configuration data rather than guessing.
6. Keep all state numbering version-gated.
