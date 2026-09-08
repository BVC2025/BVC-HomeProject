import API from "./api";

export const speechService = {
  // Returns a raw ArrayBuffer of WAV bytes. arraybuffer (not "blob") so an
  // error response's JSON body stays inspectable rather than being
  // silently wrapped as an opaque Blob.
  //
  // `engine`: "piper" (default, all 4 languages) or "kokoro" (better
  // quality, en/hi only — the backend falls back to Piper on its own for
  // any other language, so it's always safe to pass "kokoro" and just
  // get *a* voice back).
  speak: (text, language, { signal, engine = "piper" } = {}) =>
    API.post(
      "/speech/speak",
      { text, language, engine },
      { responseType: "arraybuffer", signal }
    ),
};
