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

# field3=8 — enemy Rhm. Pzw. hit-applied special state

## Arena/tank identity closure

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

The corpus also contains five additional arenas with a Rhm. Pzw., but in all five cases that Rhm. Pzw. is on the recorder's own team:

```text
friendly-Rhm arenas : 5
field3=8 records     : 0
```

Therefore field3=8 is not a generic Rhm-presence flag. It is a recipient-side state visible to the replay client when an **enemy** Rhm. Pzw. applies its hit-related effect to the recorder's team.

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

> wrapper16 `field3=8` = **enemy Rhm. Pzw. hit-applied surviving-target special state — PROVEN behavioral identity for the current corpus**.

## Tracer Shell / forced-spot hypothesis

Current Rhm. Pzw. gameplay references describe it as carrying a spotting-oriented special-mechanic package including Tracer Shell behavior. Current Blitz Tracer Shell rules describe a hit-applied state that keeps a target spotted for an extended period, with special client indication and non-applicability on certain invalid/blind/splash cases.

The replay behavior is highly compatible:

```text
enemy Rhm hit
  -> victim survives
  -> wrapper16 field3=8
```

and the state is only broadcast for the recorder's own team, consistent with a team-visible enemy-applied spotting/debuff state.

However, the exact 11.19 wrapper enum symbol has not been recovered from a version-identical Blitz schema.

Therefore:

> `field3=8 == Tracer Shell / forced-spot active` = **VERY STRONG PARTIAL exact symbolic identity**.

Do not expose the literal enum name as protocol-guaranteed until a current schema or another tracer-equipped tank provides independent closure.

## field3=1

The dominant field3=1 branch remains unresolved at exact semantic level.

It is not simply ordinary damage: only a tiny fraction of its 718 records are damage-adjacent.

Verdict:

```text
wrapper16 overall  = vehicle special-state/event broadcast family — PARTIAL
field1             = vehicle/entity ID — PROVEN
field2             = constant 1 in current corpus — raw-preserve
field3=8           = enemy-Rhm hit-applied surviving-target state — PROVEN behavior
                       Tracer Shell/forced-spot symbolic identity — VERY STRONG PARTIAL
field3=1           = dominant vehicle state/event branch — PARTIAL
```

## Historical numeric mapping warning

A historical PC `ARENA_UPDATE` table assigns numeric update 16 to `FLAG_TEAMS`. That does not fit current Blitz 11.19 behavior and remains rejected.

Numeric wrapper equality across products/versions must not override current mobile evidence.

## Product implications

- wrapper7 safely supports prebattle vehicle-ready lifecycle reconstruction.
- wrapper16 field3=8 can support AI/playback evidence that a teammate was placed under the Rhm hit-applied special spotting/debuff state.
- until the exact symbol is recovered, user-facing text should prefer a version-gated label such as `RHM_HIT_APPLIED_SPOTTING_STATE` rather than hard-code an unsupported internal enum name.
