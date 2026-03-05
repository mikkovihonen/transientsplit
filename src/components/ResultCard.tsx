import { WaveformView } from './WaveformView'
import { AudioPlayer } from './AudioPlayer'

interface Props {
  title: string
  subtitle: string
  accentColor: string
  waveColor: string
  samples: Float32Array | null
  wavBuffer: ArrayBuffer | null
  filename: string
  loop?: boolean
}

export function ResultCard({
  title,
  subtitle,
  accentColor,
  waveColor,
  samples,
  wavBuffer,
  filename,
  loop,
}: Props) {
  const download = () => {
    if (!wavBuffer) return
    const blob = new Blob([wavBuffer], { type: 'audio/wav' })
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
        <WaveformView samples={samples} color={waveColor} height={72} />
      </div>

      {/* Player */}
      <AudioPlayer wavBuffer={wavBuffer} loop={loop} />

      {/* Loop badge */}
      {loop && (
        <div className="flex items-center gap-1.5 text-xs text-emerald-400">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" />
          </svg>
          Seamless loop ready
        </div>
      )}
    </div>
  )
}
