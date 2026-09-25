#!/bin/sh
# Run with an absolute path to an unpacked standalone soyli executable.
# Uses a fresh managed toolchain/browser cache; no global Bun/Node or signing key.
set -eu
soyli_bin=$1
soyli_work=$(mktemp -d)
trap 'rm -rf "$soyli_work"' EXIT
export SPACE_ACCOUNT_HOME="$soyli_work/accounts"
export SPACE_TOOLCHAIN_CACHE="$soyli_work/toolchains"
export PLAYWRIGHT_BROWSERS_PATH="$soyli_work/browser"
export PATH=/usr/bin:/bin
cd "$soyli_work"
"$soyli_bin" --version
"$soyli_bin" doctor
"$soyli_bin" new example --identity later --json
cd example
# Creation already saves the complete scaffold without a creator or Git identity.
[ "$(git rev-list --count HEAD)" = 1 ]
[ "$(git log -1 --format=%s)" = 'Initialize napplet with soyLI' ]
[ -z "$(git status --porcelain)" ]
# Native packages must include the visual guide and app-owned palette default.
[ -s docs/napplet-visual-design.md ]
grep -Fq 'const FOLLOW_HOST_THEME = false;' src/main.ts
grep -Fq 'App-owned colors' .agents/skills/napplet-ui/SKILL.md
grep -Fq 'App-owned colors' .claude/skills/napplet-ui/SKILL.md
# Verify dynamic guidance and actual compiler execution in every native package.
[ -s docs/napplet-dynamic-backends.md ]
[ -s docs/examples/backend-client.ts ]
[ -s docs/examples/backend-context.d.ts ]
[ -s .agents/skills/soy-backends/SKILL.md ]
[ -s .claude/skills/soy-backends/SKILL.md ]
"$soyli_bin" backend init-module --json
"$soyli_bin" backend check --json
# Compiling alone missed omitted source in frozen previews. Declare the module
# and exercise check/multiplayer through the packaged preview + WASM worker too.
"$soyli_bin" exec node -e 'const fs = require("node:fs"); const config = JSON.parse(fs.readFileSync("napplet.json", "utf8")); config.backend = {boards: [], modules: ["backend/backend.json"]}; fs.writeFileSync("napplet.json", JSON.stringify(config, null, 2) + "\n");'
# Verify the assembled starter, including our added docs, using its pinned deps.
"$soyli_bin" run verify
"$soyli_bin" check --json
cat > tests/backend-preview.mjs <<'EOF'
export default async ({players, check}) => {
  check('two isolated players with a configured backend', players.length === 2);
}
EOF
"$soyli_bin" multiplayer tests/backend-preview.mjs --json
"$soyli_bin" assets list --json
"$soyli_bin" config --json
printf '\nPlatform smoke-test edit.\n' >> README.md
"$soyli_bin" checkpoint 'Fresh platform check' --json
[ "$(git rev-list --count HEAD)" = 2 ]
"$soyli_bin" status --json
printf 'PLATFORM_SMOKE_PASS\n'
