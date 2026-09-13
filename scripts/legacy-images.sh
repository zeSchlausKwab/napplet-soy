#!/usr/bin/env bash
set -euo pipefail

# Run as the application user inside the deployment's bounded build scope.
# Build current image libraries for generic x86_64; never modify system libvips.
release_dir=${1:?release directory required}
tool_root=${2:?writable compatibility tools directory required}
[[ "$(uname -s):$(uname -m)" == Linux:x86_64 ]] || exit 2
vips_version=8.18.6
vips_sha=3c41e1d5458081bfa4a5bc54e116c46259c75c6760a18027764555632b9dda3e
build_id=$(sha256sum "${BASH_SOURCE[0]}" | cut -c1-12)
vips_root="$tool_root/libvips-$vips_version-$build_id"
export CFLAGS='-O2 -march=x86-64 -mtune=generic'
export CXXFLAGS="$CFLAGS"
if [[ ! -f "$vips_root/.ready" ]]; then
  mkdir -p "$vips_root"
  workspace=$(mktemp -d "$tool_root/vips-build.XXXXXX")
  trap 'rm -rf "$workspace"' EXIT
  curl --connect-timeout 10 --max-time 120 -fsSL "https://github.com/libvips/libvips/releases/download/v$vips_version/vips-$vips_version.tar.xz" -o "$workspace/vips.tar.xz"
  (cd "$workspace"; printf '%s  vips.tar.xz\n' "$vips_sha" | sha256sum -c -; tar -xJf vips.tar.xz)
  meson setup "$workspace/build" "$workspace/vips-$vips_version" \
    --prefix "$vips_root" --libdir lib --buildtype release --auto-features disabled \
    -Dcplusplus=true -Dexamples=false -Dmodules=disabled \
    -Djpeg=enabled -Dpng=enabled -Dwebp=enabled -Dexif=enabled -Dlcms=enabled -Dzlib=enabled \
    -Dnsgif=true \
    "-Dc_link_args=-Wl,-rpath,$vips_root/lib" "-Dcpp_link_args=-Wl,-rpath,$vips_root/lib"
  meson compile -C "$workspace/build" -j 2
  meson test -C "$workspace/build" --num-processes 2 --print-errorlogs
  meson install -C "$workspace/build" --no-rebuild
  touch "$vips_root/.ready"
fi

export PKG_CONFIG_PATH="$vips_root/lib/pkgconfig"
export SHARP_FORCE_GLOBAL_LIBVIPS=1
export LDFLAGS="-Wl,-rpath,$vips_root/lib"
export npm_config_jobs=2
export PATH="$release_dir/node_modules/.bin:$PATH"
cd "$release_dir"
sharp_dir=$(node -p 'require("node:path").dirname(require.resolve("sharp")) + "/.."')
# Uses locked node-gyp and node-addon-api from this release's dependencies.
(cd "$sharp_dir"; node install/build.js)
node -e 'const sharp=require("sharp"); if(sharp.versions.vips!=="8.18.6") throw new Error("Unexpected libvips"); for(const type of ["jpeg","png","webp","gif"]) if(!sharp.format[type].input.buffer) throw new Error(`Missing ${type} decoder`); sharp({create:{width:16,height:10,channels:3,background:"#ed7359"}}).png().toBuffer().then(bytes=>sharp(bytes).resize(8).png().toBuffer()).then(()=>console.log("Legacy image codec check passed"));'
