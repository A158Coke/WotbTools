# bilibili UP recommendations

Source implementation for [#639](https://github.com/A158Coke/WotbTools/issues/639); production availability follows deployment. Primary maintenance language: English.

Public entry: More → Tools → Recommended creators (`?view=creators`); administration: the existing league-administration group (`?view=creators-config`). Category selection uses the `creatorCategory` route query and preserves browser history.

Visitors browse recommendation categories and creator cards without signing in. Signing in is required to favorite or unfavorite a creator. Management uses the existing `tournament-admin` role; the recommendation catalog is independent of tournament events.

## Public and management views

The public view groups creators by administrator-maintained categories. A creator belongs to at least one category and can appear in several. Cards always show all its categories. Each card contains its name, optional description/avatar, recommendation score out of ten, five-star representation including half stars, current favorite count, and its bilibili homepage link. The optional assessment level and evaluation disclaimer appear only when an assessment is enabled; a missing assessment does not mean the lowest level.

Only administrators see card edit/remove actions. Editing uses a dialog and takes effect immediately. Removing a creator removes its category links and favorite history while preserving category and level definitions and other creators. The confirmation text only asks whether to remove the creator.

The management view has a creator form beside catalog settings on desktop/tablet and above them on mobile. Settings contain categories, assessment levels, and the global favorite threshold. New creators default to three base stars; all administrator-entered fields can be edited without rebuilding the record or resetting its creation time, favorites, progress, or rewards.

The initial categories are 单车高伤回放类, 单车实况类, 直播类, 联赛类, 高手/大神类, 娱乐类. Initial assessment levels are 普通, 高手, 职业级, 殿堂级. Flyway inserts them once. They remain editable data, with no startup reseeding or hard-coded frontend enum.

## Favorite and score semantics

Base recommendation stars are an integer from one through five. The final recommendation score is `min(10, 2 * baseStars + rewardPoints)`. A half star represents one score point. A creator's assessment level is independent of its categories and recommendation score.

The catalog sorts by the capped final score descending and then by original creation time descending. An ID provides a stable order only when both values are identical. Favorite count and uncapped scores do not break ties.

Four distinct values are maintained: a user's historical favorite relationship and active state, current active favorite count, unsettled first-favorite progress, and already-earned reward points. The unique identity is `(creator_id, JWT subject)`, shared across every category. It is independent of linked WotB accounts and local profile provisioning.

| Operation | Active count | Progress and reward |
|---|---|---|
| First favorite while below ten | Increase by one | Add one progress, settle full threshold units, stop at ten and preserve all unconsumed progress |
| First favorite while already at ten | Increase by one | Leave progress/reward unchanged; record the first-favorite history |
| Repeated favorite or repeated unfavorite | Unchanged | Unchanged |
| Active favorite removed | Decrease by one | Keep progress and earned reward; keep the historical relationship |
| Previously removed favorite restored | Increase by one | Do not add progress or settle pending progress |
| Threshold edited | Unchanged | Preserve progress/reward; do not settle or scan creators |
| Base stars edited | Unchanged | Recalculate final score, preserve progress/reward; only a subsequent first favorite can resume settlement |

The threshold must be a positive integer. Its effective default is 200. There is no background scoring job. With a stable six-point base and threshold 200, scores at 199, 200, 400 and 800 first favorites are respectively 6, 7, 8 and 10.

Changing a threshold from 200 to 100 with progress 150 does nothing immediately. The next first favorite below ten produces progress 151, awards one point, and leaves 51. If the current score is nine and progress is 450, the next first favorite under threshold 100 awards only one point and retains 351. A paused progress value can therefore exceed the current threshold and must not be reset.

## Consistency and deletion

Favorite relationship changes, counts, progress and rewards commit in one PostgreSQL transaction. The fixed settings row is locked shared before locking the target creator for writing. Concurrent changes to different creators do not require an exclusive global favorite lock.

Low-frequency management mutations lock settings exclusively before any creator row. Category deletion uses an indexed existence query to reject deletion if any linked creator has no other category; the check and deletion are one transaction. Level deletion similarly rejects a level still referenced by any creator. Disabling assessment removes that creator's level reference. No partial dictionary deletion or automatic reassessment is allowed.

Canceled favorites retain history until their creator is removed, preventing repeat rewards. Any account-deletion integration must update active counts through the creator domain rather than cascade through a local-profile foreign key or reset reward history.

## HTTP and storage boundaries

The sole wire authority is `contracts/http/openapi.yaml`; generated TypeScript and Ajv validators are produced by `frontend/scripts/generate-api-contract.mjs`. Public catalog endpoints are under `/api/creators`; personal favorites require a Bearer token; management endpoints are under `/api/admin/creators` and require `tournament-admin`. Administrative path rules precede the generic admin matcher.

The public catalog has no per-user data. `GET /api/creators/favorites` supplies only the current subject's active creator IDs. Favorite PUT/DELETE expresses the desired active state and returns the authoritative creator card and current user's state. Editable payloads exclude system-maintained counters, rewards and creation time.

Homepage inputs are normalized HTTPS `space.bilibili.com/<numeric UID>` URLs. Backend validation rejects script schemes, credentials and lookalike hosts. The server does not scrape bilibili. Interface messages are localized in Chinese, English and Russian; creator and dictionary names are stored administrator content.

Avatar storage reuses the merged COS work in [#641](https://github.com/A158Coke/WotbTools/pull/641). The bounded COS adapter and byte-level image validation are shared; creators have their own namespace and durable reservations. Only attached READY avatars can be read publicly, so the form retains its local preview until a successful save. Uploads do not hold catalog/creator locks. Replacement, clearing, removal and abandoned uploads release references without deleting objects still used elsewhere. Runtime credentials never enter sources or tests; storage tests use fake COS.

`BROADCAST_COS_BUCKET/REGION/SECRET_ID/SECRET_KEY` remain the single credential/bucket configuration. `CREATOR_AVATAR_COS_PREFIX` defaults to `creator-avatars/` and passes through the existing Business API workflow and Compose owner. It must differ from the broadcast prefix, and the runtime identity needs Put/Get/Delete rights for both prefixes. The private bucket must follow the existing non-versioned storage contract. Unreferenced reservations have a 24-hour grace period, and hourly cleanup processes at most 100 per batch. A failed delete retains metadata for retry.

Object keys must match the currently configured prefix and canonical UUID. Before changing a prefix, migrate or retire its old objects and reservations; old keys are deliberately rejected after a namespace change. See [COS operations](../operations/league-broadcast-covers.md). Real production COS credentials and permissions require separate operator validation; ordinary tests never contact that bucket.

## Verification

Targeted service and HTTP tests cover validation, anonymous/authenticated/admin permissions, Jackson wire shape and score boundaries. PostgreSQL integration tests cover concurrent first favorites, repeated operations, threshold edits, pause/resume, category/level deletion races, removal and transactional rollback. Frontend tests cover shared creator identity across categories, server-driven scores, identity changes, stale asynchronous responses, dialog/edit flows and upload reservations. `npm run test:browser-creators` verifies desktop/tablet/mobile and both UI profiles, including focus and overflow, using the existing browser fixture server. It runs in the frontend owner's CI browser matrix. Repository-wide validation belongs to PR CI.
