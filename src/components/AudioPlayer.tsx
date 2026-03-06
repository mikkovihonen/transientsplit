import { useEffect, useRef, useState } from 'react'

interface Props {
  wavBuffer: ArrayBuffer | null
  loop?: boolean
  loopStart?: number // fraction [0, 1]
  loopEnd?: number   // fraction [0, 1]
}

export function AudioPlayer({ wavBuffer, loop = false, loopStart = 0, loopEnd = 1 }: Props) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const startAtRef = useRef(0)
  const offsetRef = useRef(0)
  const rafRef = useRef(0)
  const audioBufferRef = useRef<AudioBuffer | null>(null)

  // Decode WAV when buffer changes
  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    audioBufferRef.current = null
    if (!wavBuffer) return

    const ctx = getCtx()
    ctx.decodeAudioData(wavBuffer.slice(0)).then((decoded) => {
      audioBufferRef.current = decoded
      setDuration(decoded.duration)
    })

    return () => stopPlayback()
  }, [wavBuffer])

  // Cleanup on unmount
  useEffect(() => () => stopPlayback(), [])

  // Update loop points on the running source in real-time
  useEffect(() => {
    const src = sourceRef.current
    const buf = audioBufferRef.current
    if (!src || !buf || !loop) return
    src.loopStart = loopStart * buf.duration
    src.loopEnd = loopEnd * buf.duration
  }, [loop, loopStart, loopEnd])

  function getCtx() {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    return ctxRef.current
  }

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current)
    if (sourceRef.current) {
      try { sourceRef.current.stop() } catch { /* already stopped */ }
      sourceRef.current = null
    }
  }

  function startPlayback() {
    if (!audioBufferRef.current) return
    const ctx = getCtx()
    if (ctx.state === 'suspended') ctx.resume()

    stopPlayback()

    const src = ctx.createBufferSource()
    src.buffer = audioBufferRef.current
    src.loop = loop
    if (loop) {
      const dur = audioBufferRef.current.duration
      src.loopStart = loopStart * dur
      src.loopEnd = loopEnd * dur
    }
    src.connect(ctx.destination)
    src.onended = () => {
      if (!loop) {
        setPlaying(false)
        setCurrentTime(0)
        offsetRef.current = 0
      }
    }
    sourceRef.current = src
    startAtRef.current = ctx.currentTime - offsetRef.current
    src.start(0, offsetRef.current)
    setPlaying(true)

    const tick = () => {
      if (!sourceRef.current) return
      const elapsed = ctx.currentTime - startAtRef.current
      const dur = audioBufferRef.current?.duration ?? 1
      if (loop) {
        setCurrentTime(elapsed % dur)
      } else {
        setCurrentTime(Math.min(elapsed, dur))
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function pausePlayback() {
    if (!ctxRef.current || !sourceRef.current) return
    offsetRef.current = ctxRef.current.currentTime - startAtRef.current
    stopPlayback()
    setPlaying(false)
  }

  const toggle = () => (playing ? pausePlayback() : startPlayback())

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0
  const fmt = (s: number) =>
    `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

  return (
    <div className="flex items-center gap-3">
      {/* Play/pause button */}
      <button
        onClick={toggle}
        disabled={!wavBuffer}
        className="w-9 h-9 flex items-center justify-center rounded-full bg-indigo-600 hover:bg-indigo-500 disabled:opacity-30 disabled:cursor-not-allowed transition-colors shrink-0"
      >
        {playing ? (
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>

      {/* Progress bar */}
      <div className="flex-1 h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-indigo-500 rounded-full transition-none"
          style={{ width: `${pct}%` }}
        />
      </div>

      {/* Time */}
      <span className="text-xs text-slate-400 tabular-nums w-10 text-right shrink-0">
        {fmt(currentTime)}
      </span>
    </div>
  )
}
