# OptiLearn — API Test Commands

All commands below assume the server is running at `http://localhost:8000`.
Replace `STUDENT_ID` and `SESSION_ID` with the values returned by previous commands.

---

## 1. Create a Student

```bash
curl -s -X POST http://localhost:8000/api/students \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Amina",
    "age": 10,
    "language": "ar",
    "grade_level": 3
  }' | python3 -m json.tool
```

**Expected response:**
```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "name": "Amina",
  "age": 10,
  "language": "ar",
  "grade_level": 3,
  "created_at": "2025-01-01T10:00:00",
  "last_active": null
}
```

---

## 2. List All Students

```bash
curl -s http://localhost:8000/api/students | python3 -m json.tool
```

**Expected response:**
```json
[
  {
    "id": "550e8400-...",
    "name": "Amina",
    "mastery_summary": []
  }
]
```

---

## 3. Get a Single Student

```bash
STUDENT_ID="550e8400-e29b-41d4-a716-446655440000"

curl -s http://localhost:8000/api/students/$STUDENT_ID | python3 -m json.tool
```

**Expected response:**
```json
{
  "id": "550e8400-...",
  "name": "Amina",
  "topic_mastery": []
}
```

Returns `404` if student not found.

---

## 4. Start a Session

```bash
STUDENT_ID="550e8400-e29b-41d4-a716-446655440000"

curl -s -X POST http://localhost:8000/api/sessions \
  -H "Content-Type: application/json" \
  -d "{\"student_id\": \"$STUDENT_ID\"}" | python3 -m json.tool
```

**Expected response:**
```json
{
  "id": "660f9500-...",
  "student_id": "550e8400-...",
  "started_at": "2025-01-01T10:05:00",
  "ended_at": null,
  "message_count": 0,
  "topics_covered": "[]"
}
```

---

## 5. Send a Chat Message (Text Only)

```bash
STUDENT_ID="550e8400-e29b-41d4-a716-446655440000"
SESSION_ID="660f9500-..."

curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"student_id\": \"$STUDENT_ID\",
    \"session_id\": \"$SESSION_ID\",
    \"message\": \"What is a fraction?\",
    \"image_b64\": null
  }"
```

**Expected response (SSE stream):**
```
data: {"type": "tool_start", "tool": "retrieve_curriculum"}

data: {"type": "tool_done", "tool": "retrieve_curriculum", "result": [...]}

data: {"type": "token", "content": "A "}

data: {"type": "token", "content": "fraction "}

data: {"type": "done"}
```

---

## 6. Upload a Textbook Image

```bash
# Use any JPEG or PNG image file
curl -s -X POST http://localhost:8000/api/upload-image \
  -F "file=@/path/to/textbook_page.jpg" | python3 -m json.tool
```

**Expected response:**
```json
{
  "image_b64": "/9j/4AAQSkZJRgABAQAA..."
}
```

Returns `413` if file exceeds 10 MB.

---

## 7. Send a Chat Message with Image

```bash
STUDENT_ID="550e8400-e29b-41d4-a716-446655440000"
SESSION_ID="660f9500-..."
IMAGE_B64="$(curl -s -X POST http://localhost:8000/api/upload-image -F 'file=@/path/to/page.jpg' | python3 -c 'import sys,json; print(json.load(sys.stdin)["image_b64"])')"

curl -s -X POST http://localhost:8000/api/chat \
  -H "Content-Type: application/json" \
  -d "{
    \"student_id\": \"$STUDENT_ID\",
    \"session_id\": \"$SESSION_ID\",
    \"message\": \"Can you explain what is on this page?\",
    \"image_b64\": \"$IMAGE_B64\"
  }"
```

**Expected response:** SSE stream as in step 5, but the model will also describe the image content.

---

## 8. Submit Quiz Answers

```bash
STUDENT_ID="550e8400-e29b-41d4-a716-446655440000"
SESSION_ID="660f9500-..."

curl -s -X POST http://localhost:8000/api/quiz/submit \
  -H "Content-Type: application/json" \
  -d "{
    \"student_id\": \"$STUDENT_ID\",
    \"session_id\": \"$SESSION_ID\",
    \"topic\": \"fractions\",
    \"answers\": [
      {
        \"question_id\": \"q-uuid-1\",
        \"answer\": \"The numerator\",
        \"correct_answer\": \"The numerator\"
      },
      {
        \"question_id\": \"q-uuid-2\",
        \"answer\": \"4\",
        \"correct_answer\": \"8\"
      }
    ]
  }" | python3 -m json.tool
```

**Expected response:**
```json
{
  "score": 0.5,
  "new_level": "beginner",
  "mastery": 0.15,
  "results": [
    {
      "question_id": "q-uuid-1",
      "student_answer": "The numerator",
      "correct_answer": "The numerator",
      "correct": true
    },
    {
      "question_id": "q-uuid-2",
      "student_answer": "4",
      "correct_answer": "8",
      "correct": false
    }
  ]
}
```

---

## 9. Get Dashboard Data

```bash
curl -s http://localhost:8000/api/dashboard | python3 -m json.tool
```

**Expected response:**
```json
{
  "students": [...],
  "total_sessions": 3,
  "topics_by_struggle": [
    {
      "topic": "fractions",
      "avg_mastery": 0.15,
      "student_count": 2
    }
  ]
}
```

---

## Notes

- The chat endpoint (`/api/chat`) returns a **Server-Sent Events stream**. Each line starting with `data:` is one JSON event.
- Use `curl --no-buffer` for better SSE streaming output in the terminal.
- All UUIDs in examples above are illustrative. Use the actual UUIDs returned by your API calls.
