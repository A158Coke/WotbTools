# Tankopedia Application Reference Data

## Decision

Tankopedia is application-level immutable reference data. The four classpath resources
`tankopedia-tier7.json` through `tankopedia-tier10.json` are loaded exactly once per JVM and shared by
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
- **sparse by design.** The document maps a canonical decimal `tank_id` to a non-empty array of
  alias strings. A vehicle without aliases is simply absent: **a missing tank id means
  `aliases = []`**, so empty arrays must not be stored and adding a vehicle to `tank_cache.json`
  requires no alias change.
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
- **tier 7-10 only.** Validation resolves tank ids against `common/tankopedia-tier{7,8,9,10}.json`,
  the only deterministic in-repo vehicle list (CI never reaches the network). Vehicles outside those
  tiers have no in-repo reference and therefore cannot carry aliases.

`tank_cache.json` (asset plane) and `tankopedia-tier{7,8,9,10}.json` (this document) remain the
factual vehicle data; the alias file is additive metadata beside them.

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
