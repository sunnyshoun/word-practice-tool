# -*- coding: utf-8 -*-
"""Kokoro text-to-speech wrapper.

Model (open-source, downloaded from Hugging Face on first use):
  - hexgrad/Kokoro-82M   (Kokoro TTS, 82M params, multi-voice)

Kokoro is a small, high-quality open-weight TTS model. We drive it through the
official ``kokoro`` Python package (``KPipeline``), which downloads the weights
from the Hugging Face Hub on first use and caches them under cache/model/.

The heavy imports (kokoro / torch) are done lazily so the rest of the app can
still run (with browser-TTS fallback on the client) if the ML stack is not
installed.

Kokoro can speak several languages; here we expose English by default (matching
the previous SpeechT5 behaviour). To add another language, register it in
``LANG_CONFIG`` below — each entry maps a language base (e.g. "en", "ja") to a
Kokoro ``lang_code`` and a default voice. Some languages need extra g2p deps
(e.g. ``misaki[ja]`` for Japanese); if those are missing the engine reports
"not available" for that language and the frontend falls back to browser speech.
"""
import io
import os
import threading

# Kokoro outputs 24 kHz audio.
SAMPLE_RATE = 24000

REPO_ID = "hexgrad/Kokoro-82M"

# All Hugging Face downloads (the Kokoro weights) go here:
#   <project root>/cache/model/
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, "cache", "model")
os.makedirs(MODEL_DIR, exist_ok=True)

# Point the Hugging Face libraries at our cache folder (must be set before
# kokoro / huggingface_hub are imported, which happens lazily below).
os.environ.setdefault("HF_HOME", MODEL_DIR)
os.environ.setdefault("HF_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))

# Language base -> (Kokoro lang_code, default voice).
#   lang_code: 'a' American English, 'b' British English, 'j' Japanese,
#              'z' Mandarin, 'e' Spanish, 'f' French, 'h' Hindi, 'i' Italian,
#              'p' Brazilian Portuguese
# See https://huggingface.co/hexgrad/Kokoro-82M for the full voice list.
LANG_CONFIG = {
    "en": ("a", "af_heart"),
    # "ja": ("j", "jf_alpha"),   # needs: uv add "misaki[ja]"
    # "zh": ("z", "zf_xiaoxiao"),  # needs: uv add "misaki[zh]"
}

_lock = threading.Lock()
# Per-language-base state, lazily populated. Each entry:
#   {"pipeline": KPipeline | None, "error": str | None}
_engines = {}


def _lang_base(lang):
    return (lang or "en").split("-")[0].lower()


def _get_engine(base):
    """Return a loaded engine dict for the language base (thread-safe, lazy)."""
    cached = _engines.get(base)
    if cached is not None:
        return cached

    with _lock:
        cached = _engines.get(base)
        if cached is not None:
            return cached

        engine = {"pipeline": None, "voice": None, "error": None}
        config = LANG_CONFIG.get(base)
        if config is None:
            engine["error"] = "no Kokoro engine configured for language '%s'" % base
        else:
            lang_code, voice = config
            try:
                from kokoro import KPipeline

                engine["pipeline"] = KPipeline(lang_code=lang_code, repo_id=REPO_ID)
                engine["voice"] = voice
                # Warm the voice so the first request isn't slow / failing late.
                engine["pipeline"].load_voice(voice)
            except Exception as exc:  # noqa: BLE001
                engine["error"] = str(exc)

        _engines[base] = engine
        return engine


def is_available(lang="en-US"):
    """Return True if backend TTS can synthesise the given language."""
    engine = _get_engine(_lang_base(lang))
    return engine["pipeline"] is not None


def status():
    engine = _get_engine("en")
    return {
        "available": engine["pipeline"] is not None,  # English engine ready?
        "error": engine["error"],
        "model": REPO_ID,
        "model_dir": MODEL_DIR,
        "supported_langs": sorted(LANG_CONFIG),
    }


def synthesize_wav(text, lang="en-US"):
    """Return WAV bytes for the given text in the given language.

    Raises RuntimeError if no backend engine is configured / loadable for the
    language (the caller should then let the client fall back to browser speech).
    """
    base = _lang_base(lang)
    engine = _get_engine(base)
    pipeline = engine["pipeline"]
    if pipeline is None:
        raise RuntimeError(
            engine["error"] or ("No backend TTS engine for language '%s'." % lang)
        )

    import numpy as np
    import soundfile as sf

    chunks = []
    for result in pipeline(text, voice=engine["voice"]):
        # kokoro >=0.8 yields Result objects with .audio; older yields tuples.
        audio = getattr(result, "audio", None)
        if audio is None:
            audio = result[2]
        if audio is None:
            continue
        if hasattr(audio, "detach"):  # torch tensor
            audio = audio.detach().cpu().numpy()
        chunks.append(np.asarray(audio, dtype=np.float32))

    if not chunks:
        raise RuntimeError("Kokoro produced no audio for: %r" % text)

    speech = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    buf = io.BytesIO()
    sf.write(buf, speech, samplerate=SAMPLE_RATE, format="WAV")
    buf.seek(0)
    return buf.read()
