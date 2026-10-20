# Bilibili UP and video recommendations

Implementation for [#639](https://github.com/A158Coke/WotbTools/issues/639). Primary maintenance language: English. Production availability follows deployment.

## Directory and access

Visitors browse without signing in. The primary navigation groups League standings, broadcasts and Bilibili recommendations (`?view=recommendations`) before More, using one source for desktop and mobile navigation. The entry shows two type cards: recommended UPs and excellent videos. Existing `?view=creators`/`creatorCategory` links still open UPs; `?view=recommended-videos` opens the same list component for videos. Both lists return to the type entry and share one primary navigation section. More does not duplicate the public link. Narrow-phone tabs scroll horizontally with distinct 44px touch targets, and active/keyboard-focused tabs are revealed.

Administration remains one page (`?view=creators-config`) protected by `content-admin`. `recommendationType=UP|VIDEO` selects its shared form and category dictionary, defaulting to UP. `tournament-admin` never implies content administration, and the site-wide `wotbtools-admin` gets both domains only because Keycloak expands its composite realm roles. Switching type or leaving with unsaved fields, dictionary input or an image requires confirmation; saving blocks navigation. Vue Router owns type/category history. Changing list type clears the previous category while retaining unrelated query parameters and the hash.

Administrators maintain both recommendation types and their separate category dictionaries; skill levels remain UP-only. The directory has no favorites, voting pool, public submissions, reward progress, rating threshold or ordinary-user write API. Records and images belong to the site, independent of operator accounts; no uploader subjects or account-deletion/audit coupling is added.

## Category filter presentation

UP and VIDEO cards share aligned heading, description/assessment, category and footer tracks within each grid row. Descriptions and all categories remain fully visible; there is no text truncation or extra expand action. The footer groups the manual score, external link and a separated administrator action row so differing copy lengths do not leave gaps between actions. Desktop cards place the score on the left and the external link on the right, wrapping when needed for long translations; tablet/mobile retain a stacked score and full-width link. Browsers supporting CSS subgrid align these tracks; other browsers retain the flex layout with the footer anchored at the bottom.

Cards use the same structure in Showcase and Classic, with semantic-token accent edges, icon badges, rating surfaces and hover/keyboard-focus elevation. Motion duration follows the existing reduced-motion tokens. VIDEO records always use a compact icon/title header; valid covers sit below it in the content area and retain their horizontal, uncropped image area. A covered card therefore cannot stretch adjacent coverless title headers. This presentation change does not enable uploads or change storage configuration.

Without a category link, the directory initially shows all creators with other category choices collapsed. An independent filter button reveals compact, wrapping category buttons; opening or closing this area makes no API request or history entry. The All categories button always clears the filter. When a selected category is collapsed, its name remains visible; an unknown category uses a neutral current-filter label.

Category deep links and Back/Forward into a category expand the choices. Data refresh and UI profile changes preserve the disclosure state. Collapsed choices leave the keyboard tab order, and closing returns focus to the toggle. An empty category dictionary has no toggle.

Anonymous and ordinary signed-in visitors see only populated types and categories. Only VIDEO having records still opens the main entry and VIDEO card; both types must be empty to hide the main entry. Direct links to an empty type show a not-yet-published notice, retry and a return-to-types action. After authentication initialization settles, a successful public refresh that removes the selected category replaces the URL with All categories of that type, preserving other query parameters and the hash. Pending authentication preserves administrator empty-category links. Failed reads do not count as empty content.

Authenticated `content-admin` users retain every technically supported type, the management entry and complete type-specific dictionaries, including empty categories. They can create each type's first record, and their selected empty category remains selected. These are presentation rules; administrator write permissions are unchanged.

## Shared types and video fields

V37 extends the existing five tables with immutable `UP`/`VIDEO` types on records and categories. Existing data defaults to UP; VIDEO categories start empty. The identifier constraint becomes `(type, bilibili_uid)`, with type-specific validation and a type-prefixed ordering index. Physical `bilibili_uid` and `avatar_id` columns remain; Java uses `externalId` and the new wire uses `externalId`/`imageUrl`. There are no video-only tables, author relationships or new lock services.

VIDEO requires uppercase `BV` followed by ten ASCII alphanumeric characters. Only surrounding ECMAScript whitespace is stripped; case is preserved and identifiers are case-sensitive. The server generates `https://www.bilibili.com/video/{BV}` without scraping Bilibili or checking video existence. AV IDs, short links, playlists, independent multi-part entries, embedded playback and downloads are out of scope. Titles/descriptions use the same 100/2000 Unicode code-point limits, with three manual stars by default. VIDEO has no skill controls, level or assessment disclaimer; non-null levels are rejected by both service and database.

All old and new writes validate category type within the same catalog transaction and use the existing advisory mutex. Record/category types cannot be changed. Cross-type ID access is rejected, and the old UP APIs never return or mutate VIDEO entries. Optional covers reuse the same image reference and cleanup ledger; rendering preserves their aspect ratio with `object-fit: contain` in a horizontal area. Both types protect referenced images from reclamation.

## UP fields and shared consistency

A Bilibili UID is required and unique within UP recommendations. It is transported as a string of 1–20 decimal digits, normalized without leading zeros; all-zero input is rejected. Leading/trailing whitespace follows the OpenAPI ECMAScript whitespace set, including non-breaking spaces and BOM; interior whitespace and control characters outside that set are rejected. Numeric JSON values are rejected to avoid browser integer precision loss. The server derives `https://space.bilibili.com/<UID>` and does not scrape Bilibili. Names are required (100 Unicode code points); descriptions are optional (2000 Unicode code points). Supplementary characters such as emoji count once in the API, browser validation and PostgreSQL.

Each creator has at least one category, may belong to several, and displays every category. Assessment is optional: a null level hides the level and disclaimer, while an assigned level displays the site's evaluation disclaimer. Initial categories and levels are inserted only once by Flyway and remain administrator-maintained data.

Administrators set one through five whole stars, with three selected by default. The sole score projection is `2 * stars` (2/4/6/8/10). Sorting uses stars descending, original creation time descending, then ID for stability. Editing retains record identity and creation time. Cards and details include a monotonically increasing version. Creates require a null expectedVersion; updates and deletes must carry the version the administrator viewed. A mismatch returns 409 CREATOR_CONFIG_CONFLICT without overwriting newer data. Removing a shared category also advances the affected creator versions. User activity does not affect ratings.

The directory uses five tables: creators, categories, category links, assessment levels and the site-owned image ledger. V35 remains an immutable historical migration; V36 removes its obsolete single-row `creator_catalog_lock` table without changing directory data. All directory writes acquire the same PostgreSQL transaction-level advisory lock through the existing creator repository, then lock creator → avatar in the original order. The two-integer key is `(1464816706, 1)` (namespace `WOTB`, creator catalog); it is separate from the replay-file single-bigint session-lock namespace. Acquiring it requires an existing transaction, and commit or rollback releases it automatically across backend instances. Image processing and COS I/O remain outside this short catalog transaction. UID uniqueness is enforced by the database. Category deletion rejects any operation leaving a creator without a category; level deletion rejects referenced levels. Those checks and changes share the transaction, including concurrent edits and dictionary deletions.

V36 requires replacing the old backend before the new backend migrates and accepts writes: old row locks and new advisory locks do not coordinate, and the old application still requires the removed table. The current TX deployment uses Compose `up -d --no-deps --force-recreate business-api` (`deploy/tx/deploy.sh`): for the configured single backend, normal container replacement already stops the old process before starting the new one. No additional server or database shutdown is required. If additional backend instances share this database, stop those old instances too, then start all instances on the new version after migration; do not mix the two lock protocols in a rolling deployment.

Rolling back to pre-V36 code requires stopping all new instances first and restoring the original empty lock structure (`CREATE TABLE creator_catalog_lock (id BIGINT PRIMARY KEY CHECK (id = 1)); INSERT INTO creator_catalog_lock(id) VALUES (1);`) before starting old instances. Keep Flyway history intact; when returning to V36 code after such a rollback, stop old instances and remove that restored lock table before starting the new version.

## One-save avatar handling

Avatars are optional. Choosing an image creates only a local browser preview; canceling an unsent form creates no server object. UP and VIDEO create/update use one multipart request containing an application/json `payload` and, for replacement only, one `image` file, with `imageAction` KEEP/REPLACE/REMOVE. The payload never accepts an object key, arbitrary image URL, uploader or temporary avatar ID.

| avatarAction | File | Effect |
|---|---|---|
| KEEP | Absent | Keep the database's current image; new creators have no image |
| REPLACE | Exactly one | Use a freshly processed image from this request |
| REMOVE | Absent | Clear the current reference |

Invalid action/file combinations are rejected. Only administrators can submit images. Saving failures retain the browser draft and selected file for retry. A server-acknowledged save completes the original form independently of a later catalog refresh; stale identity/editor completions cannot clear a newer draft.

The image processor accepts PNG/JPEG with a 10 MiB input cap, 16–8192 pixels on each side and at most 20 million total pixels. It validates headers before a subsampled decode, applies JPEG EXIF orientation, scales proportionally to a longest edge of 256 pixels without enlarging smaller images, and re-encodes a static thumbnail. Alpha images use PNG; opaque images use JPEG quality 0.85. Only the transformed bytes (at most 512 KiB), their type and SHA-256 are stored; original metadata is stripped. This path does not first decode a full-size image just to validate it. Existing broadcast/evidence image validation remains unchanged.

An internal PENDING reservation commits before the bounded COS PUT, then becomes READY. Compression and COS transfer hold no catalog/creator lock. The final catalog transaction rechecks references and attaches the image; failures leave an unreferenced ledger entry for cleanup. A failed/ambiguous commit never triggers an unsafe immediate external delete. Replacing, clearing or removing a creator detaches the old image without deleting objects still referenced elsewhere.

The public image API only serves referenced READY images. It reads at most 512 KiB and verifies stored size, hash and trusted content type; it does not fully decode the thumbnail on every GET. It supplies ETag, `nosniff` and a five-minute browser cache. Cards load images lazily.

## Storage and cleanup

`BROADCAST_COS_BUCKET/REGION/SECRET_ID/SECRET_KEY` remain the shared runtime-only COS credentials. `CREATOR_AVATAR_COS_PREFIX` defaults to `creator-avatars/` and must differ from the broadcast prefix. The bucket remains private and non-versioned; anonymous viewing goes through the read-only API, without a bucket-ACL change or a new CDN. The credentials need Put/Get/Delete permissions for both namespaces. See [COS operations](../operations/league-broadcast-covers.md).

Missing storage configuration disables image replacement only; text-only creation, KEEP and REMOVE remain available. The management metadata response returns dictionaries and `avatarUploadsAvailable`, with no editable settings/threshold endpoint.

Cleanup runs daily at 04:00 in `Asia/Hong_Kong` (UTC+8), handling at most 100 reservations that have remained unreferenced for at least 24 hours. Normal cleanup therefore takes about 24–48 hours; backlog, downtime or storage failure can extend this. Each deletion locks and rechecks the image and references. Failed attempts retain metadata and rotate behind other eligible candidates. Multiple instances may safely trigger the same cleanup; no new scheduler service or exact-once job registry is required.

Cleanup only touches canonical UUID keys in the creator namespace. A missing COS object is already deleted; failure retains the ledger for a later attempt. Before changing prefixes, migrate or retire old objects and reservations. Production bucket permissions require deployment-time verification; ordinary tests use fake COS.

## API boundary and independent deployment

The sole recommendation API is advertised by `recommendations-v1`. Clients use `/api/recommendations` and `/api/admin/recommendations`: lists and administrative reads/deletes require a type; one public `/categories` snapshot contains both types' populated categories. Category entries include type, cards/details use `externalId` and `imageUrl`, and cards provide `targetUrl`. Management metadata contains `type`, categories, levels and `imageUploadsAvailable`; VIDEO levels are empty. Multipart saves use `payload` plus an optional `image`, with `imageAction` KEEP/REPLACE/REMOVE and the same expected-version rules. UP-only level management uses `/api/admin/recommendations/levels` and `/levels/{id}`. Existing image GET URLs `/api/creators/avatars/{id}` remain valid for UP avatars and video covers.

Old UP-only catalog and management routes, DTO projections and frontend fallback are removed. The persisted data, type isolation, image lifecycle and version locks remain unchanged. VIDEO identifier conflicts return `RECOMMENDATION_ID_ALREADY_EXISTS`; UP conflicts retain `CREATOR_UID_ALREADY_EXISTS`. The shared level/name schemas remain because the current UP feature still uses them.

There is no fallback when `recommendations-v1` is absent: public and administrator entry points are unavailable and no recommendation directory requests are sent. Deploy and verify the current backend before the frontend; coordinate this release's moved level-management route. After VIDEO data exists, rollback must use a type-aware compatible backend rather than an older version that could misread videos as UPs. Do not reverse existing migrations or remove data. The pre-V36 rollback instructions above only apply before this typed schema/data extension.

The anonymous `/api/health` response retains `status` and `tanks` and advertises only `recommendations-v1` for recommendations. Health does not query the directory. Public visibility comes from the populated-category snapshot, not from the technical capability marker. Direct links to an unavailable backend show a retryable availability notice without directory requests.

AppShell owns one shared public category snapshot and bounded, coalesced health/category reads. It refreshes on initial load, network recovery, window focus, explicit refresh/retry and acknowledged administrator mutations; there is no background polling or persistent cache. Mutation acknowledgements invalidate pre-write reads. Transient read failures retain the last successful snapshot and existing drafts; write success remains independent of a subsequent refresh failure. Private management metadata never enters the public snapshot. Changes made by another session become visible on the next successful refresh, not through realtime push.

The public category endpoint uses one indexed `EXISTS` query over existing category links, regardless of caller role. Administrator metadata returns the full dictionary of its requested type. No new table, counter, scheduler or external cache is required. The user confirmed that the retired interfaces were only used internally with no user adoption; this release is an explicit patch exception, Android 3.13.1, with Bridge v3 and minimum supported version 3000000 unchanged. Internal test clients must use the new bundle; the old interface is not restored. See [release notes](../android/releases/3.13.1.md).

## Contract and verification

`contracts/http/openapi.yaml` is the wire authority. UP and VIDEO use `/api/recommendations` and `/api/admin/recommendations`; only persisted image GET URLs keep the creators prefix. Metadata returns categories, levels and upload availability. There are no separate temporary upload/release, favorites or threshold endpoints. Tests for the removed UP-only API are deleted or migrated to the current contract; current business invariants and data protection remain covered.

Generated TypeScript/Ajv, fixtures, MockMvc serialization and permission tests cover the contract. Real PostgreSQL tests cover unique UIDs, directory transactions, reference protection and cleanup races. Image tests cover bounds, transparent/opaque inputs, all EXIF orientations and small output. Frontend tests cover one-save image handling, failures, administrator identity changes, filtering and navigation. The creator browser matrix checks both UI profiles and all three layout bands. PR CI provides repository-wide validation.
