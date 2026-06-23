# -*- coding: utf-8 -*-
"""AWL practice tool backend.

Serves:
  GET /                      -> frontend index.html
  GET /api/words            -> all 570 AWL words (word, sublist, pos, en, zh)
  GET /api/tts/status       -> whether HF TTS is available
  GET /api/tts/{word}       -> WAV audio of the word (synthesised + cached)

The frontend automatically falls back to the browser's built-in speech
synthesis when /api/tts is unavailable, so the app works even before the
ML models finish downloading.
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
DATA_FILE = os.path.join(ROOT, "data", "awl_words.json")
FRONTEND_DIR = os.path.join(ROOT, "frontend")
CACHE_DIR = os.path.join(ROOT, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

with open(DATA_FILE, encoding="utf-8") as fh:
    WORDS = json.load(fh)
WORD_SET = {w["word"] for w in WORDS}

app = FastAPI(title="AWL Practice Tool")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/words")
def get_words():
    return WORDS


@app.get("/api/tts/status")
def tts_status():
    return tts.status()


def _cache_path(word):
    safe = re.sub(r"[^a-z0-9_-]", "_", word.lower())
    digest = hashlib.md5(word.encode("utf-8")).hexdigest()[:8]
    return os.path.join(CACHE_DIR, "%s_%s.wav" % (safe, digest))


@app.get("/api/tts/{word}")
def get_tts(word: str):
    if word not in WORD_SET:
        raise HTTPException(status_code=404, detail="unknown word")

    path = _cache_path(word)
    if os.path.exists(path):
        return FileResponse(path, media_type="audio/wav")

    if not tts.is_available():
        # Signal the client to use its built-in speech synthesis instead.
        return JSONResponse(
            status_code=503,
            content={"detail": "tts_unavailable", "fallback": "browser"},
        )

    try:
        wav = tts.synthesize_wav(word)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=str(exc))

    with open(path, "wb") as fh:
        fh.write(wav)
    return Response(content=wav, media_type="audio/wav")


# Serve the frontend (mounted last so /api/* takes priority).
app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn

    print("AWL Practice Tool -> http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
