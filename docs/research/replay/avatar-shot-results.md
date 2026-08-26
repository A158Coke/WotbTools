# Avatar method38 — recorder shot-result / hit-feedback family

> Corpus: strict 34 unique-arena Blitz 11.19.0 China subset from the replay research archive.
>
> Scope: current Avatar-targeted Type8 `methodId=38`. Numeric method IDs are version- and entity-class-scoped.

## Executive verdict

Current Avatar method38 is the recorder's **shot-result / hit-feedback family — PROVEN behavioral identity**.

Historical Wargaming client code exposes `showShotResults(results)`, which is now the strongest symbolic RPC candidate. The exact Blitz 11.19 method symbol and field codec remain `PARTIAL` until a version-matched entity definition is recovered.

An earlier hypothesis that method38 might be `showOtherVehicleDamagedDevices(vehicleID, damagedExtras, destroyedExtras)` is **SUPERSEDED**: the strict corpus proves method38 is emitted one-for-one with the recorder's actual hit stream, not as an arbitrary monitored-target device snapshot.

## Recorder identity is independently resolved

For each replay, recorder vehicle identity is resolved without using method38:

```text
meta.json.dbid
  -> subtype48 wrapper1 player record field7 account DBID
  -> wrapper1 field1 vehicle/entity ID
```

This gives the current replay recorder's combat entity ID independently of projectile or hit-feedback hypotheses.

## Method38 is recorder-hit scoped

On the strict 34-arena corpus:

```text
method38 total                                      : 295
method38 targeted at recorder Avatar                : 295 / 295
method38 args begin with valid victim vehicle ID    : 295 / 295
method38 with same-clock Vehicle method8 direct hit
whose attacker == independently resolved recorder   : 295 / 295
counterexamples                                     : 0
```

Four clocks contain an additional attacker damage RPC batched at the same replay timestamp, but every method38 event still has a same-clock recorder->victim damage RPC. Therefore batching does not break the recorder attribution.

Verdict:

> method38 is not general world damage telemetry. It is **feedback for a hit produced by the replay recorder's own vehicle — PROVEN**.

## Settlement cardinality closure

Recorder settlement fields independently provide shot/hit counts.

Across the strict 34 arenas:

```text
recorder settlement shots : 324
recorder settlement hits  : 295
Avatar method38 events    : 295
```

Per arena:

```text
31 / 34 arenas: method38 count == settlement hits exactly
remaining deltas: +1, +1, -2
corpus total delta: 0
```

The small per-arena redistribution is consistent with replay timestamp/event batching and multi-target/result packing boundaries; the complete corpus cardinality is exact.

Together with the 295/295 recorder-attacker closure, this proves the method's current behavioral identity as recorder hit/shot-result feedback.

## Experimental validation against the projectile lifecycle

A second-pass experiment tested method38 at the individual projectile level rather than relying only on event totals.

Recorder vehicle identity was first inferred independently from the attacker field of same-clock direct-hit method8 events associated with method38; that vehicle ID was then used to select recorder-owned Avatar method29 launch records. Each method29 shot ID was closed to its Avatar method20 terminal endpoint.

Observed strict-corpus totals:

```text
settlement shots                    : 324
recorder method29 launch records    : 326
arenas launch-count == shots exactly: 32 / 34
remaining launch deltas             : +1, +1

settlement hits                     : 295
method38 events                     : 295

recorder projectile terminals with
method38 at the same/near terminal  : 294
recorder projectile terminals with
no method38                         : 32
```

Using a conservative `<= 0.21 s` terminal-to-feedback window:

```text
30 / 34 arenas: projectile-classified hit count == settlement hits exactly
remaining hit-count deltas: +1, +1, -1, -2
```

No recorder launch lacked a matching method20 terminal record in this experiment.

The two extra method29 launch records and the few per-arena hit-classification deltas are retained as boundary evidence rather than discarded; they likely reflect duplicated/batched launch observations or same-clock result packing and require separate closure before constructing a one-to-one production shot ledger.

Verdict:

> The projectile-level experiment independently confirms that **method38 is present on the recorder hit path and absent on the overwhelming majority of recorder miss/environment-terminal paths**. This supports the `showShotResults`-family interpretation at the behavioral level.

### Negative control: method27 / environment-terminal path

Avatar method27 is independently established as an `explodeProjectile` / miss-environment terminal family. The recorder projectile experiment separates the two paths:

```text
method29 launch
  -> method20 terminal
      -> method38 on recorder-hit path
      -> method27 on many miss/environment-terminal paths
```

The two methods are therefore not alternative encodings of the same result event.

## Header experiment: penetration hypothesis remains PARTIAL

The four-byte method38 header was tested against two independent result dimensions:

1. exact same-clock Type7 prop3 HP loss; and
2. settlement `hits - penetrations` counts.

Among the 295 method38 records:

```text
213 : same-clock positive observed HP delta
 82 : no usable same-clock positive HP delta
```

The first header byte strongly separates some of those cases. In particular:

```text
header[0] = 0x10 : 184 total; 160 with exact positive HP loss
header[0] = 0x20 :  33 total;   3 with exact positive HP loss
header[0] = 0x30 :  34 total;  31 with exact positive HP loss
header[0] = 0x60 :   5 total;   0 with exact positive HP loss
```

This proves that the header carries real shot-result state rather than arbitrary padding.

However, exact HP observation is AoI/sample limited, so `no same-clock HP delta` is not equivalent to `no penetration`.

Settlement gives:

```text
hits         : 295
penetrations : 270
non-penetrating hits = 25
```

A tempting aggregate coincidence (`header0=0x00` + `header0=0x11` totals 25) fails per-arena validation and is **REJECTED**.

`header0=0x20` is the strongest current non-penetration/no-HP candidate:

```text
header0=0x20 total                : 33
arenas where count exactly equals
settlement hits-penetrations      : 25 / 34
mean absolute per-arena error     : ~0.41 shots
```

But `33 != 25` globally, and three `0x20` events have an exact observed positive HP delta. Therefore:

> `header0=0x20 == non-penetration` is **NOT PROVEN**.

The safer conclusion is:

> the header contains one or more hit-result flags that strongly distinguish HP-damaging/piercing-like results from no-HP/special/module-only result families — `PROVEN relationship / PARTIAL bit semantics`.

Historical `showShotResults` code independently supports this architecture: its result flags distinguish piercing, no-piercing, gun damage, chassis damage and fire-start outcomes. Current Blitz numeric bits must still be recovered from current behavior rather than transplanted from historical constants.

## Main wire variant

Argument lengths in the strict corpus:

```text
10 bytes : 173
12 bytes :  93
14 bytes :  24
16 bytes :   3
18 bytes :   2
```

For 281/295 records, this structural decoder closes exactly:

```text
victimVehicleId : u32 LE
header          : 4 bytes, semantics PARTIAL
count           : u8
repeat count times:
    token       : u8
    rawState    : u8
tail            : u8
```

with:

```text
argLength == 10 + 2 * count
count in 0..4
```

The remaining 14 records retain the recognizable main prefix/list material and carry an additional four-byte extension. The extension remains `UNKNOWN`; consumers must preserve it raw.

Representative bodies:

```text
<victim> 10 05 02 00 01 22 01 00
<victim> 10 01 02 00 01 21 01 00
<victim> 00 05 02 00 02 22 02 23 02 00
<victim> 20 05 02 00 01 22 02 00
```

The four-byte `header`, final tail byte and extended-variant extra bytes remain unresolved at field-name level.

## Structured critical/module result list

Every non-empty main-variant method38 record is same-clock with a Vehicle method8 direct hit on the same victim.

The repeated token/state list is strongly correlated with Type32 mobile `flag=1` short damage/effect events for that victim.

For 108 main-variant records with a non-empty result list:

```text
method38 token set == same-clock Type32 short suffix set : 86 / 108
method38 token set subset of short suffix set            : 90 / 108
at least one token/suffix intersection                   : 96 / 108
```

Examples:

```text
method38 token 0x22, rawState1
same clock Type32 short: a0 22

method38 token 0x21, rawState1
same clock Type32 short: a0 21

method38 token 0x22, rawState2
same clock Type32 short family includes: a4 22 / 9c 22

method38 tokens 0x22 rawState2, 0x23 rawState2
same clock Type32 short family contains ...22 and ...23
```

This proves that the list carries **structured per-hit module/extra/critical-result evidence**, while Type32 short bodies carry a related presentation/event encoding.

It does not yet prove exact token-to-component names.

## rawState-to-Type32 prefix separation

For method38 `(token,rawState)` entries with a same-clock Type32 short ending in the same token:

### `rawState=1`

```text
a0   : 52
 a180: 17
 a140:  2
 a1e0:  1
```

### `rawState=2`

```text
a4   : 29
9c   : 26
a580 :  1
9d80 :  1
```

### `rawState=0`

No equivalent stable same-clock short-prefix family is observed in the current subset.

Verdict:

> method38 `rawState` and Type32 compact prefix encode a shared **hit-result severity/state dimension — PROVEN relationship**.

Exact labels such as `common damage`, `critical/destroyed`, `crew`, `repaired` remain `PARTIAL/UNKNOWN` until independently closed.

## Historical client evidence and candidate symbol

Historical Wargaming `Avatar.py` exposes both:

```text
showShotResults(results)
showOtherVehicleDamagedDevices(vehicleID, damagedExtras, destroyedExtras)
```

`showShotResults` processes the player's shot feedback, including penetration/module/chassis/gun/fire-related result flags and sounds. That behavior fits the current 295/295 recorder-hit relationship and exact corpus-level settlement-hit cardinality.

`showOtherVehicleDamagedDevices`, by contrast, is tied to monitoring the currently targeted vehicle and forwards damaged/destroyed device collections to UI feedback. That behavioral contract does not explain the 295/295 recorder-hit alignment.

Therefore:

```text
current physical identity : recorder shot-result / hit-feedback — PROVEN
historical symbolic candidate: showShotResults — PARTIAL
old showOtherVehicleDamagedDevices candidate: SUPERSEDED
```

## Rejected method35 hypothesis

Current Avatar method35 was also tested against historical `showVehicleDamageInfo(vehicleID, damageIndex, extraIndex, entityID, equipmentID)`.

Its current 13-byte argument form is instead structurally:

```text
vehicleId : u32
value     : f32
zeroTail  : 5 bytes in the observed main family
```

and only a minority of occurrences coincide with Type32 damage-short events.

Therefore:

> `method35 == showVehicleDamageInfo` is **REJECTED** for current Blitz 11.19.

## Consumer guidance

A safe research/decoder model is:

```text
ShotResultFeedback {
    rawClockSec
    victimVehicleEntityId
    headerRaw[4]
    results[] {
        token
        rawState
    }
    extensionRaw[]
    recorderScoped = true
    confidence
}
```

Safe current uses after version gating:

- establish that the recorder's shell registered a hit-result feedback event;
- attach raw module/critical result tokens to that hit;
- correlate those tokens with Type32 short damage effects and later recovery state;
- preserve a hit even when exact module names are unknown.

Unsafe until further closure:

- naming token `0x21/0x22/...` as a specific engine/track/gun/crew member;
- exposing rawState `0/1/2` as user-facing severity labels;
- interpreting the four-byte header as penetration, blocked damage or material without proof;
- treating method38 as all-player/global hit telemetry: it is recorder-scoped.

## Remaining work

1. Recover a version-matched Blitz 11.19 Avatar/entity definition for the exact method38 RPC symbol and field codecs.
2. Decode the four-byte header bit layout; current experiments prove a hit-result dimension but do not yet prove individual penetration/no-penetration bits.
3. Close `rawState=0/1/2` against controlled common-vs-critical/destroyed module outcomes.
4. Map token IDs to actual vehicle `extras[]` entries.
5. Decode the 14-record extended variant.
6. Explain the two extra recorder method29 launch observations and the four per-arena projectile-classification boundary cases before building a production one-shot/one-result ledger.
