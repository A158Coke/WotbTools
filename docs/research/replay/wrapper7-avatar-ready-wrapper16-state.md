# Arena wrapper7 `AVATAR_READY` and wrapper16 state-family research

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Historical numeric names are accepted only when current 11.19 wire shape and replay behavior independently agree.

## wrapper7 — vehicle/avatar-ready notification

Current subtype48 wrapper7 has a minimal protobuf shape:

```text
root field7
  -> child field1 = entity / vehicle ID
```

Across the canonical 34 arenas:

```text
wrapper7 records per arena:
  18 : 31 arenas
  16 :  2 arenas
  20 :  1 arena

unique IDs per arena:
  14 : 26 arenas
  15 :  4 arenas
  16 :  4 arenas
```

All 14 settled combatant entity IDs are present in wrapper7 in 34/34 arenas. Extra IDs are observer/non-combatant entities.

Historical Wargaming lineage exposes `ARENA_UPDATE.AVATAR_READY = 7` with a one-vehicle-ID payload and matching setup behavior.

Verdict:

> wrapper7 = **vehicle/avatar-ready lifecycle notification — PROVEN behavioral family**.
>
> child field1 = **vehicle/entity ID — PROVEN**.

## wrapper16 — vehicle special-state broadcast family

Current wrapper16 shape:

```text
root field15
  child field1 = entity / vehicle ID
  child field2 = 1
  child field3 = state/event code
```

Canonical counts:

```text
records total : 741
field3 = 1    : 718
field3 = 8    :  23
```

The rare `field3=8` branch is now much more narrowly closed than the earlier generic `damage-triggered` label.

# field3=8 — Tracer Shell / forced-spot hit-applied state family

## Current-corpus attacker closure

All 23 `field3=8` records occur in exactly two arenas.

In each arena, the nearby damage source is one specific enemy combat vehicle. Settlement tank-ID resolution gives:

```text
arena A attacker tankId = 28689
arena B attacker tankId = 28689
```

Current tank identity:

```text
28689 = Rhm. Pzw.
```

Both Rhm. Pzw. attackers are on the **enemy team** relative to the replay recorder.

The corpus contains five additional arenas with a Rhm. Pzw., but in all five cases that Rhm. Pzw. is on the recorder's own team:

```text
friendly-Rhm arenas : 5
field3=8 records     : 0
```

The same canonical corpus contains **no T-100 LT battle participant**:

```text
T-100 LT tankId = 24321
settled occurrences in canonical 34 arenas = 0
```

Therefore current 11.19 replay evidence can directly validate the Rhm. Pzw. producer path, but cannot yet perform an in-corpus T-100 LT cross-check.

## Hit-level closure

Across the two enemy-Rhm arenas, the Rhm. Pzw. produces 25 current-corpus Vehicle method8 HP-damage hits.

Split by victim outcome:

```text
non-terminal Rhm hits                         : 23
same-victim wrapper16 field3=8 within ±0.15s : 23 / 23

terminal/lethal Rhm hits                      :  2
field3=8 after terminal victim                :  0 / 2
```

Thus every observed **surviving** victim of enemy-Rhm HP damage receives field3=8.

All 23 state8 victims are on the recorder's team. None is the recorder's own vehicle; recorder-local presentation may use a separate surface, while wrapper16 is an arena/team state broadcast.

No other attacker/tank in the canonical corpus generates field3=8.

Verdict:

> wrapper16 `field3=8` = **enemy Tracer-Shell-capable Rhm. Pzw. hit-applied surviving-target state — PROVEN behavioral identity for the current corpus**.

## Tracer Shell / 20-second forced visibility

Current Blitz gameplay references identify **Tracer Shells** as a hit-applied spotting mechanic that keeps the target visible to allies for **20 seconds instead of the standard 10-second post-spot persistence**. T-100 LT is a canonical Tracer Shell vehicle; current Rhm. Pzw. gameplay references likewise list Tracer Shells as part of its spotting-mechanic package.

This matches the current replay pattern precisely at the event boundary:

```text
enemy Rhm. Pzw. hit
  -> victim survives
  -> wrapper16 field3=8
  -> special spotting/debuff state is broadcast to recorder team
```

The product/gameplay-level interpretation is therefore much narrower than the old generic `damage-triggered state` hypothesis.

Current evidence grading:

```text
field3=8 = forced-spot / Tracer-Shell hit-applied state family
  behavioral identity in Rhm current corpus : PROVEN
  exact 11.19 internal enum symbol           : VERY STRONG PARTIAL

T-100 LT producer path
  gameplay mechanism                         : independently known
  current canonical replay validation        : NOT SAMPLED (0 T-100 LT vehicles)
```

Do not encode the producer as `RHM_ONLY`. The safe semantic family is **Tracer Shell / forced-spot state**; Rhm. Pzw. is simply the only Tracer-Shell producer represented in the canonical 34-arena research corpus.

## field3=1

The dominant field3=1 branch is independent from the Tracer-Shell state and is being researched separately.

Current structural facts:

```text
field3=1 records : 718
all target vehicles belong to recorder team : 718 / 718
```

A recorder-local companion relationship also exists with Avatar method19 `code=1`: all 89 current method19-code1 records identify the recorder vehicle plus an enemy entity, and each is followed ~0.1 s later by a wrapper16 field3=1 state for the recorder vehicle. This strongly suggests an observed-by-enemy / ordinary-spot-state family, but exact semantic closure is documented separately only after the remaining negative controls are complete.

Verdict for now:

```text
wrapper16 overall  = own-team vehicle visibility/special-state broadcast family — PARTIAL
field1             = vehicle/entity ID — PROVEN
field2             = constant 1 in current corpus — raw-preserve
field3=8           = Tracer-Shell / forced-spot hit-applied state family — PROVEN behavior
                       exact internal enum symbol — VERY STRONG PARTIAL
field3=1           = own-team ordinary observation/spot-state candidate — STRONG PARTIAL
```

## Historical numeric mapping warning

A historical PC `ARENA_UPDATE` table assigns numeric update 16 to `FLAG_TEAMS`. That does not fit current Blitz 11.19 behavior and remains rejected.

Numeric wrapper equality across products/versions must not override current mobile evidence.

## Product implications

- wrapper7 safely supports prebattle vehicle-ready lifecycle reconstruction.
- wrapper16 field3=8 can support AI/playback evidence that an allied vehicle was placed under a Tracer Shell / extended forced-spot state.
- do not hard-code `RHM_HIT_APPLIED_SPOTTING_STATE`; use a producer-agnostic version-gated semantic such as `TRACER_FORCED_SPOT_STATE`.
- T-100 LT should be validated immediately when a current 11.19/current-version replay sample becomes available.
