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

/**
 * Encode a mono Float32Array as a 16-bit PCM WAV file.
 */
export function encodeWav(samples: Float32Array, sampleRate: number): ArrayBuffer {
  const numChannels = 1
  const bitsPerSample = 16
  const blockAlign = numChannels * (bitsPerSample >> 3)
  const byteRate = sampleRate * blockAlign
  const dataSize = samples.length * blockAlign
  const buf = new ArrayBuffer(44 + dataSize)
  const view = new DataView(buf)
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i))
  }

  writeStr(0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeStr(8, 'WAVE')
  writeStr(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)           // PCM
  view.setUint16(22, numChannels, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, byteRate, true)
  view.setUint16(32, blockAlign, true)
  view.setUint16(34, bitsPerSample, true)
  writeStr(36, 'data')
  view.setUint32(40, dataSize, true)

  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 32768 : s * 32767, true)
  }

  return buf
}
