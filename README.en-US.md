# WoTBTools

## SPA Routing Parameters

- `?view=home`: Enter the tools home page.
- `?view=replay`: Enter the replay extractor.
- `?view=leaderboard`: Enter the leaderboard.
- `?view=boost`: Enter the booster and pilot application.
- `?view=extended`: Enter the Rating V2 analysis.
- `?view=profile`: Enter the user profile center.
- `?view=admin-users`: Enter administrator user management (requires `wotbtools-admin` role).
- `?view=reconstruction`: Enter AI Review (entry always visible; guests are redirected to sign-in and returned to this page).

A toolset for "World of Tanks Blitz".

Live tools: Extract combat data from `.wotbreplay` files to Excel, online damage leaderboard, Keycloak authentication.

Entry: [https://wotbtools.com](https://wotbtools.com)

## Current Goals

| Goal           | Technical Direction                                           | Status          |
|----------------|--------------------------------------------------------------|-----------------|
| Web Version    | Spring Boot 4 + Vue 3 + PostgreSQL + Docker + Keycloak        | ✅ Completed    |
| Toolset Home   | Vue SPA game tools style entry + Theme switching + Tri-lingual i18n | ✅ Completed |

See [CHANGELOG.md](docs/CHANGELOG.md) for version history and [TODO.md](docs/TODO.md) for task breakdowns.

## Current Implementation

| Version         | Tech Stack                                           | Entry                                                                                                    | Use Case                                            |
|-----------------|------------------------------------------------------|--------------------------------------------------------------------------------------------------|-----------------------------------------------------|
| Java Web Version| Java 21 + Spring Boot 4 + Vue 3 + Docker            | `docker\online\` local dev; CI/CD → GHCR `backend`/`frontend`/`keycloak` images             | Browser upload, online preview, leaderboard, REST API, Keycloak auth |

Documentation Entries:

- This file: Project overview, Java version usage and build.
- [HANDOVER.md](docs/HANDOVER.md): **Handover / AI Tool Migration Entry** (Environment pitfalls, CI/CD, deployment, conventions).
- [java/README.md](java/README.md): Java / Web version operation, interfaces, and deployment.
- [CHANGELOG.md](docs/CHANGELOG.md): Version history (External).
- [TODO.md](docs/TODO.md): To-do list.
- [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md): Maintenance context, architecture, replay format, i18n, testing strategy.
- [docs/replay-data.md](docs/replay-data.md): `data.wotreplay` event stream format, protobuf field table, death time estimation.
- [docs/rating-system.md](docs/rating-system.md): Rating algorithms, parameters, and display.

## Features

- Branding: Logo and favicon (single source in `common/assets/`, distributed to home page and frontend during Docker build).
- Parses combat data for 14 players from a single `.wotbreplay` file.
- Reads `meta.json` combat info, `battle_results.dat` (pickle + protobuf), and `data.wotreplay` event stream.
- Uses `tankopedia.json` to map vehicle IDs to vehicle name, tier, type, nation, and alpha damage.
- Single match Excel export: `Battle Info`, `Player Data`, `Raw Fields`.
- Multi-match Excel export: Deduplicates by `arenaUniqueId`, generates `Summary`, `Details`, and `Battle List`.
- Survival time column: Second-level estimation based on damage events.
- Self-contained performance **Rating**: Normalized by vehicle type benchmark (similar to WN8, 1000=average for type), single match "Rating", and aggregated "Average Rating".
- Rating badges: Replay preview shows medals for the highest rating and "gold shit" for the lowest, supporting a minimum value of `0`.
- Rating V2 analysis page: Accessible via main site `?view=extended` or independent entry `/extended`, displaying extended fields and real-time rating for current upload.
- Extended fields: `alpha_damage` and `rank` are integrated into API/export/extended page but not shown by default on the replay page; `xp` and `credits` are parsed and retained but not displayed as performance fields.
- Potential damage fields: `potential_damage` / `potential_damage_supplement` / `potential_damage_detail`, primarily inferred from direct HP damage events in the replay to identify targets; if events are missing or mapping fails, it conservatively equals actual damage.
- Shared map name dictionary: `common/map_names.json` provides `zh/en/ru` mappings; the web page displays based on current language, while exports continue to use Chinese.
- Empty metadata fallback: Replay recorders, nicknames, version numbers, map translations, or timestamps containing only spaces are treated as missing values to avoid polluting leaderboard records, summary nicknames, and time parsing.
- GUI supports selecting files or folders, previewing data, and merging summaries or exporting per match.
- Replay preview column selector saves column visibility and sorting for single match/summary separately to `localStorage`; new columns are automatically appended to the end of the current order.
- Java / Web version provides `/api/preview`, `/api/export`, `/api/columns`, `/api/rating`, and `/api/health`.
- **AI Tactical Review**: Random battles provide individual reports for the recorder; training rooms and leagues provide a "Team Perspective" report for the recorder's entire team. Supports single/multi-team modes, same-team perspective deduplication, independent analysis for both sides of the match, and an authoritative settlement fallback when the event stream is missing. Team reports clearly distinguish between total settlement and event stream observed subsets; they do not infer locations of unspotted enemies.
- **Tri-lingual Team Report Interface**: The AI Review page displays perspective team, duplicate perspectives, complete/degraded coverage, and data limitations; stable English error codes are localized via the zh/en/ru dictionary.
- Replay upload limits: Single file 20 MiB, max 100 files, total request 200 MiB; the parser also limits ZIP decompression, pickle/protobuf allocation, and single-instance concurrency, returning `REPLAY_BUSY` when capacity is full.
- Leaderboard: Records single-match damage of random battle recorders via the leaderboard upload entry; queried via endpoints like `/api/leaderboard/top-damage`.
- The toolset home page hero section displays the current highest single-match damage record; shows `--` when no data is available or the interface is unavailable.
- **Keycloak Authentication**: `https://auth.wotbtools.com` Keycloak container, realm `wotbtools`, client `wotbtools-web`. Frontend `check-sso` guest mode + login/logout; registration is hosted by the Keycloak realm.
- **User Profile**: `/profile` page displays username, logout button, leaderboard records, and an in-site notification panel; if the user is a booster, it shows ongoing and historical orders, with options to pause/resume receiving new orders. Non-logged-in users see a "Login" button triggering the Keycloak OIDC flow.
- **Booster Application**: `?view=boost` page allows players to submit booster applications. Administrators view a summary of the latest pending applications by default; clicking "Details" loads full profiles and screenshots with a zoom feature. Upon approval, the Keycloak `booster` role and booster profile are automatically linked. Database constraints are flushed first, and realm role changes are automatically compensated during transaction rollbacks. The booster management page displays qualification status (`status`) and availability (derived from `available + activeAssignmentCount` as Available/Busy/Paused). When assigning, boosters who are available and have higher matching scores are recommended. Boosters can accept, start, submit completion, or reject orders; clients can confirm completion; otherwise, it auto-confirms and releases the booster after 72 hours. The profile center allows reviewing historical orders, and status changes notify relevant users via in-site notifications.
- **Toolset Home Page**: `HomePage.vue` within the Vue SPA (card entries + version history); version history data is sourced from `frontend/src/data/versions.json`.
- **Sponsorship Page**: Home page retains tri-lingual sponsorship entries; reads `/sponsor-config.json` from the same origin at runtime. QR codes are read-only mounted from `/opt/wotb/config/sponsor/` on the VPS and are not included in the repository or image.
- **Domain Unification**: `wotbtools.com` and `www.wotbtools.com`, removing the `replay.wotbtools.com` subdomain.
- **Admin User Management**: `/api/admin/users` API for searching/viewing/deleting users; associated booster profiles without order history are cleaned up before deletion. Integrated with Keycloak Admin API, utilizing an `admin_user_log` table for auditing and `wotbtools-admin` role permission control.
- **API Internationalization Contract**: Backend returns only English raw enums, `code`/`error`, and data; readable statuses, success messages, and error text are rendered by the frontend via zh/en/ru dictionaries.
- **Default Deny Permissions**: Undeclared `/api/**` endpoints are closed; `boost-manager` only manages `/api/admin/boost/**`, while other backend interfaces like user management require `wotbtools-admin`.
- **Mobile Top Bar**: Replay analysis, leaderboard, profile, booster, and admin pages share a responsive top bar; theme/language/account entries wrap automatically without compressing the theme switcher.
- **Upload Area Icons**: Replay analysis and leaderboard upload areas share outlined SVG icon styles; native file controls are hidden within custom buttons.

> The leaderboard supports filtering by vehicle (click vehicle name to view specific damage board); URL parameter `?view=leaderboard` jumps directly to the leaderboard view.

## Running and Building from Source

### Java Version

Requires JDK 21, Maven, Node.js; Docker Desktop is required for full operation.

```bat
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml -pl wotb-core,wotb-web -am install
cd ..\docker\online
docker compose up -d --build
```

> The backend depends on PostgreSQL, Flyway, and Keycloak; it cannot run as a JAR without a database environment. Default Windows `java` might be JDK 8, so ensure `JAVA_HOME` points to JDK 21 before executing Maven.

## Updating Vehicle Library

The vehicle library `common/tankopedia.json` is the **single source of truth**, generated by `update_tankopedia.py` converting blitzkit's `tanks.pb`. It contains basic vehicle information and `alphaDamage`. To update after new game vehicles are added (requires network):

```bat
cd common/python
python update_tankopedia.py
```

No manual synchronization needed: `wotb-core` automatically copies `common/tankopedia.json` to the classpath during build.

## Testing

Java side:

```bash
cd java
set JAVA_HOME=%USERPROFILE%\.jdks\jdk-21.0.1
mvn -s settings.xml test
```

Frontend:

```bash
cd frontend
npm test
npm run build
```

## Production Database Backup

- Automatic backup of `wotb` and `keycloak` before deployment; `database-backup.yml` performs another backup daily at 03:15 HKT.
- Archives are stored in `/opt/wotb/backups/wotb/` and `/opt/wotb/backups/keycloak/`, retained for 7 days after complete read verification.
- Restoration is only permitted via manual SSH execution of `deploy/postgres-restore.sh`; files must be in the corresponding database directory, and `--confirm RESTORE-wotb` or `RESTORE-keycloak` must be explicitly passed. A safety backup is performed before restoration.

## Main Directories

| Path                            | Description                                                                          |
|---------------------------------|--------------------------------------------------------------------------------------|
| `common/`                      | Shared resources: `tankopedia.json`, `rating.json`, `map_names.json`, `assets/` (logo/favicon single source), `data/` (sample replays) |
| `common/python/`              | Vehicle library update script (`update_tankopedia.py`)                               |
| `java/`                       | Java main line (wotb-core + wotb-web)                                                |
| `java/wotb-core/`             | Shared core library: parsing, protobuf decoding, pickle reading, aggregation, POI export |
| `java/wotb-web/`              | Spring Boot 4 application: REST API + Leaderboard + Flyway                           |
| `frontend/`                   | Vue 3 frontend (including HomePage.vue, tri-lingual locale, shared theme variables)  |
| `frontend/src/data/`          | Pure frontend data (versions.json)                                                  |
| `docker/online/`              | Local developer: `docker compose up -d --build` to compile and start (4 containers incl. keycloak) |
| `docker/`                     | Dockerfile.backend / Dockerfile.frontend / keycloak (realm)                           |
| `deploy/`                     | nginx, init SQL, PostgreSQL dual-db backup/check/restore scripts                    |
| `.github/workflows/`          | Test gates, incremental deployment, daily database backups, and online diagnostics     |

## Data Sources and Limitations

`.wotbreplay` is essentially a zip package. This tool uses the following:

- `meta.json`: Basic info such as map, version, start time, duration, and recorder.
- `battle_results.dat`: `(arenaId, protobufBytes)` wrapped in pickle, where protobuf contains player stats.
- `data.wotreplay`: BigWorld event stream, used for survival time estimation and providing supported position, mapping, damage, and end events for the replay reconstruction performed internally by AI Review.

Event decoding only covers confirmed packets/fields; it does not speculate on frame-by-frame HP, unspotted enemy positions, individual shell trajectories, reloading, or equipment. The AI only receives deterministic compressed features and coverage, not the raw event stream.
