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
