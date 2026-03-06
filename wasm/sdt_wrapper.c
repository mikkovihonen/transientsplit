// sdt_wrapper.c
#include <stdlib.h>
#include <string.h>

#include "SDT/src/SDT/SDTDemix.h"

#ifdef __EMSCRIPTEN__
  #include <emscripten/emscripten.h>
  #define EXPORT EMSCRIPTEN_KEEPALIVE
#else
  #define EXPORT
#endif

// --------- State ---------
static SDTDemix *g_demix = NULL;
static float    *g_outInterleaved = NULL; // [frames * 3] interleaved (P,H,R)
static int       g_frames = 0;

// --------- Cleanup ---------
EXPORT
void sdt_cleanup(void) {
  if (g_demix) {
    SDTDemix_free(g_demix);
    g_demix = NULL;
  }
  free(g_outInterleaved);
  g_outInterleaved = NULL;
  g_frames = 0;
}

// --------- Init ---------
// Suggested params:
// winSize : e.g. 1024
// radius  : e.g. 4
// overlap : 0.0 .. <1.0 (e.g. 0.5). This is the analysis window overlap factor.
// tonalThreshold, noiseThreshold : linear [0..1] threshold values (0=none, 1=maximum)
EXPORT
void sdt_init(int winSize, int radius, double overlap,
              double tonalThreshold, double noiseThreshold) {
  // free previous state
  sdt_cleanup();

  if (winSize <= 0) winSize = 1024;
  if (radius  <= 0) radius  = 4;

  g_demix = SDTDemix_new(winSize, radius);

  if (overlap > 0.0) {
    SDTDemix_setOverlap(g_demix, overlap);
  }
  SDTDemix_setTonalThreshold(g_demix, tonalThreshold);
  SDTDemix_setNoiseThreshold(g_demix, noiseThreshold);
}

// --------- Process ---------
// in: pointer to mono float32 input (length = frames)
// frames: number of samples
// returns pointer to interleaved float32 output with 3 channels (P,H,R)
EXPORT
float *sdt_process(const float *in, int frames) {
  if (!g_demix || !in || frames <= 0) return NULL;

  if (frames != g_frames) {
    free(g_outInterleaved);
    // check for multiplication overflow
    size_t outCount;
    if ((size_t)frames > SIZE_MAX / 3) {
      // too large to allocate
      return NULL;
    }
    outCount = (size_t)frames * 3;
    // allocate a few extra floats as sentinel to detect overruns
    g_outInterleaved = (float *)malloc(sizeof(float) * (outCount + 4));
    if (!g_outInterleaved) {
      return NULL;
    }
    // clear sentinel
    g_outInterleaved[outCount + 0] = 0;
    g_outInterleaved[outCount + 1] = 0;
    g_outInterleaved[outCount + 2] = 0;
    g_outInterleaved[outCount + 3] = 0;
    g_frames = frames;
  }

  for (int i = 0; i < frames; ++i) {
    double outs[3];
    SDTDemix_dsp(g_demix, outs, (double)in[i]);
    g_outInterleaved[i * 3 + 0] = (float)outs[0]; // percussive
    g_outInterleaved[i * 3 + 1] = (float)outs[1]; // harmonic
    g_outInterleaved[i * 3 + 2] = (float)outs[2]; // residual
  }
  // check sentinel values
  size_t outCount = (size_t)frames * 3;
  if (g_outInterleaved[outCount] != 0 || g_outInterleaved[outCount+1] != 0 ||
      g_outInterleaved[outCount+2] != 0 || g_outInterleaved[outCount+3] != 0) {
    // overwrite sentinel indicates a write past end
    // this is primarily for debugging; return NULL to signal error
    return NULL;
  }
  return g_outInterleaved;
}

// --------- Utility alloc/free (optional) ---------
EXPORT
float *sdt_alloc_f32(int count) {
  if (count <= 0) return NULL;
  return (float *)malloc(sizeof(float) * count);
}

EXPORT
void sdt_free(void *p) {
  free(p);
}

EXPORT
void sdt_free_result(float *p) {
  // We return an internal pointer from sdt_process; do nothing on purpose.
  // If you change sdt_process to allocate a fresh buffer each call,
  // you can free(p) here instead.
  (void)p;
}