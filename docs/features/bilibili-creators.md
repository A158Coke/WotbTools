# Bilibili creator recommendations

Implementation for [#639](https://github.com/A158Coke/WotbTools/issues/639). Primary maintenance language: English. Production availability follows deployment.

## Directory and access

Visitors browse the public directory without signing in. The primary navigation groups League standings, broadcasts and UP recommendations (`?view=creators`) before More, using one source for the desktop sidebar and mobile bottom tabs. More does not duplicate the public link. On narrow phones the bottom bar scrolls horizontally while preserving distinct 44px touch targets; active and keyboard-focused tabs are brought into view. Administration remains in the existing league-administration group (`?view=creators-config`), protected by `tournament-admin`. Category selection uses the `creatorCategory` router query and supports Back/Forward.

Administrators create, edit and remove creator records, categories and assessment levels. The directory has no favorites, voting pool, public submissions, reward progress, rating threshold or ordinary-user write API. Creator data and images belong to the site, independent of operator accounts; the feature neither stores uploader subjects nor changes account-deletion/audit behavior.

## Creator fields and consistency

A Bilibili UID is required and unique across the directory. It is transported as a string of 1–20 decimal digits, trimmed and normalized without leading zeros; all-zero input is rejected. Numeric JSON values are rejected to avoid browser integer precision loss. The server derives `https://space.bilibili.com/<UID>` and does not scrape Bilibili. Names are required (100 characters); descriptions are optional (2000 characters).

Each creator has at least one category, may belong to several, and displays every category. Assessment is optional: a null level hides the level and disclaimer, while an assigned level displays the site's evaluation disclaimer. Initial categories and levels are inserted only once by Flyway and remain administrator-maintained data.

Administrators set one through five whole stars, with three selected by default. The sole score projection is `2 * stars` (2/4/6/8/10). Sorting uses stars descending, original creation time descending, then ID for stability. Editing retains record identity and creation time. User activity does not affect ratings.

V35 creates the directory, dictionaries, category links, site-owned image ledger and one `creator_catalog_lock` row. The lock row is a technical anchor, not a configurable threshold. All directory writes lock catalog → creator → avatar in a short transaction. UID uniqueness is enforced by the database. Category deletion rejects any operation leaving a creator without a category; level deletion rejects referenced levels. Those checks and changes share the transaction, including concurrent edits and dictionary deletions.

## One-save avatar handling

Avatars are optional. Choosing an image creates only a local browser preview; canceling an unsent form creates no server object. Create/update uses one multipart request containing an application/json `payload` and, for replacement only, one `avatar` file. The payload never accepts an object key, arbitrary image URL, uploader or temporary avatar ID.

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

## Contract and verification

`contracts/http/openapi.yaml` is the wire authority. Public APIs are under `/api/creators`; authenticated management is under `/api/admin/creators`. The metadata read returns categories, levels and upload availability. There are no separate temporary upload/release, favorites or threshold endpoints.

Generated TypeScript/Ajv, fixtures, MockMvc serialization and permission tests cover the contract. Real PostgreSQL tests cover unique UIDs, directory transactions, reference protection and cleanup races. Image tests cover bounds, transparent/opaque inputs, all EXIF orientations and small output. Frontend tests cover one-save image handling, failures, administrator identity changes, filtering and navigation. The creator browser matrix checks both UI profiles and all three layout bands. PR CI provides repository-wide validation.
