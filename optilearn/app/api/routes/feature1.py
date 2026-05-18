"""
app/api/routes/feature1.py — Language-Adaptive AI Tutor (Feature 1).

Routes:
    GET  /api/feature1/languages  — list supported languages
    POST /api/feature1/upload     — upload material (image/PDF/text)
    POST /api/feature1/translate  — SSE streaming translation
    POST /api/feature1/explain    — SSE streaming explanation
    POST /api/feature1/ask        — SSE streaming Q&A or JSON suggestions
"""
from __future__ import annotations

import asyncio
import base64
import html
import json
import re
import traceback
import uuid
from pathlib import Path
from typing import AsyncGenerator
from urllib.parse import quote

from fastapi import APIRouter, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.api.sse import sse as _sse
from app.core.config import settings
from app.core.languages import language_prompt_label
from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.core.text_formatting import normalize_ai_output
from app.services import db, faiss_store, generated_cache, job_manager
from app.services.model_client import MODEL_SWITCH_TOKEN, model_client, route_generate, route_generate_with_fallback

router = APIRouter(prefix="/api/feature1", tags=["feature1"])


def _render_translation_pdf(
    *,
    material: dict,
    student: dict,
    translated_text: str,
    target_language: str,
) -> Response:
    import os
    import shutil
    import subprocess

    translated_text = normalize_ai_output(translated_text)
    app_root = Path(__file__).resolve().parents[3]
    fonts_dir = app_root / "data" / "fonts"
    lang_display = _LANG_NAME.get(target_language, target_language.upper())

    def collapse_spaces(value: str) -> str:
        return re.sub(r"\s+", " ", value).strip()

    def trim_words(value: str, max_words: int = 6, max_chars: int = 48) -> str:
        value = collapse_spaces(value)
        words = value.split(" ")[:max_words]
        title = " ".join(words) if words else value
        if len(title) > max_chars:
            title = title[:max_chars].rstrip(" ,.;:-")
        return title.rstrip(" ,.;:-") or "Translated Material"

    def clean_doc_title(value: str) -> str:
        value = re.sub(r"^#+\s*", "", value.strip())
        value = re.sub(r"^[\-\*\u2022\d\.\)\s]+", "", value)
        return trim_words(value)

    def derive_doc_title() -> str:
        raw_title = Path(str(material.get("title") or "")).stem.strip()
        if raw_title and raw_title.lower() not in {"text_input", "upload", "untitled"}:
            return clean_doc_title(raw_title)
        source_text = ""
        file_path = Path(str(material.get("file_path") or ""))
        try:
            if file_path.exists() and file_path.suffix.lower() in {".txt", ".md"}:
                source_text = file_path.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            source_text = ""
        title_seed = source_text or translated_text
        seed_lower = title_seed.lower()
        if "gemma" in seed_lower and "model" in seed_lower:
            gemma_titles = {
                "ar": "نماذج Gemma 4",
                "bn": "Gemma 4 মডেল",
                "fr": "Modeles Gemma 4",
                "si": "Gemma 4 මාදිලි",
                "so": "Moodooyinka Gemma 4",
                "ta": "Gemma 4 மாதிரிகள்",
                "ur": "Gemma 4 ماڈلز",
            }
            if "4" in title_seed:
                return gemma_titles.get(target_language, "Gemma 4 Models")
            return {
                "ar": "نماذج Gemma",
                "bn": "Gemma মডেল",
                "fr": "Modeles Gemma",
                "si": "Gemma මාදිලි",
                "so": "Moodooyinka Gemma",
                "ta": "Gemma மாதிரிகள்",
                "ur": "Gemma ماڈلز",
            }.get(target_language, "Gemma Models")
        if "google deepmind" in seed_lower:
            return {
                "ar": "نماذج Google DeepMind",
                "bn": "Google DeepMind মডেল",
                "fr": "Modeles Google DeepMind",
                "si": "Google DeepMind මාදිලි",
                "so": "Moodooyinka Google DeepMind",
                "ta": "Google DeepMind மாதிரிகள்",
                "ur": "Google DeepMind ماڈلز",
            }.get(target_language, "Google DeepMind Models")
        for line in title_seed.splitlines():
            candidate = clean_doc_title(line)
            if len(candidate) >= 4:
                return candidate
        return f"{lang_display} Translation"

    def filename_part(value: str, fallback: str) -> str:
        value = collapse_spaces(value)
        value = re.sub(r'[<>:"/\\|?*\x00-\x1f]+', " ", value)
        value = re.sub(r"\s+", "_", value).strip("._ ")
        return value[:80].strip("._ ") or fallback

    def font_face(name: str, filename: str, weight: str = "400") -> str:
        font_path = fonts_dir / filename
        if font_path.exists():
            return (
                f"@font-face {{ font-family: '{name}'; "
                f"src: url('{font_path.as_uri()}'); font-weight: {weight}; }}"
            )
        return ""

    script_fonts = {
        "ar": ("NotoArabic", "NotoSansArabic-Regular.ttf"),
        "fa": ("NotoArabic", "NotoSansArabic-Regular.ttf"),
        "ur": ("NotoArabic", "NotoSansArabic-Regular.ttf"),
        "ta": ("NotoTamil", "NotoSansTamil-Regular.ttf"),
        "si": ("NotoSinhala", "NotoSansSinhala-Regular.ttf"),
        "bn": ("NotoBengali", "NotoSansBengali-Regular.ttf"),
        "am": ("NotoEthiopic", "NotoSansEthiopic-Regular.ttf"),
        "ti": ("NotoEthiopic", "NotoSansEthiopic-Regular.ttf"),
        "hi": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "mr": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "ne": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "my": ("NotoMyanmar", "NotoSansMyanmar-Regular.ttf"),
        "th": ("NotoThai", "NotoSansThai-Regular.ttf"),
    }
    script_font_family, script_font_file = script_fonts.get(
        target_language, ("NotoSans", "NotoSans-Regular.ttf")
    )
    script_font_css = ""
    if script_font_family != "NotoSans":
        script_font_css = font_face(script_font_family, script_font_file)
    font_stack = f"'{script_font_family}', 'NotoSans', sans-serif"

    doc_title = derive_doc_title()
    student_name = str(student.get("name") or "Student")
    grade = str(student.get("grade_level") or "").strip()
    subtitle_parts = [f"Student: {student_name}"]
    if grade:
        subtitle_parts.append(f"Grade {grade}")
    subtitle_parts.append(f"Translated to: {lang_display}")
    subtitle = " | ".join(subtitle_parts)

    css = f"""
        {font_face("NotoSans", "NotoSans-Regular.ttf")}
        {font_face("NotoSans", "NotoSans-Bold.ttf", "700")}
        {script_font_css}
        @page {{
            size: A4;
            margin: 18mm 20mm;
        }}
        * {{ box-sizing: border-box; }}
        body {{
            margin: 0;
            color: #202124;
            font-family: {font_stack};
            font-size: 11.5pt;
            line-height: 1.75;
        }}
        .banner {{
            background: #2a8dbf;
            color: white;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
            font-weight: 700;
            font-size: 13pt;
            padding: 8pt 12pt;
            margin-bottom: 24pt;
        }}
        h1 {{
            margin: 0 0 6pt;
            color: #202124;
            font-size: 22pt;
            line-height: 1.25;
            font-weight: 700;
        }}
        .meta {{
            color: #5f6368;
            font-size: 9.5pt;
            margin-bottom: 16pt;
            padding-bottom: 11pt;
            border-bottom: 1px solid #dadce0;
        }}
        .translation {{
            white-space: pre-wrap;
            unicode-bidi: plaintext;
            direction: auto;
            word-break: normal;
            overflow-wrap: break-word;
        }}
        .footer {{
            color: #9aa0a6;
            font-size: 8pt;
            margin-top: 24pt;
            padding-top: 10pt;
            border-top: 1px solid #dadce0;
            text-align: center;
        }}
    """

    html_doc = f"""<!doctype html>
        <html>
        <head>
            <meta charset="utf-8">
            <title>{html.escape(doc_title)}</title>
            <style>{css}</style>
        </head>
        <body>
            <div class="banner">OptiLearn</div>
            <h1 dir="auto">{html.escape(doc_title)}</h1>
            <div class="meta">{html.escape(subtitle)}</div>
            <div class="translation" dir="auto">{html.escape(translated_text)}</div>
            <div class="footer">Generated by OptiLearn | Gemma 4 Good Hackathon 2026 | Opti5 Labs</div>
        </body>
        </html>
    """

    def render_reportlab_pdf(reason: str) -> bytes:
        logger.info("Generating PDF with ReportLab: {}", reason)
        try:
            import io
            from reportlab.lib.colors import HexColor, white
            from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
            from reportlab.lib.pagesizes import A4
            from reportlab.lib.styles import ParagraphStyle
            from reportlab.lib.units import mm
            from reportlab.pdfbase import pdfmetrics
            from reportlab.pdfbase.ttfonts import TTFont
            from reportlab.platypus import (
                HRFlowable,
                Paragraph,
                SimpleDocTemplate,
                Spacer,
                Table,
                TableStyle,
            )
        except ImportError as exc:
            raise RuntimeError("ReportLab is not installed.") from exc

        script_font_files = {
            "si": "NotoSansSinhala-Regular.ttf",
            "ta": "NotoSansTamil-Regular.ttf",
            "ar": "NotoSansArabic-Regular.ttf",
            "fa": "NotoSansArabic-Regular.ttf",
            "ur": "NotoSansArabic-Regular.ttf",
            "am": "NotoSansEthiopic-Regular.ttf",
            "ti": "NotoSansEthiopic-Regular.ttf",
            "hi": "NotoSansDevanagari-Regular.ttf",
            "mr": "NotoSansDevanagari-Regular.ttf",
            "ne": "NotoSansDevanagari-Regular.ttf",
            "bn": "NotoSansBengali-Regular.ttf",
            "my": "NotoSansMyanmar-Regular.ttf",
            "th": "NotoSansThai-Regular.ttf",
        }

        def try_register(font_name: str, font_path: Path) -> bool:
            try:
                if font_path.exists() and font_name not in pdfmetrics.getRegisteredFontNames():
                    pdfmetrics.registerFont(TTFont(font_name, str(font_path)))
                return font_path.exists()
            except Exception:
                logger.warning("Could not register PDF font: {}", font_path)
                return False

        noto_regular = fonts_dir / "NotoSans-Regular.ttf"
        noto_bold = fonts_dir / "NotoSans-Bold.ttf"
        base_font = "Helvetica"
        bold_font = "Helvetica-Bold"
        if try_register("NotoSans", noto_regular):
            base_font = "NotoSans"
        if try_register("NotoSans-Bold", noto_bold):
            bold_font = "NotoSans-Bold"

        script_file = script_font_files.get(target_language)
        if script_file:
            script_font_name = f"NotoScript-{target_language}"
            if try_register(script_font_name, fonts_dir / script_file):
                base_font = script_font_name

        is_rtl = target_language in {"ar", "fa", "ur", "he"}
        text_align = TA_RIGHT if is_rtl else TA_LEFT
        safe_title = html.escape(doc_title)
        safe_subtitle = html.escape(subtitle)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer,
            pagesize=A4,
            leftMargin=22 * mm,
            rightMargin=22 * mm,
            topMargin=20 * mm,
            bottomMargin=20 * mm,
            title=f"OptiLearn Translation - {student_name}",
            author="OptiLearn",
        )

        header_data = [[
            Paragraph("OptiLearn", ParagraphStyle(
                "header_left",
                fontName=bold_font,
                fontSize=10,
                textColor=white,
            )),
            Paragraph("Translated Material", ParagraphStyle(
                "header_right",
                fontName=base_font,
                fontSize=10,
                textColor=white,
                alignment=TA_RIGHT,
            )),
        ]]
        header_table = Table(header_data, colWidths=[83 * mm, 83 * mm])
        header_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#2a8dbf")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (0, -1), 8),
            ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
        ]))

        title_style = ParagraphStyle(
            "title",
            fontName=bold_font,
            fontSize=22,
            leading=28,
            textColor=HexColor("#202124"),
            spaceAfter=5,
            alignment=text_align,
        )
        subtitle_style = ParagraphStyle(
            "subtitle",
            fontName=base_font,
            fontSize=10,
            leading=15,
            textColor=HexColor("#5f6368"),
            spaceAfter=14,
            alignment=text_align,
        )
        body_style = ParagraphStyle(
            "body",
            fontName=base_font,
            fontSize=11,
            leading=19,
            textColor=HexColor("#202124"),
            spaceAfter=7,
            alignment=text_align,
        )
        heading_style = ParagraphStyle(
            "heading",
            fontName=bold_font,
            fontSize=13,
            leading=18,
            textColor=HexColor("#202124"),
            spaceBefore=10,
            spaceAfter=4,
            alignment=text_align,
        )
        footer_style = ParagraphStyle(
            "footer",
            fontName=base_font,
            fontSize=8,
            textColor=HexColor("#9aa0a6"),
            alignment=TA_CENTER,
        )

        story = [
            header_table,
            Spacer(1, 6 * mm),
            Paragraph(safe_title, title_style),
            Paragraph(safe_subtitle, subtitle_style),
            HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"), spaceAfter=6 * mm),
        ]

        paragraphs = [p.strip() for p in translated_text.splitlines() if p.strip()]
        if not paragraphs:
            paragraphs = [translated_text.strip()]
        for paragraph in paragraphs:
            safe = html.escape(paragraph)
            if paragraph.startswith("##"):
                story.append(Paragraph(html.escape(paragraph.lstrip("#").strip()), heading_style))
            else:
                story.append(Paragraph(safe, body_style))

        story.extend([
            Spacer(1, 8 * mm),
            HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"), spaceBefore=4 * mm, spaceAfter=3 * mm),
            Paragraph("Generated by OptiLearn | Gemma 4 Good Hackathon 2026 | Opti5 Labs", footer_style),
        ])
        doc.build(story)
        pdf_data = buffer.getvalue()
        if not pdf_data:
            raise RuntimeError("ReportLab produced an empty PDF.")
        return pdf_data

    try:
        pdf_bytes = render_reportlab_pdf("primary renderer")
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("PDF generation failed: {}\n{}", exc, traceback.format_exc())
        raise HTTPException(
            status_code=500,
            detail="PDF could not be created on this device. Please try again or ask the teacher to reopen OptiLearn.",
        ) from exc

    filename_base = "_".join(
        [
            "OptiLearn",
            filename_part(doc_title, "Translation"),
            filename_part(lang_display, target_language.upper()),
        ]
    )
    filename = f"{filename_base}.pdf"
    ascii_filename = re.sub(r"[^A-Za-z0-9_.-]+", "_", filename).strip("._") or "OptiLearn_translation.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f"attachment; filename=\"{ascii_filename}\"; "
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )

# In-memory translation cache: material_id → translated text
# Also stores: f"pages_{id}" → pages list, f"type_{id}" → material type
_translation_cache: dict[str, object] = {}
_translation_locks: dict[str, asyncio.Lock] = {}

# Languages ordered by priority:
# 1. English (product default, group=top)
# 2. Most-spoken refugee camp languages (UNHCR data, group=refugee)
# 3. All other Gemma 4 supported languages alphabetically (group=other)
#    — Sinhala and Tamil are here, sorted alphabetically
LANGUAGES = [
    # -- Product default --
    {"code": "en",    "name": "English",               "flag": "GB",  "group": "top"},
    # -- Top refugee camp languages (UNHCR) --
    {"code": "ar",    "name": "Arabic",                "flag": "SA",  "group": "refugee"},
    {"code": "fa",    "name": "Dari / Farsi",          "flag": "AF",  "group": "refugee"},
    {"code": "ps",    "name": "Pashto",                "flag": "AF",  "group": "refugee"},
    {"code": "sw",    "name": "Swahili",               "flag": "KE",  "group": "refugee"},
    {"code": "so",    "name": "Somali",                "flag": "SO",  "group": "refugee"},
    {"code": "rh",    "name": "Rohingya",              "flag": "MM",  "group": "refugee"},
    {"code": "fr",    "name": "French",                "flag": "FR",  "group": "refugee"},
    {"code": "tr",    "name": "Turkish",               "flag": "TR",  "group": "refugee"},
    {"code": "am",    "name": "Amharic",               "flag": "ET",  "group": "refugee"},
    {"code": "ti",    "name": "Tigrinya",              "flag": "ER",  "group": "refugee"},
    {"code": "ha",    "name": "Hausa",                 "flag": "NG",  "group": "refugee"},
    {"code": "yo",    "name": "Yoruba",                "flag": "NG",  "group": "refugee"},
    {"code": "ig",    "name": "Igbo",                  "flag": "NG",  "group": "refugee"},
    {"code": "ln",    "name": "Lingala",               "flag": "CD",  "group": "refugee"},
    {"code": "rn",    "name": "Kirundi",               "flag": "BI",  "group": "refugee"},
    {"code": "rw",    "name": "Kinyarwanda",           "flag": "RW",  "group": "refugee"},
    {"code": "ny",    "name": "Chichewa",              "flag": "MW",  "group": "refugee"},
    {"code": "zu",    "name": "Zulu",                  "flag": "ZA",  "group": "refugee"},
    {"code": "sn",    "name": "Shona",                 "flag": "ZW",  "group": "refugee"},
    {"code": "el",    "name": "Greek",                 "flag": "GR",  "group": "refugee"},
    {"code": "ur",    "name": "Urdu",                  "flag": "PK",  "group": "refugee"},
    {"code": "bn",    "name": "Bengali",               "flag": "BD",  "group": "refugee"},
    {"code": "hi",    "name": "Hindi",                 "flag": "IN",  "group": "refugee"},
    {"code": "ku",    "name": "Kurdish (Kurmanji)",    "flag": "IQ",  "group": "refugee"},
    {"code": "sd",    "name": "Sindhi",                "flag": "PK",  "group": "refugee"},
    {"code": "ne",    "name": "Nepali",                "flag": "NP",  "group": "refugee"},
    {"code": "my",    "name": "Burmese",               "flag": "MM",  "group": "refugee"},
    # -- All other Gemma 4 supported languages (alphabetical) --
    {"code": "af",    "name": "Afrikaans",             "flag": "ZA",  "group": "other"},
    {"code": "sq",    "name": "Albanian",              "flag": "AL",  "group": "other"},
    {"code": "hy",    "name": "Armenian",              "flag": "AM",  "group": "other"},
    {"code": "az",    "name": "Azerbaijani",           "flag": "AZ",  "group": "other"},
    {"code": "eu",    "name": "Basque",                "flag": "ES",  "group": "other"},
    {"code": "be",    "name": "Belarusian",            "flag": "BY",  "group": "other"},
    {"code": "bs",    "name": "Bosnian",               "flag": "BA",  "group": "other"},
    {"code": "bg",    "name": "Bulgarian",             "flag": "BG",  "group": "other"},
    {"code": "ca",    "name": "Catalan",               "flag": "ES",  "group": "other"},
    {"code": "ceb",   "name": "Cebuano",               "flag": "PH",  "group": "other"},
    {"code": "zh",    "name": "Chinese (Simplified)",  "flag": "CN",  "group": "other"},
    {"code": "zh-TW", "name": "Chinese (Traditional)", "flag": "TW",  "group": "other"},
    {"code": "co",    "name": "Corsican",              "flag": "FR",  "group": "other"},
    {"code": "hr",    "name": "Croatian",              "flag": "HR",  "group": "other"},
    {"code": "cs",    "name": "Czech",                 "flag": "CZ",  "group": "other"},
    {"code": "da",    "name": "Danish",                "flag": "DK",  "group": "other"},
    {"code": "nl",    "name": "Dutch",                 "flag": "NL",  "group": "other"},
    {"code": "eo",    "name": "Esperanto",             "flag": "",    "group": "other"},
    {"code": "et",    "name": "Estonian",              "flag": "EE",  "group": "other"},
    {"code": "fi",    "name": "Finnish",               "flag": "FI",  "group": "other"},
    {"code": "fy",    "name": "Frisian",               "flag": "NL",  "group": "other"},
    {"code": "gl",    "name": "Galician",              "flag": "ES",  "group": "other"},
    {"code": "ka",    "name": "Georgian",              "flag": "GE",  "group": "other"},
    {"code": "de",    "name": "German",                "flag": "DE",  "group": "other"},
    {"code": "gu",    "name": "Gujarati",              "flag": "IN",  "group": "other"},
    {"code": "ht",    "name": "Haitian Creole",        "flag": "HT",  "group": "other"},
    {"code": "haw",   "name": "Hawaiian",              "flag": "US",  "group": "other"},
    {"code": "he",    "name": "Hebrew",                "flag": "IL",  "group": "other"},
    {"code": "hmn",   "name": "Hmong",                 "flag": "",    "group": "other"},
    {"code": "hu",    "name": "Hungarian",             "flag": "HU",  "group": "other"},
    {"code": "is",    "name": "Icelandic",             "flag": "IS",  "group": "other"},
    {"code": "id",    "name": "Indonesian",            "flag": "ID",  "group": "other"},
    {"code": "ga",    "name": "Irish",                 "flag": "IE",  "group": "other"},
    {"code": "it",    "name": "Italian",               "flag": "IT",  "group": "other"},
    {"code": "ja",    "name": "Japanese",              "flag": "JP",  "group": "other"},
    {"code": "jv",    "name": "Javanese",              "flag": "ID",  "group": "other"},
    {"code": "kn",    "name": "Kannada",               "flag": "IN",  "group": "other"},
    {"code": "kk",    "name": "Kazakh",                "flag": "KZ",  "group": "other"},
    {"code": "km",    "name": "Khmer",                 "flag": "KH",  "group": "other"},
    {"code": "ko",    "name": "Korean",                "flag": "KR",  "group": "other"},
    {"code": "ky",    "name": "Kyrgyz",                "flag": "KG",  "group": "other"},
    {"code": "lo",    "name": "Lao",                   "flag": "LA",  "group": "other"},
    {"code": "la",    "name": "Latin",                 "flag": "",    "group": "other"},
    {"code": "lv",    "name": "Latvian",               "flag": "LV",  "group": "other"},
    {"code": "lt",    "name": "Lithuanian",            "flag": "LT",  "group": "other"},
    {"code": "lb",    "name": "Luxembourgish",         "flag": "LU",  "group": "other"},
    {"code": "mk",    "name": "Macedonian",            "flag": "MK",  "group": "other"},
    {"code": "mg",    "name": "Malagasy",              "flag": "MG",  "group": "other"},
    {"code": "ms",    "name": "Malay",                 "flag": "MY",  "group": "other"},
    {"code": "ml",    "name": "Malayalam",             "flag": "IN",  "group": "other"},
    {"code": "mt",    "name": "Maltese",               "flag": "MT",  "group": "other"},
    {"code": "mi",    "name": "Maori",                 "flag": "NZ",  "group": "other"},
    {"code": "mr",    "name": "Marathi",               "flag": "IN",  "group": "other"},
    {"code": "mn",    "name": "Mongolian",             "flag": "MN",  "group": "other"},
    {"code": "no",    "name": "Norwegian",             "flag": "NO",  "group": "other"},
    {"code": "or",    "name": "Odia (Oriya)",          "flag": "IN",  "group": "other"},
    {"code": "pl",    "name": "Polish",                "flag": "PL",  "group": "other"},
    {"code": "pt",    "name": "Portuguese",            "flag": "PT",  "group": "other"},
    {"code": "pa",    "name": "Punjabi",               "flag": "IN",  "group": "other"},
    {"code": "ro",    "name": "Romanian",              "flag": "RO",  "group": "other"},
    {"code": "ru",    "name": "Russian",               "flag": "RU",  "group": "other"},
    {"code": "sm",    "name": "Samoan",                "flag": "WS",  "group": "other"},
    {"code": "gd",    "name": "Scots Gaelic",          "flag": "GB",  "group": "other"},
    {"code": "sr",    "name": "Serbian",               "flag": "RS",  "group": "other"},
    {"code": "st",    "name": "Sesotho",               "flag": "LS",  "group": "other"},
    {"code": "si",    "name": "Sinhala",               "flag": "LK",  "group": "other"},
    {"code": "sk",    "name": "Slovak",                "flag": "SK",  "group": "other"},
    {"code": "sl",    "name": "Slovenian",             "flag": "SI",  "group": "other"},
    {"code": "es",    "name": "Spanish",               "flag": "ES",  "group": "other"},
    {"code": "su",    "name": "Sundanese",             "flag": "ID",  "group": "other"},
    {"code": "tl",    "name": "Tagalog (Filipino)",    "flag": "PH",  "group": "other"},
    {"code": "tg",    "name": "Tajik",                 "flag": "TJ",  "group": "other"},
    {"code": "ta",    "name": "Tamil",                 "flag": "LK",  "group": "other"},
    {"code": "te",    "name": "Telugu",                "flag": "IN",  "group": "other"},
    {"code": "th",    "name": "Thai",                  "flag": "TH",  "group": "other"},
    {"code": "tk",    "name": "Turkmen",               "flag": "TM",  "group": "other"},
    {"code": "uk",    "name": "Ukrainian",             "flag": "UA",  "group": "other"},
    {"code": "uz",    "name": "Uzbek",                 "flag": "UZ",  "group": "other"},
    {"code": "vi",    "name": "Vietnamese",            "flag": "VN",  "group": "other"},
    {"code": "cy",    "name": "Welsh",                 "flag": "GB",  "group": "other"},
    {"code": "xh",    "name": "Xhosa",                 "flag": "ZA",  "group": "other"},
    {"code": "yi",    "name": "Yiddish",               "flag": "",    "group": "other"},
]

_LANG_NAME = {lang["code"]: lang["name"] for lang in LANGUAGES}

_SCRIPT_LANGUAGE_RANGES = [
    ("si", 0x0D80, 0x0DFF),
    ("ta", 0x0B80, 0x0BFF),
    ("ar", 0x0600, 0x06FF),
    ("he", 0x0590, 0x05FF),
    ("hi", 0x0900, 0x097F),
    ("bn", 0x0980, 0x09FF),
    ("pa", 0x0A00, 0x0A7F),
    ("gu", 0x0A80, 0x0AFF),
    ("th", 0x0E00, 0x0E7F),
    ("lo", 0x0E80, 0x0EFF),
    ("my", 0x1000, 0x109F),
    ("am", 0x1200, 0x137F),
    ("km", 0x1780, 0x17FF),
    ("ko", 0xAC00, 0xD7AF),
    ("zh", 0x4E00, 0x9FFF),
    ("ru", 0x0400, 0x04FF),
    ("el", 0x0370, 0x03FF),
]


def _detect_material_language(text: str) -> tuple[str, float]:
    """Detect source language, using script ranges before probabilistic guesses."""
    sample = (text or "").strip()
    if not sample:
        return "unknown", 0.0

    visible_chars = [ch for ch in sample if not ch.isspace()]
    if not visible_chars:
        return "unknown", 0.0

    counts: dict[str, int] = {}
    for ch in visible_chars[:3000]:
        code = ord(ch)
        for lang, start, end in _SCRIPT_LANGUAGE_RANGES:
            if start <= code <= end:
                counts[lang] = counts.get(lang, 0) + 1
                break

    if counts:
        lang, count = max(counts.items(), key=lambda item: item[1])
        confidence = round(count / max(1, sum(counts.values())), 3)
        if count >= 2:
            return lang, confidence

    try:
        from langdetect import detect_langs

        results = detect_langs(sample[:1000])
        if results:
            detected = results[0].lang.split("-")[0].lower()
            return detected, round(results[0].prob, 3)
    except Exception:
        pass

    if re.search(r"[A-Za-z]", sample):
        return "en", 0.6
    return "unknown", 0.0


def _normalize_extracted_text(text: str) -> str:
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def _ocr_image_text(raw_bytes: bytes) -> str:
    try:
        import fitz
        from PIL import Image
        import io as _io

        image = Image.open(_io.BytesIO(raw_bytes)).convert("RGB")
        png_buffer = _io.BytesIO()
        image.save(png_buffer, format="PNG")

        doc = fitz.open()
        page = doc.new_page(width=image.width, height=image.height)
        page.insert_image(page.rect, stream=png_buffer.getvalue())
        text_page = page.get_textpage_ocr(full=True, dpi=300)
        extracted = page.get_text(textpage=text_page)
        doc.close()
        return _normalize_extracted_text(extracted)
    except Exception as exc:
        logger.warning("Image OCR failed: {}", exc)
        return ""


async def _vision_transcribe_image_text(image_b64: str) -> str:
    prompt = """Transcribe all visible text in this educational image.
Return only the text you can see.
Rules:
- Do not translate.
- Do not summarize.
- Do not explain.
- Preserve line breaks and paragraph order.
- If a word is unclear, guess minimally and keep the original reading order.
- Output plain text only."""

    pieces: list[str] = []
    try:
        gen = route_generate_with_fallback(
            prompt,
            "TRANSLATION",
            system_prompt=OPTILEARN_26B_SYSTEM_PROMPT,
            enable_thinking=False,
            image_b64=image_b64,
            ollama_options={"num_ctx": 4096, "num_predict": 1024, "repeat_penalty": 1.0, "temperature": 0.0},
            lane="background",
            feature="feature1.image_ocr",
            profile="notes_balanced",
        )
        async for token in gen:
            pieces.append(token)
    except Exception as exc:
        logger.warning("Vision transcription failed: {}", exc)
        return ""

    return _normalize_extracted_text("".join(pieces))


def _extract_pdf_page_text(page: object, page_num: int) -> str:
    try:
        raw_text = _normalize_extracted_text(page.get_text())  # type: ignore[attr-defined]
    except Exception as exc:
        logger.warning("PDF text extraction failed on page {}: {}", page_num, exc)
        raw_text = ""

    if raw_text and (len(raw_text) >= 100 or len(raw_text.split()) >= 15):
        return raw_text

    try:
        text_page = page.get_textpage_ocr(full=True, dpi=300)  # type: ignore[attr-defined]
        ocr_text = _normalize_extracted_text(page.get_text(textpage=text_page))  # type: ignore[attr-defined]
        if ocr_text:
            return ocr_text
    except Exception as exc:
        logger.warning("PDF OCR failed on page {}: {}", page_num, exc)

    return raw_text

_TRANSLATE_PROMPT = """\
Translate the following educational content into {target_language}.
The reader is a student in grade {grade_level}, age {age}.
{source_language_hint}Rules:
- This is a strict conceptual translation task only
- Translate the source material once, sentence by sentence, preserving the author's meaning
- Do not summarize, explain, solve exercises, add study notes, add introductions, or add conclusions
- Do not add headings, bullets, examples, warnings, or comments unless they already exist in the source
- Preserve all mathematical, scientific, and factual meaning exactly
- Simplify vocabulary for grade {grade_level}
- Do not translate proper nouns, formulas, or units
- If a concept has no direct equivalent, choose the closest natural phrase without expanding the lesson
- Output only the translated content, no commentary
- Translate the content once only; do not repeat paragraphs or restart the translation
- Preserve paragraph structure and line breaks exactly
- Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}
Content:
{content}"""

_TRANSLATE_IMAGE_PROMPT = """\
This educational image contains text and/or diagrams (textbook page, worksheet, or learning material).
First extract ALL visible text from the image exactly as written, then translate that text into {target_language}.
{source_language_hint}The reader is a student in grade {grade_level}, age {age}.
Rules:
- Read every word visible in the image before translating
- This is a strict conceptual translation task only
- Do not summarize, explain, solve exercises, add study notes, add introductions, or add conclusions
- Do not add headings, bullets, examples, warnings, or comments unless they already exist in the source image
- Preserve all mathematical, scientific, and factual meaning exactly
- Simplify vocabulary for grade {grade_level}
- Do not translate proper nouns, formulas, or units
- Output only the translated content, no commentary
- Translate the content once only; do not repeat paragraphs or restart the translation
- Preserve paragraph and section structure
- Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}"""

_EXPLAIN_PROMPT = """\
You are a patient tutor explaining educational content to {name}, age {age}, grade {grade_level}. Respond in {language}.
Explain the following material clearly and engagingly:
- Start with a one-sentence summary of what this material is about
- Explain each major concept in simple terms
- Use examples relevant to everyday life where possible
- Use ## headings for each major concept
- Keep total length appropriate for grade {grade_level}
- Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}
- Use gentle, non-judgmental correction language. Avoid labels that shame or blame the learner.
Material:
{translated_text}"""

_ASK_PROMPT = """\
You are a patient tutor for {name}, age {age}, grade {grade_level}.
Respond in {language}.
Use gentle, non-judgmental correction language. Avoid labels that shame or blame the learner.
Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}.
Context from the student's material:
{context}
Student's question: {question}
Answer clearly and encouragingly. Use ## for concept headings if the answer covers multiple concepts. Use examples. End with one follow-up question to check understanding."""

_SUGGEST_PROMPT = """\
Return ONLY a valid JSON array of exactly 3 strings. No explanation. No markdown. No code fences. Just the array.
Example: ["Question one?", "Question two?", "Question three?"]

Write all 3 questions in {language}.
Generate 3 questions a grade {grade_level} student might ask about:
{context}"""


def _parse_tutor_history(raw: str | None) -> list[dict]:
    try:
        parsed = json.loads(raw or "[]")
        return parsed if isinstance(parsed, list) else []
    except (json.JSONDecodeError, TypeError):
        return []


def _feature1_session_payload(material: dict, include_full: bool = False) -> dict:
    payload = {
        "material_id": material.get("id"),
        "title": material.get("title") or "Learning material",
        "subject": material.get("subject"),
        "student_id": material.get("student_id"),
        "target_language": material.get("target_language"),
        "source_language": material.get("source_language"),
        "detected_language": material.get("source_language"),
        "detected_confidence": material.get("detected_confidence") or 0,
        "type": material.get("material_type") or "text",
        "page_count": material.get("page_count") or 1,
        "preview": material.get("preview") or "",
        "translated_preview": material.get("translated_preview") or "",
        "tutor_preview": material.get("tutor_preview") or "",
        "created_at": material.get("created_at"),
        "updated_at": material.get("updated_at") or material.get("created_at"),
    }
    if include_full:
        payload["translated_text"] = material.get("translated_text") or ""
        payload["tutor_summary"] = material.get("tutor_summary") or ""
        payload["tutor_history"] = _parse_tutor_history(material.get("tutor_history"))
    return payload


def _chunk_text(text: str, chunk_words: int = 200, overlap_words: int = 50) -> list[str]:
    words = text.split()
    chunks: list[str] = []
    i = 0
    while i < len(words):
        chunks.append(" ".join(words[i: i + chunk_words]))
        i += chunk_words - overlap_words
        if i >= len(words):
            break
    return chunks


async def _sse_stream_with_keepalive(
    gen: AsyncGenerator[str, None],
    page_num: int,
    on_token=None,
) -> AsyncGenerator[str, None]:
    """Wrap a token generator with SSE keepalive every 8s.

    Runs the generator in a background task feeding a queue so that
    timeout-based keepalive never cancels the underlying Ollama request.
    """
    queue: asyncio.Queue = asyncio.Queue()
    _DONE = object()

    async def _producer() -> None:
        try:
            async for token in gen:
                if on_token is not None:
                    on_token(token)
                await queue.put(token)
        finally:
            await queue.put(_DONE)

    task = asyncio.create_task(_producer())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), timeout=8.0)
            except asyncio.TimeoutError:
                yield ": keepalive\n\n"
                continue
            if item is _DONE:
                break
            if item == MODEL_SWITCH_TOKEN:
                yield _sse({
                    "type": "model_switch",
                    "page": page_num,
                    "message": "Connection interrupted. Switching to local model.",
                    "color": "#EF9F27",
                })
                continue
            yield _sse({"type": "token", "page": page_num, "content": item})
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


async def _persist_translated_material(
    *,
    material_id: str,
    student_id: str,
    target_language: str,
    full_text: str,
) -> None:
    try:
        chunks = _chunk_text(full_text)
        indexed_count = 0
        if chunks:
            indexed_count = await asyncio.to_thread(
                faiss_store.add_passages,
                [
                    {
                        "text": c,
                        "source": "uploaded_material",
                        "student_id": student_id,
                        "material_id": material_id,
                    }
                    for c in chunks
                ],
            )
        await db.update_material_translation(
            material_id,
            full_text,
            faiss_indexed=indexed_count > 0,
            target_language=target_language,
        )
        _translation_cache[f"db_lang_{material_id}"] = target_language
    except Exception as exc:
        logger.error("Persist translated material error: {}\n{}", exc, traceback.format_exc())


# ──────────────────────────────────────────────────────────────
# Route 1 — GET /api/feature1/languages
# ──────────────────────────────────────────────────────────────
@router.get("/languages")
async def get_languages() -> list[dict]:
    return LANGUAGES


@router.get("/sessions/{student_id}")
async def list_saved_sessions(student_id: str) -> dict:
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    sessions = await db.get_feature1_sessions(student_id)
    return {"sessions": [_feature1_session_payload(s) for s in sessions]}


@router.get("/sessions/{student_id}/{material_id}")
async def get_saved_session(student_id: str, material_id: str) -> dict:
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    material = await db.get_feature1_session(student_id, material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Saved session not found.")
    return _feature1_session_payload(material, include_full=True)


# ──────────────────────────────────────────────────────────────
# Route 2 — POST /api/feature1/upload
# ──────────────────────────────────────────────────────────────
@router.post("/upload")
async def upload_material(
    student_id: str = Form(...),
    target_language: str = Form(...),
    source_language_hint: str | None = Form(None),
    subject: str | None = Form(None),
    file: UploadFile | None = File(None),
    text_input: str | None = Form(None),
) -> dict:
    if not file and not text_input:
        raise HTTPException(status_code=400, detail="Provide either a file or text_input.")

    material_id = str(uuid.uuid4())
    mat_type: str
    page_count: int
    preview: str
    file_path_str: str
    pages: list[dict] = []

    save_dir = Path(settings.MATERIALS_DIR) / student_id
    save_dir.mkdir(parents=True, exist_ok=True)

    if file:
        content_type = (file.content_type or "").lower()
        raw = await file.read()
        filename = file.filename or "upload"
        dest = save_dir / f"{material_id[:8]}_{filename}"
        dest.write_bytes(raw)
        file_path_str = str(dest)

        is_image = (
            content_type in ("image/jpeg", "image/jpg", "image/png", "image/webp")
            or filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp"))
        )
        is_pdf = content_type == "application/pdf" or filename.lower().endswith(".pdf")

        if is_image:
            from PIL import Image
            import io
            from app.services import ocr_client

            # Run OCR in a thread — PaddleOCR inference blocks for 1-5s
            ocr_text = await asyncio.to_thread(
                ocr_client.extract_text, raw, source_language_hint or None
            )

            # Resize for vision-model fallback only
            img = Image.open(io.BytesIO(raw)).convert("RGB")
            max_px = settings.IMAGE_MAX_PX
            if max(img.size) > max_px:
                ratio = max_px / max(img.size)
                img = img.resize(
                    (int(img.width * ratio), int(img.height * ratio)), Image.LANCZOS
                )
            buf = io.BytesIO()
            img.save(buf, format="JPEG", quality=85)
            image_b64 = base64.b64encode(buf.getvalue()).decode()

            if not ocr_text:
                ocr_text = await asyncio.to_thread(_ocr_image_text, raw)
            if not ocr_text:
                ocr_text = await _vision_transcribe_image_text(image_b64)
            preview = ocr_text[:500] if ocr_text else f"[image:{filename}]"
            mat_type = "image"
            page_count = 1
            pages = [{"page": 1, "text": ocr_text}]
            _translation_cache[f"image_b64_{material_id[:16].replace('-','')}"] = image_b64

        elif is_pdf:
            import fitz
            doc = fitz.open(stream=raw, filetype="pdf")
            page_count = len(doc)
            pages = [
                {"page": i + 1, "text": _extract_pdf_page_text(doc[i], i + 1)}
                for i in range(page_count)
            ]
            preview = pages[0]["text"][:500] if pages else ""
            mat_type = "pdf"

        else:
            raise HTTPException(
                status_code=400,
                detail="Unsupported file type. Use PDF, JPG, PNG, or WebP.",
            )

    else:
        text_input = (text_input or "").strip()
        filename = "text_input.txt"
        dest = save_dir / f"{material_id[:8]}_{filename}"
        dest.write_text(text_input, encoding="utf-8")
        file_path_str = str(dest)
        mat_type = "text"
        page_count = 1
        preview = text_input[:500]
        pages = [{"page": 1, "text": text_input}]

    source_text = "\n".join(page.get("text", "") or "" for page in pages)
    detected_language, detected_confidence = _detect_material_language(source_text)
    if source_language_hint and source_language_hint not in ("auto", "detect", "unknown", ""):
        detected_language = source_language_hint
        detected_confidence = 1.0

    material = await db.create_material(
        title=filename,
        subject=subject,
        file_path=file_path_str,
        student_id=student_id,
        target_language=target_language,
        source_language=detected_language,
        detected_confidence=detected_confidence,
        material_type=mat_type,
        page_count=page_count,
        preview=preview[:1000] if isinstance(preview, str) else "",
    )
    mat_db_id = material["id"]

    _translation_cache[f"pages_{mat_db_id}"] = pages
    _translation_cache[f"type_{mat_db_id}"] = mat_type
    if mat_type == "image":
        # Re-key image_b64 under the DB id
        tmp_key = f"image_b64_{material_id[:16].replace('-','')}"
        if tmp_key in _translation_cache:
            _translation_cache[f"image_b64_{mat_db_id}"] = _translation_cache.pop(tmp_key)

    return {
        "material_id": mat_db_id,
        "type": mat_type,
        "page_count": page_count,
        "preview": preview,
        "detected_language": detected_language,
        "detected_confidence": detected_confidence,
    }


# ──────────────────────────────────────────────────────────────
# Route 3 — POST /api/feature1/translate  (SSE)
# ──────────────────────────────────────────────────────────────
class TranslateRequest(BaseModel):
    material_id: str
    student_id: str
    target_language: str
    page: int | None = None
    model_preference: str = "fast"


@router.post("/translate")
async def translate_material(body: TranslateRequest) -> StreamingResponse:
    material = await db.get_material(body.material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found.")
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    # Derive mat_type from DB record if cache was lost (e.g. server restart)
    _db_mat_type = (material.get("material_type") or "text").lower()
    mat_type: str = _translation_cache.get(f"type_{body.material_id}", _db_mat_type)  # type: ignore[assignment]
    pages: list[dict] = _translation_cache.get(f"pages_{body.material_id}", [])  # type: ignore[assignment]

    if not pages:
        fp = Path(material["file_path"])
        if mat_type == "image":
            # Re-run OCR in a thread — PaddleOCR blocks for 1-5s
            ocr_text = ""
            if fp.exists():
                from app.services import ocr_client as _ocr_mod
                try:
                    _src_hint = material.get("source_language") or None
                    _raw_bytes = await asyncio.to_thread(fp.read_bytes)
                    ocr_text = await asyncio.to_thread(
                        _ocr_mod.extract_text, _raw_bytes, _src_hint
                    )
                except Exception:
                    pass
            pages = [{"page": 1, "text": ocr_text}]
            if not _translation_cache.get(f"image_b64_{body.material_id}") and fp.exists():
                from PIL import Image
                import io as _io
                img = Image.open(str(fp)).convert("RGB")
                buf = _io.BytesIO()
                img.save(buf, format="JPEG", quality=85)
                _translation_cache[f"image_b64_{body.material_id}"] = base64.b64encode(buf.getvalue()).decode()
        elif fp.suffix.lower() == ".pdf" and fp.exists():
            import fitz
            doc = fitz.open(str(fp))
            pages = [{"page": i + 1, "text": doc[i].get_text()} for i in range(len(doc))]
        elif fp.exists() and fp.suffix.lower() not in (".jpg", ".jpeg", ".png", ".webp"):
            pages = [{"page": 1, "text": fp.read_text(encoding="utf-8")}]

    target_pages = [p for p in pages if body.page is None or p["page"] == body.page] or pages
    lang_name = language_prompt_label(body.target_language)
    grade = student.get("grade_level", 1)
    age = student.get("age", 10)
    _src_lang = (material.get("source_language") or "unknown").lower()
    _src_lang_name = language_prompt_label(_src_lang)
    source_language_hint = (
        f"Source language: {_src_lang_name} (may include romanized/transliterated text — translate it accurately as {_src_lang_name} content).\n"
        if _src_lang not in ("unknown", "en", "")
        else ""
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        full_parts: list[str] = []
        try:
            lock = _translation_locks.setdefault(body.material_id, asyncio.Lock())
            async with lock:
                cached_lang = _translation_cache.get(f"lang_{body.material_id}")
                cached_text = _translation_cache.get(body.material_id)
                if cached_lang == body.target_language and isinstance(cached_text, str) and cached_text.strip():
                    cached_text = normalize_ai_output(cached_text)
                    _translation_cache[body.material_id] = cached_text
                    logger.info("Feature1 translation cache hit material={} lang={}", body.material_id, body.target_language)
                    yield _sse({"type": "page_complete", "page": 1, "full_text": cached_text})
                    yield _sse({"type": "done", "total_pages": 1})
                    return

                source_hash = generated_cache.hash_text(
                    "\n\n".join((p.get("text") or "") for p in target_pages)
                    or str(material.get("file_path") or body.material_id)
                )
                cache_key = generated_cache.make_cache_key(
                    "material.translation",
                    {
                        "material_id": body.material_id,
                        "target_language": body.target_language,
                        "grade": grade,
                        "source_hash": source_hash,
                    },
                    prompt_version="feature1-translation-v2",
                )
                persisted_cached = await generated_cache.get_text(cache_key, "material.translation")
                if persisted_cached:
                    persisted_cached = normalize_ai_output(persisted_cached)
                    _translation_cache[body.material_id] = persisted_cached
                    _translation_cache[f"lang_{body.material_id}"] = body.target_language
                    yield _sse({"type": "page_complete", "page": 1, "full_text": persisted_cached})
                    yield _sse({"type": "done", "total_pages": 1, "cache_hit": True})
                    return

                for pg in target_pages:
                    page_num = pg["page"]
                    content = pg.get("text", "")

                    if mat_type == "image" and not content.strip():
                        # OCR returned nothing — fall back to vision model
                        image_b64: str | None = _translation_cache.get(  # type: ignore[assignment]
                            f"image_b64_{body.material_id}"
                        )
                        if not image_b64 and Path(material["file_path"]).exists():
                            from PIL import Image
                            import io as _io
                            img = Image.open(material["file_path"]).convert("RGB")
                            buf = _io.BytesIO()
                            img.save(buf, format="JPEG", quality=85)
                            image_b64 = base64.b64encode(buf.getvalue()).decode()
                            _translation_cache[f"image_b64_{body.material_id}"] = image_b64
                        if not image_b64:
                            yield _sse({"type": "error", "message": "Image file not found. Please re-upload."})
                            return
                        logger.info("Image OCR returned empty — using vision model fallback")
                        prompt = _TRANSLATE_IMAGE_PROMPT.format(
                            target_language=lang_name, grade_level=grade, age=age,
                            source_language_hint=source_language_hint,
                        )
                        page_buf = ""
                        gen = route_generate_with_fallback(
                            prompt,
                            "TRANSLATION",
                            system_prompt=OPTILEARN_26B_SYSTEM_PROMPT,
                            enable_thinking=False,
                            image_b64=image_b64,
                            ollama_options={"num_ctx": 4096, "num_predict": 1024, "repeat_penalty": 1.0, "temperature": 0.1},
                            lane="background",
                            feature="feature1.material_translation",
                            profile="notes_balanced",
                        )
                        async for sse_event in _sse_stream_with_keepalive(gen, page_num):
                            if sse_event.startswith(": keepalive"):
                                yield sse_event
                            else:
                                data = json.loads(sse_event[6:])
                                page_buf += data.get("content", "")
                                yield sse_event
                    else:
                        # Normal text path: used for PDF, plain text, AND images with OCR text
                        if not content.strip():
                            yield _sse({"type": "page_complete", "page": page_num, "full_text": ""})
                            continue
                        prompt = _TRANSLATE_PROMPT.format(
                            target_language=lang_name, grade_level=grade, age=age,
                            source_language_hint=source_language_hint, content=content
                        )
                        page_buf = ""
                        gen = route_generate_with_fallback(
                            prompt,
                            "TRANSLATION",
                            system_prompt=OPTILEARN_26B_SYSTEM_PROMPT,
                            enable_thinking=False,
                            ollama_options={"num_ctx": 4096, "num_predict": 1500, "repeat_penalty": 1.0, "temperature": 0.1},
                            lane="background",
                            feature="feature1.material_translation",
                            profile="notes_balanced",
                        )
                        async for sse_event in _sse_stream_with_keepalive(gen, page_num):
                            if sse_event.startswith(": keepalive"):
                                yield sse_event
                            else:
                                data = json.loads(sse_event[6:])
                                page_buf += data.get("content", "")
                                yield sse_event

                    page_buf = normalize_ai_output(page_buf)
                    if mat_type == "image" and not page_buf.strip():
                        yield _sse({
                            "type": "error",
                            "message": "The AI could not read text from this image. Try a clearer photo, or paste the text directly.",
                        })
                        return
                    full_parts.append(page_buf)
                    yield _sse({"type": "page_complete", "page": page_num, "full_text": page_buf})

                full_text = normalize_ai_output("\n\n".join(full_parts))
                _translation_cache[body.material_id] = full_text
                _translation_cache[f"lang_{body.material_id}"] = body.target_language
                await generated_cache.set_text(
                    cache_key,
                    "material.translation",
                    full_text,
                    input_hash=source_hash,
                    metadata={
                        "material_id": body.material_id,
                        "target_language": body.target_language,
                        "grade": grade,
                    },
                )

                persist_job_id = job_manager.create_job(
                    "feature1.persist_material",
                    lambda: _persist_translated_material(
                        material_id=body.material_id,
                        student_id=body.student_id,
                        target_language=body.target_language,
                        full_text=full_text,
                    ),
                    metadata={
                        "material_id": body.material_id,
                        "student_id": body.student_id,
                    },
                )
                yield _sse({"type": "done", "total_pages": len(target_pages), "job_id": persist_job_id})
                return

        except Exception as exc:
            logger.error("Translate stream error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────────────────────
# Route 4 — POST /api/feature1/explain  (SSE)
# ──────────────────────────────────────────────────────────────
class ExplainRequest(BaseModel):
    material_id: str
    student_id: str
    language: str
    model_preference: str = "fast"


@router.post("/explain")
async def explain_material(body: ExplainRequest) -> StreamingResponse:
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    translated_text: str = _translation_cache.get(body.material_id, "")  # type: ignore[assignment]
    if not translated_text:
        material = await db.get_material(body.material_id)
        if material and material.get("translated_text"):
            translated_text = material["translated_text"]
            _translation_cache[body.material_id] = translated_text
    if not translated_text:
        raise HTTPException(
            status_code=404, detail="Translation not found — translate the material first."
        )

    lang_name = language_prompt_label(body.language)
    prompt = _EXPLAIN_PROMPT.format(
        name=student["name"],
        age=student.get("age", 10),
        grade_level=student.get("grade_level", 1),
        language=lang_name,
        translated_text=translated_text[:4000],
    )
    source_hash = generated_cache.hash_text(translated_text)
    cache_key = generated_cache.make_cache_key(
        "material.explanation",
        {
            "material_id": body.material_id,
            "student_id": body.student_id,
            "language": body.language,
            "grade": student.get("grade_level", 1),
            "source_hash": source_hash,
        },
        prompt_version="feature1-explain-v2",
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            cached = await generated_cache.get_text(cache_key, "material.explanation")
            if cached:
                cached = normalize_ai_output(cached)
                yield _sse({"type": "token", "page": 1, "content": cached})
                yield _sse({"type": "done", "total_pages": 1, "cache_hit": True})
                return

            summary_chunks: list[str] = []
            # FUTURE: replace with fine-tuned model
            gen = route_generate(
                prompt,
                "TUTOR",
                enable_thinking=False,
                ollama_options={"num_ctx": 4096, "num_predict": 1024},
                lane="student_chat",
                feature="feature1.explain",
                profile="tutor_fast",
            )
            async for sse_event in _sse_stream_with_keepalive(gen, 1, summary_chunks.append):
                yield sse_event
            summary_text = normalize_ai_output("".join(summary_chunks))
            if summary_text:
                await db.update_material_tutor_summary(body.material_id, summary_text)
                await generated_cache.set_text(
                    cache_key,
                    "material.explanation",
                    summary_text,
                    input_hash=source_hash,
                    metadata={
                        "material_id": body.material_id,
                        "student_id": body.student_id,
                        "language": body.language,
                    },
                )
            yield _sse({"type": "done", "total_pages": 1})
        except Exception as exc:
            logger.error("Explain stream error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────────────────────
# Route 5 — POST /api/feature1/ask  (SSE or JSON)
# ──────────────────────────────────────────────────────────────
class AskRequest(BaseModel):
    material_id: str
    student_id: str
    question: str
    language: str
    highlighted_text: str | None = None
    format: str = "stream"  # "stream" | "json"
    model_preference: str = "fast"


@router.post("/ask")
async def ask_question(body: AskRequest):
    student = await db.get_student(body.student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    translated_text: str = _translation_cache.get(body.material_id, "")  # type: ignore[assignment]
    if not translated_text:
        material = await db.get_material(body.material_id)
        if material and material.get("translated_text"):
            translated_text = material["translated_text"]

    context = body.highlighted_text if body.highlighted_text else translated_text[:1000]
    lang_name = language_prompt_label(body.language)

    if body.format == "json":
        context = translated_text[:500] if translated_text else "general learning material"
        prompt = _SUGGEST_PROMPT.format(
            language=lang_name,
            grade_level=student.get("grade_level", 1),
            context=context,
        )
        cache_key = generated_cache.make_cache_key(
            "suggested.questions",
            {
                "material_id": body.material_id,
                "student_id": body.student_id,
                "language": body.language,
                "grade": student.get("grade_level", 1),
                "source_hash": generated_cache.hash_text(context),
            },
            prompt_version="feature1-suggestions-v2",
        )
        cached_questions = await generated_cache.get_json(cache_key, "suggested.questions")
        if isinstance(cached_questions, list):
            return {"questions": cached_questions, "cache_hit": True}
        messages = [{"role": "user", "content": prompt}]
        try:
            result = await asyncio.wait_for(
                model_client.complete_with_tools(
                    messages=messages, tools=[], image_b64=None,
                    model_preference=body.model_preference,
                    ollama_options={"num_ctx": 4096, "num_predict": 512},
                    force_local=True,  # FUTURE: replace with fine-tuned model
                    lane="student_chat",
                    feature="feature1.suggest_questions",
                    profile="tutor_fast",
                ),
                timeout=45,
            )
        except (asyncio.TimeoutError, RuntimeError) as exc:
            logger.warning("Question suggestions fallback used: {}", exc)
            return {
                "questions": [
                    "Can you explain the main idea in a simpler way?",
                    "Can you give me an example from everyday life?",
                    "What should I remember for a quick check?",
                ]
            }
        text = result if isinstance(result, str) else ""
        try:
            clean = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
            questions = json.loads(clean)
            if not isinstance(questions, list):
                questions = []
        except (json.JSONDecodeError, ValueError):
            questions = []
        if questions:
            await generated_cache.set_json(
                cache_key,
                "suggested.questions",
                questions,
                input_hash=generated_cache.hash_text(context),
                metadata={"material_id": body.material_id, "language": body.language},
            )
        return {"questions": questions}

    prompt = _ASK_PROMPT.format(
        name=student["name"],
        age=student.get("age", 10),
        grade_level=student.get("grade_level", 1),
        language=lang_name,
        context=context,
        question=body.question,
    )
    source_hash = generated_cache.hash_text(f"{context}\n\n{body.question}")
    cache_key = generated_cache.make_cache_key(
        "material.qa",
        {
            "material_id": body.material_id,
            "student_id": body.student_id,
            "language": body.language,
            "grade": student.get("grade_level", 1),
            "source_hash": source_hash,
        },
        prompt_version="feature1-ask-v2",
    )

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            cached = await generated_cache.get_text(cache_key, "material.qa")
            if cached:
                cached = normalize_ai_output(cached)
                yield _sse({"type": "token", "page": 1, "content": cached})
                yield _sse({"type": "done", "total_pages": 1, "cache_hit": True})
                return

            answer_chunks: list[str] = []
            # FUTURE: replace with fine-tuned model
            gen = route_generate(
                prompt,
                "TUTOR",
                enable_thinking=False,
                ollama_options={"num_ctx": 4096, "num_predict": 800},
                lane="student_chat",
                feature="feature1.ask",
                profile="tutor_fast",
            )
            async for sse_event in _sse_stream_with_keepalive(gen, 1, answer_chunks.append):
                yield sse_event
            answer_text = normalize_ai_output("".join(answer_chunks))
            if answer_text:
                await db.append_material_tutor_history(
                    body.material_id,
                    body.question,
                    answer_text,
                )
                await generated_cache.set_text(
                    cache_key,
                    "material.qa",
                    answer_text,
                    input_hash=source_hash,
                    metadata={
                        "material_id": body.material_id,
                        "student_id": body.student_id,
                        "language": body.language,
                    },
                )
            yield _sse({"type": "done", "total_pages": 1})
        except Exception as exc:
            logger.error("Ask stream error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────────────────────
# Route 6 — GET /api/feature1/materials/{material_id}/export
# ──────────────────────────────────────────────────────────────
@router.get("/materials/{material_id}/export")
async def export_translation_pdf(
    material_id: str,
    student_id: str = Query(...),
    target_language: str = Query("en"),
) -> Response:
    material = await db.get_material(material_id)
    if material is None:
        raise HTTPException(status_code=404, detail="Material not found.")
    student = await db.get_student(student_id)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")

    translated_text: str = (
        material.get("translated_text") or _translation_cache.get(material_id, "")
    )
    if not translated_text:
        raise HTTPException(
            status_code=400,
            detail="Translation not complete. Please translate the material first.",
        )

    return _render_translation_pdf(
        material=material,
        student=student,
        translated_text=translated_text,
        target_language=target_language,
    )

    try:
        import io
        import os
        from reportlab.lib import colors
        from reportlab.lib.colors import HexColor, white
        from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.units import mm
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.platypus import (
            HRFlowable, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle,
        )

        fonts_dir = "data/fonts"

        # Map language → script-specific Noto font file
        _SCRIPT_FONT = {
            "si": "NotoSansSinhala-Regular.ttf",
            "ta": "NotoSansTamil-Regular.ttf",
            "ar": "NotoSansArabic-Regular.ttf",
            "fa": "NotoSansArabic-Regular.ttf",
            "ur": "NotoSansArabic-Regular.ttf",
            "am": "NotoSansEthiopic-Regular.ttf",
            "ti": "NotoSansEthiopic-Regular.ttf",
            "hi": "NotoSansDevanagari-Regular.ttf",
            "mr": "NotoSansDevanagari-Regular.ttf",
            "ne": "NotoSansDevanagari-Regular.ttf",
            "bn": "NotoSansBengali-Regular.ttf",
            "my": "NotoSansMyanmar-Regular.ttf",
            "th": "NotoSansThai-Regular.ttf",
        }

        def _try_register(font_name: str, file_path: str) -> bool:
            try:
                if os.path.exists(file_path):
                    pdfmetrics.registerFont(TTFont(font_name, file_path))
                    return True
            except Exception:
                pass
            return False

        # Always register NotoSans for headers/footer
        _try_register("NotoSans", os.path.join(fonts_dir, "NotoSans-Regular.ttf"))
        _try_register("NotoSans-Bold", os.path.join(fonts_dir, "NotoSans-Bold.ttf"))

        # Pick body font: script-specific if available, else NotoSans, else Helvetica
        script_file = _SCRIPT_FONT.get(target_language)
        if script_file:
            script_path = os.path.join(fonts_dir, script_file)
            font_id = f"NotoScript-{target_language}"
            if _try_register(font_id, script_path):
                base_font = font_id
            elif os.path.exists(os.path.join(fonts_dir, "NotoSans-Regular.ttf")):
                base_font = "NotoSans"
            else:
                base_font = "Helvetica"
        elif os.path.exists(os.path.join(fonts_dir, "NotoSans-Regular.ttf")):
            base_font = "NotoSans"
        else:
            base_font = "Helvetica"

        bold_font = "NotoSans-Bold" if os.path.exists(os.path.join(fonts_dir, "NotoSans-Bold.ttf")) else "Helvetica-Bold"

        rtl_languages = {"ar", "fa", "ur", "he"}
        is_rtl = target_language in rtl_languages
        text_align = TA_RIGHT if is_rtl else TA_LEFT

        watermark_style = ParagraphStyle("watermark",
            fontName=base_font, fontSize=8,
            textColor=HexColor("#2a8dbf"), spaceAfter=2)
        title_style = ParagraphStyle("title",
            fontName=bold_font, fontSize=22,
            textColor=HexColor("#202124"), spaceAfter=4,
            alignment=text_align)
        subtitle_style = ParagraphStyle("subtitle",
            fontName=base_font, fontSize=10,
            textColor=HexColor("#5f6368"), spaceAfter=16,
            alignment=text_align)
        body_style = ParagraphStyle("body",
            fontName=base_font, fontSize=11,
            leading=20, textColor=HexColor("#202124"),
            spaceAfter=8, spaceBefore=0,
            alignment=text_align)
        heading_style = ParagraphStyle("heading",
            fontName=bold_font, fontSize=13,
            textColor=HexColor("#202124"), spaceBefore=10,
            spaceAfter=4, alignment=text_align)
        footer_style = ParagraphStyle("footer",
            fontName=base_font, fontSize=8,
            textColor=HexColor("#aaaaaa"), alignment=TA_CENTER)

        buffer = io.BytesIO()
        doc = SimpleDocTemplate(
            buffer, pagesize=A4,
            leftMargin=22 * mm, rightMargin=22 * mm,
            topMargin=20 * mm, bottomMargin=20 * mm,
            title=f"OptiLearn Translation — {student['name']}",
            author="OptiLearn",
        )

        header_data = [[
            Paragraph("OptiLearn", ParagraphStyle("hl",
                fontName=bold_font, fontSize=10, textColor=white)),
            Paragraph("Translated Material", ParagraphStyle("hr",
                fontName=base_font, fontSize=10, textColor=white, alignment=TA_RIGHT)),
        ]]
        header_table = Table(header_data, colWidths=[83 * mm, 83 * mm])
        header_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), HexColor("#2a8dbf")),
            ("TOPPADDING", (0, 0), (-1, -1), 6),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ("LEFTPADDING", (0, 0), (0, -1), 8),
            ("RIGHTPADDING", (-1, 0), (-1, -1), 8),
        ]))

        doc_title = os.path.splitext(material.get("title", "Translated Document"))[0]
        lang_display = _LANG_NAME.get(target_language, target_language.upper())

        story = [
            header_table,
            Spacer(1, 6 * mm),
            Paragraph(doc_title, title_style),
            Paragraph(
                f"Student: {student['name']}  ·  Grade {student.get('grade_level', '')}  ·  Translated to: {lang_display}",
                subtitle_style,
            ),
            HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"), spaceAfter=6 * mm),
        ]

        paragraphs = [p.strip() for p in translated_text.split("\n") if p.strip()]
        for i, para_text in enumerate(paragraphs):
            safe = para_text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
            if safe.startswith("##"):
                story.append(Paragraph(safe.lstrip("#").strip(), heading_style))
            else:
                story.append(Paragraph(safe, body_style))
            if i < len(paragraphs) - 1:
                story.append(Spacer(1, 1 * mm))

        story.extend([
            Spacer(1, 8 * mm),
            HRFlowable(width="100%", thickness=1, color=HexColor("#dadce0"),
                       spaceBefore=4 * mm, spaceAfter=3 * mm),
            Paragraph(
                "Generated by OptiLearn · Gemma 4 Good Hackathon 2026 · Opti5 Labs",
                footer_style,
            ),
        ])

        doc.build(story)
        buffer.seek(0)

        safe_name = student["name"].replace(" ", "_")
        filename = f"optilearn_{safe_name}_translation.pdf"
        return Response(
            content=buffer.read(),
            media_type="application/pdf",
            headers={"Content-Disposition": f"attachment; filename={filename}"},
        )

    except ImportError:
        raise HTTPException(status_code=500, detail="reportlab is not installed. Run: pip install reportlab")
    except Exception as exc:
        logger.error("PDF export error: {}\n{}", exc, traceback.format_exc())
        raise HTTPException(status_code=500, detail=str(exc))


# ──────────────────────────────────────────────────────────────
# TTS router — POST /api/tts/speak
# ──────────────────────────────────────────────────────────────
tts_router = APIRouter(prefix="/api/tts", tags=["tts"])

_SILENCE_WAV = bytes([
    82, 73, 70, 70, 36, 0, 0, 0, 87, 65, 86, 69, 102, 109, 116, 32,
    16, 0, 0, 0, 1, 0, 1, 0, 68, 172, 0, 0, 136, 88, 1, 0, 2, 0, 16,
    0, 100, 97, 116, 97, 0, 0, 0, 0,
])


class TTSSpeakRequest(BaseModel):
    text: str
    language: str = "en"


@tts_router.post("/speak")
async def tts_speak(body: TTSSpeakRequest) -> Response:
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty.")

    text = body.text.strip()[:2000]

    try:
        from app.services import tts_client
        wav_bytes = await tts_client.speak(text, body.language)
        if not wav_bytes:
            return Response(content=_SILENCE_WAV, media_type="audio/wav")
        return Response(content=wav_bytes, media_type="audio/wav")
    except ImportError:
        logger.warning("tts_client not available — returning silence stub")
        return Response(content=_SILENCE_WAV, media_type="audio/wav")
    except Exception as exc:
        logger.warning("TTS error ({}): {} — returning silence stub", body.language, exc)
        return Response(content=_SILENCE_WAV, media_type="audio/wav")


@tts_router.post("/speak-stream")
async def tts_speak_stream(body: TTSSpeakRequest) -> StreamingResponse:
    if not body.text or not body.text.strip():
        raise HTTPException(status_code=400, detail="text must not be empty.")

    import struct
    text = body.text.strip()[:3000]
    language = body.language

    from app.services import tts_client

    async def generate():
        try:
            async for wav_chunk in tts_client.speak_sentences(text, language):
                if not wav_chunk:
                    continue
                # 4-byte LE length prefix + complete WAV — frontend decodes each independently
                yield struct.pack("<I", len(wav_chunk)) + wav_chunk
        except Exception as exc:
            logger.error("speak-stream error: {}", exc)

    return StreamingResponse(
        generate(),
        media_type="application/octet-stream",
        headers={"X-Content-Type-Options": "nosniff", "Cache-Control": "no-cache"},
    )
