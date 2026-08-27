# Method38 special-modifier list — Precision Fire / Tungsten closure

> Base corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Additional controlled probes include recorder-owned Tungsten hits and a Jagdpanzer controlled battle where the fourth shot triggered Precision Fire while Tungsten was still active.
>
> Numeric values are current Blitz 11.19 evidence and remain version-gated.

## Executive verdict

The former `variantTail` interpretation is superseded.

Current wire behavior proves that the byte after the repeated `(componentToken, rawState)` list is a **special-modifier count**, followed by that many `u32 LE` modifier IDs:

```text
victimVehicleId : u32 LE
headerFlags     : u32 LE
resultCount     : u8
repeat resultCount:
    token       : u8
    rawState    : u8
modifierCount   : u8
repeat modifierCount:
    modifierId  : u32 LE
```

Controlled current mapping:

```text
modifierId = 1 -> Precision Fire proc   PROVEN current behavior
modifierId = 2 -> Tungsten Shells shot PROVEN current behavior
```

A single shot may contain multiple modifier IDs.

## Decisive combined controlled probe

Replay metadata:

```text
version  = 11.19.0_china_apple
vehicle  = G112_JagdPanzer_105
arenaId  = 55719776455008280
```

The recorder activates Tungsten before the first tested hit and the effect remains active through all four hits.

Observed method38 records:

```text
28.723053s
flags         = 0x0030
resultCount   = 0
modifierCount = 1
modifiers     = [2]

33.425980s
flags         = 0x0010
resultCount   = 0
modifierCount = 1
modifiers     = [2]

38.119728s
flags         = 0x0010
resultCount   = 0
modifierCount = 1
modifiers     = [2]

42.921677s
flags         = 0x0010
resultCount   = 0
modifierCount = 2
modifiers     = [1, 2]
```

The fourth shot is the user-controlled Precision Fire proc while Tungsten is still active.

This directly rejects all of the following models:

```text
one mutually-exclusive extension enum
Precision Fire overriding Tungsten
Tungsten overriding Precision Fire
combined value 3
opaque one-off extended variant
```

The protocol instead carries an additive list of active shot-result modifiers.

## Tungsten state closure

The same replay shows the recorder-side Tungsten effect transition before the tested shots and its end after them. All four tested hits occur inside the active window.

The first three hits carry exactly:

```text
[2]
```

The fourth hit, where Precision Fire also procs, carries:

```text
[1, 2]
```

Together with the earlier independent VK 72.01 Tungsten sample, this is sufficient to promote:

> `modifierId=2 = Tungsten Shells shot/result provenance` — **PROVEN current 11.19 behavior**.

The exact private Wargaming enum symbol remains unknown.

## Precision Fire closure

The canonical corpus previously supplied 13 `modifierId=1` samples:

- 12 non-HE samples were exact maximum damage or HP-capped terminal results;
- one FV215b HE-family sample was compatible with HE post-processing after a Precision Fire proc.

The combined controlled probe now supplies a stronger causal discriminator: on the fourth shot, while Tungsten remains active, a new modifier is added rather than replacing Tungsten:

```text
previous Tungsten shots : [2]
Precision Fire + Tungsten: [1,2]
```

Therefore:

> `modifierId=1 = Precision Fire proc` — **PROVEN current 11.19 behavior**.

The exact private enum symbol remains unknown.

## HP evidence in the combined probe

Authoritative target HP transitions at the four method38 clocks are:

```text
28.723053s -> HP 2326
33.425980s -> HP 2011
38.119728s -> HP 1660
42.921677s -> HP 1222
```

Observed losses between the visible states are consistent with all four being real damaging hits. The fourth shot is the user-labeled maximum-damage Precision Fire proc and is the only shot that adds modifier `1`.

The modifier-list proof does not depend on deriving the vehicle's private damage-roll formula from these HP numbers.

## FV215b HE boundary retained

The current FV215b HE-family `modifierId=1` sample remains valid evidence rather than a counterexample. Precision Fire selects the maximum-damage branch, while final HE damage can still be altered by HE penetration/explosion resolution.

Do not require final observed HE HP loss to equal `averageDamage * 1.25` before recognizing modifier `1`.

## Forced low-HP Precision Fire rule

A gameplay rule supplied during protocol research states that an eligible Precision Fire shot is guaranteed when the target HP is below the shell's ordinary minimum roll.

This branch is still not independently controlled in replay evidence. It is no longer needed to identify modifier `1`, but remains a separate gameplay-rule probe target.

## Production-safe model

```text
ShotResultSpecialModifiers {
    count
    rawIds[]
    decoded[]
}

1 -> PRECISION_FIRE_PROC
2 -> TUNGSTEN_SHELLS
```

Decoder rule:

```text
modifierCount = byte after repeated result pairs
for i in 0..<modifierCount:
    modifierId = u32 LE
```

Do not model this field as a single nullable `extensionRaw` value.

Unknown future modifier IDs must be preserved raw rather than rejected.

## Superseded conclusions

```text
variantTail is an opaque tail byte                         SUPERSEDED
optional extension is exactly one u32                     SUPERSEDED
extension=2 is only a Tungsten candidate / n=1            SUPERSEDED
extension IDs are mutually exclusive                       REJECTED
Precision Fire and Tungsten cannot coexist in one result  REJECTED
```

## Remaining work

1. recover the exact current private enum/type names for modifier IDs;
2. obtain controlled samples for any additional modifier IDs if they appear;
3. test the forced low-HP Precision Fire gameplay branch independently;
4. validate the same modifier-list schema on future client versions before widening numeric support.
