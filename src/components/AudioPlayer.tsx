import { useEffect, useRef, useState } from 'react'

const CROSSFADE_SEC = 0.05 // 50 ms equal-power crossfade at loop seam

/**
 * Builds a single combined AudioBuffer with the pre-roll baked in before the
 * crossfade loop region, so one AudioBufferSourceNode can play everything
 * gap-free using the native loop mechanism.
 *
 * Layout:
 *   [0 .. handoffFrame)        raw pre-roll (frames 0..B-X-1 of the source)
 *   [handoffFrame .. total)    crossfade loop region (length outLen = L - X)
 *
 * The crossfade loop region uses overlap-add at its start so the native loop
 * wrap (total → handoffFrame) is click-free:
 *   loop[0..X-1]  = head * fadeIn + tail * fadeOut   (blends end→start)
 *   loop[X..L-X)  = head[X..]                         (straight copy)
 *
 * Returns the combined buffer and the loop start/end in seconds.
 */
function createSeamlessBuffer(
  ctx: AudioContext,
  buf: AudioBuffer,
  loopStartSec: number,
  loopEndSec: number,
  crossfadeSec: number,
): { combined: AudioBuffer; loopStartSec: number; loopEndSec: number } {
  const sr = buf.sampleRate
  const A = Math.round(loopStartSec * sr)
  const B = Math.round(loopEndSec * sr)
  const L = B - A
  const X = Math.min(Math.round(crossfadeSec * sr), Math.floor(L / 2))
  const outLen     = L - X        // crossfade loop region length
  const handoff    = B - X        // frame where pre-roll ends / loop begins
  const totalLen   = handoff + outLen

  const combined = ctx.createBuffer(buf.numberOfChannels, totalLen, sr)
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const src = buf.getChannelData(ch)
    const dst = combined.getChannelData(ch)

    // Pre-roll: straight copy of rawBuf[0..handoff-1]
    for (let i = 0; i < handoff; i++) {
      dst[i] = src[i]
    }
    // Crossfade loop region
    for (let i = 0; i < X; i++) {
      const t       = i / X
      const fadeIn  = Math.sin(t * Math.PI * 0.5) ** 2
      const fadeOut = Math.cos(t * Math.PI * 0.5) ** 2
      dst[handoff + i] = src[A + i] * fadeIn + src[B - X + i] * fadeOut
    }
    for (let i = X; i < outLen; i++) {
      dst[handoff + i] = src[A + i]
    }
  }

  return {
    combined,
    loopStartSec: handoff  / sr,
    loopEndSec:   totalLen / sr,
  }
}

interface Props {
  wavBuffer: ArrayBuffer | null
  loop?: boolean
  loopStart?: number // fraction [0, 1]
  loopEnd?: number   // fraction [0, 1]
  seamlessLoop?: boolean
}

export function AudioPlayer({ wavBuffer, loop = false, loopStart = 0, loopEnd = 1, seamlessLoop = false }: Props) {
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const ctxRef = useRef<AudioContext | null>(null)
  const sourceRef = useRef<AudioBufferSourceNode | null>(null)
  const nextSourceRef = useRef<AudioBufferSourceNode | null>(null) // scheduled loop source
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
    }).catch((err) => {
      console.error('AudioPlayer: decodeAudioData failed', err, { byteLength: wavBuffer.byteLength })
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
    if (seamlessLoop) {
      // Save position so we resume from where we are, not from 0
      if (ctxRef.current && (sourceRef.current || nextSourceRef.current)) {
        offsetRef.current = ctxRef.current.currentTime - startAtRef.current
      }
      startPlayback()
      return
    }
    src.loopStart = loopStart * buf.duration
    src.loopEnd = loopEnd * buf.duration
  }, [loop, loopStart, loopEnd, seamlessLoop])

  function getCtx() {
    if (!ctxRef.current || ctxRef.current.state === 'closed') {
      ctxRef.current = new AudioContext()
    }
    return ctxRef.current
  }

  function stopPlayback() {
    cancelAnimationFrame(rafRef.current)
    if (nextSourceRef.current) {
      try { nextSourceRef.current.stop() } catch { /* already stopped */ }
      nextSourceRef.current = null
    }
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

    const now = ctx.currentTime
    const rawBuf = audioBufferRef.current
    const startOffset = offsetRef.current

    if (loop && seamlessLoop) {
      // Build a single combined buffer: [pre-roll][crossfade loop region].
      // One AudioBufferSourceNode with native loop handles everything gap-free —
      // no inter-node handoff, so no scheduling gap at the first loop point.
      const lStartSec = loopStart * rawBuf.duration
      const lEndSec   = loopEnd   * rawBuf.duration
      const { combined, loopStartSec: cfStart, loopEndSec: cfEnd } =
        createSeamlessBuffer(ctx, rawBuf, lStartSec, lEndSec, CROSSFADE_SEC)
      const loopDur = cfEnd - cfStart

      // Map virtual-timeline offset to position in the combined buffer.
      // If we're resuming inside the loop phase, wrap into [cfStart, cfEnd).
      const bufOffset = startOffset < cfStart
        ? startOffset
        : cfStart + ((startOffset - cfStart) % loopDur)

      const src = ctx.createBufferSource()
      src.buffer    = combined
      src.loop      = true
      src.loopStart = cfStart
      src.loopEnd   = cfEnd
      src.connect(ctx.destination)
      // startAtRef tracks the virtual timeline (not the buffer offset)
      startAtRef.current = now - startOffset
      src.start(now, bufOffset)
      sourceRef.current     = src
      nextSourceRef.current = null

      setPlaying(true)
      const tick = () => {
        if (!sourceRef.current) return
        const elapsed  = ctx.currentTime - startAtRef.current
        const dispTime = elapsed < cfStart
          ? elapsed
          : cfStart + ((elapsed - cfStart) % loopDur)
        setCurrentTime(dispTime)
        rafRef.current = requestAnimationFrame(tick)
      }
      rafRef.current = requestAnimationFrame(tick)
      return
    }

    // Native loop or one-shot
    const src = ctx.createBufferSource()
    src.buffer = rawBuf
    src.loop   = loop
    if (loop) {
      src.loopStart = loopStart * rawBuf.duration
      src.loopEnd   = loopEnd   * rawBuf.duration
    }
    src.connect(ctx.destination)
    src.onended = () => {
      if (!loop) {
        setPlaying(false)
        setCurrentTime(0)
        offsetRef.current = 0
      }
    }
    sourceRef.current  = src
    startAtRef.current = now - startOffset
    src.start(now, startOffset)
    setPlaying(true)

    const tick = () => {
      if (!sourceRef.current) return
      const elapsed = ctx.currentTime - startAtRef.current
      const dur     = rawBuf.duration
      setCurrentTime(loop ? elapsed % dur : Math.min(elapsed, dur))
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
  }

  function pausePlayback() {
    stopPlayback()
    offsetRef.current = 0
    setCurrentTime(0)
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
        disabled={!wavBuffer || duration === 0}
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
