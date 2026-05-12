"""Offline local authentication routes for teachers and students."""
from __future__ import annotations

import re
import secrets
from datetime import datetime, timedelta

import bcrypt
from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel, Field

from app.core.grades import VALID_GRADE_LEVELS
from app.services import db

router = APIRouter(prefix="/api/auth", tags=["auth"])

SESSION_HOURS = 8
_USERNAME_RE = re.compile(r"^[a-zA-Z0-9_][a-zA-Z0-9_.-]{1,30}[a-zA-Z0-9_]$")


class TeacherLoginRequest(BaseModel):
    username: str
    password: str


class TeacherPasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class TeacherCreateRequest(BaseModel):
    username: str
    password: str
    display_name: str
    is_admin: bool = False


class TeacherUpdateRequest(BaseModel):
    display_name: str | None = None
    is_admin: bool | None = None


class TeacherResetPasswordRequest(BaseModel):
    new_password: str


class StudentSignupRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    username: str
    pin: str
    language: str = Field(default="en", min_length=2, max_length=10)
    grade_level: str


class StudentLoginRequest(BaseModel):
    username: str
    pin: str


class StudentResetPinRequest(BaseModel):
    new_pin: str


class StudentChangePinRequest(BaseModel):
    student_id: str
    current_pin: str
    new_pin: str
    confirm_pin: str


class StudentAdminCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=200)
    username: str
    pin: str
    language: str = Field(default="en", min_length=2, max_length=10)
    grade_level: str


class SetupRequest(BaseModel):
    username: str
    password: str
    display_name: str


def _clean_username(username: str) -> str:
    return username.strip().lower()


def _validate_username(username: str) -> str:
    clean = _clean_username(username)
    if not _USERNAME_RE.match(clean):
        raise HTTPException(
            status_code=422,
            detail="Use 3-32 letters, numbers, dots, dashes, or underscores.",
        )
    return clean


def _validate_password(password: str) -> None:
    if len(password) < 6:
        raise HTTPException(status_code=422, detail="Password must be at least 6 characters.")


def _validate_pin(pin: str) -> None:
    if not re.fullmatch(r"\d{4}", pin or ""):
        raise HTTPException(status_code=422, detail="PIN must be exactly 4 numbers.")


def _hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def _verify_secret(secret: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(secret.encode("utf-8"), hashed.encode("utf-8"))
    except (TypeError, ValueError):
        return False


def _bearer_token(authorization: str | None) -> str:
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing auth token.")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid auth token.")
    return token.strip()


async def _teacher_from_token(token: str) -> dict:
    teacher = await db.get_teacher_by_session(token)
    if teacher is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Session expired. Please sign in again.")
    return teacher


async def get_current_teacher(authorization: str | None = Header(default=None, alias="Authorization")) -> dict:
    """FastAPI dependency that validates a teacher Bearer token."""
    return await _teacher_from_token(_bearer_token(authorization))


async def get_current_admin(teacher: dict = Depends(get_current_teacher)) -> dict:
    if int(teacher.get("is_admin") or 0) != 1:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required.")
    return teacher


async def _username_available_for_student(username: str) -> bool:
    teachers = await db.list_teachers(include_inactive=True)
    return (
        await db.student_username_available(username)
        and not any((t.get("username") or "").lower() == username.lower() for t in teachers)
    )


async def _username_available_for_teacher(username: str) -> bool:
    teachers = await db.list_teachers(include_inactive=True)
    return (
        not any((t.get("username") or "").lower() == username.lower() for t in teachers)
        and await db.get_student_by_username(username) is None
    )


async def _create_login_session(teacher: dict) -> dict:
    token = secrets.token_hex(32)
    expires_at = datetime.utcnow() + timedelta(hours=SESSION_HOURS)
    await db.create_teacher_session(token, teacher["id"], expires_at)
    await db.set_teacher_last_login(teacher["id"])
    return {
        "token": token,
        "teacher_id": teacher["id"],
        "display_name": teacher.get("display_name") or teacher.get("username"),
        "is_admin": bool(teacher.get("is_admin")),
        "username": teacher.get("username"),
        "expires_at": expires_at.isoformat() + "Z",
    }


def _teacher_public(teacher: dict) -> dict:
    return {
        "id": teacher["id"],
        "teacher_id": teacher["id"],
        "username": teacher.get("username"),
        "display_name": teacher.get("display_name"),
        "is_admin": bool(teacher.get("is_admin")),
        "created_at": teacher.get("created_at"),
        "last_login": teacher.get("last_login"),
        "initial_password": teacher.get("initial_password"),
        "is_active": bool(teacher.get("is_active", 1)),
    }


@router.get("/setup-required")
async def setup_required() -> dict:
    return {"setup_required": await db.count_teachers() == 0}


@router.post("/setup")
async def setup_first_admin(body: SetupRequest) -> dict:
    if await db.count_teachers() > 0:
        raise HTTPException(status_code=403, detail="Setup is already complete.")
    username = _validate_username(body.username)
    _validate_password(body.password)
    teacher = await db.create_teacher(
        username=username,
        password_hash=_hash_secret(body.password),
        display_name=body.display_name,
        is_admin=True,
        initial_password=body.password,
        created_by=None,
    )
    return await _create_login_session(teacher)


@router.post("/teacher/login")
async def teacher_login(body: TeacherLoginRequest) -> dict:
    teacher = await db.get_teacher_by_username(body.username)
    if teacher is None or not _verify_secret(body.password, teacher.get("password_hash")):
        raise HTTPException(status_code=401, detail="Those details did not match.")
    return await _create_login_session(teacher)


@router.post("/teacher/logout")
async def teacher_logout(authorization: str | None = Header(default=None, alias="Authorization")) -> dict:
    await db.delete_teacher_session(_bearer_token(authorization))
    return {"success": True}


@router.get("/teacher/me")
async def teacher_me(teacher: dict = Depends(get_current_teacher)) -> dict:
    return {
        "teacher_id": teacher["id"],
        "username": teacher.get("username"),
        "display_name": teacher.get("display_name"),
        "is_admin": bool(teacher.get("is_admin")),
    }


@router.post("/teacher/change-password")
async def teacher_change_password(
    body: TeacherPasswordChangeRequest,
    authorization: str | None = Header(default=None, alias="Authorization"),
) -> dict:
    token = _bearer_token(authorization)
    teacher = await _teacher_from_token(token)
    if not _verify_secret(body.current_password, teacher.get("password_hash")):
        raise HTTPException(status_code=401, detail="Those details did not match.")
    if body.new_password != body.confirm_password:
        raise HTTPException(status_code=422, detail="New passwords do not match.")
    _validate_password(body.new_password)
    await db.update_teacher_password(teacher["id"], _hash_secret(body.new_password))
    await db.invalidate_teacher_sessions(teacher["id"], keep_token=token)
    return {"success": True}


@router.get("/admin/teachers")
async def admin_list_teachers(_: dict = Depends(get_current_admin)) -> list[dict]:
    return [_teacher_public(t) for t in await db.list_teachers(include_inactive=True)]


@router.post("/admin/teachers")
async def admin_create_teacher(body: TeacherCreateRequest, admin: dict = Depends(get_current_admin)) -> dict:
    username = _validate_username(body.username)
    _validate_password(body.password)
    if not await _username_available_for_teacher(username):
        raise HTTPException(status_code=409, detail="Username is already in use.")
    teacher = await db.create_teacher(
        username=username,
        password_hash=_hash_secret(body.password),
        display_name=body.display_name,
        is_admin=body.is_admin,
        initial_password=body.password,
        created_by=admin["id"],
    )
    return _teacher_public(teacher)


@router.put("/admin/teachers/{teacher_id}")
async def admin_update_teacher(
    teacher_id: str,
    body: TeacherUpdateRequest,
    admin: dict = Depends(get_current_admin),
) -> dict:
    existing = await db.get_teacher_by_id(teacher_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    if body.is_admin is False and int(existing.get("is_admin") or 0) == 1:
        if teacher_id == admin["id"]:
            raise HTTPException(status_code=403, detail="You cannot remove admin access from your own account.")
        if await db.count_active_admins() <= 1:
            raise HTTPException(status_code=403, detail="Keep at least one admin teacher active.")
    updated = await db.update_teacher_profile(
        teacher_id,
        display_name=body.display_name,
        is_admin=body.is_admin,
    )
    return _teacher_public(updated)


@router.post("/admin/teachers/{teacher_id}/reset-password")
async def admin_reset_teacher_password(
    teacher_id: str,
    body: TeacherResetPasswordRequest,
    _: dict = Depends(get_current_admin),
) -> dict:
    teacher = await db.get_teacher_by_id(teacher_id)
    if teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    _validate_password(body.new_password)
    await db.update_teacher_password(
        teacher_id,
        _hash_secret(body.new_password),
        initial_password=body.new_password,
    )
    await db.invalidate_teacher_sessions(teacher_id)
    return {"success": True, "new_password": body.new_password}


@router.delete("/admin/teachers/{teacher_id}")
async def admin_delete_teacher(teacher_id: str, admin: dict = Depends(get_current_admin)) -> dict:
    teacher = await db.get_teacher_by_id(teacher_id)
    if teacher is None:
        raise HTTPException(status_code=404, detail="Teacher not found.")
    if teacher_id == admin["id"]:
        raise HTTPException(status_code=403, detail="You cannot deactivate your own account.")
    if int(teacher.get("is_admin") or 0) == 1 and await db.count_active_admins() <= 1:
        raise HTTPException(status_code=403, detail="Keep at least one admin teacher active.")
    await db.soft_delete_teacher(teacher_id)
    return {"success": True}


@router.get("/student/username-available")
async def student_username_available(username: str = Query(...)) -> dict:
    clean = _validate_username(username)
    return {"username": clean, "available": await _username_available_for_student(clean)}


@router.post("/student/signup")
async def student_signup(body: StudentSignupRequest) -> dict:
    username = _validate_username(body.username)
    _validate_pin(body.pin)
    if body.grade_level not in VALID_GRADE_LEVELS:
        raise HTTPException(status_code=422, detail="Choose a valid grade level.")
    if not await _username_available_for_student(username):
        raise HTTPException(status_code=409, detail="Username is already in use.")
    student = await db.create_registered_student(
        name=body.name,
        username=username,
        pin_hash=_hash_secret(body.pin),
        pin_visible=body.pin,
        language=body.language,
        grade_level=body.grade_level,
    )
    await db.update_last_active(student["id"])
    return {"student_id": student["id"], "name": student["name"], "username": student["username"]}


@router.post("/student/login")
async def student_login(body: StudentLoginRequest) -> dict:
    student = await db.get_student_by_username(body.username)
    if student is None or not _verify_secret(body.pin, student.get("password_hash")):
        raise HTTPException(status_code=401, detail="That PIN did not match.")
    await db.update_last_active(student["id"])
    return {
        "student_id": student["id"],
        "name": student.get("name"),
        "language": student.get("language"),
        "grade_level": student.get("grade_level"),
        "age": student.get("age"),
    }


@router.post("/student/change-pin")
async def student_change_pin(body: StudentChangePinRequest) -> dict:
    _validate_pin(body.new_pin)
    if body.new_pin != body.confirm_pin:
        raise HTTPException(status_code=422, detail="PINs do not match.")
    student = await db.get_student(body.student_id)
    if student is None or not _verify_secret(body.current_pin, student.get("password_hash")):
        raise HTTPException(status_code=401, detail="That PIN did not match.")
    await db.reset_student_pin(body.student_id, _hash_secret(body.new_pin), body.new_pin)
    return {"success": True}


@router.get("/admin/students")
async def admin_list_students(_: dict = Depends(get_current_admin)) -> list[dict]:
    return await db.list_students_for_admin(include_pin=True)


@router.post("/admin/students/{student_id}/reset-pin")
async def admin_reset_student_pin(
    student_id: str,
    body: StudentResetPinRequest,
    _: dict = Depends(get_current_admin),
) -> dict:
    _validate_pin(body.new_pin)
    student = await db.reset_student_pin(student_id, _hash_secret(body.new_pin), body.new_pin)
    if student is None:
        raise HTTPException(status_code=404, detail="Student not found.")
    return {"success": True, "new_pin": body.new_pin, "student": student}


@router.post("/admin/students")
async def admin_create_student(
    body: StudentAdminCreateRequest,
    _: dict = Depends(get_current_admin),
) -> dict:
    username = _validate_username(body.username)
    _validate_pin(body.pin)
    if body.grade_level not in VALID_GRADE_LEVELS:
        raise HTTPException(status_code=422, detail="Choose a valid grade level.")
    if not await _username_available_for_student(username):
        raise HTTPException(status_code=409, detail="Username is already in use.")
    student = await db.create_registered_student(
        name=body.name,
        username=username,
        pin_hash=_hash_secret(body.pin),
        pin_visible=body.pin,
        language=body.language,
        grade_level=body.grade_level,
    )
    return {
        "id": student["id"],
        "name": student.get("name"),
        "username": student.get("username"),
        "grade_level": student.get("grade_level"),
        "language": student.get("language"),
        "pin_visible": body.pin,
    }
