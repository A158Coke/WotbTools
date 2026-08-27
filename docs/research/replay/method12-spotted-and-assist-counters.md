# Avatar method12 — spotted and cumulative feedback counters

> Corpus: 34 unique Blitz 11.19.0 China arenas.
>
> This note records the method12 counter families that are already behaviorally closed, plus the unresolved distinction between baseType15 and wrapper6 kill-feed assistance.

## Wire shape

Current Avatar method12 uses a fixed 6-byte body:

```text
eventCode : u16 LE
count     : u16 LE
value     : u16 LE

baseType = eventCode & 0xFF
tierRaw  = eventCode >> 8
```

`eventCode` high byte changes at feedback/ribbon progression boundaries and must not be mistaken for a different base event type.

## baseType2 — enemies spotted

For every arena where baseType2 is emitted, its final count equals PlayerResults field16 exactly.

```text
final baseType2.count == settlement field16
15 / 15 arenas with non-zero observations
```

Across the realtime stream, all 25 baseType2 count updates occur immediately around an enemy Type5 vehicle-visibility entry. 24/25 are the first observed entry of that enemy vehicle in the entire replay; the remaining sample sits on a visibility transition boundary.

The same field also occupies the expected result-layout position immediately before enemies-damaged and enemies-destroyed counters.

Verdict:

> method12 baseType2 = **cumulative enemies spotted — PROVEN current corpus**
>
> PlayerResults field16 = **enemies spotted — PROVEN current corpus**

This is a recorder contribution counter, not a count of every enemy that happened to become visible through team spotting; ordinary enemy re-entry does not necessarily increment it.

## baseType3 — kills

Final count closes to PlayerResults field18 / recorder kills.

Verdict: **cumulative kills — PROVEN**.

## baseType1 / 5 / 17

Previously closed relations:

```text
baseType1  -> cumulative damage dealt
baseType5  -> cumulative damage blocked
baseType17 -> cumulative total assist damage
               = assist subtype 1 + assist subtype 2
```

These are UI/battle-feedback mirrors of independently proven live/settlement counters.

## baseType6

Two current samples align one-for-one with method38 FIRE_STARTED feedback.

Verdict: **enemy ignition / set-on-fire counter — PROVEN on current samples, PARTIAL globally due sample size**.

## baseType8 / 16

Current behavior strongly separates the two directions:

```text
baseType8  -> critical/module result inflicted family
baseType16 -> critical/device-damage received family
```

Exact user-facing counter names remain PARTIAL.

## baseType15 and PlayerResults field119

A separate exact relation is already proven:

```text
final method12 baseType15.count == PlayerResults field119
34 / 34 arenas including zero-by-absence
```

Realtime baseType15 increments cluster after allied destruction of enemy vehicles for which the recorder had prior combat involvement. However it is **not identical** to wrapper6 field3.

Important distinction:

- wrapper6 field3 is an optional participant/entity attached to a specific vehicle-killed record and is now a strong kill-feed assister candidate;
- method12 baseType15 is a cumulative recorder feedback counter;
- many baseType15 increments occur when wrapper6 field3 is another player, so the two surfaces must not be merged.

The exact qualification rule for baseType15 / field119 remains PARTIAL.

## Controlled validation target

A later controlled corpus should independently vary:

1. non-killer damage share to the victim;
2. whether the non-killer appears by name in the kill notification;
3. wrapper6 field3;
4. method12 baseType15 increment;
5. settlement field119.

This will determine whether field119 is a separate assisted-destruction/ribbon counter, a broader combat-contribution counter, or another kill-related feedback class.
