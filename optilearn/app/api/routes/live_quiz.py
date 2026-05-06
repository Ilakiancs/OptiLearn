"""
app/api/routes/live_quiz.py — Kahoot-style Live Quiz engine.

REST endpoints:
  POST   /api/live-quiz/games              — create game (teacher auth)
  GET    /api/live-quiz/games/{id}         — game state (public)
  POST   /api/live-quiz/games/{id}/join    — join as participant (nickname, public)
  POST   /api/live-quiz/games/{id}/next    — advance question (teacher auth)
  POST   /api/live-quiz/games/{id}/reveal  — reveal answer (teacher auth)
  POST   /api/live-quiz/games/{id}/end     — end game (teacher auth)
  POST   /api/live-quiz/games/{id}/answer  — submit answer (public)
  GET    /api/live-quiz/games/{id}/results — leaderboard (public)

WebSocket:
  WS     /api/live-quiz/ws/{id}            — real-time state push (public)
"""
from __future__ import annotations

import json
import random
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Any

import aiosqlite
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from loguru import logger
from pydantic import BaseModel, Field

from app.api.routes.auth import get_current_teacher
from app.core.config import settings

router = APIRouter(prefix="/api/live-quiz", tags=["live-quiz"])


def _generate_join_code() -> str:
    """Generate a memorable 6-digit numeric join PIN (e.g. '482 931')."""
    return str(random.randint(100000, 999999))

# ──────────────────────────────────────────────────────────────
# WebSocket connection manager
# ──────────────────────────────────────────────────────────────

class ConnectionManager:
    """Manage per-game WebSocket rooms and broadcast game state to all clients."""

    def __init__(self) -> None:
        self.rooms: dict[str, list[WebSocket]] = defaultdict(list)

    async def connect(self, game_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms[game_id].append(ws)
        logger.debug("WS connected: game={} total={}", game_id, len(self.rooms[game_id]))

    def disconnect(self, game_id: str, ws: WebSocket) -> None:
        self.rooms[game_id].discard(ws) if hasattr(self.rooms[game_id], 'discard') else None
        try:
            self.rooms[game_id].remove(ws)
        except ValueError:
            pass
        logger.debug("WS disconnected: game={} remaining={}", game_id, len(self.rooms[game_id]))

    async def broadcast(self, game_id: str, message: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self.rooms.get(game_id, [])):
            try:
                await ws.send_json(message)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(game_id, ws)


manager = ConnectionManager()


# ──────────────────────────────────────────────────────────────
# DB helpers
# ──────────────────────────────────────────────────────────────

async def _db() -> aiosqlite.Connection:
    """Open a short-lived DB connection with row factory set."""
    conn = await aiosqlite.connect(settings.DB_PATH)
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL;")
    await conn.execute("PRAGMA foreign_keys=ON;")
    return conn


def _row(row: aiosqlite.Row | None) -> dict[str, Any] | None:
    return dict(row) if row else None


async def _get_game(game_id: str) -> dict[str, Any] | None:
    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT * FROM live_games WHERE id = ?", (game_id,)
        )
        return _row(await cur.fetchone())
    finally:
        await conn.close()


async def _get_participant_count(game_id: str) -> int:
    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT COUNT(*) AS n FROM live_participants WHERE game_id = ?", (game_id,)
        )
        row = await cur.fetchone()
        return int(row["n"]) if row else 0
    finally:
        await conn.close()


async def _get_answer_count(game_id: str, question_index: int) -> int:
    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT COUNT(*) AS n FROM live_answers WHERE game_id = ? AND question_index = ?",
            (game_id, question_index),
        )
        row = await cur.fetchone()
        return int(row["n"]) if row else 0
    finally:
        await conn.close()


async def _broadcast_state(game_id: str, extra: dict[str, Any] | None = None) -> None:
    """Fetch current game state and broadcast to all connected WS clients."""
    game = await _get_game(game_id)
    if not game:
        return
    payload = {
        "type": "game_state",
        "game_id": game_id,
        "phase": game["phase"],
        "current_question_index": game["current_question_index"],
        "is_answer_revealed": bool(game["is_answer_revealed"]),
        "participant_count": await _get_participant_count(game_id),
        "answer_count": await _get_answer_count(game_id, game["current_question_index"]),
    }
    if extra:
        payload.update(extra)
    await manager.broadcast(game_id, payload)


# ──────────────────────────────────────────────────────────────
# Pydantic models
# ──────────────────────────────────────────────────────────────

class CreateGameRequest(BaseModel):
    quiz_id: str = Field(..., min_length=1)


class JoinGameRequest(BaseModel):
    nickname: str = Field(..., min_length=1, max_length=32)


class AnswerRequest(BaseModel):
    participant_id: str
    choice_index: int | None = None  # None = timed out / no answer


# ──────────────────────────────────────────────────────────────
# REST Endpoints
# ──────────────────────────────────────────────────────────────

@router.post("/games")
async def create_game(
    body: CreateGameRequest,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    """
    Create a new live game session from an existing teacher quiz.
    Returns the game id to share with students via QR code.
    """
    # Load the quiz and embed a snapshot so the game carries all question data
    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT * FROM teacher_quizzes WHERE id = ?", (body.quiz_id,)
        )
        quiz_row = _row(await cur.fetchone())
    finally:
        await conn.close()

    if not quiz_row:
        raise HTTPException(status_code=404, detail="Quiz not found.")

    # Parse questions JSON stored in the teacher_quizzes table
    try:
        questions_raw = json.loads(quiz_row["questions"])
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(status_code=422, detail="Quiz has no valid questions.")

    if not questions_raw:
        raise HTTPException(status_code=422, detail="Quiz must have at least one question.")

    # Normalise question format into the live game canonical shape
    questions_normalized = []
    for i, q in enumerate(questions_raw):
        opts = q.get("options") or []
        correct = q.get("correct_answer", "")
        choices = [
            {"text": opt, "is_correct": opt == correct}
            for opt in opts
        ]
        questions_normalized.append({
            "index": i,
            "body": q.get("question", ""),
            "choices": choices,
            "explanation": q.get("explanation", ""),
        })

    game_id = str(uuid.uuid4())
    join_code = _generate_join_code()
    now = datetime.utcnow().isoformat()

    conn = await _db()
    try:
        await conn.execute(
            """
            INSERT INTO live_games (id, quiz_id, teacher_id, phase,
                current_question_index, is_answer_revealed,
                quiz_title, questions_json, join_code, created_at)
            VALUES (?, ?, ?, 'lobby', 0, 0, ?, ?, ?, ?)
            """,
            (
                game_id,
                body.quiz_id,
                teacher["id"],
                quiz_row.get("title", "Untitled Quiz"),
                json.dumps(questions_normalized),
                join_code,
                now,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    logger.info("Live game created: id={} code={} quiz_id={} teacher={}", game_id, join_code, body.quiz_id, teacher["id"])
    return {
        "game_id": game_id,
        "join_code": join_code,
        "quiz_title": quiz_row.get("title", "Untitled Quiz"),
        "question_count": len(questions_normalized),
        "phase": "lobby",
    }


@router.get("/games/{game_id}")
async def get_game_state(game_id: str) -> dict:
    """Public endpoint — returns current game phase + question index."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")

    questions = json.loads(game.get("questions_json") or "[]")
    participant_count = await _get_participant_count(game_id)

    current_q = None
    if game["phase"] == "quiz" and questions:
        q = questions[game["current_question_index"]]
        # Don't expose is_correct to players unless answer is revealed
        safe_choices = [
            {"text": c["text"], "is_correct": c["is_correct"] if game["is_answer_revealed"] else None}
            for c in q["choices"]
        ]
        current_q = {**q, "choices": safe_choices}

    return {
        "game_id": game_id,
        "quiz_title": game.get("quiz_title", ""),
        "join_code": game.get("join_code", ""),
        "phase": game["phase"],
        "current_question_index": game["current_question_index"],
        "question_count": len(questions),
        "is_answer_revealed": bool(game["is_answer_revealed"]),
        "participant_count": participant_count,
        "current_question": current_q,
    }


@router.get("/find/{join_code}")
async def find_game_by_code(join_code: str) -> dict:
    """
    Public — look up an active lobby game by its 6-digit join code.
    Returns game_id so the student can be redirected to the join screen.
    """
    clean = join_code.strip().replace(" ", "")
    if not clean.isdigit() or len(clean) != 6:
        raise HTTPException(status_code=400, detail="Join code must be 6 digits.")

    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT id, quiz_title, phase FROM live_games WHERE join_code = ? AND phase = 'lobby'",
            (clean,),
        )
        row = _row(await cur.fetchone())
    finally:
        await conn.close()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="No active game found with that code. Ask your teacher to check the PIN.",
        )

    return {"game_id": row["id"], "quiz_title": row["quiz_title"]}


@router.post("/games/{game_id}/join")
async def join_game(game_id: str, body: JoinGameRequest) -> dict:
    """Public — enter a nickname and join as a participant. Returns participant_id."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["phase"] != "lobby":
        raise HTTPException(status_code=400, detail="Game has already started.")

    participant_id = str(uuid.uuid4())
    now = datetime.utcnow().isoformat()

    conn = await _db()
    try:
        await conn.execute(
            "INSERT INTO live_participants (id, game_id, nickname, created_at) VALUES (?, ?, ?, ?)",
            (participant_id, game_id, body.nickname.strip(), now),
        )
        await conn.commit()
    finally:
        await conn.close()

    participant_count = await _get_participant_count(game_id)
    await manager.broadcast(game_id, {
        "type": "participant_joined",
        "nickname": body.nickname.strip(),
        "participant_count": participant_count,
    })

    logger.info("Participant joined: game={} nickname={}", game_id, body.nickname)
    return {"participant_id": participant_id, "nickname": body.nickname.strip()}


@router.post("/games/{game_id}/next")
async def next_question(
    game_id: str,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    """Teacher only — start the game or advance to the next question (or end game)."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=403, detail="Not your game.")

    questions = json.loads(game.get("questions_json") or "[]")

    # ── Special case: starting from lobby ────────────────────────
    # The "Start Game" button calls /next from the lobby phase.
    # We must NOT increment the index here — just transition to quiz at index 0.
    if game["phase"] == "lobby":
        conn = await _db()
        try:
            await conn.execute(
                "UPDATE live_games SET phase = 'quiz', current_question_index = 0, is_answer_revealed = 0 WHERE id = ?",
                (game_id,),
            )
            await conn.commit()
        finally:
            await conn.close()
        await _broadcast_state(game_id)
        return {"phase": "quiz", "current_question_index": 0}

    # ── Normal case: advance to next question ─────────────────────
    next_index = game["current_question_index"] + 1

    conn = await _db()
    try:
        if next_index >= len(questions):
            # All questions done — end the game
            await conn.execute(
                "UPDATE live_games SET phase = 'result', is_answer_revealed = 0 WHERE id = ?",
                (game_id,),
            )
            await conn.commit()
            await _broadcast_state(game_id)
            return {"phase": "result"}
        else:
            await conn.execute(
                """
                UPDATE live_games
                SET current_question_index = ?, is_answer_revealed = 0
                WHERE id = ?
                """,
                (next_index, game_id),
            )
            await conn.commit()
    finally:
        await conn.close()

    await _broadcast_state(game_id)
    return {"phase": "quiz", "current_question_index": next_index}


@router.post("/games/{game_id}/reveal")
async def reveal_answer(
    game_id: str,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    """Teacher only — reveal the correct answer for the current question."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=403, detail="Not your game.")

    conn = await _db()
    try:
        await conn.execute(
            "UPDATE live_games SET is_answer_revealed = 1 WHERE id = ?", (game_id,)
        )
        await conn.commit()
    finally:
        await conn.close()

    await _broadcast_state(game_id)
    return {"is_answer_revealed": True}


@router.post("/games/{game_id}/end")
async def end_game(
    game_id: str,
    teacher: dict = Depends(get_current_teacher),
) -> dict:
    """Teacher only — force-end the game and show results."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["teacher_id"] != teacher["id"]:
        raise HTTPException(status_code=403, detail="Not your game.")

    conn = await _db()
    try:
        await conn.execute(
            "UPDATE live_games SET phase = 'result' WHERE id = ?", (game_id,)
        )
        await conn.commit()
    finally:
        await conn.close()

    await _broadcast_state(game_id)
    return {"phase": "result"}


@router.post("/games/{game_id}/answer")
async def submit_answer(game_id: str, body: AnswerRequest) -> dict:
    """
    Public — submit a player's answer. Scores by speed (faster = more points).
    choice_index: 0-3 index into the question's choices array. None = no answer.
    """
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")
    if game["phase"] != "quiz":
        raise HTTPException(status_code=400, detail="Game is not in quiz phase.")
    if game["is_answer_revealed"]:
        raise HTTPException(status_code=400, detail="Answer already revealed — too late.")

    # Verify participant belongs to this game
    conn = await _db()
    try:
        cur = await conn.execute(
            "SELECT 1 FROM live_participants WHERE id = ? AND game_id = ?",
            (body.participant_id, game_id),
        )
        if not await cur.fetchone():
            raise HTTPException(status_code=403, detail="Participant not in this game.")

        # Check for duplicate answer on this question
        cur = await conn.execute(
            "SELECT 1 FROM live_answers WHERE game_id = ? AND question_index = ? AND participant_id = ?",
            (game_id, game["current_question_index"], body.participant_id),
        )
        if await cur.fetchone():
            raise HTTPException(status_code=400, detail="Already answered this question.")

        # Determine correctness and score
        questions = json.loads(game.get("questions_json") or "[]")
        q = questions[game["current_question_index"]]
        is_correct = False
        if body.choice_index is not None and 0 <= body.choice_index < len(q["choices"]):
            is_correct = q["choices"][body.choice_index]["is_correct"]

        # Simple scoring: correct = 1000 pts base (no speed bonus for simplicity)
        score = 1000 if is_correct else 0

        answer_id = str(uuid.uuid4())
        now = datetime.utcnow().isoformat()
        await conn.execute(
            """
            INSERT INTO live_answers
                (id, game_id, question_index, participant_id, choice_index, is_correct, score, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                answer_id,
                game_id,
                game["current_question_index"],
                body.participant_id,
                body.choice_index,
                1 if is_correct else 0,
                score,
                now,
            ),
        )
        await conn.commit()
    finally:
        await conn.close()

    # Broadcast updated answer count to host
    answer_count = await _get_answer_count(game_id, game["current_question_index"])
    participant_count = await _get_participant_count(game_id)
    await manager.broadcast(game_id, {
        "type": "answer_submitted",
        "answer_count": answer_count,
        "participant_count": participant_count,
        "question_index": game["current_question_index"],
    })

    # Auto-reveal if everyone has answered
    if participant_count > 0 and answer_count >= participant_count:
        conn = await _db()
        try:
            await conn.execute(
                "UPDATE live_games SET is_answer_revealed = 1 WHERE id = ?", (game_id,)
            )
            await conn.commit()
        finally:
            await conn.close()
        await _broadcast_state(game_id)

    return {"is_correct": is_correct, "score": score}


@router.get("/games/{game_id}/results")
async def get_results(game_id: str) -> dict:
    """Public — return final leaderboard sorted by total score."""
    game = await _get_game(game_id)
    if not game:
        raise HTTPException(status_code=404, detail="Game not found.")

    conn = await _db()
    try:
        cur = await conn.execute(
            """
            SELECT p.id AS participant_id, p.nickname,
                   COALESCE(SUM(a.score), 0) AS total_score,
                   COALESCE(SUM(a.is_correct), 0) AS correct_count
            FROM live_participants p
            LEFT JOIN live_answers a ON a.participant_id = p.id AND a.game_id = ?
            WHERE p.game_id = ?
            GROUP BY p.id, p.nickname
            ORDER BY total_score DESC
            """,
            (game_id, game_id),
        )
        rows = await cur.fetchall()
        leaderboard = [dict(r) for r in rows]

        # Count total questions
        questions = json.loads(game.get("questions_json") or "[]")
    finally:
        await conn.close()

    return {
        "game_id": game_id,
        "quiz_title": game.get("quiz_title", ""),
        "question_count": len(questions),
        "leaderboard": leaderboard,
    }


# ──────────────────────────────────────────────────────────────
# WebSocket endpoint
# ──────────────────────────────────────────────────────────────

@router.websocket("/ws/{game_id}")
async def websocket_endpoint(websocket: WebSocket, game_id: str) -> None:
    """Real-time game state push. Connect once per client and receive broadcasts."""
    game = await _get_game(game_id)
    if not game:
        await websocket.close(code=4004)
        return

    await manager.connect(game_id, websocket)

    # Immediately send current state to the newly connected client
    try:
        questions = json.loads(game.get("questions_json") or "[]")
        participant_count = await _get_participant_count(game_id)
        answer_count = await _get_answer_count(game_id, game["current_question_index"])
        await websocket.send_json({
            "type": "game_state",
            "game_id": game_id,
            "phase": game["phase"],
            "current_question_index": game["current_question_index"],
            "question_count": len(questions),
            "is_answer_revealed": bool(game["is_answer_revealed"]),
            "participant_count": participant_count,
            "answer_count": answer_count,
        })
    except Exception:
        pass

    try:
        while True:
            # Keep connection alive — ignore any text from client
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(game_id, websocket)
