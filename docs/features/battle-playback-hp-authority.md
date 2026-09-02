# Battle Playback HP Authority

## Status

This document is the product/architecture authority for Battle Playback HP presentation.
The frontend renders the backend-projected canonical HP state; it must not infer opening HP,
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

Before the first trusted replay HP observation, tankopedia `baseHp` is allowed only as a provisional
opening display value:

```text
currentHp         = tankopedia baseHp
displayCapacityHp = tankopedia baseHp
source            = TANKOPEDIA_BASE_PROVISIONAL
```

This value is not actual battle HP and must never be promoted into canonical replay truth.

### Permanent authority switch

The first trusted replay HP observation (Type5/current HP surfaces projected through the canonical
timeline) permanently switches that vehicle to replay authority for the rest of the battle.

After the switch:

- current observed HP uses replay HP;
- hidden/AoI gaps keep the replay last-known state;
- reacquisition uses the new replay HP;
- destroyed state reaches replay HP `0` when proven;
- tankopedia must never become the active HP source again for that vehicle in the same battle.

The frontend must not know or reimplement this switch.

## Sparse timeline rule

An absent/unknown frame is not a command to restore tankopedia and is not automatically a transition
to a new HP value. Backend projection emits sparse authoritative transitions; the frontend only uses
`lastAtOrBefore(currentTime)`/equivalent query-at-time logic.

## Responsibility boundary

```text
replay + settlement + tankopedia reference
        ↓
backend HP authority projection
        ↓
BattlePlaybackDataset.healthTransitions
        ↓
frontend query-at-time
        ↓
display only
```

Backend owns:

- settlement opening-HP reconstruction;
- friendly opening confirmation;
- enemy tankopedia provisional seed;
- first-trusted-replay permanent authority switch;
- CURRENT / LAST_KNOWN HP provenance.

Frontend owns only formatting, localization and visual rendering.

## Orientation UI

Vehicle orientation remains canonical data for map rendering and possible AI Review consumption, but
it is intentionally not shown as a textual row in the Playback vehicle inspector. The former
`朝向: 当前朝向` presentation conveyed provenance without a useful value and is removed from product UI.
