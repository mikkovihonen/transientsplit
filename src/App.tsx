import { useCallback, useRef, useState } from 'react'
import { DropZone } from './components/DropZone'
import { ParametersPanel, type FullParams } from './components/ParametersPanel'
import { ResultCard } from './components/ResultCard'
import { parseWav, encodeWav, toMono } from './lib/wav'
import type { ProcessorMessage, ProcessorRequest } from './workers/processor.worker'

type Status = 'idle' | 'loading' | 'processing' | 'done' | 'error'

interface Results {
  transientSamples: Float32Array
  tonalSamples: Float32Array
  transientWav: ArrayBuffer
  tonalWav: ArrayBuffer
  basename: string
}

const DEFAULT_PARAMS: FullParams = {
  fftSize: 2048,
  hopSize: 512,
  harmonicL: 17,
  percussiveL: 17,
  power: 2,
  crossfadeMs: 100,
}

export default function App() {
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [params, setParams] = useState<FullParams>(DEFAULT_PARAMS)

  const workerRef = useRef<Worker | null>(null)
  const basenameRef = useRef('')

  const process = useCallback(
    async (file: File) => {
      // Terminate any previous worker
      workerRef.current?.terminate()
      setResults(null)
      setError(null)
      setStatus('loading')
      setProgress(0)
      basenameRef.current = file.name.replace(/\.[^.]+$/, '')

      let samples: Float32Array
      try {
        const buf = await file.arrayBuffer()
        const wav = parseWav(buf)

        if (wav.sampleRate !== 48000) {
          setError(
            `Expected 48 kHz sample rate but got ${wav.sampleRate} Hz.\n` +
              'Please convert your file to 48 kHz before processing.',
          )
          setStatus('error')
          return
        }

        samples = toMono(wav)
      } catch (e) {
        setError(`Failed to parse WAV file: ${e instanceof Error ? e.message : String(e)}`)
        setStatus('error')
        return
      }

      setStatus('processing')
      setProgress(0.02)

      // Sync hop size to fftSize / 4
      const activeParams = { ...params, hopSize: params.fftSize >> 2 }

      const worker = new Worker(
        new URL('./workers/processor.worker.ts', import.meta.url),
        { type: 'module' },
      )
      workerRef.current = worker

      worker.onmessage = (e: MessageEvent<ProcessorMessage>) => {
        const msg = e.data
        if (msg.type === 'progress') {
          setProgress(msg.progress)
          setProgressMsg(msg.message)
        } else if (msg.type === 'result') {
          const transientWav = encodeWav(msg.transient, 48000)
          const tonalWav = encodeWav(msg.tonal, 48000)
          setResults({
            transientSamples: msg.transient,
            tonalSamples: msg.tonal,
            transientWav,
            tonalWav,
            basename: basenameRef.current,
          })
          setStatus('done')
          setProgress(1)
          worker.terminate()
        } else if (msg.type === 'error') {
          setError(msg.message)
          setStatus('error')
          worker.terminate()
        }
      }

      worker.onerror = (e) => {
        setError(e.message ?? 'Unknown worker error')
        setStatus('error')
        worker.terminate()
      }

      const req: ProcessorRequest = {
        audio: samples,
        params: activeParams,
        crossfadeMs: activeParams.crossfadeMs,
      }
      worker.postMessage(req, { transfer: [samples.buffer] })
    },
    [params],
  )

  const reset = () => {
    workerRef.current?.terminate()
    setStatus('idle')
    setResults(null)
    setError(null)
    setProgress(0)
  }

  const busy = status === 'loading' || status === 'processing'

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
            </svg>
          </div>
          <div>
            <h1 className="text-slate-100 font-bold text-lg leading-none">Transient Splitter</h1>
            <p className="text-slate-500 text-xs mt-0.5">HPSS source separation &bull; 48 kHz WAV</p>
          </div>
        </div>

        {(status === 'done' || status === 'error') && (
          <button
            onClick={reset}
            className="text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Process another file
          </button>
        )}
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6">

        {/* Drop zone — hide once done */}
        {status !== 'done' && (
          <DropZone onFile={process} disabled={busy} />
        )}

        {/* Progress bar */}
        {busy && (
          <div className="flex flex-col gap-2">
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-300"
                style={{ width: `${progress * 100}%` }}
              />
            </div>
            <p className="text-slate-400 text-sm text-center">{progressMsg}</p>
          </div>
        )}

        {/* Error */}
        {status === 'error' && error && (
          <div className="bg-red-950/40 border border-red-800/60 rounded-xl p-4 text-red-300 text-sm whitespace-pre-wrap">
            {error}
          </div>
        )}

        {/* Results */}
        {status === 'done' && results && (
          <div className="flex flex-col gap-4">
            <p className="text-slate-400 text-sm text-center">
              Separation complete for <span className="text-slate-200 font-medium">{results.basename}.wav</span>
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <ResultCard
                title="Transient"
                subtitle="Percussive / attack component"
                accentColor="bg-amber-500"
                waveColor="#f59e0b"
                samples={results.transientSamples}
                wavBuffer={results.transientWav}
                filename={`${results.basename}_transient.wav`}
              />
              <ResultCard
                title="Tonal"
                subtitle="Harmonic / sustained component"
                accentColor="bg-indigo-500"
                waveColor="#818cf8"
                samples={results.tonalSamples}
                wavBuffer={results.tonalWav}
                filename={`${results.basename}_tonal_loop.wav`}
                loop
              />
            </div>
          </div>
        )}

        {/* Parameters */}
        {status !== 'processing' && status !== 'loading' && (
          <ParametersPanel
            params={params}
            onChange={setParams}
            disabled={busy}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-3 text-center text-xs text-slate-600">
        Processing runs entirely in your browser &mdash; no audio is uploaded to any server
      </footer>
    </div>
  )
}
