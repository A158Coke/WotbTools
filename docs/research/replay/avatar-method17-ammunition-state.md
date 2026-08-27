# Avatar method 17 — recorder ammunition state/update family

> Corpus: strict-framing 34 unique arenas, Blitz 11.19.0 China.
>
> Numeric method IDs are entity-class and version scoped.

## Executive verdict

Avatar method 17 is no longer UNKNOWN.

The current 12-byte body carries recorder ammunition state. Every recorder projectile launch has a same-clock method17 update, and the observed quantity byte decrements exactly as shells are fired.

Verdict:

> `Avatar method17` = **recorder ammunition inventory/update family — PROVEN behavioral identity**.

The complete 12-byte initialization/state schema remains PARTIAL; production should preserve the raw trailing fields until every variant is closed.

## Corpus counts

```text
method17 total : 2,128
body length    : 12 bytes for 2,128 / 2,128
```

The first four bytes form a stable ammunition/item compact-descriptor-like value. It is not a vehicle entity ID.

## Shot-level closure

Recorder projectile identity is inferred independently through method29 shooter IDs and settlement shot counts.

Across the strict corpus, every recorder method29 projectile launch has method17 at the same replay clock.

The normal firing-time variant is structurally very clean:

```text
shell/item descriptor : u32 LE  // args[0..4)
args[4]               : 0
remainingQuantity     : u8      // args[5]
args[6..12)           : 00 00 00 00 00 00
```

All normal shot-correlated method17 records use this shape.

## Direct decrement example

One real replay contains the following same-shell sequence at recorder shot clocks:

```text
shell 0x003B5A0A : quantity 9
shell 0x003B5A0A : quantity 8
shell 0x003B5A0A : quantity 7
shell 0x003B5A0A : quantity 6
shell 0x003B5A0A : quantity 5
shell 0x003B5A0A : quantity 4
shell 0x003B5A0A : quantity 3
shell 0x003B5A0A : quantity 2
shell 0x003B5A0A : quantity 1
shell 0x003B5A0A : quantity 0
```

The values occur exactly on recorder projectile-launch clocks.

The same replay then switches to another descriptor and continues decrementing that descriptor's quantity.

## Depletion / switch boundary

The one observed shot clock with two method17 updates is especially informative:

```text
old shell descriptor -> remaining quantity 0
next shell descriptor -> remaining quantity 16
```

This is exactly the expected boundary when one ammunition type is exhausted and another ammunition state is immediately surfaced.

It independently supports both:

- `args[0..4)` as ammunition/item descriptor identity;
- `args[5]` as current remaining shell quantity in the normal firing variant.

## Initialization variants

Early-battle method17 records contain additional non-zero bytes in the remaining eight bytes, for example values resembling:

```text
<descriptor> 00 01 00 01 FF FF 00 00
<descriptor> 00 01 00 02 0F 00 0F 00
```

These are clearly part of the broader ammunition/feed initialization schema, but exact meanings such as clip count, magazine state, autoreloader stage, next-shell state, or capacity have not been closed across vehicle types.

Do not force the firing-time `remainingQuantity` interpretation onto every initialization variant without field-state gating.

## Relationship to other shot telemetry

Safe current chain:

```text
method17 ammunition state
        |
        | same recorder shot clock
        v
Vehicle method0 showShooting
        |
        v
Avatar method29 projectile launch
        |
        v
Avatar method20 stopTracer endpoint
```

Method17 therefore supplies the ammunition-inventory side of an already independently proven projectile lifecycle.

## Safe consumer model

```text
AmmunitionStateEvent {
    rawClockSec
    itemDescriptorRaw
    remainingQuantity?   // proven for normal firing variant
    variantRaw[8]
    source = AVATAR_METHOD17
}
```

Safe uses:

- track observed remaining ammunition by descriptor for the recorder;
- detect exact shell-descriptor changes around shots;
- improve AI Review with evidence such as ammunition exhaustion/switching once descriptor-to-shell-type mapping is version-gated;
- cross-check the independently recovered ammunition-slot telemetry.

Unsafe until further closure:

- name descriptor values as AP/APCR/HE without version-matched item data;
- interpret every initialization byte as clip/autoreloader state;
- assume this Avatar method exposes every vehicle's ammo inventory rather than the recorder-local feed state.

## Remaining work

1. map current shell descriptors to version-matched Blitz ammunition definitions;
2. decode the non-zero initialization/feed tail fields;
3. correlate the state with clip/autoreloader vehicles and the already documented reload/feed telemetry;
4. validate descriptor and quantity semantics on other client versions.
