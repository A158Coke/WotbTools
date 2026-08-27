# Recovery-consumable discriminator — crew vs module vs fire

> Corpus: strict 34 unique-arena Blitz 11.19 China replay set.
>
> This note records the recovery-consumable discriminator used to classify negative-state families. It has been updated to incorporate the later method16/Type32/prop8 namespace closures; earlier text that kept crew tokens merely as candidates is superseded.

## Gameplay behavior used as discriminator

For the current Blitz behavior model:

- `0x0B` Multi-Purpose Restoration Pack clears **all negative effects**: crew injury, module negative states and fire;
- `0x0C` First Aid Kit clears **injured crew only**;
- `0x0D` Repair Kit clears **module negative states only** and does not heal crew or extinguish fire.

This gives three supervised recovery classes:

```text
cleared by 0x0B + 0x0C, not 0x0D -> crew-injury state
cleared by 0x0B + 0x0D, not 0x0C -> module negative state
terminated by 0x0B, not 0x0C/0x0D -> fire family
```

The rule is evidence guidance, not permission to infer a state from timing alone: one hit can create multiple simultaneous negative effects.

## Crew namespace — now PROVEN for current 11.19

Later current-corpus work closed the crew recoverable-token namespace against same-clock Avatar method16 component IDs and role-specific physical effects.

Current identities:

```text
0x27 / 39 = Commander  PROVEN
0x28 / 40 = Driver     PROVEN
0x29 / 41 = Gunner     PROVEN
0x2B / 43 = Loader     PROVEN
```

At injury onset, method16 and Type32 short nested mutations align on the same vehicle and clock using numerically identical component IDs:

```text
method16 codeB=39 <-> Type32 token 0x27
method16 codeB=40 <-> Type32 token 0x28
method16 codeB=41 <-> Type32 token 0x29
method16 codeB=43 <-> Type32 token 0x2B
```

These are not inferred from historical PC ordering. They are current-Blitz closures:

- Commander: loss of commander bonus causes a small cross-role reload degradation;
- Driver: exhaustive four-role closure plus mobility-compatible behavior;
- Gunner: strong turret-yaw suppression and worsened aiming/dispersion behavior;
- Loader: strong reload-speed degradation.

First Aid / MPRP removes these shell-shock states; Repair Kit does not.

## Prop8 — mixed recoverable-state collection

Vehicle `prop8` is a count-prefixed full byte-list snapshot:

```text
count : u8
tokens[count] : u8
```

Later evidence shows that prop8 can contain proven crew tokens as well as mechanical/recoverable tokens. Therefore the earlier statement that prop8 is not a crew-state surface is superseded.

The correct current conclusion is:

> Vehicle `prop8` = **mixed recoverable negative-state collection — PROVEN structural role / PARTIAL complete token namespace**.

For the proven crew subset:

```text
0x27 COMMANDER_SHELL_SHOCKED
0x28 DRIVER_SHELL_SHOCKED
0x29 GUNNER_SHELL_SHOCKED
0x2B LOADER_SHELL_SHOCKED
```

Do **not** generalize this into `every prop8 byte == method16 codeB`. Prop8 contains a broader mixed state collection; only independently closed tokens should be named.

## Repair Kit vs First Aid vs MPRP negative control

A particularly strong mixed-state control is that Repair Kit can clear a simultaneous mechanical state while leaving a proven crew token behind.

Examples already archived elsewhere include:

```text
Rift:
  mechanical state
  Loader shell-shock (0x2B)
  Repair Kit -> prop8 still [0x2B]
  later MPRP -> prop8 []

Karelia:
  mechanical state
  Driver shell-shock (0x28)
  Repair Kit -> prop8 still [0x28]
```

This independently validates both the consumable discriminator and the crew-token classification.

## Mechanical family

Current method16 mechanical component namespace:

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           STRONG PARTIAL
34/35 Track-side pair  PROVEN family / side PARTIAL
36 Gun                 STRONG PARTIAL
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  STRONG PARTIAL
```

Mechanical lifecycle states currently closed:

```text
codeA=4  common damaged / degraded operational
codeA=5  critical / disabled
codeA=18 automatic critical self-repair -> degraded operational
codeA=19 fully repaired / cleared
```

The `0x0D` Repair Kit / `0x0B` MPRP discriminator remains useful for closing `33/36/38`, but exact component identity still requires an independent physical signature.

## Fire family

Type32 mobile short `...04` is independently closed as fire-associated through periodic HP-loss sequences and settlement fire deaths.

Observed behavior remains:

- `0x0D` Repair Kit does not stop the fire-DOT sequence;
- `0x0C` First Aid Kit is not a fire clear;
- `0x0B` MPRP acts as the all-purpose restoration positive control and extinguishes the fire family.

Thus fire remains a distinct negative-state class rather than a module/crew token.

## Safe decoding guidance

```text
NegativeStateEvidence {
    entityId
    rawClockSec
    surface        // prop8 / Type32 short / method16 / hit-result list
    tokenRaw
    stateRaw
    class          // CREW / MODULE / FIRE / UNKNOWN
    exactName      // nullable, version-gated
    confidence
}
```

Safe current rules:

- expose the four closed crew identities above;
- expose only PROVEN mechanical identities by exact name;
- retain `33/36/38` as PARTIAL candidates;
- preserve all raw values and version gating;
- never infer a component solely from one nearby consumable activation.

## Remaining work

1. physically close `36` Gun using targeting/dispersion impairment and Repair Kit restoration;
2. close `38` Observation Device using view-range/spotting or a version-matched schema;
3. close `33` Fuel Tank without relying only on ignition probability;
4. map the remaining prop8 / Type32 mechanical tokens while preserving the mixed-collection model;
5. validate token stability outside Blitz 11.19 China.
