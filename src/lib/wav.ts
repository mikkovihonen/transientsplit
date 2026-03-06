/** Parsed WAV file */
export interface WavInfo {
  sampleRate: number
  numChannels: number
  bitsPerSample: number
  audioFormat: number // 1 = PCM, 3 = IEEE float
  samples: Float32Array // always interleaved if stereo
}

// ─── Parser ────────────────────────────────────────────────────────────────

export function parseWav(buffer: ArrayBuffer): WavInfo {
  const view = new DataView(buffer)

  const readFourCC = (offset: number) =>
    String.fromCharCode(
      view.getUint8(offset),
      view.getUint8(offset + 1),
      view.getUint8(offset + 2),
      view.getUint8(offset + 3),
    )

  if (readFourCC(0) !== 'RIFF') throw new Error('Not a RIFF file')
  if (readFourCC(8) !== 'WAVE') throw new Error('Not a WAVE file')

  let audioFormat = 0
  let numChannels = 0
  let sampleRate = 0
  let bitsPerSample = 0
  let dataOffset = -1
  let dataSize = 0

  let offset = 12
  while (offset < buffer.byteLength - 8) {
    const id = readFourCC(offset)
    const size = view.getUint32(offset + 4, true)

    if (id === 'fmt ') {
      audioFormat  = view.getUint16(offset + 8, true)
      numChannels  = view.getUint16(offset + 10, true)
      sampleRate   = view.getUint32(offset + 12, true)
      bitsPerSample = view.getUint16(offset + 22, true)
    } else if (id === 'data') {
      dataOffset = offset + 8
      dataSize = size
    }

    offset += 8 + size
    if (size & 1) offset++ // word-align
  }

  if (dataOffset === -1) throw new Error('WAV file has no data chunk')
  if (numChannels === 0) throw new Error('WAV file has no fmt chunk')

  const bytesPerSample = bitsPerSample >> 3
  const totalSamples = Math.floor(dataSize / bytesPerSample)
  const samples = new Float32Array(totalSamples)

  for (let i = 0; i < totalSamples; i++) {
    const bytePos = dataOffset + i * bytesPerSample
    let val = 0
    if (audioFormat === 3 && bitsPerSample === 32) {
      val = view.getFloat32(bytePos, true)
    } else if (bitsPerSample === 8) {
      val = (view.getUint8(bytePos) - 128) / 128
    } else if (bitsPerSample === 16) {
      val = view.getInt16(bytePos, true) / 32768
    } else if (bitsPerSample === 24) {
      const b0 = view.getUint8(bytePos)
      const b1 = view.getUint8(bytePos + 1)
      const b2 = view.getUint8(bytePos + 2)
      let raw = (b2 << 16) | (b1 << 8) | b0
      if (raw & 0x800000) raw |= ~0xffffff // sign extend
      val = raw / 8388608
    } else if (bitsPerSample === 32 && audioFormat === 1) {
      val = view.getInt32(bytePos, true) / 2147483648
    } else {
      throw new Error(`Unsupported format: ${audioFormat}-bit PCM ${bitsPerSample}-bit`)
    }
    samples[i] = val
  }

  return { sampleRate, numChannels, bitsPerSample, audioFormat, samples }
}

/** Mix multi-channel interleaved audio down to mono */
export function toMono(info: WavInfo): Float32Array {
  if (info.numChannels === 1) return info.samples
  const mono = new Float32Array(info.samples.length / info.numChannels)
  const ch = info.numChannels
  for (let i = 0; i < mono.length; i++) {
    let sum = 0
    for (let c = 0; c < ch; c++) sum += info.samples[i * ch + c]
    mono[i] = sum / ch
  }
  return mono
}

// ─── Encoder ───────────────────────────────────────────────────────────────

export interface LoopPoint {
  startSample: number
  endSample: number  // inclusive
}

/**
 * Encode a mono Float32Array as a WAV file.
 * - format: 'pcm16' | 'pcm24' (default) | 'f32'
 * - loopPoint: if provided, appends a SMPL chunk so DAWs and samplers pick up the loop
 */
export function encodeWav(
  samples: Float32Array,
  sampleRate: number,
  options: { format?: 'pcm16' | 'pcm24' | 'f32'; loopPoint?: LoopPoint } = {},
): ArrayBuffer {
  const numChannels = 1
  const fmt = options.format || 'pcm24'
  let bitsPerSample: number
  let isFloat = false
  if (fmt === 'pcm16') bitsPerSample = 16
  else if (fmt === 'pcm24') bitsPerSample = 24
  else if (fmt === 'f32') {
    bitsPerSample = 32
    isFloat = true
  } else {
    throw new Error('Unsupported WAV format ' + fmt)
  }

  const blockAlign = numChannels * (bitsPerSample >> 3)
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * blockAlign

  // SMPL chunk: 8-byte header + 36 bytes base + 24 bytes per loop entry
  const smplSize = options.loopPoint ? (8 + 36 + 24) : 0
  const buf = new ArrayBuffer(44 + dataSize + smplSize)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize + smplSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, isFloat ? 3 : 1, true) // audio format
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  // if any sample exceeds [-1,1] we normalise to avoid digital clipping
  let peak = 0
  for (let i = 0; i < samples.length; i++) {
    peak = Math.max(peak, Math.abs(samples[i]))
  }
  const scale = peak > 1 ? 1 / peak : 1

  // simple triangular dither for integer formats
  const step = 1 / 32768
  for (let i = 0; i < samples.length; i++) {
    let s = samples[i] * scale
    if (!isFloat) {
      s += (Math.random() - Math.random()) * step
    }
    s = Math.max(-1, Math.min(1, s))
    const offset = 44 + i * blockAlign
    if (fmt === 'pcm16') {
      view.setInt16(offset, s < 0 ? s * 32768 : s * 32767, true)
    } else if (fmt === 'pcm24') {
      // 24-bit little endian
      let val = Math.floor((s < 0 ? s * 8388608 : s * 8388607))
      view.setUint8(offset, val & 0xff)
      view.setUint8(offset + 1, (val >> 8) & 0xff)
      view.setUint8(offset + 2, (val >> 16) & 0xff)
    } else if (fmt === 'f32') {
      view.setFloat32(offset, s, true)
    }
  }

  // SMPL chunk (standard WAV loop metadata)
  if (options.loopPoint) {
    const s = 44 + dataSize
    writeStr(s, 'smpl')
    view.setUint32(s + 4, 36 + 24, true)           // chunk data size
    view.setUint32(s + 8,  0, true)                 // manufacturer
    view.setUint32(s + 12, 0, true)                 // product
    view.setUint32(s + 16, Math.round(1e9 / sampleRate), true) // sample period (ns)
    view.setUint32(s + 20, 60, true)                // MIDI unity note (middle C)
    view.setUint32(s + 24, 0, true)                 // MIDI pitch fraction
    view.setUint32(s + 28, 0, true)                 // SMPTE format
    view.setUint32(s + 32, 0, true)                 // SMPTE offset
    view.setUint32(s + 36, 1, true)                 // num sample loops
    view.setUint32(s + 40, 0, true)                 // sampler data
    // Loop entry
    view.setUint32(s + 44, 0, true)                 // cue point ID
    view.setUint32(s + 48, 0, true)                 // type: 0 = forward loop
    view.setUint32(s + 52, options.loopPoint.startSample, true)
    view.setUint32(s + 56, options.loopPoint.endSample, true)
    view.setUint32(s + 60, 0, true)                 // fraction
    view.setUint32(s + 64, 0, true)                 // play count: 0 = infinite
  }

  return buf
}

/**
 * Build a crossfade loop region from a mono Float32Array.
 * Mirrors the AudioPlayer's createCrossfadeBuffer but operates on raw samples.
 * Returns the cfSamples array and the sample offset at which it starts (handoffSample).
 */
export function buildCrossfadeSamples(
  samples: Float32Array,
  loopStartSample: number,
  loopEndSample: number,
  crossfadeSamples: number,
): { cfSamples: Float32Array; handoffSample: number } {
  const A = loopStartSample
  const B = loopEndSample
  const L = B - A
  const X = Math.min(crossfadeSamples, Math.floor(L / 2))
  const outLen = L - X
  const handoffSample = B - X

  const cfSamples = new Float32Array(outLen)
  for (let i = 0; i < X; i++) {
    const t = i / X
    const fadeIn  = Math.sin(t * Math.PI * 0.5) ** 2
    const fadeOut = Math.cos(t * Math.PI * 0.5) ** 2
    cfSamples[i] = samples[A + i] * fadeIn + samples[B - X + i] * fadeOut
  }
  for (let i = X; i < outLen; i++) {
    cfSamples[i] = samples[A + i]
  }
  return { cfSamples, handoffSample }
}
