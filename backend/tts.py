# -*- coding: utf-8 -*-
"""Hugging Face SpeechT5 text-to-speech wrapper.

Models (all open-source, downloaded from Hugging Face on first use):
  - microsoft/speecht5_tts       (text -> speech)
  - microsoft/speecht5_hifigan   (vocoder)
  - Matthijs/cmu-arctic-xvectors (speaker embedding)

The heavy imports (torch / transformers) are done lazily so the rest of the
app can still run (with browser-TTS fallback on the client) if the ML stack is
not installed.
"""
import io
import os
import threading

SAMPLE_RATE = 16000

# All Hugging Face downloads (models + speaker-embedding dataset) go here:
#   <project root>/cache/model/
# You can also manually drop a model snapshot into one of the local folders
# listed in LOCAL_DIRS below to run fully offline.
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODEL_DIR = os.path.join(ROOT, "cache", "model")
os.makedirs(MODEL_DIR, exist_ok=True)

# Point the Hugging Face libraries at our cache folder (must be set before
# transformers / datasets are imported, which happens lazily below).
os.environ.setdefault("HF_HOME", MODEL_DIR)
os.environ.setdefault("HF_HUB_CACHE", os.path.join(MODEL_DIR, "hub"))
os.environ.setdefault("HF_DATASETS_CACHE", os.path.join(MODEL_DIR, "datasets"))

# Hub id -> local folder you may manually place under cache/model/.
# If the folder exists (and contains the model files), it is loaded from disk
# instead of downloading from the Hub.
LOCAL_DIRS = {
    "microsoft/speecht5_tts": os.path.join(MODEL_DIR, "speecht5_tts"),
    "microsoft/speecht5_hifigan": os.path.join(MODEL_DIR, "speecht5_hifigan"),
}


def _resolve(hub_id):
    """Return a local path if a manually placed model exists, else the hub id."""
    local = LOCAL_DIRS.get(hub_id)
    if local and os.path.isdir(local) and os.listdir(local):
        return local
    return hub_id

_lock = threading.Lock()
_state = {"loaded": False, "error": None}
_processor = None
_model = None
_vocoder = None
_speaker_embedding = None


def _load_models():
    """Load the SpeechT5 models once (thread-safe, lazy)."""
    global _processor, _model, _vocoder, _speaker_embedding
    if _state["loaded"] or _state["error"]:
        return
    with _lock:
        if _state["loaded"] or _state["error"]:
            return
        try:
            import torch
            from datasets import load_dataset
            from transformers import (
                SpeechT5ForTextToSpeech,
                SpeechT5HifiGan,
                SpeechT5Processor,
            )

            tts_id = _resolve("microsoft/speecht5_tts")
            voc_id = _resolve("microsoft/speecht5_hifigan")
            _processor = SpeechT5Processor.from_pretrained(tts_id, cache_dir=MODEL_DIR)
            _model = SpeechT5ForTextToSpeech.from_pretrained(tts_id, cache_dir=MODEL_DIR)
            _vocoder = SpeechT5HifiGan.from_pretrained(voc_id, cache_dir=MODEL_DIR)

            # A clear English speaker voice from the CMU Arctic xvectors set.
            embeddings = load_dataset(
                "Matthijs/cmu-arctic-xvectors",
                split="validation",
                cache_dir=os.path.join(MODEL_DIR, "datasets"),
            )
            _speaker_embedding = torch.tensor(
                embeddings[7306]["xvector"]
            ).unsqueeze(0)

            _model.eval()
            _state["loaded"] = True
        except Exception as exc:  # noqa: BLE001
            _state["error"] = str(exc)


def is_available():
    """Try to load models; return True if TTS can be used."""
    _load_models()
    return _state["loaded"]


def status():
    _load_models()
    return {
        "available": _state["loaded"],
        "error": _state["error"],
        "model": "microsoft/speecht5_tts",
        "model_dir": MODEL_DIR,
    }


def synthesize_wav(text):
    """Return WAV bytes for the given text, or raise RuntimeError."""
    _load_models()
    if not _state["loaded"]:
        raise RuntimeError(_state["error"] or "TTS models not available")

    import soundfile as sf
    import torch

    inputs = _processor(text=text, return_tensors="pt")
    with torch.no_grad():
        speech = _model.generate_speech(
            inputs["input_ids"], _speaker_embedding, vocoder=_vocoder
        )
    buf = io.BytesIO()
    sf.write(buf, speech.numpy(), samplerate=SAMPLE_RATE, format="WAV")
    buf.seek(0)
    return buf.read()
