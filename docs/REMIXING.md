# Remixing

Choose **Remix this** on a napplet page and copy the command. It pins the selected manifest event, so a later publication cannot change the starting point:

```sh
napplet-space remix https://napplet.soy/r/EVENT_ID my-remix
cd my-remix
napplet-space setup
napplet-space dev
```

Use `--network local` with a local portable or pinned URL when developing. The CLI also accepts naddr, nevent, note and hexadecimal event identifiers. The website is an optional accelerator: relay lookup uses Applesauce, verifies signatures and matches the exact requested identity.

When the author supplies a signed `source-archive` hash URL, the CLI verifies and unpacks its bounded Git tar, checks its playable artifact against the selected manifest, and retains editable source and license files. It rejects traversal, links, Git internals and credential files. A `source-commit` is the author's recorded provenance; the downloader does not independently prove the archive came from that Git commit. Other publishers without this archive convention still support an HTML starting point using the hash-verified playable file. Missing licensing information becomes `UNLICENSED`, not an invented open-source grant.

The new project gets a fresh identifier, no original creator credentials or publishing destinations, retained runtime relay/asset hints, bundled creator skills, and a README attribution. It never executes downloaded scripts or installs dependencies automatically. Review the project before `setup` runs its build. Creator onboarding reuses or creates your own account and preserves the normal private-key backup outside Git.

Publication emits [NIP-5A ancestry](https://github.com/nostr-protocol/nips/blob/master/5A.md): a current remix's `a` is its immediate parent and `A` its original ancestor. A snapshot's `a` remains its own napplet address, with `A` inherited. The optional `remix-version` tag records the exact selected event; other clients can ignore it and still discover and run the remix normally.

The command ships in CLI 0.3.0. The locally prepared release has not been uploaded; operators must release its archives before deploying the matching installer.
