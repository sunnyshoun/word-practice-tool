# -*- coding: utf-8 -*-
"""Word Practice Tool backend.

Supports multiple word sets ("datasets"), each living in its own folder under
data/datasets/<id>/ with a manifest.json + words.json. Drop in a new folder
(English, Japanese, ...) and it shows up automatically — no code changes.

Serves:
  GET /                              -> frontend index.html
  GET /api/datasets                 -> list of available datasets (+ word count)
  GET /api/datasets/{id}/words      -> the dataset's words
  GET /api/tts/status               -> backend TTS availability
  GET /api/tts/{dataset_id}/{word}  -> WAV audio of the word (synth + cached)

Word schema (generic):
  {"word", "group", "primary", "secondary"}

The frontend automatically falls back to the browser's built-in speech
synthesis when /api/tts is unavailable for a word's language.
"""
import hashlib
import json
import os
import re

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import tts

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATASETS_DIR = os.path.join(ROOT, "data", "datasets")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
CACHE_DIR = os.path.join(ROOT, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)


def load_datasets():
    """Scan data/datasets/*/ for manifest.json + words.json."""
    found = {}
    if not os.path.isdir(DATASETS_DIR):
        return found
    for name in sorted(os.listdir(DATASETS_DIR)):
        folder = os.path.join(DATASETS_DIR, name)
        man_path = os.path.join(folder, "manifest.json")
        words_path = os.path.join(folder, "words.json")
        if not (os.path.isfile(man_path) and os.path.isfile(words_path)):
            continue
        with open(man_path, encoding="utf-8") as fh:
            manifest = json.load(fh)
        with open(words_path, encoding="utf-8") as fh:
            words = json.load(fh)
        ds_id = manifest.get("id", name)
        manifest["id"] = ds_id
        found[ds_id] = {
            "manifest": manifest,
            "words": words,
            "word_set": {w["word"] for w in words},
        }
    return found


DATASETS = load_datasets()

app = FastAPI(title="Word Practice Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/datasets")
def get_datasets():
    out = []
    for ds in DATASETS.values():
        m = dict(ds["manifest"])
        m["count"] = len(ds["words"])
        out.append(m)
    return out


@app.get("/api/datasets/{dataset_id}/words")
def get_words(dataset_id: str):
    ds = DATASETS.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="unknown dataset")
    return ds["words"]


@app.get("/api/tts/status")
def tts_status():
    return tts.status()


def _cache_path(dataset_id, word):
    safe = re.sub(r"[^a-z0-9_-]", "_", word.lower())[:32]
    digest = hashlib.md5(("%s::%s" % (dataset_id, word)).encode("utf-8")).hexdigest()[:8]
    return os.path.join(CACHE_DIR, "%s_%s_%s.wav" % (dataset_id, safe, digest))


@app.get("/api/tts/{dataset_id}/{word}")
def get_tts(dataset_id: str, word: str):
    ds = DATASETS.get(dataset_id)
    if not ds:
        raise HTTPException(status_code=404, detail="unknown dataset")
    if word not in ds["word_set"]:
        raise HTTPException(status_code=404, detail="unknown word")

    lang = ds["manifest"].get("lang", "en-US")

    path = _cache_path(dataset_id, word)
    if os.path.exists(path):
        return FileResponse(path, media_type="audio/wav")

    if not tts.is_available(lang):
        # Tell the client to use its built-in speech synthesis for this lang.
        return JSONResponse(
            status_code=503,
            content={"detail": "tts_unavailable", "fallback": "browser", "lang": lang},
        )

    try:
        wav = tts.synthesize_wav(word, lang=lang)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))

    with open(path, "wb") as fh:
        fh.write(wav)
    return Response(content=wav, media_type="audio/wav")


# Serve the frontend (mounted last so /api/* takes priority).
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


def run():
    import uvicorn

    print("Word Practice Tool -> http://localhost:8000")
    print("Loaded datasets: %s" % ", ".join(DATASETS) if DATASETS else "(none found)")
    uvicorn.run(app, host="0.0.0.0", port=8000)


if __name__ == "__main__":
    run()
