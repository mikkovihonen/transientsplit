/**
 * Optional SDT WebAssembly integration.
 *
 * This module tries to load the pre-compiled sdt-processor.wasm module
 * (built by wasm/build.sh).  If the file is not present or fails to load,
 * callers should fall back to the pure-TypeScript HPSS implementation.
 *
 * Usage:
 *   const sdt = await loadSDT()
 *   if (sdt) {
 *     const { transient, tonal } = sdt.process(samples, { ... })
 *   } else {
 *     // use hpss() from lib/hpss.ts
 *   }
 */

export interface SDTParams {
  winSize: number
  hopSize: number
  medianOrder: number
  sampleRate?: number
}

export interface SDTResult {
  transient: Float32Array
  tonal: Float32Array
}

// Emscripten module shape (partial)
interface EmModule {
  cwrap: (name: string, ret: string, args: string[]) => (...a: unknown[]) => unknown
  HEAPF32: Float32Array
  _malloc: (n: number) => number
  _free: (ptr: number) => void
}

let _module: EmModule | null = null
let _loadPromise: Promise<EmModule | null> | null = null

async function loadModule(): Promise<EmModule | null> {
  if (_module) return _module
  if (_loadPromise) return _loadPromise

  _loadPromise = (async () => {
    try {
      // Dynamically import the Emscripten glue script from /public.
      // The URL is kept in a variable so TypeScript's static resolver ignores it,
      // and @vite-ignore prevents Vite from analysing the specifier.
      const sdtUrl = '/sdt-processor.js'
      const sdtMod = await import(/* @vite-ignore */ sdtUrl) as { default: (opts?: object) => Promise<EmModule> }
      const mod: EmModule = await sdtMod.default()
      _module = mod
      return mod
    } catch {
      return null
    }
  })()

  return _loadPromise
}

export interface SDTProcessor {
  /** Run separation on a mono 48 kHz Float32Array */
  process(samples: Float32Array, params: SDTParams): SDTResult
  /** Release WASM-side resources */
  destroy(): void
}

/**
 * Load the SDT WASM module and return a processor, or null if unavailable.
 */
export async function loadSDT(): Promise<SDTProcessor | null> {
  const mod = await loadModule()
  if (!mod) return null

  const sdt_init     = mod.cwrap('sdt_init',     'void', ['number', 'number', 'number', 'number']) as
    (w: number, h: number, m: number, sr: number) => void
  const sdt_cleanup  = mod.cwrap('sdt_cleanup',  'void', []) as () => void
  const sdt_process  = mod.cwrap('sdt_process',  'number', ['number', 'number']) as
    (ptr: number, len: number) => number
  const sdt_free_result = mod.cwrap('sdt_free_result', 'void', ['number']) as (p: number) => void
  const sdt_alloc_f32   = mod.cwrap('sdt_alloc_f32',   'number', ['number']) as (n: number) => number

  return {
    process(samples: Float32Array, params: SDTParams): SDTResult {
      const { winSize, hopSize, medianOrder, sampleRate = 48000 } = params
      sdt_init(winSize, hopSize, medianOrder, sampleRate)

      // Copy samples into WASM heap
      const inPtr = sdt_alloc_f32(samples.length)
      mod.HEAPF32.set(samples, inPtr >> 2)

      const outPtr = sdt_process(inPtr, samples.length)
      mod._free(inPtr)

      if (!outPtr) {
        sdt_cleanup()
        throw new Error('SDT WASM: sdt_process returned null')
      }

      // Read interleaved [transient, tonal] pairs
      const transient = new Float32Array(samples.length)
      const tonal     = new Float32Array(samples.length)
      const heap = mod.HEAPF32
      const base = outPtr >> 2

      for (let i = 0; i < samples.length; i++) {
        transient[i] = heap[base + i * 2]
        tonal[i]     = heap[base + i * 2 + 1]
      }

      sdt_free_result(outPtr)
      sdt_cleanup()

      return { transient, tonal }
    },

    destroy() {
      sdt_cleanup()
    },
  }
}
