# Settlement field118 / Avatar method12 baseType12 — closed unknown boundary

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Goal: determine whether the current corpus can uniquely name settlement PlayerResultsInfo field118 and the correlated Avatar method12 `baseType=12` battle-feedback family.

## Executive verdict

The current corpus proves that the two surfaces belong to the same gameplay-stat family, but **does not contain enough independent variation to uniquely identify the exact gameplay statistic**.

Current safe grade:

```text
method12 baseType12          -> gameplay-stat/ribbon progression family  PROVEN relationship
settlement field118          -> final statistic from same family         PROVEN relationship
exact symbolic statistic     -> UNKNOWN, current corpus exhausted
old base-defend/dropped-base -> REJECTED/SUPERSEDED
```

This is a **closed UNKNOWN boundary**, not an uninvestigated field. It no longer blocks research-complete status for the current corpus.

## Current author-level population

Across 34 replay authors:

```text
arenas with method12 baseType12 : 10 / 34
arenas with settlement field118 : 10 / 34
presence mismatch               : 0 / 34
```

Thus:

```text
baseType12 present iff field118 present
```

for every current author.

The 10 settlement values are:

```text
12
20
32
34
48
67
103
124
124
195
```

The matching method12 bodies always have:

```text
value = 0
```

while `count` is a small progression counter:

```text
1, 2, or 3
```

One arena emits the sequence:

```text
count 1
count 2
count 3
```

with final field118 still equal to `124`.

Therefore field118 is **not** a copy of method12 `count` or `value`.

## Exact observed author samples

```text
field118  method12 tier/count sequence
34        tier0 count1
67        tier0 count1
12        tier0 count1
32        tier0 count1
103       tier0 count1
124       tier0 count1 -> count2 -> count3
20        tier0 count1
124       tier1 count1
195       tier1 count1
48        tier0 count2
```

This also disproves a simple mapping from `tierRaw` to field118 magnitude: the same field118 value `124` occurs with different method12 tiers.

## Why the old base-defense interpretation is rejected

An earlier hypothesis labeled this family as base defended / dropped capture points.

That interpretation was rejected after current 11.19 mode/control analysis because:

- presence/value behavior does not follow the required capture/defense state machine;
- the same field118 value appears under different method12 `tierRaw` states;
- method12 baseType12 always carries `value=0`, unlike the proven cumulative damage/blocked/assist value families;
- current Supremacy capture behavior is already independently exposed by wrapper12 and settlement victory-point fields and does not provide the required one-to-one closure.

The old label must not be restored merely because historical WoT result schemas contain capture/defense statistics.

## Combat-event timing test

The 12 current baseType12 emissions were joined against recorder method38 hit feedback.

They do not form a unique direct-hit rule:

- some occur roughly 2–4 seconds after a damaging hit;
- others occur with substantially larger gaps;
- nearby hits include ordinary penetration-like events, module-result events, and terminal events;
- no single method38 flag, module token, kill, fire, or observed HP-delta class explains all emissions without counterexamples.

Therefore baseType12 cannot safely be renamed as a hit, penetration, critical, kill, fire, or module statistic from the current event timing alone.

## Settlement cross-field test

field118 was compared against currently known PlayerResultsInfo fields including:

```text
shots / hits / penetrations
damage dealt
assist subtypes
hits received
penetrations received
enemies damaged
enemies destroyed
victory-point fields
damage blocked
field119 destruction assistance
field120 Gun Marks count
```

No deterministic equality, ratio, sum, or presence rule uniquely identifies field118.

The field is sparse across the complete 476-player result population and has its own independent value domain.

## External parser/schema cross-check

A public WoT Blitz replay parser with an explicit `PlayerResultsInfo` protobuf model currently assigns known tags such as:

```text
117 -> damage_blocked
```

but does **not** assign tag118 a semantic field in its typed model.

This does not prove field118 is unknowable, but it is useful negative evidence that there is no obvious stable public tag118 identity suitable for blind import.

Historical PC/WoT field tables are not authoritative for current Blitz 11.19.

## What would close the field

Any one of the following can legitimately promote the exact identity:

1. a version-matched Blitz 11.19 protobuf/schema or client symbol naming tag118 and the corresponding battle-feedback event;
2. controlled battles where exactly one candidate statistic is varied while all competing candidates remain constant;
3. a larger corpus containing clean positive and negative contrasts for the candidate mechanic;
4. an independently decoded UI battle-feedback/ribbon symbol linked to method12 baseType12.

Until then, more correlation mining over these same 10 positive author samples is unlikely to produce a unique answer.

## Safe consumer model

```text
BattleFeedbackBase12 {
    tierRaw
    count
    valueRaw = 0
    semantic = null
    confidence = UNKNOWN_EXACT_SEMANTIC
}

SettlementField118 {
    rawValue
    relatedToBaseType12 = true   // current-version proven relationship
    semantic = null
}
```

Do not drop either field. Preserve raw values for future version/schema closure.

## Research-complete consequence

The replay-research completion contract requires every observed surface to be either:

- semantically proven/approved partial; or
- explicitly bounded as UNKNOWN with raw preservation, rejected hypotheses, and a concrete closure requirement.

field118/baseType12 now satisfies the second category.
