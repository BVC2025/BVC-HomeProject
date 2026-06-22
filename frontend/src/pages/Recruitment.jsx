// =====================================================================
// Recruitment — Phase 2 AI Recruitment Assistant.
//
// One page with three views:
//   • Jobs       — open positions + ranked candidate leaderboard
//   • Candidates — uploaded resumes + parsed profile
//   • Pipeline   — applications (candidate <-> job) with screening
// =====================================================================

import { useEffect, useMemo, useRef, useState } from "react";
import API from "../services/api";


const BVC_RED  = "#C8102E";
const BVC_DARK = "#7A1022";
const BVC_GOLD = "#F4B324";

const BACKEND_URL = API.defaults.baseURL || "http://127.0.0.1:8001";


const STATUS_THEME = {
  OPEN:      { bg: "#dcfce7", fg: "#166534" },
  ON_HOLD:   { bg: "#fef3c7", fg: "#854d0e" },
  FILLED:    { bg: "#dbeafe", fg: "#1e40af" },
  CANCELLED: { bg: "#fee2e2", fg: "#991b1b" },

  NEW:           { bg: "#dbeafe", fg: "#1e40af" },
  SCREENED:      { bg: "#e0e7ff", fg: "#3730a3" },
  SHORTLISTED:   { bg: "#fef3c7", fg: "#854d0e" },
  INTERVIEWING:  { bg: "#fef3c7", fg: "#854d0e" },
  OFFERED:       { bg: "#fce7f3", fg: "#9d174d" },
  HIRED:         { bg: "#dcfce7", fg: "#166534" },
  REJECTED:      { bg: "#fee2e2", fg: "#991b1b" },
  ON_HOLD2:      { bg: "#f1f5f9", fg: "#475569" },

  HIGHLY_SUITABLE:     { bg: "#dcfce7", fg: "#166534" },
  SUITABLE:            { bg: "#dbeafe", fg: "#1e40af" },
  PARTIALLY_SUITABLE:  { bg: "#fef3c7", fg: "#854d0e" },
  NOT_SUITABLE:        { bg: "#fee2e2", fg: "#991b1b" },
  PENDING:             { bg: "#f1f5f9", fg: "#475569" },
};


function Pill({ status }) {
  const t = STATUS_THEME[status] || { bg: "#f1f5f9", fg: "#475569" };
  return (
    <span style={{
      display: "inline-block", padding: "3px 10px", borderRadius: 999,
      fontSize: 10, fontWeight: 800, background: t.bg, color: t.fg,
      letterSpacing: 0.4,
    }}>
      {status?.replace(/_/g, " ") || "—"}
    </span>
  );
}


export default function Recruitment() {

  const [tab, setTab] = useState("jobs");

  return (
    <div style={{ padding: 20, background: "#f1f5f9", minHeight: "calc(100vh - 80px)" }}>
      {/* Hero */}
      <div style={{
        background: `linear-gradient(135deg, ${BVC_DARK} 0%, ${BVC_RED} 100%)`,
        borderRadius: 16, padding: "20px 26px", color: "white",
        marginBottom: 18,
      }}>
        <div style={{
          fontSize: 11, fontWeight: 800, letterSpacing: 2,
          color: BVC_GOLD, textTransform: "uppercase",
        }}>
          BVC24 · AI Recruitment
        </div>
        <div style={{ fontSize: 24, fontWeight: 900, marginTop: 4 }}>
          Recruitment Assistant
        </div>
        <div style={{ fontSize: 12, opacity: 0.85, marginTop: 4 }}>
          Resume parsing · Candidate screening · Interview scheduling · Ranking · Offer letters
        </div>
      </div>

      {/* Tab bar */}
      <div style={{
        background: "white", borderRadius: 12, padding: 6,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        marginBottom: 18, display: "flex", gap: 4,
      }}>
        {[
          { key: "jobs",       label: "Jobs" },
          { key: "candidates", label: "Candidates" },
          { key: "pipeline",   label: "Pipeline" },
          { key: "interviews", label: "Interviews" },
          { key: "offers",     label: "Offers" },
        ].map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            style={{
              padding: "9px 18px",
              background: tab === t.key ? BVC_DARK : "transparent",
              color: tab === t.key ? "white" : "#475569",
              border: "none", borderRadius: 8,
              fontWeight: 700, fontSize: 13, cursor: "pointer",
              letterSpacing: -0.005 + "em",
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "jobs"       && <JobsTab />}
      {tab === "candidates" && <CandidatesTab />}
      {tab === "pipeline"   && <PipelineTab />}
      {tab === "interviews" && <InterviewsTab />}
      {tab === "offers"     && <OffersTab />}
    </div>
  );
}


// =====================================================================
// JOBS TAB
// =====================================================================

function JobsTab() {
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openingForm, setOpeningForm] = useState(false);
  const [focusJob, setFocusJob] = useState(null);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/jobs")
      .then((r) => setJobs(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        <button onClick={() => setOpeningForm(true)} style={btnPrimary}>
          + New Job
        </button>
      </div>

      {loading && <Spinner />}

      {!loading && jobs.length === 0 && (
        <EmptyState text="No jobs yet. Click + New Job to post your first opening." />
      )}

      {!loading && jobs.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))", gap: 14 }}>
          {jobs.map((j) => (
            <JobCard key={j.ID} job={j} onOpen={() => setFocusJob(j)} />
          ))}
        </div>
      )}

      {openingForm && (
        <JobForm
          onClose={() => setOpeningForm(false)}
          onSaved={() => { setOpeningForm(false); load(); }}
        />
      )}
      {focusJob && (
        <JobDetailDrawer
          job={focusJob}
          onClose={() => setFocusJob(null)}
          onChange={load}
        />
      )}
    </div>
  );
}


function JobCard({ job, onOpen }) {
  return (
    <div
      onClick={onOpen}
      style={{
        background: "white", border: "1px solid #e2e8f0", borderRadius: 14,
        padding: 16, cursor: "pointer",
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {job.JOB_CODE}
          </div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#0f172a", marginTop: 2 }}>
            {job.TITLE}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 4 }}>
            {[job.DEPARTMENT, job.LOCATION, job.EMPLOYMENT_TYPE].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Pill status={job.STATUS} />
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
        {(job.EXPERIENCE_MIN_YEARS || job.EXPERIENCE_MAX_YEARS) && (
          <div>Experience: <b>
            {job.EXPERIENCE_MIN_YEARS || 0}
            {job.EXPERIENCE_MAX_YEARS ? `–${job.EXPERIENCE_MAX_YEARS}` : "+"} years
          </b></div>
        )}
        {job.REQUIRED_SKILLS && (
          <div style={{ marginTop: 4 }}>
            <b>Skills:</b> {job.REQUIRED_SKILLS.split(",").slice(0, 4).join(", ")}
            {job.REQUIRED_SKILLS.split(",").length > 4 ? "…" : ""}
          </div>
        )}
        <div style={{ marginTop: 4 }}>Openings: <b>{job.OPENINGS}</b></div>
      </div>
    </div>
  );
}


function JobDetailDrawer({ job, onClose, onChange }) {
  const [ranked, setRanked] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    API.get(`/recruitment/jobs/${job.ID}/ranked-candidates`)
      .then((r) => setRanked(r.data || []))
      .finally(() => setLoading(false));
  }, [job.ID]);

  return (
    <Drawer onClose={onClose} width={700}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
          {job.JOB_CODE}
        </div>
        <div style={{ fontSize: 22, fontWeight: 800, color: "#0f172a" }}>{job.TITLE}</div>
        <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
          {[job.DEPARTMENT, job.LOCATION, job.EMPLOYMENT_TYPE].filter(Boolean).join(" · ")}
        </div>
      </div>

      <SectionTitle>Requirements</SectionTitle>
      <FieldRow label="Experience"  value={`${job.EXPERIENCE_MIN_YEARS || 0}${job.EXPERIENCE_MAX_YEARS ? `–${job.EXPERIENCE_MAX_YEARS}` : "+"} year(s)`} />
      <FieldRow label="Education"   value={job.REQUIRED_EDUCATION} />
      <FieldRow label="Skills"      value={job.REQUIRED_SKILLS} />
      <FieldRow label="Nice-to-have" value={job.PREFERRED_SKILLS} />
      <FieldRow label="Salary range" value={
        job.SALARY_MIN || job.SALARY_MAX
          ? `₹${(job.SALARY_MIN || 0).toLocaleString("en-IN")} – ₹${(job.SALARY_MAX || 0).toLocaleString("en-IN")}`
          : "—"
      } />
      {job.DESCRIPTION && (
        <div style={{ marginTop: 12, padding: 12, background: "#f8fafc", borderRadius: 8, fontSize: 13, whiteSpace: "pre-wrap" }}>
          {job.DESCRIPTION}
        </div>
      )}

      <SectionTitle>Ranked candidates ({ranked.length})</SectionTitle>
      {loading && <Spinner />}
      {!loading && ranked.length === 0 && (
        <EmptyState text="No candidates applied yet. Add candidates from the Pipeline tab." small />
      )}
      {!loading && ranked.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={th}>
                <th style={cell}>#</th>
                <th style={cell}>Candidate</th>
                <th style={{ ...cell, textAlign: "right" }}>Weighted</th>
                <th style={{ ...cell, textAlign: "right" }}>Skill</th>
                <th style={{ ...cell, textAlign: "right" }}>Exp</th>
                <th style={{ ...cell, textAlign: "right" }}>Edu</th>
                <th style={cell}>Verdict</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((r) => (
                <tr key={r.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={cell}><b>{r.RANK}</b></td>
                  <td style={cell}>
                    <div style={{ fontWeight: 700 }}>{r.CANDIDATE_NAME}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                      {r.CANDIDATE_CODE}
                    </div>
                  </td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{r.WEIGHTED_SCORE}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.SKILL_MATCH_PCT}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.EXPERIENCE_MATCH_PCT}</td>
                  <td style={{ ...cell, textAlign: "right" }}>{r.EDUCATION_MATCH_PCT}</td>
                  <td style={cell}><Pill status={r.SCREENING_STATUS} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Drawer>
  );
}


function JobForm({ onClose, onSaved }) {
  const [form, setForm] = useState({
    TITLE: "", DEPARTMENT: "", LOCATION: "", EMPLOYMENT_TYPE: "FULL_TIME",
    EXPERIENCE_MIN_YEARS: 0, EXPERIENCE_MAX_YEARS: "",
    SALARY_MIN: "", SALARY_MAX: "",
    REQUIRED_SKILLS: "", PREFERRED_SKILLS: "", REQUIRED_EDUCATION: "",
    DESCRIPTION: "", OPENINGS: 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");

  const submit = async () => {
    if (!form.TITLE.trim()) { setError("Title is required"); return; }
    setSaving(true); setError("");
    try {
      const payload = { ...form };
      ["EXPERIENCE_MAX_YEARS", "SALARY_MIN", "SALARY_MAX"].forEach((k) => {
        payload[k] = payload[k] === "" ? null : Number(payload[k]);
      });
      payload.EXPERIENCE_MIN_YEARS = Number(payload.EXPERIENCE_MIN_YEARS) || 0;
      payload.OPENINGS = Number(payload.OPENINGS) || 1;
      await API.post("/recruitment/jobs", payload);
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Save failed");
    } finally { setSaving(false); }
  };

  return (
    <Drawer onClose={onClose} width={620} title="New Job Opening">
      <Field label="Title *">
        <input value={form.TITLE} onChange={(e) => setForm({ ...form, TITLE: e.target.value })} style={input} placeholder="e.g. Senior Mechanical Engineer" />
      </Field>
      <Row>
        <Field label="Department">
          <input value={form.DEPARTMENT} onChange={(e) => setForm({ ...form, DEPARTMENT: e.target.value })} style={input} />
        </Field>
        <Field label="Location">
          <input value={form.LOCATION} onChange={(e) => setForm({ ...form, LOCATION: e.target.value })} style={input} placeholder="Coimbatore" />
        </Field>
      </Row>
      <Row>
        <Field label="Employment type">
          <select value={form.EMPLOYMENT_TYPE} onChange={(e) => setForm({ ...form, EMPLOYMENT_TYPE: e.target.value })} style={input}>
            <option value="FULL_TIME">Full-time</option>
            <option value="PART_TIME">Part-time</option>
            <option value="CONTRACT">Contract</option>
            <option value="INTERN">Intern</option>
          </select>
        </Field>
        <Field label="Openings">
          <input type="number" min="1" value={form.OPENINGS} onChange={(e) => setForm({ ...form, OPENINGS: e.target.value })} style={input} />
        </Field>
      </Row>
      <Row>
        <Field label="Experience min (yrs)">
          <input type="number" min="0" step="0.5" value={form.EXPERIENCE_MIN_YEARS} onChange={(e) => setForm({ ...form, EXPERIENCE_MIN_YEARS: e.target.value })} style={input} />
        </Field>
        <Field label="Experience max (yrs)">
          <input type="number" min="0" step="0.5" value={form.EXPERIENCE_MAX_YEARS} onChange={(e) => setForm({ ...form, EXPERIENCE_MAX_YEARS: e.target.value })} style={input} />
        </Field>
      </Row>
      <Row>
        <Field label="Salary min (₹/year)">
          <input type="number" min="0" value={form.SALARY_MIN} onChange={(e) => setForm({ ...form, SALARY_MIN: e.target.value })} style={input} />
        </Field>
        <Field label="Salary max (₹/year)">
          <input type="number" min="0" value={form.SALARY_MAX} onChange={(e) => setForm({ ...form, SALARY_MAX: e.target.value })} style={input} />
        </Field>
      </Row>
      <Field label="Required skills (comma-separated)">
        <input value={form.REQUIRED_SKILLS} onChange={(e) => setForm({ ...form, REQUIRED_SKILLS: e.target.value })} style={input} placeholder="Python, FastAPI, MySQL, Docker" />
      </Field>
      <Field label="Preferred skills (comma-separated)">
        <input value={form.PREFERRED_SKILLS} onChange={(e) => setForm({ ...form, PREFERRED_SKILLS: e.target.value })} style={input} placeholder="React, AWS" />
      </Field>
      <Field label="Required education">
        <input value={form.REQUIRED_EDUCATION} onChange={(e) => setForm({ ...form, REQUIRED_EDUCATION: e.target.value })} style={input} placeholder="B.E. / B.Tech" />
      </Field>
      <Field label="Description">
        <textarea rows={4} value={form.DESCRIPTION} onChange={(e) => setForm({ ...form, DESCRIPTION: e.target.value })} style={{ ...input, resize: "vertical" }} />
      </Field>

      {error && <div style={errBox}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          {saving ? "Saving..." : "Create Job"}
        </button>
      </div>
    </Drawer>
  );
}


// =====================================================================
// CANDIDATES TAB
// =====================================================================

function CandidatesTab() {
  const [candidates, setCandidates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState(null);
  const fileRef = useRef(null);
  const [uploading, setUploading] = useState(false);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/candidates")
      .then((r) => setCandidates(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const onFiles = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    for (const f of files) {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("source", "WEBSITE");
      try {
        await API.post("/recruitment/candidates/upload", fd, {
          headers: { "Content-Type": "multipart/form-data" },
        });
      } catch (e) {
        // Continue uploading other files even if one fails
        console.error("Upload failed:", f.name, e?.response?.data?.detail);
      }
    }
    setUploading(false);
    load();
    if (fileRef.current) fileRef.current.value = "";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) =>
      (c.FULL_NAME || "").toLowerCase().includes(q) ||
      (c.EMAIL || "").toLowerCase().includes(q) ||
      (c.SKILLS || "").toLowerCase().includes(q) ||
      (c.LOCATION || "").toLowerCase().includes(q)
    );
  }, [candidates, search]);

  return (
    <div>
      <div style={{
        background: "white", padding: 14, borderRadius: 12,
        boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
        marginBottom: 14, display: "flex", gap: 10, alignItems: "center",
        flexWrap: "wrap",
      }}>
        <input
          type="text" value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, skill, location..."
          style={{
            flex: "1 1 300px", minWidth: 240,
            padding: "9px 12px", border: "1px solid #cbd5e1",
            borderRadius: 8, fontSize: 13, fontFamily: "inherit",
          }}
        />
        <input
          ref={fileRef} type="file" multiple
          accept=".pdf,.docx,.doc,.txt"
          onChange={(e) => onFiles(e.target.files)}
          style={{ display: "none" }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={uploading} style={btnPrimary}
        >
          {uploading ? "Uploading & parsing..." : "Upload Resume(s)"}
        </button>
        <div style={{ fontSize: 12, color: "#94a3b8", marginLeft: "auto" }}>
          {filtered.length} of {candidates.length}
        </div>
      </div>

      {loading && <Spinner />}

      {!loading && filtered.length === 0 && (
        <EmptyState text="No candidates yet. Click Upload Resume(s) to start. PDF / DOCX / TXT supported." />
      )}

      {!loading && filtered.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 12 }}>
          {filtered.map((c) => (
            <CandidateCard key={c.ID} c={c} onOpen={() => setFocus(c)} />
          ))}
        </div>
      )}

      {focus && (
        <CandidateDrawer
          candidate={focus} onClose={() => setFocus(null)} onChange={load}
        />
      )}
    </div>
  );
}


function CandidateCard({ c, onOpen }) {
  const initial = (c.FULL_NAME || "?").charAt(0).toUpperCase();
  return (
    <div onClick={onOpen} style={{
      background: "white", border: "1px solid #e2e8f0", borderRadius: 14,
      padding: 14, cursor: "pointer",
      boxShadow: "0 4px 14px rgba(15,23,42,0.05)",
    }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{
          width: 44, height: 44, borderRadius: 10,
          background: `linear-gradient(135deg, ${BVC_DARK}, ${BVC_RED})`,
          color: "white", display: "flex", alignItems: "center",
          justifyContent: "center", fontSize: 18, fontWeight: 800,
          flexShrink: 0,
        }}>
          {initial}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {c.CANDIDATE_CODE}
          </div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#0f172a", marginTop: 2 }}>
            {c.FULL_NAME}
          </div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>
            {c.HIGHEST_QUALIFICATION || "—"} · {c.TOTAL_EXPERIENCE_YEARS || 0} yr exp
          </div>
        </div>
        <Pill status={c.STATUS} />
      </div>
      <div style={{ marginTop: 10, fontSize: 11, color: "#475569", lineHeight: 1.5 }}>
        {c.EMAIL && <div>✉ {c.EMAIL}</div>}
        {c.PHONE && <div>☎ {c.PHONE}</div>}
        {c.LOCATION && <div>📍 {c.LOCATION}</div>}
      </div>
      {c.SKILLS && (
        <div style={{ marginTop: 8, fontSize: 11, color: "#475569" }}>
          <b>Skills:</b> {c.SKILLS.split(",").slice(0, 5).map(s => s.trim()).filter(Boolean).join(", ")}
          {c.SKILLS.split(",").length > 5 ? "…" : ""}
        </div>
      )}
    </div>
  );
}


function CandidateDrawer({ candidate, onClose, onChange }) {
  const [c, setC] = useState(candidate);
  const [jobs, setJobs] = useState([]);
  const [applying, setApplying] = useState(false);
  const [selectedJobId, setSelectedJobId] = useState("");

  useEffect(() => {
    API.get(`/recruitment/candidates/${candidate.ID}`).then((r) => setC(r.data));
    API.get("/recruitment/jobs?status=OPEN").then((r) => setJobs(r.data || []));
  }, [candidate.ID]);

  const parsed = c.parsed || {};

  const apply = async () => {
    if (!selectedJobId) return;
    setApplying(true);
    try {
      await API.post("/recruitment/applications", {
        CANDIDATE_ID: c.ID,
        JOB_ID: Number(selectedJobId),
      });
      onChange?.();
      onClose();
    } finally { setApplying(false); }
  };

  return (
    <Drawer onClose={onClose} width={720}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
            {c.CANDIDATE_CODE}
          </div>
          <div style={{ fontSize: 22, fontWeight: 800 }}>{c.FULL_NAME}</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 2 }}>
            {[c.HIGHEST_QUALIFICATION, `${c.TOTAL_EXPERIENCE_YEARS || 0} yr exp`, c.LOCATION].filter(Boolean).join(" · ")}
          </div>
        </div>
        <Pill status={c.STATUS} />
      </div>

      {c.RESUME_URL && (
        <div style={{ marginTop: 10 }}>
          <a href={`${BACKEND_URL}${c.RESUME_URL}`} target="_blank" rel="noreferrer"
             style={{ fontSize: 12, color: BVC_DARK, fontWeight: 700 }}>
            ↗ Open original resume
          </a>
        </div>
      )}

      <SectionTitle>Apply to a job</SectionTitle>
      <div style={{ display: "flex", gap: 8 }}>
        <select
          value={selectedJobId}
          onChange={(e) => setSelectedJobId(e.target.value)}
          style={{ ...input, flex: 1 }}
        >
          <option value="">Pick a job…</option>
          {jobs.map((j) => (
            <option key={j.ID} value={j.ID}>
              {j.JOB_CODE} — {j.TITLE}
            </option>
          ))}
        </select>
        <button onClick={apply} disabled={!selectedJobId || applying} style={btnPrimary}>
          {applying ? "Applying & screening..." : "Apply + Auto-screen"}
        </button>
      </div>

      <SectionTitle>Contact</SectionTitle>
      <FieldRow label="Email" value={c.EMAIL} />
      <FieldRow label="Phone" value={c.PHONE} />
      <FieldRow label="Location" value={c.LOCATION} />
      <FieldRow label="LinkedIn" value={parsed.linkedin} />

      <SectionTitle>Skills ({(parsed.skills || []).length})</SectionTitle>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        {(parsed.skills || []).map((s) => (
          <span key={s} style={{
            fontSize: 11, padding: "3px 10px", background: "#f1f5f9",
            color: "#0f172a", borderRadius: 999, fontWeight: 600,
          }}>{s}</span>
        ))}
      </div>

      {parsed.education && parsed.education.length > 0 && (
        <>
          <SectionTitle>Education</SectionTitle>
          {parsed.education.map((e, i) => (
            <FieldRow key={i} label={String(e.year || "—")} value={e.degree || e.institution || JSON.stringify(e)} />
          ))}
        </>
      )}

      {parsed.work_experience && parsed.work_experience.length > 0 && (
        <>
          <SectionTitle>Experience</SectionTitle>
          {parsed.work_experience.map((w, i) => (
            <FieldRow key={i} label={`${w.from || "?"} → ${w.to || "?"}`} value={w.role_company || `${w.role || ""} @ ${w.company || ""}`} />
          ))}
        </>
      )}

      {parsed.certifications && parsed.certifications.length > 0 && (
        <>
          <SectionTitle>Certifications</SectionTitle>
          <ul style={{ fontSize: 12, color: "#475569", paddingLeft: 18, margin: "4px 0" }}>
            {parsed.certifications.map((cert, i) => <li key={i}>{cert}</li>)}
          </ul>
        </>
      )}

      {parsed.languages && parsed.languages.length > 0 && (
        <>
          <SectionTitle>Languages</SectionTitle>
          <div>{parsed.languages.join(", ")}</div>
        </>
      )}
    </Drawer>
  );
}


// =====================================================================
// PIPELINE TAB
// =====================================================================

function PipelineTab() {
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [schedFor, setSchedFor] = useState(null);   // application row for "Schedule"
  const [offerFor, setOfferFor] = useState(null);   // application row for "Generate offer"
  const [summary,  setSummary]  = useState(null);   // application row for "View summary"

  const load = () => {
    setLoading(true);
    API.get("/recruitment/applications")
      .then((r) => setApps(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const rescreen = async (id) => {
    await API.post(`/recruitment/applications/${id}/re-screen`);
    load();
  };

  if (loading) return <Spinner />;
  if (apps.length === 0)
    return <EmptyState text="No applications yet. Pick a candidate in the Candidates tab and apply them to a job." />;

  return (
    <div style={{ background: "white", borderRadius: 12, overflow: "hidden",
                  boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={th}>
            <th style={cell}>Candidate</th>
            <th style={cell}>Job</th>
            <th style={cell}>Screening</th>
            <th style={{ ...cell, textAlign: "right" }}>Overall</th>
            <th style={{ ...cell, textAlign: "right" }}>Skill</th>
            <th style={{ ...cell, textAlign: "right" }}>Exp</th>
            <th style={{ ...cell, textAlign: "right" }}>Edu</th>
            <th style={cell}>Status</th>
            <th style={cell}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {apps.map((a) => (
            <tr key={a.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>
                <div style={{ fontWeight: 700 }}>{a.CANDIDATE_NAME}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                  {a.CANDIDATE_CODE}
                </div>
              </td>
              <td style={cell}>
                <div style={{ fontWeight: 600 }}>{a.JOB_TITLE}</div>
                <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>
                  {a.JOB_CODE}
                </div>
              </td>
              <td style={cell}><Pill status={a.SCREENING_STATUS} /></td>
              <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{a.OVERALL_SCORE}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.SKILL_MATCH_PCT}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.EXPERIENCE_MATCH_PCT}</td>
              <td style={{ ...cell, textAlign: "right" }}>{a.EDUCATION_MATCH_PCT}</td>
              <td style={cell}><Pill status={a.STATUS} /></td>
              <td style={cell}>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <button onClick={() => setSummary(a)}   style={btnSecondary}>View</button>
                  <button onClick={() => setSchedFor(a)}  style={btnSecondary}>Schedule</button>
                  <button onClick={() => setOfferFor(a)}  style={btnSecondary}>Offer</button>
                  <button onClick={() => rescreen(a.ID)}  style={btnSecondary}>Re-screen</button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {schedFor && (
        <ScheduleInterviewModal
          application={schedFor}
          onClose={() => setSchedFor(null)}
          onSaved={() => { setSchedFor(null); load(); }}
        />
      )}
      {offerFor && (
        <GenerateOfferModal
          application={offerFor}
          onClose={() => setOfferFor(null)}
          onSaved={() => { setOfferFor(null); load(); }}
        />
      )}
      {summary && (
        <ApplicationSummaryDrawer
          application={summary}
          onClose={() => setSummary(null)}
        />
      )}
    </div>
  );
}


// ---------------------------------------------------------------------
// Schedule Interview modal
// ---------------------------------------------------------------------
function ScheduleInterviewModal({ application, onClose, onSaved }) {
  // Default to "tomorrow 10:00 AM"
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setHours(10, 0, 0, 0);
  const defaultDt = tomorrow.toISOString().slice(0, 16);

  const [form, setForm] = useState({
    ROUND: 1,
    ROUND_TYPE: "SCREENING",
    SCHEDULED_AT: defaultDt,
    DURATION_MINUTES: 45,
    MODE: "ONLINE",
    MEETING_LINK: "",
    LOCATION: "",
    INTERVIEWER_NAME: "",
    INTERVIEWER_EMAIL: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState("");
  const [questions, setQuestions] = useState([]);

  const submit = async () => {
    setSaving(true); setError("");
    try {
      const payload = {
        APPLICATION_ID: application.ID,
        ROUND: Number(form.ROUND) || 1,
        ROUND_TYPE: form.ROUND_TYPE,
        // Convert the datetime-local value to a full ISO string
        SCHEDULED_AT: new Date(form.SCHEDULED_AT).toISOString(),
        DURATION_MINUTES: Number(form.DURATION_MINUTES) || 45,
        MODE: form.MODE,
        MEETING_LINK: form.MEETING_LINK || null,
        LOCATION: form.LOCATION || null,
        INTERVIEWER_NAME: form.INTERVIEWER_NAME || null,
        INTERVIEWER_EMAIL: form.INTERVIEWER_EMAIL || null,
      };
      const res = await API.post("/recruitment/interviews", payload);
      // Best-effort: also fetch AI-suggested questions for this round
      try {
        const qs = await API.post(`/recruitment/interviews/${res.data.ID}/suggest-questions`);
        setQuestions(qs.data?.questions || []);
      } catch {/* non-fatal */}
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not schedule interview");
    } finally { setSaving(false); }
  };

  return (
    <Drawer onClose={onClose} width={560} title={`Schedule Interview · ${application.CANDIDATE_NAME}`}>
      <div style={{ fontSize: 12, color: "#64748b", marginBottom: 14 }}>
        For role: <b style={{ color: "#0f172a" }}>{application.JOB_TITLE}</b>
      </div>

      <Row>
        <Field label="Round #">
          <input type="number" min="1" max="10" value={form.ROUND}
                 onChange={(e) => setForm({ ...form, ROUND: e.target.value })}
                 style={input} />
        </Field>
        <Field label="Round type">
          <select value={form.ROUND_TYPE} onChange={(e) => setForm({ ...form, ROUND_TYPE: e.target.value })} style={input}>
            <option value="SCREENING">Screening</option>
            <option value="TECHNICAL">Technical</option>
            <option value="HR">HR</option>
            <option value="MANAGERIAL">Managerial</option>
            <option value="FINAL">Final</option>
          </select>
        </Field>
      </Row>

      <Row>
        <Field label="Date & time">
          <input type="datetime-local" value={form.SCHEDULED_AT}
                 onChange={(e) => setForm({ ...form, SCHEDULED_AT: e.target.value })}
                 style={input} />
        </Field>
        <Field label="Duration (min)">
          <input type="number" min="15" step="15" value={form.DURATION_MINUTES}
                 onChange={(e) => setForm({ ...form, DURATION_MINUTES: e.target.value })}
                 style={input} />
        </Field>
      </Row>

      <Field label="Mode">
        <select value={form.MODE} onChange={(e) => setForm({ ...form, MODE: e.target.value })} style={input}>
          <option value="ONLINE">Online (video call)</option>
          <option value="IN_PERSON">In-person</option>
          <option value="PHONE">Phone</option>
        </select>
      </Field>

      {form.MODE === "ONLINE" && (
        <Field label="Meeting link">
          <input value={form.MEETING_LINK}
                 onChange={(e) => setForm({ ...form, MEETING_LINK: e.target.value })}
                 placeholder="https://meet.google.com/abc-defg-hij"
                 style={input} />
        </Field>
      )}

      {form.MODE === "IN_PERSON" && (
        <Field label="Location">
          <input value={form.LOCATION}
                 onChange={(e) => setForm({ ...form, LOCATION: e.target.value })}
                 placeholder="BVC24 office, Coimbatore — Conference Room 1"
                 style={input} />
        </Field>
      )}

      <Row>
        <Field label="Interviewer name">
          <input value={form.INTERVIEWER_NAME}
                 onChange={(e) => setForm({ ...form, INTERVIEWER_NAME: e.target.value })}
                 style={input} />
        </Field>
        <Field label="Interviewer email">
          <input type="email" value={form.INTERVIEWER_EMAIL}
                 onChange={(e) => setForm({ ...form, INTERVIEWER_EMAIL: e.target.value })}
                 style={input} />
        </Field>
      </Row>

      {error && <div style={errBox}>{error}</div>}

      {questions.length > 0 && (
        <div style={{ marginTop: 14, padding: 12, background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#7A1022", letterSpacing: 1, textTransform: "uppercase", marginBottom: 6 }}>
            AI-Suggested questions
          </div>
          <ol style={{ fontSize: 12, color: "#475569", paddingLeft: 18, margin: 0, lineHeight: 1.6 }}>
            {questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
        </div>
      )}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={submit} disabled={saving} style={btnPrimary}>
          {saving ? "Scheduling..." : "Schedule + Suggest questions"}
        </button>
      </div>
    </Drawer>
  );
}


// ---------------------------------------------------------------------
// Generate Offer modal
// ---------------------------------------------------------------------
function GenerateOfferModal({ application, onClose, onSaved }) {
  const [form, setForm] = useState({
    JOB_TITLE: application.JOB_TITLE || "",
    DEPARTMENT: "",
    COMPENSATION_CTC: "",
    BASIC: "",
    HRA: "",
    ALLOWANCES: "",
    BONUS: "",
    BENEFITS: "Health insurance, paid time off, annual bonus, training budget.",
    JOINING_DATE: "",
    PROBATION_MONTHS: 6,
    NOTICE_PERIOD_DAYS: 30,
    EMPLOYMENT_TERMS: "",
    SPECIAL_CLAUSES: "",
  });
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState(null);
  const [error, setError]   = useState("");

  const submit = async () => {
    if (!form.COMPENSATION_CTC || Number(form.COMPENSATION_CTC) <= 0) {
      setError("CTC is required and must be greater than zero.");
      return;
    }
    setSaving(true); setError("");
    try {
      const breakdown = {};
      ["BASIC", "HRA", "ALLOWANCES", "BONUS"].forEach((k) => {
        if (form[k] !== "" && form[k] !== null) breakdown[k.toLowerCase()] = Number(form[k]);
      });
      const payload = {
        APPLICATION_ID: application.ID,
        JOB_TITLE: form.JOB_TITLE,
        DEPARTMENT: form.DEPARTMENT || null,
        COMPENSATION_CTC: Number(form.COMPENSATION_CTC),
        COMPENSATION_BREAKDOWN: Object.keys(breakdown).length ? breakdown : null,
        BENEFITS: form.BENEFITS || null,
        JOINING_DATE: form.JOINING_DATE || null,
        PROBATION_MONTHS: Number(form.PROBATION_MONTHS) || 6,
        NOTICE_PERIOD_DAYS: Number(form.NOTICE_PERIOD_DAYS) || 30,
        EMPLOYMENT_TERMS: form.EMPLOYMENT_TERMS || null,
        SPECIAL_CLAUSES:  form.SPECIAL_CLAUSES  || null,
      };
      const res = await API.post("/recruitment/offers", payload);
      setCreated(res.data);
      onSaved?.();
    } catch (e) {
      setError(e?.response?.data?.detail || "Could not create offer");
    } finally { setSaving(false); }
  };

  return (
    <Drawer onClose={onClose} width={620}
            title={`Generate Offer · ${application.CANDIDATE_NAME}`}>

      {!created ? (
        <>
          <Field label="Job title *">
            <input value={form.JOB_TITLE}
                   onChange={(e) => setForm({ ...form, JOB_TITLE: e.target.value })}
                   style={input} />
          </Field>
          <Field label="Department">
            <input value={form.DEPARTMENT}
                   onChange={(e) => setForm({ ...form, DEPARTMENT: e.target.value })}
                   style={input} placeholder="e.g. Engineering" />
          </Field>

          <Field label="Annual CTC (₹) *">
            <input type="number" min="0" value={form.COMPENSATION_CTC}
                   onChange={(e) => setForm({ ...form, COMPENSATION_CTC: e.target.value })}
                   style={input} placeholder="e.g. 600000" />
          </Field>

          <div style={{ fontSize: 10, fontWeight: 800, color: "#64748b", letterSpacing: 1, textTransform: "uppercase", margin: "10px 0 4px" }}>
            Breakdown (optional — appears on the offer letter)
          </div>
          <Row>
            <Field label="Basic (₹/yr)">
              <input type="number" min="0" value={form.BASIC}
                     onChange={(e) => setForm({ ...form, BASIC: e.target.value })}
                     style={input} />
            </Field>
            <Field label="HRA (₹/yr)">
              <input type="number" min="0" value={form.HRA}
                     onChange={(e) => setForm({ ...form, HRA: e.target.value })}
                     style={input} />
            </Field>
          </Row>
          <Row>
            <Field label="Allowances (₹/yr)">
              <input type="number" min="0" value={form.ALLOWANCES}
                     onChange={(e) => setForm({ ...form, ALLOWANCES: e.target.value })}
                     style={input} />
            </Field>
            <Field label="Bonus (₹/yr)">
              <input type="number" min="0" value={form.BONUS}
                     onChange={(e) => setForm({ ...form, BONUS: e.target.value })}
                     style={input} />
            </Field>
          </Row>

          <Row>
            <Field label="Joining date">
              <input type="date" value={form.JOINING_DATE}
                     onChange={(e) => setForm({ ...form, JOINING_DATE: e.target.value })}
                     style={input} />
            </Field>
            <Field label="Probation (months)">
              <input type="number" min="0" max="24" value={form.PROBATION_MONTHS}
                     onChange={(e) => setForm({ ...form, PROBATION_MONTHS: e.target.value })}
                     style={input} />
            </Field>
          </Row>

          <Field label="Notice period (days)">
            <input type="number" min="0" max="180" value={form.NOTICE_PERIOD_DAYS}
                   onChange={(e) => setForm({ ...form, NOTICE_PERIOD_DAYS: e.target.value })}
                   style={input} />
          </Field>

          <Field label="Benefits">
            <textarea rows={2} value={form.BENEFITS}
                      onChange={(e) => setForm({ ...form, BENEFITS: e.target.value })}
                      style={{ ...input, resize: "vertical" }} />
          </Field>

          <Field label="Employment terms (optional)">
            <textarea rows={2} value={form.EMPLOYMENT_TERMS}
                      onChange={(e) => setForm({ ...form, EMPLOYMENT_TERMS: e.target.value })}
                      style={{ ...input, resize: "vertical" }} />
          </Field>

          <Field label="Special clauses (optional)">
            <textarea rows={2} value={form.SPECIAL_CLAUSES}
                      onChange={(e) => setForm({ ...form, SPECIAL_CLAUSES: e.target.value })}
                      style={{ ...input, resize: "vertical" }}
                      placeholder="e.g. 90-day relocation allowance, sign-on bonus..." />
          </Field>

          {error && <div style={errBox}>{error}</div>}

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
            <button onClick={onClose} style={btnSecondary}>Cancel</button>
            <button onClick={submit} disabled={saving} style={btnPrimary}>
              {saving ? "Drafting + generating PDF..." : "Generate Offer Letter"}
            </button>
          </div>
        </>
      ) : (
        <div style={{
          padding: 18, border: "1px solid #bbf7d0", background: "#f0fdf4",
          borderRadius: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: "#14532d", letterSpacing: 1.5, textTransform: "uppercase", marginBottom: 6 }}>
            Offer letter generated
          </div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#0f172a", letterSpacing: -0.3 }}>
            {created.OFFER_NUMBER}
          </div>
          <div style={{ fontSize: 13, color: "#166534", marginTop: 4 }}>
            CTC ₹{Number(created.COMPENSATION_CTC || 0).toLocaleString("en-IN")} · status: {created.STATUS}
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 14, flexWrap: "wrap" }}>
            <a href={`${BACKEND_URL}/recruitment/offers/${created.ID}/pdf`}
               target="_blank" rel="noreferrer"
               style={{
                 padding: "9px 16px",
                 background: BVC_RED, color: "white",
                 border: "none", borderRadius: 8,
                 fontWeight: 800, fontSize: 12,
                 textDecoration: "none",
               }}>
              View PDF
            </a>
            <button onClick={onClose} style={btnSecondary}>Close</button>
          </div>
        </div>
      )}
    </Drawer>
  );
}


// ---------------------------------------------------------------------
// Application Summary drawer (read-only deep dive)
// ---------------------------------------------------------------------
function ApplicationSummaryDrawer({ application, onClose }) {
  return (
    <Drawer onClose={onClose} width={620}
            title={`${application.CANDIDATE_NAME} → ${application.JOB_TITLE}`}>
      <SectionTitle>Screening</SectionTitle>
      <FieldRow label="Verdict"          value={application.SCREENING_STATUS?.replace(/_/g, " ")} />
      <FieldRow label="Overall score"    value={application.OVERALL_SCORE} />
      <FieldRow label="Skill match %"    value={application.SKILL_MATCH_PCT} />
      <FieldRow label="Experience %"     value={application.EXPERIENCE_MATCH_PCT} />
      <FieldRow label="Education %"      value={application.EDUCATION_MATCH_PCT} />
      <FieldRow label="Matching skills"  value={application.MATCHING_SKILLS} />
      <FieldRow label="Missing skills"   value={application.MISSING_SKILLS} />

      {application.SCREENING_SUMMARY && (
        <>
          <SectionTitle>AI summary</SectionTitle>
          <div style={{
            padding: 12, background: "#fef4f5",
            border: "1px solid #fecaca", borderRadius: 10,
            fontSize: 13, color: "#7A1022", lineHeight: 1.55,
            whiteSpace: "pre-wrap",
          }}>
            {application.SCREENING_SUMMARY}
          </div>
        </>
      )}

      <SectionTitle>Pipeline</SectionTitle>
      <FieldRow label="Current status"  value={application.STATUS?.replace(/_/g, " ")} />
      <FieldRow label="Application ID"  value={`#${application.ID}`} />
      <FieldRow label="Applied"         value={application.CREATED_AT?.slice(0, 10)} />
      <FieldRow label="Last screened"   value={application.SCREENED_AT?.slice(0, 16)?.replace("T", " ")} />
    </Drawer>
  );
}


// =====================================================================
// INTERVIEWS TAB
// =====================================================================

function InterviewsTab() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    API.get("/recruitment/interviews")
      .then((r) => setItems(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const fmt = (iso) => {
    try { return new Date(iso).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }); }
    catch { return iso; }
  };

  if (loading) return <Spinner />;
  if (items.length === 0)
    return <EmptyState text="No interviews scheduled yet. Go to Pipeline → pick an application → schedule an interview." />;

  return (
    <div style={{ background: "white", borderRadius: 12, overflow: "hidden",
                  boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={th}>
            <th style={cell}>When</th>
            <th style={cell}>Candidate</th>
            <th style={cell}>Job</th>
            <th style={cell}>Round</th>
            <th style={cell}>Mode</th>
            <th style={cell}>Status</th>
            <th style={cell}>Score</th>
          </tr>
        </thead>
        <tbody>
          {items.map((i) => (
            <tr key={i.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
              <td style={cell}>{fmt(i.SCHEDULED_AT)}</td>
              <td style={cell}>{i.CANDIDATE_NAME}</td>
              <td style={cell}>{i.JOB_TITLE}</td>
              <td style={cell}>R{i.ROUND} · {i.ROUND_TYPE || "—"}</td>
              <td style={cell}>{i.MODE}</td>
              <td style={cell}><Pill status={i.STATUS} /></td>
              <td style={cell}>{i.SCORE != null ? i.SCORE : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}


// =====================================================================
// OFFERS TAB
// =====================================================================

function OffersTab() {
  const [offers, setOffers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sendingFor, setSendingFor] = useState(null);   // offer being sent
  const [busyId, setBusyId] = useState(null);           // id with in-flight action
  const [toast, setToast] = useState("");

  const load = () => {
    setLoading(true);
    API.get("/recruitment/offers")
      .then((r) => setOffers(r.data || []))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  const showToast = (m) => {
    setToast(m);
    setTimeout(() => setToast(""), 4500);
  };

  const markStatus = async (o, status) => {
    if (!window.confirm(`Mark offer ${o.OFFER_NUMBER} as ${status}?`)) return;
    setBusyId(o.ID);
    try {
      await API.patch(`/recruitment/offers/${o.ID}/status`, { STATUS: status });
      showToast(`Marked ${o.OFFER_NUMBER} as ${status}`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to update status");
    } finally { setBusyId(null); }
  };

  const regeneratePdf = async (o) => {
    setBusyId(o.ID);
    try {
      await API.post(`/recruitment/offers/${o.ID}/regenerate-pdf`);
      showToast(`${o.OFFER_NUMBER} regenerated with current branding`);
      load();
    } catch (e) {
      alert(e?.response?.data?.detail || "Failed to regenerate");
    } finally { setBusyId(null); }
  };

  if (loading) return <Spinner />;
  if (offers.length === 0)
    return <EmptyState text="No offers drafted yet. Go to Pipeline → 'Offer' button on any application to generate an offer letter." />;

  return (
    <>
      <div style={{ background: "white", borderRadius: 12, overflow: "hidden",
                    boxShadow: "0 4px 14px rgba(15,23,42,0.05)" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={th}>
              <th style={cell}>Offer</th>
              <th style={cell}>Candidate</th>
              <th style={cell}>Job</th>
              <th style={{ ...cell, textAlign: "right" }}>CTC</th>
              <th style={cell}>Status</th>
              <th style={cell}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {offers.map((o) => {
              const inr = `₹${Number(o.COMPENSATION_CTC || 0).toLocaleString("en-IN")}`;
              const busy = busyId === o.ID;
              return (
                <tr key={o.ID} style={{ borderBottom: "1px solid #f1f5f9" }}>
                  <td style={cell}>
                    <div style={{ fontWeight: 700, fontFamily: "ui-monospace, monospace" }}>
                      {o.OFFER_NUMBER}
                    </div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {o.CREATED_AT?.slice(0, 10)}
                    </div>
                  </td>
                  <td style={cell}>
                    <div style={{ fontWeight: 700 }}>{o.CANDIDATE_NAME || "—"}</div>
                    <div style={{ fontSize: 10, color: "#94a3b8" }}>
                      {o.CANDIDATE_EMAIL || "no email on file"}
                    </div>
                  </td>
                  <td style={cell}>{o.JOB_TITLE}</td>
                  <td style={{ ...cell, textAlign: "right", fontWeight: 800 }}>{inr}</td>
                  <td style={cell}><Pill status={o.STATUS} /></td>
                  <td style={cell}>
                    <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <a
                        href={`${BACKEND_URL}/recruitment/offers/${o.ID}/pdf`}
                        target="_blank" rel="noreferrer"
                        style={{
                          ...btnSecondary,
                          textDecoration: "none",
                          display: "inline-block",
                        }}
                      >
                        View PDF
                      </a>
                      <button
                        onClick={() => regeneratePdf(o)}
                        disabled={busy}
                        title="Re-render the letter with the latest company logo / address"
                        style={btnSecondary}
                      >
                        Regenerate
                      </button>
                      <button
                        onClick={() => setSendingFor(o)}
                        disabled={busy || !o.CANDIDATE_EMAIL}
                        title={o.CANDIDATE_EMAIL
                          ? "Email this offer letter to the candidate"
                          : "Candidate has no email on file"}
                        style={{
                          ...btnPrimary,
                          opacity: !o.CANDIDATE_EMAIL ? 0.4 : 1,
                          cursor: !o.CANDIDATE_EMAIL ? "not-allowed" : "pointer",
                        }}
                      >
                        Send
                      </button>
                      {o.STATUS === "SENT" && (
                        <>
                          <button
                            onClick={() => markStatus(o, "ACCEPTED")}
                            disabled={busy}
                            style={{ ...btnSecondary, color: "#166534" }}
                          >
                            Accepted
                          </button>
                          <button
                            onClick={() => markStatus(o, "REJECTED")}
                            disabled={busy}
                            style={{ ...btnSecondary, color: "#b91c1c" }}
                          >
                            Rejected
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {sendingFor && (
        <SendOfferModal
          offer={sendingFor}
          onClose={() => setSendingFor(null)}
          onSent={(msg) => {
            setSendingFor(null);
            showToast(msg || "Offer sent");
            load();
          }}
        />
      )}

      {toast && (
        <div style={{
          position: "fixed", right: 24, bottom: 24,
          background: "#0f172a", color: "white",
          padding: "12px 18px", borderRadius: 10,
          fontSize: 13, fontWeight: 700, zIndex: 1100,
          boxShadow: "0 12px 36px rgba(0,0,0,0.30)",
        }}>
          {toast}
        </div>
      )}
    </>
  );
}


// ---------------------------------------------------------------------
// Send Offer modal — confirms before sending, allows overriding the
// recipient & adding CC's.
// ---------------------------------------------------------------------
function SendOfferModal({ offer, onClose, onSent }) {
  const [to, setTo] = useState(offer.CANDIDATE_EMAIL || "");
  const [cc, setCc] = useState("");
  const [subject, setSubject] = useState(
    `Offer of Employment — ${offer.JOB_TITLE}`
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const send = async () => {
    if (!to.trim()) {
      setError("Recipient email is required.");
      return;
    }
    setBusy(true); setError("");
    try {
      const payload = {
        TO_EMAIL: to.trim(),
        SUBJECT: subject.trim() || null,
      };
      if (cc.trim()) {
        payload.CC_EMAILS = cc.split(",").map(s => s.trim()).filter(Boolean);
      }
      const res = await API.post(
        `/recruitment/offers/${offer.ID}/send`, payload
      );
      onSent?.(res.data?.message || "Offer emailed to candidate");
    } catch (e) {
      setError(e?.response?.data?.detail || "Send failed");
    } finally { setBusy(false); }
  };

  return (
    <Drawer onClose={onClose} width={560}
            title={`Send offer · ${offer.OFFER_NUMBER}`}>
      <div style={{
        padding: 12, background: "#f8fafc",
        border: "1px solid #e2e8f0", borderRadius: 10,
        fontSize: 12, color: "#475569", marginBottom: 14,
      }}>
        The offer letter PDF will be attached and emailed via the BVC24
        Resend account. The offer status will flip to <b>SENT</b> on success.
      </div>

      <Field label="To (candidate email) *">
        <input value={to} onChange={(e) => setTo(e.target.value)}
               type="email" style={input}
               placeholder="candidate@example.com" />
      </Field>

      <Field label="CC (comma-separated, optional)">
        <input value={cc} onChange={(e) => setCc(e.target.value)}
               style={input}
               placeholder="(leave empty while in Resend sandbox mode)" />
      </Field>

      <Field label="Subject">
        <input value={subject} onChange={(e) => setSubject(e.target.value)}
               style={input} />
      </Field>

      <div style={{
        marginTop: 10, padding: 10,
        background: "#fff7ed", border: "1px solid #fed7aa",
        borderRadius: 8, fontSize: 11, color: "#7c2d12", lineHeight: 1.5,
      }}>
        <b>Note:</b> while your Resend domain is unverified, the email
        will be auto-redirected to your sandbox inbox
        (<code>EMAIL_TESTING_OVERRIDE_TO</code> in <code>.env</code>) with a
        banner showing who it was meant for. Once you verify
        <code> bvc24.com</code> at resend.com/domains it'll deliver to the
        candidate directly.
      </div>

      {error && <div style={errBox}>{error}</div>}

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 }}>
        <button onClick={onClose} style={btnSecondary}>Cancel</button>
        <button onClick={send} disabled={busy} style={btnPrimary}>
          {busy ? "Sending…" : "Send offer letter"}
        </button>
      </div>
    </Drawer>
  );
}


// =====================================================================
// SHARED UI HELPERS
// =====================================================================

const btnPrimary = {
  padding: "10px 18px", background: BVC_RED, color: "white",
  border: "none", borderRadius: 8, fontWeight: 800, fontSize: 13,
  cursor: "pointer", letterSpacing: 0.2,
};
const btnSecondary = {
  padding: "8px 14px", background: "white", color: "#475569",
  border: "1px solid #cbd5e1", borderRadius: 8, fontWeight: 700,
  fontSize: 12, cursor: "pointer",
};

const input = {
  width: "100%", padding: "9px 11px", border: "1px solid #cbd5e1",
  borderRadius: 8, fontSize: 13, fontFamily: "inherit",
  background: "white", boxSizing: "border-box",
};

const cell = {
  padding: "10px 12px", textAlign: "left", verticalAlign: "top",
};

const th = {
  background: "#f8fafc", fontSize: 10, letterSpacing: 0.8,
  color: "#64748b", textTransform: "uppercase",
};

const errBox = {
  padding: "8px 12px", background: "#fef2f2", color: "#991b1b",
  border: "1px solid #fecaca", borderRadius: 8, fontSize: 12,
  marginTop: 10,
};

function Field({ label, children }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <label style={{
        fontSize: 10, fontWeight: 800, color: "#64748b",
        letterSpacing: 1, textTransform: "uppercase", marginBottom: 4,
        display: "block",
      }}>{label}</label>
      {children}
    </div>
  );
}

function Row({ children }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
      {children}
    </div>
  );
}

function FieldRow({ label, value }) {
  return (
    <div style={{
      display: "grid", gridTemplateColumns: "150px 1fr",
      padding: "8px 0", borderBottom: "1px solid #f1f5f9", fontSize: 13,
    }}>
      <div style={{ color: "#64748b", fontWeight: 600 }}>{label}</div>
      <div style={{ color: "#0f172a", wordBreak: "break-word" }}>
        {value || <span style={{ color: "#cbd5e1" }}>—</span>}
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{
      fontSize: 11, fontWeight: 800, color: "#0f172a",
      letterSpacing: 1.4, textTransform: "uppercase",
      marginTop: 18, marginBottom: 8, paddingBottom: 6,
      borderBottom: `2px solid ${BVC_RED}`, width: "fit-content",
    }}>{children}</div>
  );
}

function Spinner() {
  return <div style={{ padding: 40, textAlign: "center", color: "#94a3b8", fontStyle: "italic" }}>Loading…</div>;
}

function EmptyState({ text, small }) {
  return (
    <div style={{
      padding: small ? 20 : 50, textAlign: "center",
      color: "#64748b", background: "#f8fafc",
      border: "1px dashed #cbd5e1", borderRadius: 14,
      fontSize: 13,
    }}>
      {text}
    </div>
  );
}

function Drawer({ children, onClose, width = 600, title }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.55)", zIndex: 1000,
      display: "flex", justifyContent: "flex-end",
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        width, maxWidth: "94%", background: "white",
        overflow: "auto", padding: 22,
        boxShadow: "-20px 0 50px rgba(0,0,0,0.3)",
      }}>
        {title && (
          <div style={{
            fontSize: 18, fontWeight: 800, color: "#0f172a",
            marginBottom: 14, paddingBottom: 10,
            borderBottom: "1px solid #e2e8f0",
          }}>
            {title}
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
