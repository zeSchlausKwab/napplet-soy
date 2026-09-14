# State backups and restoration

Deployment installs `napplet-space-backup.timer`, scheduled daily at 03:15 UTC with
up to 15 minutes of jitter. It invokes the current release's `scripts/backup.sh`.
Fourteen verified archives are retained under `/var/backups/napplet-space` (root-only).
The deployment and backup use the same exclusive lock; concurrent runs are refused.

The job stops only Napplet's five PM2 processes, copies consistent relay, Blossom,
GRASP, index, moderation and community directories, and restarts those processes
before compressing the copy. Napplet has a brief maintenance interruption during
that copy; Caddy and other websites remain running. Failure cleanup attempts to
restart stopped services. Neither a deploy rollback nor restoring only SQLite's
main file is a substitute for this full-state backup.

The private archive also includes `shared/server.env`, administrator keys and the
deploy profile when present. It includes GRASP's service identity and source Git
objects. It excludes PM2 logs/runtime files, Caddy's shared host configuration,
rebuildable application dependencies and CLI download archives. `release.json`
records the required website release. Retain the corresponding source revision and
rebuild/deploy it when recovering onto another VPS. Never publish these backups.

```sh
# Make an immediate backup on the VPS.
ssh root@159.198.46.2 'bash /opt/napplet-space/current/scripts/backup.sh'

# See the schedule and last result.
ssh root@159.198.46.2 'systemctl list-timers napplet-space-backup.timer; systemctl status napplet-space-backup.service'
```

Archives have an outer SHA-256 checksum and a per-file size/hash manifest. Verification
rejects corrupt data, unexpected paths, traversal, links and duplicate members.
Restore only accepts a **new** destination, so rehearsal cannot overwrite active
service data. Empty service directories are recreated.

```sh
python3 scripts/backup-data.py verify --archive /secure/path/napplet-TIMESTAMP.tar.gz
python3 scripts/backup-data.py restore \
  --archive /secure/path/napplet-TIMESTAMP.tar.gz \
  --destination /secure/path/restored-napplet
```

Keep the `.sha256` file next to the archive. Restore produces `state/`, `shared/`,
`release.json` and the manifest. Before an actual recovery, stop Napplet, retain the
current state as a rollback copy, select the matching application release, replace
the six service directories from `state/`, and restore required shared settings.
Set service-directory ownership back to `napplet:napplet` and private permissions,
then start services and verify health, relay reads, a Git clone and a known artifact.
The restore tool deliberately does not rewrite the shared Caddyfile or activate a
release; those are operator recovery steps affecting the running installation.

Daily archives are on the VPS. This protects against a bad update or accidental
state loss, but independent off-VPS copies are needed for loss of the whole server.
Copy a selected archive and its checksum to your own backup storage, and verify and
rehearse there too. No unconfigured third-party storage provider is used.
