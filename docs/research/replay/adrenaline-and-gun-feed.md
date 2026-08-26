# Adrenaline and gun-feed negative-control study

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This note is a focused follow-up to `team-weapon-telemetry.md`. It tests whether the repeated ~0.853 reload-duration mode under wrapper15 can be attributed to Adrenaline rather than a low-HP crew skill, and uses magazine/autoloader vehicles as negative controls.

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
  wrapper15 field2=3 shot/reload records : 0
  wrapper15 field2=4 records             : 6
  wrapper15 field2=6 records             : 391
  wrapper15 field2=7 records             : 232
  field2=7 field3                         : 2.627 s, 232 / 232

Felice (20097)
  wrapper15 field2=3 shot/reload records : 0
  wrapper15 field2=4 records             : 3
  wrapper15 field2=6 records             : 98
  wrapper15 field2=7 records             : 73
  field2=7 field3                         : 4.400 s, 73 / 73
```

This is a strong negative control against the interpretation that wrapper15 `field2=3` is a universal firing event for every gun-feed system. The current evidence instead supports a **gun-feed-family-specific state machine**:

- `field2=3` is the observed single-shot reload/gun-cycle family;
- non-single-shot/magazine-style vehicles use different state codes (`6/7` strongly represented here);
- the exact symbolic names of `6/7` remain `PARTIAL` until independently schematized.

### field2=7 is shot-associated in the non-single-shot family

A second pass compared the non-single-shot `field2=7` count against authoritative settlement `shots`, restricting the comparison to player/replay rows where the own-team telemetry stream actually contains records for that vehicle.

For Kranvagn there are 29 visible player/replay rows:

```text
field2=7 count - settlement shots

 0 : 6 rows
-1 : 8 rows
-2 : 8 rows
-3 : 3 rows
larger shortfalls : only a few rows
```

For Felice there are 10 visible player/replay rows:

```text
field2=7 count - settlement shots

 0 : 4 rows
-1 : 5 rows
-3 : 1 row
```

The one-sided nature of the mismatch matters: where counts differ, the replay-observed field2=7 count is normally **shorter** than settlement rather than greater. That is the same signature already seen elsewhere when a POV stream starts late, terminates early or simply does not receive every team-side event. It is not the signature of an unrelated high-frequency status timer.

Together with the vehicle-specific invariant duration:

```text
Kranvagn field2=7 field3 = 2.627 s  (232 / 232)
Felice   field2=7 field3 = 4.400 s   (73 / 73)
```

this closes an additional relationship:

> `field2=7` is **shot-associated non-single-shot gun-cycle telemetry** — `PROVEN relationship` for these current samples.

The exact symbolic interpretation remains deliberately `PARTIAL`. In particular, the current corpus alone does not yet prove whether the value is named intra-clip reload, shell-cycle time, magazine shot cooldown, or another server gun-state timer. Those names must not be emitted as canonical protocol symbols without an independent current Blitz schema or controlled feed-mechanism sample.

`field2=6` is also strongly concentrated on Kranvagn/Felice and commonly occurs at counts near or above shots, but its state role is not yet isolated. It remains a non-single-shot/magazine weapon-state family with `PARTIAL` semantics.

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

Vehicle `19969` is observed in settlement/replay telemetry but is not resolved in the current tier-X tankopedia snapshot used for this study, so it remains an explicit metadata gap rather than being guessed.

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

The distinction is intentional: the effect can be identified from its allowed-vehicle domain, magnitude, duration and state transitions even though the explicit activation packet has not yet been decoded.

## Important correction: field2=4 is NOT Adrenaline activation

A previous timing probe found wrapper15 `field2=4` inside every tightly bounded recorder Adrenaline onset interval (`33/33`). That relationship is real, but the gun-feed negative controls disprove an identity mapping:

```text
Kranvagn : field2=4 exists (6 records) while ADRENALINE is not allowed
Felice   : field2=4 exists (3 records) while ADRENALINE is not allowed
```

Therefore:

> `wrapper15 field2=4 == Adrenaline activated` is **REJECTED**.

The safer interpretation is:

> `field2=4` is a generic weapon/reload-state transition that occurs during Adrenaline state changes but is not specific to that consumable.

The exact enum label remains `PARTIAL`.

## Protocol implications

Production decoders must not model wrapper15 as one flat event type. The current evidence requires a gun-feed-aware state model:

```text
vehicle/gun-feed family
  -> wrapper15 state code
  -> timing value
  -> modifier state
```

Safe facts today:

```text
single-shot field2=3 + field3
  -> shot-associated reload/gun-cycle duration
  -> dynamic ~0.853 mode identifies Adrenaline effect

field2=4
  -> generic weapon/reload-state transition
  -> NOT an Adrenaline-only activation marker

non-single-shot field2=7 + field3
  -> shot-associated gun-cycle telemetry
  -> Kranvagn current invariant = 2.627 s
  -> Felice current invariant   = 4.400 s
  -> exact symbolic timer name still PARTIAL

field2=6
  -> non-single-shot/magazine weapon-state family
  -> exact semantics PARTIAL
```

## Remaining work

1. Resolve settlement vehicle ID `19969` against a version-matched Blitz vehicle definition.
2. Recover the current Blitz symbolic enum/schema for wrapper15 state codes.
3. Decode the explicit consumable/equipment activation identity if present elsewhere in the stream.
4. Acquire additional autoloader/autoreloader/magazine replay samples to distinguish `field2=6` vs `field2=7` semantics and test whether the timer meaning generalizes across feed systems.
5. Keep gun-feed classification version-gated; do not infer future protocol semantics from 11.19 state numbers alone.
