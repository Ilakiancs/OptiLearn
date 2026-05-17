"""
app/api/routes/teacher.py — teacher LMS endpoints.

Covers:
  GET  /api/teacher/students  — roster with mastery avg, alerts, level badge
  GET  /api/teacher/heatmap   — topic × student mastery grid with color metadata
  GET  /api/teacher/alerts    — students matching alert conditions
  GET  /api/teacher/report    — PDF weekly class report (?week=YYYY-WW)
  POST /api/teacher/chat      — SSE streaming AI assistant for teachers
"""
from __future__ import annotations

import json
import traceback
from datetime import datetime, timedelta
from typing import AsyncGenerator

import html as html_lib
import re
from pathlib import Path
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response, StreamingResponse
from loguru import logger
from pydantic import BaseModel

from app.core.languages import language_prompt_label
from app.core.prompts import OPTILEARN_26B_SYSTEM_PROMPT
from app.core.text_formatting import normalize_ai_output
from app.api.routes.auth import get_current_admin, get_current_teacher
from app.api.sse import sse as _sse
from app.models.schemas import TeacherChatRequest
from app.services import db, generated_cache
from app.services.model_client import MODEL_SWITCH_TOKEN, route_generate_with_fallback


class ScheduledClassCreate(BaseModel):
    title: str
    subject: str | None = None
    description: str | None = None
    start_datetime: str
    end_datetime: str
    created_by: str | None = None


class ScheduledClassUpdate(BaseModel):
    title: str | None = None
    subject: str | None = None
    description: str | None = None
    start_datetime: str | None = None
    end_datetime: str | None = None


class TeacherSettingsUpdate(BaseModel):
    master_language: str
    master_language_name: str | None = None

router = APIRouter(prefix="/api/teacher", tags=["teacher"])

_TEACHER_SYSTEM_PROMPT = """\
You are OptiLearn Assistant, an AI helper built into the OptiLearn teacher dashboard. \
You help teachers use the OptiLearn platform effectively and answer any questions they \
have about their students, the system, and education in general.

ABOUT OPTILEARN:
OptiLearn is an offline-first multilingual adaptive learning platform for refugee \
classrooms, powered by Google Gemma 4. It runs on the teacher's laptop which acts as \
a WiFi hotspot. Students connect on any device — no internet required.

FEATURES TEACHERS CAN USE:
1. Teacher Dashboard (you are here): View all students, mastery heatmap, alerts for \
inactive or struggling students, upload materials, create quizzes, schedule classes, \
and download weekly PDF reports. There is also a Connect Students panel with a QR code \
and network URL so students can join quickly without typing a long address.
2. Translate and Learn: Students upload any learning material (PDF, photo, or text) and \
get it translated into their home language with an AI tutor explanation. The tutor can \
answer follow-up questions about the material. Sessions are saved automatically so \
students can return where they left off.
3. Live Class (Teacher Broadcast): The teacher starts a Live Class session from the \
dashboard. OptiLearn captures the teacher's microphone, transcribes speech in real time, \
and streams the translation to every connected student in their own language simultaneously. \
The teacher can pause and resume the recording at any time, and sees a live participant \
count. Students join by entering a 4-digit session code. When the teacher ends the class, \
AI-generated study notes are saved for every student. The teacher can also download a \
full transcript PDF after the session.
4. Live Class (Student Personal Mode): Students can also open a personal Live Class view \
that transcribes and translates audio coming through their own device microphone — useful \
when a student is in a separate room or joins late.
5. AI Learning Companions (Personas): In the student chat screen, students can tap "Talk" \
to have a live voice conversation with an AI learning companion in their own language. \
Each companion has a name, personality, and icon. The teacher can create and manage \
companions from the dashboard.
6. Courses: Students browse all available subjects as tiles on their home screen. Each \
subject shows their current mastery percentage. Tapping a subject opens the AI tutor \
for that topic with relevant curriculum materials pre-loaded.
7. Assignments: Quizzes the teacher creates appear as assignments on the student's \
Assignments page. Students can start or retake any quiz and see their previous score.
8. Announcements: Newly uploaded materials and newly created quizzes appear on the \
student's Announcements page so they never miss something the teacher has added.
9. Grades / Results: Students have a Results page showing mastery progress bars per \
topic, average mastery, level (beginner / intermediate / advanced), and recent quiz history.
10. Calendar: The teacher schedules upcoming classes from the dashboard. Students see \
these events on their Calendar page with date, time, subject, and description.
11. Student Progress: Each student has a mastery score per topic (0.0–1.0). \
Levels: beginner (0–0.39), intermediate (0.40–0.74), advanced (0.75+). The teacher \
heatmap shows which students need help with which topics at a glance.

ALERT SYSTEM:
- Inactive alert: student has not used OptiLearn for 3+ days
- Stuck alert: student's mastery on a topic has not improved after 3 quizzes
- Level dropped: student's level decreased on a topic

HOW TO UPLOAD MATERIALS:
Go to the Materials section, click Upload, select a PDF, image, or paste text, then add \
a title and subject. The material is immediately available to all students through the \
AI tutor's curriculum retrieval and appears on the Announcements page.

HOW TO CREATE QUIZZES:
Go to Quiz Builder, click Create Quiz, add a title and questions. Assign to all students \
or a specific student. The quiz appears on each student's Assignments page and Announcements.

HOW TO SCHEDULE A CLASS:
Open the Calendar section in the dashboard, click the date, fill in the title, subject, \
start time, and end time. Students will see it on their Calendar page.

HOW TO CONNECT STUDENTS:
Open the Connect Students panel in the dashboard. Share the QR code or the URL shown \
(e.g. http://192.168.137.1:8000). Students scan the QR or type the URL into any browser \
on the same WiFi network — no app install required.

HOW TO EXPORT A STUDENT PROFILE:
Open a student's card in the dashboard and use the Export option. You must enter the \
student's 4-digit PIN to confirm. OptiLearn downloads a password-protected \
.optistudent.zip file containing the student's full profile — progress, mastery scores, \
quiz results, and session history. The ZIP is encrypted with the student's PIN as the \
password. This is useful for backing up a student's data or transferring them to another \
device or classroom.

HOW TO IMPORT A STUDENT PROFILE:
If a student has a previous OptiLearn archive (.optistudent.zip), use the Import Student \
option in the dashboard. Enter the student's 4-digit PIN (used as the ZIP password) and \
optionally map the archive to an existing student record, or create a new one.

OFFLINE MODE:
OptiLearn works fully without internet. The teacher's laptop must have Ollama installed \
with the gemma4:e2b model (~3.5 GB). When internet is available, OptiLearn \
automatically uses the faster Gemma 4 26B cloud model for better responses.

HOTSPOT SETUP (Windows):
Settings → Mobile Hotspot → Turn on. Students open their browser and go to \
http://192.168.137.1:8000 — or scan the QR code in the Connect Students panel.

TRAUMA-AWARE DESIGN:
OptiLearn uses gentle, non-judgmental correction language and avoids labels that shame or \
blame learners. The system is designed for children who have experienced trauma and \
displacement. Please be mindful of this in your interactions with students.

Be concise, warm, and practical. If a teacher asks about a specific student, remind them \
you don't have live access to their data but they can check the dashboard. Never fabricate \
student data. Respond in the same language the teacher writes in.
"""


@router.get("/students")
async def teacher_students(_: dict = Depends(get_current_teacher)) -> list[dict]:
    """All students with mastery avg, last_active, alert flags; flagged students first."""
    return await db.get_teacher_students()


@router.get("/heatmap")
async def teacher_heatmap(_: dict = Depends(get_current_teacher)) -> dict:
    """Mastery heatmap: students × topics with value and color metadata."""
    return await db.get_heatmap_data()


@router.get("/alerts")
async def teacher_alerts(_: dict = Depends(get_current_teacher)) -> list[dict]:
    """Students with at least one active alert."""
    all_students = await db.get_teacher_students()
    return [s for s in all_students if s.get("alerts")]


@router.get("/report")
async def teacher_report(
    week: str = Query(default=None),
    _: dict = Depends(get_current_teacher),
) -> Response:
    """
    Generate a multilingual PDF weekly class report using Chrome/Edge headless (same as Feature 1/2).
    ?week=YYYY-WW (ISO week). Defaults to current week.
    """
    # ── Parse week ──────────────────────────────────────────────
    if week:
        try:
            year, wnum = week.split("-W") if "-W" in week else week.split("-")
            week_start = datetime.strptime(f"{year}-W{wnum}-1", "%G-W%V-%u")
        except (ValueError, TypeError):
            week_start = datetime.utcnow() - timedelta(days=datetime.utcnow().weekday())
    else:
        week_start = datetime.utcnow() - timedelta(days=datetime.utcnow().weekday())

    week_end = week_start + timedelta(days=6)
    week_label = f"{week_start.strftime('%d %b')} – {week_end.strftime('%d %b %Y')}"

    # ── Settings + data ─────────────────────────────────────────
    settings_data = await db.get_teacher_settings()
    master_lang_code = settings_data.get("master_language", "en")
    master_lang_name = settings_data.get("master_language_name", "English")
    master_lang_label = language_prompt_label(master_lang_code)
    # master_language is intentionally generic so report localization can grow into a classroom-wide System Language layer without schema changes.

    students = await db.get_teacher_students()
    total = len(students)
    alert_count = sum(1 for s in students if s.get("alerts"))
    avg_mastery = sum(s.get("mastery_avg", 0) for s in students) / total if total else 0

    # ── AI class summary in master language ─────────────────────
    ai_summary = ""
    try:
        summary_system = (
            f"You write concise educational progress summaries. "
            f"You MUST write entirely in {master_lang_label}. No other language. "
            f"Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}."
        )
        summary_prompt = (
            f"Write 3 warm, encouraging sentences in {master_lang_label} summarising a refugee classroom's "
            f"weekly progress for their teacher. "
            f"Class: {total} students, {alert_count} need attention, {avg_mastery:.0%} average mastery. "
            f"Highlight what is positive and give one gentle actionable suggestion. "
            f"Write ONLY in {master_lang_label}."
        )
        summary_hash = generated_cache.hash_text(
            json.dumps(
                {
                    "lang": master_lang_name,
                    "total": total,
                    "alerts": alert_count,
                    "avg_mastery": avg_mastery,
                },
                sort_keys=True,
            )
        )
        cache_key = generated_cache.make_cache_key(
            "teacher.class_summary",
            {"summary_hash": summary_hash},
            prompt_version="teacher-summary-v2",
        )
        cached_summary = await generated_cache.get_text(cache_key, "teacher.class_summary")
        if cached_summary:
            ai_summary = normalize_ai_output(cached_summary)
        else:
            tokens: list[str] = []
            async for token in route_generate_with_fallback(
                summary_prompt, "ADMIN",
                system_prompt=summary_system,
                enable_thinking=False,
                lane="admin",
                feature="teacher.class_summary",
                profile="admin_balanced",
            ):
                if token != MODEL_SWITCH_TOKEN:
                    tokens.append(token)
            ai_summary = normalize_ai_output("".join(tokens))
            if ai_summary:
                await generated_cache.set_text(
                    cache_key,
                    "teacher.class_summary",
                    ai_summary,
                    input_hash=summary_hash,
                )
    except Exception as exc:
        logger.warning("PDF AI summary failed: {}", exc)

    # ── Noto font helpers (same approach as Feature 1) ──────────
    app_root = Path(__file__).resolve().parents[3]
    fonts_dir = app_root / "data" / "fonts"

    _SCRIPT_FONTS: dict[str, tuple[str, str]] = {
        "ar": ("NotoArabic",     "NotoSansArabic-Regular.ttf"),
        "fa": ("NotoArabic",     "NotoSansArabic-Regular.ttf"),
        "ur": ("NotoArabic",     "NotoSansArabic-Regular.ttf"),
        "he": ("NotoArabic",     "NotoSansArabic-Regular.ttf"),
        "ta": ("NotoTamil",      "NotoSansTamil-Regular.ttf"),
        "si": ("NotoSinhala",    "NotoSansSinhala-Regular.ttf"),
        "bn": ("NotoBengali",    "NotoSansBengali-Regular.ttf"),
        "am": ("NotoEthiopic",   "NotoSansEthiopic-Regular.ttf"),
        "ti": ("NotoEthiopic",   "NotoSansEthiopic-Regular.ttf"),
        "hi": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "mr": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "ne": ("NotoDevanagari", "NotoSansDevanagari-Regular.ttf"),
        "my": ("NotoMyanmar",    "NotoSansMyanmar-Regular.ttf"),
        "th": ("NotoThai",       "NotoSansThai-Regular.ttf"),
    }

    def _ff(name: str, filename: str, weight: str = "400") -> str:
        p = fonts_dir / filename
        return (
            f"@font-face{{font-family:'{name}';src:url('{p.as_uri()}');font-weight:{weight};}}"
            if p.exists() else ""
        )

    script_family, script_file = _SCRIPT_FONTS.get(master_lang_code, ("NotoSans", "NotoSans-Regular.ttf"))
    script_css = _ff(script_family, script_file) if script_family != "NotoSans" else ""
    font_stack = f"'{script_family}','NotoSans',sans-serif"
    is_rtl = master_lang_code in {"ar", "fa", "ur", "he", "yi"}

    # ── Build student rows ───────────────────────────────────────
    def mastery_color(v: float | None) -> str:
        if v is None: return "#AAAAAA"
        return "#E24B4A" if v < 0.40 else "#EF9F27" if v < 0.75 else "#639922"

    ALERT_LABELS = {
        "inactive_3_days": "Inactive 3+ days",
        "stuck_on_topic":  "Stuck on topic",
        "level_dropped":   "Level dropped",
    }
    ALERT_COLORS = {
        "inactive_3_days": "#dc2626",
        "stuck_on_topic":  "#d97706",
        "level_dropped":   "#dc2626",
    }

    student_rows = ""
    for s in students:
        name = html_lib.escape(s.get("name", ""))
        avg = s.get("mastery_avg") or 0
        col = mastery_color(avg)
        grade = html_lib.escape(str(s.get("grade_level", "—")))
        lang = html_lib.escape(str(s.get("language", "—")).upper())
        la = s.get("last_active") or ""
        if la:
            try:
                from datetime import timezone
                ts = datetime.fromisoformat(la.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                days_ago = (datetime.now(timezone.utc) - ts).days
                la = "Today" if days_ago == 0 else f"{days_ago}d ago"
            except Exception:
                la = la[:10]
        else:
            la = "—"
        badges = "".join(
            f'<span style="background:{ALERT_COLORS.get(a,"#666")};color:#fff;'
            f'border-radius:3pt;padding:1pt 5pt;font-size:7.5pt;margin-left:3pt">'
            f'{html_lib.escape(ALERT_LABELS.get(a, a))}</span>'
            for a in s.get("alerts", [])
        )
        mastery_list = s.get("mastery_summary", [])
        topic_rows = "".join(
            f'<tr><td style="padding:2pt 6pt">{html_lib.escape(m["topic"])}</td>'
            f'<td style="padding:2pt 6pt;text-align:center;font-weight:700;color:{mastery_color(m["mastery"])}">{m["mastery"]:.0%}</td>'
            f'<td style="padding:2pt 6pt;text-align:center;color:#5f6368;font-size:8pt">{html_lib.escape(m["level"])}</td></tr>'
            for m in mastery_list
        ) or '<tr><td colspan="3" style="padding:4pt 6pt;color:#9aa0a6;font-size:8pt">No topic data yet.</td></tr>'

        student_rows += f"""
        <div class="student-card">
            <div class="student-header">
                <div>
                    <span class="student-name">{name}</span>
                    <span style="font-size:8.5pt;color:#5f6368;margin-left:6pt">Grade {grade} &nbsp;·&nbsp; {lang}</span>
                    {badges}
                </div>
                <div style="text-align:right;font-size:8.5pt;color:#5f6368">
                    <span style="font-size:14pt;font-weight:700;color:{col}">{avg:.0%}</span><br>Last active: {html_lib.escape(la)}
                </div>
            </div>
            {"" if not mastery_list else f'''<table style="width:100%;border-collapse:collapse;font-size:8.5pt;margin-top:6pt">
                <tr style="background:#f1f3f4"><th style="padding:2pt 6pt;text-align:left;font-weight:600">Topic</th><th style="padding:2pt 6pt">Mastery</th><th style="padding:2pt 6pt">Level</th></tr>
                {topic_rows}
            </table>'''}
        </div>"""

    # ── Build full HTML ──────────────────────────────────────────
    summary_html = (
        f'<div class="summary" dir="auto">{html_lib.escape(ai_summary)}</div>'
        if ai_summary else ""
    )
    alert_avg_color = "#EF9F27" if alert_count > 0 else "#639922"
    mastery_avg_color = mastery_color(avg_mastery)

    html_doc = f"""<!doctype html>
<html dir="{'rtl' if is_rtl else 'ltr'}">
<head>
<meta charset="utf-8">
<style>
{_ff("NotoSans","NotoSans-Regular.ttf")}
{_ff("NotoSans","NotoSans-Bold.ttf","700")}
{script_css}
@page{{size:A4;margin:16mm 18mm;}}
*{{box-sizing:border-box;}}
body{{font-family:{font_stack};font-size:10pt;line-height:1.6;color:#202124;margin:0;}}
.banner{{background:#2a8dbf;color:#fff;font-weight:700;font-size:12pt;padding:7pt 12pt;margin-bottom:18pt;-webkit-print-color-adjust:exact;print-color-adjust:exact;}}
h1{{font-size:17pt;margin:0 0 3pt;}}
.meta{{color:#5f6368;font-size:8.5pt;margin-bottom:14pt;padding-bottom:7pt;border-bottom:1px solid #dadce0;}}
.summary{{background:#f8f9fa;border-left:4px solid #2a8dbf;padding:9pt 12pt;margin-bottom:14pt;font-size:10pt;direction:auto;unicode-bidi:plaintext;line-height:1.7;}}
.metrics{{display:flex;gap:10pt;margin-bottom:16pt;}}
.metric{{background:#f8f9fa;border:1px solid #dadce0;border-radius:5pt;padding:7pt 10pt;flex:1;text-align:center;}}
.metric-val{{font-size:17pt;font-weight:700;}}
.metric-lbl{{font-size:7.5pt;color:#5f6368;margin-top:1pt;}}
.student-card{{border:1px solid #dadce0;border-radius:5pt;padding:9pt 10pt;margin-bottom:9pt;page-break-inside:avoid;}}
.student-header{{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:2pt;}}
.student-name{{font-weight:700;font-size:11pt;}}
.footer{{color:#9aa0a6;font-size:7.5pt;margin-top:18pt;border-top:1px solid #dadce0;padding-top:7pt;text-align:center;}}
</style>
</head>
<body>
<div class="banner">OptiLearn — Weekly Class Report</div>
<h1>{html_lib.escape(week_label)}</h1>
<div class="meta">Report language: {html_lib.escape(master_lang_name)} &nbsp;|&nbsp; Generated by OptiLearn powered by Gemma 4</div>
{summary_html}
<div class="metrics">
  <div class="metric"><div class="metric-val" style="color:#2a8dbf">{total}</div><div class="metric-lbl">Students</div></div>
  <div class="metric"><div class="metric-val" style="color:{alert_avg_color}">{alert_count}</div><div class="metric-lbl">Flagged</div></div>
  <div class="metric"><div class="metric-val" style="color:{mastery_avg_color}">{avg_mastery:.0%}</div><div class="metric-lbl">Class Avg Mastery</div></div>
</div>
{student_rows}
<div class="footer">OptiLearn &nbsp;|&nbsp; Gemma 4 Good Hackathon 2026 &nbsp;|&nbsp; Opti5 Labs</div>
</body>
</html>"""

    # ── reportlab PDF render ─────────────────────────────────────
    from io import BytesIO
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import ParagraphStyle
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Table, TableStyle,
        Spacer, KeepTogether,
    )
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # Register fonts (Noto downloaded at startup)
    _registered: set[str] = set()

    def _try_register(name: str, filename: str) -> bool:
        if name in _registered:
            return True
        p = fonts_dir / filename
        if not p.exists():
            return False
        try:
            pdfmetrics.registerFont(TTFont(name, str(p)))
            _registered.add(name)
            return True
        except Exception:
            return False

    _try_register("NotoSans", "NotoSans-Regular.ttf")
    _try_register("NotoSans-Bold", "NotoSans-Bold.ttf")
    _try_register(script_family, script_file)

    body_font = script_family if script_family in _registered else ("NotoSans" if "NotoSans" in _registered else "Helvetica")
    bold_font = "NotoSans-Bold" if "NotoSans-Bold" in _registered else "Helvetica-Bold"

    BLUE = colors.HexColor("#2a8dbf")
    LIGHT_GREY = colors.HexColor("#f8f9fa")
    BORDER = colors.HexColor("#dadce0")
    TEXT_MUTED = colors.HexColor("#5f6368")
    TEXT_MAIN = colors.HexColor("#202124")

    def _mc(v: float | None) -> colors.HexColor:
        if v is None: return colors.HexColor("#AAAAAA")
        return colors.HexColor("#E24B4A") if v < 0.40 else colors.HexColor("#EF9F27") if v < 0.75 else colors.HexColor("#639922")

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
    )
    W = A4[0] - 36 * mm  # usable width

    story: list = []

    # Banner
    banner_data = [["OptiLearn — Weekly Class Report"]]
    banner_tbl = Table(banner_data, colWidths=[W])
    banner_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BLUE),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.white),
        ("FONTNAME", (0, 0), (-1, -1), bold_font),
        ("FONTSIZE", (0, 0), (-1, -1), 12),
        ("TOPPADDING", (0, 0), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 7),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
    ]))
    story.append(banner_tbl)
    story.append(Spacer(1, 10))

    # Week heading + metadata
    story.append(Paragraph(week_label, ParagraphStyle("h1", fontName=bold_font, fontSize=17, textColor=TEXT_MAIN, spaceAfter=4)))
    story.append(Paragraph(
        f"Report language: {master_lang_name} &nbsp;|&nbsp; Generated by OptiLearn powered by Gemma 4",
        ParagraphStyle("meta", fontName=body_font, fontSize=8.5, textColor=TEXT_MUTED, spaceAfter=10),
    ))

    # AI summary box
    if ai_summary:
        summary_data = [[Paragraph(ai_summary, ParagraphStyle("summary", fontName=body_font, fontSize=10, leading=15, textColor=TEXT_MAIN))]]
        summary_tbl = Table(summary_data, colWidths=[W - 10])
        summary_tbl.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, -1), LIGHT_GREY),
            ("LEFTPADDING", (0, 0), (-1, -1), 10),
            ("RIGHTPADDING", (0, 0), (-1, -1), 10),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
            ("LINEAFTER", (0, 0), (0, -1), 4, BLUE),
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ]))
        story.append(summary_tbl)
        story.append(Spacer(1, 10))

    # Metrics row
    alert_col = colors.HexColor("#EF9F27") if alert_count > 0 else colors.HexColor("#639922")
    metrics_data = [[
        Paragraph(f"<font size='17' color='#2a8dbf'><b>{total}</b></font><br/><font size='7' color='#5f6368'>Students</font>", ParagraphStyle("m", fontName=body_font, leading=18, alignment=1)),
        Paragraph(f"<font size='17'><b>{alert_count}</b></font><br/><font size='7' color='#5f6368'>Flagged</font>", ParagraphStyle("m", fontName=body_font, leading=18, alignment=1, textColor=alert_col)),
        Paragraph(f"<font size='17'><b>{avg_mastery:.0%}</b></font><br/><font size='7' color='#5f6368'>Class Avg Mastery</font>", ParagraphStyle("m", fontName=body_font, leading=18, alignment=1, textColor=_mc(avg_mastery))),
    ]]
    metrics_tbl = Table(metrics_data, colWidths=[W / 3] * 3)
    metrics_tbl.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_GREY),
        ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
        ("INNERGRID", (0, 0), (-1, -1), 0.5, BORDER),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(metrics_tbl)
    story.append(Spacer(1, 12))

    # Student cards
    for s in students:
        name = s.get("name", "")
        avg = s.get("mastery_avg") or 0
        grade = str(s.get("grade_level", "—"))
        lang = str(s.get("language", "—")).upper()
        la = s.get("last_active") or ""
        if la:
            try:
                from datetime import timezone
                ts = datetime.fromisoformat(la.replace("Z", "+00:00"))
                if ts.tzinfo is None:
                    ts = ts.replace(tzinfo=timezone.utc)
                days_ago = (datetime.now(timezone.utc) - ts).days
                la = "Today" if days_ago == 0 else f"{days_ago}d ago"
            except Exception:
                la = la[:10]
        else:
            la = "—"

        alert_texts = [ALERT_LABELS.get(a, a) for a in s.get("alerts", [])]
        alert_str = "  ".join(f"[{t}]" for t in alert_texts)

        header_left = Paragraph(
            f"<b>{name}</b>  <font size='8' color='#5f6368'>Grade {grade} · {lang}</font>"
            + (f"<br/><font size='8' color='#dc2626'>{alert_str}</font>" if alert_str else ""),
            ParagraphStyle("sh", fontName=body_font, fontSize=10, leading=14),
        )
        header_right = Paragraph(
            f"<font size='14'><b>{avg:.0%}</b></font><br/><font size='7.5' color='#5f6368'>Last active: {la}</font>",
            ParagraphStyle("sr", fontName=body_font, fontSize=8.5, leading=13, alignment=2, textColor=_mc(avg)),
        )
        header_row = Table([[header_left, header_right]], colWidths=[W * 0.72, W * 0.28])
        header_row.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]))

        card_items: list = [header_row]
        mastery_list = s.get("mastery_summary", [])
        if mastery_list:
            topic_header = [
                Paragraph("<b>Topic</b>", ParagraphStyle("th", fontName=bold_font, fontSize=8, textColor=TEXT_MUTED)),
                Paragraph("<b>Mastery</b>", ParagraphStyle("th", fontName=bold_font, fontSize=8, textColor=TEXT_MUTED, alignment=1)),
                Paragraph("<b>Level</b>", ParagraphStyle("th", fontName=bold_font, fontSize=8, textColor=TEXT_MUTED, alignment=1)),
            ]
            topic_rows_data = [topic_header] + [
                [
                    Paragraph(m["topic"], ParagraphStyle("td", fontName=body_font, fontSize=8.5)),
                    Paragraph(f"<b>{m['mastery']:.0%}</b>", ParagraphStyle("td", fontName=bold_font, fontSize=8.5, alignment=1, textColor=_mc(m["mastery"]))),
                    Paragraph(m["level"], ParagraphStyle("td", fontName=body_font, fontSize=8, alignment=1, textColor=TEXT_MUTED)),
                ]
                for m in mastery_list
            ]
            topic_tbl = Table(topic_rows_data, colWidths=[W * 0.55, W * 0.22, W * 0.23])
            topic_tbl.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#f1f3f4")),
                ("INNERGRID", (0, 0), (-1, -1), 0.25, BORDER),
                ("BOX", (0, 0), (-1, -1), 0.25, BORDER),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
                ("LEFTPADDING", (0, 0), (-1, -1), 5),
                ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ]))
            card_items.append(topic_tbl)

        card_wrapper = Table([[item] for item in card_items], colWidths=[W - 20])
        card_wrapper.setStyle(TableStyle([
            ("BOX", (0, 0), (-1, -1), 0.5, BORDER),
            ("TOPPADDING", (0, 0), (-1, -1), 8),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ]))
        story.append(KeepTogether([card_wrapper, Spacer(1, 8)]))

    # Footer
    story.append(Spacer(1, 10))
    story.append(Paragraph(
        "OptiLearn &nbsp;|&nbsp; Gemma 4 Good Hackathon 2026 &nbsp;|&nbsp; Opti5 Labs",
        ParagraphStyle("footer", fontName=body_font, fontSize=7.5, textColor=TEXT_MUTED, alignment=1,
                       borderPad=0, borderWidth=0.5, borderColor=BORDER, spaceBefore=6),
    ))

    try:
        doc.build(story)
    except Exception as exc:
        logger.error("reportlab PDF build error: {}", exc)
        raise HTTPException(status_code=500, detail=f"PDF could not be created: {exc}")

    pdf_bytes = buf.getvalue()

    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", f"OptiLearn_Report_{week_label}").strip("._")
    filename = f"{safe}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'attachment; filename="{filename}"; '
                f"filename*=UTF-8''{quote(filename)}"
            )
        },
    )


@router.post("/chat")
async def teacher_chat(
    body: TeacherChatRequest,
    _: dict = Depends(get_current_teacher),
) -> StreamingResponse:
    """SSE streaming AI assistant for teachers. Accepts message + history, returns token stream."""

    async def event_stream() -> AsyncGenerator[str, None]:
        try:
            # Read master language for this response
            settings_data = await db.get_teacher_settings()
            master_lang_name = settings_data.get("master_language_name", "English")
            master_lang_code = settings_data.get("master_language", "en")
            master_lang_label = language_prompt_label(master_lang_code)

            if master_lang_code != "en":
                lang_rule = (
                    f"LANGUAGE RULE — MANDATORY: You MUST respond entirely in {master_lang_label}. "
                    f"Do not use English at all. Even if the teacher writes in English, "
                    f"your reply must be in {master_lang_label} only. "
                    f"Translate everything to {master_lang_label}. "
                    f"Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{{}}.\n\n"
                )
            else:
                lang_rule = "Use plain text for formulas; never output raw LaTeX such as $...$ or \\text{}.\n\n"

            recent = [
                f"{m.get('role', 'user').title()}: {str(m.get('content', ''))}"
                for m in (body.history or [])[-10:]
                if m.get("role") in {"user", "assistant"} and str(m.get("content", "")).strip()
            ]
            prompt = (
                "Recent conversation:\n"
                + ("\n".join(recent) if recent else "No prior conversation in this panel.")
                + f"\n\nTeacher: {body.message}\nAssistant:"
            )
            system_prompt = lang_rule + OPTILEARN_26B_SYSTEM_PROMPT + "\n\n" + _TEACHER_SYSTEM_PROMPT
            async for token in route_generate_with_fallback(
                prompt,
                "ADMIN",
                system_prompt=system_prompt,
                enable_thinking=False,
                lane="admin",
                feature="teacher.chat",
                profile="admin_balanced",
            ):
                if token == MODEL_SWITCH_TOKEN:
                    yield _sse({
                        "type": "model_switch",
                        "message": "Connection interrupted. Switching to local model.",
                        "color": "#EF9F27",
                    })
                    continue
                yield _sse({"type": "token", "content": token})
            yield _sse({"type": "done"})
        except RuntimeError as exc:
            logger.warning("Teacher chat RuntimeError: {}", exc)
            yield _sse({"type": "error", "message": str(exc)})
        except Exception as exc:
            logger.error("Teacher chat error: {}\n{}", exc, traceback.format_exc())
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ── Schedule CRUD ──────────────────────────────────────────────

@router.get("/schedule")
async def list_schedule(_: dict = Depends(get_current_teacher)) -> list[dict]:
    """Return all scheduled classes ordered by start_datetime."""
    return await db.get_all_scheduled_classes()


@router.post("/schedule")
async def create_schedule(
    body: ScheduledClassCreate,
    current_teacher: dict = Depends(get_current_teacher),
) -> dict:
    """Create a scheduled class."""
    return await db.create_scheduled_class(
        title=body.title,
        subject=body.subject,
        description=body.description,
        start_datetime=body.start_datetime,
        end_datetime=body.end_datetime,
        created_by=body.created_by or current_teacher["id"],
    )


@router.put("/schedule/{class_id}")
async def update_schedule(
    class_id: str,
    body: ScheduledClassUpdate,
    _: dict = Depends(get_current_teacher),
) -> dict:
    """Update an existing scheduled class."""
    updates = {k: v for k, v in body.model_dump().items() if v is not None}
    result = await db.update_scheduled_class(class_id, **updates)
    if result is None:
        raise HTTPException(status_code=404, detail="Scheduled class not found.")
    return result


@router.delete("/schedule/{class_id}")
async def delete_schedule(
    class_id: str,
    _: dict = Depends(get_current_teacher),
) -> dict:
    """Delete a scheduled class."""
    existing = await db.get_scheduled_class(class_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Scheduled class not found.")
    await db.delete_scheduled_class(class_id)
    return {"deleted": class_id}


# ── Teacher settings ───────────────────────────────────────────

_LANG_NAMES = {
    "en": "English", "ar": "Arabic", "fr": "French", "sw": "Swahili",
    "so": "Somali", "am": "Amharic", "ti": "Tigrinya", "si": "Sinhala",
    "ta": "Tamil", "hi": "Hindi", "ur": "Urdu", "ps": "Pashto",
    "fa": "Persian", "tr": "Turkish", "ku": "Kurdish", "ha": "Hausa",
    "yo": "Yoruba", "ig": "Igbo", "zu": "Zulu", "pt": "Portuguese",
}


@router.get("/settings")
async def get_settings(current_teacher: dict = Depends(get_current_teacher)) -> dict:
    """Return current teacher settings."""
    settings = await db.get_teacher_settings()
    lang = settings.get("master_language", "en")
    return {
        "master_language": lang,
        "master_language_name": settings.get("master_language_name", _LANG_NAMES.get(lang, "English")),
        "can_update": bool(current_teacher.get("is_admin")),
    }


@router.post("/settings")
async def update_settings(
    body: TeacherSettingsUpdate,
    _: dict = Depends(get_current_admin),
) -> dict:
    """Update teacher settings."""
    lang_name = body.master_language_name or _LANG_NAMES.get(body.master_language, body.master_language.title())
    await db.update_teacher_setting("master_language", body.master_language)
    await db.update_teacher_setting("master_language_name", lang_name)
    return {"master_language": body.master_language, "master_language_name": lang_name}
