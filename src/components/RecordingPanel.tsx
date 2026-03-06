import { useEffect, useRef, useState } from 'react'
import { AudioPlayer } from './AudioPlayer'
import { WaveformView } from './WaveformView'
import { encodeWav } from '../lib/wav'

type RecordState = 'idle' | 'listening' | 'recording' | 'recorded'

interface Props {
  onSamples: (samples: Float32Array, basename: string) => void
  disabled?: boolean
}

interface Selection {
  start: number // fraction [0, 1]
  end: number
}

export function RecordingPanel({ onSamples, disabled }: Props) {
  const [state, setState] = useState<RecordState>('listening')
  const [requesting, setRequesting] = useState(false)
  const [threshold, setThreshold] = useState(0.1)
  const [level, setLevel] = useState(0)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [recordedSamples, setRecordedSamples] = useState<Float32Array | null>(null)
  const [selection, setSelection] = useState<Selection>({ start: 0, end: 1 })
  const [playbackWav, setPlaybackWav] = useState<ArrayBuffer | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const analyserBufRef = useRef<Float32Array<ArrayBuffer> | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const rafRef = useRef(0)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const startTimeRef = useRef(0)
  const recordingStartedRef = useRef(false)
  const [armed, setArmed] = useState(false)
  const armedRef = useRef(false)
  // Keep refs that mirror state so RAF callbacks see the latest values
  const thresholdRef = useRef(threshold)

  useEffect(() => { thresholdRef.current = threshold }, [threshold])
  useEffect(() => { armedRef.current = armed }, [armed])

  // Recompute playback WAV for the selected region (debounced to avoid encoding on every drag frame)
  useEffect(() => {
    if (!recordedSamples) { setPlaybackWav(null); return }
    const id = setTimeout(() => {
      const s = Math.floor(selection.start * recordedSamples.length)
      const e = Math.ceil(selection.end * recordedSamples.length)
      setPlaybackWav(encodeWav(recordedSamples.slice(s, e), 48000, { format: 'f32' }))
    }, 150)
    return () => clearTimeout(id)
  }, [recordedSamples, selection])

  // Cleanup on unmount
  useEffect(() => () => { cleanup() }, [])

  // Auto-start listening when the panel mounts (tab selected)
  useEffect(() => { startListening() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function cleanup() {
    cancelAnimationFrame(rafRef.current)
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try { mediaRecorderRef.current.stop() } catch { /* ignore */ }
    }
    mediaRecorderRef.current = null
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {})
      audioCtxRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    analyserRef.current = null
    analyserBufRef.current = null
    recordingStartedRef.current = false
    armedRef.current = false
  }

  const startListening = async () => {
    setRequesting(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      setRequesting(false)
      streamRef.current = stream

      const ctx = new AudioContext()
      audioCtxRef.current = ctx
      const source = ctx.createMediaStreamSource(stream)
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 2048
      analyser.smoothingTimeConstant = 0.1
      source.connect(analyser)
      analyserRef.current = analyser
      analyserBufRef.current = new Float32Array(analyser.fftSize)
      recordingStartedRef.current = false

      setState('listening')

      const tick = () => {
        if (!analyserRef.current || !analyserBufRef.current) return
        analyserRef.current.getFloatTimeDomainData(analyserBufRef.current)
        let sum = 0
        for (let i = 0; i < analyserBufRef.current.length; i++) {
          sum += analyserBufRef.current[i] ** 2
        }
        const rms = Math.sqrt(sum / analyserBufRef.current.length)
        // Scale for a readable 0-1 display (multiply by ~5 so -26 dBFS ≈ full bar)
        setLevel(Math.min(1, rms * 5))

        if (armedRef.current && !recordingStartedRef.current && rms > thresholdRef.current / 5) {
          recordingStartedRef.current = true
          beginRecording(stream)
        }

        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
    } catch (err) {
      setRequesting(false)
      setState('idle')
      alert('Microphone access denied: ' + (err instanceof Error ? err.message : String(err)))
    }
  }

  function beginRecording(stream: MediaStream) {
    const mimeTypes = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/ogg;codecs=opus',
      'audio/ogg',
      '',
    ]
    const mimeType = mimeTypes.find(m => !m || MediaRecorder.isTypeSupported(m)) ?? ''
    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
    chunksRef.current = []
    recorder.ondataavailable = e => { if (e.data.size > 0) chunksRef.current.push(e.data) }
    recorder.onstop = handleRecordingStop
    recorder.start(100) // collect chunks every 100 ms
    mediaRecorderRef.current = recorder
    startTimeRef.current = Date.now()
    setState('recording')
    timerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - startTimeRef.current) / 1000))
    }, 500)
  }

  const stopRecording = () => {
    // Stop timer and level animation
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    cancelAnimationFrame(rafRef.current)
    // Stop the recorder — triggers onstop asynchronously
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop()
    }
    // Stop mic tracks and monitoring context
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    audioCtxRef.current?.close().catch(() => {})
    audioCtxRef.current = null
    analyserRef.current = null
    analyserBufRef.current = null
  }

  const handleRecordingStop = async () => {
    if (chunksRef.current.length === 0) {
      setState('idle')
      return
    }
    const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type ?? 'audio/webm' })
    const arrayBuf = await blob.arrayBuffer()
    const decodeCtx = new AudioContext()
    try {
      const decoded = await decodeCtx.decodeAudioData(arrayBuf)
      await decodeCtx.close()

      // Resample to mono 48 kHz using OfflineAudioContext
      const targetSr = 48000
      const numFrames = Math.ceil(decoded.duration * targetSr)
      const offlineCtx = new OfflineAudioContext(1, Math.max(1, numFrames), targetSr)
      const src = offlineCtx.createBufferSource()
      src.buffer = decoded
      src.connect(offlineCtx.destination)
      src.start()
      const rendered = await offlineCtx.startRendering()
      const samples = rendered.getChannelData(0).slice()

      mediaRecorderRef.current = null
      setRecordedSamples(samples)
      setSelection({ start: 0, end: 1 })
      setElapsedSec(0)
      setState('recorded')
    } catch (err) {
      await decodeCtx.close().catch(() => {})
      alert('Failed to decode recorded audio: ' + (err instanceof Error ? err.message : String(err)))
      setState('idle')
    }
  }

  const useSelection = () => {
    if (!recordedSamples) return
    const start = Math.floor(selection.start * recordedSamples.length)
    const end = Math.ceil(selection.end * recordedSamples.length)
    const slice = recordedSamples.slice(start, end)
    const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-')
    onSamples(slice, `rec_${ts}`)
  }

  const reset = () => {
    cleanup()
    setArmed(false)
    setRecordedSamples(null)
    setSelection({ start: 0, end: 1 })
    setLevel(0)
    setElapsedSec(0)
    startListening()
  }

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  const selDurSec = recordedSamples
    ? ((selection.end - selection.start) * recordedSamples.length / 48000).toFixed(2)
    : '0.00'

  return (
    <div className="rounded-2xl border-2 border-dashed border-slate-600 p-8 flex flex-col gap-4 min-h-72 justify-center">

      {/* ── IDLE (requesting permission / denied) ────────────────────── */}
      {state === 'idle' && (
        <div className="flex flex-col items-center gap-4 py-2">
          <svg
            className="w-12 h-12 text-slate-500"
            fill="none" viewBox="0 0 24 24"
            stroke="currentColor" strokeWidth={1.2}
          >
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 0 1 6 0v8.25a3 3 0 0 1-3 3z"
            />
          </svg>
          <div className="text-center">
            <p className="text-slate-200 font-medium text-lg">Record from microphone</p>
            <p className="text-slate-400 text-sm mt-1">
              Microphone access denied \u2014 allow it in browser settings and reload
            </p>
          </div>
        </div>
      )}

      {/* ── LISTENING ────────────────────────────────────────────────── */}
      {state === 'listening' && (
        <div className="flex flex-col gap-4">
          {/* Header */}
          <div className="flex items-center gap-3">
            <svg
              className={`w-8 h-8 shrink-0 transition-colors ${armed ? 'text-red-400' : level > threshold ? 'text-orange-400' : 'text-slate-400'}`}
              fill="none" viewBox="0 0 24 24"
              stroke="currentColor" strokeWidth={1.4}
            >
              <path strokeLinecap="round" strokeLinejoin="round"
                d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 0 1 6 0v8.25a3 3 0 0 1-3 3z"
              />
            </svg>
            <div>
              <p className="text-slate-200 font-medium leading-none">Record from microphone</p>
              <div className="flex items-center gap-1.5 mt-1">
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${armed ? 'bg-red-500 animate-pulse' : 'bg-yellow-400 animate-pulse'}`} />
                <span className="text-slate-400 text-xs">
                  {armed ? 'Armed \u2014 will record when signal exceeds threshold' : 'Monitoring \u2014 arm to enable threshold trigger'}
                </span>
              </div>
            </div>
          </div>

          {/* Level meter + threshold slider — bar and slider share the same width */}
          <div className="flex flex-col gap-1">
            <span className="text-xs text-slate-500">Input level</span>
            <div className="h-3 bg-slate-800 rounded-full overflow-hidden relative">
              <div
                className="h-full bg-emerald-500 rounded-full transition-none"
                style={{ width: `${level * 100}%` }}
              />
              <div
                className="absolute inset-y-0 w-0.5 bg-amber-400"
                style={{ left: `${threshold * 100}%` }}
              />
            </div>
            <input
              type="range" min={0.01} max={1} step={0.01}
              value={threshold}
              onChange={e => setThreshold(Number(e.target.value))}
              disabled={disabled}
              className="w-full accent-amber-400 disabled:opacity-40"
            />
            <div className="flex justify-between">
              <span className="text-xs text-slate-400">Threshold</span>
              <span className="text-xs text-slate-400 tabular-nums">
                {Math.round(threshold * 100)}%
              </span>
            </div>
          </div>

          <button
            onClick={() => setArmed(a => !a)}
            disabled={disabled || requesting}
            className={[
              'w-full px-4 py-2.5 rounded-lg text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
              armed
                ? 'bg-red-600 hover:bg-red-500 text-white ring-2 ring-red-400'
                : 'bg-slate-600 hover:bg-slate-500 text-slate-200',
            ].join(' ')}
          >
            {armed ? 'Armed' : 'Arm'}
          </button>
        </div>
      )}

      {/* ── RECORDING ────────────────────────────────────────────────── */}
      {state === 'recording' && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-slate-200 font-medium">Recording</span>
            </div>
            <span className="text-slate-300 tabular-nums text-sm">{fmt(elapsedSec)}</span>
          </div>
          <button
            onClick={stopRecording}
            className="w-full px-4 py-3 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 text-white font-medium transition-colors"
          >
            Stop recording
          </button>
        </div>
      )}

      {/* ── RECORDED ─────────────────────────────────────────────────── */}
      {state === 'recorded' && recordedSamples && (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-slate-300 text-sm font-medium">
              Drag handles to select the region to process
            </span>
            <span className="text-xs text-slate-500 tabular-nums">
              {selDurSec}s selected
            </span>
          </div>
          <AudioPlayer wavBuffer={playbackWav} />
          <WaveformView
            samples={recordedSamples}
            color="#a78bfa"
            height={80}
            loopRegion={selection}
            onLoopChange={setSelection}
          />
          <div className="flex gap-2">
            <button
              onClick={reset}
              className="flex-1 px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm transition-colors"
            >
              Re-record
            </button>
            <button
              onClick={useSelection}
              className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition-colors"
            >
              Use selection
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
