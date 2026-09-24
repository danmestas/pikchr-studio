#!/bin/sh
# Rebuilds public/pikchr.js and public/pikchr.wasm.
#
# Pikchr's own sources are not part of this repository. Point PIKCHR_SRC at a
# checkout of upstream Pikchr (https://pikchr.org, check-in a7f1c35bc0), and
# this script copies the four files it needs, applies the studio patch
# (vendor/studio.patch), and compiles. Requires a C compiler and emcc.
set -eu
cd "$(dirname "$0")"
: "${PIKCHR_SRC:?Set PIKCHR_SRC to an upstream Pikchr checkout (pikchr.y, lemon.c, lempar.c, VERSION.h)}"
rm -rf build && mkdir build
for f in pikchr.y lemon.c lempar.c VERSION.h; do cp "$PIKCHR_SRC/$f" build/; done
(cd build && patch -p1 < ../studio.patch)
cd build
cc -O2 lemon.c -o lemon
./lemon pikchr.y
cc -O2 -DPIKCHR_SHELL -DPIKCHR_STUDIO pikchr.c -lm -o ../pikchr
emcc -O2 -DPIKCHR_STUDIO pikchr.c -lm -s MODULARIZE=1 -s EXPORT_NAME=initPikchrModule -s ENVIRONMENT=web,worker,node -s STACK_SIZE=2097152 -s ALLOW_MEMORY_GROWTH=1 -s EXPORTED_FUNCTIONS='["_pikchr","_pikchr_studio","_malloc","_free"]' -s EXPORTED_RUNTIME_METHODS='["cwrap","UTF8ToString","HEAPU8"]' -o ../../public/pikchr.js
