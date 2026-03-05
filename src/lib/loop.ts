/**
 * Make a tonal audio segment loop seamlessly.
 *
 * Strategy: equal-power cross-fade the tail into the head.
 * The result has length `input.length - crossfadeSamples`.
 * When this file is played in a loop (end → start), the transition
 * is smooth because the loop point is pre-blended.
 *
 *   Output[0..C) = input[0..C) * fadeIn + input[L-C..L) * fadeOut
 *   Output[C..L-C) = input[C..L-C)   (unmodified)
 *
 * where L = input.length, C = crossfadeSamples
 */
export function makeSeamlessLoop(
  audio: Float32Array,
  crossfadeMs: number,
  sampleRate: number,
): Float32Array {
  const C = Math.min(
    Math.max(1, Math.round((crossfadeMs / 1000) * sampleRate)),
    Math.floor(audio.length / 4), // never more than 25% of signal
  )

  const L = audio.length
  const outLen = L - C
  if (outLen <= 0) return audio.slice()

  const out = new Float32Array(outLen)
  out.set(audio.subarray(0, outLen))

  // Equal-power cross-fade at the loop boundary
  for (let i = 0; i < C; i++) {
    const t = i / C // 0 → 1
    const fadeIn  = Math.sin((t * Math.PI) / 2) // 0 → 1
    const fadeOut = Math.cos((t * Math.PI) / 2) // 1 → 0
    out[i] = audio[i] * fadeIn + audio[outLen + i] * fadeOut
  }

  return out
}
