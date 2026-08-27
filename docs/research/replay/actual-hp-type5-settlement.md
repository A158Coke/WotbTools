# Actual HP — Type5 materialization snapshot + settlement reconstruction

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas / 476 settled combatants.

## Executive verdict

The current replay exposes **actual battle HP**, including HP added by equipment/provisions/configuration. Consumers do not need to infer battle HP from tankopedia base HP.

Two complementary surfaces are now closed:

```text
Type5 vehicle materialization bytes[51..53)
    = current HP at materialization / re-materialization

PlayerResults initialActualHp
    = max(signed field1, 0) + field11
```

with:

```text
PlayerResults field1  = end-of-battle HP / terminal-sentinel family
PlayerResults field11 = total HP damage received
```

## Type5 current-HP field

For current `entityTypeId=2` settled combat-vehicle Type5 packets:

```text
hpRaw : u16 LE at payload bytes [51..53)
```

This offset is version/class scoped.

### Recorder opening-HP closure

Avatar method5 is independently proven as the replay author's own-health mirror and includes a true opening HP seed.

For all 34 replay authors:

```text
first recorder Vehicle Type5 hpRaw
== Avatar method5 opening HP
34 / 34 exact
```

This includes vehicles whose actual opening HP differs from tankopedia base HP.

Verdict:

> Type5 `[51..53)` = **vehicle current HP snapshot — PROVEN current corpus**.

### Re-materialization monotonic closure

Current settled-vehicle Type5 observations:

```text
records : 960
```

For Type5 snapshots with a following Vehicle method1 HP update:

```text
next method1 current HP <= Type5 HP
901 / 901
```

For re-materializations with a preceding method1 HP state:

```text
Type5 HP <= last pre-disappearance method1 HP
261 / 261
```

This is exactly the expected behavior when an enemy can take additional damage while outside the replay POV's active observed/AoI interval and then re-enter with a lower current HP snapshot.

## Settlement field1 = HP left / terminal sentinel

Interpreting PlayerResults field1 as signed two's-complement integer gives the current population:

```text
positive values : surviving vehicles' HP left
0               : terminal/dead HP state
-3              : 60 death-associated terminal results
-2              : 1 death-associated terminal result in current corpus
```

The negative values are terminal sentinel states; exact symbolic reason for every negative value is version/context scoped and should be preserved raw.

Verdict:

> PlayerResults field1 = **end-of-battle HP / terminal-sentinel family — PROVEN behavioral identity**.

## Settlement field11 = damage received

For vehicles materialized during the initial setup window, Type5 provides independent actual starting HP. Across all 238 such settled vehicles:

```text
max(signed field1, 0) + field11
== initial Type5 HP
238 / 238 exact
```

Therefore:

> PlayerResults field11 = **total HP damage received — PROVEN current corpus**.

This also explains dead-player records:

```text
final HP <= 0
=> initialActualHp = field11
```

while survivors satisfy:

```text
initialActualHp = finalHp + damageReceived
```

## All-materialization validation

Across 475 settled combatants with at least one Type5 materialization:

```text
settlement-derived initialActualHp >= first observed Type5 current HP
475 / 475
```

and:

```text
exact equality : 474 / 475
```

The single non-equal case first materializes late after the battle is underway and appears with current HP already 359 lower than settlement-derived initial HP, exactly as expected for damage taken before first observation.

## Canonical reconstruction

```text
signedHpLeft = signed(PlayerResults.field1)
finalHp      = max(signedHpLeft, 0)
damageTaken  = PlayerResults.field11
initialHp    = finalHp + damageTaken
```

For live playback:

```text
on Type5(vehicle):
    vehicle.currentHp = u16(Type5[51..53))

on Vehicle method1 / Type7 prop3:
    update current HP with the live value
```

## Product implications

### Battle playback

- seed allies/recorder with actual battle HP rather than base-HP lookup;
- when an enemy re-enters AoI, restore the current HP carried by Type5 instead of retaining a stale last-known HP;
- avoid striped/unknown HP when the protocol already supplies an authoritative snapshot.

### AI Review

- distinguish real HP pool from tankopedia base HP;
- calculate HP trades and percentage damage against the player's actual battle HP;
- avoid attributing equipment/provision HP bonuses by guesswork.

### Damage attribution

This HP closure enables exact threshold validation for surfaces such as wrapper6's >50% kill-notification assister:

```text
contributionRatio = attributedDamage / initialActualHp
```

rather than dividing by base tank HP or a first-observed post-damage value.

## Important boundaries

- Type5 byte offset 51 is version/class scoped; do not apply it blindly to non-vehicle entityTypeId values or other client versions.
- Settlement field1 negative values must be preserved as terminal sentinels before canonicalizing `finalHp=0`.
- `initialActualHp` is a battle fact; it does not identify which equipment/provision produced the HP increase.
