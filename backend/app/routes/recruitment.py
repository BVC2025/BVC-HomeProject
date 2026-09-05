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
import secrets
import shutil
import uuid

from fastapi import (
    APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
)
from fastapi.responses import Response, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.database.database import get_db
from app.models.models import (
    RecruitmentJob, Candidate, CandidateApplication,
    Interview, OfferLetter, Employee,
)
from app.models.recruitment_requisition_models import RecruitmentRequisition
from app.services.resume_parser import parse_resume, ParsedResume
from app.services.recruitment_screening import (
    screen_application, rank_candidates,
    suggest_interview_questions, next_code,
    render_offer_pdf,
)


from app.auth.auth_bearer import require

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
    # Candidate's email — a confirmation is sent here on schedule.
    # Optional (HR may schedule internally without notifying the
    # candidate yet). Overrides Candidate.EMAIL when supplied.
    CANDIDATE_EMAIL:   Optional[str] = None


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
        "CANDIDATE_NAME":  cand.FULL_NAME if cand else None,
        "CANDIDATE_CODE":  cand.CANDIDATE_CODE if cand else None,
        # Used by the Schedule-Interview drawer to pre-fill the
        # candidate-email field so HR doesn't have to look it up.
        "CANDIDATE_EMAIL": cand.EMAIL if cand else None,
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

@router.get("/jobs", dependencies=[Depends(require("recruitment.view"))])
def list_jobs(status: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(RecruitmentJob).order_by(RecruitmentJob.ID.desc())
    if status:
        q = q.filter(RecruitmentJob.STATUS == status.upper())
    return [_serialize_job(j) for j in q.all()]


@router.post("/jobs", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/jobs/{job_id}", dependencies=[Depends(require("recruitment.view"))])
def get_job(job_id: int, db: Session = Depends(get_db)):
    job = db.query(RecruitmentJob).filter(RecruitmentJob.ID == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return _serialize_job(job)


@router.patch("/jobs/{job_id}", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/jobs/{job_id}/ranked-candidates", dependencies=[Depends(require("recruitment.view"))])
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


@router.post("/candidates/upload", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/candidates", dependencies=[Depends(require("recruitment.view"))])
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


@router.get("/candidates/{candidate_id}", dependencies=[Depends(require("recruitment.view"))])
def get_candidate(candidate_id: int, db: Session = Depends(get_db)):
    c = db.query(Candidate).filter(Candidate.ID == candidate_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="Candidate not found")
    return _serialize_candidate(c, include_parsed=True)


@router.patch("/candidates/{candidate_id}", dependencies=[Depends(require("recruitment.manage"))])
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

@router.post("/applications", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/applications", dependencies=[Depends(require("recruitment.view"))])
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


@router.post("/applications/{app_id}/re-screen", dependencies=[Depends(require("recruitment.manage"))])
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

def _send_interview_confirmation_email(iv: Interview,
                                       app: CandidateApplication,
                                       candidate_email: str,
                                       db: Session) -> tuple[bool, str]:
    """Email the candidate confirming their interview is scheduled.
    Best-effort — a mail-server failure never blocks the API call.

    Uses plain print() so the trace lands in uvicorn.log regardless
    of which logger the process was launched with — we've been
    burned by uvicorn.error not being wired to the file handler."""
    from app.services.email_service import send_alert_email
    import sys

    def _trace(msg: str) -> None:
        print(f"[interview-confirmation] {msg}", file=sys.stderr, flush=True)

    _trace(f"invoked for interview={iv.ID} to={candidate_email!r}")

    if not candidate_email or "@" not in candidate_email:
        _trace("skipped — candidate email empty or invalid")
        return False, "no candidate email"

    cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
    job  = db.query(RecruitmentJob).filter(RecruitmentJob.ID == app.JOB_ID).first()

    when_str = iv.SCHEDULED_AT.strftime("%A, %d %B %Y at %I:%M %p") if iv.SCHEDULED_AT else "(to be confirmed)"

    mode_line = ""
    if (iv.MODE or "").upper() == "ONLINE" and iv.MEETING_LINK:
        mode_line = (
            f'<p style="margin:14px 0;">Join here: '
            f'<a href="{iv.MEETING_LINK}" style="color:#c22c1f;font-weight:600;">'
            f'{iv.MEETING_LINK}</a></p>'
        )
    elif (iv.MODE or "").upper() == "IN_PERSON" and iv.LOCATION:
        mode_line = f'<p style="margin:14px 0;"><strong>Location:</strong> {iv.LOCATION}</p>'
    elif (iv.MODE or "").upper() == "PHONE":
        mode_line = '<p style="margin:14px 0;">Our team will call you at the scheduled time.</p>'

    interviewer_line = ""
    if iv.INTERVIEWER_NAME:
        interviewer_line = f'<p style="margin:6px 0;"><strong>Interviewer:</strong> {iv.INTERVIEWER_NAME}</p>'

    body_html = f"""
    <html><body style="font-family:Segoe UI,sans-serif;color:#0f172a;
                       max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#c22c1f;color:white;padding:18px 22px;border-radius:10px 10px 0 0;">
        <div style="font-size:11px;letter-spacing:1.4px;opacity:0.7;text-transform:uppercase;">
          Bharath Vending Corporation
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;">
          Your interview is scheduled
        </div>
      </div>
      <div style="background:white;padding:22px;border:1px solid #e2e8f0;
                  border-top:none;border-radius:0 0 10px 10px;font-size:14px;line-height:1.6;">
        <p style="margin:0 0 12px;">Hi {cand.FULL_NAME if cand else 'there'},</p>
        <p style="margin:0 0 14px;">Thank you for your interest in the
          <strong>{job.TITLE if job else 'role'}</strong> role at BVC24.
          Your interview has been scheduled — details are below.</p>
        <table style="width:100%;font-size:14px;line-height:1.7;
                      background:#f8fafc;border-radius:8px;padding:12px 14px;">
          <tr><td style="color:#64748b;width:34%;">When</td>
              <td><strong>{when_str}</strong></td></tr>
          <tr><td style="color:#64748b;">Round</td>
              <td>R{iv.ROUND} · {iv.ROUND_TYPE or '—'}</td></tr>
          <tr><td style="color:#64748b;">Duration</td>
              <td>{iv.DURATION_MINUTES or 45} minutes</td></tr>
          <tr><td style="color:#64748b;">Mode</td>
              <td>{(iv.MODE or 'ONLINE').replace('_', ' ').title()}</td></tr>
        </table>
        {mode_line}
        {interviewer_line}
        <p style="margin:18px 0 8px;">If this time doesn't work for you, please reply to this
          email and we'll reschedule. We're looking forward to speaking with you.</p>
        <p style="margin:14px 0 0;color:#64748b;font-size:12px;">
          — BVC24 Recruitment Team
        </p>
      </div>
    </body></html>
    """

    try:
        ok, msg = send_alert_email(
            subject=f"Interview scheduled — {job.TITLE if job else 'BVC24'} · {when_str}",
            body_html=body_html,
            recipient=candidate_email,
        )
        _trace(f"send_alert_email returned ok={ok} msg={msg!r}")
        return ok, msg
    except Exception as exc:
        _trace(f"crashed: {exc!r}")
        return False, str(exc)


@router.post("/interviews", dependencies=[Depends(require("recruitment.manage"))])
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

    # Send confirmation to the candidate. HR types the email into
    # the schedule form; if left blank we fall back to the email on
    # the candidate record. Silently skipped when neither is set.
    candidate_email = (body.CANDIDATE_EMAIL or "").strip()
    if not candidate_email:
        cand = db.query(Candidate).filter(Candidate.ID == app.CANDIDATE_ID).first()
        candidate_email = (cand.EMAIL or "").strip() if cand else ""

    email_ok, email_msg = False, ""
    if candidate_email:
        email_ok, email_msg = _send_interview_confirmation_email(
            iv, app, candidate_email, db
        )

    result = _serialize_interview(iv, db)
    result["email_sent"] = bool(email_ok)
    result["email_recipient"] = candidate_email or None
    result["email_message"] = email_msg or None
    return result


@router.get("/interviews", dependencies=[Depends(require("recruitment.view"))])
def list_interviews(
    application_id: Optional[int] = None,
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(Interview).order_by(Interview.SCHEDULED_AT.desc())
    if application_id: q = q.filter(Interview.APPLICATION_ID == application_id)
    if status:         q = q.filter(Interview.STATUS == status.upper())
    return [_serialize_interview(i, db) for i in q.all()]


@router.patch("/interviews/{iv_id}", dependencies=[Depends(require("recruitment.manage"))])
def update_interview(iv_id: int, body: InterviewUpdate, db: Session = Depends(get_db)):
    iv = db.query(Interview).filter(Interview.ID == iv_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    for f, v in body.model_dump(exclude_unset=True).items():
        setattr(iv, f, v)
    db.commit(); db.refresh(iv)
    return _serialize_interview(iv, db)


@router.post("/interviews/{iv_id}/suggest-questions", dependencies=[Depends(require("recruitment.manage"))])
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


@router.post("/offers", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/offers", dependencies=[Depends(require("recruitment.view"))])
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


@router.get("/offers/{offer_id}", dependencies=[Depends(require("recruitment.view"))])
def get_offer(offer_id: int, db: Session = Depends(get_db)):
    o = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not o:
        raise HTTPException(status_code=404, detail="Offer not found")
    return _serialize_offer(o)


@router.post("/offers/{offer_id}/regenerate-pdf", dependencies=[Depends(require("recruitment.manage"))])
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


@router.get("/offers/{offer_id}/pdf", dependencies=[Depends(require("recruitment.view"))])
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


@router.post("/offers/{offer_id}/send", dependencies=[Depends(require("recruitment.manage"))])
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

    # -------------------------------------------------------------
    # Always regenerate the PDF at send time so it reflects the CURRENT
    # candidate + job + terms. Prevents the "stale name on PDF" bug
    # when the application/candidate is edited after the offer was
    # first drafted (e.g. offer was cloned from an old row, or the
    # linked candidate was swapped).
    # -------------------------------------------------------------
    breakdown = None
    if o.COMPENSATION_BREAKDOWN:
        try: breakdown = json.loads(o.COMPENSATION_BREAKDOWN)
        except Exception: breakdown = None

    pdf_bytes = render_offer_pdf(
        offer_number=o.OFFER_NUMBER,
        candidate_name=cand.FULL_NAME,
        candidate_email=cand.EMAIL,
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

    # Overwrite the file on disk so subsequent View PDF calls also
    # show the fresh copy.
    _STATIC_OFFER_DIR.mkdir(parents=True, exist_ok=True)
    fname = f"offer-{o.ID}.pdf"
    dest = _STATIC_OFFER_DIR / fname
    with dest.open("wb") as out:
        out.write(pdf_bytes)
    o.LETTER_PDF_URL = f"/static/recruitment/offers/{fname}"

    pdf_b64 = base64.b64encode(pdf_bytes).decode("ascii")

    # -------------------------------------------------------------
    # Generate a one-time response token so the candidate can click
    # Accept / Reject buttons in the email without logging in.
    # -------------------------------------------------------------
    import secrets as _secrets
    if not getattr(o, "RESPONSE_TOKEN", None):
        o.RESPONSE_TOKEN = _secrets.token_urlsafe(32)

    backend_base = (
        (os.getenv("BACKEND_URL") or "").strip().rstrip("/")
        or (
            (os.getenv("FRONTEND_URL") or "").strip().rstrip("/")
            .replace(":4173", ":8001").replace(":3000", ":8001")
        )
        or "http://192.168.1.10:8001"
    )
    accept_url = f"{backend_base}/recruitment/offers/decide/{o.RESPONSE_TOKEN}?action=accept"
    reject_url = f"{backend_base}/recruitment/offers/decide/{o.RESPONSE_TOKEN}?action=reject"

    company = _company_name(db)
    subject = body.SUBJECT or f"Offer of Employment — {o.JOB_TITLE} at {company}"

    html_body = body.MESSAGE_HTML or _default_offer_email_html(
        candidate_name=cand.FULL_NAME,
        job_title=o.JOB_TITLE,
        ctc=o.COMPENSATION_CTC,
        joining_date=o.JOINING_DATE,
        company=company,
    )

    # Append the Accept / Reject buttons to whatever the body was.
    html_body = html_body + _decision_buttons_html(accept_url, reject_url)

    # ---- Primary path: vendor SMTP (Gmail via VendorEmailConfig).
    # This uses the same active SMTP row the leave/credentials/onboarding
    # flows use — so an offer email works as soon as any one email
    # channel works, without needing a separate RESEND_API_KEY. ----
    requested_cc = [e.strip() for e in (body.CC_EMAILS or []) if e and e.strip()]

    smtp_sent = False
    smtp_error = None
    try:
        from app.models.email_models import VendorEmailConfig
        from email.mime.multipart import MIMEMultipart
        from email.mime.text import MIMEText
        from email.mime.application import MIMEApplication
        from email.utils import formataddr, make_msgid
        import smtplib

        active_cfg = (
            db.query(VendorEmailConfig)
            .filter(VendorEmailConfig.IS_ACTIVE == True)  # noqa: E712
            .first()
        )

        if active_cfg:
            msg = MIMEMultipart("mixed")
            msg["Subject"] = subject
            msg["From"] = formataddr((
                active_cfg.FROM_NAME or company,
                active_cfg.FROM_EMAIL or active_cfg.SMTP_USERNAME,
            ))
            msg["To"] = to_email
            if requested_cc:
                msg["Cc"] = ", ".join(requested_cc)
            msg["Message-ID"] = make_msgid()

            msg.attach(MIMEText(html_body, "html", "utf-8"))

            pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
            pdf_part.add_header(
                "Content-Disposition",
                "attachment",
                filename=f"Offer-{o.OFFER_NUMBER or o.ID}.pdf",
            )
            msg.attach(pdf_part)

            recipients = [to_email] + requested_cc

            with smtplib.SMTP(active_cfg.SMTP_HOST, active_cfg.SMTP_PORT, timeout=25) as s:
                s.ehlo()
                try: s.starttls(); s.ehlo()
                except Exception: pass
                s.login(active_cfg.SMTP_USERNAME, active_cfg.SMTP_PASSWORD)
                s.sendmail(
                    active_cfg.FROM_EMAIL or active_cfg.SMTP_USERNAME,
                    recipients,
                    msg.as_string(),
                )

            smtp_sent = True

    except Exception as e:
        import logging
        logging.getLogger("uvicorn.error").warning(
            "[offer-send] vendor SMTP failed: %s: %s", type(e).__name__, e,
        )
        smtp_error = f"{type(e).__name__}: {str(e)[:200]}"

    if smtp_sent:
        o.STATUS = "SENT"
        o.SENT_AT = datetime.utcnow()
        db.commit()
        return {
            "ok": True,
            "channel": "smtp",
            "sent_to": to_email,
            "cc": requested_cc,
            "offer_number": o.OFFER_NUMBER,
        }

    # ---- Fallback: Resend (HTTP API). Only reached if vendor SMTP
    # isn't configured OR failed at send time. ----
    api_key = os.getenv("RESEND_API_KEY", "").strip()
    if not api_key:
        raise HTTPException(
            status_code=500,
            detail=(
                "Could not send the offer letter. Vendor SMTP is not "
                "configured (or failed"
                + (f": {smtp_error}" if smtp_error else "")
                + ") and RESEND_API_KEY isn't set as a fallback. "
                "Set up an active Email Config in the Admin module."
            ),
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


@router.patch("/offers/{offer_id}/status", dependencies=[Depends(require("recruitment.manage"))])
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


# =====================================================================
# Candidate resume — parse only (no candidate row created)
# ---------------------------------------------------------------------
# Two-step upload flow: parse first, HR reviews the extracted fields,
# then saves via POST /recruitment/candidates. This endpoint returns
# the parsed structure + the URL of the saved resume file, and the
# existing-candidate-by-email lookup so HR can spot duplicates.
# =====================================================================

@router.post("/candidates/parse", dependencies=[Depends(require("recruitment.manage"))])
def parse_candidate_resume(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):

    raw = file.file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="Empty file")

    parsed: ParsedResume = parse_resume(file.filename or "resume.pdf", raw)

    _STATIC_RESUME_DIR.mkdir(parents=True, exist_ok=True)
    safe_ext = (file.filename or "").rsplit(".", 1)[-1].lower() or "bin"
    fname = f"{uuid.uuid4().hex[:10]}.{safe_ext}"
    dest = _STATIC_RESUME_DIR / fname
    with dest.open("wb") as out:
        out.write(raw)
    resume_url = f"/static/recruitment/resumes/{fname}"

    existing_id = None
    existing_name = None
    if parsed.email:
        dup = db.query(Candidate).filter(Candidate.EMAIL == parsed.email).first()
        if dup:
            existing_id = dup.ID
            existing_name = dup.FULL_NAME

    return {
        "resume_url":    resume_url,
        "parsed":        parsed.to_dict(),
        "existing_id":   existing_id,
        "existing_name": existing_name,
    }


# =====================================================================
# Candidate — save reviewed (after HR edits the parsed fields on-screen)
# ---------------------------------------------------------------------
# Called from the "parse then review" flow: parse endpoint returns the
# extracted fields + resume_url; HR reviews / edits them and submits
# this endpoint to actually create (or update) the Candidate row.
# =====================================================================

class CandidateSaveIn(BaseModel):
    resume_url: Optional[str] = None
    resume_text: Optional[str] = None
    full_name: str
    email: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin: Optional[str] = None
    skills: List[Any] = Field(default_factory=list)
    languages: List[Any] = Field(default_factory=list)
    certifications: List[Any] = Field(default_factory=list)
    education: List[Any] = Field(default_factory=list)
    work_experience: List[Any] = Field(default_factory=list)
    projects: List[Any] = Field(default_factory=list)
    total_experience_years: Optional[float] = None
    highest_qualification: Optional[str] = None
    source: Optional[str] = None
    notes: Optional[str] = None


def _join_skills(items: List[Any]) -> str:
    """Accepts a list of strings or {name: str} dicts and returns a
    canonical comma-separated string for the SKILLS column."""
    out: List[str] = []
    for it in items:
        if isinstance(it, str):
            s = it.strip()
            if s:
                out.append(s)
        elif isinstance(it, dict):
            s = str(it.get("name") or it.get("value") or "").strip()
            if s:
                out.append(s)
    return ", ".join(out)


@router.post("/candidates", dependencies=[Depends(require("recruitment.manage"))])
def save_reviewed_candidate(payload: CandidateSaveIn, db: Session = Depends(get_db)):

    if not payload.full_name.strip():
        raise HTTPException(status_code=400, detail="Full name is required.")

    parsed_blob = {
        "full_name":              payload.full_name.strip(),
        "email":                  payload.email,
        "phone":                  payload.phone,
        "location":               payload.location,
        "linkedin":               payload.linkedin,
        "skills":                 payload.skills,
        "languages":              payload.languages,
        "certifications":         payload.certifications,
        "education":              payload.education,
        "work_experience":        payload.work_experience,
        "projects":               payload.projects,
        "total_experience_years": payload.total_experience_years,
        "highest_qualification":  payload.highest_qualification,
    }

    cand = None
    if payload.email:
        cand = db.query(Candidate).filter(Candidate.EMAIL == payload.email).first()

    skills_flat = _join_skills(payload.skills)

    if cand is None:
        cand = Candidate(
            CANDIDATE_CODE         = next_code("CAND", db, Candidate, "CANDIDATE_CODE"),
            FULL_NAME              = payload.full_name.strip(),
            EMAIL                  = payload.email,
            PHONE                  = payload.phone,
            LOCATION               = payload.location,
            RESUME_URL             = payload.resume_url,
            RESUME_TEXT            = (payload.resume_text or "")[:60000],
            PARSED_JSON            = json.dumps(parsed_blob, default=str),
            TOTAL_EXPERIENCE_YEARS = payload.total_experience_years or 0.0,
            HIGHEST_QUALIFICATION  = payload.highest_qualification,
            SKILLS                 = skills_flat or None,
            STATUS                 = "NEW",
            SOURCE                 = (payload.source or "WEBSITE"),
            NOTES                  = payload.notes,
            VENDOR_ID              = 1,
        )
        db.add(cand)
    else:
        # Update in place — HR is editing an existing candidate's parse.
        cand.FULL_NAME             = payload.full_name.strip() or cand.FULL_NAME
        cand.PHONE                 = payload.phone            or cand.PHONE
        cand.LOCATION              = payload.location         or cand.LOCATION
        if payload.resume_url:
            cand.RESUME_URL = payload.resume_url
        if payload.resume_text:
            cand.RESUME_TEXT = payload.resume_text[:60000]
        cand.PARSED_JSON           = json.dumps(parsed_blob, default=str)
        if payload.total_experience_years is not None:
            cand.TOTAL_EXPERIENCE_YEARS = payload.total_experience_years
        if payload.highest_qualification:
            cand.HIGHEST_QUALIFICATION  = payload.highest_qualification
        if skills_flat:
            cand.SKILLS = skills_flat
        if payload.source:
            cand.SOURCE = payload.source
        if payload.notes:
            cand.NOTES = payload.notes
        cand.UPDATED_AT = datetime.utcnow()

    db.commit()
    db.refresh(cand)
    return _serialize_candidate(cand, include_parsed=True)


# =====================================================================
# Recruitment Requisitions — pre-job approval workflow
# ---------------------------------------------------------------------
# Department head raises → HR/management approves → converts into a
# RecruitmentJob (which then feeds candidates/applications/interviews).
# =====================================================================

class RequisitionCreate(BaseModel):
    POSITION_TITLE: str
    DEPARTMENT: Optional[str] = None
    LOCATION: Optional[str] = None
    EMPLOYMENT_TYPE: Optional[str] = "FULL_TIME"
    HEADCOUNT: Optional[int] = 1
    EXPERIENCE_MIN_YEARS: Optional[float] = 0.0
    EXPERIENCE_MAX_YEARS: Optional[float] = None
    BUDGET_CTC_MIN: Optional[float] = None
    BUDGET_CTC_MAX: Optional[float] = None
    REQUIRED_SKILLS: Optional[str] = None
    PREFERRED_SKILLS: Optional[str] = None
    REQUIRED_EDUCATION: Optional[str] = None
    JUSTIFICATION: Optional[str] = None
    URGENCY: Optional[str] = "NORMAL"
    NEEDED_BY_DATE: Optional[str] = None
    REQUESTED_BY_ID: Optional[str] = None


class RequisitionReject(BaseModel):
    REJECTION_REASON: str


def _next_req_code(db: Session) -> str:
    """REQ-2026-0001 style. Simple sequential based on max ID."""
    from sqlalchemy import func
    year = datetime.now().year
    max_id = db.query(func.max(RecruitmentRequisition.ID)).scalar() or 0
    return f"REQ-{year}-{(max_id + 1):04d}"


def _serialize_requisition(r: RecruitmentRequisition, db: Session) -> Dict[str, Any]:
    requester_name = None
    if r.REQUESTED_BY_ID:
        emp = db.query(Employee).filter(Employee.ID == r.REQUESTED_BY_ID).first()
        if emp:
            requester_name = emp.NAME

    return {
        "ID": r.ID,
        "REQ_CODE": r.REQ_CODE,
        "POSITION_TITLE": r.POSITION_TITLE,
        "DEPARTMENT": r.DEPARTMENT,
        "LOCATION": r.LOCATION,
        "EMPLOYMENT_TYPE": r.EMPLOYMENT_TYPE,
        "HEADCOUNT": r.HEADCOUNT,
        "EXPERIENCE_MIN_YEARS": r.EXPERIENCE_MIN_YEARS,
        "EXPERIENCE_MAX_YEARS": r.EXPERIENCE_MAX_YEARS,
        "BUDGET_CTC_MIN": r.BUDGET_CTC_MIN,
        "BUDGET_CTC_MAX": r.BUDGET_CTC_MAX,
        "REQUIRED_SKILLS": r.REQUIRED_SKILLS,
        "PREFERRED_SKILLS": r.PREFERRED_SKILLS,
        "REQUIRED_EDUCATION": r.REQUIRED_EDUCATION,
        "JUSTIFICATION": r.JUSTIFICATION,
        "URGENCY": r.URGENCY,
        "NEEDED_BY_DATE": r.NEEDED_BY_DATE.isoformat() if r.NEEDED_BY_DATE else None,
        "REQUESTED_BY_ID": r.REQUESTED_BY_ID,
        "REQUESTED_BY_NAME": requester_name,
        "STATUS": r.STATUS,
        "REJECTION_REASON": r.REJECTION_REASON,
        "APPROVED_AT": r.APPROVED_AT.isoformat() if r.APPROVED_AT else None,
        "REJECTED_AT": r.REJECTED_AT.isoformat() if r.REJECTED_AT else None,
        "CONVERTED_AT": r.CONVERTED_AT.isoformat() if r.CONVERTED_AT else None,
        "CONVERTED_JOB_ID": r.CONVERTED_JOB_ID,
        "CREATED_AT": r.CREATED_AT.isoformat() if r.CREATED_AT else None,
    }


@router.get("/requisitions", dependencies=[Depends(require("recruitment.view"))])
def list_requisitions(
    status: Optional[str] = None,
    db: Session = Depends(get_db),
):
    q = db.query(RecruitmentRequisition)
    if status:
        q = q.filter(RecruitmentRequisition.STATUS == status)
    rows = q.order_by(RecruitmentRequisition.CREATED_AT.desc()).all()
    return [_serialize_requisition(r, db) for r in rows]


@router.get("/requisitions/{req_id}", dependencies=[Depends(require("recruitment.view"))])
def get_requisition(req_id: int, db: Session = Depends(get_db)):
    r = db.query(RecruitmentRequisition).filter(RecruitmentRequisition.ID == req_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    return _serialize_requisition(r, db)


def _hr_recipient() -> str:
    """HR-team email that receives requisition approval links.
    Falls back to the .env-configured APPROVER_EMAIL if HR_EMAIL is
    unset. Both are read from environment so the deploy can rotate
    them without a code change."""
    return (
        os.getenv("HR_EMAIL", "").strip()
        or os.getenv("MD_EMAIL", "").strip()
        or os.getenv("APPROVER_EMAIL", "").strip()
        or "bvc24it@gmail.com"
    )


def _backend_url_for_email() -> str:
    return (
        os.getenv("BACKEND_URL", "").rstrip("/")
        or "http://192.168.1.10:8001"
    )


def _frontend_url_for_email() -> str:
    return (
        os.getenv("FRONTEND_URL", "").rstrip("/")
        or "http://192.168.1.10:4173"
    )


def _send_requisition_approval_email(r: RecruitmentRequisition,
                                     requester_name: Optional[str]) -> None:
    """Send the MD an email with one-click Approve / Reject buttons.
    Best-effort — a mail-server failure must not break the API call."""
    from app.services.email_service import send_alert_email

    recipient = _hr_recipient()
    if not recipient:
        return

    backend = _backend_url_for_email()
    approve_link = f"{backend}/recruitment/requisitions/decide/{r.APPROVAL_TOKEN}?action=approve"
    reject_link  = f"{backend}/recruitment/requisitions/decide/{r.APPROVAL_TOKEN}?action=reject"

    def _row(label: str, value: Optional[str]) -> str:
        if not value:
            return ""
        return (
            f'<tr><td style="color:#64748b;padding:4px 12px 4px 0;">{label}</td>'
            f'<td><strong>{value}</strong></td></tr>'
        )

    budget = None
    if r.BUDGET_CTC_MIN or r.BUDGET_CTC_MAX:
        lo = f"₹{int(r.BUDGET_CTC_MIN):,}" if r.BUDGET_CTC_MIN else "?"
        hi = f"₹{int(r.BUDGET_CTC_MAX):,}" if r.BUDGET_CTC_MAX else "?"
        budget = f"{lo} — {hi} CTC"

    experience = None
    if r.EXPERIENCE_MIN_YEARS is not None or r.EXPERIENCE_MAX_YEARS is not None:
        lo = r.EXPERIENCE_MIN_YEARS if r.EXPERIENCE_MIN_YEARS is not None else 0
        hi = r.EXPERIENCE_MAX_YEARS if r.EXPERIENCE_MAX_YEARS is not None else "+"
        experience = f"{lo} — {hi} years"

    body_html = f"""
    <html><body style="font-family:Segoe UI,sans-serif;color:#0f172a;
                       max-width:560px;margin:0 auto;padding:24px;">
      <div style="background:#c22c1f;color:white;padding:18px 22px;border-radius:10px 10px 0 0;">
        <div style="font-size:11px;letter-spacing:1.4px;opacity:0.7;text-transform:uppercase;">
          BVC24 ERP · Recruitment Requisition
        </div>
        <div style="font-size:20px;font-weight:700;margin-top:4px;">
          Approval requested — {r.POSITION_TITLE}
        </div>
      </div>
      <div style="background:white;padding:22px;border:1px solid #e2e8f0;
                  border-top:none;border-radius:0 0 10px 10px;">
        <table style="width:100%;font-size:14px;line-height:1.7;">
          {_row("Requisition #", r.REQ_CODE)}
          {_row("Position",      r.POSITION_TITLE)}
          {_row("Department",    r.DEPARTMENT)}
          {_row("Location",      r.LOCATION)}
          {_row("Headcount",     str(r.HEADCOUNT or 1))}
          {_row("Employment",    r.EMPLOYMENT_TYPE)}
          {_row("Experience",    experience)}
          {_row("Budget",        budget)}
          {_row("Urgency",       r.URGENCY)}
          {_row("Needed by",     r.NEEDED_BY_DATE.isoformat() if r.NEEDED_BY_DATE else None)}
          {_row("Raised by",     requester_name)}
        </table>
        {f'<div style="margin-top:14px;font-size:13px;color:#334155;'
         f'padding:10px 12px;background:#f8fafc;border-radius:6px;">'
         f'<strong>Justification:</strong><br>{r.JUSTIFICATION}</div>' if r.JUSTIFICATION else ''}
        <div style="margin-top:22px;display:flex;gap:10px;justify-content:center;">
          <a href="{approve_link}" style="background:#10b981;color:white;padding:12px 24px;
             border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
             ✓ Approve &amp; open job
          </a>
          <a href="{reject_link}" style="background:#ef4444;color:white;padding:12px 24px;
             border-radius:8px;text-decoration:none;font-weight:700;font-size:14px;">
             ✗ Reject
          </a>
        </div>
        <div style="margin-top:18px;font-size:12px;color:#94a3b8;text-align:center;">
          Approving will automatically create the job and open it for candidates.
        </div>
      </div>
    </body></html>
    """

    import logging
    log = logging.getLogger("uvicorn.error")
    try:
        ok, msg = send_alert_email(
            subject=f"[BVC24] Requisition approval — {r.POSITION_TITLE} ({r.REQ_CODE})",
            body_html=body_html,
            recipient=recipient,
        )
        if ok:
            log.info("requisition-approval email sent to %s for %s",
                     recipient, r.REQ_CODE)
        else:
            log.warning("requisition-approval email FAILED for %s to %s: %s",
                        r.REQ_CODE, recipient, msg)
    except Exception as exc:
        # Email failures never block the create call — but they DO log.
        log.warning("requisition-approval email crashed for %s: %s",
                    r.REQ_CODE, exc)


@router.post("/requisitions", dependencies=[Depends(require("recruitment.manage"))])
def create_requisition(payload: RequisitionCreate, db: Session = Depends(get_db)):

    if not payload.POSITION_TITLE.strip():
        raise HTTPException(status_code=400, detail="POSITION_TITLE is required.")

    needed = None
    if payload.NEEDED_BY_DATE:
        try:
            needed = date.fromisoformat(payload.NEEDED_BY_DATE)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="NEEDED_BY_DATE must be YYYY-MM-DD.")

    r = RecruitmentRequisition(
        REQ_CODE             = _next_req_code(db),
        POSITION_TITLE       = payload.POSITION_TITLE.strip(),
        DEPARTMENT           = (payload.DEPARTMENT or "").strip() or None,
        LOCATION             = (payload.LOCATION or "").strip() or None,
        EMPLOYMENT_TYPE      = payload.EMPLOYMENT_TYPE or "FULL_TIME",
        HEADCOUNT            = payload.HEADCOUNT or 1,
        EXPERIENCE_MIN_YEARS = payload.EXPERIENCE_MIN_YEARS or 0.0,
        EXPERIENCE_MAX_YEARS = payload.EXPERIENCE_MAX_YEARS,
        BUDGET_CTC_MIN       = payload.BUDGET_CTC_MIN,
        BUDGET_CTC_MAX       = payload.BUDGET_CTC_MAX,
        REQUIRED_SKILLS      = (payload.REQUIRED_SKILLS or "").strip() or None,
        PREFERRED_SKILLS     = (payload.PREFERRED_SKILLS or "").strip() or None,
        REQUIRED_EDUCATION   = (payload.REQUIRED_EDUCATION or "").strip() or None,
        JUSTIFICATION        = (payload.JUSTIFICATION or "").strip() or None,
        URGENCY              = payload.URGENCY or "NORMAL",
        NEEDED_BY_DATE       = needed,
        REQUESTED_BY_ID      = payload.REQUESTED_BY_ID or None,
        STATUS               = "PENDING",
        APPROVAL_TOKEN       = secrets.token_urlsafe(32),
        VENDOR_ID            = 1,
    )
    db.add(r)
    db.commit()
    db.refresh(r)

    # Email the MD with one-click approve / reject links.
    requester_name = None
    if r.REQUESTED_BY_ID:
        emp = db.query(Employee).filter(Employee.ID == r.REQUESTED_BY_ID).first()
        if emp:
            requester_name = emp.NAME
    _send_requisition_approval_email(r, requester_name)

    return _serialize_requisition(r, db)


@router.patch("/requisitions/{req_id}",
              dependencies=[Depends(require("recruitment.manage"))])
def update_requisition(req_id: int,
                       payload: RequisitionCreate,
                       db: Session = Depends(get_db)):
    """Edit a requisition. Only PENDING rows are mutable —
    APPROVED / CONVERTED / REJECTED rows are frozen so the audit
    trail (and any emails already sent) stays honest.

    Fields accepted are the same as create (POSITION_TITLE, etc.);
    any field left blank / null clears that column."""

    r = (db.query(RecruitmentRequisition)
           .filter(RecruitmentRequisition.ID == req_id).first())
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")

    if r.STATUS != "PENDING":
        raise HTTPException(
            status_code=400,
            detail=(
                f"Cannot edit a {r.STATUS} requisition. Only PENDING "
                "requisitions can be modified."
            ),
        )

    if not payload.POSITION_TITLE.strip():
        raise HTTPException(status_code=400, detail="POSITION_TITLE is required.")

    needed = None
    if payload.NEEDED_BY_DATE:
        try:
            needed = date.fromisoformat(payload.NEEDED_BY_DATE)
        except (TypeError, ValueError):
            raise HTTPException(status_code=400, detail="NEEDED_BY_DATE must be YYYY-MM-DD.")

    r.POSITION_TITLE       = payload.POSITION_TITLE.strip()
    r.DEPARTMENT           = (payload.DEPARTMENT or "").strip() or None
    r.LOCATION             = (payload.LOCATION or "").strip() or None
    r.EMPLOYMENT_TYPE      = payload.EMPLOYMENT_TYPE or "FULL_TIME"
    r.HEADCOUNT            = payload.HEADCOUNT or 1
    r.EXPERIENCE_MIN_YEARS = payload.EXPERIENCE_MIN_YEARS or 0.0
    r.EXPERIENCE_MAX_YEARS = payload.EXPERIENCE_MAX_YEARS
    r.BUDGET_CTC_MIN       = payload.BUDGET_CTC_MIN
    r.BUDGET_CTC_MAX       = payload.BUDGET_CTC_MAX
    r.REQUIRED_SKILLS      = (payload.REQUIRED_SKILLS or "").strip() or None
    r.PREFERRED_SKILLS     = (payload.PREFERRED_SKILLS or "").strip() or None
    r.REQUIRED_EDUCATION   = (payload.REQUIRED_EDUCATION or "").strip() or None
    r.JUSTIFICATION        = (payload.JUSTIFICATION or "").strip() or None
    r.URGENCY              = payload.URGENCY or "NORMAL"
    r.NEEDED_BY_DATE       = needed
    if payload.REQUESTED_BY_ID:
        r.REQUESTED_BY_ID  = payload.REQUESTED_BY_ID

    db.commit()
    db.refresh(r)
    return _serialize_requisition(r, db)


def _convert_requisition_to_job_row(r: RecruitmentRequisition,
                                    db: Session) -> RecruitmentJob:
    """Shared conversion — used by manual convert AND email-approve."""
    job = RecruitmentJob(
        JOB_CODE             = next_code("JOB", db, RecruitmentJob, "JOB_CODE"),
        TITLE                = r.POSITION_TITLE,
        DEPARTMENT           = r.DEPARTMENT,
        LOCATION             = r.LOCATION,
        EMPLOYMENT_TYPE      = r.EMPLOYMENT_TYPE or "FULL_TIME",
        EXPERIENCE_MIN_YEARS = r.EXPERIENCE_MIN_YEARS or 0.0,
        EXPERIENCE_MAX_YEARS = r.EXPERIENCE_MAX_YEARS,
        SALARY_MIN           = r.BUDGET_CTC_MIN,
        SALARY_MAX           = r.BUDGET_CTC_MAX,
        REQUIRED_SKILLS      = r.REQUIRED_SKILLS,
        PREFERRED_SKILLS     = r.PREFERRED_SKILLS,
        REQUIRED_EDUCATION   = r.REQUIRED_EDUCATION,
        DESCRIPTION          = r.JUSTIFICATION,
        STATUS               = "OPEN",
        OPENINGS             = r.HEADCOUNT or 1,
        OPENED_AT            = datetime.now(),
        CREATED_BY_ID        = r.REQUESTED_BY_ID,
        VENDOR_ID            = r.VENDOR_ID or 1,
    )
    db.add(job)
    db.flush()
    r.STATUS           = "CONVERTED"
    r.APPROVED_AT      = r.APPROVED_AT or datetime.now()
    r.CONVERTED_AT     = datetime.now()
    r.CONVERTED_JOB_ID = job.ID
    r.APPROVAL_TOKEN   = None
    return job


def _decide_html_page(title: str, message: str, colour: str = "#10b981") -> str:
    return f"""
    <!doctype html><html><head><meta charset="utf-8"><title>{title}</title></head>
    <body style="font-family:Segoe UI,sans-serif;background:#f8fafc;margin:0;
                 min-height:100vh;display:flex;align-items:center;justify-content:center;">
      <div style="background:white;padding:40px 44px;border-radius:12px;
                  border:1px solid #e2e8f0;max-width:520px;text-align:center;
                  box-shadow:0 10px 30px rgba(0,0,0,0.05);">
        <div style="font-size:44px;color:{colour};margin-bottom:12px;">●</div>
        <h1 style="margin:0 0 12px;font-size:22px;color:#0f172a;">{title}</h1>
        <p style="margin:0;color:#475569;font-size:14.5px;line-height:1.6;">{message}</p>
      </div>
    </body></html>
    """


@router.get("/requisitions/decide/{token}")
def decide_requisition_by_token(
    token: str,
    action: str,
    db: Session = Depends(get_db),
):
    """Public one-click approve / reject from the MD's email.
    Uses a one-shot token — invalidated after use.
    On `approve`, the requisition is also auto-converted into an
    OPEN RecruitmentJob so HR does not have to click a second button.
    """
    from fastapi.responses import HTMLResponse

    action = (action or "").strip().lower()
    if action not in ("approve", "reject"):
        return HTMLResponse(
            _decide_html_page(
                "Invalid action",
                "The link is malformed. Please open the email again.",
                colour="#94a3b8",
            ),
            status_code=400,
        )

    r = (db.query(RecruitmentRequisition)
           .filter(RecruitmentRequisition.APPROVAL_TOKEN == token)
           .first())
    if not r:
        return HTMLResponse(
            _decide_html_page(
                "Link expired",
                "This approval link is no longer valid — the requisition may "
                "already have been decided from another device.",
                colour="#94a3b8",
            ),
            status_code=200,
        )

    if r.STATUS not in ("PENDING",):
        return HTMLResponse(
            _decide_html_page(
                "Already decided",
                f"This requisition is already <strong>{r.STATUS}</strong>.",
                colour="#94a3b8",
            ),
            status_code=200,
        )

    if action == "approve":
        r.STATUS         = "APPROVED"
        r.APPROVED_AT    = datetime.now()
        r.APPROVAL_TOKEN = None
        db.commit()
        return HTMLResponse(_decide_html_page(
            "Requisition approved",
            f"<strong>{r.REQ_CODE}</strong> — {r.POSITION_TITLE} is now "
            "approved. HR can open the Recruitment page and click "
            "<strong>Convert to Job</strong> to publish it.",
            colour="#10b981",
        ))

    # reject
    r.STATUS         = "REJECTED"
    r.REJECTED_AT    = datetime.now()
    r.APPROVAL_TOKEN = None
    db.commit()
    return HTMLResponse(_decide_html_page(
        "Requisition rejected",
        f"<strong>{r.REQ_CODE}</strong> — {r.POSITION_TITLE} has been "
        "rejected. HR has been informed.",
        colour="#ef4444",
    ))


@router.post("/requisitions/{req_id}/approve", dependencies=[Depends(require("recruitment.manage"))])
def approve_requisition(req_id: int, db: Session = Depends(get_db)):
    """HR approve from the dashboard. Flips status to APPROVED — the
    Convert-to-Job step remains separate so HR can review before
    publishing. Same behaviour as clicking Approve in the email."""
    r = db.query(RecruitmentRequisition).filter(RecruitmentRequisition.ID == req_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    if r.STATUS != "PENDING":
        raise HTTPException(status_code=400, detail=f"Requisition is already {r.STATUS}.")
    r.STATUS         = "APPROVED"
    r.APPROVED_AT    = datetime.now()
    r.APPROVAL_TOKEN = None
    db.commit()
    db.refresh(r)
    return _serialize_requisition(r, db)


@router.post("/requisitions/{req_id}/reject", dependencies=[Depends(require("recruitment.manage"))])
def reject_requisition(req_id: int, payload: RequisitionReject, db: Session = Depends(get_db)):
    r = db.query(RecruitmentRequisition).filter(RecruitmentRequisition.ID == req_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    if r.STATUS not in ("PENDING", "APPROVED"):
        raise HTTPException(status_code=400, detail=f"Requisition is already {r.STATUS}.")
    r.STATUS = "REJECTED"
    r.REJECTED_AT = datetime.now()
    r.REJECTION_REASON = (payload.REJECTION_REASON or "").strip() or None
    db.commit()
    db.refresh(r)
    return _serialize_requisition(r, db)


@router.post("/requisitions/{req_id}/convert", dependencies=[Depends(require("recruitment.manage"))])
def convert_requisition_to_job(req_id: int, db: Session = Depends(get_db)):
    """Turn an APPROVED requisition into an OPEN RecruitmentJob row.
    The requisition is marked CONVERTED and linked to the new job."""

    r = db.query(RecruitmentRequisition).filter(RecruitmentRequisition.ID == req_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    if r.STATUS != "APPROVED":
        raise HTTPException(
            status_code=400,
            detail=f"Only APPROVED requisitions can be converted (this one is {r.STATUS}).",
        )
    if r.CONVERTED_JOB_ID:
        raise HTTPException(status_code=400, detail="Requisition already converted.")

    job = RecruitmentJob(
        JOB_CODE             = next_code("JOB", db, RecruitmentJob, "JOB_CODE"),
        TITLE                = r.POSITION_TITLE,
        DEPARTMENT           = r.DEPARTMENT,
        LOCATION             = r.LOCATION,
        EMPLOYMENT_TYPE      = r.EMPLOYMENT_TYPE or "FULL_TIME",
        EXPERIENCE_MIN_YEARS = r.EXPERIENCE_MIN_YEARS or 0.0,
        EXPERIENCE_MAX_YEARS = r.EXPERIENCE_MAX_YEARS,
        SALARY_MIN           = r.BUDGET_CTC_MIN,
        SALARY_MAX           = r.BUDGET_CTC_MAX,
        REQUIRED_SKILLS      = r.REQUIRED_SKILLS,
        PREFERRED_SKILLS     = r.PREFERRED_SKILLS,
        REQUIRED_EDUCATION   = r.REQUIRED_EDUCATION,
        DESCRIPTION          = r.JUSTIFICATION,
        STATUS               = "OPEN",
        OPENINGS             = r.HEADCOUNT or 1,
        OPENED_AT            = datetime.now(),
        CREATED_BY_ID        = r.REQUESTED_BY_ID,
        VENDOR_ID            = r.VENDOR_ID or 1,
    )
    db.add(job)
    db.flush()

    r.STATUS = "CONVERTED"
    r.CONVERTED_AT = datetime.now()
    r.CONVERTED_JOB_ID = job.ID

    db.commit()
    db.refresh(r)
    db.refresh(job)

    return {
        "requisition": _serialize_requisition(r, db),
        "job_id":      job.ID,
        "job_code":    job.JOB_CODE,
    }


@router.delete("/requisitions/{req_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_requisition(req_id: int, db: Session = Depends(get_db)):
    """Remove a requisition row. If the row is already CONVERTED, the
    linked Job is NOT touched — it continues to live in the Jobs tab
    with its candidates, interviews and offers intact. Deletion only
    removes the requisition record itself so HR can clean the queue.
    """
    r = db.query(RecruitmentRequisition).filter(RecruitmentRequisition.ID == req_id).first()
    if not r:
        raise HTTPException(status_code=404, detail="Requisition not found")
    db.delete(r)
    db.commit()
    return {"ok": True, "id": req_id}


# ---------------------------------------------------------------------
# Delete endpoints for every recruitment sub-entity.
# ---------------------------------------------------------------------
# HR sometimes needs to clean the queue — a duplicate job, an old
# candidate, a cancelled interview. Each delete cascades to its
# children so the DB never ends up with orphans:
#
#   Job        → its Applications, Interviews, Offers
#   Candidate  → its Applications, Interviews, Offers
#   Application (Pipeline) → its Interviews, Offers
#   Interview  → self only
#   Offer      → self only
# ---------------------------------------------------------------------


@router.delete("/jobs/{job_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_job(job_id: int, db: Session = Depends(get_db)):
    """Delete a job and everything hanging off it: applications,
    interviews, offers. Any requisition that produced this job is
    left in place and its CONVERTED_JOB_ID is cleared so HR can
    still see the history."""
    job = db.query(RecruitmentJob).filter(RecruitmentJob.ID == job_id).first()
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")

    app_ids = [a.ID for a in db.query(CandidateApplication)
                              .filter(CandidateApplication.JOB_ID == job_id).all()]
    if app_ids:
        db.query(OfferLetter).filter(OfferLetter.APPLICATION_ID.in_(app_ids)).delete(synchronize_session=False)
        db.query(Interview).filter(Interview.APPLICATION_ID.in_(app_ids)).delete(synchronize_session=False)
        db.query(CandidateApplication).filter(CandidateApplication.ID.in_(app_ids)).delete(synchronize_session=False)

    (db.query(RecruitmentRequisition)
        .filter(RecruitmentRequisition.CONVERTED_JOB_ID == job_id)
        .update({"CONVERTED_JOB_ID": None}, synchronize_session=False))

    db.delete(job)
    db.commit()
    return {"ok": True, "id": job_id}


@router.delete("/candidates/{candidate_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_candidate(candidate_id: int, db: Session = Depends(get_db)):
    """Delete a candidate and every application/interview/offer that
    references them. Use when HR wants to purge a duplicate profile."""
    cand = db.query(Candidate).filter(Candidate.ID == candidate_id).first()
    if not cand:
        raise HTTPException(status_code=404, detail="Candidate not found")

    app_ids = [a.ID for a in db.query(CandidateApplication)
                              .filter(CandidateApplication.CANDIDATE_ID == candidate_id).all()]
    if app_ids:
        db.query(OfferLetter).filter(OfferLetter.APPLICATION_ID.in_(app_ids)).delete(synchronize_session=False)
        db.query(Interview).filter(Interview.APPLICATION_ID.in_(app_ids)).delete(synchronize_session=False)
        db.query(CandidateApplication).filter(CandidateApplication.ID.in_(app_ids)).delete(synchronize_session=False)

    db.delete(cand)
    db.commit()
    return {"ok": True, "id": candidate_id}


@router.delete("/applications/{app_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_application(app_id: int, db: Session = Depends(get_db)):
    """Delete one Pipeline row (a candidate ↔ job link) and its
    dependent interviews / offers. Job and Candidate stay in place."""
    app_row = db.query(CandidateApplication).filter(CandidateApplication.ID == app_id).first()
    if not app_row:
        raise HTTPException(status_code=404, detail="Application not found")

    db.query(OfferLetter).filter(OfferLetter.APPLICATION_ID == app_id).delete(synchronize_session=False)
    db.query(Interview).filter(Interview.APPLICATION_ID == app_id).delete(synchronize_session=False)

    db.delete(app_row)
    db.commit()
    return {"ok": True, "id": app_id}


@router.delete("/interviews/{iv_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_interview(iv_id: int, db: Session = Depends(get_db)):
    iv = db.query(Interview).filter(Interview.ID == iv_id).first()
    if not iv:
        raise HTTPException(status_code=404, detail="Interview not found")
    db.delete(iv)
    db.commit()
    return {"ok": True, "id": iv_id}


@router.delete("/offers/{offer_id}", dependencies=[Depends(require("recruitment.manage"))])
def delete_offer(offer_id: int, db: Session = Depends(get_db)):
    off = db.query(OfferLetter).filter(OfferLetter.ID == offer_id).first()
    if not off:
        raise HTTPException(status_code=404, detail="Offer not found")
    db.delete(off)
    db.commit()
    return {"ok": True, "id": offer_id}


# =====================================================================
# Offer letter — one-click Accept / Reject from the candidate's inbox
# ---------------------------------------------------------------------
# When HR clicks Send, we generate a unique RESPONSE_TOKEN and stitch
# two large buttons into the email body linking to /decide/{token}.
# The candidate clicks one → the offer status updates + a styled HTML
# confirmation page is shown. The token is invalidated after use so
# the decision can't be flipped by reloading the link.
# =====================================================================

def _decision_buttons_html(accept_url: str, reject_url: str) -> str:
    """HTML fragment appended to the offer email — two big buttons
    styled with inline CSS (email clients strip <style> blocks)."""
    return f"""
<div style="margin:28px 0 12px 0;padding:22px;background:#f9fafb;
            border:1px solid #e5e7eb;border-radius:10px;text-align:center;">
  <p style="margin:0 0 16px 0;font-size:14px;color:#374151;">
    Please review the attached offer letter and respond below.
  </p>
  <table role="presentation" style="margin:0 auto;border-collapse:separate;border-spacing:10px;">
    <tr>
      <td>
        <a href="{accept_url}"
           style="display:inline-block;padding:14px 32px;background:#16a34a;
                  color:#ffffff;text-decoration:none;border-radius:8px;
                  font-weight:700;font-size:15px;
                  box-shadow:0 2px 4px rgba(22,163,74,0.3);">
          ✓ Accept Offer
        </a>
      </td>
      <td>
        <a href="{reject_url}"
           style="display:inline-block;padding:14px 32px;background:#dc2626;
                  color:#ffffff;text-decoration:none;border-radius:8px;
                  font-weight:700;font-size:15px;
                  box-shadow:0 2px 4px rgba(220,38,38,0.3);">
          ✗ Decline Offer
        </a>
      </td>
    </tr>
  </table>
  <p style="margin:14px 0 0 0;font-size:11px;color:#9ca3af;">
    Clicking either button records your response immediately. HR is
    notified in real time and the recruitment portal updates.
  </p>
</div>
"""


def _decision_page_html(title: str, message: str, color: str = "#16a34a") -> str:
    """Small standalone confirmation page shown after the candidate
    clicks Accept / Reject. Kept self-contained so it renders even
    when the ERP frontend isn't reachable from the candidate's
    network."""
    return f"""<!doctype html>
<html><head><meta charset="utf-8"/><title>{title}</title></head>
<body style="font-family:Arial,sans-serif;background:#f8fafc;
             color:#111827;margin:0;padding:40px 20px;">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;
              border-radius:12px;padding:32px;text-align:center;
              box-shadow:0 4px 16px rgba(0,0,0,0.08);">
    <div style="width:56px;height:56px;border-radius:50%;background:{color};
                color:#ffffff;line-height:56px;font-size:28px;font-weight:700;
                margin:0 auto 16px auto;">
      &#10003;
    </div>
    <h1 style="margin:0 0 12px 0;color:{color};font-size:22px;">{title}</h1>
    <p style="margin:0;font-size:14px;line-height:1.6;color:#374151;">
      {message}
    </p>
    <p style="margin:22px 0 0 0;font-size:12px;color:#9ca3af;">
      You can now close this window.
    </p>
  </div>
</body></html>
"""


from fastapi.responses import HTMLResponse


def _decision_buttons_html(accept_url: str, reject_url: str) -> str:
    """Two large buttons stitched onto the end of the offer email
    body. Uses table-based layout so it renders reliably in Gmail /
    Outlook / Apple Mail."""

    return f"""
<div style="margin-top:26px;padding:18px 20px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;text-align:center;">
  <p style="margin:0 0 14px 0;font-size:14px;color:#334155;">
    Please review the attached offer letter and respond below.
  </p>
  <table role="presentation" style="margin:0 auto;border-collapse:separate;border-spacing:8px;">
    <tr>
      <td>
        <a href="{accept_url}"
           style="display:inline-block;padding:12px 24px;background:#16a34a;color:#ffffff;
                  text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;
                  box-shadow:0 2px 4px rgba(22,163,74,0.3);">
          &#10003; Accept Offer
        </a>
      </td>
      <td>
        <a href="{reject_url}"
           style="display:inline-block;padding:12px 24px;background:#dc2626;color:#ffffff;
                  text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;
                  box-shadow:0 2px 4px rgba(220,38,38,0.3);">
          &#10005; Decline Offer
        </a>
      </td>
    </tr>
  </table>
  <p style="margin:12px 0 0 0;font-size:11px;color:#94a3b8;">
    Clicking either button records your response immediately. HR is
    notified in real time and the recruitment portal updates.
  </p>
</div>
"""


def _decision_page_html(title: str, message: str, color: str = "#0f172a") -> str:
    """Styled full-page confirmation shown after the candidate clicks
    Accept or Reject. Kept simple so it renders on any browser."""

    safe_message = message  # already HTML-safe in every caller

    return f"""<!doctype html>
<html><head>
<meta charset="utf-8" />
<title>{title}</title>
<style>
  body {{ margin:0; padding:40px 20px; font-family: system-ui,
         -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial,
         sans-serif; background:#f8fafc; color:#0f172a; }}
  .card {{ max-width:560px; margin:60px auto; background:#ffffff;
          border:1px solid #e2e8f0; border-radius:14px; padding:36px;
          box-shadow: 0 4px 14px rgba(0,0,0,0.06); }}
  .bar {{ width:56px; height:5px; border-radius:3px; margin-bottom:20px; }}
  h1 {{ margin:0 0 12px 0; font-size:22px; font-weight:700; }}
  p  {{ margin:0; font-size:15px; line-height:1.55; color:#475569; }}
</style>
</head><body>
  <div class="card">
    <div class="bar" style="background:{color};"></div>
    <h1 style="color:{color};">{title}</h1>
    <p>{safe_message}</p>
  </div>
</body></html>"""


@router.get("/offers/decide/{token}", response_class=HTMLResponse)
def decide_offer(
    token: str,
    action: str = Query(..., pattern="^(accept|reject)$"),
    db: Session = Depends(get_db),
):
    """Public endpoint clicked from the candidate's email. Flips the
    offer status to ACCEPTED / REJECTED, invalidates the token, and
    returns a styled confirmation page."""

    o = (
        db.query(OfferLetter)
        .filter(OfferLetter.RESPONSE_TOKEN == token)
        .first()
    )

    if not o:
        return HTMLResponse(
            _decision_page_html(
                "Link expired or invalid",
                "This response link is no longer valid. It may have "
                "already been used or the offer may have been withdrawn.",
                color="#ef4444",
            ),
            status_code=404,
        )

    if o.STATUS in ("ACCEPTED", "REJECTED"):
        return HTMLResponse(
            _decision_page_html(
                "Already responded",
                f"You've already responded to this offer — status is "
                f"currently <b>{o.STATUS}</b>. If this looks wrong, "
                f"please email HR.",
                color="#64748b",
            ),
            status_code=200,
        )

    new_status = "ACCEPTED" if action == "accept" else "REJECTED"
    o.STATUS = new_status
    o.RESPONDED_AT = datetime.utcnow()
    # One-time use.
    o.RESPONSE_TOKEN = None

    # If accepted, auto-close the linked job as FILLED (best-effort).
    if new_status == "ACCEPTED":
        try:
            app = db.query(CandidateApplication).filter(
                CandidateApplication.ID == o.APPLICATION_ID
            ).first()
            if app and app.JOB_ID:
                job = db.query(RecruitmentJob).filter(
                    RecruitmentJob.ID == app.JOB_ID
                ).first()
                if job and job.STATUS == "OPEN":
                    job.STATUS = "FILLED"
                    job.CLOSED_AT = datetime.utcnow()
        except Exception:
            pass

    db.commit()

    # Fire an in-app notification so HR sees it on the admin dashboard.
    try:
        from app.models.models import Notification
        candidate_label = ""
        try:
            app = db.query(CandidateApplication).filter(
                CandidateApplication.ID == o.APPLICATION_ID
            ).first()
            if app:
                cand = db.query(Candidate).filter(
                    Candidate.ID == app.CANDIDATE_ID
                ).first()
                if cand:
                    candidate_label = f"{cand.FULL_NAME} ({cand.EMAIL or '—'})"
        except Exception:
            pass

        verb = "accepted" if new_status == "ACCEPTED" else "declined"
        db.add(Notification(
            EMPLOYEE_ID=None,
            TITLE=f"Offer {verb}",
            MESSAGE=(
                f"{candidate_label or 'Candidate'} {verb} offer "
                f"{o.OFFER_NUMBER or o.ID} for {o.JOB_TITLE or 'position'}."
            ),
            TYPE="OFFER_RESPONSE",
            IS_READ=0,
            VENDOR_ID=1,
            CREATED_AT=datetime.utcnow(),
        ))
        db.commit()
    except Exception:
        db.rollback()

    if new_status == "ACCEPTED":
        return HTMLResponse(
            _decision_page_html(
                "Offer accepted",
                "Thank you for accepting the offer. HR has been "
                "notified and will reach out to you shortly with the "
                "next steps for onboarding.",
                color="#16a34a",
            ),
        )
    else:
        return HTMLResponse(
            _decision_page_html(
                "Offer declined",
                "You've declined the offer. HR has been notified. If "
                "you'd like to discuss this decision, please reply to "
                "the offer email.",
                color="#dc2626",
            ),
        )
