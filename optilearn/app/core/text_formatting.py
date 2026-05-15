"""
Output cleanup helpers for AI-generated educational text.

These helpers are deliberately model-agnostic. They clean presentation syntax
that small and large models may emit, without changing routing or model APIs.
"""
from __future__ import annotations

import re

_SUBSCRIPT = str.maketrans("0123456789+-=()", "\u2080\u2081\u2082\u2083\u2084\u2085\u2086\u2087\u2088\u2089\u208a\u208b\u208c\u208d\u208e")
_SUPERSCRIPT = str.maketrans("0123456789+-=()", "\u2070\u00b9\u00b2\u00b3\u2074\u2075\u2076\u2077\u2078\u2079\u207a\u207b\u207c\u207d\u207e")


def _sub_digits(value: str) -> str:
    return value.translate(_SUBSCRIPT)


def _sup_digits(value: str) -> str:
    return value.translate(_SUPERSCRIPT)


def _normalize_math(value: str) -> str:
    text = value
    text = re.sub(r"\\(?:text|mathrm|operatorname)\{([^{}]*)\}", r"\1", text)
    text = re.sub(r"\\frac\{([^{}]+)\}\{([^{}]+)\}", r"\1/\2", text)
    text = re.sub(r"\\sqrt\{([^{}]+)\}", r"sqrt(\1)", text)
    text = re.sub(
        r"([A-Za-z0-9)\]])\^\{?([0-9+\-=()]+)\}?",
        lambda m: f"{m.group(1)}{_sup_digits(m.group(2))}",
        text,
    )
    text = re.sub(
        r"([A-Za-z0-9)\]])_\{?([0-9+\-=()]+)\}?",
        lambda m: f"{m.group(1)}{_sub_digits(m.group(2))}",
        text,
    )
    replacements = {
        r"\times": "\u00d7",
        r"\cdot": "\u00b7",
        r"\div": "\u00f7",
        r"\leq": "\u2264",
        r"\le": "\u2264",
        r"\geq": "\u2265",
        r"\ge": "\u2265",
        r"\neq": "\u2260",
    }
    for raw, plain in replacements.items():
        text = text.replace(raw, plain)
    return text.replace("{", "").replace("}", "").replace("\\", "")


def normalize_ai_output(text: str | None) -> str:
    """Remove hidden/thinking markers and convert raw LaTeX into readable text."""
    value = text or ""
    value = re.sub(r"<\|channel>thought.*?<channel\|>", "", value, flags=re.DOTALL)
    value = re.sub(r"<\|.*?\|>", "", value)
    value = re.sub(r"^```[a-zA-Z0-9_-]*\s*$", "", value, flags=re.MULTILINE)
    value = re.sub(r"^```\s*$", "", value, flags=re.MULTILINE)
    value = re.sub(
        r"^\s*(?:translation|translated text|answer|response)\s*:\s*",
        "",
        value,
        flags=re.IGNORECASE,
    )
    value = re.sub(r"^\s*```[a-zA-Z0-9_-]*\s*", "", value)
    value = re.sub(r"\s*```\s*$", "", value)
    value = re.sub(r"`([^`\n]+)`", r"\1", value)

    def convert_delimited(match: re.Match[str]) -> str:
        inner = match.group(1)
        if not re.search(r"[\\_^{}]", inner):
            return match.group(0)
        return _normalize_math(inner)

    for pattern in (
        r"\$\$([\s\S]*?)\$\$",
        r"\\\[([\s\S]*?)\\\]",
        r"\\\(([\s\S]*?)\\\)",
        r"\$([^$\n]+)\$",
    ):
        value = re.sub(pattern, convert_delimited, value)

    value = _normalize_math(value)
    value = re.sub(r"\n{3,}", "\n\n", value)
    return value.strip(" \n\r\t\"'")
