"""
app/api/routes/dashboard.py — teacher dashboard endpoint.
"""
from fastapi import APIRouter

from app.services import db

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])


@router.get("")
async def get_dashboard() -> dict:
    """Return aggregated dashboard data for the teacher view. Intended to be polled every 10s."""
    return await db.get_dashboard_data()
