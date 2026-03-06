export interface SDTParams {
  winSize: number
  radius: number  // fixed radius for SDT algorithm
  overlap: number  // window overlap
  tonalThresholdDb: number  // default tonal threshold
  noiseThresholdDb: number  // default noise threshold
}

export const SDT_WINDOW_SIZE = 2048 // analysis window used in the WASM processor

export interface SDTResult {
  transient: Float32Array
  tonal: Float32Array
  residual: Float32Array
}

// convert dB-like value (<=0) to linear 0..1 range used by SDT
function dbToLinear(db: number): number {
  // restrict to -100..0 for stability
  const clipped = Math.max(-100, Math.min(0, db))
  return Math.pow(10, clipped / 20)
}

export interface SDTOptions {
  radius?: number               // smoothing kernel radius (samples)
  overlap?: number              // window overlap factor (0.0-1.0)
  tonalThresholdDb?: number     // dB-style tonal threshold (0 = agressive, -80 = picky)
  noiseThresholdDb?: number     // dB-style residual threshold
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
    // we'll build the absolute URL for the glue script and retain it so the
    // catch block can report it if the load fails.  `base` comes from Vite's
    // environment; use an any cast to avoid TypeScript errors.
    let sdtUrl: string = '<unknown>'
    try {
      // Dynamically import the Emscripten glue script from public.
      // In a worker context, we need to use the origin to serve public files from
      // the root, not from the worker's asset directory.
      let base: string
      if (typeof self !== 'undefined' && typeof self.location !== 'undefined') {
        // Worker context: use origin + '/' to serve from root
        base = self.location.origin + '/'
        console.debug('loadSDT: worker context, base from origin:', base)
      } else if (typeof window !== 'undefined') {
        // Main thread: use document base
        base = ((import.meta as any).env?.BASE_URL as string) || '/'
        console.debug('loadSDT: main thread, base from import.meta.env:', base)
      } else {
        base = '/'
        console.debug('loadSDT: unknown context, using default base: /')
      }
      
      const sdtUrl = new URL('sdt-processor.js', base).href
      console.debug('loadSDT: attempting to load script from', sdtUrl)

      // The generated file is UMD/AMD and may not export an ES module default.
      // When imported via dynamic `import()` we may receive an empty namespace.
      // We therefore attempt to find the factory function in several places.
      let factory: ((opts?: object) => Promise<EmModule>) | undefined
      
      // Try dynamic import first.  In past versions we kept a manual
      // fetch+eval fallback to locate the `createSDTModule` factory when
      // imports failed in some runtime environments.  That `eval` triggered
      // warnings during Vite builds, so we no longer bother with it – the
      // dynamic import should work in our controlled worker context, and we
      // also check for a global as a safety net.  Removing eval silences the
      // build warning and avoids any associated security concerns.
      try {
        const sdtMod = await import(/* @vite-ignore */ sdtUrl)
        console.debug('loadSDT: script imported', { mod: sdtMod })
        if (typeof sdtMod === 'function') {
          console.debug('loadSDT: module is a function')
          factory = sdtMod as unknown as typeof factory
        } else if (sdtMod && typeof (sdtMod as any).default === 'function') {
          console.debug('loadSDT: found factory in .default')
          factory = (sdtMod as any).default
        } else if (sdtMod && typeof (sdtMod as any).createSDTModule === 'function') {
          console.debug('loadSDT: found factory in .createSDTModule')
          factory = (sdtMod as any).createSDTModule
        } else {
          console.debug('loadSDT: module imported but no factory found in any property', { keys: Object.keys(sdtMod || {}) })
        }
      } catch (e) {
        // dynamic import may fail in some runtime; we'll try global
        console.warn('loadSDT: dynamic import of script failed', e)
      }

      // if import didn't produce a factory, try retrieving via global
      if (!factory) {
        console.debug('loadSDT: checking globalThis for createSDTModule')
        if (typeof (globalThis as any).createSDTModule === 'function') {
          console.debug('loadSDT: found factory in globalThis.createSDTModule')
          factory = (globalThis as any).createSDTModule
        } else {
          console.debug('loadSDT: createSDTModule not in globalThis')
        }
      }

      if (!factory) {
        throw new Error('SDT module factory not found after import or global');
      }

      console.debug('loadSDT: factory found, initializing module')
      const wasmUrl = new URL('sdt-processor.wasm', base).href
      console.debug('loadSDT: wasm URL will be', wasmUrl)

      // The generated module will attempt to load the .wasm relative to the
      // script's directory (typically the worker asset path).  However, Vite
      // places the wasm at the site root, so override locateFile so that the
      // binary is always fetched from the correct location.
      const mod: EmModule = await factory({
        locateFile: (path: string) => {
          // ignore the passed script directory; wasm is also at base URL
          if (path.endsWith('.wasm')) {
            console.debug('loadSDT: locateFile called for', path, 'returning', wasmUrl)
            return wasmUrl
          }
          return path
        },
      })
      console.debug('loadSDT: module initialized successfully')
      _module = mod
      return mod
    } catch (err) {
      // keep a record of why loading failed (404, parse error, etc.)
      console.error('loadSDT: failed to import SDT module from', sdtUrl, err)
      return null
    }
  })()

  return _loadPromise
}

export interface SDTProcessor {
  /** Run separation on a mono 48 kHz Float32Array; options may tweak the
   *  analysis behaviour.  Calling with different options will re‑initialise
   *  the underlying demixer internally. */
  process(samples: Float32Array, opts?: SDTOptions): SDTResult
  /** Release WASM-side resources */
  destroy(): void
}

/**
 * Load the SDT WASM module and return a processor, or null if unavailable.
 */
export async function loadSDT(): Promise<SDTProcessor> {
  const mod = await loadModule()
  if (!mod) {
    // bubble up a clear error so callers can report it; loadModule already logs
    // details to the console.
    throw new Error('SDT WASM module unavailable – check console for details')
  }

  const sdt_init     = mod.cwrap('sdt_init',     'void', ['number', 'number', 'number', 'number', 'number']) as
    (w: number, r: number, o: number, t: number, n: number) => void
  const sdt_cleanup  = mod.cwrap('sdt_cleanup',  'void', []) as () => void
  const sdt_process  = mod.cwrap('sdt_process',  'number', ['number', 'number']) as
    (ptr: number, len: number) => number
  const sdt_free_result = mod.cwrap('sdt_free_result', 'void', ['number']) as (p: number) => void
  const sdt_alloc_f32   = mod.cwrap('sdt_alloc_f32',   'number', ['number']) as (n: number) => number

  // keep track of whether we've initialized the demixer and with which
  // options; if the requested parameters change we must re‑initialise so the
  // new behaviour takes effect, otherwise keep existing state across chunks.
  let initialized = false
  // keep previous *db* options so we can detect any change and reinit
  let lastOpts: Required<SDTOptions> = {
    radius: 4,
    overlap: 0.5,
    tonalThresholdDb: -40,
    noiseThresholdDb: -60,
  }

  return {
    process(samples: Float32Array, opts: SDTOptions = {}): SDTResult {
      const winSize = SDT_WINDOW_SIZE
      // merge provided options with defaults
      const radius = opts.radius ?? lastOpts.radius
      const overlap = opts.overlap ?? lastOpts.overlap
      const tonalThresholdDb = opts.tonalThresholdDb ?? lastOpts.tonalThresholdDb
      const noiseThresholdDb = opts.noiseThresholdDb ?? lastOpts.noiseThresholdDb

      const optsChanged =
        !initialized ||
        radius !== lastOpts.radius ||
        overlap !== lastOpts.overlap ||
        tonalThresholdDb !== lastOpts.tonalThresholdDb ||
        noiseThresholdDb !== lastOpts.noiseThresholdDb

      if (optsChanged) {
        // convert from user-facing dB values to [0,1] as required by SDT
        const tonalLin = dbToLinear(tonalThresholdDb)
        const noiseLin = dbToLinear(noiseThresholdDb)
        sdt_init(winSize, radius, overlap, tonalLin, noiseLin)
        initialized = true
        lastOpts = { radius, overlap, tonalThresholdDb, noiseThresholdDb }
      }

      // Copy samples into WASM heap
      const inPtr = sdt_alloc_f32(samples.length)
      if (!inPtr) {
        throw new Error('SDT WASM: failed to allocate input buffer (out of memory)')
      }
      const inOffset = inPtr >> 2
      if (inOffset + samples.length > mod.HEAPF32.length) {
        throw new Error('SDT WASM: input allocation out of bounds')
      }
      // pre-flight: output buffer is frames*3 floats, plus algorithm overhead.
      // ensure we have at least 3× samples.length space in the current heap.  Use
      // a small safety margin so the WASM code doesn't bump the limit internally.
      const required = samples.length * 3
      const available = mod.HEAPF32.length
      if (required + 1024 > available) {
        throw new Error(`SDT WASM: input length (${samples.length}) too large for current heap (${available} floats, need ~${required}). ` +
                        'Consider rebuilding with more INITIAL_MEMORY or using a shorter file.')
      }
      mod.HEAPF32.set(samples, inOffset)

      let outPtr: number
      try {
        outPtr = sdt_process(inPtr, samples.length)
      } catch (e) {
        mod._free(inPtr)
        // include sample length and parameters for easier debugging
        const ctx = `len=${samples.length}`
        let msg = `SDT WASM: process failed (${e instanceof Error ? e.message : String(e)}) [${ctx}]`
        // memory errors often indicate too-large input or insufficient heap
        if (typeof e === 'object' && e !== null && String(e).includes('memory access out of bounds')) {
          msg += ' (possible heap overflow)'
        }
        throw new Error(msg)
      }
      mod._free(inPtr)

      if (!outPtr) {
        sdt_cleanup()
        throw new Error('SDT WASM: sdt_process returned null')
      }

      // Read interleaved [percussive, harmonic, residual] triplets
      const totalLen = samples.length * 3
      const base = outPtr >> 2
      if (base + totalLen > mod.HEAPF32.length) {
        sdt_cleanup()
        throw new Error('SDT WASM: output pointer out of bounds')
      }

      const transient = new Float32Array(samples.length)
      const tonal = new Float32Array(samples.length)
      const residual = new Float32Array(samples.length)
      const heap = mod.HEAPF32

      for (let i = 0; i < samples.length; i++) {
        transient[i] = heap[base + i * 3]     // P (percussive)
        tonal[i] = heap[base + i * 3 + 1]   // H (harmonic)
        residual[i] = heap[base + i * 3 + 2]   // R (residual)
      }

      sdt_free_result(outPtr)

      return { transient, tonal, residual }
    },

    destroy() {
      if (initialized) {
        sdt_cleanup()
        initialized = false
      }
    },
  }
}
