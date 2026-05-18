"""
Offline OCR using PaddleOCR.

Extracts text from image bytes with no network call.
PaddleOCR downloads its models (~10-40 MB each) on first use per language
into ~/.paddleocr/ — subsequent calls are fully offline.

Usage:
    from app.services.ocr_client import extract_text
    text = extract_text(image_bytes, hint_lang="ar")
"""
from __future__ import annotations

import io
from loguru import logger

# PaddleOCR language codes for scripts used in refugee-classroom contexts.
# Latin-script languages (en, fr, sw, so, es, pt, de, …) all use "en".
_LANG_TO_PADDLE: dict[str, str] = {
    "ar": "arabic",
    "fa": "arabic",   # Persian — Arabic script
    "ur": "arabic",   # Urdu — Arabic script
    "he": "arabic",   # Hebrew — closest available
    "hi": "hi",
    "bn": "hi",       # Bengali — Devanagari fallback
    "mr": "hi",
    "ne": "hi",
    "ta": "ta",
    "te": "te",
    "kn": "ka",
    "ml": "ml",
    "th": "th",
    "ja": "japan",
    "ko": "korean",
    "zh": "ch",
    "ru": "cyrillic",
    "uk": "cyrillic",
    "be": "cyrillic",
    "bg": "cyrillic",
    "sr": "cyrillic",
}

# Cache initialised OCR instances (one per paddle-lang code)
_ocr_cache: dict[str, object] = {}


def _paddle_lang(hint_lang: str | None) -> str:
    if not hint_lang or hint_lang in ("unknown", "auto", "detect", ""):
        return "en"
    return _LANG_TO_PADDLE.get(hint_lang.lower().split("-")[0], "en")


def _get_ocr(lang: str):
    if lang not in _ocr_cache:
        from paddleocr import PaddleOCR  # lazy import — heavy
        logger.info("Initialising PaddleOCR (lang={})", lang)
        _ocr_cache[lang] = PaddleOCR(
            use_angle_cls=True,
            lang=lang,
            show_log=False,
        )
    return _ocr_cache[lang]


def warmup_models(langs: list[str] | None = None) -> None:
    """
    Pre-initialise PaddleOCR for the given paddle-lang codes so models are
    downloaded and cached before the first image upload arrives.

    Call this once at server startup in a background thread.
    Default langs cover the most common refugee-classroom scripts.
    """
    targets = langs or ["en", "arabic"]
    for lang in targets:
        try:
            _get_ocr(lang)
            logger.info("PaddleOCR warmup OK (lang={})", lang)
        except Exception as exc:
            logger.warning("PaddleOCR warmup failed for lang={}: {}", lang, exc)


def extract_text(image_bytes: bytes, hint_lang: str | None = None) -> str:
    """
    Run PaddleOCR on raw image bytes and return the concatenated text.

    Returns an empty string if PaddleOCR is not installed, the image has
    no readable text, or an error occurs — callers should fall back to
    the vision-model path in that case.
    """
    try:
        import numpy as np
        from PIL import Image

        lang = _paddle_lang(hint_lang)
        ocr = _get_ocr(lang)

        img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        img_arr = np.array(img)

        result = ocr.ocr(img_arr, cls=True)
        if not result or result[0] is None:
            logger.info("PaddleOCR returned no text (lang={})", lang)
            return ""

        lines: list[str] = []
        for detection in result[0]:
            if not detection or len(detection) < 2:
                continue
            text_conf = detection[1]
            if isinstance(text_conf, (list, tuple)) and len(text_conf) >= 1:
                text = str(text_conf[0]).strip()
                conf = float(text_conf[1]) if len(text_conf) > 1 else 1.0
                if text and conf > 0.4:
                    lines.append(text)

        extracted = "\n".join(lines)
        logger.info("PaddleOCR: {} chars extracted (lang={})", len(extracted), lang)
        return extracted

    except ImportError:
        logger.warning("PaddleOCR not installed — skipping OCR (pip install paddleocr paddlepaddle)")
        return ""
    except Exception as exc:
        logger.error("PaddleOCR failed: {}", exc)
        return ""
