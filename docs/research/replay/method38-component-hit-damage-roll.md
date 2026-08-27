# Method38 component token + rawState — component-hit vs module-damage roll

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: refine the meaning of method38 repeated `(componentToken, rawState)` entries, especially `rawState=0`, using the independently closed component namespace and Type32/method16 persistent-state surfaces.

## Executive verdict

Current evidence supports a two-stage interpretation:

```text
componentToken
    = component/crew element reached by the shot-result path

rawState
    = outcome of the component damage / injury resolution
```

Observed state families:

```text
rawState=0 -> component hit/involved, but no new persistent negative state is applied
rawState=1 -> component damaged / crew injured
rawState=2 -> component critical / disabled
```

The exact internal enum name for `rawState=0` remains unknown, but its physical role is now narrowed beyond a generic "unchanged" state.

## Why module contact is not equivalent to module damage

Current Blitz gameplay mechanics allow a shell to intersect/reach an internal module without necessarily causing a persistent module-damage state: module damage is resolved separately after the hit reaches that component.

This provides the missing physical model for the current replay observations. A component token records that the component participated in the hit-result path; `rawState` records the result of the subsequent damage-state resolution.

The replay evidence independently supports this separation and does not rely on assuming every component token must become damaged.

## `rawState=0` population

Observed entries:

```text
rawState=0 : 16
```

Components:

```text
31 Engine
33 Fuel Tank
34 Right Track
35 Left Track
36 Gun
37 Turret Rotator
```

Critical negative evidence:

```text
same-clock same-token Type32 negative-state mutation : 0 / 16
crew components                                      : 0 / 16
```

Thus none of the sixteen component contacts creates an observed persistent `DAMAGED`, `CRITICAL`, or crew-injury state at that hit.

## Mixed-result hits are the strongest discriminator

Several single method38 hit-feedback records contain multiple component tokens with different `rawState` values. This proves the state is resolved per component rather than being one shot-global severity code.

Example current pattern:

```text
Gun             : rawState=0
Turret Rotator  : rawState=0
Gunner          : rawState=1
```

The same projectile therefore reaches multiple internal component/crew result paths, while only the Gunner enters a persistent negative state.

A second representative pattern contains multiple mechanical components all with `rawState=0`:

```text
Fuel Tank       : rawState=0
Left Track      : rawState=0
Turret Rotator  : rawState=0
Engine          : rawState=0
```

No corresponding persistent negative-state mutation is emitted for those modules at that hit.

These mixed outcomes strongly reject interpretations such as:

```text
rawState=0 == light/common module damage
rawState is one shot-global penetration severity
presence of componentToken == module was necessarily damaged
```

## Relationship to proven negative states

Independent method16/Type32 closure gives:

```text
rawState=1
  -> same-clock Type32 common-damage / crew-injury prefix family
  -> DAMAGED / CREW_INJURED relationship PROVEN

rawState=2
  -> same-clock Type32 critical/disabled prefix family
  -> CRITICAL / DISABLED relationship PROVEN
```

`rawState=0` is distinguished precisely by the absence of those transitions.

## Current physical model

Safe version-gated interpretation:

```text
ShotComponentResult {
    componentId
    componentName
    rawState
}

rawState=0:
    component was reached / participated in hit-resolution
    module-damage resolution did not create a new persistent negative state

rawState=1:
    ordinary persistent module damage or crew injury

rawState=2:
    critical / disabled persistent module state
```

This is a stronger model than labeling `rawState=0` simply `NORMAL`: a module can already have prior state, and the replay only proves that this hit did not newly transition it into a negative state.

## Evidence grade

```text
componentToken = component reached by hit-result path
    PROVEN relationship

rawState=0 = hit/involved component with no new persistent negative-state application
    VERY STRONG PARTIAL exact semantic

rawState=1 = damaged / crew injured
    PROVEN relationship

rawState=2 = critical / disabled
    PROVEN relationship
```

Promotion of `rawState=0` to an exact symbolic name such as `NO_DAMAGE`, `UNCHANGED`, `DEVICE_HIT_NO_DAMAGE`, or another engine enum still requires either:

1. a version-matched Blitz schema/symbol;
2. a controlled replay where a known module is deliberately intersected repeatedly and only some contacts damage it;
3. another direct state surface exposing the module-damage probability/result boolean.

## Consumer guidance

For production/UI semantics, the safe wording is:

```text
"hit/involved <module>, no new module damage observed"
```

not:

```text
"<module> damaged"
```

for `rawState=0`.

This distinction is important for AI Review and Battle Playback because a replay can show the shell reaching a module without that module actually becoming damaged.