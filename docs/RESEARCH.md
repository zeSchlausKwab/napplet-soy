# Upstream observations

## Integrated upstream starter — 2026-09-14

CLI 0.2.0 now uses the creator-maintained boilerplate as its default, superseding
this document's earlier suggestion to make it optional. Snapshots pin boilerplate
`cbbebe9bd56271277b054535c0a8d720a588f61d` and skills
`976ad0549c38f93d4ed418d3ea59a615a7e5fd7f`. The source, Vite configuration, scripts,
lockfile and eight skill bodies remain upstream; see [CLI.md](CLI.md) for the small
integration surface and update process.

Verified: upstream's six guidance tests, TypeScript and build; its reference
conformance harness (5 passed, 0 failed, 5 explicitly skipped: unsigned-manifest,
wire/lifecycle coverage); our sandbox startup; upstream SDK storage roundtrip;
Vite rebuild/reload and explicit required-domain metadata; a signed publication
using built HTML while retaining editable source; and standalone scaffolding with
no global runtimes on PATH. No test creation was published to public relays.

Skill bodies and YAML frontmatter are preserved exactly. Seven pass the local
skill-creator linter; `napplet-interop` uses literal `<archetype>/<intent>` placeholders
in its description, which that stricter linter rejects despite valid YAML. We retain
upstream's text. This host does not yet grant that skill's cross-napplet operations;
the project integration note states the current capability subset.

Earlier findings below are historical research, not the current implementation.

## Creator skills follow-up, 2026-09-14

Inspected live Git checkouts of [napplet/boilerplate at cbbebe9](https://github.com/napplet/boilerplate/tree/cbbebe9bd56271277b054535c0a8d720a588f61d)
and [napplet/napplet at 976ad05](https://github.com/napplet/napplet/tree/976ad0549c38f93d4ed418d3ea59a615a7e5fd7f).
These supersede the earlier template observations below for creator guidance;
no upstream installers, package scripts, or skills were executed or installed.

- The current boilerplate vendors no skill bodies. Its AGENTS.md/README point to
  `npx skills add napplet/napplet`; cached GitHub views can still show the older
  `.codex/skills` directory. The live repository contains eight skills:
  `napplet-make`, `napplet-design`, `napplet-ui`, `napplet-build`, `napplet-sdk`,
  `napplet-test`, `napplet-port`, and `napplet-interop`.
- This is a useful maintained source for authoring guidance, SDK examples,
  sandbox boundaries, optional-domain checks, and conformance workflows.
  Both repositories are MIT licensed; redistribution must retain attribution.
- Their workflow assumes `napplet create/init/paja`, `.napplet/config.json`,
  pnpm/Vite/TypeScript and a built `dist/index.html`. Our default workflow uses
  `napplet-space new/dev/check/publish`, `napplet.json`, and editable single-file
  HTML. Blindly copying the skills would teach commands and files we do not ship.
- Our generated AGENTS.md currently requires `window.napplet.shell.ready()` and
  teaches `shell.supports()`. These are additions in our runtime prelude, not
  surfaces shipped by the upstream shim/SDK. Current upstream guidance uses
  injected domain property presence. Remove those app-side dependencies when
  adding skills and verify the resulting artifact in another runtime.
- Package domains are not a claim about our host grants: for example, upstream
  examples cover publishing and ContextVM, while our playback policy currently
  denies social writes and does not expose the ContextVM bridge. Skills must
  distinguish protocol guidance from the target host's supported operations.

Recommended next implementation: ship a pinned, attributed skill bundle locally
with each generated project, with explicit adaptations for our CLI commands and
runtime profile. Provide an additive update path for existing projects, protect
creator edits, and verify discovery by supported coding agents. Keep the fast
single-file starter; consider the upstream TypeScript/Vite boilerplate as an
optional template. Its compact productivity-app styling is guidance, not a
protocol requirement for games, visual experiments, or memes. The skills feature
and runtime portability correction remain unimplemented at this checkpoint.

## Initial research, 2026-09-11

Checked 2026-09-11. Read source and documentation; no deployment, installer execution, live publication, or interoperability test was performed. Commits below are research snapshots, not a proven compatible release set. Package source does not establish that matching public release binaries exist.

Implementation follow-up: the initial application and local Caddy/PM2 deployment mode now exist. [IMPLEMENTATION.md](IMPLEMENTATION.md) records the tested package combination and verification boundaries. The upstream publish/GRASP/Blossom interoperability claims below remain unverified. Applesauce is the selected Nostr SDK; [its official documentation](https://applesauce.build/introduction/getting-started.html) and installed package types informed the event-store, relay, and signer adapters.

| Source | Observed revision | Consequence for planning |
| --- | --- | --- |
| [napplet/web](https://github.com/napplet/web/tree/1df6dc87e5eee7257af41efb6247d47ec019e3d8) | `1df6dc87e5eee7257af41efb6247d47ec019e3d8` | Reuse SDK, shim prelude, skills, CLI, and conformance tooling through pinned adapters |
| [napplet/naps](https://github.com/napplet/naps/tree/a040914b4bbd3a5cd8a14b0f316a723c968ebfb2) | `a040914b4bbd3a5cd8a14b0f316a723c968ebfb2` | Capability registry overview contains older manifest/bootstrap descriptions |
| [napplet/boilerplate](https://github.com/napplet/boilerplate/tree/3a8e81efc2c213b92c0f8841cd98edb131f76a1b) | `3a8e81efc2c213b92c0f8841cd98edb131f76a1b` | Useful maintained starting point, with single-file build and agent context; package/tooling versions need reconciliation |
| [NIP-5D proposal](https://github.com/nostr-protocol/nips/pull/2303) | Open, unmerged; head `24711d9c47bbdd07908bf1d52bf677d9cbc530f0` | Experimental contract; distinguish from adopted/stable interoperability |
| [ngit source](https://github.com/DanConwayDev/ngit-cli/tree/682b22a34baca24ddd3edde65f7490eb8f91e50c) | `682b22a34baca24ddd3edde65f7490eb8f91e50c` | Has defaults/JSON flags, named signer selection, credential storage, and Nostr Git remote-helper support |
| [ngit-grasp](https://gitworkshop.dev/danconwaydev.com/ngit-grasp) | GitWorkshop displayed `cdda4a23`, release `v3.0.2` | Maintained server candidate; deployment and interoperability still need testing |
| [ngit-relay](https://github.com/DanConwayDev/ngit-relay) | README marks repository archived | Do not use as the new server implementation |

Follow-up (2026-09-12): [PROTOCOL.md](PROTOCOL.md) supersedes the early custom `space` descriptor/discovery-tag recommendation below. The client and future publisher must use standard manifests, with optional presentation metadata and no Space-specific discovery or playback requirement. Local fixtures remain unpublished.

## Specific integration findings

- [CLI documentation](https://github.com/napplet/web/blob/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages/cli/README.md) describes `create`, `init`, agent skill installation, native key storage, NIP-46 pairing, deploy diagnostics, and snapshots. The package README describes bundled create/skills code while the root README still mentions a Node requirement; test the actual distributed binary rather than choosing one sentence as definitive.
- [CLI event constants](https://github.com/napplet/web/blob/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages/cli/src/types.ts) use `5129`, `15129`, and `35129`. These agree with the [current proposal text](https://github.com/dskvr/nips/blob/24711d9c47bbdd07908bf1d52bf677d9cbc530f0/5D.md), while the registry overview still describes `35128`.
- [Snapshot construction](https://github.com/napplet/web/blob/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages/cli/src/manifest.ts) copies an explicit tag list. Our proposed descriptor/discovery tags require adapter changes and round-trip tests.
- [Network deployment](https://github.com/napplet/web/blob/1df6dc87e5eee7257af41efb6247d47ec019e3d8/packages/cli/src/deploy-network.ts) uploads first, then publishes when at least one server has a complete file set. It does not by itself provide the product's Git/source/indexing transaction.
- [ngit CLI options](https://github.com/DanConwayDev/ngit-cli/blob/682b22a34baca24ddd3edde65f7490eb8f91e50c/src/bin/ngit/cli.rs) include `--defaults`, `--json`, and `--signer`. [Credential storage](https://github.com/DanConwayDev/ngit-cli/blob/682b22a34baca24ddd3edde65f7490eb8f91e50c/src/lib/login/credential_store.rs) has multiple fallback policies. Safe shared signing is an integration task, not a behavior established by these flags alone.
- [Blossom specifications](https://github.com/hzrd149/blossom) define hash-addressed blob retrieval and upload. Current [BUD-11](https://github.com/hzrd149/blossom/blob/master/buds/11.md) specifies action, expiration, hash, and optional server scoping for authorization. Verify the actual deployed server/client versions agree; older clients may follow earlier BUD organization and auth encoding.
- GitWorkshop's current GRASP README describes a combined Rust Git/relay server with inline push validation, synchronization, moderation, and deletion handling. Its “production ready” label is an upstream claim; this planning exercise did not independently validate that claim.

## Decisions that remain hypotheses

The 10 MiB artifact ceiling, local-only initial runtime, template selection, initial OS matrix, timing targets, `space` descriptor tag, and CLI name are recommendations. None is an existing protocol requirement or a user-approved final product constraint.

The proposed spec can be reviewed now. The next concrete engineering work is a small compatibility harness with fixtures and an end-to-end publish/remix experiment, followed by locking the tested versions.

## Rendering and development follow-up

The user accepted the overall plan and added requirements for production-like local services and named routes. [LOCAL-DEVELOPMENT.md](LOCAL-DEVELOPMENT.md) specifies the shared Compose environment. The initial React Router Framework Mode proposal has been reconsidered after the user's TanStack question; [WEB-ARCHITECTURE.md](WEB-ARCHITECTURE.md) now prefers TanStack Start as a candidate pending a compatibility spike. The user has confirmed shadcn/ui, but has not yet selected a framework.

Official [React Router rendering](https://reactrouter.com/start/framework/rendering), [routing](https://reactrouter.com/start/framework/routing), and [loader](https://reactrouter.com/start/framework/data-loading) documentation establish the proposed framework patterns. Its [adapter documentation](https://reactrouter.com/api/other-api/adapter) includes a Fetch-style handler but does not establish that our Bun/Vite integration has been tested. The docs currently expose an 8.x release line as well as versioned 7.x docs; choose exact compatible versions during the spike rather than copying an older major-version assumption.

[Docker Compose](https://docs.docker.com/compose/how-tos/production/) supports shared definitions with environment overlays. [Caddy](https://caddyserver.com/docs/automatic-https) supports local HTTPS with a trust-installation requirement. These capabilities support the design; no Compose stack, TLS setup, route registry, or SSR adapter has been implemented in this workspace.

## TanStack, Bun, and shadcn follow-up

- The current [Start overview](https://tanstack.com/start/latest/docs/framework/react/overview) labels Start Release Candidate, with a stable API, and documents SSR, server functions, and Vite or Rsbuild builds. Router and Start have different responsibilities; choosing Router alone does not supply the whole Start build/deployment integration.
- The [Bun hosting guide](https://tanstack.com/start/latest/docs/framework/react/guide/hosting) requires React 19+ for its Bun path and provides a Vite/Nitro Bun preset plus a native Bun server alternative. This is documented support, not a completed local compatibility test.
- [Bun's fullstack server](https://bun.sh/docs/bundler/fullstack) includes bundling and HMR. Vite is therefore not intrinsically required for Bun/React, but replacing Start's documented build integration would require additional work. The website's build choice and the creator template's single-file Vite build are independent.
- [shadcn's official TanStack Router guide](https://ui.shadcn.com/docs/installation/tanstack-router) demonstrates supported component setup. Use shadcn for the website without requiring it in every napplet.
