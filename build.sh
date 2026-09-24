#!/bin/sh
# Builds the native pikchr tools and the wasm bundle, then records what was built.
set -eu
cd "$(dirname "$0")"
sh vendor/build.sh
node build-manifest.mjs
