/**
 * Cooley-Tukey radix-2 in-place FFT.
 * Input arrays must have power-of-2 length.
 * Modifies real and imag arrays in-place.
 */
export function fft(real: Float64Array, imag: Float64Array): void {
  const n = real.length
  if (n <= 1) return

  // Bit-reversal permutation
  let j = 0
  for (let i = 1; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[real[i], real[j]] = [real[j], real[i]]
      ;[imag[i], imag[j]] = [imag[j], imag[i]]
    }
  }

  // Butterfly stages
  for (let len = 2; len <= n; len <<= 1) {
    const halfLen = len >> 1
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)

    for (let i = 0; i < n; i += len) {
      let uRe = 1.0
      let uIm = 0.0
      for (let k = 0; k < halfLen; k++) {
        const tRe = uRe * real[i + k + halfLen] - uIm * imag[i + k + halfLen]
        const tIm = uRe * imag[i + k + halfLen] + uIm * real[i + k + halfLen]
        real[i + k + halfLen] = real[i + k] - tRe
        imag[i + k + halfLen] = imag[i + k] - tIm
        real[i + k] += tRe
        imag[i + k] += tIm
        const newURe = uRe * wRe - uIm * wIm
        uIm = uRe * wIm + uIm * wRe
        uRe = newURe
      }
    }
  }
}

/**
 * Inverse FFT via conjugate trick.
 * Result is in real[] (imaginary part is near-zero for real-valued signals).
 */
export function ifft(real: Float64Array, imag: Float64Array): void {
  const n = real.length
  // Conjugate
  for (let i = 0; i < n; i++) imag[i] = -imag[i]
  fft(real, imag)
  // Conjugate and normalize
  const invN = 1.0 / n
  for (let i = 0; i < n; i++) {
    real[i] *= invN
    imag[i] = -imag[i] * invN
  }
}
