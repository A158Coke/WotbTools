# Battle Playback HP Authority

## Status

This document is the product/architecture authority for Battle Playback HP presentation.
The frontend renders backend-projected canonical HP state; it must not infer opening HP,
choose between replay/tankopedia sources, or reconstruct visibility-dependent HP truth.

## Friendly vehicles

Friendly vehicles are confirmed with their actual battle opening HP from battle results:

```text
ReplayHpTimeline.settlementInitialHp(player)
= max(signed PlayerResults field1, 0) + damageReceived
```

The 11.19 replay research corpus proves this reconstruction against initial Type5 materialization
for 238/238 setup-window combatants. See `docs/research/replay/actual-hp-type5-settlement.md`.

At battle-relative `t=0`, backend projection emits:

```text
currentHp         = actual opening HP
displayCapacityHp = actual opening HP
knowledge         = CURRENT
source            = SETTLEMENT_OPENING_HP_EXACT
relativeFull      = false
confidence        = HIGH
```

The product UI must display the concrete value (for example `2500 / 2500`). It must not replace
this with `100%` or the legacy text meaning "opening full, concrete HP not confirmed".

## Enemy vehicles

Before the first trusted replay HP observation, Tankopedia `baseHp` is allowed only as a provisional
opening display value:

```text
currentHp         = tankopedia baseHp
displayCapacityHp = tankopedia baseHp
source            = TANKOPEDIA_BASE_PROVISIONAL
```

This value is not actual battle HP and must never be promoted into canonical replay truth.
Tankopedia access must use the application-level immutable reference described in
`docs/architecture/tankopedia-reference-data.md`; Playback must not create its own Tankopedia copy.

### Permanent authority switch

The first trusted replay HP observation (Type5/current HP surfaces projected through the canonical
timeline) permanently switches that vehicle to replay authority for the rest of the battle.

After the switch:

- current observed HP uses replay HP;
- hidden/AoI gaps keep the replay last-known state;
- reacquisition uses the new replay HP;
- destroyed state reaches replay HP `0` when proven;
- Tankopedia must never become the active HP source again for that vehicle in the same battle.

The frontend must not know or reimplement this switch.

### Replay capacity is independently authoritative

`currentHp` and `displayCapacityHp` are different facts. A trusted replay current HP does not prove
that the same number is the vehicle's battle capacity.

If the first trusted replay HP has no replay-authoritative capacity:

```text
currentHp         = replay current HP
displayCapacityHp = null
source            = replay source
```

The backend must not create a fake `currentHp / currentHp` full-health pair. A later trusted replay
fact may provide a positive `displayCapacityHp`; only then is that replay capacity adopted.

Example:

```text
t=0   enemy provisional: current=3400 capacity=3400  (Tankopedia display reference)
t=10  first replay HP:   current=3200 capacity=null  (replay authority switched)
t=20  later replay fact: current=2800 capacity=3560  (replay capacity now known)
```

At no point may the authority switch revert to Tankopedia.

## Sparse timeline rule

An absent/UNKNOWN frame is not a command to restore Tankopedia and is not automatically a transition
to a new HP value. Backend projection emits sparse authoritative transitions; the frontend only uses
`lastAtOrBefore(currentTime)`/equivalent query-at-time logic.

For an enemy that has already switched to replay authority, a hidden/AoI gap therefore preserves the
previous replay HP as `LAST_KNOWN`; it does not emit a clearing transition merely because the vehicle
is no longer observed.

## Team HP bar presentation

The bottom friendly/enemy team bars are presentation aggregation over already-canonical per-vehicle
HP facts. They must not introduce a second HP authority model.

The important distinction is:

- latest `currentHp` follows the latest canonical HP transition;
- presentation capacity is the latest positive `displayCapacityHp` already disclosed at or before
  the current playback time;
- a later transition with `displayCapacityHp = null` means "this transition provides no new
  capacity", not "forget the previously disclosed presentation scale";
- `currentHp` must never be substituted for a missing capacity;
- when a later replay-authoritative positive capacity appears, it replaces the earlier presentation
  scale naturally.

This prevents the enemy team bar from jumping through a false sequence such as:

```text
EXACT 80% -> PARTIAL 100% -> EXACT 75%
```

when one enemy changes from Tankopedia provisional HP to replay HP without an immediately available
replay capacity.

This aggregation is presentation math only: query-at-time plus pure sum over canonical facts. It does
not infer replay protocol semantics, visibility truth, opening HP, or authority switching.

## Responsibility boundary

```text
replay + settlement + application Tankopedia reference
        ↓
backend HP authority projection
        ↓
BattlePlaybackDataset.healthTransitions
        ↓
frontend query-at-time + pure presentation aggregation
        ↓
display only
```

Backend owns:

- settlement opening-HP reconstruction;
- friendly opening confirmation;
- enemy Tankopedia provisional seed;
- first-trusted-replay permanent authority switch;
- replay capacity authority;
- CURRENT / LAST_KNOWN HP provenance.

Frontend owns only:

- `lastAtOrBefore` / query-at-time;
- retaining an already-disclosed positive presentation capacity until a newer positive capacity is
  disclosed;
- pure team sum/percentage calculation;
- formatting, localization and visual rendering.

Frontend must not:

- select Tankopedia vs replay as an HP source;
- infer opening HP;
- derive capacity from current HP;
- restore Tankopedia after replay authority has begun;
- clear HP merely because the vehicle leaves AoI.

## Orientation UI

Vehicle orientation remains canonical data for map rendering and possible AI Review consumption, but
it is intentionally not shown as a textual row in the Playback vehicle inspector. The former
`朝向: 当前朝向` presentation conveyed provenance without a useful value and is removed from product UI.
