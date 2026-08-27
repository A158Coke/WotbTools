# Method38 repeated result `rawState` — severity/state closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: Avatar method38 recorder shot-result repeated `(componentToken, rawState)` entries. Component tokens are independently proven to use the same current component-ID namespace as method16/Type32.

## Executive verdict

Current behavioral mapping:

```text
rawState=1 -> component damaged / crew injured family   PROVEN relationship
rawState=2 -> component critical / disabled family     PROVEN relationship
rawState=0 -> component involved in hit result without a newly observed persistent negative-state transition   PARTIAL exact semantic
```

Do not expose an exact user-facing symbolic enum for `rawState=0` yet.

## Independent state anchors from method16

Method16 `codeA` is independently closed for the current mechanical/crew lifecycle:

```text
mechanical codeA=4  -> common damaged / degraded operational
mechanical codeA=5  -> critical / disabled
mechanical codeA=18 -> automatic critical self-repair to damaged
mechanical codeA=19 -> full repair / clear
crew       codeA=10 -> shell-shocked / injured
crew       codeA=22 -> healed / clear
```

At the exact same clock and vehicle/component, Type32 mobile `flag=1` short bodies expose compact negative-state mutations whose suffix byte is the same component ID.

## Type32 prefix -> proven method16 state closure

Across recorder-local method16 events having a same-clock Type32 short mutation ending in the same component token:

### `codeA=4` common mechanical damage

```text
matched events : 69

a0   : 44
a180 : 22
a140 :  3
```

All 69/69 belong to the `a0/a180/a140` compact-prefix family.

### `codeA=5` critical/disabled mechanical damage

```text
matched events : 65

a4 : 34
9c : 31
```

All 65/65 belong to the `a4/9c` critical-prefix family.

### `codeA=10` crew shell-shock

```text
matched events : 24

a0   : 13
a180 : 11
```

Thus the common `a0/a180` mutation family is shared by ordinary mechanical degraded states and crew-injury states, while `a4/9c` is the current critical mechanical branch.

This gives a current-version behavioral decoder for the Type32 prefix families independently from method38.

## Method38 `rawState=1`

For method38 repeated result entries having a same-clock Type32 short mutation on the same victim and component token:

```text
matched entries : 74

a0   : 53
a180 : 18
a140 :  2
a1e0 :  1
```

The independently proven common-damage / crew-injury prefixes account for:

```text
73 / 74
```

The sole `a1e0` variant is a track-family presentation variant and does not provide a contradictory persistent-state signature.

The complete method38 rawState=1 token population includes both:

- mechanical modules; and
- proven crew components 39/40/41/43.

Verdict:

> `rawState=1` = **component damaged / crew injured negative-state family — PROVEN current relationship**.

Exact internal enum naming remains version-scoped.

## Method38 `rawState=2`

Same-clock Type32 matches:

```text
matched entries : 57

a4   : 29
9c   : 26
a580 :  1
9d80 :  1
```

The independently proven critical/disabled prefixes account for:

```text
55 / 57
```

The two remaining values are track-specific extended variants:

```text
a580  token 34 Right Track
9d80  token 35 Left Track
```

They preserve the same critical-track family and do not provide a counterexample to severity identity.

The rawState=2 population is concentrated in critical-capable mechanical modules, especially the two tracks and Observation Device.

Verdict:

> `rawState=2` = **critical / disabled component state family — PROVEN current relationship**.

## Method38 `rawState=0`

Current population:

```text
entries : 16
components:
31 Engine
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
```

Important negative evidence:

```text
same-clock same-token Type32 negative-state mutation : 0 / 16
crew components                                      : 0 / 16
```

Context scans also show that some of these vehicles receive a real `a0/a4` mutation for the same component only much earlier or later, rather than at the rawState=0 hit itself.

Therefore rawState=0 does not represent a newly entered common-damaged or critical state in the current samples.

The safest current interpretation is:

> the component participated in the shot-result / hit-resolution path but no new persistent negative module state is observed at that hit.

Plausible exact internals include:

- component hit/pierced but damage-state check did not transition;
- unchanged/normal component result;
- presentation-only component involvement.

These are hypotheses only. Do not rename `0` to `NORMAL`, `NO_DAMAGE`, or `PIERCED_ONLY` until one is independently closed.

Verdict:

> `rawState=0` = **non-transition / no newly observed persistent negative-state family — PARTIAL exact semantic**.

## Complete observed rawState population

Across method38 repeated result entries in the canonical corpus:

```text
rawState=0 : 16
rawState=1 : 82
rawState=2 : 32
```

The higher number of same-clock Type32 matches for rawState=2 than unique method38 rawState=2 entries occurs because one result entry can align with multiple related compact presentation mutations at the same clock; cardinalities must not be interpreted as one-to-one transport identity.

## Safe production model

```text
ShotComponentResult {
    componentId
    componentName       // version-gated from proven current component namespace
    rawState
    severityFamily
    exactStateName
    confidence
}

rawState=0:
    severityFamily = COMPONENT_RESULT_NO_NEW_NEGATIVE_STATE
    exactStateName = null
    confidence     = PARTIAL

rawState=1:
    severityFamily = DAMAGED_OR_CREW_INJURED
    confidence     = PROVEN_RELATIONSHIP

rawState=2:
    severityFamily = CRITICAL_OR_DISABLED
    confidence     = PROVEN_RELATIONSHIP
```

Consumers must retain `rawState` even for proven severity families.

## Product value

This allows AI Review / Battle Playback to distinguish, with current-version evidence:

```text
hit a module without a proven new negative state
vs
module damaged / crew injured
vs
module critically disabled
```

without inventing unsupported exact internal enum names.

## Remaining work

1. recover a version-matched Blitz symbol/schema for exact rawState enum names;
2. controlled probe a shell that visibly passes through a module but does not damage it, to close rawState=0;
3. verify whether rawState=0 means NORMAL/UNCHANGED or a distinct penetration-only result;
4. validate rawState families outside Blitz 11.19 China.