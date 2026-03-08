import { useCallback, useEffect, useRef, useState } from 'react'
import { DropZone } from './components/DropZone'
import { RecordingPanel } from './components/RecordingPanel'
import { ParametersPanel, type FullParams } from './components/ParametersPanel'
import { ResultCard, type LoopControls } from './components/ResultCard'
import { parseWav, encodeWav, toMono } from './lib/wav'
import type { ProcessorMessage, ProcessorRequest } from './workers/processor.worker'

type Status = 'idle' | 'loading' | 'processing' | 'done' | 'error'
type InputMode = 'file' | 'record'

interface Results {
  transientSamples: Float32Array
  tonalSamples: Float32Array
  residualSamples: Float32Array
  transientWav: ArrayBuffer
  tonalWav: ArrayBuffer
  residualWav: ArrayBuffer
  basename: string
}

// default SDT params exposed to the UI
const DEFAULT_PARAMS: FullParams = {
  winSize: 2048,
  overlap: 0.5,
  radius: 6,
  tonalThresholdDb: -4,
  noiseThresholdDb: -80,
  normalize: false,
}

export default function App() {
  const [inputMode, setInputMode] = useState<InputMode>('file')
  const [status, setStatus] = useState<Status>('idle')
  const [progress, setProgress] = useState(0)
  const [progressMsg, setProgressMsg] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [results, setResults] = useState<Results | null>(null)
  const [audioSamples, setAudioSamples] = useState<Float32Array | null>(null)
  const workerRef = useRef<Worker | null>(null)
  const basenameRef = useRef('')
  const [params, setParams] = useState<FullParams>(DEFAULT_PARAMS)
  const [tonalLoop, setTonalLoop] = useState<Omit<LoopControls, 'onChange' | 'duration'>>({
    enabled: false,
    seamless: false,
    start: 0,
    end: 1,
  })

  // runs the worker on a given sample buffer using current params
  const runWorker = useCallback(
    (samples: Float32Array) => {
      workerRef.current?.terminate()
      setError(null)
      setStatus('processing')
      setProgress(0.02)

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
          const transientWav = encodeWav(msg.transient, 48000, { format: 'f32' })
          const tonalWav = encodeWav(msg.tonal, 48000, { format: 'f32' })
          const residualWav = encodeWav(msg.residual, 48000, { format: 'f32' })
          setResults({
            transientSamples: msg.transient,
            tonalSamples: msg.tonal,
            residualSamples: msg.residual,
            transientWav,
            tonalWav,
            residualWav,
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
        winSize: params.winSize,
        overlap: params.overlap,
        radius: params.radius,
        tonalThresholdDb: params.tonalThresholdDb,
        noiseThresholdDb: params.noiseThresholdDb,
        normalize: params.normalize,
      }
      // do not transfer buffer; we need to reuse samples for parameter tweaks
      worker.postMessage(req)
    },
    [params],
  )

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
        samples = toMono(wav)
      } catch (e) {
        setError(`Failed to parse WAV file: ${e instanceof Error ? e.message : String(e)}`)
        setStatus('error')
        return
      }

      setAudioSamples(samples)
      runWorker(samples)
    },
    [runWorker],
  )

  const processRaw = useCallback(
    (samples: Float32Array, basename: string) => {
      workerRef.current?.terminate()
      setResults(null)
      setError(null)
      setStatus('processing')
      setProgress(0)
      basenameRef.current = basename
      setAudioSamples(samples)
      runWorker(samples)
    },
    [runWorker],
  )

  const reset = () => {
    workerRef.current?.terminate()
    setStatus('idle')
    setResults(null)
    setError(null)
    setProgress(0)
    setAudioSamples(null)
    setTonalLoop({ enabled: false, seamless: false, start: 0, end: 1 })
  }

  // whenever parameters change or a new file is loaded, reprocess
  useEffect(() => {
    if (audioSamples) {
      runWorker(audioSamples)
    }
  }, [params, audioSamples, runWorker])

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
            <h1 className="text-slate-100 font-bold text-lg leading-none">Transient Split</h1>
            <p className="text-slate-500 text-xs mt-0.5">Split percussive and harmonic components from audio</p>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 flex flex-col gap-6 lg:justify-center">
        {/* Input source tabs + panel — only before any results */}
        {!results && status !== 'done' && (
          <div className="flex flex-col gap-8">
            {/* Tabs */}
            <div className="flex border-b border-slate-700 mb-0">
              {(['file', 'record'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setInputMode(mode)}
                  disabled={busy}
                  className={[
                    'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
                    inputMode === mode
                      ? 'border-indigo-500 text-indigo-400'
                      : 'border-transparent text-slate-400 hover:text-slate-200',
                    busy ? 'cursor-not-allowed opacity-40' : '',
                  ].join(' ')}
                >
                  {mode === 'file' ? 'Choose file' : 'Record sample'}
                </button>
              ))}
            </div>
            {inputMode === 'file'
              ? <DropZone onFile={process} disabled={busy} />
              : <RecordingPanel onSamples={processRaw} disabled={busy} />
            }
          </div>
        )}

        {/* Progress bar — full UI when no results yet, slim bar when reprocessing */}
        {busy && !results && (
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
        {results && (
          <div className="flex flex-col gap-4">
            <div className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 transition-[filter,opacity] duration-300 ${busy ? 'opacity-40 grayscale' : 'opacity-100 grayscale-0'}`}>
              <ResultCard
                title="Transient"
                subtitle="Percussive / attack"
                accentColor="bg-amber-500"
                waveColor="#f59e0b"
                samples={results.transientSamples}
                wavBuffer={results.transientWav}
                filename={`${results.basename}_transient.wav`}
              />
              <ResultCard
                title="Tonal"
                subtitle="Harmonic / sustained"
                accentColor="bg-indigo-500"
                waveColor="#818cf8"
                samples={results.tonalSamples}
                wavBuffer={results.tonalWav}
                filename={`${results.basename}_tonal.wav`}
                loopControls={{
                  ...tonalLoop,
                  duration: results.tonalSamples.length / 48000,
                  onChange: setTonalLoop,
                }}
              />
              <ResultCard
                title="Residual"
                subtitle="Noise / unclassified"
                accentColor="bg-emerald-500"
                waveColor="#10b981"
                samples={results.residualSamples}
                wavBuffer={results.residualWav}
                filename={`${results.basename}_residual.wav`}
              />
            </div>
          </div>
        )}

        {/* Parameters */}
        {(results || (!busy && status !== 'done')) && (
          <ParametersPanel
            params={params}
            onChange={setParams}
            disabled={busy}
          />
        )}

        {(results || status === 'error') && (
          <button
            onClick={reset}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-slate-100 transition-colors"
          >
            Process another sample
          </button>
        )}

      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 px-6 py-3 text-center text-xs text-slate-600">
        Processing runs entirely in your browser &mdash; no audio is uploaded to any server
      </footer>
    </div>
  )
}
