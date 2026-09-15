# Direct protocol access

The interactive website is a Nostr client. Browser navigation resolves signed
napplet manifests, app descriptors, profiles, comments, reactions, deletions and
zap receipts through Applesauce WebSocket relay queries. Social actions and
profile updates are signed by the selected account and published directly to
relays; retries retain the same signed event.

**Network settings** in the footer opens `/network`. Relay and fallback Blossom
URLs are saved in this browser. Public HTTPS/WSS infrastructure may use custom
ports; plaintext access is limited to explicitly configured loopback development
services. Operator defaults come from the server's relay
configuration. Manifest `server` tags and valid runtime relay hints remain useful
across clients; they do not require registration in Napplet's index.

## Files and playback

Images, videos, avatars, banners and comment attachments use their published URLs.
Linked assets show the destination hostname and open the original file. A valid
signed app descriptor can supply media even when the optional server image cache
could not normalize or download it. Native media display does not claim to verify
the original file's digest on every view.

Executable HTML is fetched directly from Blossom and checked against the signed
manifest's SHA-256 hash before constructing an opaque, restricted iframe. The
iframe cannot access host storage, cookies, signers or the network itself. The
shared host mediates resource and relay requests locally in the browser, retaining
message correlation, quotas, cancellation and account/session isolation. Hash
addressed resource bytes are verified in the host. HTTPS resource bytes use a
bounded browser fetch; native audio uses the original HTTPS stream URL with the
existing gesture controls and teardown.

The source browser and README excerpt fetch the signed source archive URL and
verify its hash before parsing the bounded tar archive in browser memory. File
downloads use those verified bytes. Archive links go straight to storage. No
server extracts a source archive on behalf of an interactive request.

Storage and LNURL providers must support browser requests (CORS) for byte reads
and invoice JSON. There is no automatic Napplet proxy fallback. Native image,
video and audio display follows the browser's normal media rules. Visitors now
contact the selected providers directly, which can observe those requests.

## HTTP that remains

There are seven `/api/*` routes. Each represents state or output owned by this
website, rather than a required wrapper around a Nostr entity:

| Route               | Purpose                                                                                                                          |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `/api/admin-access` | Determine access to this site's administration UI.                                                                               |
| `/api/admin`        | Signed site moderation, admin membership and featured selections.                                                                |
| `/api/names`        | Claim and query this site's readable aliases; portable naddrs do not depend on them.                                             |
| `/api/health`       | Deployment and local service health.                                                                                             |
| `/api/og/:id`       | Generate this site's share image, including fallback artwork.                                                                    |
| `/api/profile-og`   | Generate this site's profile share image.                                                                                        |
| `/api/publications` | Optional confirmation that this site's index has observed a publication. Publishing to Nostr is already acknowledged separately. |

The sixteen former manifest, artifact, resource, relay-read, audio, social,
gallery-social, genealogy, profile, profile-image, profiles, source, comment-media,
preview image, preview video and zap routes are removed.

TanStack loaders retain server implementations for HTML rendering and link-preview
crawlers. Their browser implementations query protocols directly instead of
calling corresponding server functions. SSR-only protocol loaders are not exported
as callable HTTP server functions. Site policy/defaults, readable alias
mappings (including historical starter aliases) and About repository links are
site-owned loader exceptions. Starter manifests also resolve over Nostr. Featured records are resolved from the site's
selection over Nostr in the browser.

SSR and generated OG images may use the server index and normalized image cache.
They are conveniences for fast first responses and crawlers; the browser can
resolve an unindexed portable link through its own configured relays. Server
network fetches continue using the existing DNS-safe admission rules. Site
moderation is projected to the browser independently of data transport.

## soyLI

The shared preview host uses the same direct audio, relay and resource transports.
Its local server still serves editable build files and performs explicit local
capture/recording actions: those are filesystem operations, not protocol proxies.
Remix resolves the selected event over Nostr and downloads declared Blossom files
directly. The optional website-index confirmation and readable-name claim are
site-specific conveniences. Existing compiled binaries keep their bundled host
until a new CLI release is built and installed.

## Verification

The repository checks signature/target validation, bounded source parsing,
artifact integrity, direct relay reads through a real WebSocket fixture, remix
archive downloads, and audio lifetime/gesture behavior. Browser coverage uses an
independent relay and actual Blossom service while refusing removed protocol API
paths; it checks comments, profiles, playback, README/source browsing, original
asset links, advancing native video playback, mobile layout and SSR.

At this source checkpoint, type checking, 254 repository tests, the production
build, five direct-asset/browser tests and eight production-server integration
flows pass. Separate shared-preview media/deadline and compiled-remix checks also
pass. Fixtures publish only to isolated local relays; no test payments are sent.
This source change has not been deployed or released as a new soyLI binary.

Browser relay connections are shared between concurrent reads and publishing,
reused briefly, and closed after ten seconds idle (at most 24 destinations).
The verified-event store retains at most 8,000 events/16 MiB; conversation and
source caches are also bounded. First-load hydration initializes operator policy
before any child query, then refreshes server-rendered data over the protocols.
