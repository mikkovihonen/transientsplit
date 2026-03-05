import type { HPSSParams } from '../lib/hpss'

export interface FullParams extends HPSSParams {
  crossfadeMs: number
}

interface Props {
  params: FullParams
  onChange: (p: FullParams) => void
  disabled?: boolean
}

interface SliderProps {
  label: string
  hint: string
  value: number
  min: number
  max: number
  step?: number
  format?: (v: number) => string
  onChange: (v: number) => void
  disabled?: boolean
}

function Slider({ label, hint, value, min, max, step = 1, format, onChange, disabled }: SliderProps) {
  const display = format ? format(value) : String(value)
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between">
        <label className="text-slate-300 text-sm font-medium">{label}</label>
        <span className="text-indigo-300 text-sm tabular-nums font-mono">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-indigo-500 disabled:opacity-40"
      />
      <p className="text-slate-500 text-xs">{hint}</p>
    </div>
  )
}

const FFT_SIZES = [512, 1024, 2048, 4096]

export function ParametersPanel({ params, onChange, disabled }: Props) {
  const set = <K extends keyof FullParams>(key: K, val: FullParams[K]) =>
    onChange({ ...params, [key]: val })

  const ensureOdd = (v: number) => (v % 2 === 0 ? v + 1 : v)

  return (
    <details className="group" open>
      <summary className="flex items-center justify-between cursor-pointer list-none py-3 px-4 rounded-xl bg-slate-900 border border-slate-700/60 select-none">
        <span className="text-slate-200 font-medium text-sm">Processing Parameters</span>
        <svg
          className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180"
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="m19 9-7 7-7-7" />
        </svg>
      </summary>

      <div className="mt-2 px-4 pb-4 pt-3 bg-slate-900 border border-slate-700/60 border-t-0 rounded-b-xl grid grid-cols-1 sm:grid-cols-2 gap-5">

        {/* FFT Size */}
        <div className="flex flex-col gap-1.5">
          <label className="text-slate-300 text-sm font-medium">FFT Window Size</label>
          <div className="flex gap-2 flex-wrap">
            {FFT_SIZES.map((s) => (
              <button
                key={s}
                disabled={disabled}
                onClick={() => set('fftSize', s)}
                className={[
                  'px-3 py-1 rounded-lg text-xs font-mono font-medium transition-colors',
                  params.fftSize === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-slate-800 text-slate-300 hover:bg-slate-700',
                  disabled ? 'opacity-40 cursor-not-allowed' : '',
                ].join(' ')}
              >
                {s}
              </button>
            ))}
          </div>
          <p className="text-slate-500 text-xs">
            Larger = better frequency resolution, more latency
          </p>
        </div>

        {/* Hop size (auto) */}
        <div className="flex flex-col gap-1.5">
          <label className="text-slate-300 text-sm font-medium">Hop Size</label>
          <span className="text-indigo-300 text-sm font-mono">
            {params.fftSize / 4} samples (75% overlap)
          </span>
          <p className="text-slate-500 text-xs">Fixed at ¼ of FFT size for optimal OLA</p>
        </div>

        <Slider
          label="Harmonic Median Length"
          hint="Frames along time axis — higher = more tonal separation"
          value={params.harmonicL}
          min={3}
          max={31}
          step={2}
          onChange={(v) => set('harmonicL', ensureOdd(v))}
          disabled={disabled}
        />

        <Slider
          label="Percussive Median Length"
          hint="Bins along frequency axis — higher = more transient separation"
          value={params.percussiveL}
          min={3}
          max={31}
          step={2}
          onChange={(v) => set('percussiveL', ensureOdd(v))}
          disabled={disabled}
        />

        <Slider
          label="Wiener Power"
          hint="Higher = harder separation (less bleed-through)"
          value={params.power}
          min={1}
          max={4}
          step={0.5}
          format={(v) => v.toFixed(1)}
          onChange={(v) => set('power', v)}
          disabled={disabled}
        />

        <Slider
          label="Loop Cross-fade"
          hint="Length of the seamless loop blend region"
          value={params.crossfadeMs}
          min={10}
          max={500}
          step={10}
          format={(v) => `${v} ms`}
          onChange={(v) => set('crossfadeMs', v)}
          disabled={disabled}
        />
      </div>
    </details>
  )
}
