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

- **developer-curated.** Individual edits and reviewed imports of client short/full names are
  maintained in the repository. A bulk import needs exact vehicle/key matching and recorded source
  provenance (see below). Asset or Tankopedia refreshes never regenerate this file; names must not
  be guessed by an LLM or a community API.
- **sparse by design, and opt-in.** The document maps a canonical decimal `tank_id` to a non-empty
  array of alias strings. A vehicle without aliases is simply absent: **a missing tank id means
  `aliases = []`**, so empty arrays must not be stored and adding a vehicle to `tank_cache.json`
  requires no alias change. An empty document `{}` remains legal; imported snapshots only add
  vehicles with verified names that differ from their canonical English names.
- **search-only.** Aliases widen Tankopedia search recall. They never reach vehicle identity, the
  displayed or sorted name, replay vehicle names, exports, the HTTP contract or the `tank_cache.json`
  upstream schema. Aliases affect discovery, never identity.
- **not language-scoped.** One flat array holds Chinese, English and any other community spelling;
  recall does not depend on the current UI language.
- **frontend-only transport.** The dataset is imported at build time by
  `frontend/src/utils/tankopediaQuery.js` (`normalizeTankCache` projects `aliases`; `selectTanks`
  ranks exact canonical-name matches first, then scores `max(canonical name, aliases)` with the
  canonical name as the tie-breaker), the same mechanism as `common/map_names.json`. There is no
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

### Reviewed national-server client names

The 2026-10-17 import contributes **552 official aliases for 471 vehicles** from the national-server
Android client (`com.netease.wotb`), version
`11.21.0.155_7380044 release/11.21.0 WOTB_Android_Windows_china`. Its `Strings/zh-Hans.yaml`
contains language code `zh_ne`. Both the official short name and full name are retained when they
differ; whitespace is trimmed and case-insensitive duplicates (including the canonical English
name) are omitted. Keep meaningful punctuation in official names: `T-34*` is the national-server
name of `4657` (Type T-34), distinct from `1` (T-34) and `2849` (T34). Tankopedia treats a literal
`*` query as a qualifier: only names/aliases containing `*` are scored. For an unstarred query,
a starred alias can fill missing canonical-name recall (for example, `Mk I重型坦克` or `重型坦克`
still matches `Mk I*重型坦克`). If the canonical name already matches, retain its relevance instead
of raising it via the starred alias. This preserves normal recall while `t34*` selects Type T-34.
For example, `6929` (Maus) also has `“鼠”式`, while `10113` (Carro 45t) has `45t战车` and
`45t战斗战车`.

One reviewed keyboard spelling, `T-22中型` with Latin `T` (U+0054), supplements the official
`Т-22中型` with Cyrillic `Т` (U+0422). Both map to `19969` (T-22 medium); the official spelling is
retained. The maintained dataset therefore contains **553 aliases for 471 vehicles**. This is an
explicit search alias, without a global Cyrillic/Latin normalization rule.

An exact canonical-name query (case-insensitive, trimmed) precedes alias fuzzy matches. For example,
`AMX M4 45` returns `6977` before `4417` (AMX M4 mle. 54), even if the latter's `AMX M4 54` alias
gets a higher fuzzy token total. Non-exact matches retain fuzzy relevance and canonical-name ties.

The English reference is `common/tank_ids.json` at commit
`6766effe57cf396d2b8cbeca8255cb2bfb773eb5`: 738 vehicles, BlitzKit game version
`11.21.0.1235_7376187`, tanks.pb SHA-256
`c8a085787a76a4fcdb5f31c5d6a3e42720ba937d62c1653b2ee1e0778f03243e`. Extraction reused
[WoT-Blitz-Agent's client extraction helpers](https://github.com/fanypcd/WoT-Blitz-Agent/blob/8dcec2c6463f23116871157ef6d64985875efd67/tools/extract_vehicles.py)
and its `data/tank_id_bridge.json` at the same commit. Join by **both** canonical `tank_id` and
`nation/model_code`, then resolve the complete localization key from each vehicle's
`shortUserString` / `userString`. Do not fall back to bare keys or fuzzy/translated names.

Of the 738 reference vehicles, 708 have an exact verified name match; 30 were skipped (25 have no
matching localization string and 5 are absent from the client vehicle index). A verified name that
is identical to the English name needs no alias. Missing names create no placeholder.
`九七中战` legitimately belongs to both `2145` and `4401`; the validator reports one cross-vehicle
warning and accepts both.

**Storage decision:** keep this small, reviewed search configuration in Git as
`common/tank_aliases.json`, so reviews and rollbacks are atomic with Web/Android releases. No
backend table, asset server file or second runtime mapping is needed. Raw APKs, complete language
files, vehicle XML indexes and intermediate mapping reports stay outside the repository. Record
their provenance here rather than committing those resources. Source SHA-256 values for this
snapshot:

| Source path inside the decoded client | SHA-256 |
|---|---|
| `Strings/zh-Hans.yaml` | `08cbef0d23224647746fd614ebcc0b5716b04c101c0ef53bd7e86cdd752e73cb` |
| `XML/item_defs/vehicles/china/list.xml` | `00a2d6480b63b3af5585a6ad2ffa9384a36fa0d0bb70dadedf932b453180b4a3` |
| `XML/item_defs/vehicles/european/list.xml` | `d01f9f15b345b22d3b951dcc683382d2171b3932ebf01b83e34800ae75aa9be5` |
| `XML/item_defs/vehicles/france/list.xml` | `4788522019915fc7fada976c28dfab9434a55befd02955f610ed47f5957a3272` |
| `XML/item_defs/vehicles/germany/list.xml` | `58776bd3102e34aa7a0bc762dc90c9a554f8e14302af41cdab1b0d2fc11530a3` |
| `XML/item_defs/vehicles/japan/list.xml` | `472a2118fb3f3c24462abbe4e109b7c50c290f751a98af4a06ceb40a42227799` |
| `XML/item_defs/vehicles/other/list.xml` | `5d8219ff4aecb50038353aa2717552bbeff72fc72057b621df9a8617ab92abec` |
| `XML/item_defs/vehicles/uk/list.xml` | `4aea16b497d98b10d181114182f376dbc6b475a151e2ca5763666cb8de4007bf` |
| `XML/item_defs/vehicles/usa/list.xml` | `cc1b957742687a9bab3f1eaeb76876ce613d31d27d3e3cc79fe2d9c2fa10a01f` |
| `XML/item_defs/vehicles/ussr/list.xml` | `5fd6c699b026cd58d68a82ea6754b3bc27aed93f4061baf23a2cdb7d7de51a90` |
| `version.txt` | `cebb290ac669bd9bd0bbc6b2be4bccd8fe40a3e6a90ee9aeabf93bc294a23012` |

For the next reviewed import:

1. Decode a locally available official client using the upstream extraction tools. Record its
   version, tool revision and input hashes; retain the decoded sources locally for verification.
2. Cross-check client vehicle ids and `nation/model_code` against the upstream bridge and the
   current committed English roster. Resolve only the exact short/full localization keys. Skip
   missing or mismatched records and report their counts instead of inventing names.
3. **Merge** verified short/full names into the existing arrays; preserve manually added community
   aliases. Trim values, deduplicate case-insensitively per vehicle and omit values equal to its
   canonical English name. Preserve official name qualifiers such as `T-34*`; a spelling that
   collapses under fuzzy normalization can still identify a different vehicle. Check collisions
   against the actual search behavior rather than deleting verified names. Legitimate shared
   Chinese names remain allowed. Sort tank-id keys numerically for a readable diff. Never replace the
   file wholesale with a new client snapshot or remove an alias merely because that client omits it.
4. Update this provenance section, run `python3 common/python/validate_tank_aliases.py` and
   `python3 -m unittest discover -s common/python/tests -p test_validate_tank_aliases.py`, then run
   the targeted `frontend/src/utils/tankopediaQuery.test.js` search integration tests. Review the
   data diff before opening a PR. The bundled Android dataset also needs the normal version bump.

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
Ranger, Outcast and IS) from its free-text matching index. Both canonical spellings and aliases resolving
to these ambiguous names are excluded, even next to a roster nickname: parentheses alone do not
prove a vehicle context. These spans remain unchanged and produce no correction/detection records.
Unambiguous model names retain the existing correction rules. All names remain available through
Tankopedia ID and roster lookup.
