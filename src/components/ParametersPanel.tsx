import { useState, useEffect } from 'react'

export interface FullParams {
  radius: number
  tonalThresholdDb: number
  noiseThresholdDb: number
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
  const [local, setLocal] = useState(value)
  const display = format ? format(local) : String(local)

  // when parent value changes (e.g. reset) sync local
  useEffect(() => {
    setLocal(value)
  }, [value])

  const commit = () => {
    if (local !== value) {
      onChange(local)
    }
  }

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
        value={local}
        disabled={disabled}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={commit}
        onTouchEnd={commit}
        onKeyUp={(e) => {
          if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') {
            commit()
          }
        }}
        className="w-full accent-indigo-500 disabled:opacity-40"
      />
      <p className="text-slate-500 text-xs">{hint}</p>
    </div>
  )
}
export function ParametersPanel({ params, onChange, disabled }: Props) {
  const set = <K extends keyof FullParams>(key: K, val: FullParams[K]) =>
    onChange({ ...params, [key]: val })

  return (
    <div className="mt-2 px-4 pb-4 pt-3 bg-slate-900 border border-slate-700/60 rounded-xl">
      <h2 className="text-slate-200 font-medium text-sm">Splitter Parameters</h2>

      <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-4">
       
        <Slider
          label="Kernel Radius"
          hint="Smoothing radius (samples) for structure tensor"
          value={params.radius}
          min={1}
          max={16}
          step={1}
          onChange={(v) => set('radius', v)}
          disabled={disabled}
        />
        <Slider
          label="Tonal Threshold"
          hint="Higher = more aggressive tonal detection (in dB)"
          value={params.tonalThresholdDb}
          min={-80}
          max={0}
          step={1}
          format={(v) => `${v} dB`}
          onChange={(v) => set('tonalThresholdDb', v)}
          disabled={disabled}
        />
        <Slider
          label="Residual Threshold"
          hint="Higher = more noise/residual output (in dB)"
          value={params.noiseThresholdDb}
          min={-80}
          max={0}
          step={1}
          format={(v) => `${v} dB`}
          onChange={(v) => set('noiseThresholdDb', v)}
          disabled={disabled}
        />
      </div>
      </div>
  )
}
