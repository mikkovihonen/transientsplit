import { WaveformView } from './WaveformView'
import { AudioPlayer } from './AudioPlayer'
import { encodeWav, buildCrossfadeSamples } from '../lib/wav'

const SR = 48000
const CROSSFADE_SAMPLES = Math.round(0.05 * SR) // must match AudioPlayer CROSSFADE_SEC

export interface LoopControls {
  enabled: boolean
  seamless: boolean
  start: number   // fraction [0, 1]
  end: number     // fraction [0, 1]
  duration: number // seconds, for time display
  onChange: (lc: Omit<LoopControls, 'onChange' | 'duration'>) => void
}

interface Props {
  title: string
  subtitle: string
  accentColor: string
  waveColor: string
  samples: Float32Array | null
  wavBuffer: ArrayBuffer | null
  filename: string
  loopControls?: LoopControls
}


export function ResultCard({
  title,
  subtitle,
  accentColor,
  waveColor,
  samples,
  wavBuffer,
  filename,
  loopControls,
}: Props) {
  const download = () => {
    if (!samples) return

    let outSamples: Float32Array
    let loopPoint: { startSample: number; endSample: number } | undefined

    if (loopControls?.enabled) {
      const loopStartSample = Math.round(loopControls.start * samples.length)
      const loopEndSample   = Math.round(loopControls.end   * samples.length)

      if (loopControls.seamless) {
        // Build pre-roll + crossfade buffer, matching AudioPlayer's seamless mode
        const { cfSamples, handoffSample } = buildCrossfadeSamples(
          samples, loopStartSample, loopEndSample, CROSSFADE_SAMPLES,
        )
        outSamples = new Float32Array(handoffSample + cfSamples.length)
        outSamples.set(samples.subarray(0, handoffSample), 0)
        outSamples.set(cfSamples, handoffSample)
        loopPoint = { startSample: handoffSample, endSample: handoffSample + cfSamples.length - 1 }
      } else {
        outSamples = samples
        loopPoint = { startSample: loopStartSample, endSample: loopEndSample - 1 }
      }
    } else {
      outSamples = samples
    }

    const wav = encodeWav(outSamples, SR, { format: 'pcm16', loopPoint })
    const blob = new Blob([wav], { type: 'audio/wav' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = filename
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="bg-slate-900 border border-slate-700/60 rounded-2xl p-5 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className={`w-2.5 h-2.5 rounded-full ${accentColor}`} />
            <h3 className="text-slate-100 font-semibold text-base">{title}</h3>
          </div>
          <p className="text-slate-400 text-xs mt-0.5 ml-4">{subtitle}</p>
        </div>

        <button
          onClick={download}
          disabled={!wavBuffer}
          title={`Download ${filename}`}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-800 hover:bg-slate-700 disabled:opacity-30 disabled:cursor-not-allowed text-slate-200 transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1m-4-4-4 4m0 0-4-4m4 4V4" />
          </svg>
          Download
        </button>
      </div>

      {/* Waveform */}
      <div className="bg-slate-950/60 rounded-xl px-3 py-2">
        <WaveformView
          samples={samples}
          color={waveColor}
          height={72}
          loopRegion={loopControls?.enabled ? { start: loopControls.start, end: loopControls.end } : null}
          onLoopChange={loopControls?.enabled
            ? (region) => loopControls.onChange({ enabled: true, seamless: loopControls.seamless, ...region })
            : undefined}
        />
      </div>

      {/* Loop controls */}
      {loopControls && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => loopControls.onChange({ ...loopControls, enabled: !loopControls.enabled })}
            className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
              loopControls.enabled
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
            </svg>
            Loop
          </button>

          {loopControls.enabled && (
            <button
              onClick={() => loopControls.onChange({ ...loopControls, seamless: !loopControls.seamless })}
              title="Crossfade loop seam to eliminate clicks"
              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                loopControls.seamless
                  ? 'bg-violet-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-slate-200'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 9V4.5M9 9H4.5M9 9 3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5 5.25 5.25" />
              </svg>
              Seamless
            </button>
          )}
        </div>
      )}

      {/* Player */}
      <AudioPlayer
        wavBuffer={wavBuffer}
        loop={loopControls?.enabled ?? false}
        loopStart={loopControls?.start}
        loopEnd={loopControls?.end}
        seamlessLoop={loopControls?.seamless ?? false}
      />
    </div>
  )
}
