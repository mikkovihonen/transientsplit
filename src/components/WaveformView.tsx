import { useEffect, useRef } from 'react'

interface LoopRegion {
  start: number // fraction [0, 1]
  end: number   // fraction [0, 1]
}

interface Props {
  samples: Float32Array | null
  color?: string
  height?: number
  loopRegion?: LoopRegion | null
  onLoopChange?: (region: LoopRegion) => void
}

const CANVAS_W = 800
const KNOB_W = 8
const KNOB_H = 16


function drawHandle(ctx: CanvasRenderingContext2D, x: number, height: number) {
  ctx.fillStyle = '#818cf8'
  // top knob
  ctx.beginPath()
  ctx.roundRect(x - KNOB_W / 2, 0, KNOB_W, KNOB_H, 2)
  ctx.fill()
  // bottom knob
  ctx.beginPath()
  ctx.roundRect(x - KNOB_W / 2, height - KNOB_H, KNOB_W, KNOB_H, 2)
  ctx.fill()
  // line
  ctx.strokeStyle = '#818cf8'
  ctx.lineWidth = 1.5
  ctx.beginPath()
  ctx.moveTo(x, 0)
  ctx.lineTo(x, height)
  ctx.stroke()
}

export function WaveformView({ samples, color = '#818cf8', height = 80, loopRegion, onLoopChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const dragRef = useRef<'start' | 'end' | null>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    ctx.clearRect(0, 0, CANVAS_W, height)

    if (!samples || samples.length === 0) {
      ctx.strokeStyle = '#334155'
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, height / 2)
      ctx.lineTo(CANVAS_W, height / 2)
      ctx.stroke()
    } else {
      const step = Math.max(1, Math.floor(samples.length / CANVAS_W))
      const mid = height / 2
      ctx.strokeStyle = color
      ctx.lineWidth = 1.5
      ctx.beginPath()
      for (let x = 0; x < CANVAS_W; x++) {
        const s = x * step
        const e = Math.min(s + step, samples.length)
        let min = 0, max = 0
        for (let i = s; i < e; i++) {
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
    }

    if (loopRegion) {
      const x1 = Math.round(loopRegion.start * CANVAS_W)
      const x2 = Math.round(loopRegion.end * CANVAS_W)
      ctx.fillStyle = 'rgba(99, 102, 241, 0.15)'
      ctx.fillRect(x1, 0, x2 - x1, height)

      drawHandle(ctx, x1, height)
      drawHandle(ctx, x2, height)
    }
  }, [samples, color, height, loopRegion])

  const getRect = () => canvasRef.current!.getBoundingClientRect()

  const clientXToFraction = (clientX: number) => {
    const rect = getRect()
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
  }

  const resolveHandle = (clientX: number, threshold = 10): 'start' | 'end' | null => {
    if (!loopRegion) return null
    const rect = getRect()
    const xPx = clientX - rect.left
    const x1 = loopRegion.start * rect.width
    const x2 = loopRegion.end * rect.width
    const d1 = Math.abs(xPx - x1)
    const d2 = Math.abs(xPx - x2)
    if (d1 < threshold && d2 < threshold) return d1 <= d2 ? 'start' : 'end'
    if (d1 < threshold) return 'start'
    if (d2 < threshold) return 'end'
    return null
  }

  const applyDrag = (clientX: number) => {
    if (!dragRef.current || !loopRegion || !onLoopChange) return
    const x = clientXToFraction(clientX)
    if (dragRef.current === 'start') {
      onLoopChange({ start: Math.min(x, loopRegion.end - 0.01), end: loopRegion.end })
    } else {
      onLoopChange({ start: loopRegion.start, end: Math.max(x, loopRegion.start + 0.01) })
    }
  }

  // Mouse handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!onLoopChange || !loopRegion) return
    const handle = resolveHandle(e.clientX)
    if (handle) { dragRef.current = handle; e.preventDefault() }
  }

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current
    if (!canvas) return
    if (dragRef.current) { applyDrag(e.clientX); return }
    canvas.style.cursor = onLoopChange && resolveHandle(e.clientX) ? 'ew-resize' : 'default'
  }

  const handleMouseUp = () => { dragRef.current = null }

  // Attach touch listeners as non-passive so preventDefault() works
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const onTouchStart = (e: TouchEvent) => {
      if (!onLoopChange || !loopRegion) return
      const handle = resolveHandle(e.touches[0].clientX, 20)
      if (handle) { dragRef.current = handle; e.preventDefault() }
    }

    const onTouchMove = (e: TouchEvent) => {
      if (!dragRef.current) return
      e.preventDefault()
      applyDrag(e.touches[0].clientX)
    }

    const onTouchEnd = () => { dragRef.current = null }

    canvas.addEventListener('touchstart', onTouchStart, { passive: false })
    canvas.addEventListener('touchmove', onTouchMove, { passive: false })
    canvas.addEventListener('touchend', onTouchEnd)
    return () => {
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchmove', onTouchMove)
      canvas.removeEventListener('touchend', onTouchEnd)
    }
  }, [loopRegion, onLoopChange])

  return (
    <canvas
      ref={canvasRef}
      width={CANVAS_W}
      height={height}
      className="w-full rounded"
      style={{ height }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
    />
  )
}
