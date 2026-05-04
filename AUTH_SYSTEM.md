# OptiLearn — Authentication System Build

## WHO YOU ARE BUILDING FOR

OptiLearn is an offline-first multilingual AI tutoring platform for refugee
classrooms. It runs on a teacher's laptop as a local server. Students connect
via browser over a WiFi hotspot. There is no cloud, no external auth service,
and no internet dependency for authentication. Everything must work fully
offline.

Read the entire existing codebase before writing a single line. Understand
what exists, what the DB schema looks like, what the frontend structure is,
and how the backend is organised. Then plan your approach and execute it.

You have full authority to make design decisions. Think carefully about
edge cases — this auth system will be used by refugee children with low
digital literacy and volunteer teachers in resource-constrained environments.
Simplicity and reliability matter more than sophistication.

---

## CONTEXT: CURRENT SYSTEM STATE

The current system has NO authentication. Students are created via a form
that takes name, age, language, and grade level. The student UUID is stored
in localStorage. Teachers access the dashboard at /teacher with no login.

You need to:
1. Add a proper auth layer without breaking any existing features
2. Safely migrate existing student data (ask before deleting, offer export)
3. Be thoughtful about session management — localStorage tokens, not cookies,
   because this is a browser-based app over a local network

---

## PART 1 — DATABASE CHANGES

Add these tables. Use ALTER TABLE for additive changes to existing tables.
Wrap all migrations in try/except so they are safe to run on existing DBs.

```sql
CREATE TABLE IF NOT EXISTS teachers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,          -- bcrypt hash, never store plaintext
  display_name TEXT,
  is_admin INTEGER DEFAULT 0,           -- 1 = admin, 0 = normal teacher
  original_password_hash TEXT,          -- admin-set initial hash, never updated by teacher
  created_by TEXT,                      -- teacher id who created this account
  created_at TEXT DEFAULT (datetime('now')),
  last_login TEXT,
  is_active INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS teacher_sessions (
  token TEXT PRIMARY KEY,               -- 64-char random hex token
  teacher_id TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT NOT NULL,             -- 8 hours from creation
  FOREIGN KEY (teacher_id) REFERENCES teachers(id)
);
```

Add to students table (ALTER TABLE, safe to run on existing data):
  ALTER TABLE students ADD COLUMN username TEXT
  ALTER TABLE students ADD COLUMN password_hash TEXT  -- bcrypt of 4-digit pin
  ALTER TABLE students ADD COLUMN pin_visible TEXT    -- plaintext pin for admin recovery
  ALTER TABLE students ADD COLUMN is_registered INTEGER DEFAULT 0

The pin_visible column stores the plain 4-digit pin for admin student password
recovery. This is intentional — refugee children forget pins frequently and
teachers need a way to help them. Do not hash it away.

---

## PART 2 — AUTH BACKEND

Install: pip install bcrypt python-jose

Create: optilearn/app/api/routes/auth.py

### 2.1 Teacher auth routes

POST /api/auth/teacher/login
  Body: {username: str, password: str}
  - Find teacher by username (case-insensitive)
  - Verify bcrypt hash
  - Create teacher_session token (64-char hex, expires 8 hours)
  - Update teachers.last_login
  - Return: {token, teacher_id, display_name, is_admin, username}
  - On failure: return 401 with message "Incorrect username or password"
    Never say which field is wrong — security best practice

POST /api/auth/teacher/logout
  Header: Authorization: Bearer {token}
  - Delete the teacher_session row
  - Return: {success: true}

GET /api/auth/teacher/me
  Header: Authorization: Bearer {token}
  - Validate token, check not expired
  - Return teacher profile: {teacher_id, username, display_name, is_admin}
  - On invalid/expired: 401

POST /api/auth/teacher/change-password
  Header: Authorization: Bearer {token}
  Body: {current_password: str, new_password: str, confirm_password: str}
  - Verify current_password against password_hash
  - Verify new_password === confirm_password
  - Enforce: min 6 chars, no maximum
  - Hash new password with bcrypt
  - Update password_hash (NOT original_password_hash — that stays as admin set it)
  - Invalidate all other sessions for this teacher
  - Return: {success: true}

### 2.2 Admin-only teacher management routes

All routes below require is_admin=1. Return 403 if called by non-admin.

GET /api/auth/admin/teachers
  - List all teachers
  - Include: id, username, display_name, is_admin, created_at, last_login
  - Include: original_password (decoded from original_password_hash — plaintext)
    Wait — original_password_hash is a bcrypt hash, you cannot reverse it.
    Instead: store the original plaintext password in a separate column
    `initial_password TEXT` (not hashed). This is the admin-visible password.
    The actual auth uses password_hash (bcrypt). When teacher changes their
    password, password_hash updates but initial_password stays as the original.
    Admin sees initial_password. Teacher can change their own password_hash
    but admin never sees the updated one — only the original they set.

POST /api/auth/admin/teachers
  Body: {username: str, password: str, display_name: str, is_admin: bool}
  - Validate username is unique
  - bcrypt hash the password → password_hash
  - Store plaintext password → initial_password
  - Create teacher row
  - Return: {teacher_id, username, display_name, is_admin}

PUT /api/auth/admin/teachers/{teacher_id}
  Body: {display_name?: str, is_admin?: bool}
  - Update allowed fields only
  - Admin cannot change another admin's password via this route
  - Return: updated teacher

POST /api/auth/admin/teachers/{teacher_id}/reset-password
  Body: {new_password: str}
  - Admin resets a teacher's password
  - Updates both password_hash AND initial_password
  - Invalidates all sessions for that teacher
  - Return: {success: true, new_password: new_password}
    (admin sees it plaintext so they can share it with the teacher)

DELETE /api/auth/admin/teachers/{teacher_id}
  - Soft delete: set is_active=0
  - Cannot delete own account
  - Cannot delete last admin account

### 2.3 Student auth routes

POST /api/auth/student/signup
  Body: {name: str, username: str, pin: str, age: int, language: str, grade_level: str}
  - Validate: username unique across students, pin is exactly 4 digits
  - Create student row (name, age, language, grade_level from existing schema)
  - Set username, pin_visible=pin, password_hash=bcrypt(pin), is_registered=1
  - Return: {student_id, name, username}

POST /api/auth/student/login
  Body: {username: str, pin: str}
  - Find student by username (case-insensitive)
  - Verify bcrypt(pin) against password_hash
  - Return: {student_id, name, language, grade_level, age}
  - Store student_id in frontend localStorage (existing pattern)
  - On failure: "Incorrect username or PIN"

GET /api/auth/admin/students
  Admin-only. Returns all students with: id, name, username, pin_visible,
  age, language, grade_level, created_at, last_active

### 2.4 Auth middleware

Create a dependency: get_current_teacher(token: str = Header(...))
  - Reads Authorization: Bearer {token} header
  - Validates against teacher_sessions table
  - Returns teacher row or raises 401
  - Use this dependency on ALL /api/teacher/* routes
  - Use an is_admin dependency on all /api/auth/admin/* routes

Create a first-run check: GET /api/auth/setup-required
  - Returns {setup_required: true} if teachers table has zero rows
  - Returns {setup_required: false} if at least one teacher exists
  - No auth required on this route
  - Used by frontend to show setup screen vs login screen

POST /api/auth/setup (first-run only)
  Body: {username: str, password: str, display_name: str}
  - Only works if teachers table has zero rows, returns 403 otherwise
  - Creates the first admin teacher account
  - Returns teacher token immediately (user is logged in after setup)

---

## PART 3 — GRADE LEVEL SYSTEM

Replace the current numeric age/grade system with the US grade system
everywhere in the codebase.

Valid grade levels (use these exact strings throughout):
  "Pre-K", "K", "1st", "2nd", "3rd", "4th", "5th", "6th",
  "7th", "8th", "9th", "10th", "11th", "12th"

Age is inferred from grade level — do not ask users for age separately.
Use this mapping:

  Pre-K → age 4-5 → store as age=4
  K     → age 5-6 → store as age=5
  1st   → age 6-7 → store as age=6
  2nd   → age 7-8 → store as age=7
  3rd   → age 8-9 → store as age=8
  4th   → age 9-10 → store as age=9
  5th   → age 10-11 → store as age=10
  6th   → age 11-12 → store as age=11
  7th   → age 12-13 → store as age=12
  8th   → age 13-14 → store as age=13
  9th   → age 14-15 → store as age=14
  10th  → age 15-16 → store as age=15
  11th  → age 16-17 → store as age=16
  12th  → age 17-18 → store as age=17

When creating a student, the form shows a grade level dropdown.
Age is automatically set from the mapping — no age input field.
Everywhere the system uses age (AI prompts, mastery, etc.) use the
inferred age value. The students table still stores both grade_level
(string) and age (int) for backward compatibility with AI prompts.

Update all existing students in the DB:
  For students with no grade_level set, default to "7th" (age=12).
  This is a reasonable default for refugee classroom contexts.

---

## PART 4 — DATA MIGRATION

Existing students have no username or PIN. Handle this carefully:

Step 1: Before making any changes, export existing students to a JSON
backup file: data/student_backup_{timestamp}.json
Print the path of this backup file clearly in the console.

Step 2: For existing students without username, set:
  username = name.lower().replace(" ", "_") + "_" + id[:4]
  pin_visible = "1234"
  password_hash = bcrypt("1234")
  is_registered = 1

Step 3: Print a summary: "Migrated X existing students. Default PIN: 1234.
Teachers should ask students to update their PIN on first login."

Do NOT delete any existing student data. Migration only adds fields.

---

## PART 5 — FRONTEND AUTH FLOW

### 5.1 Sign In / Sign Up page — first screen everyone sees

Route: / (root, replaces the current student home screen)

This page is the single entry point for everyone. It must:
  - Match the OptiLearn UI: white background, #2a8dbf primary, #dadce0 borders,
    @phosphor-icons/react icons, same card radius (12px), same font
  - Show the OptiLearn logo/name prominently at the top
  - Have two tabs: "Sign In" and "Sign Up"
  - Sign Up tab is ONLY for students (teachers are created by admin)

Sign In tab:
  Username input (placeholder: "Username")
  Password/PIN input (placeholder: "Password or PIN", type=password)
  "Sign In" button (full width, primary blue)
  
  On submit:
    First try teacher login: POST /api/auth/teacher/login
    If 200: store token in localStorage as "teacher_token", redirect to /teacher
    If 401: try student login: POST /api/auth/student/login
    If 200: store student_id in localStorage as "student_id", redirect to /student/{id}
    If both fail: show "Incorrect username or password. Please try again."
    Use a single error message — never reveal which table was checked

Sign Up tab (students only):
  Full Name input
  Username input (placeholder: "Choose a username")
    Show availability check after 500ms debounce: green checkmark if available
  Grade Level dropdown (Pre-K through 12th)
  Language dropdown (same as feature1 languages)
  PIN input (exactly 4 digits, type=number, maxLength=4)
  Confirm PIN input
  "Create Account" button

  On submit:
    POST /api/auth/student/signup
    On success: auto-login, redirect to /student/{id}
    Show friendly validation errors inline (not alert dialogs)

Design notes:
  - Make it warm and approachable — refugee children with low literacy
  - Large touch targets (min 44px height) for tablet/phone use
  - The username field hint: "Use your name or a nickname — keep it simple"
  - The PIN hint: "Choose 4 numbers you will remember"
  - Avoid any language that implies failure or rejection

### 5.2 Teacher Setup Screen (first run only)

Route: /setup

Check /api/auth/setup-required on app mount. If true, redirect to /setup.
If false and no auth token, redirect to /.

The setup screen creates the first admin teacher account:
  OptiLearn logo at top
  "Welcome to OptiLearn" heading
  "Create your admin teacher account to get started."
  
  Display Name input (e.g. "Ms. Fatima")
  Username input
  Password input
  Confirm Password input
  
  "Create Admin Account" button
  
  On success: redirect to /teacher (already logged in)

This screen is only accessible when zero teachers exist. After that,
navigating to /setup redirects to /.

### 5.3 Teacher Dashboard Auth

All teacher routes check for teacher_token in localStorage.
If missing or expired (/api/auth/teacher/me returns 401): redirect to /.

Add a header bar to the teacher dashboard showing:
  Left: teacher display_name
  Right: "Change Password" link + "Sign Out" button

Change Password modal:
  Current password
  New password
  Confirm new password
  Submit button
  All fields required. Show validation errors inline.

### 5.4 Admin Section in Teacher Dashboard

Add a new "Manage Teachers" tab in the teacher dashboard.
Only visible if the logged-in teacher is_admin=1. Hidden entirely for
non-admin teachers — not greyed out, just not rendered.

Manage Teachers tab shows:
  Table of all teachers: Display Name, Username, Initial Password, Role, Last Login, Actions
  "Initial Password" column shows the password the admin originally set.
    Include a copy button and an eye icon to show/hide.
  Actions: [Reset Password] [Make Admin / Remove Admin] [Deactivate]
  "Add Teacher" button opens a form:
    Display Name, Username, Password (auto-generate or manual), Is Admin toggle
    After creation: show the username and password clearly with a copy button
    "Share these details with the teacher to let them sign in."

Admin Student Management section (below teacher management):
  Table of all students: Name, Username, PIN, Grade, Language, Last Active
  PIN column is visible (plaintext from pin_visible column)
  "Reset PIN" action: sets a new 4-digit PIN (admin chooses or generates random)

### 5.5 Student LMS Auth

All student routes check for student_id in localStorage.
If missing: redirect to /.

Students cannot access /teacher or any /api/teacher/* routes.
Add a "Sign Out" option in the student sidebar that clears localStorage
and redirects to /.

### 5.6 Route Protection

Implement protected routes in React:
  TeacherRoute: checks localStorage.teacher_token, validates with /api/auth/teacher/me
  StudentRoute: checks localStorage.student_id
  AdminRoute: checks teacher_token AND is_admin=1
  SetupRoute: only accessible if setup_required=true

On token expiry (8 hours): clear localStorage, show "Session expired. Please
sign in again." at the login page, then show the sign-in form.

---

## PART 6 — MASTER LANGUAGE LOCK

The master language setting in /api/teacher/settings should only be
modifiable by admin teachers. Add an is_admin check to the
POST /api/teacher/settings route. Return 403 for non-admin teachers.

In the teacher dashboard UI, the master language dropdown:
  - Show to all teachers (so they can see the current setting)
  - Disable the dropdown with a tooltip "Only admin teachers can change
    this setting" for non-admin teachers
  - Fully editable for admin teachers as before

---

## PART 7 — SELF-CORRECTION RULES

After every Python file change:
  python -c "import ast; ast.parse(open('FILEPATH', encoding='utf-8').read()); print('SYNTAX OK')"

After every backend route addition:
  cd optilearn && timeout 6 python -m uvicorn app.main:app --port 8001 2>&1 | tail -8
  Server must start cleanly with no import errors.

After every frontend change:
  cd optilearn/frontend && npm run build 2>&1 | tail -5
  Build must pass with no errors.

Never proceed past a failing check. Fix it first.

---

## PART 8 — VERIFICATION TESTS

Run in order after build completes:

Test 1 — Setup required on fresh start:
  curl -s http://localhost:8000/api/auth/setup-required | python -m json.tool
  Expected: {setup_required: true} (if no teachers) or false

Test 2 — Create first admin:
  curl -s -X POST http://localhost:8000/api/auth/setup \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123","display_name":"Admin Teacher"}' \
    | python -m json.tool
  Expected: token returned

Test 3 — Teacher login:
  curl -s -X POST http://localhost:8000/api/auth/teacher/login \
    -H "Content-Type: application/json" \
    -d '{"username":"admin","password":"admin123"}' | python -m json.tool
  Expected: token, is_admin=true

Test 4 — Student signup:
  curl -s -X POST http://localhost:8000/api/auth/student/signup \
    -H "Content-Type: application/json" \
    -d '{"name":"Fatima","username":"fatima01","pin":"1234","language":"ar","grade_level":"5th"}' \
    | python -m json.tool
  Expected: student_id returned

Test 5 — Student login:
  curl -s -X POST http://localhost:8000/api/auth/student/login \
    -H "Content-Type: application/json" \
    -d '{"username":"fatima01","pin":"1234"}' | python -m json.tool
  Expected: student_id, name, grade_level="5th"

Test 6 — Teacher route protection:
  curl -s http://localhost:8000/api/teacher/students | python -m json.tool
  Expected: 401 (no token provided)

Test 7 — Browser flow:
  Open http://localhost:8000
  Confirm sign-in page loads (not the old student home)
  Sign up as a new student, confirm redirect to student LMS
  Sign out, sign in as admin teacher, confirm redirect to teacher dashboard
  Confirm "Manage Teachers" tab visible in teacher dashboard

---

## IMPORTANT CONSTRAINTS

  Do not break any existing API routes — only ADD auth protection to
  teacher routes. Student data routes (/api/students/*) remain accessible
  to authenticated students.

  Do not delete any existing student data. Migration is additive only.

  Passwords and PINs: use bcrypt for all hashing. Never store plaintext
  passwords except in initial_password (teacher, admin-visible only) and
  pin_visible (student, admin-visible only). These are intentional product
  decisions for a low-literacy, offline refugee environment.

  Token storage: localStorage only. No cookies. This is a local network
  app, not a public web app. The security model is appropriate for the
  deployment context.

  The desktop app experience and LAN data transfer features are not yet
  fully designed. Do not make decisions that would complicate adding
  Electron/PyWebView or LAN sync later. Keep the auth layer as a clean
  FastAPI middleware dependency that can be extended.

  Think carefully about what happens when a student forgets their PIN and
  approaches a teacher who is not the admin. Design the non-admin teacher
  experience for this case — they should be able to see basic student info
  but not the PIN. Only admin can see PINs. Consider surfacing a helpful
  message directing the student to the admin teacher.

---

## SESSION END

Print when done:

=== AUTH SYSTEM COMPLETE ===
Tables created: [list]
Routes added: [list]
Existing students migrated: [count]
Backup file: [path]
Grade system updated: [yes/no]
Setup screen: [working/failed]
Sign-in page: [working/failed]
Teacher dashboard protected: [yes/no]
Admin section: [working/failed]
Build: [passed/failed]
=== END ===
