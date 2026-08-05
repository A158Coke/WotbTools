# WoTBTools

A toolset for World of Tanks Blitz: extract battle data from `.wotbreplay` replays and export to Excel, online damage leaderboard, real-time rating (Rating V2), AI tactical review, and Keycloak authentication.

Entry: [https://wotbtools.com](https://wotbtools.com) · Repository: [https://github.com/A158Coke/WotbTools](https://github.com/A158Coke/WotbTools)

## Documentation

- [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md) — architecture, repository layout, routes, i18n, testing, and deployment conventions (must-read for maintainers)
- [java/README.md](java/README.md) — running, APIs, and deployment of the Java / Web version
- [CHANGELOG.md](docs/CHANGELOG.md) — technical version history
- [CHANGELOG-PRODUCT.md](docs/CHANGELOG-PRODUCT.md) — product version history
- [TODO.md](docs/TODO.md) — task list
- [replay-data.md](docs/replay-data.md) — `data.wotreplay` event stream format and fields
- [rating-system.md](docs/rating-system.md) — rating algorithm and parameters
- [observability.md](docs/observability.md) — monitoring / logging / backups
- [team-ai-review-feature.md](docs/team-ai-review-feature.md) — AI team review feature notes

## Quick Start

- Local run / build: see [java/README.md](java/README.md) (local eight-service stack via `docker/online/`)
- Testing and quality gates: see [DEVELOPER_GUIDE.md](docs/DEVELOPER_GUIDE.md)
- Updating the tank database: `cd common/python && python update_tankopedia.py` (see DEVELOPER_GUIDE)

## Live Tools

Replay parsing & Excel export · Online leaderboard · Real-time rating (Rating V2) · AI tactical review (player / team) · Keycloak authentication · Booster & pilot management
