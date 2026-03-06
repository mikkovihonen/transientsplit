import { useRef, useState, type DragEvent, type ChangeEvent } from 'react'

interface Props {
  onFile: (file: File) => void
  disabled?: boolean
}

export function DropZone({ onFile, disabled }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const accept = (file: File) => {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      alert('Please drop a .wav file.')
      return
    }
    onFile(file)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    if (disabled) return
    const file = e.dataTransfer.files[0]
    if (file) accept(file)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    if (!disabled) setDragging(true)
  }

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) accept(file)
    e.target.value = ''
  }

  return (
    <div
      onClick={() => !disabled && inputRef.current?.click()}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={() => setDragging(false)}
      className={[
        'flex flex-col items-center justify-center gap-4 rounded-2xl border-2 border-dashed',
        'cursor-pointer select-none transition-all duration-200 p-12 min-h-72',
        disabled
          ? 'border-slate-700 opacity-40 cursor-not-allowed'
          : dragging
            ? 'border-indigo-400 bg-indigo-950/40 scale-[1.01]'
            : 'border-slate-600 hover:border-indigo-500 hover:bg-slate-800/40',
      ].join(' ')}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".wav,audio/wav,audio/x-wav"
        onChange={onChange}
        className="hidden"
      />

      {/* Icon */}
      <svg
        className={`w-14 h-14 transition-colors ${dragging ? 'text-indigo-400' : 'text-slate-500'}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.2}
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3V15"
        />
      </svg>

      <div className="text-center">
        <p className="text-slate-200 font-medium text-lg">
          Drop a WAV file here
        </p>
        <p className="text-slate-400 text-sm mt-1">
          or click to browse
        </p>
      </div>
    </div>
  )
}
