"""
AI Recruitment Assistant — REST endpoints.

  Jobs:
    GET    /recruitment/jobs
    POST   /recruitment/jobs
    GET    /recruitment/jobs/{job_id}
    PATCH  /recruitment/jobs/{job_id}
    GET    /recruitment/jobs/{job_id}/ranked-candidates

  Candidates:
    POST   /recruitment/candidates/upload      (multipart resume)
    GET    /recruitment/candidates
    GET    /recruitment/candidates/{candidate_id}
    PATCH  /recruitment/candidates/{candidate_id}

  Applications (candidate <-> job):
    POST   /recruitment/applications           (create + auto-screen)
    GET    /recruitment/applications
    POST   /recruitment/applications/{id}/re-screen

  Interviews:
    POST   /recruitment/interviews
    GET    /recruitment/interviews
    PATCH  /recruitment/interviews/{id}
    POST   /recruitment/interviews/{id}/suggest-questions

  Offer letters:
    POST   /recruitment/offers
    GET    /recruitment/offers/{id}
    GET    /recruitment/offers/{id}/pdf
    PATCH  /recruitment/offers/{id}/status
"""

from __future__ import annotations

from datetime import date, datetime
from pathlib import Path
from typing import Optional, List, Dict, Any
import io
import json
import os
import shutil
import uuid

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, File, Form
)
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import (
    RecruitmentJob, Candidate, CandidateApplication,
    Interview, OfferLetter, Employee,
)
from app.services.resume_parser import parse_resume, ParsedResume
from app.services.recruitment_screening import (
    screen_application, rank_candidates,
    suggest_interview_questions, next_code,
    render_offer_pdf,
)


router = APIRouter(prefix="/recruitment", tags=["Recruitment"])


# =====================================================================
# Schemas
# =====================================================================

class JobCreate(BaseModel):
    TITLE: str
    DEPARTMENT: Optional[str] = None
    LOCATION: Optional[str] = None
    EMPLOYMENT_TYPE: Optional[str] = "FULL_TIME"
    EXPERIENCE_MIN_YEARS: Optional[float] = 0.0
    EXPERIENCE_MAX_YEARS: Optional[float] = None
    SALARY_MIN: Optional[float] = None
    SALARY_MAX: Optional[float] = None
    REQUIRED_SKILLS: Optional[str] = None
    PREFERRED_SKILLS: Optional[str] = None
    REQUIRED_EDUCATION: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    OPENINGS: Optional[int] = 1
    VENDOR_ID: Optional[int] = 1


class JobUpdate(BaseModel):
    TITLE: Optional[str] = None
    DEPARTMENT: Optional[str] = None
    LOCATION: Optional[str] = None
    EMPLOYMENT_TYPE: Optional[str] = None
    EXPERIENCE_MIN_YEARS: Optional[float] = None
    EXPERIENCE_MAX_YEARS: Optional[float] = None
    SALARY_MIN: Optional[float] = None
    SALARY_MAX: Optional[float] = None
    REQUIRED_SKILLS: Optional[str] = None
    PREFERRED_SKILLS: Optional[str] = None
    REQUIRED_EDUCATION: Optional[str] = None
    DESCRIPTION: Optional[str] = None
    STATUS: Optional[str] = None
    OPENINGS: Optional[int] = None


class CandidateUpdate(BaseModel):
    FULL_NAME: Optional[str] = None
    EMAIL:     Optional[str] = None
    PHONE:     Optional[str] = None
    LOCATION:  Optional[str] = None
    SKILLS:    Optional[str] = None
    TOTAL_EXPERIENCE_YEARS: Optional[float] = None
    HIGHEST_QUALIFICATION:  Optional[str] = None
    STATUS:    Optional[str] = None
    SOURCE:    Optional[str] = None
    NOTES:     Optional[str] = None


class ApplicationCreate(BaseModel):
    CANDIDATE_ID: int
    JOB_ID:       int


class InterviewCreate(BaseModel):
    APPLICATION_ID:    int
    ROUND:             Optional[int] = 1
    ROUND_TYPE:        Optional[str] = "SCREENING"
    SCHEDULED_AT:      datetime
    DURATION_MINUTES:  Optional[int] = 45
    MODE:              Optional[str] = "ONLINE"
    MEETING_LINK:      Optional[str] = None
    LOCATION:          Optional[str] = None
    INTERVIEWER_NAME:  Optional[str] = None
    INTERVIEWER_EMAIL: Optional[str] = None


class InterviewUpdate(BaseModel):
    SCHEDULED_AT: Optional[datetime] = None
    STATUS:       Optional[str] = None
    SCORE:        Optional[float] = None
    RECOMMENDATION: Optional[str] = None
    FEEDBACK:     Optional[str] = None
    MEETING_LINK: Optional[str] = None
    LOCATION:     Optional[str] = None
    INTERVIEWER_NAME:  Optional[str] = None
    INTERVIEWER_EMAIL: Optional[str] = None


class OfferCreate(BaseModel):
    APPLICATION_ID:    int
    JOB_TITLE:         str
    DEPARTMENT:        Optional[str] = None
    COMPENSATION_CTC:  float
    COMPENSATION_BREAKDOWN: Optional[Dict[str, float]] = None
    BENEFITS:          Optional[str] = None
    JOINING_DATE:      Optional[date] = None
    PROBATION_MONTHS:  Optional[int] = 6
    NOTICE_PERIOD_DAYS: Optional[int] = 30
    EMPLOYMENT_TERMS:  Optional[str] = None
    SPECIAL_CLAUSES:   Optional[str] = None


class OfferStatusUpdate(BaseModel):
    STATUS: str


# =====================================================================
# Serialisers
# =====================================================================

def _serialize_job(j: RecruitmentJob) -> dict:
    return {
        "ID": j.ID, "JOB_CODE": j.JOB_CODE, "TITLE": j.TITLE,
        "DEPARTMENT": j.DEPARTMENT, "LOCATION": j.LOCATION,
        "EMPLOYMENT_TYPE": j.EMPLOYMENT_TYPE,
        "EXPERIENCE_MIN_YEARS": j.EXPERIENCE_MIN_YEARS,
        "EXPERIENCE_MAX_YEARS": j.EXPERIENCE_MAX_YEARS,
        "SALARY_MIN": j.SALARY_MIN, "SALARY_MAX": j.SALARY_MAX,
        "REQUIRED_SKILLS": j.REQUIRED_SKILLS,
        "PREFERRED_SKILLS": j.PREFERRED_SKILLS,
        "REQUIRED_EDUCATION": j.REQUIRED_EDUCATION,
        "DESCRIPTION": j.DESCRIPTION,
        "STATUS": j.STATUS, "OPENINGS": j.OPENINGS,
        "OPENED_AT": j.OPENED_AT.isoformat() if j.OPENED_AT else None,
        "CLOSED_AT": j.CLOSED_AT.isoformat() if j.CLOSED_AT else None,
        "CREATED_AT": j.CREATED_AT.isoformat() if j.CREATED_AT else None,
    }


def _serialize_candidate(c: Candidate, include_parsed: bool = False) -> dict:
    out = {
        "ID": c.ID, "CANDIDATE_CODE": c.CANDIDATE_CODE,
        "FULL_NAME": c.FULL_NAME, "EMAIL": c.EMAIL, "PHONE": c.PHONE,
        "LOCATION": c.LOCATION, "RESUME_URL": c.RESUME_URL,
        "TOTAL_EXPERIENCE_YEARS": c.TOTAL_EXPERIENCE_YEARS,
        "HIGHEST_QUALIFICATION": c.HIGHEST_QUALIFICATION,
        "SKILLS": c.SKILLS, "STATUS": c.STATUS, "SOURCE": c.SOURCE,
        "NOTES": c.NOTES,
        "CREATED_AT": c.CREATED_AT.isoformat() if c.CREATED_AT else None,
    }
    if include_parsed and c.PARSED_JSON:
        try:
            out["parsed"] = json.loads(c.PARSED_JSON)
        except Exception:
            out["parsed"] = None
    return out


def _serialize_application(a: CandidateApplication, db: Session) -> dict:
    cand = db.query(Candidate).filter(Candidate.ID == a.CANDIDATE_ID).first()
    job  = db.query(RecruitmentJob).filter(RecruitmentJob.ID == a.JOB_ID).first()
    return {
        "ID": a.ID,
        "CANDIDATE_ID": a.CANDIDATE_ID,
        "JOB_ID": a.JOB_ID,
        "CANDIDATE_NAME": cand.FULL_NAME if cand else None,
        "CANDIDATE_CODE": cand.CANDIDATE_CODE if cand else None,
        "JOB_TITLE": job.TITLE if job else None,
        "JOB_CODE":  job.JOB_CODE if job else None,
        "SCREENING_STATUS":     a.SCREENING_STATUS,
        "SKILL_MATCH_PCT":      a.SKILL_MATCH_PCT,
        "EXPERIENCE_MATCH_PCT": a.EXPERIENCE_MATCH_PCT,
        "EDUCATION_MATCH_PCT":  a.EDUCATION_MATCH_PCT,
        "OVERALL_SCORE":        a.OVERALL_SCORE,
        "MATCHING_SKILLS":      a.MATCHING_SKILLS,
        "MISSING_SKILLS":       a.MISSING_SKILLS,
        "SCREENING_SUMMARY":    a.SCREENING_SUMMARY,
        "STATUS":               a.STATUS,
        "REJECTION_REASON":     a.REJECTION_REASON,
        "SCREENED_AT": a.SCREENED_AT.isoformat() if a.SCREENED_AT else None,
        "CREATED_AT":  a.CREATED_AT.isoformat() if a.CREATED_AT else None,
    }


def _serialize_interview(i: Interview, db: Session) -> dict:
    app = db.query(CandidateApplication).filter(CandidateApplication.ID == i.APPLICATION_ID).first()
    cand_name = None
    job_title = None
    if app:
        c = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
        cand_name = c.FULL_NAME if c else None
        j = db.query(RecruitmentJob).filter(RecruitmentJob.ID == app.JOB_ID).first()
        job_title = j.TITLE if j else None
    return {
        "ID": i.ID, "APPLICATION_ID": i.APPLICATION_ID,
        "CANDIDATE_NAME": cand_name, "JOB_TITLE": job_title,
        "ROUND": i.ROUND, "ROUND_TYPE": i.ROUND_TYPE,
        "SCHEDULED_AT": i.SCHEDULED_AT.isoformat() if i.SCHEDULED_AT else None,
        "DURATION_MINUTES": i.DURATION_MINUTES,
        "MODE": i.MODE, "MEETING_LINK": i.MEETING_LINK, "LOCATION": i.LOCATION,
        "INTERVIEWER_NAME": i.INTERVIEWER_NAME,
        "INTERVIEWER_EMAIL": i.INTERVIEWER_EMAIL,
        "STATUS": i.STATUS, "SCORE": i.SCORE,
        "RECOMMENDATION": i.RECOMMENDATION, "FEEDBACK": i.FEEDBACK,
        "SUGGESTED_QUESTIONS": i.SUGGESTED_QUESTIONS,
    }


def _serialize_offer(o: OfferLetter) -> dict:
    bd = None
    if o.COMPENSATION_BREAKDOWN:
        try:    bd = json.loads(o.COMPENSATION_BREAKDOWN)
        except Exception: bd = None
    return {
        "ID": o.ID, "APPLICATION_ID": o.APPLICATION_ID,
        "OFFER_NUMBER": o.OFFER_NUMBER,
        "JOB_TITLE": o.JOB_TITLE, "DEPARTMENT": o.DEPARTMENT,
        "COMPENSATION_CTC": o.COMPENSATION_CTC,
        "COMPENSATION_BREAKDOWN": bd,
        "BENEFITS": o.BENEFITS,
        "JOINING_DATE": o.JOINING_DATE.isoformat() if o.JOINING_DATE else None,
        "PROBATION_MONTHS": o.PROBATION_MONTHS,
        "NOTICE_PERIOD_DAYS": o.NOTICE_PERIOD_DAYS,
        "EMPLOYMENT_TERMS": o.EMPLOYMENT_TERMS,
        "SPECIAL_CLAUSES": o.SPECIAL_CLAUSES,
        "LETTER_PDF_URL": o.LETTER_PDF_URL,
        "STATUS": o.STATUS,
        "SENT_AT":      o.SENT_AT.isoformat()      if o.SENT_AT      else None,
        "RESPONDED_AT": o.RESPONDED_AT.isoformat() if o.RESPONDED_AT else None,
        "CREATED_AT":   o.CREATED_AT.isoformat()   if o.CREATED_AT   else None,
    }


# =====================================================================
# JOBS
# =====================================================================

@router.get("/jobs")
def list_jobs(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(RecruitmentJob).order_by(RecruitmentJob.ID.desc())
    if status:
        q = q.filter(RecruitmentJob.STATUS == status.upper())
    return [_serialize_job(j) for j in q.all()]


@router.post("/jobs")
def create_job(body: JobCreate, db: Session = Depends(get_db)):
    job = RecruitmentJob(
        JOB_CODE=next_code("JOB", db, RecruitmentJob, "JOB_CODE"),
        TITLE=body.TITLE, DEPARTMENT=body.DEPARTMENT, LOCATION=body.LOCATION,
        EMPLOYMENT_TYPE=body.EMPLOYMENT_TYPE,
        EXPERIENCE_MIN_YEARS=body.EXPERIENCE_MIN_YEARS,
        EXPERIENCE_MAX_YEARS=body.EXPERIENCE_MAX_YEARS,
        SALARY_MIN=body.SALARY_MIN, SALARY_MAX=body.SALARY_MAX,
        REQUIRED_SKILLS=body.REQUIRED_SKILLS,
        PREFERRED_SKILLS=body.PREFERRED_SKILLS,
        REQUIRED_EDUCATION=body.REQUIRED_EDUCATION,
        DESCRIPTION=body.DESCRIPTION,
        OPENINGS=body.OPENINGS or 1,
        VENDOR_ID=body.VENDOR_ID or 1,
        STATUS="OPEN",
    )
    db.add(job); db.commit(); db.refresh(job)
    return _serialize_job(job)


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(RecruitmentJob).filter(RecruitmentJob.ID == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize_job(job)


@router.patch("/jobs/{job_id}")
def update_job(job_id: int, body: JobUpdate, db: Session = Depends(get_db)):
    job = db.query(RecruitmentJob).filter(RecruitmentJob.ID == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(job, field, value)
    if body.STATUS == "FILLED" or body.STATUS == "CANCELLED":
        job.CLOSED_AT = datetime.utcnow()
    db.commit(); db.refresh(job)
    return _serialize_job(job)


@router.get("/jobs/{job_id}/ranked-candidates")
def ranked_candidates(job_id: int, db: Session = Depends(get_db)):
    """Ranked leaderboard for one job — joins applications with their
    interview scores when present."""
    apps = (
        db.query(CandidateApplication)
        .filter(CandidateApplication.JOB_ID == job_id)
        .all()
    )

    enriched = []
    for a in apps:
        d = _serialize_application(a, db)
        iv = (
            db.query(Interview)
            .filter(Interview.APPLICATION_ID == a.ID)
            .order_by(Interview.ROUND.desc())
            .first()
        )
        if iv and iv.SCORE is not None:
            d["INTERVIEW_SCORE"] = iv.SCORE
        enriched.append(d)

    return rank_candidates(enriched)


# =====================================================================
# CANDIDATES
# =====================================================================

_STATIC_RESUME_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "static" / "recruitment" / "resumes"
)


@router.post("/candidates/upload")
def upload_candidate(
    file: UploadFile = File(...),
    source: Optional[str] = Form(None),
    notes:  Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Upload + parse a resume in one shot. If a candidate with the
    parsed email already exists, the existing row is updated; otherwise
    a new candidate is created. Returns the canonical candidate row."""

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    parsed: ParsedResume = parse_resume(file.filename or "resume.pdf", raw)

    # Save the file to disk
    _STATIC_RESUME_DIR.mkdir(parents=True, exist_ok=True)
    safe_ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "bin"
    fname = f"{uuid.uuid4().hex[:10]}.{safe_ext}"
    dest = _STATIC_RESUME_DIR / fname
    with dest.open("wb") as out:
        out.write(raw)
    resume_url = f"/static/recruitment/resumes/{fname}"

    # Look up existing candidate by email
    cand = None
    if parsed.email:
        cand = db.query(Candidate).filter(Candidate.EMAIL == parsed.email).first()

    if cand is None:
        cand = Candidate(
            CANDIDATE_CODE=next_code("CAND", db, Candidate, "CANDIDATE_CODE"),
            FULL_NAME=parsed.full_name or "Unknown candidate",
            EMAIL=parsed.email,
            PHONE=parsed.phone,
            LOCATION=parsed.location,
            RESUME_URL=resume_url,
            RESUME_TEXT=(parsed.raw_text or "")[:60000],
            PARSED_JSON=json.dumps(parsed.to_dict(), default=str),
            TOTAL_EXPERIENCE_YEARS=parsed.total_experience_years,
            HIGHEST_QUALIFICATION=parsed.highest_qualification,
            SKILLS=", ".join(parsed.skills),
            STATUS="NEW",
            SOURCE=source,
            NOTES=notes,
            VENDOR_ID=1,
        )
        db.add(cand)
    else:
        cand.FULL_NAME = parsed.full_name or cand.FULL_NAME
        cand.PHONE     = parsed.phone     or cand.PHONE
        cand.LOCATION  = parsed.location  or cand.LOCATION
        cand.RESUME_URL  = resume_url
        cand.RESUME_TEXT = (parsed.raw_text or "")[:60000]
        cand.PARSED_JSON = json.dumps(parsed.to_dict(), default=str)
        if parsed.total_experience_years:
            cand.TOTAL_EXPERIENCE_YEARS = parsed.total_experience_years
        if parsed.highest_qualification:
            cand.HIGHEST_QUALIFICATION = parsed.highest_qualification
        if parsed.skills:
            cand.SKILLS = ", ".join(parsed.skills)
        if source: cand.SOURCE = source
        if notes:  cand.NOTES  = notes
        cand.UPDATED_AT = datetime.utcnow()

    db.commit(); db.refresh(cand)
    return _serialize_candidate(cand, include_parsed=True)


@router.get("/candidates")
def list_candidates(
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Candidate).order_by(Candidate.ID.desc())
    if status:
        q = q.filter(Candidate.STATUS == status.upper())
    if search:
        like = f"%{search.lower()}%"
        q = q.filter(
            (Candidate.FULL_NAME.ilike(like)) |
            (Candidate.EMAIL.ilike(like)) |
            (Candidate.SKILLS.ilike(like)) |
            (Candidate.LOCATION.ilike(like))
        )
    return [_serialize_candidate(c) for c in q.all()]


@router.get("/candidates/{candidate_id}")
def get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    c = db.query(Candidate).filter(Candidate.ID == candidate_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _serialize_candidate(c, include_parsed=True)


@router.patch("/candidates/{candidate_id}")
def update_candidate(candidate_id: int, body: CandidateUpdate, db: Session = Depends(get_db)):
    c = db.query(Candidate).filter(Candidate.ID == candidate_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(c, f, v)
    db.commit(); db.refresh(c)
    return _serialize_candidate(c)


# =====================================================================
# APPLICATIONS  (candidate <-> job + screening)
# =====================================================================

@router.post("/applications")
def create_application(body: ApplicationCreate, db: Session = Depends(get_db)):
    cand = db.query(Candidate).filter(Candidate.ID == body.CANDIDATE_ID).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")
    job = db.query(RecruitmentJob).filter(RecruitmentJob.ID == body.JOB_ID).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    existing = (
        db.query(CandidateApplication)
        .filter(CandidateApplication.CANDIDATE_ID == body.CANDIDATE_ID)
        .filter(CandidateApplication.JOB_ID == body.JOB_ID)
        .first()
    )
    if existing is not None:
        # Re-screen instead of erroring
        return _rescreen_and_return(existing, cand, job, db)

    app = CandidateApplication(
        CANDIDATE_ID=cand.ID, JOB_ID=job.ID, STATUS="APPLIED",
    )
    db.add(app); db.flush()

    return _rescreen_and_return(app, cand, job, db)


@router.get("/applications")
def list_applications(
    job_id: Optional[int] = None,
    candidate_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(CandidateApplication).order_by(CandidateApplication.ID.desc())
    if job_id:        q = q.filter(CandidateApplication.JOB_ID == job_id)
    if candidate_id:  q = q.filter(CandidateApplication.CANDIDATE_ID == candidate_id)
    if status:        q = q.filter(CandidateApplication.STATUS == status.upper())
    return [_serialize_application(a, db) for a in q.all()]


@router.post("/applications/{app_id}/re-screen")
def rescreen_application_endpoint(app_id: int, db: Session = Depends(get_db)):
    app = db.query(CandidateApplication).filter(CandidateApplication.ID == app_id).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
    job  = db.query(RecruitmentJob).filter(RecruitmentJob.ID == app.JOB_ID).first()
    if not cand or not job:
        raise HTTPException(status_code=404, detail="Linked candidate / job not found")
    return _rescreen_and_return(app, cand, job, db)


def _rescreen_and_return(
    app: CandidateApplication,
    cand: Candidate,
    job: RecruitmentJob,
    db: Session,
) -> dict:
    result = screen_application(
        candidate_skills=cand.SKILLS,
        candidate_total_exp_years=cand.TOTAL_EXPERIENCE_YEARS,
        candidate_highest_qual=cand.HIGHEST_QUALIFICATION,
        job_required_skills=job.REQUIRED_SKILLS,
        job_preferred_skills=job.PREFERRED_SKILLS,
        job_exp_min=job.EXPERIENCE_MIN_YEARS,
        job_exp_max=job.EXPERIENCE_MAX_YEARS,
        job_required_education=job.REQUIRED_EDUCATION,
    )
    for k, v in result.items():
        setattr(app, k, v)
    if app.STATUS == "APPLIED":
        app.STATUS = "SCREENING"
    db.commit(); db.refresh(app)
    return _serialize_application(app, db)


# =====================================================================
# INTERVIEWS
# =====================================================================

@router.post("/interviews")
def create_interview(body: InterviewCreate, db: Session = Depends(get_db)):
    app = db.query(CandidateApplication).filter(CandidateApplication.ID == body.APPLICATION_ID).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")

    iv = Interview(
        APPLICATION_ID=body.APPLICATION_ID,
        ROUND=body.ROUND or 1,
        ROUND_TYPE=body.ROUND_TYPE,
        SCHEDULED_AT=body.SCHEDULED_AT,
        DURATION_MINUTES=body.DURATION_MINUTES,
        MODE=body.MODE,
        MEETING_LINK=body.MEETING_LINK,
        LOCATION=body.LOCATION,
        INTERVIEWER_NAME=body.INTERVIEWER_NAME,
        INTERVIEWER_EMAIL=body.INTERVIEWER_EMAIL,
        STATUS="SCHEDULED",
    )
    db.add(iv)

    # Bump application status
    if app.STATUS in ("APPLIED", "SCREENING", "SHORTLISTED"):
        app.STATUS = "INTERVIEWED"

    db.commit(); db.refresh(iv)
    return _serialize_interview(iv, db)


@router.get("/interviews")
def list_interviews(
    application_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Interview).order_by(Interview.SCHEDULED_AT.desc())
    if application_id: q = q.filter(Interview.APPLICATION_ID == application_id)
    if status:         q = q.filter(Interview.STATUS == status.upper())
    return [_serialize_interview(i, db) for i in q.all()]


@router.patch("/interviews/{iv_id}")
def update_interview(iv_id: int, body: InterviewUpdate, db: Session = Depends(get_db)):
    iv = db.query(Interview).filter(Interview.ID == iv_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(iv, f, v)
    db.commit(); db.refresh(iv)
    return _serialize_interview(iv, db)


@router.post("/interviews/{iv_id}/suggest-questions")
def suggest_questions(iv_id: int, db: Session = Depends(get_db)):
    iv = db.query(Interview).filter(Interview.ID == iv_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    app = db.query(CandidateApplication).filter(CandidateApplication.ID == iv.APPLICATION_ID).first()
    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first() if app else None
    job  = db.query(RecruitmentJob).filter(RecruitmentJob.ID == app.JOB_ID).first() if app else None
    qs = suggest_interview_questions(
        candidate_skills=cand.SKILLS if cand else None,
        job_required_skills=job.REQUIRED_SKILLS if job else None,
        round_type=iv.ROUND_TYPE,
        limit=10,
    )
    iv.SUGGESTED_QUESTIONS = "\n".join(qs)
    db.commit()
    return {"questions": qs}


# =====================================================================
# OFFER LETTERS
# =====================================================================

_STATIC_OFFER_DIR = (
    Path(__file__).resolve().parent.parent.parent
    / "static" / "recruitment" / "offers"
)


def _company_name(db: Session) -> str:
    """Quick name-only lookup. Kept for the email subject line."""
    try:
        from app.models.models import CompanyMaster
        c = db.query(CompanyMaster).first()
        if c:
            return c.LEGAL_NAME or c.SHORT_NAME or "Your Company"
    except Exception:
        pass
    return "Bharath Vending Corporation"


def _company_full(db: Session) -> dict:
    """Load the full company-master payload for the offer letter
    letterhead — including absolute disk path to the logo if one
    has been uploaded via the Company Settings page."""
    fallback = {
        "name":            "Bharath Vending Corporation",
        "legal_name":      "Bharath Vending Corporation",
        "tagline":         "",
        "address_line_1":  None,
        "address_line_2":  None,
        "city":            None, "state": None, "pincode": None, "country": None,
        "gst_number":      None, "pan_number": None,
        "phone":           None, "email": None, "website": None,
        "logo_path":       None,
    }
    try:
        from app.models.models import CompanyMaster
        c = db.query(CompanyMaster).first()
        if not c:
            return fallback

        # Resolve the logo URL to an absolute disk path so reportlab
        # can read it. LOGO_URL looks like "/static/company/<file>".
        logo_path = None
        if c.LOGO_URL:
            rel = c.LOGO_URL.split("/static/", 1)[-1]
            disk = Path(__file__).resolve().parent.parent.parent / "static" / rel
            if disk.exists():
                logo_path = str(disk)

        return {
            "name":            c.SHORT_NAME or c.LEGAL_NAME or fallback["legal_name"],
            "legal_name":      c.LEGAL_NAME or fallback["legal_name"],
            "tagline":         getattr(c, "TAGLINE", None) or "",
            "address_line_1":  getattr(c, "ADDRESS_LINE_1", None),
            "address_line_2":  getattr(c, "ADDRESS_LINE_2", None),
            "city":            getattr(c, "CITY",    None),
            "state":           getattr(c, "STATE",   None),
            "pincode":         getattr(c, "PINCODE", None),
            "country":         getattr(c, "COUNTRY", None),
            "gst_number":      getattr(c, "GST_NUMBER", None),
            "pan_number":      getattr(c, "PAN_NUMBER", None),
            "phone":           getattr(c, "PHONE",   None),
            "email":           getattr(c, "EMAIL",   None),
            "website":         getattr(c, "WEBSITE", None),
            "logo_path":       logo_path,
        }
    except Exception:
        return fallback


@router.post("/offers")
def create_offer(body: OfferCreate, db: Session = Depends(get_db)):
    app = db.query(CandidateApplication).filter(CandidateApplication.ID == body.APPLICATION_ID).first()
    if not app:
        raise HTTPException(status_code=404, detail="Application not found")
    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    offer = OfferLetter(
        APPLICATION_ID=body.APPLICATION_ID,
        OFFER_NUMBER=next_code("OFFER", db, OfferLetter, "OFFER_NUMBER"),
        JOB_TITLE=body.JOB_TITLE,
        DEPARTMENT=body.DEPARTMENT,
        COMPENSATION_CTC=body.COMPENSATION_CTC,
        COMPENSATION_BREAKDOWN=(
            json.dumps(body.COMPENSATION_BREAKDOWN)
            if body.COMPENSATION_BREAKDOWN else None
        ),
        BENEFITS=body.BENEFITS,
        JOINING_DATE=body.JOINING_DATE,
        PROBATION_MONTHS=body.PROBATION_MONTHS or 6,
        NOTICE_PERIOD_DAYS=body.NOTICE_PERIOD_DAYS or 30,
        EMPLOYMENT_TERMS=body.EMPLOYMENT_TERMS,
        SPECIAL_CLAUSES=body.SPECIAL_CLAUSES,
        STATUS="DRAFTED",
    )
    db.add(offer); db.flush()

    # Render the proper letterhead PDF with company logo + branding
    pdf_bytes = render_offer_pdf(
        offer_number=offer.OFFER_NUMBER,
        candidate_name=cand.FULL_NAME,
        candidate_email=cand.EMAIL,
        job_title=body.JOB_TITLE,
        department=body.DEPARTMENT,
        ctc=body.COMPENSATION_CTC,
        breakdown=body.COMPENSATION_BREAKDOWN,
        benefits=body.BENEFITS,
        joining_date=body.JOINING_DATE,
        probation_months=body.PROBATION_MONTHS or 6,
        notice_period_days=body.NOTICE_PERIOD_DAYS or 30,
        employment_terms=body.EMPLOYMENT_TERMS,
        special_clauses=body.SPECIAL_CLAUSES,
        company=_company_full(db),
    )

    _STATIC_OFFER_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"offer-{offer.ID}.pdf"
    dest = _STATIC_OFFER_DIR / fname
    with dest.open("wb") as out:
        out.write(pdf_bytes)
    offer.LETTER_PDF_URL = f"/static/recruitment/offers/{fname}"

    if app.STATUS != "OFFERED":
        app.STATUS = "OFFERED"

    db.commit(); db.refresh(offer)
    return _serialize_offer(offer)


@router.get("/offers")
def list_offers(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List every offer with the candidate name + email and job title
    joined in, so the Offers tab can render actions without N+1 calls."""
    q = db.query(OfferLetter).order_by(OfferLetter.ID.desc())
    if status:
        q = q.filter(OfferLetter.STATUS == status.upper())
    offers = q.all()

    out = []
    for o in offers:
        d = _serialize_offer(o)
        app = db.query(CandidateApplication).filter(
            CandidateApplication.ID == o.APPLICATION_ID
        ).first()
        if app:
            cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
            if cand:
                d["CANDIDATE_NAME"]  = cand.FULL_NAME
                d["CANDIDATE_EMAIL"] = cand.EMAIL
                d["CANDIDATE_CODE"]  = cand.CANDIDATE_CODE
                d["CANDIDATE_ID"]    = cand.ID
        out.append(d)
    return out


@router.get("/offers/{offer_id}")
def get_offer(offer_id: int, db: Session = Depends(get_db)):
    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    return _serialize_offer(o)


@router.post("/offers/{offer_id}/regenerate-pdf")
def regenerate_offer_pdf(offer_id: int, db: Session = Depends(get_db)):
    """Re-render the offer letter PDF with the latest company branding.
    Useful after the user updates the company logo or address."""
    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")

    app = db.query(CandidateApplication).filter(
        CandidateApplication.ID == o.APPLICATION_ID
    ).first()
    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first() if app else None

    breakdown = None
    if o.COMPENSATION_BREAKDOWN:
        try: breakdown = json.loads(o.COMPENSATION_BREAKDOWN)
        except Exception: breakdown = None

    pdf_bytes = render_offer_pdf(
        offer_number=o.OFFER_NUMBER,
        candidate_name=cand.FULL_NAME if cand else "Candidate",
        candidate_email=cand.EMAIL if cand else None,
        job_title=o.JOB_TITLE,
        department=o.DEPARTMENT,
        ctc=o.COMPENSATION_CTC,
        breakdown=breakdown,
        benefits=o.BENEFITS,
        joining_date=o.JOINING_DATE,
        probation_months=o.PROBATION_MONTHS or 6,
        notice_period_days=o.NOTICE_PERIOD_DAYS or 30,
        employment_terms=o.EMPLOYMENT_TERMS,
        special_clauses=o.SPECIAL_CLAUSES,
        company=_company_full(db),
    )

    _STATIC_OFFER_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"offer-{o.ID}.pdf"
    dest = _STATIC_OFFER_DIR / fname
    with dest.open("wb") as out:
        out.write(pdf_bytes)
    o.LETTER_PDF_URL = f"/static/recruitment/offers/{fname}"
    db.commit(); db.refresh(o)
    return {"message": "PDF regenerated", "offer": _serialize_offer(o)}


@router.get("/offers/{offer_id}/pdf")
def get_offer_pdf(offer_id: int, db: Session = Depends(get_db)):
    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    if not o.LETTER_PDF_URL:
        raise HTTPException(status_code=404, detail="PDF not generated yet")
    pdf_path = (
        Path(__file__).resolve().parent.parent.parent
        / o.LETTER_PDF_URL.lstrip("/")
    )
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file missing on disk")
    return StreamingResponse(
        io.BytesIO(pdf_path.read_bytes()),
        media_type="application/pdf",
        headers={
            "Content-Disposition": (
                f'inline; filename="{o.OFFER_NUMBER}.pdf"'
            ),
        },
    )


class SendOfferRequest(BaseModel):
    TO_EMAIL:     Optional[str] = None    # override candidate email
    CC_EMAILS:    Optional[List[str]] = None
    SUBJECT:      Optional[str] = None
    MESSAGE_HTML: Optional[str] = None    # custom email body; if absent we generate one


@router.post("/offers/{offer_id}/send")
def send_offer_email(
    offer_id: int,
    body: SendOfferRequest,
    db: Session = Depends(get_db),
):
    """Email the offer letter (PDF attached) to the candidate via the
    existing Resend transport. Updates offer status to SENT."""
    import base64

    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    if not o.LETTER_PDF_URL:
        raise HTTPException(status_code=400, detail="Offer PDF not generated yet")

    app = db.query(CandidateApplication).filter(
        CandidateApplication.ID == o.APPLICATION_ID
    ).first()
    if not app:
        raise HTTPException(status_code=404, detail="Linked application not found")

    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    to_email = (body.TO_EMAIL or cand.EMAIL or "").strip()
    if not to_email:
        raise HTTPException(
            status_code=400,
            detail="No email address on file for this candidate. "
                   "Set the candidate's email or pass TO_EMAIL in the request.",
        )

    # Load the PDF from disk
    pdf_path = (
        Path(__file__).resolve().parent.parent.parent
        / o.LETTER_PDF_URL.lstrip("/")
    )
    if not pdf_path.exists():
        raise HTTPException(status_code=404, detail="PDF file missing on disk")

    pdf_bytes = pdf_path.read_bytes()
    pdf_b64   = base64.b64encode(pdf_bytes).decode("ascii")

    company = _company_name(db)
    subject = body.SUBJECT or f"Offer of Employment — {o.JOB_TITLE} at {company}"

    html_body = body.MESSAGE_HTML or _default_offer_email_html(
        candidate_name=cand.FULL_NAME,
        job_title=o.JOB_TITLE,
        ctc=o.COMPENSATION_CTC,
        joining_date=o.JOINING_DATE,
        company=company,
    )

    # ---- Send via Resend (HTTP API). Falls back to a clear error
    # if Resend isn't configured or the API call fails. ----
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail="RESEND_API_KEY isn't set. Configure it in .env to email offers.",
        )

    from_addr = (
        os.getenv("SMTP_FROM")
        or os.getenv("SMTP_USER")
        or "onboarding@resend.dev"
    )
    from_name = os.getenv("SMTP_FROM_NAME") or company

    # Sandbox guard: if EMAIL_TESTING_OVERRIDE_TO is set we have to
    # redirect every recipient (TO + CC) to that one verified inbox,
    # because Resend's free tier refuses to deliver to any other
    # address until you verify a domain at resend.com/domains.
    override = (os.getenv("EMAIL_TESTING_OVERRIDE_TO") or "").strip()
    sandbox  = bool(override)

    requested_cc = [e.strip() for e in (body.CC_EMAILS or []) if e and e.strip()]

    if sandbox:
        actual_to = override
        # Drop CC entirely — Resend rejects every CC that isn't the
        # verified address. We'll mention the intended CCs in the banner.
        actual_cc = []
    else:
        actual_to = to_email
        actual_cc = requested_cc

    if sandbox and (override.lower() != to_email.lower() or requested_cc):
        cc_note = ""
        if requested_cc:
            cc_note = (
                f"<br/>CC was: <b>{', '.join(requested_cc)}</b> "
                f"(also redirected — Resend sandbox restricts CC delivery)."
            )
        banner = (
            f"<div style='background:#fff7ed;border:1px solid #fed7aa;"
            f"padding:10px 14px;border-radius:8px;font-size:12px;"
            f"color:#7c2d12;margin-bottom:14px;'>"
            f"<b>[Sandbox]</b> This offer was originally for "
            f"<b>{cand.FULL_NAME} &lt;{to_email}&gt;</b>. "
            f"Resend domain isn't verified yet, so it's being delivered "
            f"to the verified test inbox.{cc_note}</div>"
        )
        html_body = banner + html_body

    payload = {
        "from": f"{from_name} <{from_addr}>",
        "to": [actual_to],
        "subject": subject,
        "html": html_body,
        "attachments": [{
            "filename": f"{o.OFFER_NUMBER or 'offer'}.pdf",
            "content":  pdf_b64,
        }],
    }
    if actual_cc:
        payload["cc"] = actual_cc

    # Use urllib (stdlib) so no extra pip dependency is needed.
    import urllib.request
    import urllib.error

    body_data = json.dumps(payload).encode("utf-8")
    payload_kb = len(body_data) // 1024
    print(f"[recruitment] Sending offer {o.OFFER_NUMBER}: "
          f"{payload_kb} KB payload (PDF ~{len(pdf_bytes) // 1024} KB raw)")

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=body_data,
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
            # Cloudflare WAF on api.resend.com blocks Python's default
            # "Python-urllib/3.x" User-Agent with error 1010. A friendly
            # UA bypasses the block — same trick Resend's own SDKs use.
            "User-Agent": "BVC24-ERP/1.0 (FastAPI)",
            "Accept": "application/json",
        },
        method="POST",
    )

    # Generous timeout: PDF attachments (base64-encoded) add ~33% to the
    # payload and can take 20-40 s to upload on a slow connection. 60 s
    # is comfortably above what's needed even on Indian broadband.
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            status_code = response.status
            body_bytes  = response.read()
    except urllib.error.HTTPError as e:
        # Resend rejected the request — surface the actual reason in
        # both the HTTP response AND the backend terminal so we can
        # diagnose without opening browser dev tools.
        body = (e.read() or b"").decode("utf-8", errors="ignore")
        print(f"[recruitment] Resend HTTPError {e.code}: {body}")
        print(f"[recruitment]   from: {from_name} <{from_addr}>")
        print(f"[recruitment]   to:   {actual_to}  (original: {to_email})")
        raise HTTPException(
            status_code=502,
            detail=f"Resend {e.code}: {body[:400] or e.reason}",
        )
    except urllib.error.URLError as e:
        print(f"[recruitment] Resend network error: {e.reason}")
        raise HTTPException(
            status_code=502,
            detail=f"Could not reach Resend: {e.reason}",
        )
    except TimeoutError as ex:
        print(f"[recruitment] Resend timed out after 60s")
        raise HTTPException(
            status_code=504,
            detail=(
                "Resend took longer than 60 seconds to respond. "
                "Possible causes: slow network, very large PDF, or "
                "Resend's API is under load. The offer status was NOT "
                "flipped to SENT — try again in a moment."
            ),
        )
    except Exception as ex:
        print(f"[recruitment] Resend unexpected error: {type(ex).__name__}: {ex}")
        raise HTTPException(
            status_code=502,
            detail=f"Resend HTTP error: {type(ex).__name__}: {ex}",
        )

    if status_code >= 400:
        raise HTTPException(
            status_code=502,
            detail=f"Resend {status_code}: {body_bytes[:300].decode('utf-8', errors='ignore')}",
        )

    try:
        resend_resp = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        resend_resp = {}

    # Update offer status to SENT
    o.STATUS = "SENT"
    o.SENT_AT = datetime.utcnow()
    db.commit(); db.refresh(o)

    return {
        "message": f"Offer letter emailed to {to_email}",
        "to": actual_to,
        "original_to": to_email,
        "subject": subject,
        "resend_id": resend_resp.get("id"),
        "offer": _serialize_offer(o),
    }


def _default_offer_email_html(
    candidate_name: str, job_title: str, ctc: float,
    joining_date: Optional[date], company: str,
) -> str:
    """Render a clean, branded HTML body for the offer email."""
    ctc_str = f"INR {ctc:,.2f}" if ctc else "—"
    joining_str = joining_date.strftime("%d %B %Y") if joining_date else "to be confirmed"
    return f"""\
<!doctype html>
<html><body style="margin:0;padding:24px;font-family:-apple-system,'Segoe UI',Roboto,Arial,sans-serif;background:#f5f5f5;">
  <div style="max-width:600px;margin:auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 4px 14px rgba(0,0,0,0.06);">
    <div style="background:linear-gradient(135deg,#7A1022,#C8102E);color:white;padding:24px 28px;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#F4B324;text-transform:uppercase;">
        {company}
      </div>
      <div style="font-size:22px;font-weight:800;margin-top:6px;">
        Your offer of employment
      </div>
    </div>
    <div style="padding:26px 28px;font-size:14px;color:#1f2933;line-height:1.55;">
      <p>Dear <b>{candidate_name}</b>,</p>
      <p>
        We're delighted to extend you an offer to join {company} as
        <b>{job_title}</b>.
      </p>
      <p>
        <b>Annual CTC:</b> {ctc_str}<br/>
        <b>Joining date:</b> {joining_str}
      </p>
      <p>
        The full offer letter is attached to this email as a PDF.
        Please review it at your convenience and reply with your acceptance
        within 7 days. If you have any questions about the role, compensation,
        or onboarding, just reply to this email.
      </p>
      <p>
        We're looking forward to having you on the team.
      </p>
      <p style="margin-top:20px;">
        Warm regards,<br/>
        Human Resources<br/>
        <b>{company}</b>
      </p>
    </div>
  </div>
</body></html>
"""


@router.patch("/offers/{offer_id}/status")
def update_offer_status(offer_id: int, body: OfferStatusUpdate, db: Session = Depends(get_db)):
    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    s = (body.STATUS or "").upper().strip()
    if s not in {"DRAFTED", "REVIEWED", "SENT", "ACCEPTED", "REJECTED", "EXPIRED"}:
        raise HTTPException(status_code=400, detail="Invalid status")
    o.STATUS = s
    if s == "SENT":
        o.SENT_AT = datetime.utcnow()
    elif s in ("ACCEPTED", "REJECTED"):
        o.RESPONDED_AT = datetime.utcnow()
    db.commit(); db.refresh(o)
    return _serialize_offer(o)
