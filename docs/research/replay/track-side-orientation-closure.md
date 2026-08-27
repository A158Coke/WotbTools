# Method16 codeB 34/35 — exact track-side orientation closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: close the final unresolved left/right orientation of the already-proven method16 track pair `codeB=34/35` using current replay hit geometry rather than historical enum ordering.

## Executive verdict

Current Blitz 11.19 mapping:

```text
codeB=34 -> RIGHT_TRACK  PROVEN
codeB=35 -> LEFT_TRACK   PROVEN
```

This orientation is closed from three independent pieces of evidence:

1. `34/35` are already proven to be the symmetric track-module pair from movement impairment and repair lifecycle;
2. recorder method38 track-result tokens use the same current component-ID namespace as method16;
3. same-clock Vehicle method8 hit geometry carries a compact BigWorld local-space segment whose X coordinate cleanly separates the two IDs, and BigWorld's documented local coordinate system defines +X as vehicle-left.

## Vehicle method8 21-byte shot-hit body

For all 295 recorder-hit method38 events in the canonical corpus, the same-clock victim Vehicle method8 main body is 21 bytes.

The first eight bytes are independently closed identity fields:

```text
attackerEntityId : u32 LE
victimEntityId   : u32 LE
```

The remaining 13-byte payload is not a float vector. It matches the historical/current BigWorld compact hit-segment architecture:

```text
count : u8          // current samples: 1
segment : u64 LE
remaining effect/presentation bytes
```

For the encoded `segment`, Wargaming `helpers_common.encodeSegment()` uses:

```text
bits  0..7   context/effect data
bits  8..15  collision component index
bits 16..23  segment start local X, quantized 0..255
bits 24..31  segment start local Y
bits 32..39  segment start local Z
bits 40..47  segment end local X
bits 48..55  segment end local Y
bits 56..63  segment end local Z
```

`decodeSegment()` reconstructs the points from the target component bounding box.

Therefore method8 contains target-local hit-ray geometry, not arbitrary presentation bytes.

## Current track-hit sample population

Select method38 recorder hit-feedback records whose structured result list contains:

```text
0x22 = decimal 34
0x23 = decimal 35
```

Current sample counts:

```text
component 34 track-result hits : 46
component 35 track-result hits : 25
```

Join each record to the same-clock victim Vehicle method8 body and decode the segment-start local-X quantized byte.

### Component 34

```text
n               : 46
median start-X  : 0
start-X <= 64   : 40 / 46
start-X >= 191  : 1 / 46
```

The hit ray overwhelmingly enters from the target bounding box's minimum-X side.

### Component 35

```text
n               : 25
median start-X  : 255
start-X <= 64   : 0 / 25
start-X >= 191  : 25 / 25
```

All 25 samples enter from the target bounding box's maximum-X side.

This is a near-perfect mirrored spatial discriminator between the two already-proven track IDs.

## Independent world-space cross-check

At the exact hit clock, Type10 provides both attacker and victim positions plus victim hull yaw.

Using the BigWorld yaw convention to transform attacker-victim displacement into the victim's hull-relative lateral axis produces the same directional separation:

```text
component 34 samples : 39 / 46 attackers on the corresponding min-X side
component 35 samples : 25 / 25 attackers on the corresponding max-X side
```

The few component-34 opposite-side attacker positions are physically expected for oblique/cross-body trajectories; the encoded collision ray itself is the authoritative local hit-side evidence.

## BigWorld coordinate orientation

BigWorld's client programming documentation defines a left-handed coordinate system:

```text
+X -> left
+Y -> up
+Z -> forward
```

Thus, within vehicle-local coordinates:

```text
minimum X -> vehicle right side
maximum X -> vehicle left side
```

Combining that coordinate convention with the current replay's measured hit-segment distributions yields:

```text
34 -> minimum-X track -> RIGHT TRACK
35 -> maximum-X track -> LEFT TRACK
```

## Verdict

> `codeB=34 = Right Track` — **PROVEN current Blitz 11.19 geometric identity**.

> `codeB=35 = Left Track` — **PROVEN current Blitz 11.19 geometric identity**.

This does not rely on historical component enum ordering. Historical/current BigWorld code is used only to decode the hit-segment wire geometry and coordinate convention; the side assignment itself is measured from current 11.19 replay hits.

## Consequences

The complete observed mechanical method16 component domain is now fully oriented:

```text
31 Engine
32 Ammo Rack
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
38 Observation Device
```

All are PROVEN for the current 11.19 evidence model, subject to version gating.

Method38 repeated result tokens can use the same exact mapping because their component namespace is independently closed against method16/Type32.

## Additional protocol value

Decoding Vehicle method8's compact hit segment opens two further research paths:

1. reconstruct target-local impact rays/locations for Battle Playback / AI Review;
2. test method38 `0x0008` ricochet candidates against actual local impact geometry and future armor-model normals.

Exact semantics of the remaining post-segment method8 presentation bytes remain PARTIAL and should be preserved raw.
