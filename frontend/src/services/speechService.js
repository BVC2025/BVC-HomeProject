import API from "./api";

export const speechService = {
  // Returns a raw ArrayBuffer of WAV bytes. arraybuffer (not "blob") so an
  // error response's JSON body stays inspectable rather than being
  // silently wrapped as an opaque Blob.
  speak: (text, language, { signal } = {}) =>
    API.post(
      "/speech/speak",
      { text, language },
      { responseType: "arraybuffer", signal }
    ),
};
