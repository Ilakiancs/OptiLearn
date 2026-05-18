# CONTENT.md
# OptiLearn Landing Page Content
#
# This file contains all copy for the OptiLearn landing page.
# Sections are labeled clearly for the web designer to map to layout components.
#
# ===========================================================================


# ============================================================
# SECTION: Navigation Bar
# ============================================================

Logo text: OptiLearn
Tagline: Education for Every Classroom

Nav links:
- Problem
- Features
- How It Works
- Technology
- Open Source

CTA Button: Get OptiLearn Free
Secondary link: Read the Research


# ============================================================
# SECTION: Hero
# ============================================================

Headline:
Quality Education, Offline, in Any Language

Subheadline:
OptiLearn is a free, open-source learning management system built for refugee and underserved classrooms. One $100 laptop. One $15 router. A full AI-powered school for an entire class.

Body:
Over 123 million people are forcibly displaced worldwide. Nearly half of them are children, and most have lost consistent access to education. OptiLearn runs entirely on local hardware, works without internet, and teaches in over 30 languages. It was built by students, for students.

Primary CTA: Download OptiLearn
Secondary CTA: Watch the Demo

Supporting badge row:
- Free and Open Source
- Offline First
- 30+ Languages
- Runs on $100 Hardware
- Gemma 4 Powered


# ============================================================
# SECTION: Problem Statement
# ============================================================

Section label: The Problem

Headline:
Standard edtech was not built for this.

Body paragraph 1:
At the end of 2024, 123 million people were forcibly displaced globally. Among them, 49 million were children under 18. The number has been climbing every year, driven by conflict, climate disasters, and regional instability. For most of these children, school is one of the few stable structures left in their lives, and the classrooms they attend bear no resemblance to what education software expects.

Body paragraph 2:
A British Council survey of 24 refugee-impacted schools in Uganda documented learners speaking up to 51 different languages. Two-thirds of observed lessons required instruction in more than one language. Nearly a third of teachers could not speak any language their students used at home. The average pupil-to-teacher ratio in displacement settings is 1 to 85, dropping as low as 1 to 130 in lower grades. Eighty-five percent of teachers in many camp schools are volunteers with no formal qualifications.

Body paragraph 3:
UNICEF and UNHCR data show that between 10% and 33% of displaced children show clinical signs of depression. Among unaccompanied youth, PTSD rates reach as high as 85%. These children are not failing school. School, as it was designed, is failing them.

Body paragraph 4:
The UNHCR and World Bank estimate the average unit cost of refugee education at $1,051 per student per year. That figure reflects an already constrained system with no AI support, no adaptive feedback, and no multilingual personalization. Most edtech products require reliable broadband and a uniform language of instruction. Neither exists in a camp.

Stat callouts (for visual display):
- 123M people forcibly displaced globally (end of 2024)
- 49M of them are children
- 1:85 average pupil-to-teacher ratio in camps
- 51 languages documented in a single refugee school district
- 85% of camp teachers are unqualified volunteers
- $1,051 average annual cost per refugee student (UNHCR/World Bank)
- OptiLearn: under $200 per student


# ============================================================
# SECTION: Solution Overview
# ============================================================

Section label: The Solution

Headline:
One laptop. One router. A school that works.

Body:
OptiLearn is an offline-first adaptive LMS powered by a fine-tuned Gemma 4 model. The teacher's laptop runs the server. Students connect from any phone, tablet, or computer. All AI features, the tutor, the live translator, the quizzes, the voice reader, run locally with no internet required. When connectivity is available, the system upgrades automatically to the larger Gemma 4 26B model for more complex tasks, then falls back to the local model without interrupting anyone.

The system was designed around three core pillars.


# ============================================================
# SECTION: Three Pillars
# ============================================================

Pillar 1:
Title: Translate and Learn
Description: Students upload any textbook page, photograph, or PDF in any language. The fine-tuned Gemma 4 model generates a conceptual translation, not a word-for-word substitution, into the student's native language. An AI tutor then summarizes the material, asks checking questions in the Socratic style, and recommends related topics. Text-to-speech reads every response aloud using offline voice models covering Arabic, Swahili, Somali, Dari, French, Amharic, and more. Sessions are saved, searchable, and downloadable as PDFs.

Pillar 2:
Title: AI Tutor
Description: Every student gets a personal AI tutor adapted to their mastery level. The tutor tracks understanding topic by topic using exponential moving average scoring, with four levels from novice through advanced. As a student's grasp of a topic grows, the tutor adjusts the depth and complexity of explanations accordingly. The system never shows grades publicly, never ranks students against each other, and never uses words like "wrong" or "failed." Progress is communicated as private milestones and encouragement.

Pillar 3:
Title: Live Class Translator
Description: As the teacher speaks, OptiLearn transcribes and translates in real time. Each student sees the lesson in their chosen language as the words arrive. When class ends, the system generates a structured transcript and downloadable study notes automatically. No teacher action is required. Students who missed a session access the full transcript from their history.


# ============================================================
# SECTION: Features
# ============================================================

Section label: Features

Headline:
Everything a school needs. Nothing a school needs to pay for.

Feature list (for card or grid layout):

1. Title: AI Tutor
   Description: A personal adaptive tutor for every student. Responds using the Socratic method, adjusts explanation depth to the student's mastery level, and never shows discouraging feedback. Supports text and uploaded images.

2. Title: Translate and Learn
   Description: Upload any document or photograph of a textbook page. The system translates the content conceptually into the student's language and generates a full lesson summary with follow-up questions.

3. Title: Live Class Translator
   Description: Real-time speech transcription and per-student translation during lessons. No lag. No internet. No extra hardware beyond a microphone.

4. Title: Text-to-Speech
   Description: Every AI response is readable aloud in over 30 offline voice models via Piper TTS. Students with lower literacy levels follow along by ear. Voice speed and language adjust to the student's profile.

5. Title: Student Dashboard
   Description: Each student sees their mastery levels across topics, recent session history, course progress, and assigned quizzes in one view. Private. No peer comparisons.

6. Title: Courses and Curriculum
   Description: Subject-organized learning content retrieved semantically via FAISS vector search. The tutor draws on relevant curriculum passages automatically based on what the student is studying.

7. Title: Assignments
   Description: Teachers assign quizzes to all students or to specific individuals. Students see their assigned work in the Assignments tab. Completion is tracked and reported to the teacher dashboard.

8. Title: Mastery Tracking
   Description: Student understanding is tracked per topic using exponential moving average scoring (new = 0.7 x old + 0.3 x score). Four levels: novice, developing, proficient, advanced. Progress persists across sessions.

9. Title: Results and Progress Reports
   Description: The system generates a three-paragraph AI progress report for each student, streamed live as the model writes it. Reports are cached, downloadable as PDFs, and updated as new data comes in.

10. Title: Live Quiz
    Description: Teachers run real-time collaborative quizzes from the dashboard. Questions broadcast to all connected student devices via WebSocket. Answers are collected and scored live. Results appear on the teacher's screen as students respond.

11. Title: Quiz Builder
    Description: Teachers create custom quizzes with any number of questions, attach them to a subject, and assign them to all students or specific ones. The quiz builder is entirely in-browser with no file uploads required.

12. Title: AI Avatar Tutor
    Description: Students choose a named AI persona as their tutor. The avatar has a distinct visual character and a voice. Conversations feel personal. The same Gemma 4 model powers the avatar, with a persona-specific system prompt.

13. Title: Teacher Dashboard
    Description: Aggregated view of every student's progress, mastery heatmap, recent quiz performance, session activity, and inactivity alerts. Refreshes every 10 seconds without a page reload.

14. Title: Teacher AI Assistant
    Description: Teachers ask the AI anything about their students, the curriculum, or the platform. Answers draw on stored student data and available curriculum content.

15. Title: Upload Material
    Description: Teachers upload PDFs that are extracted with PyMuPDF and indexed into the FAISS curriculum store. Students access the material through the AI tutor and Translate and Learn features.

16. Title: Calendar and Schedule
    Description: Scheduled classes appear in a calendar view for students and teachers. Session history is linked to calendar entries so students revisit a past class directly from the schedule.

17. Title: Student Inactivity Alerts
    Description: When a student stops responding, the teacher dashboard shows an alert. Designed for safeguarding: a teacher can check in with a child who may be struggling outside the classroom.

18. Title: Connect Students over LAN
    Description: Students connect from any device on the classroom WiFi. mDNS announces the server at optilearn.local automatically. A captive portal redirects new devices to OptiLearn the moment they join. A QR code makes enrollment instant.

19. Title: Hybrid Online and Offline AI
    Description: The system runs Gemma 4 E2B locally via Ollama when offline. When internet is detected and latency is below the configured threshold, inference upgrades to Gemma 4 26B through the Gemini API to handle more complex tasks for students in higher grades. Online mode also supports hyper-realistic AI Avatars for a more human experience.

20. Title: Accounts and Login
    Description: Teachers log in with username and password (8-hour JWT sessions, bcrypt hashed). Students log in with a PIN (30-day sessions). No email addresses. No data sent outside the classroom server.

21. Title: Student Data Export and Import
    Description: Each student's full record, including session history, mastery progress, quiz results, and profile, is exportable as an encrypted ZIP file. Students carry their data between classrooms and import it on any OptiLearn installation.

22. Title: Admin User Management
    Description: Administrators create, edit, and deactivate teacher accounts. Admin privileges grant access to system diagnostics, student PIN resets, and the master language toggle.

23. Title: Admin Diagnostics
    Description: A system health dashboard shows Ollama status, database connectivity, FAISS index health, active model name, connected devices, AI request latency, and cache statistics.

24. Title: Report Generation
    Description: AI-generated student reports stream in real time. Completed reports are cached and re-used until new session data arrives. All reports export as multilingual PDFs with correct glyph rendering for Arabic, Amharic, Sinhala, Tamil, and other non-Latin scripts.

25. Title: PDF Download
    Description: Study notes, translated lessons, transcripts, and progress reports are all downloadable as PDFs. On the desktop app, downloads go directly to the user's Downloads folder via a Python bridge that bypasses WebView sandbox restrictions.

26. Title: Trauma-Aware UI
    Description: No discouraging language appears anywhere in the interface or in any AI response. No public rankings. No visible failure states. The palette, typography, and content tone follow trauma-informed design principles throughout.

27. Title: Desktop App
    Description: OptiLearn ships as a native desktop application for Windows (.exe) and macOS (.app) built with PyWebView. Single-instance mutex prevents multiple server processes. The launcher manages HTTP and HTTPS servers automatically.

28. Title: Progressive Web App
    Description: Students and teachers install OptiLearn directly to their home screen from any browser. Workbox caches the frontend for offline use. The install prompt appears automatically without app store involvement.

29. Title: Session History
    Description: Every AI tutor conversation is saved and organized by session. Students browse past conversations, continue where they left off, and access downloadable notes from any session.

30. Title: Dyslexia-Friendly Fonts
    Description: Accessibility font options are available in user settings. The interface supports larger text sizes, high-contrast modes, and font choices designed to improve readability for students with dyslexia.

31. Title: HTTPS and Microphone Access
    Description: Self-signed TLS certificates are generated at startup, covering every detected LAN IP address. This enables browser microphone access on all student devices for live translation without external certificate authorities or manual configuration.

32. Title: Network QR Code and Captive Portal
    Description: The teacher's screen displays a QR code linking students directly to OptiLearn. A DNS-based captive portal ensures any new device joining the classroom WiFi is automatically redirected to the platform.

33. Title: Offline Whisper Speech Recognition
    Description: The live translation pipeline transcribes speech using an offline Whisper ASR model. No audio is sent to external servers. The model runs locally on the teacher's laptop for every lesson.

34. Title: AI-Generated Class Notes
    Description: After each live class session, the system compiles the full translated transcript and generates structured study notes organized by concept. Notes are formatted with headings, bullet points, and a summary section, then made available for download.

## Future Implementation
-   Master Language Toggle
    Description: Administrators switch the entire interface, including all labels, navigation, and system messages, between English and the host country's primary language. This allows schools to integrate students into local communities without disrupting their learning.


# ============================================================
# SECTION: How It Works
# ============================================================

Section label: How It Works

Headline:
Set up in minutes. Run for years.

Step 1:
Title: Install on the Teacher's Laptop
Description: Download OptiLearn and run the setup script. It installs the AI model, builds the curriculum index, and configures the server. On Windows, double-click OptiLearn.bat. The first launch takes a few minutes. Every launch after that takes seconds.

Step 2:
Title: Connect the Classroom
Description: Enable a WiFi hotspot on the teacher's laptop or plug in a $15 travel router. Students connect from any device. OptiLearn announces itself on the network and a QR code on the teacher's screen gets every student connected in under a minute.

Step 3:
Title: Students Log In with a PIN
Description: The teacher creates student accounts from the dashboard. Each student gets a PIN. They enter it once and stay logged in for 30 days. No email. No password. No app to install.

Step 4:
Title: Learning Begins
Description: Students open the AI Tutor, upload material to Translate and Learn, join a Live Quiz, or follow the day's lesson in their language through Live Class. The teacher watches the dashboard, runs quizzes, and checks progress in real time.

Step 5:
Title: Everything Is Saved
Description: Session history, progress data, quiz results, and downloaded notes persist on the teacher's laptop. Student records export as encrypted files and import onto any other OptiLearn installation. Nothing is lost when the class ends.


# ============================================================
# SECTION: Technology
# ============================================================

Section label: Technology

Headline:
Serious engineering for serious constraints.

Body:
OptiLearn is not a wrapped chatbot. It is a full production system built around the specific operational realities of offline classrooms: unreliable hardware, multilingual input, low-literacy users, and zero tolerance for data loss.

The AI pipeline runs Gemma 4 E2B locally through Ollama. The model was fine-tuned with Unsloth using LoRA on 11,500 training examples covering Socratic tutoring patterns, multilingual explanation styles, and trauma-informed feedback language. Fine-tuning ran on a GCP A100. Weights are published on HuggingFace under an open license.

Curriculum retrieval uses FAISS with multilingual MiniLM-L12 sentence embeddings. The system searches semantically across curriculum passages matched to the student's grade level and topic, without any internet call.

Text-to-speech uses Piper TTS with locally stored ONNX voice models for over 30 languages. Speech recognition for live translation uses an offline Whisper model. Nothing related to audio is transmitted externally.

The backend is FastAPI with 12 route modules, SQLite for storage, and aiosqlite for async database access. The frontend is React 18 with Vite, served as a PWA with Workbox offline caching. The desktop launcher is PyWebView, with a Python JavaScript bridge for operations the WebView sandbox prevents.

The network stack includes mDNS via zeroconf, a captive portal DNS server via dnslib, and self-signed TLS certificates generated at startup via the Python cryptography library, covering all detected LAN IP addresses dynamically.

Technology summary (for grid or icon row display):
- Gemma 4 E2B (fine-tuned, local) + Gemma 4 26B (cloud fallback)
- Ollama for local model serving
- Unsloth LoRA fine-tuning
- FAISS vector search
- Piper TTS (offline, 30+ languages)
- Whisper ASR (offline)
- FastAPI + SQLite
- React 18 + Vite + PWA
- PyWebView desktop app
- mDNS + captive portal + self-signed TLS


# ============================================================
# SECTION: Impact
# ============================================================

Section label: Impact

Headline:
Built for 250 million students who standard systems leave out.

Body paragraph 1:
The UNHCR and World Bank put the average cost of refugee education at $1,051 per student per year for a system with no AI support and no adaptive feedback. OptiLearn delivers AI-powered, multilingual, adaptive learning for under $200 per student, on hardware already being donated to camps by organizations including Google, IRC, Lenovo, and Close the Gap.

Body paragraph 2:
Google has donated 25,000 laptops and $5.3 million in grants to refugee education programs. IRC runs device donation campaigns specifically to help families access online schooling. Lenovo, Computer Aid, and others have donated thousands of refurbished devices to settlements including Kakuma, which serves nearly 200,000 refugees and has classrooms with students gathered around a single laptop. OptiLearn is designed to run on exactly that hardware.

Body paragraph 3:
OptiLearn was designed first for refugee classrooms, but the barriers it removes are shared across hundreds of millions of students in rural, under-resourced, and language-diverse schools worldwide. The system we built is the system we wished existed as students navigating restricted languages of instruction and inadequate resources in Sri Lanka.

Stat display (for visual callout):
- Under $200 per student (vs $1,051 UNHCR baseline)
- 80%+ cost reduction
- 30+ languages supported offline
- 0 internet required for core features
- 1 laptop serves an entire classroom


# ============================================================
# SECTION: Open Source
# ============================================================

Section label: Open Source

Headline:
Free. Forever. For Everyone.

Body:
OptiLearn is fully open source under the MIT license. The code, training scripts, dataset preparation pipeline, and fine-tuned model weights are all public. NGOs, school systems, governments, and individual teachers can deploy it, modify it, and share it without cost or permission.

We do not charge. We do not collect data. We do not require accounts with us. The server runs in the classroom and data stays there.

CTA: View on GitHub
Secondary link: Download Model Weights on HuggingFace
Secondary link: Read the Kaggle Writeup


# ============================================================
# SECTION: Research and References
# ============================================================

Section label: Research

Headline:
Grounded in the evidence.

Body:
OptiLearn was not designed from first principles. Every architectural decision is traceable to documented conditions in refugee and displacement education. The language support list comes from UNHCR language surveys. The trauma-aware design draws on UNICEF Innocenti research on displaced child mental health. The hardware targets reflect what is actually present in camps through existing donation programs. The pupil-to-teacher ratio problem is quantified by UNHCR monitoring data, not assumed.

The references below are the primary sources we consulted throughout design and development.

Reference list (footnote or accordion style):
- UNHCR Refugee Statistics (2024). unhcr.org/refugee-statistics
- British Council Uganda. Language Use in Refugee Settlements. britishcouncil.ug
- UNHCR. Education in Refugee Camps (pupil-teacher ratio data)
- World Bank / UNHCR. The Global Cost of Inclusive Refugee Education
- UNICEF Innocenti. Mental Health Among Displaced Children and Youth (2023)
- UNESCO GEM Report. Teachers Struggling to Cope with Refugee Trauma
- NRC Sudan Displacement Report (2026)
- USA for UNHCR. Climate and Displacement
- Google.org / Business Insider. 25,000 Laptop Donations to Refugee Programs (Germany, 2016)
- Theirworld. Thaki Offline Bilingual Computer Labs (Lebanon, 2023)
- Computer Aid. Kakuma Digital Inclusion Report (2020)
- Close the Gap. Laptops for Refugee Camp in North Kenya


# ============================================================
# SECTION: Footer
# ============================================================

Footer text:
OptiLearn is an open-source project built for the Gemma 4 Good Hackathon (2026).
Built by students, for students.
For 250 million learners facing systemic barriers to quality education.

Footer links:
- GitHub
- HuggingFace
- Kaggle Writeup
- Contact

Copyright line:
2026 OptiLearn. MIT License. Free to use, modify, and deploy.

Contact email (for NGO and partnership inquiries):
chanitha.abey22@gmail.com
