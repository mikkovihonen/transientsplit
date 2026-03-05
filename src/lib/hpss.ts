/**
 * Harmonic-Percussive Source Separation (HPSS)
 * Based on: Fitzgerald, D. (2010) "Harmonic/Percussive Separation using Median Filtering"
 *
 * - Harmonic (tonal) component: median filter along TIME axis
 * - Percussive (transient) component: median filter along FREQUENCY axis
 * - Wiener masking with configurable power parameter
 */
import { fft, ifft } from './fft'

export interface HPSSParams {
  /** FFT window size in samples (power of 2, e.g. 2048) */
  fftSize: number
  /** Hop size in samples (e.g. 512 = 75% overlap with fftSize 2048) */
  hopSize: number
  /** Median filter length along time axis for harmonic detection (odd, e.g. 17) */
  harmonicL: number
  /** Median filter length along frequency axis for percussive detection (odd, e.g. 17) */
  percussiveL: number
  /** Wiener filter power (1 = linear magnitude, 2 = power spectrum) */
  power: number
}

export interface HPSSResult {
  transient: Float32Array
  tonal: Float32Array
}

// ─── Utilities ─────────────────────────────────────────────────────────────

function hannWindow(n: number): Float64Array {
  const w = new Float64Array(n)
  const twoPI_over_Nm1 = (2 * Math.PI) / (n - 1)
  for (let i = 0; i < n; i++) w[i] = 0.5 * (1 - Math.cos(twoPI_over_Nm1 * i))
  return w
}

/** In-place median filter over a 1-D Float32Array using sorting */
function medianFilter(data: Float32Array, k: number): Float32Array {
  const half = k >> 1
  const result = new Float32Array(data.length)
  const buf = new Float32Array(k)
  for (let i = 0; i < data.length; i++) {
    let count = 0
    for (let d = -half; d <= half; d++) {
      const idx = Math.min(Math.max(i + d, 0), data.length - 1)
      buf[count++] = data[idx]
    }
    // Partial sort: find median without full sort for speed
    // (k is small — typically 17 — so this is fast)
    buf.sort()
    result[i] = buf[half]
  }
  return result
}

// ─── Main HPSS ─────────────────────────────────────────────────────────────

export function hpss(input: Float32Array, params: HPSSParams): HPSSResult {
  const { fftSize, hopSize, harmonicL, percussiveL, power } = params
  const halfFft = (fftSize >> 1) + 1

  // Zero-pad input so every sample falls inside at least one frame
  const padLen = Math.ceil((input.length + fftSize) / hopSize) * hopSize + fftSize
  const padded = new Float32Array(padLen)
  padded.set(input, fftSize >> 1) // centre-align input

  const numFrames = Math.floor((padLen - fftSize) / hopSize) + 1
  const win = hannWindow(fftSize)

  // ── Step 1: STFT ──────────────────────────────────────────────────────────
  // Store half-spectrum (positive freqs only) for each frame
  const specR = new Array<Float32Array>(numFrames)
  const specI = new Array<Float32Array>(numFrames)
  const mag   = new Array<Float32Array>(numFrames)

  const fBuf = new Float64Array(fftSize)
  const iBuf = new Float64Array(fftSize)

  for (let t = 0; t < numFrames; t++) {
    const off = t * hopSize
    for (let n = 0; n < fftSize; n++) {
      fBuf[n] = (off + n < padded.length ? padded[off + n] : 0) * win[n]
      iBuf[n] = 0
    }
    fft(fBuf, iBuf)

    const r = new Float32Array(halfFft)
    const im = new Float32Array(halfFft)
    const m  = new Float32Array(halfFft)
    for (let k = 0; k < halfFft; k++) {
      r[k]  = fBuf[k]
      im[k] = iBuf[k]
      m[k]  = Math.sqrt(fBuf[k] * fBuf[k] + iBuf[k] * iBuf[k])
    }
    specR[t] = r
    specI[t] = im
    mag[t]   = m
  }

  // ── Step 2: Median filtering ──────────────────────────────────────────────
  // Harmonic mask: median along TIME (rows)
  const harmSpec = new Array<Float32Array>(numFrames)
  for (let t = 0; t < numFrames; t++) harmSpec[t] = new Float32Array(halfFft)

  const timeSeries = new Float32Array(numFrames)
  for (let k = 0; k < halfFft; k++) {
    for (let t = 0; t < numFrames; t++) timeSeries[t] = mag[t][k]
    const filtered = medianFilter(timeSeries, harmonicL)
    for (let t = 0; t < numFrames; t++) harmSpec[t][k] = filtered[t]
  }

  // Percussive mask: median along FREQUENCY (columns)
  const percSpec = new Array<Float32Array>(numFrames)
  for (let t = 0; t < numFrames; t++) {
    percSpec[t] = medianFilter(mag[t], percussiveL)
  }

  // ── Step 3: Wiener masking & ISTFT ────────────────────────────────────────
  const hOutput  = new Float64Array(padLen)
  const pOutput  = new Float64Array(padLen)
  const normBuf  = new Float64Array(padLen)

  const hR = new Float64Array(fftSize)
  const hI = new Float64Array(fftSize)
  const pR = new Float64Array(fftSize)
  const pI = new Float64Array(fftSize)

  for (let t = 0; t < numFrames; t++) {
    // Build full complex spectra for both components
    hR.fill(0); hI.fill(0); pR.fill(0); pI.fill(0)

    for (let k = 0; k < halfFft; k++) {
      const h = Math.pow(harmSpec[t][k], power)
      const p = Math.pow(percSpec[t][k], power)
      const tot = h + p + 1e-12
      const mH = h / tot
      const mP = p / tot

      hR[k] = specR[t][k] * mH
      hI[k] = specI[t][k] * mH
      pR[k] = specR[t][k] * mP
      pI[k] = specI[t][k] * mP

      // Mirror negative frequencies (conjugate symmetry)
      if (k > 0 && k < fftSize - halfFft + 1) {
        hR[fftSize - k] = hR[k]
        hI[fftSize - k] = -hI[k]
        pR[fftSize - k] = pR[k]
        pI[fftSize - k] = -pI[k]
      }
    }

    ifft(hR, hI)
    ifft(pR, pI)

    // Overlap-add with synthesis window (= analysis window → WOLA)
    const off = t * hopSize
    for (let n = 0; n < fftSize; n++) {
      if (off + n >= padLen) break
      const w2 = win[n] * win[n]
      hOutput[off + n]  += hR[n] * win[n]
      pOutput[off + n]  += pR[n] * win[n]
      normBuf[off + n]  += w2
    }
  }

  // ── Step 4: Normalize & trim padding ─────────────────────────────────────
  const tonal     = new Float32Array(input.length)
  const transient = new Float32Array(input.length)
  const trimStart = fftSize >> 1

  for (let i = 0; i < input.length; i++) {
    const pos = trimStart + i
    const norm = normBuf[pos]
    if (norm > 1e-12) {
      tonal[i]     = hOutput[pos] / norm
      transient[i] = pOutput[pos] / norm
    }
  }

  return { tonal, transient }
}
