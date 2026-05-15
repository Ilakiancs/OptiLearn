"""Hybrid TTS client: piper for local voices, MMS-TTS for selected languages.

Uses ThreadPoolExecutor for all synthesis so it works on both
asyncio.ProactorEventLoop and asyncio.SelectorEventLoop. This matters on
Windows, where uvicorn --reload can use an event loop that cannot run asyncio
subprocesses.
"""
import asyncio
import concurrent.futures
import io
import re
import subprocess
import wave
from pathlib import Path
from typing import AsyncGenerator

from loguru import logger

from app.core.config import settings

logger.info("TTS client initialised")
logger.info("Piper binary: {}", settings.PIPER_BINARY)
logger.info("Voices dir: {}", settings.VOICES_DIR)
logger.info("MMS languages with native voice: ta, so, bn (am/ur need uroman)")
logger.info("Languages using English piper fallback: si, ti, am, ur (unless uroman installed)")

# (engine, voice_name_or_model_id)
VOICE_MAP: dict[str, tuple[str, str]] = {
    # Piper - voice files downloaded locally.
    "en":    ("piper", "en_US-lessac-medium"),
    "ar":    ("piper", "ar_JO-kareem-medium"),
    "de":    ("piper", "de_DE-thorsten-medium"),
    "es":    ("piper", "es_ES-davefx-medium"),
    "fr":    ("piper", "fr_FR-siwis-medium"),
    "hi":    ("piper", "hi_IN-pratham-medium"),
    "pt":    ("piper", "pt_BR-faber-medium"),
    "ru":    ("piper", "ru_RU-dmitri-medium"),
    "sw":    ("piper", "sw_CD-lanfrica-medium"),
    "tr":    ("piper", "tr_TR-dfki-medium"),
    "zh":    ("piper", "zh_CN-huayan-medium"),
    "zh-TW": ("piper", "zh_CN-huayan-medium"),  # Traditional - closest available

    # MMS-TTS uses ISO 639-3 model suffixes.
    "ta": ("mms", "facebook/mms-tts-tam"),  # Tamil - works, no uroman
    "so": ("mms", "facebook/mms-tts-som"),  # Somali - works, Latin script
    "bn": ("mms", "facebook/mms-tts-ben"),  # Bengali - works
    "am": ("mms", "facebook/mms-tts-amh"),  # Amharic - needs uroman check
    "si": ("piper", "en_US-lessac-medium"),  # Sinhala - no MMS model exists
    "ti": ("piper", "en_US-lessac-medium"),  # Tigrinya - no MMS model exists
    "ur": ("mms", "facebook/mms-tts-urd-script_arabic"),  # Urdu - needs uroman check
}

_executor = concurrent.futures.ThreadPoolExecutor(max_workers=4, thread_name_prefix="tts")

# Lazy MMS-TTS model cache: loaded once per language, reused across requests.
_mms_cache: dict[str, tuple] = {}
# Models confirmed unavailable or unusable: skip retrying, use piper English.
_mms_unavailable: set[str] = set()


def get_tts_status() -> dict:
    """Return offline TTS asset readiness without loading synthesis models."""
    voices_dir = Path(settings.VOICES_DIR)
    piper_binary = Path(settings.PIPER_BINARY)
    voice_files = list(voices_dir.glob("*.onnx")) if voices_dir.exists() else []
    piper_voices = sorted({
        voice
        for engine, voice in VOICE_MAP.values()
        if engine == "piper"
    })
    missing_piper_voices = [
        voice for voice in piper_voices
        if not (voices_dir / f"{voice}.onnx").exists()
    ]
    mms_models = sorted({
        model_id
        for engine, model_id in VOICE_MAP.values()
        if engine == "mms"
    })
    ready = piper_binary.exists() and voices_dir.exists() and bool(voice_files)
    return {
        "ready": ready,
        "piper_binary": str(piper_binary),
        "piper_binary_exists": piper_binary.exists(),
        "voices_dir": str(voices_dir),
        "voices_dir_exists": voices_dir.exists(),
        "installed_voice_count": len(voice_files),
        "missing_piper_voices": missing_piper_voices,
        "mms_models": mms_models,
        "mms_loaded": sorted(_mms_cache.keys()),
        "mms_unavailable": sorted(_mms_unavailable),
    }


# Helpers
def raw_pcm_to_wav(raw_bytes: bytes, sample_rate: int = 22050) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(raw_bytes)
    return buf.getvalue()


def split_sentences(text: str) -> list[str]:
    """Split text into sentences across Latin, Devanagari, Ethiopic, Arabic scripts."""
    sentences = re.split(r"(?<=[.!?\u0964\u1362\u061f\u06d4])\s+", text.strip())
    result = []
    for s in sentences:
        s = s.strip()
        if not s:
            continue
        if len(s) > 200:
            parts = re.split(r"(?<=[,\u060c])\s+", s)
            result.extend(p.strip() for p in parts if p.strip())
        else:
            result.append(s)
    return result or [text.strip()]


# MMS-TTS
def _get_mms_model(model_id: str) -> tuple | None:
    if model_id in _mms_cache:
        return _mms_cache[model_id]
    if model_id in _mms_unavailable:
        return None
    try:
        logger.info("Loading MMS-TTS model {} (first use - may download ~80MB)", model_id)
        from transformers import VitsModel, VitsTokenizer
        tokenizer = VitsTokenizer.from_pretrained(model_id)
        model = VitsModel.from_pretrained(model_id)
        model.eval()
        # Check if uroman romanisation is required
        if getattr(tokenizer, "is_uroman", False):
            logger.warning(
                "MMS model {} requires uroman (Perl tool) for text romanisation. "
                "uroman is not installed. Will fall back to English piper for this language. "
                "To enable native voice: install Perl from perl.org then run: "
                "pip install uroman", model_id)
            _mms_unavailable.add(model_id)
            return None
        _mms_cache[model_id] = (tokenizer, model)
        return _mms_cache[model_id]
    except Exception as e:
        err = str(e)
        if any(x in err for x in ["not a valid model", "not a local folder", "401", "404"]):
            logger.warning("MMS model {} not available on HuggingFace: {}", model_id, err)
        else:
            logger.error("MMS model {} failed to load: {}", model_id, err)
        _mms_unavailable.add(model_id)
        return None


def _mms_synthesise(text: str, model_id: str) -> bytes:
    import io
    import wave

    import numpy as np
    import torch

    if model_id in _mms_unavailable:
        return b""

    result = _get_mms_model(model_id)
    if result is None:
        return b""

    tokenizer, model = result
    try:
        inputs = tokenizer(text, return_tensors="pt")
        with torch.no_grad():
            output = model(**inputs).waveform
        audio_np = output.squeeze().numpy()
        audio_int16 = (audio_np / max(abs(audio_np.max()), 1e-6) * 32767).astype(np.int16)
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wf:
            wf.setnchannels(1)
            wf.setsampwidth(2)
            wf.setframerate(model.config.sampling_rate)
            wf.writeframes(audio_int16.tobytes())
        return buf.getvalue()
    except Exception as e:
        logger.error("MMS synthesis error for {}: {}", model_id, e)
        return b""


async def _mms_speak(text: str, model_id: str) -> bytes:
    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(_executor, _mms_synthesise, text, model_id)
    if not result:
        # Model unavailable or synthesis failed - use English piper as fallback.
        logger.info("MMS unavailable for {} - using English piper fallback", model_id)
        return await _piper_speak(text, "en_US-lessac-medium")
    return result


# Piper
def _piper_speak_sync(voice_path: str, text: str) -> bytes:
    result = subprocess.run(
        [settings.PIPER_BINARY, "--model", voice_path, "--output-raw", "--length-scale", "0.9"],
        input=text.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.DEVNULL,
        timeout=30,
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )
    return raw_pcm_to_wav(result.stdout)


async def _piper_speak(text: str, voice_name: str) -> bytes:
    voice_path = Path(settings.VOICES_DIR) / f"{voice_name}.onnx"
    if not voice_path.exists():
        logger.warning("Voice not found: {} - falling back to en_US-lessac-medium", voice_path)
        voice_path = Path(settings.VOICES_DIR) / "en_US-lessac-medium.onnx"
    if not voice_path.exists():
        logger.error("No voice models found in {}", settings.VOICES_DIR)
        return b""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_executor, _piper_speak_sync, str(voice_path), text)


# Public API
async def speak(text: str, language: str) -> bytes:
    """Single-shot synthesis: returns full WAV bytes."""
    engine, voice_or_model = VOICE_MAP.get(language, ("piper", "en_US-lessac-medium"))
    try:
        if engine == "piper":
            return await _piper_speak(text, voice_or_model)
        return await _mms_speak(text, voice_or_model)
    except Exception as e:
        logger.error("TTS speak() error: {}", e)
        return b""


async def speak_sentences(text: str, language: str) -> AsyncGenerator[bytes, None]:
    """Async generator: yields one WAV per sentence for streaming playback.

    For piper voices, all sentences are submitted to the thread pool upfront so
    subsequent sentences synthesise in parallel while the first is being streamed.
    """
    engine, voice_or_model = VOICE_MAP.get(language, ("piper", "en_US-lessac-medium"))
    sentences = [s for s in split_sentences(text) if s.strip()]
    if not sentences:
        return

    loop = asyncio.get_event_loop()

    if engine == "piper":
        voice_path = Path(settings.VOICES_DIR) / f"{voice_or_model}.onnx"
        if not voice_path.exists():
            voice_path = Path(settings.VOICES_DIR) / "en_US-lessac-medium.onnx"
        if not voice_path.exists():
            logger.error("No voice models found in {}", settings.VOICES_DIR)
            return
        voice_path_str = str(voice_path)
        # Submit all sentences to the executor immediately so they synthesise in parallel.
        futures = [
            loop.run_in_executor(_executor, _piper_speak_sync, voice_path_str, s)
            for s in sentences
        ]
        for fut in futures:
            try:
                wav = await fut
                if wav:
                    yield wav
            except Exception as e:
                logger.error("TTS piper error: {}", e)
    else:
        for sentence in sentences:
            try:
                wav = await _mms_speak(sentence, voice_or_model)
                if wav:
                    yield wav
            except Exception as e:
                logger.error("TTS error on sentence '{}': {}", sentence[:40], e)
