"""
Shared language metadata for prompts and student-facing language controls.

The model should never have to infer a language from a short code such as
"ps" or "si". Prompt builders use these helpers to spell out the language,
native name, and expected script in a form that survives future model swaps.
"""
from __future__ import annotations

import re

LANGUAGE_NAMES: dict[str, str] = {
    "en": "English",
    "si": "Sinhala",
    "ta": "Tamil",
    "ar": "Arabic",
    "fa": "Dari / Farsi",
    "ps": "Pashto",
    "sw": "Swahili",
    "so": "Somali",
    "rh": "Rohingya",
    "fr": "French",
    "tr": "Turkish",
    "am": "Amharic",
    "ti": "Tigrinya",
    "ha": "Hausa",
    "yo": "Yoruba",
    "ig": "Igbo",
    "ln": "Lingala",
    "rn": "Kirundi",
    "rw": "Kinyarwanda",
    "ny": "Chichewa",
    "zu": "Zulu",
    "sn": "Shona",
    "el": "Greek",
    "ur": "Urdu",
    "bn": "Bengali",
    "hi": "Hindi",
    "ku": "Kurdish (Kurmanji)",
    "sd": "Sindhi",
    "ne": "Nepali",
    "my": "Burmese",
    "af": "Afrikaans",
    "sq": "Albanian",
    "hy": "Armenian",
    "az": "Azerbaijani",
    "eu": "Basque",
    "be": "Belarusian",
    "bs": "Bosnian",
    "bg": "Bulgarian",
    "ca": "Catalan",
    "ceb": "Cebuano",
    "zh": "Chinese (Simplified)",
    "zh-tw": "Chinese (Traditional)",
    "co": "Corsican",
    "hr": "Croatian",
    "cs": "Czech",
    "da": "Danish",
    "nl": "Dutch",
    "eo": "Esperanto",
    "et": "Estonian",
    "fi": "Finnish",
    "fy": "Frisian",
    "gl": "Galician",
    "ka": "Georgian",
    "de": "German",
    "gu": "Gujarati",
    "ht": "Haitian Creole",
    "haw": "Hawaiian",
    "he": "Hebrew",
    "hmn": "Hmong",
    "hu": "Hungarian",
    "is": "Icelandic",
    "id": "Indonesian",
    "ga": "Irish",
    "it": "Italian",
    "ja": "Japanese",
    "jv": "Javanese",
    "kn": "Kannada",
    "kk": "Kazakh",
    "km": "Khmer",
    "ko": "Korean",
    "ky": "Kyrgyz",
    "lo": "Lao",
    "la": "Latin",
    "lv": "Latvian",
    "lt": "Lithuanian",
    "lb": "Luxembourgish",
    "mk": "Macedonian",
    "mg": "Malagasy",
    "ms": "Malay",
    "ml": "Malayalam",
    "mt": "Maltese",
    "mi": "Maori",
    "mr": "Marathi",
    "mn": "Mongolian",
    "no": "Norwegian",
    "or": "Odia (Oriya)",
    "pl": "Polish",
    "pt": "Portuguese",
    "pa": "Punjabi",
    "ro": "Romanian",
    "ru": "Russian",
    "sm": "Samoan",
    "gd": "Scots Gaelic",
    "sr": "Serbian",
    "st": "Sesotho",
    "xh": "Xhosa",
    "sk": "Slovak",
    "sl": "Slovenian",
    "es": "Spanish",
    "su": "Sundanese",
    "tl": "Tagalog (Filipino)",
    "tg": "Tajik",
    "te": "Telugu",
    "th": "Thai",
    "tk": "Turkmen",
    "uk": "Ukrainian",
    "uz": "Uzbek",
    "vi": "Vietnamese",
    "cy": "Welsh",
    "yi": "Yiddish",
}

_NATIVE_NAMES: dict[str, str] = {
    "si": "\u0dc3\u0dd2\u0d82\u0dc4\u0dbd",
    "ta": "\u0ba4\u0bae\u0bbf\u0bb4\u0bcd",
    "ar": "\u0627\u0644\u0639\u0631\u0628\u064a\u0629",
    "fa": "\u062f\u0631\u06cc / \u0641\u0627\u0631\u0633\u06cc",
    "ps": "\u067e\u069a\u062a\u0648",
    "sw": "Kiswahili",
    "so": "Soomaali",
    "fr": "francais",
    "tr": "Turkce",
    "am": "\u12a0\u121b\u122d\u129b",
    "ti": "\u1275\u130d\u122d\u129b",
    "el": "\u0395\u03bb\u03bb\u03b7\u03bd\u03b9\u03ba\u03ac",
    "ur": "\u0627\u0631\u062f\u0648",
    "bn": "\u09ac\u09be\u0982\u09b2\u09be",
    "hi": "\u0939\u093f\u0928\u094d\u0926\u0940",
    "sd": "\u0633\u0646\u068c\u064a",
    "ne": "\u0928\u0947\u092a\u093e\u0932\u0940",
    "my": "\u1019\u103c\u1014\u103a\u1019\u102c",
    "uk": "\u0443\u043a\u0440\u0430\u0457\u043d\u0441\u044c\u043a\u0430",
    "ru": "\u0440\u0443\u0441\u0441\u043a\u0438\u0439",
    "he": "\u05e2\u05d1\u05e8\u05d9\u05ea",
    "zh": "\u7b80\u4f53\u4e2d\u6587",
    "zh-tw": "\u7e41\u9ad4\u4e2d\u6587",
    "ja": "\u65e5\u672c\u8a9e",
    "ko": "\ud55c\uad6d\uc5b4",
}

_SCRIPT_RULES: dict[str, str] = {
    "si": "Use Sinhala script.",
    "ta": "Use Tamil script.",
    "ar": "Use Arabic script.",
    "fa": "Use Persian/Arabic script suitable for Dari or Farsi.",
    "ps": "Use Pashto in Arabic script; do not use Persian/Dari, Urdu, Arabic, Norwegian, or English.",
    "rh": "Use the clearest Rohingya form the model supports; if a word has no reliable Rohingya equivalent, keep it short and understandable.",
    "am": "Use Ethiopic script.",
    "ti": "Use Ethiopic script.",
    "el": "Use Greek script.",
    "ur": "Use Urdu in Nastaliq-style Arabic script.",
    "bn": "Use Bengali script.",
    "hi": "Use Devanagari script.",
    "sd": "Use Sindhi in Arabic script.",
    "ne": "Use Devanagari script.",
    "my": "Use Myanmar script.",
    "hy": "Use Armenian script.",
    "be": "Use Cyrillic script.",
    "bg": "Use Cyrillic script.",
    "zh": "Use Simplified Chinese characters.",
    "zh-tw": "Use Traditional Chinese characters.",
    "ka": "Use Georgian script.",
    "gu": "Use Gujarati script.",
    "he": "Use Hebrew script.",
    "ja": "Use Japanese writing.",
    "kn": "Use Kannada script.",
    "kk": "Use Cyrillic Kazakh unless the student uses another Kazakh script.",
    "km": "Use Khmer script.",
    "ko": "Use Hangul.",
    "ky": "Use Cyrillic Kyrgyz unless the student uses another Kyrgyz script.",
    "lo": "Use Lao script.",
    "mk": "Use Cyrillic script.",
    "ml": "Use Malayalam script.",
    "mr": "Use Devanagari script.",
    "mn": "Use Cyrillic Mongolian unless the student uses another Mongolian script.",
    "or": "Use Odia script.",
    "pa": "Use Gurmukhi script.",
    "ru": "Use Cyrillic script.",
    "sr": "Use Serbian Cyrillic unless the student uses Latin script.",
    "tg": "Use Cyrillic Tajik unless the student uses another Tajik script.",
    "te": "Use Telugu script.",
    "th": "Use Thai script.",
    "uk": "Use Ukrainian Cyrillic script; do not use Russian, English, or any unrelated language.",
    "yi": "Use Hebrew script.",
}

_LANGUAGE_ALIASES: dict[str, str] = {
    "sinhala": "si",
    "sinhalese": "si",
    "tamil": "ta",
    "ukrainian": "uk",
    "ukranian": "uk",
    "pashto": "ps",
    "pushto": "ps",
    "swahili": "sw",
    "kiswahili": "sw",
    "russian": "ru",
}

_SCRIPT_CHECKS: dict[str, tuple[str, list[str]]] = {
    "si": (r"[\u0D80-\u0DFF]", [r"[\u0B80-\u0BFF]", r"[\u0600-\u06FF]", r"[\u0400-\u04FF]"]),
    "ta": (r"[\u0B80-\u0BFF]", [r"[\u0D80-\u0DFF]", r"[\u0600-\u06FF]", r"[\u0400-\u04FF]"]),
    "uk": (r"[\u0400-\u04FF]", [r"[\u0600-\u06FF]", r"[\u0D80-\u0DFF]", r"[\u0B80-\u0BFF]", r"[\u4E00-\u9FFF]"]),
    "ps": (r"[\u0600-\u06FF]", [r"[\u0400-\u04FF]", r"[\u0D80-\u0DFF]", r"[\u0B80-\u0BFF]", r"[\u0900-\u097F]", r"[\u4E00-\u9FFF]"]),
    "ru": (r"[\u0400-\u04FF]", [r"[\u0600-\u06FF]", r"[\u0D80-\u0DFF]", r"[\u0B80-\u0BFF]", r"[\u4E00-\u9FFF]"]),
}


def normalize_language_code(language: str | None) -> str:
    """Return the normalized code used by OptiLearn language dropdowns."""
    if not language:
        return "en"
    value = language.strip()
    lowered = value.lower()
    if lowered in _LANGUAGE_ALIASES:
        return _LANGUAGE_ALIASES[lowered]
    if lowered == "zh-tw":
        return "zh-tw"
    return lowered


def language_display_name(language: str | None) -> str:
    """Return a plain English display name for a language code."""
    code = normalize_language_code(language)
    return LANGUAGE_NAMES.get(code, language or "English")


def language_prompt_label(language: str | None) -> str:
    """
    Return an explicit model-facing language label.

    Example: "Pashto (...), language code ps. Use Pashto in Arabic script..."
    """
    code = normalize_language_code(language)
    name = LANGUAGE_NAMES.get(code, language or "English")
    native = _NATIVE_NAMES.get(code)
    label = f"{name} ({native})" if native else name
    script_rule = _SCRIPT_RULES.get(code)
    suffix = f" {script_rule}" if script_rule else ""
    return f"{label}, language code {code}.{suffix}"


def language_output_issue(text: str | None, language: str | None) -> str:
    """Return a short issue label when model output clearly drifted languages/scripts."""
    value = text or ""
    if not value.strip():
        return "the output was empty"
    if re.search(r"```|\\text\{|\\\(|\\\[|\$[^$\n]+\$", value):
        return "the output contains raw markdown or LaTeX"

    code = normalize_language_code(language)
    check = _SCRIPT_CHECKS.get(code)
    if not check:
        return ""

    required_pattern, disallowed_patterns = check
    formula_light = re.sub(r"\b[A-Z][A-Za-z]?\d*(?:[A-Z][A-Za-z]?\d*)*\b", " ", value)
    formula_light = re.sub(r"\b\d+(?:\.\d+)?\b", " ", formula_light)
    if not re.search(required_pattern, formula_light):
        return f"the output does not contain the expected script for {language_display_name(code)}"
    if code in {"si", "ta", "uk", "ps", "ru"} and re.search(r"\b[a-z]{3,}\b", formula_light):
        return f"the output contains English or Latin-script words for {language_display_name(code)}"
    for pattern in disallowed_patterns:
        if re.search(pattern, formula_light):
            return f"the output mixes in an unrelated script for {language_display_name(code)}"
    return ""
