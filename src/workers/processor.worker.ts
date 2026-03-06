/**
 * Background worker: runs audio separation.
 *
 */
import { loadSDT, SDT_WINDOW_SIZE } from '../lib/sdt-wasm'

export interface ProcessorRequest {
  audio: Float32Array
  // parameters that control the SDT algorithm
  radius: number
  tonalThresholdDb: number
  noiseThresholdDb: number
}

export type ProcessorMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'result'; transient: Float32Array; tonal: Float32Array; residual: Float32Array }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ProcessorRequest>) => {
  const { audio, radius, tonalThresholdDb, noiseThresholdDb } = e.data

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
        return sdtProcessor.process(input, { radius, tonalThresholdDb, noiseThresholdDb })
      }

      // split into chunks and process
      const transientAcc = new Float32Array(input.length)
      const tonalAcc = new Float32Array(input.length)
      const residualAcc = new Float32Array(input.length)

      for (let start = 0; start < input.length; start += chunkSize) {
        const end = Math.min(input.length, start + chunkSize)
        const slice = input.subarray(start, end)
        const res = sdtProcessor.process(slice, { radius, tonalThresholdDb, noiseThresholdDb })
        transientAcc.set(res.transient, start)
        tonalAcc.set(res.tonal, start)
        residualAcc.set(res.residual, start)
      }
      return { transient: transientAcc, tonal: tonalAcc, residual: residualAcc }
    }

    ;({ transient, tonal, residual } = await processWithFallback(audio))

    // remove warm‑up latency introduced by the SDT analyser window
    const latency = SDT_WINDOW_SIZE
    if (latency > 0 && transient.length > latency) {
      transient = transient.slice(latency)
      tonal = tonal.slice(latency)
      residual = residual.slice(latency)
    }

    // if any small leading silence remains (algorithm latency larger than
    // assumed window) trim up to the first non‑zero sample across all three
    // output streams. this prevents the tonal/residual signals from being
    // discarded when the percussive channel is quiet.
    const thresh = 1e-6
    let trim = 0
    while (
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
