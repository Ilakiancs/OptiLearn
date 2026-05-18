# OptiLearn: Offline-First Multilingual LMS for Refugee Classrooms

Powered by Gemma 4 | Track: Future of Education

---

## Motivation

More than 123 million people were forcibly displaced worldwide at the end of 2024. Among them, 49 million were children under 18. These numbers are growing. Conflict, climate disasters, and regional instability keep pushing populations out of their homes, and education is almost always the first thing children lose.

Refugee classrooms are structurally different from anything standard education technology is designed for. The British Council documented up to 51 distinct languages among learners across 24 refugee-impacted primary schools in Uganda. Two-thirds of observed lessons required instruction in more than one language, and nearly a third of teachers were unable to speak any language their students used at home. The average pupil-to-teacher ratio in displacement settings reaches 1:85, dropping to 1:130 in lower grades. UNHCR estimates 85% of teachers in many camp schools are volunteers without formal qualifications.

UNESCO and UNICEF document what this environment does to children. Between 10% and 33% of displaced children show signs of depression. Among unaccompanied youth, reported PTSD rates range from 17% to 85%. These are not background statistics. They shape how a child responds to feedback, how a student experiences a grade, and why the word "wrong" on a screen from a tutor carries weight a developer sitting in an office never considered.

The UNHCR and World Bank jointly estimate the average unit cost of refugee education at $1,051 per student per year. This covers bare-minimum, under-resourced schooling with no AI support, no personalization, and no adaptive feedback.

We are three undergraduate students from Sri Lanka. We have experienced language-restricted and overcrowded education systems firsthand. OptiLearn began as a direct response to what we saw and what the evidence confirmed: millions of children in displacement need a learning system built for their specific reality.

---

## Solution

OptiLearn is an offline-first multilingual adaptive LMS. It runs on a single $100 refurbished laptop connected to a $15 travel router. Students access the platform from any device on the local network. Every core feature operates without an internet connection. Total per-student infrastructure cost falls below $200, against a UNHCR baseline of $1,051.

The system was designed around five documented problems.

The language barrier. OptiLearn's Translate and Learn feature accepts PDF uploads, photographs of textbook pages, and documents in any format. The fine-tuned Gemma 4 E2B model generates a conceptual translation into the student's native language, not a literal word-swap. An AI tutor then summarizes the content, answers follow-up questions using the Socratic method, and suggests related topics. Offline Piper TTS reads responses aloud in over 30 languages covering the UNHCR priority language list. All sessions are saved to the student's history.

Classroom overcrowding. With one teacher for 85 to 130 students, personal instruction is nearly impossible. OptiLearn's Live Class Translator transcribes the teacher's speech in real time using an offline Whisper ASR model and streams a translation into each student's chosen language as the teacher speaks. When class ends, the system generates a structured transcript and downloadable study notes as a PDF.

Network unreliability. The Gemma 4 E2B model serves all requests locally through Ollama. When the server detects a stable internet connection with latency below 200ms, it routes automatically to Gemma 4 26B through the Gemini API. Students never manage this switch. It is handled entirely at the server level and transparent to the user.

Untrained staff. The teacher dashboard surfaces mastery heatmaps, quiz results, activity logs, and AI-generated progress reports for every student. A teacher-facing AI assistant answers questions about curriculum, individual students, and the platform itself.

Trauma and safeguarding. The tutor model was fine-tuned to never use the words "wrong," "incorrect," "failed," or "mistake." Mastery progress is communicated through private levels and encouragement. When a student goes inactive, the teacher dashboard shows an alert so someone on the ground checks in personally.

---

## Technical Architecture

The backend is FastAPI with 12 route modules: chat, sessions, quiz, students, teachers, live translation, live class, materials, reporting, live quiz, authentication, and network management. Data is stored in SQLite through aiosqlite across eight tables: students, sessions, messages, mastery progress, quiz results, teachers, generated cache, and uploaded materials.

AI inference uses a dual-path model client. Locally, Ollama serves the fine-tuned Gemma 4 E2B model. The client measures first-token latency per request and routes to Gemini 26B when the connection crosses the configured threshold. Curriculum retrieval uses a FAISS index built from multilingual MiniLM-L12 embeddings, queried entirely offline against plain-text curriculum passages.

The agent dispatches four tools at inference time. Language detection runs through langdetect. Curriculum retrieval performs a FAISS similarity search returning the three closest passages by topic and grade level. Quiz generation calls the model with a structured prompt and extracts JSON from the response. Progress tracking applies EMA scoring: new = 0.7 × old + 0.3 × score, mapping the result to four levels: novice (0 to 0.39), developing (0.40 to 0.74), proficient (0.75 to 0.89), and advanced (0.90 to 1.00). All tool calls stream as SSE events alongside token output so the UI reflects tool activity in real time.

Text-to-speech uses Piper TTS running entirely offline. Speech-to-text for the live translation pipeline uses an offline Whisper model (ggml-base.bin). PDF extraction is handled by PyMuPDF. PDF generation uses ReportLab with Noto fonts to render Arabic, Amharic, Sinhala, Tamil, and other non-Latin scripts correctly.

Network setup includes mDNS service discovery via zeroconf so students reach the server at optilearn.local without typing an IP address. A captive portal DNS server built on dnslib redirects all connection attempts to the OptiLearn interface automatically. Self-signed TLS certificates are generated at startup through the Python cryptography library, covering all detected LAN IP addresses, enabling browser microphone access for live translation across all student devices. A QR code is displayed on the teacher screen for device enrollment.

The frontend is React 18 with Vite, served as a PWA with Workbox offline caching. Teacher sessions use 8-hour JWT tokens with bcrypt password hashing. Student sessions use PIN-based auth persisted for 30 days. The desktop launcher is PyWebView, which starts two uvicorn processes (HTTP on 8000, HTTPS on 8443), manages a single-instance mutex on Windows, and bridges Python and JavaScript for file save operations the WebView sandbox blocks.

The fine-tuned model was trained with Unsloth using LoRA (r=16, alpha=32, 2 epochs, lr=2e-4) on 11,500+ examples synthesized from Khan Academy content patterns, UNHCR educational guidelines, and multilingual Socratic dialogue. Training ran on a GCP A100 instance. Weights and benchmark reports are published on HuggingFace.

---

## Challenges

Offline TTS across 30+ languages without system package dependencies required bundling Piper TTS binaries and per-language voice model files. Race conditions in parallel sentence synthesis were resolved by submitting all futures upfront to a thread executor pool and chaining them so sentences arrive in order.

PyWebView on Windows silently discards blob URL downloads. Teachers could not save PDF notes during classroom testing. The fix added a Python js_api bridge class: JavaScript calls the bridge, which writes the base64-decoded file directly to the operating system Downloads folder and returns a confirmation toast.

Generating TLS certificates at startup that cover dynamically detected LAN IP addresses required reading all network interfaces at boot and embedding them as Subject Alternative Names. Without this, student devices on the LAN receive a cert that does not match the IP they connect to, blocking microphone access in the live translation feature.

Short audio clips from live classroom recording are unreliable inputs for language detection. The system now layers the student's stored language preference as a hint to the Whisper model, with automatic detection as a fallback, rather than relying on detection alone.

---

## Impact

OptiLearn delivers AI-supported education at under $200 per student on hardware already present in refugee camps through donation programs from Google, IRC, Lenovo, and others. Against the UNHCR baseline of $1,051 per student per year, this represents more than an 80% reduction in cost, with AI capabilities included.

The system is not a prototype. It installs from a single script, runs on a $100 laptop, serves an entire classroom from one device, and every AI feature works without internet access. We visited Mahara Janadipathi Vidyalaya in Colombo to test with real students and teachers before finalizing the design. That feedback shaped the trauma-aware language model fine-tune, the master interface language toggle for host-country integration, and the dyslexia-friendly font options.

We built OptiLearn for 250 million students worldwide who face systemic barriers to quality education. The ambition is to see the platform running in refugee camps and rural classrooms where it provides a real education, not a simulation of one.

---

References

- UNHCR Refugee Statistics (2024). unhcr.org/refugee-statistics
- British Council Uganda. Language Use in Refugee Settlements (2019). britishcouncil.ug
- UNHCR. Education in Refugee Camps (pupil-teacher ratios). unhcr.org
- World Bank / UNHCR. The Global Cost of Inclusive Refugee Education (2021).
- UNICEF Innocenti. Mental Health Among Displaced Children (2023).
- UNESCO GEM Report. Teachers Struggling to Cope with Refugee Trauma.
- NRC Sudan Displacement Report (2026). nrc.no
- USA for UNHCR. Climate and Displacement. unrefugees.org
