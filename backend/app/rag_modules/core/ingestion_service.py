"""Document ingestion pipeline: validate (done in the route before this is
called) -> extract -> chunk -> embed -> upsert to Qdrant -> update DB.

Runs as a FastAPI BackgroundTasks job triggered by upload/replace/retrain
(event-triggered, not time-polled — APScheduler is not the right tool here).
Opens its OWN SessionLocal() — never the request's session — and never lets
an exception escape, matching lead_polling_service.py's background-job
safety pattern: every job function wraps its whole body in try/except and
always closes its session in finally."""

from pathlib import Path

from app.database.database import SessionLocal
from app.utils.datetime_utils import now_ist
from app.models.rag_models import AIDocument, AIModule, AITrainingJob
from app.rag_modules.core.text_extractors import extract_text
from app.rag_modules.core.chunker import chunk_text
from app.rag_modules.core.embedding_service import embed_texts
from app.rag_modules.core import qdrant_client

_STATIC_DIR = Path(__file__).resolve().parent.parent.parent.parent / "static"


def run_ingestion_job(document_id: str, job_id: str) -> None:

    db = SessionLocal()

    try:

        job = db.query(AITrainingJob).filter(AITrainingJob.ID == job_id).first()

        doc = db.query(AIDocument).filter(AIDocument.ID == document_id).first()

        if not job or not doc:

            return

        job.STATUS = "RUNNING"

        job.STARTED_AT = now_ist()

        db.commit()

        module = db.query(AIModule).filter(AIModule.ID == doc.MODULE_ID).first()

        if not module:

            raise RuntimeError(f"AI module {doc.MODULE_ID} not found")

        rel_path = doc.FILE_PATH.split("/static/", 1)[-1]

        abs_path = _STATIC_DIR / rel_path

        raw_text = extract_text(abs_path, doc.FILE_EXTENSION)

        chunks = chunk_text(raw_text)

        if not chunks:

            raise RuntimeError("Document produced no usable text chunks")

        vectors = embed_texts(chunks)

        qdrant_client.ensure_collection(module.VECTOR_COLLECTION_NAME)

        # Clean slate — matters for replace/retrain so re-ingesting never
        # leaves stale points from a previous version behind.
        qdrant_client.delete_document_vectors(module.VECTOR_COLLECTION_NAME, document_id)

        n_vectors = qdrant_client.upsert_chunks(
            module.VECTOR_COLLECTION_NAME, document_id, module.MODULE_CODE, chunks, vectors
        )

        doc.IS_PROCESSED = True

        doc.PROCESSING_STATUS = "COMPLETED"

        doc.PROCESSING_ERROR = None

        doc.TOTAL_CHUNKS = len(chunks)

        doc.TOTAL_VECTORS = n_vectors

        job.STATUS = "COMPLETED"

        job.COMPLETED_AT = now_ist()

        job.TOTAL_CHUNKS = len(chunks)

        job.TOTAL_VECTORS = n_vectors

        db.commit()

    except Exception as e:

        db.rollback()

        try:

            job = db.query(AITrainingJob).filter(AITrainingJob.ID == job_id).first()

            doc = db.query(AIDocument).filter(AIDocument.ID == document_id).first()

            if job:

                job.STATUS = "FAILED"

                job.ERROR_MESSAGE = str(e)[:2000]

                job.COMPLETED_AT = now_ist()

            if doc:

                doc.PROCESSING_STATUS = "FAILED"

                doc.PROCESSING_ERROR = str(e)[:2000]

            db.commit()

        except Exception:

            db.rollback()

    finally:

        db.close()
