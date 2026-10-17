# Tankopedia Application Reference Data

## Decision

Tankopedia is application-level immutable reference data. The ten classpath resources
`tankopedia-tier1.json` through `tankopedia-tier10.json` are loaded exactly once per JVM and shared by
all backend consumers.

The application-level entry point is:

```java
TankopediaReferenceData.tankopedia()
```

`Tankopedia.load()` remains only as a compatibility facade for older callers and must return the same
shared instance. It must not reread the classpath resources.

## Why

Tankopedia is not replay-local state and not feature-local state. Map Playback, AI Review, replay
result mapping, vehicle detail and other backend flows all consume the same static vehicle reference
facts such as:

- authoritative display name;
- tier;
- vehicle class;
- nation;
- vehicle-level alpha damage where the data is unambiguous;
- Tankopedia base HP;
- maintained extra information.

Loading separate copies inside helpers or services creates unnecessary memory/initialization work and,
more importantly, gives feature helpers ownership of reference-data lifecycle. That makes it easier
for semantics to diverge across Playback, AI and vehicle-detail features.

## Lifecycle and immutability

The intended lifecycle is:

```text
classpath tankopedia-tier*.json
        ↓ load once
TankopediaReferenceData
        ↓ shared immutable Tankopedia
Playback / AI / replay services / vehicle details / other consumers
```

The published Tankopedia state is immutable after construction:

- the tank-id lookup map is immutable;
- the known-name set is immutable;
- lookup is O(1) by `tankId`;
- no request or replay job reloads the JSON resources;
- callers cannot mutate the shared reference data.

The reference is process-local and lives for the lifetime of the JVM. Updating Tankopedia files takes
effect on the next application deployment/restart; runtime hot mutation is intentionally unsupported.

## Responsibility boundary

`Tankopedia` owns parsing and lookup of vehicle reference facts.

`TankopediaReferenceData` owns application-level lifecycle and the one shared instance.

Feature code owns the business meaning of a Tankopedia fact. For example, Battle Playback may use
Tankopedia base HP as a provisional enemy opening display, but Tankopedia itself does not decide HP
authority or visibility semantics.

`ReplayDisplayNames` is a display facade only. It may use the shared reference data when resolving
legacy/display-oriented values, but it must not own a lazy/static Tankopedia instance and must not
become the general access API for structured vehicle facts.

## New-code rule

New backend code that needs structured Tankopedia facts should use:

```java
TankopediaReferenceData.tankopedia().info(tankId)
```

Do not add new methods to `ReplayDisplayNames` merely to expose another Tankopedia field.

Existing callers of `Tankopedia.load()` may be migrated incrementally because `load()` now resolves to
the same shared application reference. New code should nevertheless prefer the explicit
`TankopediaReferenceData` entry point so lifecycle ownership remains visible in code review.

## Search aliases are not reference data

`common/tank_aliases.json` is WotBTools **search metadata**, not game factual data, and it has a
different owner and lifecycle from the files above:

- **developer-maintained.** Aliases are curated by hand in the repository. Nothing generates them
  from WoT-Blitz-Agent, BlitzKit, the WG API, an LLM or a community API.
- **sparse by design, and opt-in.** The document maps a canonical decimal `tank_id` to a non-empty
  array of alias strings. A vehicle without aliases is simply absent: **a missing tank id means
  `aliases = []`**, so empty arrays must not be stored and adding a vehicle to `tank_cache.json`
  requires no alias change. The file currently ships as `{}`: zero configured aliases is a legal
  state, and search then behaves exactly as it did before aliases existed.
- **search-only.** Aliases widen Tankopedia search recall. They never reach vehicle identity, the
  displayed or sorted name, replay vehicle names, exports, the HTTP contract or the `tank_cache.json`
  upstream schema. Aliases affect discovery, never identity.
- **not language-scoped.** One flat array holds Chinese, English and any other community spelling;
  recall does not depend on the current UI language.
- **frontend-only transport.** The dataset is imported at build time by
  `frontend/src/utils/tankopediaQuery.js` (`normalizeTankCache` projects `aliases`; `selectTanks`
  scores `max(canonical name, aliases)`), the same mechanism as `common/map_names.json`. There is no
  backend endpoint, database table or second asset origin, so the Web and Android bundled frontends
  ship identical data.
- **fail closed in CI.** `common/python/validate_tank_aliases.py`, gated by
  `common/python/tests/test_validate_tank_aliases.py`, rejects invalid JSON, duplicate tank id keys,
  a non-object document, invalid or unknown tank ids, non-array values, empty arrays, non-string or
  blank aliases, and case-insensitive duplicates within one vehicle. Cross-vehicle duplicates stay a
  warning: two vehicles may legitimately share a community short name.
- **validated against the complete vehicle roster.** Tank ids resolve against
  `common/tank_ids.json`, which covers **every tier**, so any Tankopedia vehicle can carry aliases.
  See the next section.

`tank_cache.json` (asset plane) and `tankopedia-tier{1..10}.json` (this document) remain the
factual vehicle data; the alias file is additive metadata beside them.

## The complete vehicle roster (`common/tank_ids.json`)

The tier files and the asset plane's `tank_cache.json` cover every tier.
`common/tank_ids.json` remains the generated offline reference for the alias validator and its
maintenance workflow, which require only an ID and name:

```json
{
  "meta": {
    "source": "blitzkit production definitions",
    "source_game_version": "11.21.0.1235_7376187",
    "source_hashes": { "tanks": "c8a0857…" },
    "generated_at": "…",
    "count": 738
  },
  "vehicles": { "1": "T-34", "9297": "FV215b 183" }
}
```

- **`tank_id` ↔ authoritative name only.** No tier, no stats, no images. Vehicle facts stay in the
  tier files (tiers 1-10) and in the asset plane (`tank_cache.json`, all tiers); the roster is a
  join-key reference, not a data source, and must never be read for vehicle properties.
- **Generated, never hand-edited.** `common/python/update_tankopedia.py:roster_payload` builds it
  from the *unfiltered* `parse_tanks` result of the same stable BlitzKit snapshot that produces the
  tier files, so roster and tier files always describe one game version.
- **Refreshed by the existing data sync.** The `Update Tankopedia` workflow
  (`.github/workflows/update-tankopedia.yml`, manual trigger) writes it next to the tier files and
  commits it in the same automation PR. A local `python common/python/update_tankopedia.py` or
  `sync_tankopedia_snapshot.py` run does the same. No separate fetch script, no second upstream.
- **Fail closed.** `validate_roster` rejects an empty roster and a count drop beyond
  `MIN_TIER_COUNT_RATIO` (the same threshold the tier data uses). `RosterTest` in
  `common/python/tests/test_update_tankopedia.py` additionally asserts that every vehicle in the
  committed tier files appears in the committed roster **under the same name**, and that the roster
  covers at least the tier-file population. The reverse is deliberately not asserted: the roster
  may come from a newer snapshot than the tier files.
- **Population.** 738 vehicles at game 11.21.0.1235 (tiers 1-10), matching the current all-tier attribute library.
  It is derived from the same BlitzKit client definitions that `tank_cache.json` is built from, so
  the two populations track each other; a vehicle that upstream has published but the roster has not
  been refreshed for is rejected until the data sync runs, which is the intended fail-closed
  direction.

### How to add an alias

1. Find the `tank_id` in the complete roster (substring match on the canonical name, every tier):

   ```bash
   python -c "import json,sys;[print(i, n) for i, n in json.load(open('common/tank_ids.json',encoding='utf-8'))['vehicles'].items() if sys.argv[1].lower() in n.lower()]" 183
   ```

   ```text
   9297 FV215b 183
   ```

2. Edit `common/tank_aliases.json`. The whole file is one flat object; append to an existing
   `tank_id` or add a new one, and never create an empty array:

   ```json
   {
     "9297": [
       "183",
       "大白兔",
       "死星",
       "Death Star"
     ],
     "24577": [
       "268 四代"
     ]
   }
   ```

   Rejected by CI (each line is one separate violation):

   ```json
   {
     "9297": [],                      // empty array — omit the key instead
     "4481": "起重机",                 // value must be an array
     "6225": [183],                   // alias must be a string
     "13569": ["", "   "],            // blank alias
     "385": ["907", "907"],           // duplicate within one vehicle (case-insensitive)
     "999999999": ["foo"],            // unknown tank id
     "012": ["bar"]                   // tank id must be canonical decimal
   }
   ```

   (The real file is plain JSON — no comments.) Aliases need no translation and no locale entry:
   one flat array holds every spelling, and a `zh` UI still matches `Death Star`.

3. Validate and open a PR:

   ```bash
   cd common/python && python validate_tank_aliases.py
   ```

   ```text
   tank_aliases.json OK: 2 vehicles, 5 aliases
   ```

   A `WARNING: TANK_ALIASES_CROSS_TANK_DUPLICATE` line is informational: two vehicles sharing a
   community short name is allowed, and search relevance decides the order. Any other violation
   raises and fails CI.

## Battle Playback interaction

Battle Playback HP authority is documented in
`docs/features/battle-playback-hp-authority.md`.

For enemy vehicles before the first trusted replay HP, Playback may read Tankopedia base HP from this
shared reference and expose it as `TANKOPEDIA_BASE_PROVISIONAL`. Once trusted replay HP appears,
Playback permanently switches to replay authority for that vehicle; the shared Tankopedia reference
remains reference data and is not allowed to override replay truth.

## Tests / invariants

Regression tests should preserve these invariants:

1. `TankopediaReferenceData.tankopedia()` returns the same instance for the application lifetime.
2. Compatibility `Tankopedia.load()` returns that exact shared instance.
3. Repeated access does not reload classpath resources.
4. Published collections such as known vehicle names are immutable.
5. Existing Tankopedia lookup semantics remain unchanged by the lifecycle refactor.

## AI free-text name matching

The complete ID/name library remains available to roster and vehicle lookups.
`TankNameCorrector` excludes coordinate-shaped names (A1–K10, including D1, D2 and B1)
and reviewed ambiguous English word/person names (including Agent, Wind, Fury, Explorer,
Ranger and IS) from its free-text matching index. Both canonical spellings and aliases resolving
to these ambiguous names are excluded, even next to a roster nickname: parentheses alone do not
prove a vehicle context. These spans remain unchanged and produce no correction/detection records.
Unambiguous model names retain the existing correction rules. All names remain available through
Tankopedia ID and roster lookup.
