# Piper voice models

This folder is read by `backend/app/services/speech_service.py` at startup.
It is git-ignored (`backend/tts/models/` in the repo root `.gitignore`) —
the `.onnx`/`.onnx.json` pairs are ~60MB binary assets each and must never
be committed to git.

```
tts/
  models/
    en/   <- one English voice pair (e.g. en_US-lessac-medium.onnx + .onnx.json)
    ta/   <- one Tamil voice pair (e.g. ta_IN-rasa_female-medium.onnx + .onnx.json)
```

`speech_service.py` picks the first `*.onnx` file found in each language
folder — only one voice per language is used, so don't leave multiple
`.onnx` files in the same folder unless you mean for the choice to be
arbitrary.

## Getting the models on a machine that doesn't have them

1. `pip install -r backend/requirements-tts.txt` (installs the `piper-tts`
   package itself).
2. **English** — copy a verified working pair from another machine that has
   this project set up, or download a `.onnx` + matching `.onnx.json` pair
   from Piper's official voice catalog (Hugging Face, `rhasspy/piper-voices`),
   e.g. `en/en_US/lessac/medium/`, into `models/en/`.
3. **Tamil** — Tamil is **not** in Piper's official catalog. The pair
   currently in use here (`ta_IN-rasa_female-medium`) came from a community
   source; its exact upstream repo is undocumented. If you need to source
   it fresh, community Tamil Piper voices exist on Hugging Face (search for
   Tamil Piper voice repos) — listen to the output before relying on it in
   production, since these are individually-published community models,
   not officially vetted by Piper's maintainers.

If a language's model is missing, `speech_service.py` logs a clear error at
startup and `POST /speech/speak` for that language returns HTTP 503 — the
rest of the app keeps running normally otherwise.
