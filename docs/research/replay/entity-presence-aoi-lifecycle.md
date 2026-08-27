# Enemy visibility / client-presence lifecycle — Type33 + Type5(type=2) + Type4

> Corpus: strict 34 unique-arena Blitz 11.19.0 China subset.
>
> Scope: recording-client observed vehicle presence. This is stronger than generic AoI evidence because the repeated lifecycle occurs exclusively on enemy combat vehicles in the current corpus. It is still **not** promoted to a server-authoritative global `spotted` flag.

## Executive verdict

Current enemy vehicle entities repeatedly cycle through:

```text
Type33(entityId)
  -> shortly after
Type5(entityId, entityTypeId=2, ...)
  -> Type10 position/property/method traffic while observed
  -> Type4(entityId)
  -> no Type10 position traffic while absent
  -> later Type33 + Type5(type=2) again
```

This is a **PROVEN enemy client-observed visibility/presence lifecycle** for the current corpus.

The same combat entity ID can disappear and later re-enter repeatedly without dying. Friendly combat vehicles behave differently: every allied combat vehicle enters once and remains present for the replay POV; repeated leave/re-entry cycles are enemy-only.

The safe semantic is therefore `enemy observed / enemy absent from this replay POV`. Whether the server's exact symbolic state is named `spotted`, `visible`, `AoI interest`, or a compound of those remains `PARTIAL` until a version-matched schema closes the symbol.

## Type5 entity classes

On the strict 34-arena corpus, Type5 `entityTypeId` values are:

```text
3 : 2713
2 : 1096
8 :   60
```

The `entityTypeId=2` family resolves to combat vehicle entities and is the family studied here.

## Type33 -> Type5(type=2) pairing

Every observed vehicle Type5(type=2) entry has a preceding same-entity Type33 record:

```text
vehicle Type5(type=2) entries : 1096
with preceding same-eid Type33: 1096 / 1096
unpaired                       : 0
```

Observed Type33 -> Type5 delay:

```text
median : ~0.246 s
min    : ~0.046 s
max    : ~1.154 s
```

Therefore Type33 and Type5 are related but distinct lifecycle steps; Type33 is not duplicate payload noise.

## Team split — decisive visibility evidence

Settlement field102 supplies authoritative team 1/2 for every settled combat vehicle; replay-author identity supplies the recorder's own team.

Across the strict 34 arenas:

```text
allied combat vehicles = 7 * 34 = 238
allied Type5(type=2) entries           : 238
allied Type4 leaves                    :   0
allied repeated leave->re-entry cycles :   0

enemy Type5(type=2) entries            : 722
enemy Type4 leaves                     : 503
enemy closed leave->re-entry cycles    : 485
```

All **485 / 485** repeated vehicle leave->later-re-entry cycles belong to enemies.

The friendly count is exact: 238 allied entries equals the full `7 × 34` allied combat roster, with each ally entering once and never being removed from the replay POV by Type4.

This rules out a generic physical-distance-only or ordinary vehicle-lifecycle interpretation. The repeated presence transitions are tied to enemy observability from the recording client.

Verdict:

> `Type33 + Type5(type=2)` / `Type4` carry **enemy observation/visibility-presence boundaries — PROVEN behavioral role** on the current corpus.

The stronger name `server spotted/unspotted` remains `PARTIAL symbolic semantic` because the replay proves the recording client's observed entity lifecycle, not a global server visibility bit visible to every teammate.

## Repeated leave/re-enter proof

Across the 34 arenas, there are 485 closed enemy cycles where the same combat vehicle entity ID has:

```text
Type4 leave
  -> later Type5(type=2) re-entry
```

This disproves:

```text
Type4 == death
Type5(type=2) == one-time vehicle creation
```

A living enemy vehicle can leave the recorder's observed entity set and later return with the same entity ID.

## Position-stream negative control

For each of those 485 closed enemy Type4 -> later Type5(type=2) cycles, all Type10 position records for the same entity were inspected.

Result:

```text
closed enemy leave->re-entry cycles                  : 485
cycles containing any Type10 position inside absence : 0
clean absence windows                                 : 485 / 485
```

Position telemetry resumes only after the enemy entity re-enters.

Therefore the absence interval is a real telemetry-observation boundary. A playback implementation must not continue fresh interpolation through that interval.

## Safe consumer model

```text
VehicleObservationState {
    entityId
    teamRelation        // ALLY / ENEMY
    observedFrom        // Type33/Type5 entry boundary
    absentFrom          // Type4 boundary
    source = REPLAY_POV
    semantic = CLIENT_OBSERVED
}
```

For allied combatants in this corpus, observation is effectively continuous after initial creation.

For enemies:

```text
Type33/Type5 -> currently observed by this replay POV
Type4        -> no longer observed by this replay POV
```

Safe uses:

- render exact current enemy position only inside observed intervals;
- on Type4, freeze a separate last-known position rather than continue exact movement;
- on later Type33/Type5, resume exact telemetry from the re-entry point;
- distinguish `last known`, `currently observed`, and `dead` states;
- combine multi-POV replays as independent observation sources without pretending one POV is global truth.

Unsafe without stronger schema evidence:

- claim that Type4 means the enemy was globally unspotted for the entire team;
- claim that Type5 is the authoritative server `spotted=true` bit;
- treat absence as death;
- synthesize exact movement while absent;
- infer enemy HP/module state changes during an absence unless another authoritative surface records them.

## Product implication

This directly supports Battle Playback's trusted-visibility model:

```text
OBSERVED
  -> exact live position/telemetry allowed

LAST_KNOWN
  -> preserve last exact observation
  -> do not extrapolate as authoritative truth

DEAD
  -> separate terminal combat state
```

The previous need to infer last-known visibility indirectly from position silence can now be replaced with explicit replay lifecycle boundaries.

For AI Review, this also prevents hindsight errors: an analysis should not describe an enemy's exact hidden movement as information the recorder could actually observe.

## Remaining work

1. correlate Type33/Type5/Type4 transitions with any remaining Avatar visibility RPC/property surface to recover the exact symbolic method name;
2. test multi-POV duplicates from the same arena: one POV should be able to observe an enemy while another is absent, which would independently prove POV-specific visibility;
3. measure whether the Type33 boundary or the later Type5 boundary is the better user-visible `became observed` timestamp;
4. characterize terminal enemy Type4 leaves after death separately from ordinary visibility loss;
5. validate the same lifecycle on random battles and future Blitz versions before production version-gate widening.
