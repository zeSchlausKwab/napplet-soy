# Linked napplet previews

Implemented 2026-09-12. Catalog refresh follows standard manifest `app` references through Applesauce, verifies the linked signed metadata, and caches a normalized image. The gallery and player use that image; the existing 1200 × 630 OG card incorporates it. The catalog never executes downloaded napplets to generate previews, and page/image requests perform no remote metadata or image fetches.

## Supported metadata

The manifest link uses [NIP-5A's optional app descriptor reference](https://github.com/nostr-protocol/nips/blob/master/5A.md#upstream-app-descriptors), adopted with the manifest schema by the NIP-5D draft:

```json
["app", "31990:<descriptor-author-hex>:<identifier>", "wss://relay.example"]
```

- [NIP-89, kind 31990](https://github.com/nostr-protocol/nips/blob/master/89.md#handler-information): read `picture` from the descriptor's JSON content. When content is exactly empty, resolve the descriptor author's latest kind-0 profile and use its `picture`. Missing pictures, malformed JSON, and nonempty content without a picture do not trigger the profile fallback.
- [Zapstore software application metadata, kind 32267](https://github.com/zapstore/zsp#nostr-events): try `image` screenshot tags in order, then `icon` tags. This is the existing Zapstore format, not a claim that NIP-82 is an adopted NIP. Both descriptor kinds can be referenced with `app`.

Across linked descriptors, screenshots take priority over application pictures, then icons; declaration order breaks ties. Unknown descriptor kinds are ignored. No new manifest screenshot tag or Space descriptor is required. A napplet may reference a descriptor signed by a different author: the signed manifest must point to that exact kind/pubkey/identifier. Unrelated descriptors, forged signatures, ambiguous identifiers, and future-dated events are rejected. Select the newest signed event by Nostr ordering before interpreting its content; a newer descriptor that removes its image must not resurrect an old screenshot.

Preview metadata cannot override the manifest's title, identity, paths, artifact hash, or required capabilities. Missing or unusable previews leave the same napplet in the catalog with the generated poster. A descriptor is addressable, so even a pinned playable snapshot can receive updated presentation metadata on a later refresh; its executable bytes remain pinned.

## Fetching and caching

Descriptor queries use the configured discovery relays plus valid public WSS relay hints, capped at twelve destinations. Queries are exact author/kind/identifier filters, with a separate profile lookup only for the NIP-89 fallback. There is no publication, signing, AUTH response, or recursive descriptor traversal.

The metadata transport runs in a short-lived Node worker using Applesauce and pinned `ws` 8.21.3. Bun's native `ws` replacement ignores the required DNS/payload hooks, and loading the Node implementation inside Bun encountered an HTTP upgrade incompatibility during a live relay check. The worker preserves those controls, returns bounded signed events, and exits. Node is already needed by local PM2; linked descriptor lookup requires Node 20.19+ because of the pinned Nostr crypto dependencies. The live worker was tested with Node 24.14.0. No worker is launched when the catalog contains no supported `app` links. The worker bundle is temporary and is removed after each job.

Images must use public HTTPS on the default TLS port. DNS is checked in the actual connection lookup for both relay and image connections. Private/special addresses, credentials, redirects, inline data URLs, and active SVG/HTML documents are refused. Downloads forward no viewer cookies or authorization headers. Hash-shaped Blossom URLs are checked against the downloaded bytes; ordinary HTTPS URLs provide a signed URL association, not a creator-signed image digest.

PNG, JPEG, WebP, and GIF input is decoded using pinned Sharp 0.35.4. Take the first frame, apply orientation, strip metadata, and resize within 1200 × 750 while preserving aspect ratio. Cache only the resulting raster PNG. Input is limited to 5 MiB and 16 million pixels; normalized output is capped at 4 MiB. There are three concurrent image jobs and a 50 MiB download budget per refresh. Metadata/image enrichment has a shared 20-second deadline. Expensive or unavailable previews fall back without changing executable availability.

Catalog refresh has the existing fifteen-minute TTL. Cached verified images at content-addressed URLs can be reused; ordinary mutable HTTPS URLs are fetched again on refresh. Cache profile `app-descriptors-1` triggers enrichment once for an older catalog. Current and previous refresh images are retained; older PNGs are pruned after the new catalog is committed. Signed descriptor bindings, cached byte hashes, and PNG dimensions are checked when reading images. Corrupt or missing files yield the generated card. OG ETags include the rendered bytes; share metadata includes the selected image hash.

## Running and verification

```sh
bun run dev publicdev --refresh
# Or the production build behind local Caddy/PM2:
PORT=3020 bun run dev:prod publicdev --refresh
```

The latest public relay refresh found 93 manifests and no `app` references, so those entries still display generated cards. This does not establish that every public napplet lacks metadata. There are no invented previews or synthetic events inserted into the normal public catalog.

Signed offline fixtures verify descriptor selection, profile fallback, corrupt metadata and images, wrong hashes, unsafe URLs, image limits, cache reuse, generated fallback, and unchanged playback. An isolated browser-test catalog demonstrates the image in the gallery, player, and SSR OG metadata, verifies actual playback, and checks that the browser requests no third-party images. The metadata transport was also checked against a live NIP-89 descriptor on `relay.primal.net`; that descriptor is not added to the gallery.

```sh
bun run check
bun run build
bunx playwright test tests/browser/previews.spec.ts
```

Validation: 57 unit/integration tests, type checking, production build/startup, and five Chromium preview/public/runtime checks passed. The optional 78 MiB packaged-loader test was not repeated in this pass. No VPS deployment was performed.

The browser fixture is local test data with a public test key. It must never be published. The creator publisher now emits these same `app` conventions.


## Creator capture and publication (2026-09-14)

The CLI checks the built HTML in the same opaque sandbox before publication. It
also captures a 1200 × 750 PNG of the iframe after fonts load and a 1500 ms settle
period. Host controls are excluded. `napplet.json` may set `preview.delayMs` from
250 to 10000, or `preview.image` to a project PNG (up to 5 MiB, 4096 × 4096).
Explicit images are validated and included in the frozen source; automatic
captures are saved as `preview.png` beside the release's journal and source archive.

For an image the creator/AI can inspect before publishing:

```sh
soyli build
soyli screenshot
# Saves preview.png and selects it with preview.image in napplet.json.
# Existing images are preserved: use screenshot preview-2.png to capture again.
soyli publish --dry-run
soyli publish
```

Choose a representative state, especially for scenes requiring a start click.
The automatic fallback captures startup; it cannot judge whether that frame tells
the story of the app. The installed integration guidance requires visual inspection
as the finishing step. A manually captured PNG may be selected instead. Remove
`preview.image` to return to fresh automatic capture for each release.

Publishing uploads the PNG to the configured Blossom server, signs kind 32267
with an `image` URL, and links it from both current and snapshot manifests using
NIP-5A `app`. Each release uses its own descriptor identifier, preventing a later
CLI release from changing an earlier release's preview. The descriptor references
the current napplet through `latest`. Our primary relay must acknowledge the
descriptor and manifests before optional mirror copies. Mirror copies include the
descriptor. No viewer or app private key is involved in capture.

Frozen PNG bytes, hashes, descriptor signatures and acknowledgements survive
retries. Resume never recaptures or changes destinations. An older completed
publication without a preview can receive one on the next ordinary publish,
including when its executable bytes are unchanged; its old snapshot stays intact.
No existing live publication is automatically modified by installing the CLI.

Generated poster covers now fit fully inside the player at desktop and phone
sizes; actual screenshots retain their existing cover treatment. Regression tests
cover exact capture pixels, custom-image validation, resumed uploads/signatures,
legacy release upgrades, real local service readback, and browser cover fitting.

## Short video previews — soyLI 0.7.0

Implemented locally; CLI distribution and website deployment are separate steps.
Run `soyli record` after building, or use **Listing → Record clip** in `soyli dev`.
Recording uses Playwright 1.63.0's [screencast API](https://playwright.dev/docs/api/class-screencast)
in the same opaque sandbox as screenshots, with no creator credentials. Its cached
Chromium/FFmpeg tooling is installed automatically; no system FFmpeg or Bun install
is needed by a packaged CLI user. It records a fresh run of the built artifact,
not the in-progress session in the creator's visible browser.

The capture viewport is 960 × 600, with a selectable 2–8 second interval, a 0–10
second start delay after normal startup, and optional timed clicks/key presses.
The encoder can append a brief final still frame. The creator reviews the WebM
beside the static cover, title and other posting fields; recording does not publish.
A simple 2-second button scene measured 22,521 bytes and 2.56 seconds on macOS/Chromium.
This is a fixture measurement, not a size promise for complex scenes.

```json
{
  "preview": {
    "delayMs": 1500,
    "recording": {
      "startMs": 500,
      "durationMs": 6000,
      "actions": [
        { "type": "click", "atMs": 200, "x": 480, "y": 300 },
        { "type": "keyDown", "atMs": 1000, "key": "ArrowRight" },
        { "type": "keyUp", "atMs": 2200, "key": "ArrowRight" }
      ]
    }
  }
}
```

Actions are bounded data, never a project script: at most 32, timed within the
recording interval. Keys are arrows, Space, Enter, lowercase letters or digits.
Coordinates refer to the recording viewport. Use the start/duration controls to
select the captured interval; there is no separate editing timeline or audio track.
`soyli record preview-2.webm` preserves an existing clip and selects the new file.
The saved `preview.video` contains `file` and `artifactHash`. Publishing rejects an
older-build selection; record again or remove `preview.video` for a static-only
release. The clip is included in source/remixes and frozen in the release journal.
Resuming preserves its bytes, destinations and signatures.

### Signed association and interoperability

The manifest still links the exact per-release kind-32267 app descriptor with the
existing `app` tag. Its normal `image` tag remains the PNG. Video uses
[NIP-92](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/92.md):
the descriptor content includes the Blossom video URL and an `imeta` tag associates
`url`, `m video/webm`, `x`, `size`, `dim`, `alt` and `thumb` from
[NIP-94](https://github.com/nostr-protocol/nips/blob/a2494f4f81d46684e5814a9bf35e2b1df978f955/94.md).
This applies NIP-92's generic attachment convention to the linked app descriptor;
it does not claim a Zapstore-specific trailer standard or a new NIP-5D field.
Unsupported clients can ignore it and retain the same executable and screenshot.
No video URL is added to the playable `path` entries or used to override identity.

Discovery verifies the manifest → descriptor → exact URL/digest binding. The URL
must appear in descriptor content, and ambiguous duplicate metadata is rejected.
The same adapter applies to every publisher. The newest signed descriptor is chosen
before interpreting attachments, so removing a clip cannot resurrect an older one.
Independent clients have not yet been tested for rendering this attachment.

### Delivery and playback limits

The initial profile accepts one silent VP8 WebM track, up to 12 seconds, 1200 × 750,
5 MiB and 600 frames. MP4, VP9, audio tracks, laced blocks, encrypted tracks,
attachments and chapters are outside this initial profile. Capture/publish decodes
an actual frame in Chromium. Server admission follows the [WebM container structure](https://www.webmproject.org/docs/container/) and checks bounded EBML structure, track
metadata, timestamps and VP8 keyframe dimensions; it is not a full codec decoder.
A corrupt or unsupported clip falls back to the static cover in the browser.

Remote URLs use the existing public-HTTPS/DNS/redirect policy. If an operator sets
`SPACE_INDEX_LOCAL_BLOSSOM`, video lookup first checks that exact numeric-loopback
CAS at the signed hash, supporting local publications and avoiding a public download
for already-hosted clips. Events cannot choose another local origin, path or query;
a public URL is used as fallback when the configured cache misses. Signed SHA-256 is
required for this optional video profile, and every downloaded byte is verified.
Video indexing allows two concurrent jobs and reserves at most 20 MiB per refresh,
with a 5-second per-download timeout under the existing metadata deadline. The
persistent index keeps image/video cache data within its shared 256 MiB cap;
public-dev keeps current/previous refresh clips. Cache version is now
`app-descriptors-2`. Serving rechecks metadata, hash and container properties;
`/api/preview-videos/<manifest-id>` supports GET/HEAD and single byte ranges, with
moderation checks, `nosniff` and no request-time remote fetch.

Gallery clips have no `src` until mouse hover or an explicit **Preview clip** click.
Only one clip plays at a time, silently; leaving the card, scrolling it out of view,
hiding the tab or unmounting releases its media source. Reduced-motion and
Save-Data visitors get the static cover until explicitly requesting a clip.
Viewer preview playback never creates a napplet iframe. The Play button still
starts the ordinary verified napplet. OG continues to use a static PNG.

Local evidence: real recording and stale-build check; signed publication interrupted
and resumed with identical clip bytes/events; metadata/cache/range rejection tests;
Chromium listing review, gallery lifecycle/reduced-motion, and static OG checks.
