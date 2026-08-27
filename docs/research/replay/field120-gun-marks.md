# PlayerResults field120 — Gun Marks count

> Corpus: canonical 34 unique Blitz 11.19.0 China arenas / 476 settled combatants.
>
> Verdict: **PROVEN current-version semantic identity**.

## Settlement shape

PlayerResults `field120` is a varint with current observed domain:

```text
0 : 371 players (protobuf absence/default included)
1 :   3
2 :   4
3 :  98
```

No value outside `0..3` occurs.

Earlier corpus-only analysis already showed that the value behaves as a persistent player×tank state rather than a per-battle result: the same player/tank pair tends to retain the same value across repeated training-room battles, and the value has no useful correlation with that battle's XP/damage/win result.

## Exact live-roster/result closure

Avatar method48 wrapper1 is the live arena/player roster snapshot used during battle loading/arena initialization.

The current wrapper1 player protobuf has a previously unnamed varint `field26`.

Joining wrapper1 players to settlement #301 players by account ID across all canonical settled combatants gives:

```text
wrapper1.player.field26 (missing => 0)
==
PlayerResults.field120 (missing => 0)

476 / 476 exact
counterexamples: 0
```

The wrapper1 field26 domain is the same:

```text
0, 1, 2, 3
```

Thus field120 is not merely a result-only counter; it is the same player×tank display/profile state carried in the battle-loading roster and final result surface.

## Current Blitz product-level closure

Current World of Tanks Blitz Gun Marks have exactly the required behavior:

- attached to a specific player+tank performance state;
- `0..3` marks maximum;
- persistent rather than earned anew from each individual battle;
- visible in the Battle Loading team list for allies;
- visible in Battle Results / team-side result views;
- non-Random modes do not advance Gun Mark progress, so repeated training-room battles can preserve the same value.

This independently matches both protocol surfaces:

```text
wrapper1 field26 -> loading/arena roster
field120         -> settled player result
```

and the exact 0..3 value domain.

## Verdict

> wrapper1 player `field26` = **Gun Marks count — PROVEN current Blitz 11.19 China**.
>
> PlayerResults `field120` = **Gun Marks count — PROVEN current Blitz 11.19 China**.

## Safe model

```text
PlayerGunMarks {
    accountId
    vehicleCompDescriptor
    marks : 0..3
}
```

The value is display/profile state, not a battle-earned mark count or battle-performance rating.

## Version boundary

Gun Marks are a comparatively recent Blitz feature. Older replay versions may not contain these fields or may use different wrapper/result field numbers. Numeric IDs must remain version-gated.
