"""
app/api/routes/teacher.py — teacher LMS endpoints.

Covers:
  GET  /api/teacher/students  — roster with mastery avg, alerts, level badge
  GET  /api/teacher/heatmap   — topic × student mastery grid with color metadata
  GET  /api/teacher/alerts    — students matching alert conditions
  GET  /api/teacher/report    — PDF weekly class report (?week=YYYY-WW)
"""
from __future__ import annotations

import io
from datetime import datetime, timedelta

from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse

from app.services import db

router = APIRouter(prefix="/api/teacher", tags=["teacher"])


@router.get("/students")
async def teacher_students() -> list[dict]:
    """All students with mastery avg, last_active, alert flags; flagged students first."""
    return await db.get_teacher_students()


@router.get("/heatmap")
async def teacher_heatmap() -> dict:
    """Mastery heatmap: students × topics with value and color metadata."""
    return await db.get_heatmap_data()


@router.get("/alerts")
async def teacher_alerts() -> list[dict]:
    """Students with at least one active alert."""
    all_students = await db.get_teacher_students()
    return [s for s in all_students if s.get("alerts")]


@router.get("/report")
async def teacher_report(week: str = Query(default=None)) -> StreamingResponse:
    """
    Generate a PDF weekly class report.
    ?week=YYYY-WW (ISO week). Defaults to current week.
    """
    try:
        from reportlab.lib import colors
        from reportlab.lib.pagesizes import A4
        from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
        from reportlab.lib.units import cm
        from reportlab.platypus import (
            SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, HRFlowable
        )
    except ImportError:
        from fastapi import HTTPException
        raise HTTPException(status_code=500, detail="reportlab not installed")

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

    students = await db.get_teacher_students()

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=2*cm, rightMargin=2*cm, topMargin=2*cm, bottomMargin=2*cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle(
        "Title2", parent=styles["Title"], fontSize=18, textColor=colors.HexColor("#6c63ff")
    )
    h2_style = ParagraphStyle(
        "H2", parent=styles["Heading2"], fontSize=12, textColor=colors.HexColor("#333333")
    )
    normal = styles["Normal"]

    COLOR_RED   = colors.HexColor("#E24B4A")
    COLOR_AMBER = colors.HexColor("#EF9F27")
    COLOR_GREEN = colors.HexColor("#639922")
    COLOR_GREY  = colors.HexColor("#AAAAAA")

    def mastery_color(val):
        if val is None:
            return COLOR_GREY
        if val < 0.40:
            return COLOR_RED
        if val < 0.75:
            return COLOR_AMBER
        return COLOR_GREEN

    story = []

    story.append(Paragraph("OptiLearn — Weekly Class Report", title_style))
    story.append(Paragraph(f"Week of {week_label}", normal))
    story.append(Spacer(1, 0.4*cm))
    story.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#cccccc")))
    story.append(Spacer(1, 0.4*cm))

    # Summary metrics
    total = len(students)
    alert_count = sum(1 for s in students if s.get("alerts"))
    avg_mastery = (
        sum(s.get("mastery_avg", 0) for s in students) / total if total else 0
    )
    story.append(Paragraph("Summary", h2_style))
    summary_data = [
        ["Total students", str(total)],
        ["Students with alerts", str(alert_count)],
        ["Class avg mastery", f"{avg_mastery:.0%}"],
    ]
    summary_table = Table(summary_data, colWidths=[10*cm, 5*cm])
    summary_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("ROWBACKGROUNDS", (0, 0), (-1, -1), [colors.HexColor("#f5f5f5"), colors.white]),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
    ]))
    story.append(summary_table)
    story.append(Spacer(1, 0.5*cm))

    # Alerts
    if alert_count:
        story.append(Paragraph("Students Needing Attention", h2_style))
        alert_data = [["Name", "Alert", "Mastery Avg"]]
        for s in students:
            for alert in s.get("alerts", []):
                alert_label = {
                    "inactive_3_days": "Inactive 3+ days",
                    "stuck_on_topic": "Stuck on topic",
                    "level_dropped": "Level dropped",
                }.get(alert, alert)
                alert_data.append([
                    s["name"], alert_label, f"{s.get('mastery_avg', 0):.0%}"
                ])
        alert_table = Table(alert_data, colWidths=[7*cm, 6*cm, 4*cm])
        alert_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#6c63ff")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTSIZE", (0, 0), (-1, -1), 10),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.HexColor("#fff3f3"), colors.white]),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
            ("LEFTPADDING", (0, 0), (-1, -1), 8),
            ("RIGHTPADDING", (0, 0), (-1, -1), 8),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ]))
        story.append(alert_table)
        story.append(Spacer(1, 0.5*cm))

    # Per-student mastery breakdown
    story.append(Paragraph("Student Mastery Breakdown", h2_style))
    for s in students:
        story.append(Paragraph(f"<b>{s['name']}</b> — Grade {s.get('grade_level','?')} — Lang: {s.get('language','?')}", normal))
        mastery_list = s.get("mastery_summary", [])
        if mastery_list:
            m_data = [["Topic", "Mastery", "Level"]]
            for m in mastery_list:
                m_data.append([m["topic"], f"{m['mastery']:.0%}", m["level"]])
            m_table = Table(m_data, colWidths=[8*cm, 4*cm, 5*cm])
            mc = mastery_color
            row_colors = []
            for i, m in enumerate(mastery_list, start=1):
                c = mc(m["mastery"])
                row_colors.append(("BACKGROUND", (1, i), (1, i), c))
                row_colors.append(("TEXTCOLOR", (1, i), (1, i), colors.white))
            m_table.setStyle(TableStyle([
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#444466")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                ("FONTSIZE", (0, 0), (-1, -1), 9),
                ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#cccccc")),
                ("LEFTPADDING", (0, 0), (-1, -1), 6),
                ("RIGHTPADDING", (0, 0), (-1, -1), 6),
                ("TOPPADDING", (0, 0), (-1, -1), 4),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
            ] + row_colors))
            story.append(m_table)
        else:
            story.append(Paragraph("No topic data yet.", normal))
        story.append(Spacer(1, 0.3*cm))

    doc.build(story)
    buf.seek(0)

    filename = f"optilearn-report-{week_label.replace(' ', '-').replace('–', 'to')}.pdf"
    return StreamingResponse(
        buf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
