"""Common Enterprise RAG AI Platform — generic router.

One router, every endpoint parameterized on module_code/module_id. This is
deliberate: FastAPI route functions already are the controller layer in
this codebase (no separate controller/service split), so a new AI module
(Sales, HR, ...) needs zero new route code — just an AI_MODULES row and a
prompts.py file (see app/rag_modules/README.md)."""

import json
import shutil
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import (
    APIRouter, BackgroundTasks, Depends, File, Form, HTTPException, Query,
    UploadFile,
)
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.utils.datetime_utils import now_ist
from app.models.rag_models import AIModule, AIDocument, AIChatHistory, AITrainingJob
from app.auth.auth_bearer import get_current_user, require
from app.rag_modules.core.text_extractors import SUPPORTED_EXTENSIONS
from app.rag_modules.core.ingestion_service import run_ingestion_job
from app.rag_modules.core import qdrant_client
from app.rag_modules.core.chat_orchestrator import run_chat


router = APIRouter(prefix="/rag", tags=["AI Platform"])

ALLOWED_EXTS = SUPPORTED_EXTENSIONS  # {'.pdf', '.docx', '.txt', '.md', '.csv', '.xlsx'}
MAX_BYTES = 25 * 1024 * 1024  # 25 MB — KB documents run larger than the 10 MB employee-doc cap

_STATIC_DIR = Path(__file__).resolve().parent.parent.parent / "static" / "ai-documents"


# ── Serializers ──────────────────────────────────────────────────────────────

def _serialize_module(m: AIModule) -> dict:
    return {
        "ID": m.ID,
        "MODULE_NAME": m.MODULE_NAME,
        "MODULE_CODE": m.MODULE_CODE,
        "DESCRIPTION": m.DESCRIPTION,
        "VECTOR_COLLECTION_NAME": m.VECTOR_COLLECTION_NAME,
        "EMBEDDING_MODEL": m.EMBEDDING_MODEL,
        "LLM_MODEL": m.LLM_MODEL,
        "IS_ACTIVE": m.IS_ACTIVE,
        "CREATED_AT": m.CREATED_AT.isoformat() if m.CREATED_AT else None,
        "UPDATED_AT": m.UPDATED_AT.isoformat() if m.UPDATED_AT else None,
    }


def _serialize_document(d: AIDocument) -> dict:
    return {
        "ID": d.ID,
        "MODULE_ID": d.MODULE_ID,
        "MODULE_NAME": d.MODULE_NAME,
        "TITLE": d.TITLE,
        "DESCRIPTION": d.DESCRIPTION,
        "FILE_NAME": d.FILE_NAME,
        "FILE_PATH": d.FILE_PATH,
        "FILE_SIZE": d.FILE_SIZE,
        "FILE_TYPE": d.FILE_TYPE,
        "FILE_EXTENSION": d.FILE_EXTENSION,
        "VERSION": d.VERSION,
        "DOCUMENT_TAGS": d.DOCUMENT_TAGS,
        "DOCUMENT_CATEGORY": d.DOCUMENT_CATEGORY,
        "IS_ACTIVE": d.IS_ACTIVE,
        "IS_PROCESSED": d.IS_PROCESSED,
        "PROCESSING_STATUS": d.PROCESSING_STATUS,
        "PROCESSING_ERROR": d.PROCESSING_ERROR,
        "TOTAL_CHUNKS": d.TOTAL_CHUNKS,
        "TOTAL_VECTORS": d.TOTAL_VECTORS,
        "CREATED_BY_ID": d.CREATED_BY_ID,
        "UPDATED_BY_ID": d.UPDATED_BY_ID,
        "CREATED_AT": d.CREATED_AT.isoformat() if d.CREATED_AT else None,
        "UPDATED_AT": d.UPDATED_AT.isoformat() if d.UPDATED_AT else None,
    }


def _serialize_job(j: AITrainingJob) -> dict:
    return {
        "ID": j.ID,
        "MODULE_ID": j.MODULE_ID,
        "DOCUMENT_ID": j.DOCUMENT_ID,
        "STATUS": j.STATUS,
        "STARTED_AT": j.STARTED_AT.isoformat() if j.STARTED_AT else None,
        "COMPLETED_AT": j.COMPLETED_AT.isoformat() if j.COMPLETED_AT else None,
        "ERROR_MESSAGE": j.ERROR_MESSAGE,
        "TOTAL_CHUNKS": j.TOTAL_CHUNKS,
        "TOTAL_VECTORS": j.TOTAL_VECTORS,
        "CREATED_AT": j.CREATED_AT.isoformat() if j.CREATED_AT else None,
    }


def _serialize_chat(c: AIChatHistory) -> dict:
    return {
        "ID": c.ID,
        "MODULE_ID": c.MODULE_ID,
        "USER_ID": c.USER_ID,
        "SESSION_ID": c.SESSION_ID,
        "QUESTION": c.QUESTION,
        "ANSWER": c.ANSWER,
        "PROMPT_TOKENS": c.PROMPT_TOKENS,
        "COMPLETION_TOKENS": c.COMPLETION_TOKENS,
        "TOTAL_TOKENS": c.TOTAL_TOKENS,
        "RESPONSE_TIME": float(c.RESPONSE_TIME) if c.RESPONSE_TIME is not None else None,
        "MODEL_NAME": c.MODEL_NAME,
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
    }


def _parse_date(value: Optional[str]) -> Optional[datetime]:

    if not value:

        return None

    try:

        return datetime.fromisoformat(value)

    except ValueError:

        return None


# ── AI Modules ───────────────────────────────────────────────────────────────

@router.get("/modules")
def list_modules(db: Session = Depends(get_db)):

    rows = db.query(AIModule).order_by(AIModule.MODULE_NAME).all()

    return [_serialize_module(m) for m in rows]


@router.put("/modules/{module_id}", dependencies=[Depends(require("rag.module.manage"))])
def update_module(
    module_id: str,
    description: Optional[str] = Form(None),
    llm_model: Optional[str] = Form(None),
    is_active: Optional[bool] = Form(None),
    db: Session = Depends(get_db),
):

    module = db.query(AIModule).filter(AIModule.ID == module_id).first()

    if not module:

        raise HTTPException(status_code=404, detail="AI module not found")

    if description is not None:

        module.DESCRIPTION = description

    if llm_model is not None:

        module.LLM_MODEL = llm_model

    if is_active is not None:

        module.IS_ACTIVE = is_active

    db.commit()

    db.refresh(module)

    return _serialize_module(module)


@router.delete("/modules/{module_id}", dependencies=[Depends(require("rag.module.manage"))])
def deactivate_module(module_id: str, db: Session = Depends(get_db)):

    module = db.query(AIModule).filter(AIModule.ID == module_id).first()

    if not module:

        raise HTTPException(status_code=404, detail="AI module not found")

    module.IS_ACTIVE = False

    db.commit()

    return {"message": "AI module deactivated."}


# ── Documents ────────────────────────────────────────────────────────────────

@router.get("/documents")
def list_documents(
    module_code: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    is_active: Optional[bool] = Query(None),
    created_from: Optional[str] = Query(None),
    created_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):

    q = db.query(AIDocument).filter(AIDocument.DELETED_AT.is_(None))

    if module_code:

        q = q.join(AIModule, AIDocument.MODULE_ID == AIModule.ID).filter(
            AIModule.MODULE_CODE == module_code
        )

    if status:

        q = q.filter(AIDocument.PROCESSING_STATUS == status.upper())

    if category:

        q = q.filter(AIDocument.DOCUMENT_CATEGORY == category)

    if is_active is not None:

        q = q.filter(AIDocument.IS_ACTIVE.is_(is_active))

    d_from = _parse_date(created_from)

    d_to = _parse_date(created_to)

    if d_from:

        q = q.filter(AIDocument.CREATED_AT >= d_from)

    if d_to:

        q = q.filter(AIDocument.CREATED_AT <= d_to)

    rows = q.order_by(AIDocument.CREATED_AT.desc()).all()

    return [_serialize_document(d) for d in rows]


@router.post("/documents/upload", dependencies=[Depends(require("rag.document.upload"))])
def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    module_code: str = Form(...),
    title: str = Form(""),
    description: str = Form(""),
    tags: str = Form(""),
    category: str = Form(""),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    module = db.query(AIModule).filter(AIModule.MODULE_CODE == module_code).first()

    if not module:

        raise HTTPException(status_code=404, detail=f"Unknown AI module: {module_code}")

    ext = Path(file.filename or "").suffix.lower()

    if ext not in ALLOWED_EXTS:

        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: " + ", ".join(sorted(ALLOWED_EXTS)),
        )

    target_dir = _STATIC_DIR / module_code

    target_dir.mkdir(parents=True, exist_ok=True)

    fname = f"{uuid.uuid4().hex}{ext}"

    dest = target_dir / fname

    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    size = dest.stat().st_size

    if size > MAX_BYTES:

        try:

            dest.unlink()

        except Exception:

            pass

        raise HTTPException(
            status_code=400,
            detail=f"File too large ({size} bytes). Max is {MAX_BYTES // (1024*1024)} MB.",
        )

    public_url = f"/static/ai-documents/{module_code}/{fname}"

    employee_id = payload.get("employee_id")

    doc = AIDocument(
        MODULE_ID=module.ID,
        MODULE_NAME=module.MODULE_NAME,
        TITLE=(title.strip() or file.filename or "Untitled"),
        DESCRIPTION=(description.strip() or None),
        FILE_NAME=file.filename,
        FILE_PATH=public_url,
        FILE_SIZE=size,
        FILE_TYPE=file.content_type,
        FILE_EXTENSION=ext,
        DOCUMENT_TAGS=(tags.strip() or None),
        DOCUMENT_CATEGORY=(category.strip() or None),
        CREATED_BY_ID=employee_id,
        UPDATED_BY_ID=employee_id,
    )

    db.add(doc)

    db.flush()

    job = AITrainingJob(MODULE_ID=module.ID, DOCUMENT_ID=doc.ID)

    db.add(job)

    db.commit()

    db.refresh(doc)

    db.refresh(job)

    background_tasks.add_task(run_ingestion_job, document_id=doc.ID, job_id=job.ID)

    return {"message": "Document uploaded. Ingestion started.", "document": _serialize_document(doc), "job_id": job.ID}


@router.get("/documents/{document_id}")
def get_document(document_id: str, db: Session = Depends(get_db)):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    return _serialize_document(doc)


@router.get("/documents/{document_id}/download")
def download_document(document_id: str, db: Session = Depends(get_db)):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    rel_path = doc.FILE_PATH.split("/static/", 1)[-1]

    abs_path = Path(__file__).resolve().parent.parent.parent / "static" / rel_path

    if not abs_path.exists():

        raise HTTPException(status_code=404, detail="File missing on disk")

    return FileResponse(str(abs_path), filename=doc.FILE_NAME)


@router.put("/documents/{document_id}/replace", dependencies=[Depends(require("rag.document.upload"))])
def replace_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    module = db.query(AIModule).filter(AIModule.ID == doc.MODULE_ID).first()

    ext = Path(file.filename or "").suffix.lower()

    if ext not in ALLOWED_EXTS:

        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: " + ", ".join(sorted(ALLOWED_EXTS)),
        )

    # Best-effort delete of the old file on disk before writing the new one.
    try:

        old_rel = doc.FILE_PATH.split("/static/", 1)[-1]

        old_abs = Path(__file__).resolve().parent.parent.parent / "static" / old_rel

        if old_abs.exists():

            old_abs.unlink()

    except Exception:

        pass

    target_dir = _STATIC_DIR / module.MODULE_CODE

    target_dir.mkdir(parents=True, exist_ok=True)

    fname = f"{uuid.uuid4().hex}{ext}"

    dest = target_dir / fname

    with dest.open("wb") as out:

        shutil.copyfileobj(file.file, out)

    size = dest.stat().st_size

    if size > MAX_BYTES:

        try:

            dest.unlink()

        except Exception:

            pass

        raise HTTPException(status_code=400, detail=f"File too large. Max is {MAX_BYTES // (1024*1024)} MB.")

    doc.FILE_NAME = file.filename

    doc.FILE_PATH = f"/static/ai-documents/{module.MODULE_CODE}/{fname}"

    doc.FILE_SIZE = size

    doc.FILE_TYPE = file.content_type

    doc.FILE_EXTENSION = ext

    doc.VERSION = (doc.VERSION or 1) + 1

    doc.IS_PROCESSED = False

    doc.PROCESSING_STATUS = "PENDING"

    doc.PROCESSING_ERROR = None

    doc.UPDATED_BY_ID = payload.get("employee_id")

    db.flush()

    job = AITrainingJob(MODULE_ID=doc.MODULE_ID, DOCUMENT_ID=doc.ID)

    db.add(job)

    db.commit()

    db.refresh(doc)

    db.refresh(job)

    background_tasks.add_task(run_ingestion_job, document_id=doc.ID, job_id=job.ID)

    return {"message": "Document replaced. Re-ingestion started.", "document": _serialize_document(doc), "job_id": job.ID}


@router.patch("/documents/{document_id}/activate", dependencies=[Depends(require("rag.document.upload"))])
def activate_document(document_id: str, db: Session = Depends(get_db)):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    doc.IS_ACTIVE = True

    db.commit()

    return {"message": "Document activated."}


@router.patch("/documents/{document_id}/deactivate", dependencies=[Depends(require("rag.document.upload"))])
def deactivate_document(document_id: str, db: Session = Depends(get_db)):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    doc.IS_ACTIVE = False

    db.commit()

    return {"message": "Document deactivated."}


@router.delete("/documents/{document_id}", dependencies=[Depends(require("rag.document.delete"))])
def delete_document(document_id: str, db: Session = Depends(get_db)):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    module = db.query(AIModule).filter(AIModule.ID == doc.MODULE_ID).first()

    file_removed = False

    try:

        rel_path = doc.FILE_PATH.split("/static/", 1)[-1]

        abs_path = Path(__file__).resolve().parent.parent.parent / "static" / rel_path

        if abs_path.exists():

            abs_path.unlink()

            file_removed = True

    except Exception:

        pass

    try:

        if module:

            qdrant_client.delete_document_vectors(module.VECTOR_COLLECTION_NAME, document_id)

    except Exception:

        pass

    doc.DELETED_AT = now_ist()

    doc.IS_ACTIVE = False

    db.commit()

    return {"message": "Document deleted.", "file_removed": file_removed}


@router.post("/documents/{document_id}/retrain", dependencies=[Depends(require("rag.document.upload"))])
def retrain_document(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):

    doc = db.query(AIDocument).filter(AIDocument.ID == document_id, AIDocument.DELETED_AT.is_(None)).first()

    if not doc:

        raise HTTPException(status_code=404, detail="Document not found")

    doc.PROCESSING_STATUS = "PENDING"

    doc.PROCESSING_ERROR = None

    db.flush()

    job = AITrainingJob(MODULE_ID=doc.MODULE_ID, DOCUMENT_ID=doc.ID)

    db.add(job)

    db.commit()

    db.refresh(job)

    background_tasks.add_task(run_ingestion_job, document_id=doc.ID, job_id=job.ID)

    return {"message": "Retraining started.", "job_id": job.ID}


# ── Training Jobs ────────────────────────────────────────────────────────────

@router.get("/training-jobs")
def list_training_jobs(
    module_code: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    created_from: Optional[str] = Query(None),
    created_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):

    q = db.query(AITrainingJob)

    if module_code:

        q = q.join(AIModule, AITrainingJob.MODULE_ID == AIModule.ID).filter(
            AIModule.MODULE_CODE == module_code
        )

    if status:

        q = q.filter(AITrainingJob.STATUS == status.upper())

    d_from = _parse_date(created_from)

    d_to = _parse_date(created_to)

    if d_from:

        q = q.filter(AITrainingJob.CREATED_AT >= d_from)

    if d_to:

        q = q.filter(AITrainingJob.CREATED_AT <= d_to)

    rows = q.order_by(AITrainingJob.CREATED_AT.desc()).limit(500).all()

    return [_serialize_job(j) for j in rows]


@router.get("/training-jobs/{job_id}")
def get_training_job(job_id: str, db: Session = Depends(get_db)):

    job = db.query(AITrainingJob).filter(AITrainingJob.ID == job_id).first()

    if not job:

        raise HTTPException(status_code=404, detail="Training job not found")

    return _serialize_job(job)


# ── Chat History ─────────────────────────────────────────────────────────────

@router.get("/chat-history")
def list_chat_history(
    module_code: Optional[str] = Query(None),
    user_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    created_from: Optional[str] = Query(None),
    created_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):

    q = db.query(AIChatHistory)

    if module_code:

        q = q.join(AIModule, AIChatHistory.MODULE_ID == AIModule.ID).filter(
            AIModule.MODULE_CODE == module_code
        )

    if user_id:

        q = q.filter(AIChatHistory.USER_ID == user_id)

    if session_id:

        q = q.filter(AIChatHistory.SESSION_ID == session_id)

    d_from = _parse_date(created_from)

    d_to = _parse_date(created_to)

    if d_from:

        q = q.filter(AIChatHistory.CREATED_AT >= d_from)

    if d_to:

        q = q.filter(AIChatHistory.CREATED_AT <= d_to)

    rows = q.order_by(AIChatHistory.CREATED_AT.desc()).limit(500).all()

    return [_serialize_chat(c) for c in rows]


# ── Chat (SSE) ───────────────────────────────────────────────────────────────

def _sse(payload: dict) -> str:

    return f"data: {json.dumps(payload)}\n\n"


def _stream_and_log(db: Session, module_code: str, message: str, session_id: str,
                     user_id: Optional[str], history, verbose: bool):

    def generate():

        answer_parts = []

        usage = {}

        for event in run_chat(
            db, module_code, message, session_id,
            user_id=user_id, history=history, verbose=verbose,
        ):

            if event["type"] == "text":

                answer_parts.append(event["text"])

            elif event["type"] == "usage":

                usage = event

            yield _sse(event)

        module = db.query(AIModule).filter(AIModule.MODULE_CODE == module_code).first()

        if module and answer_parts:

            try:

                db.add(AIChatHistory(
                    MODULE_ID=module.ID,
                    USER_ID=user_id,
                    SESSION_ID=session_id,
                    QUESTION=message,
                    ANSWER="".join(answer_parts),
                    PROMPT_TOKENS=usage.get("prompt_tokens"),
                    COMPLETION_TOKENS=usage.get("completion_tokens"),
                    TOTAL_TOKENS=usage.get("total_tokens"),
                    RESPONSE_TIME=usage.get("response_time"),
                    MODEL_NAME=usage.get("model_name"),
                ))

                db.commit()

            except Exception:

                db.rollback()

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/chat/stream", dependencies=[Depends(require("rag.query"))])
def chat_stream(
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    module_code = (body.get("module_code") or "").strip()

    message = (body.get("message") or "").strip()

    session_id = (body.get("session_id") or "").strip() or str(uuid.uuid4())

    history = body.get("history") or []

    if not module_code or not message:

        raise HTTPException(status_code=400, detail="module_code and message are required")

    return _stream_and_log(
        db, module_code, message, session_id, payload.get("employee_id"), history, verbose=False
    )


@router.post("/playground/chat/stream", dependencies=[Depends(require("rag.query"))])
def playground_chat_stream(
    body: dict,
    db: Session = Depends(get_db),
    payload: dict = Depends(get_current_user),
):

    module_code = (body.get("module_code") or "").strip()

    message = (body.get("message") or "").strip()

    session_id = (body.get("session_id") or "").strip() or str(uuid.uuid4())

    history = body.get("history") or []

    if not module_code or not message:

        raise HTTPException(status_code=400, detail="module_code and message are required")

    return _stream_and_log(
        db, module_code, message, session_id, payload.get("employee_id"), history, verbose=True
    )


# ── Settings ─────────────────────────────────────────────────────────────────

@router.get("/settings", dependencies=[Depends(require("rag.settings.manage"))])
def get_settings(db: Session = Depends(get_db)):

    import os

    modules = db.query(AIModule).order_by(AIModule.MODULE_NAME).all()

    return {
        "qdrant_url": os.getenv("QDRANT_URL", "http://127.0.0.1:6333"),
        "embedding_model": os.getenv("RAG_EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5"),
        "modules": [_serialize_module(m) for m in modules],
    }
