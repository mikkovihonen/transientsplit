import { useEffect, useRef } from 'react'

interface Props {
  samples: Float32Array | null
  color?: string
  height?: number
}

export function WaveformView({ samples, color = '#818cf8', height = 80 }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const { width } = canvas
    ctx.clearRect(0, 0, width, height)

    if (!samples || samples.length === 0) {
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(width, height / 2)
      ctx.stroke()
      return
    }

    // Down-sample to canvas pixel width for performance
    const step = Math.max(1, Math.floor(samples.length / width))
    const mid = height / 2

    ctx.strokeStyle = color
    ctx.lineWidth = 1.5
    ctx.beginPath()

    for (let x = 0; x < width; x++) {
      const start = x * step
      const end = Math.min(start + step, samples.length)
      let min = 0, max = 0
      for (let i = start; i < end; i++) {
        if (samples[i] < min) min = samples[i]
        if (samples[i] > max) max = samples[i]
      }
      const yTop = mid - max * mid
      const yBot = mid - min * mid
      if (x === 0) ctx.moveTo(x, yTop)
      ctx.lineTo(x, yTop)
      ctx.lineTo(x, yBot)
    }
    ctx.stroke()
  }, [samples, color, height])

  return (
    <canvas
      ref={canvasRef}
      width={800}
      height={height}
      className="w-full rounded"
      style={{ height }}
    />
  )
}
