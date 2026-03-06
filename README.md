# Transient Splitter

A browser-based audio tool that separates a mono file into:

- **Transient** (percussive / attack) component
- **Tonal** (harmonic / sustained) component
- **Residual** (noise / other) component

All processing runs entirely in the browser via a Web Worker.  No audio is ever uploaded to a server.

---

## How it works

The [Sound Design Toolkit (SDT)](https://github.com/SDT-org/SDT) ships an `SDTDemix` module
for the same task. Compiling it to WebAssembly with Emscripten yields potentially higher quality
separation with a different algorithmic approach.

## Building the SDT WASM module

### Prerequisites

```bash
# Install Emscripten SDK
git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest
source ./emsdk_env.sh
```

### Compile

```bash
npm run wasm:build
```

This will:
1. Clone the SDT repository into `wasm/SDT/`
2. Compile SDT core, its JSON parser dependency plus a custom wrapper
3. Output `public/sdt-processor.js` and `public/sdt-processor.wasm`

On next page load the worker detects the WASM module and uses it automatically.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6 |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS v3 |
| Audio processing | Web Worker + TypeScript HPSS |
| WASM | Sound Design Toolkit via Emscripten |
| WAV I/O | Custom encoder/decoder (zero dependencies) |

---

## Development

```bash
npm run dev      # start dev server
npm run build    # type-check + production build
npm run preview  # preview production build
```

## License

MIT
