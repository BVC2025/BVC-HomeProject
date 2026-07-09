# BVC24 AI-Powered HR Assistant — Architecture & SRS

Status: Approved for Phase-1 build (Voice Leave Booking) — 2026-07-07.

> **One-line vision**: A voice-first, multilingual AI coworker embedded in
> the ERP that any employee, manager, or HR admin can talk to naturally to
> get answers, take actions, and receive proactive nudges — powered by
> open-source LLMs, RAG, ML models, and a policy of running everything
> on-prem or self-hosted so payroll data never leaves your infrastructure.

---

## 1. Guiding principles

| Principle | Why it matters |
|---|---|
| **Voice-first, text-fallback** | ERP users are often on the floor, on their phone, or multitasking. Voice removes the keyboard barrier. |
| **Multilingual by default** | English + Tamil + Hindi covers ~95% of your workforce. Detection is automatic. |
| **Self-hosted / on-prem AI** | Payroll, salary, appraisals, and health data must not go to a third-party API. Everything runs on your office server. |
| **Grounded, not hallucinated** | Every factual answer must come from RAG over your own docs + SQL over your ERP DB. Never let the LLM invent numbers. |
| **Role-aware from the first token** | An employee cannot see peers' salaries; a manager cannot approve their own leave. RBAC lives in the orchestrator, not the LLM. |
| **Observable end-to-end** | Every voice message, transcription, retrieval, and response is logged, replayable, and auditable. |

---

## 2. Feature Catalogue — 30 features, grouped

### Group A — Employee Self-Service (transactional)

| # | Feature | Primary AI model | Data source |
|---|---|---|---|
| 1 | **Voice Leave Booking** | LLM (function-calling) + STT + TTS | `leave_request` table |
| 2 | **Payroll Explanation** | LLM (few-shot) + template retriever | `payroll_run`, `salary_component` |
| 3 | **Attendance Query** | LLM + text-to-SQL agent | `attendance` |
| 4 | **HR Policy Assistant (RAG)** | LLM + dense vector search | Policy PDFs in vector store |
| 5 | **Permission / Comp-off Requests** | LLM function-calling | `leave_request` |
| 6 | **Payslip Retrieval + Read-out** | OCR (Tesseract/PP-OCR) + LLM | Payslip PDFs |
| 7 | **HR Document Summarization** | LLM (map-reduce summarizer) | Any uploaded PDF |
| 8 | **Multilingual Q&A** | Language ID model (fastText/CLD3) + translation LLM | RAG corpus |

### Group B — Predictive Analytics & ML

| # | Feature | AI model | Training data |
|---|---|---|---|
| 9 | **Smart Leave Prediction** (who's about to take leave) | LightGBM classifier — 30-day rolling features | `leave_request` history + attendance |
| 10 | **Attrition Risk Score** | XGBoost / TabNet on tenure, engagement, salary-vs-market | HR master + exit interviews |
| 11 | **Attendance Anomaly Detection** | Isolation Forest / autoencoder on check-in patterns | `attendance` + `attendance_security_log` |
| 12 | **Payroll Anomaly Detection** (fraud / errors) | Rule engine + robust z-score per component | `payroll_run` |
| 13 | **Employee Performance Insights** | Time-series forecast + KPI clustering (K-means) | Task completions, points, ratings |
| 14 | **Compensation Benchmarking** | Regression on role/experience/city | HR master + optional external benchmark feed |

### Group C — Content Generation

| # | Feature | AI model |
|---|---|---|
| 15 | **AI Email Generator** (offers, warnings, appraisals) | LLM with structured templates + tone conditioning |
| 16 | **AI Complaint Draft & Routing** | LLM + intent classifier (fine-tuned distilBERT) |
| 17 | **AI Meeting Assistant** (transcribe + summarize + action items) | Whisper + LLM (summarizer) + NER for names/dates |
| 18 | **AI Interview Assistant** (question bank, answer scoring, bias check) | LLM + rubric-guided scorer + toxicity classifier |
| 19 | **AI Onboarding Buddy** (Q&A + task checklist) | LLM + RAG + workflow orchestrator |
| 20 | **AI Policy Search over the whole handbook** | Vector search + LLM re-ranker (bge-reranker) |

### Group D — Voice & Interaction

| # | Feature | AI model |
|---|---|---|
| 21 | **Speech-to-Text (STT)** with barge-in | **Whisper** (self-hosted) or **whisper.cpp** on CPU |
| 22 | **Text-to-Speech (TTS)** in Indian voices | **Coqui TTS** / **Piper** (self-hosted) + male/female Tamil, Hindi, en-IN voices |
| 23 | **Voice-based Employee Verification** | Speaker embedding (ECAPA-TDNN, resemblyzer) + cosine similarity |
| 24 | **Voice Sentiment / Mood Detection** | wav2vec 2.0 + emotion classifier (SER) |
| 25 | **Wake-word ("Hey BVC")** | Porcupine / openWakeWord (edge, always-on) |

### Group E — HR Copilot for Managers & HR

| # | Feature | AI model |
|---|---|---|
| 26 | **AI Career Growth Advisor** | LLM + skills graph (Neo4j) + learning-path recommender (collaborative filtering) |
| 27 | **Personalized Learning Recommendations** | Content-based + collaborative filtering hybrid |
| 28 | **AI Reminder Agent** (proactive nudges — pending approvals, birthdays, appraisal windows) | Cron-triggered LLM agent with tool-calling |
| 29 | **HR Analytics Dashboard** (natural-language to chart) | LLM text-to-SQL + Vega-Lite spec generator |
| 30 | **HR Copilot Sidebar** — inline "what should I do next?" | LLM agent + workflow state machine + memory (vector) |

---

## 3. System Architecture

```
┌───────────────────────────────────────────────────────────────────────────┐
│  1. CLIENT LAYER                                                          │
│  ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │  Web (React)│  │  Mobile PWA │  │  Desk phone  │  │ WhatsApp bot   │  │
│  │  Voice mic  │  │  Voice mic  │  │  SIP gateway │  │  (Twilio/Wati) │  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬───────┘  └───────┬────────┘  │
└─────────┼────────────────┼────────────────┼──────────────────┼───────────┘
          │ HTTPS + WebSocket (audio stream)                   │
┌─────────▼────────────────────────────────────────────────────▼───────────┐
│  2. API GATEWAY (FastAPI + Nginx)                                        │
│     • JWT verify · rate-limit · request-ID · audit tap                   │
└─────────┬────────────────────────────────────────────────────────────────┘
          │
┌─────────▼────────────────────────────────────────────────────────────────┐
│  3. ORCHESTRATION LAYER                                                  │
│     ┌────────────────────┐  ┌────────────────┐  ┌───────────────────┐   │
│     │ Language Detector  │→ │ Intent Router  │→ │ Agent Dispatcher  │   │
│     │ (fastText / CLD3)  │  │ (regex+LLM)    │  │  (LangGraph)      │   │
│     └────────────────────┘  └────────────────┘  └────────┬──────────┘   │
│                                                          │              │
│     ┌──────────────────────────┬───────────────┬─────────┴───────────┐  │
│     ▼                          ▼               ▼                     ▼  │
│  ┌────────┐              ┌──────────┐    ┌──────────┐         ┌────────┐│
│  │Leave   │              │Payroll   │    │Policy    │         │Analytics│
│  │Agent   │              │Agent     │    │RAG Agent │         │Agent    ││
│  └────┬───┘              └────┬─────┘    └────┬─────┘         └────┬───┘│
└──────┼───────────────────────┼───────────────┼────────────────────┼────┘
       │                       │               │                    │
┌──────▼───────────────────────▼───────────────▼────────────────────▼────┐
│  4. AI SERVICES LAYER   (all self-hosted)                              │
│  ┌───────────┐  ┌──────────┐  ┌─────────┐  ┌────────┐  ┌────────────┐ │
│  │  LLM      │  │  STT     │  │  TTS    │  │ Embed  │  │ ML Models  │ │
│  │  (Ollama: │  │(Whisper) │  │ (Piper /│  │(bge-m3)│  │ (LightGBM, │ │
│  │  Phi-3,   │  │          │  │  Coqui) │  │        │  │  XGBoost,  │ │
│  │  Qwen2.5) │  │          │  │         │  │        │  │  IForest)  │ │
│  └───────────┘  └──────────┘  └─────────┘  └────────┘  └────────────┘ │
└──────┬───────────────────────┬───────────────┬────────────────────┬───┘
       │                       │               │                    │
┌──────▼───────────────────────▼───────────────▼────────────────────▼───┐
│  5. DATA LAYER                                                        │
│  ┌───────────┐  ┌───────────┐  ┌──────────┐  ┌───────────┐            │
│  │  MySQL    │  │  Vector   │  │  Redis   │  │  Object   │            │
│  │  (ERP     │  │  DB       │  │  (cache, │  │  Storage  │            │
│  │  system   │  │  (Qdrant) │  │  session,│  │  (MinIO)  │            │
│  │  of       │  │           │  │  queue)  │  │  audio +  │            │
│  │  record)  │  │           │  │          │  │  PDF blobs│            │
│  └───────────┘  └───────────┘  └──────────┘  └───────────┘            │
└──────┬────────────────────────────────────────────────────────────────┘
       │
┌──────▼─────────────────────────────────────────────────────────────────┐
│  6. OBSERVABILITY & GOVERNANCE                                        │
│  • Prometheus + Grafana (metrics)                                     │
│  • Loki (structured logs)                                             │
│  • OpenTelemetry traces                                               │
│  • Audit log (append-only): every (user, prompt, tool_call, response) │
│  • PII scrubber before persisting user turns                          │
└───────────────────────────────────────────────────────────────────────┘
```

---

## 4. Technology Stack

| Concern | Choice | Reason |
|---|---|---|
| **Frontend** | React 19 + Vite + Web Speech API + WebRTC for streaming audio | Already in your stack |
| **Backend API** | FastAPI 0.115 + SQLAlchemy 2.0 + Pydantic v2 | Already in your stack |
| **Orchestration** | LangGraph (or in-house dispatcher) | Deterministic state machine over LLM steps |
| **LLM (chat)** | **Ollama** running **Qwen 2.5 7B-Instruct** (multilingual) | Best OSS multilingual model at 8-GB VRAM |
| **LLM (heavier reasoning)** | **Qwen 2.5 14B** or **Llama 3.1 8B** when GPU available | Fallback path |
| **STT** | **faster-whisper** (medium model, INT8) on CPU or Whisper-large-v3 on GPU | 15× real-time on modest CPU; native en/ta/hi |
| **TTS** | **Piper** (fast, self-hosted, has en-IN + hi + ta voices) | 30 ms first-byte latency |
| **Wake-word** | **openWakeWord** or **Porcupine (free tier)** | Runs on-device |
| **Embeddings** | **BAAI/bge-m3** (dense + sparse, multilingual) | SOTA multilingual embedding |
| **Reranker** | **BAAI/bge-reranker-v2-m3** | 10-point NDCG boost on RAG |
| **Speaker verification** | **SpeechBrain ECAPA-TDNN** | 0.9% EER, 30 MB |
| **Voice emotion** | **wav2vec2 + IEMOCAP fine-tune** | 4-category SER |
| **Vector DB** | **Qdrant** (self-hosted, single-node) | Faster than pgvector at your scale |
| **Relational DB** | **MySQL 8** (already there) | System of record |
| **Cache / Queue** | **Redis 7** | Session, streaming buffer, background jobs |
| **Object storage** | **MinIO** (S3-compatible) | Audio clips, PDFs, embeddings snapshots |
| **Predictive ML** | **LightGBM** + **scikit-learn** | Fast, 1-line install |
| **Deep learning** | **PyTorch 2** | For SER, speaker embedding |
| **Knowledge graph** | **Neo4j Community** | Career-path graph |
| **Workflow / Cron** | **Celery + Redis** or **APScheduler** | Nightly ML retrain, reminders |
| **Observability** | **Prometheus + Grafana + Loki** | Free, self-hosted |
| **Deployment** | Docker Compose (dev) → Docker Swarm / K8s (prod) | Same office server for start, K8s later |
| **CI/CD** | Jenkins + GitHub Actions | Already in place |

### Model roster summary

| Layer | Model | Size | Purpose |
|---|---|---|---|
| LLM | Qwen 2.5 7B Instruct | 4.5 GB (Q4) | Multilingual chat, function calling |
| LLM | Phi-3 mini 3.8B | 2.3 GB (Q4) | Fast fallback for simple queries |
| LLM (parser) | Qwen 2.5 7B (JSON mode) | 4.5 GB | Resume parsing, structured extraction |
| STT | Whisper medium (INT8) | 500 MB | Multilingual speech-to-text |
| TTS | Piper en-IN, hi, ta | 60 MB each | Voice synthesis |
| Embedding | bge-m3 | 2.2 GB | Vector search |
| Reranker | bge-reranker-v2-m3 | 2.3 GB | Rerank top-K |
| Speaker ID | ECAPA-TDNN | 30 MB | Voice verification |
| SER | wav2vec2 + head | 380 MB | Mood detection |
| Wake word | openWakeWord | 5 MB | Always-on trigger |

**Total footprint**: ~18 GB across models. Fits on a single mid-range server (32 GB RAM, 8-core CPU, optional RTX 4060/A2000 GPU).

---

## 5. End-to-End Voice Workflow

```
Employee taps mic (or says "Hey BVC")
     │
     ▼
[BROWSER] MediaRecorder → WebSocket stream (Opus, 16 kHz)
     │
     ▼
[GATEWAY]  JWT verify + request_id + start audit row
     │
     ▼
[STT]  Whisper streams partial + final transcript
       └─ language_id = "ta" (Tamil detected)
     │
     ▼
[LANGUAGE ROUTER]
     • If not English, translate query → English (Qwen 2.5 mt)
     • Store both: original + English
     │
     ▼
[INTENT ROUTER]
     • Regex fast-path:  "leave|permission" → LeaveAgent
     • Fallback: LLM classifier → one of 30 intents
     │
     ▼
[AGENT DISPATCHER]  (LangGraph state machine)
     ┌────────────────────────────────────────────────┐
     │ 1. LOAD CONTEXT — employee_id, role, dept,     │
     │    last-5-turns from Redis                     │
     │ 2. RETRIEVE — vector search over policy corpus │
     │    + text-to-SQL over ERP DB (if needed)       │
     │ 3. TOOL CALL — book_leave(), get_payslip(),    │
     │    escalate_to_hr(), etc.  (RBAC-guarded)      │
     │ 4. GENERATE — LLM composes reply, grounded on  │
     │    retrieved chunks + tool results             │
     │ 5. GUARDRAIL — PII redactor + hallucination    │
     │    check (does answer cite a chunk?)           │
     └───────────────────┬────────────────────────────┘
                         │
                         ▼
                  Reply in English
                         │
                         ▼
[LANGUAGE ROUTER]  Translate back → Tamil
                         │
                         ▼
[TTS]  Piper streams audio chunks back over WebSocket
       (first-byte < 300 ms; user hears voice fast)
                         │
                         ▼
[CLIENT]  <audio> plays; transcript shown side-by-side
                         │
                         ▼
[AUDIT]  Persist: audio-hash, transcript, agent-plan,
         tool-calls, response, latency-breakdown
```

Latency budget:
```
STT (streaming)          ~ 300 ms first partial
Language detect + route  ~  50 ms
Retrieval + LLM          ~ 800 ms
TTS first byte           ~ 200 ms
──────────────────────────────
Total to first audio     ~ 1.3 s
```

---

## 6. Database Design (delta from current ERP)

```sql
CREATE TABLE ai_conversation (
    ID              INT AUTO_INCREMENT PRIMARY KEY,
    UUID            CHAR(36) UNIQUE,
    EMPLOYEE_ID     VARCHAR(36),
    CHANNEL         VARCHAR(20),
    STARTED_AT      DATETIME,
    ENDED_AT        DATETIME,
    LANGUAGE        VARCHAR(8),
    SATISFACTION    TINYINT,
    VENDOR_ID       INT,
    INDEX ix_conv_emp (EMPLOYEE_ID),
    INDEX ix_conv_started (STARTED_AT)
);

CREATE TABLE ai_turn (
    ID              BIGINT AUTO_INCREMENT PRIMARY KEY,
    CONVERSATION_ID INT,
    ROLE            VARCHAR(12),
    CONTENT         MEDIUMTEXT,
    LANG_DETECTED   VARCHAR(8),
    INTENT          VARCHAR(40),
    AUDIO_URL       VARCHAR(255),
    LATENCY_MS      INT,
    TOKENS_IN       INT,
    TOKENS_OUT      INT,
    CREATED_AT      DATETIME,
    INDEX ix_turn_conv (CONVERSATION_ID),
    INDEX ix_turn_intent (INTENT)
);

CREATE TABLE ai_tool_call (
    ID              BIGINT AUTO_INCREMENT PRIMARY KEY,
    TURN_ID         BIGINT,
    TOOL_NAME       VARCHAR(60),
    ARGUMENTS_JSON  JSON,
    RESULT_JSON     JSON,
    STATUS          VARCHAR(16),
    LATENCY_MS      INT,
    CREATED_AT      DATETIME
);

CREATE TABLE ai_document (
    ID              INT AUTO_INCREMENT PRIMARY KEY,
    TITLE           VARCHAR(255),
    SOURCE_PATH     VARCHAR(500),
    CATEGORY        VARCHAR(50),
    LAST_INDEXED_AT DATETIME,
    CHUNK_COUNT     INT,
    HASH            CHAR(64),
    VENDOR_ID       INT
);

CREATE TABLE ml_model_registry (
    ID              INT AUTO_INCREMENT PRIMARY KEY,
    MODEL_NAME      VARCHAR(60),
    VERSION         VARCHAR(20),
    TRAINED_AT      DATETIME,
    METRIC_JSON     JSON,
    ARTIFACT_URL    VARCHAR(255),
    IS_ACTIVE       TINYINT DEFAULT 0
);

CREATE TABLE voice_enrollment (
    ID              INT AUTO_INCREMENT PRIMARY KEY,
    EMPLOYEE_ID     VARCHAR(36) UNIQUE,
    EMBEDDING       BLOB,
    ENROLLED_AT     DATETIME,
    LAST_VERIFIED_AT DATETIME
);

CREATE TABLE ai_feedback (
    ID              BIGINT AUTO_INCREMENT PRIMARY KEY,
    TURN_ID         BIGINT,
    EMPLOYEE_ID     VARCHAR(36),
    THUMBS          TINYINT,
    COMMENT         VARCHAR(500),
    CREATED_AT      DATETIME
);
```

Vector store (Qdrant):
```
collections:
  hr_policy_v1        : bge-m3 (1024 dim), 20K chunks
  sop_handbook_v1     : bge-m3, 5K chunks
  employee_faq_v1     : bge-m3, 2K chunks
  meeting_transcripts : bge-m3, grows daily
payload schema:
  { doc_id, chunk_id, source, section, lang, updated_at }
```

---

## 7. API Design — key endpoints

```
POST   /ai/session                    → { session_id, ws_url }
WS     /ai/stream/{session_id}        ← audio in / transcript+audio out
POST   /ai/query           (text)     → { reply, citations[], tool_calls[] }
POST   /ai/feedback                   → { thumbs, comment }
POST   /ai/voice/enroll               → { embedding_id }
POST   /ai/voice/verify               → { match: bool, confidence }

# Admin
GET    /ai/conversations              → paginated (role: HR_ADMIN)
GET    /ai/conversations/{id}/replay  → audio + transcript
GET    /ai/models/registry            → list of ML models + metrics
POST   /ai/documents/upload           → indexes into vector DB
DELETE /ai/documents/{id}
POST   /ai/models/{name}/retrain      → triggers Celery task
GET    /ai/analytics/usage            → tokens, latency, top intents
GET    /ai/analytics/anomalies        → attendance / payroll anomalies
```

Middleware chain: `AuthJWT → RBAC → RateLimit → PIIScrubber → AuditLogger`.

---

## 8. Security & Compliance

| Concern | Control |
|---|---|
| **AuthN** | JWT (short-lived) + refresh; SSO-ready (SAML/OIDC hook) |
| **AuthZ** | RBAC — every tool call passes `(actor_id, role) → can_do(tool, target)` guard |
| **Data at rest** | MySQL InnoDB TDE, Qdrant encrypted volume, MinIO SSE-S3 |
| **Data in transit** | TLS 1.3 everywhere (Nginx + WSS) |
| **PII redaction** | NER pass masks PAN/Aadhaar/phone/email before persist |
| **Prompt injection** | Untrusted docs pass through quarantine template; system prompts hash-checked at boot |
| **Model isolation** | LLM has no direct DB access — only whitelisted tools with Pydantic schemas |
| **Audit** | Append-only `ai_turn` + `ai_tool_call`; WORM archive weekly |
| **Right-to-be-forgotten** | Per-employee cascade delete across MySQL + Qdrant + MinIO |
| **Guardrails** | Toxicity/PII classifier on input AND output; RBAC-scoped refusals |
| **Rate limits** | Per employee: 60 turns/min voice, 200/day; org-wide token budget |
| **Air-gap ready** | Zero external API calls — all self-hosted |
| **Model provenance** | Registry records training data hash, metric, code commit |
| **Drift alarm** | Nightly PSI check; > 0.2 triggers alert |

---

## 9. Scalability for 200+ employees

| Layer | Growth strategy |
|---|---|
| **API tier** | FastAPI stateless — horizontal behind Nginx; sticky sessions on WebSocket only |
| **LLM tier** | Start Ollama single process; move to vLLM with continuous batching at > 10 concurrent |
| **STT tier** | Whisper CPU handles ~4 concurrent 16 kHz streams/core; add GPU worker at > 30 |
| **Vector DB** | Qdrant single-node handles 10M vectors; shard by tenant at > 50M |
| **MySQL** | Vertical for now; read-replicas for analytics |
| **Queue** | Celery + Redis for tasks > 500 ms |
| **Model tiering** | Fast (Phi-3) for simple Q&A, heavy (Qwen 14B) only when router escalates |
| **Cache** | Redis LRU on: (query_hash → answer), (employee_id → context), (embedding_of_query) |
| **Multi-tenant** | `VENDOR_ID` column already present; add shard router at multi-org |

Capacity on one office server (32 GB RAM, 8-core CPU, optional RTX A2000 12 GB):
- ~ **50 simultaneous voice sessions**
- ~ **500 text queries / minute**
- **200-employee company handled with headroom**

---

## 10. Implementation Roadmap

### Phase 1 — Voice Leave Booking (weeks 1-4) — CURRENT
- Milestones 1.1 → 1.5 (see below)

### Phase 2 — Payroll + Attendance + Policy voice bots (weeks 5-8)
- Reuse the STT/LLM/TTS pipeline
- Add `get_payslip`, `explain_payslip`, `attendance_summary` tools
- RAG over policy PDFs (already partially there)

### Phase 3 — Multi-language + language router (weeks 9-12)
- Tamil + Hindi voice packs
- fastText language ID
- Translation-based routing

### Phase 4 — Predictive ML (weeks 13-22)
- Attrition, attendance anomaly, leave prediction, payroll anomaly
- ML model registry
- Manager analytics dashboard

### Phase 5 — Advanced voice + copilot (weeks 23-34)
- Speaker verification enrollment
- Voice sentiment / mood
- Meeting assistant
- HR copilot sidebar
- Career growth advisor

### Phase 6 — Production hardening (weeks 35-52)
- SSO
- Grafana dashboards
- Load test to 500 concurrent
- Air-gap deployment
- Multi-tenant sharding

---

## 11. SRS — Formal spec

**Functional requirements**

- FR-1: The system SHALL accept voice input from any authenticated employee in en/ta/hi.
- FR-2: The system SHALL respond in the language of the query with < 2 s end-to-end latency (p95).
- FR-3: The system SHALL support the 30 features listed in §2 with role-gated access.
- FR-4: The system SHALL persist a complete audit trail (audio, transcript, plan, tool calls, response) for 3 years.
- FR-5: The system SHALL never expose an employee's data to another employee unless RBAC explicitly permits.
- FR-6: The system SHALL fall back to text UI if the browser lacks microphone permission.
- FR-7: The system SHALL surface source citations for every factual claim.

**Non-functional requirements**

- NFR-1: p95 voice-to-voice latency ≤ 2 s at 50 concurrent sessions
- NFR-2: Availability ≥ 99.5% during business hours
- NFR-3: Zero calls to external AI APIs — self-hosted only
- NFR-4: RPO ≤ 24 hours, RTO ≤ 4 hours
- NFR-5: LLM output failing PII/toxicity guardrail SHALL be blocked with safe refusal
- NFR-6: All secrets in Jenkins credentials store — no plaintext .env in Git
- NFR-7: Every ML model in production SHALL have a metric card and drift alarm

**Interfaces**

- Voice: WebSocket audio streaming (Opus, 16 kHz)
- Text: JSON REST
- Admin: React admin UI + gRPC for internal batch pipelines

**Acceptance criteria** — per-phase smoke-test matrix (see roadmap deliverables).
