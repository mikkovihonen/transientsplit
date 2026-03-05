/**
 * Background worker: runs audio separation and loop processing.
 *
 */
import { type HPSSParams, hpss } from '../lib/hpss'
import { makeSeamlessLoop } from '../lib/loop'
import { loadSDT } from '../lib/sdt-wasm'

export interface ProcessorRequest {
  audio: Float32Array
  params: HPSSParams
  crossfadeMs: number
}

export type ProcessorMessage =
  | { type: 'progress'; progress: number; message: string }
  | { type: 'result'; transient: Float32Array; tonal: Float32Array }
  | { type: 'error'; message: string }

self.onmessage = async (e: MessageEvent<ProcessorRequest>) => {
  const { audio, params, crossfadeMs } = e.data

  try {
    post({ type: 'progress', progress: 0.05, message: 'Loading processor...' })

    let transient: Float32Array
    let tonal: Float32Array

    // Try SDT WASM first
    const sdtProcessor = await loadSDT()

    if (sdtProcessor !== null) {
      post({ type: 'progress', progress: 0.1, message: 'Analysing with SDT (WASM)...' })
      const result = sdtProcessor.process(audio, {
        winSize: params.fftSize,
        hopSize: params.hopSize,
        medianOrder: Math.max(params.harmonicL, params.percussiveL),
      })
      ;({ transient, tonal } = result)
    } else {
      // Fallback to TypeScript HPSS
      post({ type: 'progress', progress: 0.1, message: 'Analysing with HPSS (TypeScript)...' })
      ;({ transient, tonal } = hpss(audio, params))
    }

    post({ type: 'progress', progress: 0.85, message: 'Creating seamless loop...' })

    const tonalLooped = makeSeamlessLoop(tonal, crossfadeMs, 48000)

    post({ type: 'progress', progress: 0.98, message: 'Done' })

    self.postMessage(
      { type: 'result', transient, tonal: tonalLooped },
      { transfer: [transient.buffer, tonalLooped.buffer] },
    )
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}

function post(msg: ProcessorMessage) {
  self.postMessage(msg)
}
