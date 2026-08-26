# Low-frequency / control packet inventory

> Corpus: 44 replay files / 34 unique arenas, Blitz 11.19.0 China.
>
> This chapter exists because low-frequency control packets are easy to misclassify as noise. The current corpus was parsed with **strict contiguous framing**; zero-length packets are legal and no byte-by-byte resynchronization was used.

## Strict-framing prerequisite

The real observed top-level packet-type set is:

```text
0,1,2,4,5,7,8,10,11,13,14,17,23,26,28,29,31,32,33,35,36,39,0xFFFFFFFF
```

A prior reader rule treating `payloadLen <= 0` as malformed is invalid for this corpus because Type 17 is a legitimate zero-payload packet. Rejecting it shifts the cursor into packet headers and manufactures fake large packet-type IDs.

Allowing `payloadLen == 0` yields 44/44 streams that parse contiguously from the header to the terminator with no resynchronization.

## Type 14

Corpus facts:

```text
count        = 44 (exactly one per replay)
payload len  = 1
payload      = 00 in 44/44
clock range  ≈ 165–413 s
```

It occurs late in the replay and is strongly end-of-session/battle-adjacent, but this corpus does not independently establish its method/event name.

Verdict: `PROVEN structure / PARTIAL end-marker family`.

Do not equate Type14 itself with server battle finish time: the authoritative result layer has `finishReason`, duration and AFTERBATTLE period evidence, and client stream delivery can lag/omit transitions.

## Type 17 — legal zero-length packet

Corpus facts:

```text
count        = 44 (exactly one per replay)
payload len  = 0
clock range  ≈ 1.7–7.3 s
```

The crucial result is structural, not semantic:

> **Zero-length replay packets are legal.**

This invalidates parser code that treats `length == 0` as framing corruption.

Type17's exact semantic name remains `UNKNOWN`; its early timing indicates initialization/control rather than battle physics.

Verdict: `PROVEN framing fact / UNKNOWN semantic`.

## Type 29

Corpus facts:

```text
count        = 176 = exactly 4 per replay
payload len  = 1
payload      = 01 in 176/176
clock range  ≈ 0–7.7 s
```

The fixed multiplicity, fixed payload and early timing prove a deterministic initialization/control sequence. No user-facing semantic name is justified yet.

Verdict: `PROVEN structure / UNKNOWN semantic`.

## Type 36

Corpus facts:

```text
count        = 44 (exactly one per replay)
payload len  = 4
clock        ≈ 0–0.23 s
value        = variable u32-sized payload
```

This is an early session/initialization value. It is not a battle-start marker; active battle begins substantially later and is independently represented by arena-period `BATTLE` transition evidence.

Verdict: `PROVEN structure / UNKNOWN semantic`.

## Type 28 — recorder-local three-state control

Corpus facts:

```text
count       = 460
payload len = 4
u32 values  = 0 (224), 1 (204), 2 (32)
clock       ≈ 8.4–406 s
```

Unlike Types 17/29/36, Type28 spans active battle and behaves as a small recorder-local state/control value.

### Correlation with firing

Distance to the nearest recorder Type23 firing/projectile event:

```text
value 0 : median |Δt| ≈ 2.37 s; 88.8% within 5 s
value 1 : median |Δt| ≈ 1.26 s; 91.2% within 5 s
value 2 : median |Δt| ≈ 0.67 s; 100% within 5 s; 81.25% within 2 s
```

The relationship is strong enough to classify Type28 as a firing/weapon-control-adjacent state, but not strong enough to distinguish among hypotheses such as:

- shell/ammunition slot selection;
- aiming/control mode;
- weapon/gun state;
- another recorder-only combat UI/control state.

Different recorder vehicles show different transition patterns (e.g. repeated `1↔0`, `2↔0`, occasional use of all three states), which is compatible with several hypotheses.

Verdict: `PARTIAL firing/weapon-control-adjacent three-state value`; exact semantic `UNKNOWN`.

No production decoder should expose `0/1/2` as a shell type or aiming mode until an independent client schema or controlled replay closes the mapping.

## Stream terminator `0xFFFFFFFF`

Corpus facts:

```text
type         = 0xFFFFFFFF
count        = 44 (exactly one per replay)
payload len  = 16
clock        = 0
payload      = b7b1e314614cf326c6e2b6eba1540682 in 44/44
```

This is the deterministic stream terminator/signature for the current corpus.

Verdict: `PROVEN current-version stream terminator`.

The constant payload is version-scoped; parsers should not assume it is immutable across all future Blitz versions without revalidation.

## Research implications

1. Framing validity must be decided from length/bounds and known terminator rules, not from `length > 0`.
2. Low-frequency packet semantics must be kept separate from framing semantics.
3. Early deterministic controls (17/29/36) are poor battle-start candidates.
4. Type28 is high-value for recorder weapon-state reconstruction but remains deliberately unnamed.
5. Any future corpus introducing a new top-level type must enter this inventory as `UNKNOWN` before being assigned a semantic.
