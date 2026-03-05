#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Build script: Compiles SDT's SDTDemix module to WebAssembly via Emscripten.
#
# Prerequisites:
#   - Emscripten SDK installed and activated (emcc on PATH)
#     https://emscripten.org/docs/getting_started/downloads.html
#   - Git (to clone SDT)
#
# Usage (from repo root):
#   npm run wasm:build
#   # or directly:
#   cd wasm && bash build.sh
#
# Output:
#   public/sdt-processor.js   – Emscripten glue module
#   public/sdt-processor.wasm – WebAssembly binary
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
SDT_DIR="$SCRIPT_DIR/SDT"
OUT_DIR="$REPO_ROOT/public"

echo "==> Checking Emscripten..."
if ! command -v emcc &>/dev/null; then
    echo "ERROR: emcc not found. Please install and activate the Emscripten SDK."
    echo "       https://emscripten.org/docs/getting_started/downloads.html"
    exit 1
fi
emcc --version | head -1

# ─── Clone / update SDT ───────────────────────────────────────────────────────
echo "==> Fetching SDT source..."
if [ -d "$SDT_DIR/.git" ]; then
    echo "    Existing clone found, pulling latest..."
    git -C "$SDT_DIR" pull --ff-only
else
    # Adjust the URL/branch if the repo has moved
    git clone --depth 1 https://github.com/SDT-org/SDT.git "$SDT_DIR"
fi

# ─── Locate SDT source files ─────────────────────────────────────────────────
SDT_SRC="$SDT_DIR/src"
if [ ! -f "$SDT_SRC/SDTDemix.c" ]; then
    echo "ERROR: SDTDemix.c not found in $SDT_SRC"
    echo "       Check if the SDT repository structure has changed."
    exit 1
fi

# Collect required C files (adjust list if SDT version differs)
SDT_C_FILES=(
    "$SDT_SRC/SDTCommon.c"
    "$SDT_SRC/SDTDemix.c"
    "$SDT_SRC/SDTFFT.c"
)

# Optional files that may or may not exist depending on SDT version
for optional in SDTAnalysis.c SDTSpectrum.c; do
    [ -f "$SDT_SRC/$optional" ] && SDT_C_FILES+=("$SDT_SRC/$optional")
done

# ─── Compile ─────────────────────────────────────────────────────────────────
mkdir -p "$OUT_DIR"

echo "==> Compiling with Emscripten..."
emcc \
    "${SDT_C_FILES[@]}" \
    "$SCRIPT_DIR/sdt_wrapper.c" \
    -I "$SDT_SRC" \
    -O3 \
    -lm \
    -s WASM=1 \
    -s MODULARIZE=1 \
    -s EXPORT_NAME=createSDTModule \
    -s ALLOW_MEMORY_GROWTH=1 \
    -s INITIAL_MEMORY=33554432 \
    -s EXPORTED_FUNCTIONS='[
        "_sdt_init",
        "_sdt_cleanup",
        "_sdt_process",
        "_sdt_free_result",
        "_sdt_alloc_f32",
        "_sdt_free",
        "_malloc",
        "_free"
    ]' \
    -s EXPORTED_RUNTIME_METHODS='[
        "cwrap",
        "ccall",
        "HEAPF32",
        "HEAP32",
        "getValue",
        "setValue"
    ]' \
    -o "$OUT_DIR/sdt-processor.js"

echo "==> Done!"
echo "    $OUT_DIR/sdt-processor.js"
echo "    $OUT_DIR/sdt-processor.wasm"
echo ""
echo "The app will automatically use the SDT WASM module if it is present."
