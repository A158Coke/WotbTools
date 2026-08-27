# Avatar method38 — component-result token namespace closure

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas.
>
> Scope: the repeated `(token, rawState)` list inside recorder Avatar method38 shot-result feedback.

## Executive verdict

The method38 result `token` field is no longer an anonymous critical/module token.

Current evidence closes it to the same version-scoped component-ID namespace used by Avatar method16 and the corresponding Type32 nested recoverable/damage state surface:

> **method38 result token = current component ID — PROVEN relationship for Blitz 11.19 China.**

Exact `rawState=0/1/2` semantics remain separately evidence-gated.

## Exact observed domain match

Across all non-empty method38 result lists, the token domain is exactly:

```text
31, 32, 33, 34, 35, 36, 37, 38,
39, 40, 41,     43
```

Avatar method16's observed current component domain is the same set:

```text
31, 32, 33, 34, 35, 36, 37, 38,
39, 40, 41,     43
```

Notably:

```text
42 is absent from both observed domains
```

The match is not merely a contiguous-number coincidence. The namespace spans independently proven mechanical and crew roles and preserves the same current Blitz omission of the historical PC/WoT Radioman-like slot.

## Independently closed component identities

Current method16 physical closures establish:

```text
31 Engine              PROVEN
32 Ammo Rack           PROVEN
33 Fuel Tank           PROVEN
34/35 Track-side pair  PROVEN family / side PARTIAL
36 Gun                 PROVEN
37 Turret Rotator      PROVEN version-scoped
38 Observation Device  PROVEN
39 Commander           PROVEN
40 Driver              PROVEN
41 Gunner               PROVEN
42 unobserved/reserved  UNKNOWN
43 Loader               PROVEN
```

These identities were closed from current replay behavior, recovery consumables, targeting/mobility effects and exhaustive current-domain reasoning; they were not imported from historical numeric order.

## Cross-surface Type32 support

The method38 result list is already independently known to align strongly with same-clock Type32 short damage/effect events:

```text
non-empty method38 result records : 108
exact method38-token-set == Type32-short suffix set : 86 / 108
method38 token set subset of Type32 suffix set      : 90 / 108
at least one token intersection                     : 96 / 108
```

Later crew-state work independently proved Type32 nested tokens:

```text
0x27 / 39 Commander
0x28 / 40 Driver
0x29 / 41 Gunner
0x2B / 43 Loader
```

and mechanical chains independently use the same decimal/hex component values, e.g. Engine `31 = 0x1F`, Observation Device `38 = 0x26`.

Thus method38, method16 and the relevant Type32 nested state surface converge on one current component namespace.

## Current method38 token counts

Observed token counts in the 130 repeated result entries:

```text
31 Engine               9
32 Ammo Rack             4
33 Fuel Tank            12
34 Track side           46
35 Track side           27
36 Gun                   3
37 Turret Rotator        6
38 Observation Device    2
39 Commander             5
40 Driver                7
41 Gunner                 4
43 Loader                 5
```

These frequencies are event-population facts, not module-hit probabilities; replay AoI, tank geometry, shot placement and result-list encoding all influence the distribution.

## Gun-specific flag cross-check: `0x0800`

Current method38 low-16 result flag `0x0800` occurs only twice in the strict corpus.

Both events have exactly one repeated result:

```text
0x0800 sample A -> token 0x24 (=36), rawState=1
0x0800 sample B -> token 0x24 (=36), rawState=1
```

No other result token occurs in either event.

Because `36 = Gun` is independently PROVEN from the exact method36 targeting-degradation / Repair-Kit restoration experiment, the current samples support:

> `0x0800` = **Gun-damage result bit — PROVEN on current observed samples / PARTIAL global due n=2**.

Important cross-version warning:

Historical Wargaming constants assigned `0x0800` to a chassis-damage flag and `0x1000` to gun damage. The current Blitz 11.19 sample behavior therefore demonstrates that upper hit-result bit positions must **not** be positional-transplanted from historical PC/WoT constants.

The lowest four bits happen to have current behavioral closure compatible with historical names, but that does not authorize transplanting the remainder.

## `0x0100` / `0x0400` relationships

Current statistics remain useful:

```text
0x0100 set : 104 events; 104 / 104 have non-empty component result list
0x0400 set :  58 events;  58 / 58 have non-empty component result list
```

This proves both bits belong to the component/device result surface.

Safe grading:

```text
0x0100 component/device piercing-like relationship  PROVEN relationship
0x0400 component/device damage relationship         PROVEN relationship
```

Exact current Blitz symbolic names remain PARTIAL because high-bit historical ordering is demonstrably not universally stable.

## Safe consumer model

```text
ShotComponentResult {
    componentIdRaw
    componentName       // nullable, version-gated mapping
    rawState
    stateSemantic       // nullable until independently closed
    confidence
}
```

For Blitz 11.19, consumers may version-gatedly expose the proven component names above while always retaining `componentIdRaw`.

Do not yet expose `rawState=0/1/2` as exact `damaged/critical/destroyed` labels without a separate current behavioral closure.

## Remaining work

1. close `rawState=0/1/2` against current method16/Type32 severity transitions;
2. validate `0x0800` Gun-damage behavior with additional real Gun-damage hit samples;
3. continue individual current-bit closure without historical positional transplant;
4. resolve exact left/right identity for component IDs 34/35;
5. validate the shared component namespace outside Blitz 11.19 China.
