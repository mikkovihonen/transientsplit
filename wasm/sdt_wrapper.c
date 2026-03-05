/**
 * Emscripten wrapper for the Sound Design Toolkit SDTDemix module.
 *
 * SDT repository: https://github.com/SDT-org/SDT
 * Clone it alongside this file before building (see build.sh).
 *
 * SDTDemix implements Harmonic-Percussive Source Separation (HPSS).
 * It separates an audio stream into:
 *   - Tonal  (harmonic / sustained) component
 *   - Transient (percussive / attack) component
 *
 * Build with:
 *   cd wasm && bash build.sh
 *
 * The compiled output (sdt-processor.js + sdt-processor.wasm) goes into
 * public/ so Vite serves it automatically.
 */

#include <emscripten.h>
#include <stdlib.h>
#include <string.h>
#include <math.h>

/* SDT headers – available after cloning the repo */
#include "SDT/SDTCommon.h"
#include "SDT/SDTDemix.h"

/* ─── Module state ────────────────────────────────────────────────────────── */

static SDTDemix *g_demix = NULL;

/* Output ring buffers (float) – allocated on init, freed on cleanup */
static float *g_transientBuf = NULL;
static float *g_tonalBuf     = NULL;
static int    g_bufLen       = 0;

/* ─── Lifecycle ───────────────────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
void sdt_init(int winSize, int hopSize, int medianOrder, double sampleRate) {
    sdt_cleanup(); /* free any previous state */

    SDT_init(sampleRate);

    g_demix = SDTDemix_new(winSize);
    if (!g_demix) return;

    SDTDemix_setWinSize(g_demix,     winSize);
    SDTDemix_setHopSize(g_demix,     hopSize);
    SDTDemix_setOverlap(g_demix,     (double)(winSize - hopSize) / winSize);
    SDTDemix_setDifference(g_demix,  (double)medianOrder);
}

EMSCRIPTEN_KEEPALIVE
void sdt_cleanup(void) {
    if (g_demix) {
        SDTDemix_free(g_demix);
        g_demix = NULL;
    }
    if (g_transientBuf) { free(g_transientBuf); g_transientBuf = NULL; }
    if (g_tonalBuf)     { free(g_tonalBuf);     g_tonalBuf     = NULL; }
    g_bufLen = 0;
    SDT_cleanup();
}

/* ─── Processing ─────────────────────────────────────────────────────────── */

/**
 * Process an array of 32-bit float samples.
 *
 * @param inputPtr   Pointer to input Float32 array (JS-side HEAPF32 view)
 * @param length     Number of samples
 * @returns          Pointer to interleaved [transient0, tonal0, transient1, tonal1, …]
 *                   float array. Length = length * 2. Caller must NOT free – managed here.
 */
EMSCRIPTEN_KEEPALIVE
float *sdt_process(float *inputPtr, int length) {
    if (!g_demix || !inputPtr || length <= 0) return NULL;

    /* Allocate / reallocate output buffer */
    if (g_bufLen < length * 2) {
        free(g_transientBuf);
        free(g_tonalBuf);
        g_transientBuf = (float *)malloc(length * 2 * sizeof(float));
        g_tonalBuf     = (float *)malloc(length * 2 * sizeof(float));
        g_bufLen       = length * 2;
    }

    float *out = (float *)malloc(length * 2 * sizeof(float));
    if (!out) return NULL;

    double sample;
    for (int i = 0; i < length; i++) {
        sample = (double)inputPtr[i];
        SDTDemix_dsp(g_demix, &sample);
        out[i * 2]     = (float)SDTDemix_getTransient(g_demix);
        out[i * 2 + 1] = (float)SDTDemix_getTonal(g_demix);
    }

    return out; /* caller must call sdt_free_result() */
}

/**
 * Free a buffer returned by sdt_process().
 */
EMSCRIPTEN_KEEPALIVE
void sdt_free_result(float *ptr) {
    if (ptr) free(ptr);
}

/* ─── Memory helpers for JS ──────────────────────────────────────────────── */

EMSCRIPTEN_KEEPALIVE
float *sdt_alloc_f32(int n) {
    return (float *)malloc(n * sizeof(float));
}

EMSCRIPTEN_KEEPALIVE
void sdt_free(void *ptr) {
    free(ptr);
}
