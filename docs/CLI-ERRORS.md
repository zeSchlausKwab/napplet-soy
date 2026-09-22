# soyLI error diagnostics

Source **0.16.2** replaces the top-level `CLI_FAILED` message with a shared
diagnostic. Failures report the operation, original error message/code, available
tool exit status or service HTTP status, underlying causes and a recovery step.
These changes and the 0.16.3 improvements below ship in **0.17.0**.

Source **0.16.3** also retains Git failure output from **both stdout and stderr**.
Git merge preflight reports conflicts on stdout, including affected filenames;
those details now reach terminal, JSON and local review errors. A conflict still
leaves the working tree untouched. Both streams use the same bounded secret
redaction as other tool errors.

Optional publication copies retain `mirrorErrors` alongside the existing
`mirrors` success flags in `soyli publish` / `soyli status --json` and the saved
journal. Each failure identifies the public event ID/kind, attempt time, diagnostic
and retryability. Terminal output and the workshop also show these nonfatal
warnings. A failed mirror does not undo primary publication; a successful retry
clears that mirror's failure. Older journals without this field remain readable.
Run `soyli publish` again to repair copies of the saved release; unchanged source
reuses the existing signed events. Failed primary publication still uses
`publish --resume`.

For example, a failed project dependency installation can report:

```text
PROJECT_TOOL: The project tool reported a failure.
Operation: install project dependencies
Tool: pnpm
Exit status: 1
ERR_PNPM_OUTDATED_LOCKFILE …
Next: Fix the tool error shown above and retry setup/build or the requested project command.
```

There is no debug flag to discover before obtaining useful errors. Missing files
include their path; invalid configuration reports field paths. JSON parsing errors
omit input excerpts. The normal CLI error includes its version and platform.

## For agents and bug reports

For commands supporting `--json`, stdout contains an error envelope:

```json
{
  "error": {
    "code": "PROJECT_TOOL",
    "message": "The project tool reported a failure.",
    "operation": "install project dependencies",
    "details": ["Tool: pnpm", "Exit status: 1", "ERR_PNPM_OUTDATED_LOCKFILE …"],
    "recovery": "Fix the tool error shown above and retry setup/build or the requested project command."
  },
  "version": "0.16.2",
  "platform": "darwin-arm64"
}
```

Tool progress stays on stderr. Publication errors also retain `stage` and
`retryable` when available; their saved retry records retain the sanitized cause.
A failure to save that record is reported explicitly. Inspect `soyli status`
before resuming a release; `publish --resume` uses the saved bytes and signatures.
Use `propose --resume` for a saved proposal. Do not recreate a project or identity
to work around an unrelated failure. `run`/`exec` continue passing their trailing
arguments to the project command, including any `--json` flag.

The local workshop and review UI receive the same formatted diagnostic. Existing
local HTTP error responses retain their `error` text and add a `diagnostic` object.

## Wrapped operations

- **CLI updates:** release lookup retains HTTP status and timeout causes; installer
  failures retain sanitized curl/tar output and exit status. Doctor reports an
  unavailable release check alongside local diagnostics. `soyli update --json`
  keeps installer progress on stderr and emits one structured result/error.
- **Git:** startup, exit status, bounded stdout/stderr, timeout and output-limit errors.
  Failed source alternatives retain their causes when no source succeeds.
  Proposal inbox confirmation includes failed Git ref pushes, and Git execution
  errors are distinguished from merge conflicts or an advanced upstream branch.
- **Project tools:** setup, build and other wrapped commands retain a sanitized
  output tail. Vite watcher failures include their output and exit status when
  available. Toolchain downloads identify their destination and HTTP failure.
- **Browser:** installer output/status, cancellation and timeout are distinguished.
  Startup checks preserve browser errors and a bounded sample of script errors.
- **Relays and Blossom:** exhausted remix lookups/downloads retain individual
  failure causes; publication refusals identify the service and reported reason.
  A successful fallback is still a success.
- **Credentials:** OS-store failures identify read/write/delete and supplied
  OS error code/errno. Raw credential-store exception text is deliberately omitted.
  No usable diagnostic data from the OS is reported as such.

This is a diagnostic boundary, not a change to the NAP protocol, storage policy,
publication checks or retry semantics. Optional missing metadata can still be
absent without failing an otherwise successful operation.

## Bounds and sensitive data

`packages/diagnostics/src` handles formatting and scrubbing for the terminal, JSON
and local UI. It removes recognized private keys, signer connection URLs, URL
credentials/query/fragment, JWTs, common labeled secrets and terminal controls.
All 64-character hexadecimal strings are obscured because a private key cannot
be distinguished from a public hash by shape alone.

Tool output is processed by line, including across stream chunks. Each stream
retains an 8 KiB tail; oversized lines are omitted. Diagnostics retain up to eight
2,000-character details, with bounded cause depth and aggregate traversal. No
argument, environment, request or credential dumps are collected. Redaction
cannot identify arbitrary unlabeled secrets printed by third-party programs;
do not print credentials in project scripts. The original error stays available
internally while only the selected, sanitized diagnostic is displayed or saved.

Regression tests exercise the actual CLI entrypoint, including a failing tool
fixture, and can run against a compiled binary with `SPACE_TEST_CLI=/absolute/path/to/soyli`.
Shared tests cover cause cycles, configuration values, split-chunk secrets and
bounded output; credential tests check that only OS codes cross the vault boundary.
