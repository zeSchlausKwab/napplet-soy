#!/bin/sh
set -eu

# Napplet Space creator CLI. Inspect this script before running it if you prefer.
# Downloads are immutable by version; the archive is verified before extraction.
version=0.3.1
base=${NAPPLET_DOWNLOAD_BASE:-https://napplet.soy/cli/download}
install_root=${NAPPLET_INSTALL_DIR:-"$HOME/.local/share/napplet-space"}
bin_dir=${NAPPLET_BIN_DIR:-"$HOME/.local/bin"}
fail() { printf '%s\n' "$*" >&2; exit 1; }
case "${1:-}" in
  --help) printf '%s\n' 'Install: curl -fsSL https://napplet.soy/install.sh | sh' 'Create:  curl -fsSL https://napplet.soy/install.sh | sh -s -- new my-napplet' 'Requires macOS or glibc Linux, curl, tar, and SHA-256 tools. Git is needed to create/publish.' 'Optional: NAPPLET_INSTALL_DIR and NAPPLET_BIN_DIR (absolute paths). No sudo or shell-profile edits.'; exit 0 ;;
esac
case "$install_root:$bin_dir" in /*:/*) ;; *) fail 'Installation directories must be absolute paths.' ;; esac
case "$base" in https://*|http://127.0.0.1:*|http://localhost:*) ;; *) fail 'Downloads require HTTPS (or loopback for local testing).' ;; esac
case "$(uname -s)" in Darwin) os=darwin ;; Linux) os=linux ;; *) fail 'This installer supports macOS and Linux. On Windows use a supported Linux desktop environment; a native Windows package is not available yet.' ;; esac
case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64|amd64) arch=x64 ;; *) fail 'Supported processors: Apple Silicon/ARM64 and x86-64.' ;; esac
# Prefer the native Apple Silicon package even from a terminal running in Rosetta.
if [ "$os" = darwin ] && [ "$(sysctl -in sysctl.proc_translated 2>/dev/null || true)" = 1 ]; then arch=arm64; fi
if [ "$os-$arch" = darwin-x64 ]; then
  sysctl -n machdep.cpu.leaf7_features 2>/dev/null | grep -q AVX2 || fail 'The Intel macOS package requires AVX2. Older Intel Macs are not supported by the bundled runtime.'
fi
if [ "$os-$arch" = linux-x64 ]; then
  grep -q -w sse4_2 /proc/cpuinfo || fail 'The x86-64 Linux package requires SSE4.2.'
fi
if [ "$os" = linux ]; then
  command -v getconf >/dev/null 2>&1 && getconf GNU_LIBC_VERSION >/dev/null 2>&1 || fail 'This Linux package needs glibc (e.g. Ubuntu/Debian/Fedora). Alpine/musl is not supported.'
fi
for tool in curl tar tty; do command -v "$tool" >/dev/null 2>&1 || fail "Install $tool first, then retry."; done
if command -v sha256sum >/dev/null 2>&1; then hash() { sha256sum "$1" | cut -d ' ' -f 1; }
elif command -v shasum >/dev/null 2>&1; then hash() { shasum -a 256 "$1" | cut -d ' ' -f 1; }
else fail 'Install a SHA-256 tool (sha256sum or shasum) first.'; fi
mkdir -p "$install_root/releases" "$bin_dir"
# Do not replace a command that belongs to a different installation.
if [ -e "$bin_dir/napplet-space" ] || [ -L "$bin_dir/napplet-space" ]; then
  [ -L "$bin_dir/napplet-space" ] || fail "$bin_dir/napplet-space already exists and is not managed by this installer."
  case "$(readlink "$bin_dir/napplet-space")" in "$install_root"/releases/*/napplet-space) ;; *) fail 'An existing napplet-space command belongs to another installation.' ;; esac
fi
stage=$(mktemp -d "$install_root/.install.XXXXXXXX")
link_stage=''
cleanup() { rm -rf "$stage"; [ -z "$link_stage" ] || rm -rf "$link_stage"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
name="napplet-space-$os-$arch"
archive="$name.tar.gz"
fetch() { curl --fail --show-error --location --proto '=https,http' --proto-redir '=https' --connect-timeout 15 --max-time 300 "$1" -o "$2"; }
printf 'Downloading Napplet Space %s for %s…\n' "$version" "$os-$arch"
fetch "$base/$version/$archive.sha256" "$stage/checksum"
expected=$(cut -d ' ' -f 1 < "$stage/checksum")
case "$expected" in *[!a-f0-9]*|'') fail 'Invalid release checksum.' ;; esac
[ "${#expected}" -eq 64 ] || fail 'Invalid release checksum length.'
fetch "$base/$version/$archive" "$stage/$archive"
[ "$(hash "$stage/$archive")" = "$expected" ] || fail 'Download checksum mismatch; existing installation was kept.'
tar -tzf "$stage/$archive" > "$stage/entries"
while IFS= read -r entry; do
  case "$entry" in "$name"|"$name"/|"$name"/*) ;; *) fail 'Unexpected archive path.' ;; esac
  case "/$entry/" in */../*|*/./*) fail 'Unsafe archive path.' ;; esac
done < "$stage/entries"
tar -xzf "$stage/$archive" -C "$stage"
[ -x "$stage/$name/napplet-space" ] || fail 'The archive did not contain an executable.'
"$stage/$name/napplet-space" --version
release="$install_root/releases/$version-$os-$arch-$expected"
if [ ! -d "$release" ]; then mv "$stage/$name" "$release"; fi
link_stage=$(mktemp -d "$bin_dir/.napplet-link.XXXXXXXX")
ln -s "$release/napplet-space" "$link_stage/napplet-space"
mv -f "$link_stage/napplet-space" "$bin_dir/napplet-space"
printf '\nInstalled %s\n' "$bin_dir/napplet-space"
case ":${PATH:-}:" in *:"$bin_dir":*) ;; *)
  # JSON is not shell quoting: escape single quotes for an exact copyable command.
  quoted_bin=$(printf '%s' "$bin_dir" | sed "s/'/'\\\\''/g")
  printf "For this terminal, run: export PATH='%s':\"\$PATH\"\n" "$quoted_bin"
  printf 'Add that line to your shell profile to keep the command available.\n' ;;
esac
if [ "$#" -gt 0 ]; then
  export PATH="$bin_dir:${PATH:-/usr/bin:/bin}"
  cleanup
  trap - EXIT INT TERM
  # curl | sh occupies stdin. Bun on macOS stops receiving delayed keypresses
  # through /dev/tty; reopen the actual device (e.g. /dev/ttys003) instead.
  # Prompts use stderr. If it is redirected, keep setup noninteractive.
  terminal=''
  if [ -t 2 ]; then terminal=$(tty <&2); fi
  case "$terminal" in
    /dev/tty) ;; # The generic alias has the same polling problem; skip prompts.
    /dev/*) [ ! -c "$terminal" ] || exec "$bin_dir/napplet-space" "$@" <"$terminal" ;;
  esac
  # Headless installation still supports explicit options such as --identity later.
  exec "$bin_dir/napplet-space" "$@" </dev/null
fi
printf '\nStart with: napplet-space new my-napplet\nHelp: https://napplet.soy/cli\n'
