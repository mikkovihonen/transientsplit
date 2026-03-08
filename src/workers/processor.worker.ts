/**
 * Background worker: runs audio separation.
 *
 */
import { loadSDT } from '../lib/sdt-wasm'

export interface ProcessorRequest {
  audio: Float32Array
  // parameters that control the SDT algorithm
  winSize: number
  overlap: number
  radius: number
  tonalThresholdDb: number
  noiseThresholdDb: number
  normalize: boolean
}

export type ProcessorMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'result'; transient: Float32Array; tonal: Float32Array; residual: Float32Array }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ProcessorRequest>) => {
  const { audio, winSize, overlap, radius, tonalThresholdDb, noiseThresholdDb, normalize } = e.data

  try {
    post({ type: 'progress', progress: 0.05, message: 'Loading processor...' })

    let transient: Float32Array
    let tonal: Float32Array
    let residual: Float32Array

    // Load SDT WASM processor – an exception will be thrown if loading
    // fails, which is caught by the surrounding try block and forwarded.
    const sdtProcessor = await loadSDT()

    post({ type: 'progress', progress: 0.1, message: 'Analysing with SDT (WASM)...' })

    // process input in chunks to handle large files
    const processWithFallback = async (input: Float32Array): Promise<{ transient: Float32Array; tonal: Float32Array; residual: Float32Array }> => {
      const chunkSize = 60000 // ~1.25 sec at 48kHz
      if (input.length <= chunkSize) {
        return sdtProcessor.process(input, { winSize, overlap, radius, tonalThresholdDb, noiseThresholdDb })
      }

      // split into chunks and process
      const transientAcc = new Float32Array(input.length)
      const tonalAcc = new Float32Array(input.length)
      const residualAcc = new Float32Array(input.length)

      for (let start = 0; start < input.length; start += chunkSize) {
        const end = Math.min(input.length, start + chunkSize)
        const slice = input.subarray(start, end)
        const res = sdtProcessor.process(slice, { winSize, radius, tonalThresholdDb, noiseThresholdDb })
        transientAcc.set(res.transient, start)
        tonalAcc.set(res.tonal, start)
        residualAcc.set(res.residual, start)
      }
      return { transient: transientAcc, tonal: tonalAcc, residual: residualAcc }
    }

    // SDTDemix is a causal STFT overlap-add processor.  Its output at sample T
    // corresponds to input at T − latency, where:
    //   hopSize = (1 - overlap) * winSize   [overlap is fixed at 0.5]
    //   latency = winSize + (radius + 1) * hopSize - 1  ≈ 3.5 × winSize
    //
    // To align the outputs with the source we append `latency` trailing zeros
    // so the processor has time to "flush" all audio samples through.  After
    // processing we slice off the first `latency` output samples (the warmup
    // period where the algorithm sees only silence or partial history).
    //
    // NOTE: prepending zeros instead of appending would be wrong — the audio
    // content would still be delayed by latency in the sliced result, and the
    // last `latency` samples of audio would fall outside the output buffer.
    const hopSize = Math.round(0.5 * winSize) // overlap = 0.5
    const latency = winSize + (radius + 1) * hopSize - 1
    const paddedAudio = new Float32Array(audio.length + latency)
    paddedAudio.set(audio, 0) // audio at the start, trailing zeros for flush
    ;({ transient, tonal, residual } = await processWithFallback(paddedAudio))

    // Skip the warmup period (first `latency` output samples correspond to the
    // algorithm processing silence/partial history, not real audio).
    if (latency > 0 && transient.length > latency) {
      transient = transient.slice(latency)
      tonal = tonal.slice(latency)
      residual = residual.slice(latency)
    }

    // Safety net: trim any residual near-silence caused by off-by-one rounding
    // in the latency formula (at most one extra hop).
    const thresh = 1e-6
    const maxTrim = hopSize
    let trim = 0
    while (
      trim < maxTrim &&
      trim < transient.length &&
      Math.abs(transient[trim]) < thresh &&
      Math.abs(tonal[trim]) < thresh &&
      Math.abs(residual[trim]) < thresh
    ) {
      trim++
    }
    if (trim > 0) {
      transient = transient.slice(trim)
      tonal = tonal.slice(trim)
      residual = residual.slice(trim)
    }

    if (normalize) {
      for (const arr of [transient, tonal, residual]) {
        let peak = 0
        for (let i = 0; i < arr.length; i++) {
          const abs = Math.abs(arr[i])
          if (abs > peak) peak = abs
        }
        if (peak > 0) {
          for (let i = 0; i < arr.length; i++) arr[i] /= peak
        }
      }
    }

    post({ type: 'progress', progress: 0.98, message: 'Done' })

    self.postMessage(
      { type: 'result', transient, tonal, residual },
      { transfer: [transient.buffer, tonal.buffer, residual.buffer] },
    )
  } catch (err) {
    // include stack if available for better diagnostics
    let message: string
    if (err instanceof Error) {
      message = err.message
      if (err.stack) {
        message += '\n' + err.stack
      }
    } else {
      try {
        message = JSON.stringify(err)
      } catch {
        message = String(err)
      }
    }
    // also log to console so developer can inspect it in the worker console
    console.error('processor.worker error', err)
    post({ type: 'error', message })
  }
}

function post(msg: ProcessorMessage) {
  self.postMessage(msg)
}
