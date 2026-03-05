# Transient Splitter

A browser-based audio tool that separates a **48 kHz mono WAV** file into:

- **Transient** (percussive / attack) component
- **Tonal** (harmonic / sustained) component – output as a **seamless loop**

All processing runs entirely in the browser via a Web Worker.  No audio is ever uploaded to a server.

---

## Quick start

```bash
npm install
npm run dev
```

Open http://localhost:5173, drop a 48 kHz mono WAV file, adjust parameters, and download the results.

---

## How it works

### Primary engine — TypeScript HPSS

The app ships a full implementation of **Harmonic-Percussive Source Separation** (HPSS):

> Fitzgerald, D. (2010) *"Harmonic/Percussive Separation using Median Filtering"*

**Algorithm overview:**

1. **STFT** – windowed FFT of the input signal (Hann window, configurable size)
2. **Magnitude spectrogram** – compute `|X[t,k]|` for each time frame `t` and frequency bin `k`
3. **Harmonic median filter** – sliding median along the **time** axis → captures steady tones
4. **Percussive median filter** – sliding median along the **frequency** axis → captures broad-band transients
5. **Wiener masking** – soft mask with configurable power parameter splits the complex spectrum
6. **ISTFT / OLA** – inverse FFT + overlap-add reconstruction of both time-domain signals

### Optional enhancement — SDT WebAssembly

The [Sound Design Toolkit (SDT)](https://github.com/SDT-org/SDT) ships an `SDTDemix` module
for the same task. Compiling it to WebAssembly with Emscripten yields potentially higher quality
separation with a different algorithmic approach.

If `public/sdt-processor.wasm` is present the worker uses it automatically; otherwise it falls
back to the TypeScript HPSS engine.

### Seamless loop

After separation the tonal component is made loop-ready via an **equal-power cross-fade**:
the tail of the signal is blended into the head over a configurable window (10–500 ms).
The resulting file plays seamlessly when looped end-to-start in any sampler or DAW.

---

## Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| FFT Window Size | 2048 | Frequency resolution. Larger = more tonal clarity, more latency. |
| Harmonic Median L | 17 | Frames smoothed along time. Higher = more tonal content captured. |
| Percussive Median L | 17 | Bins smoothed along frequency. Higher = more transient content. |
| Wiener Power | 2.0 | Mask sharpness. Higher = harder separation, less bleed-through. |
| Loop Cross-fade | 100 ms | Cross-fade length for seamless tonal loop. |

---

## Building the SDT WASM module (optional)

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
2. Compile `SDTDemix.c` + `SDTCommon.c` + `SDTFFT.c` plus the wrapper
3. Output `public/sdt-processor.js` and `public/sdt-processor.wasm`

On next page load the worker detects the WASM module and uses it automatically.

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Build | Vite 6 |
| UI framework | React 19 + TypeScript |
| Styling | Tailwind CSS v4 |
| Audio processing | Web Worker + TypeScript HPSS |
| Optional WASM | Sound Design Toolkit via Emscripten |
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
