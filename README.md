# Transient Split

A browser-based audio tool that separates a mono audio sample (from file or recorded from mic) into:

- **Transient** (percussive / attack) component
- **Tonal** (harmonic / sustained) component
- **Residual** (noise / other) component

All processing runs entirely in the browser via a Web Worker.  No audio is ever uploaded to a server.

---

## How it works

The application uses [Sound Design Toolkit (SDT)](https://github.com/SDT-org/SDT) `SDTDemix` module compiled in
WebAssembly to split audio samples into transient, tonal and residual components.

## Tech stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6 |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Audio processing | Web Worker + TypeScript HPSS |
| WASM | Sound Design Toolkit via Emscripten |
| WAV I/O | Custom encoder/decoder (zero dependencies) |

---

## Build the SDT WASM module

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
1. Clone the SDT repository into `wasm/SDT/` (excluded in .gitignore)
2. Compile SDT core, its JSON parser dependency plus a custom wrapper
3. Output `public/sdt-processor.js` and `public/sdt-processor.wasm`

On next page load the worker detects the WASM module and uses it automatically.

---

## Development

```bash
npm run dev      # start dev server
npm run build    # type-check + production build
npm run preview  # preview production build
npm run deploy   # publish to github pages
```

## License

MIT