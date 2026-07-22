import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useToast } from "../hooks/useToast";
import RichTextEditor from "../components/RichTextEditor";
import SectionBlock from "../components/quotation/SectionBlock";
import { projectService } from "../services/projectService";
import { projectQuotationService } from "../services/projectQuotationService";
import { downloadBlob } from "../utils/downloadBlob";
import { API_BASE_URL } from "../services/api";
import styles from "./ProjectQuotationManagement.module.css";

let sectionIdCounter = 0;
function newSectionId() {
  sectionIdCounter += 1;
  return `section-${Date.now()}-${sectionIdCounter}`;
}

// Uploaded image URLs are stored as backend-relative paths (e.g.
// "/static/quotation/xxx.png"). The frontend dev server (and, in some
// deployments, the production frontend) runs on a different origin than
// the API, so a relative <img src> resolves against the wrong origin and
// 404s. Same resolution pattern already used by CompanyProfilePage's
// logoSrc and AdminDashboardV2's photoSrc.
function resolveImageUrl(url) {
  if (!url) return url;
  return url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
}

// The server-rendered preview HTML embeds the same relative /static/ image
// URLs verbatim — rewrite them to absolute before handing the string to the
// iframe. Purely a client-side display concern: PDF/DOCX generation reads
// the original CONTENT_JSON/RENDERED_HTML server-side and is untouched.
function resolvePreviewHtml(html) {
  if (!html) return html;
  return html.replace(/(src=["'])\/static\//g, `$1${API_BASE_URL}/static/`);
}

const NEW_SECTION_DEFAULTS = {
  richtext: () => ({ type: "richtext", title: "", html: "", pageBreakBefore: false }),
  table: () => ({ type: "table", title: "", rows: [{ description: "", qty: 1, unitPrice: 0 }], pageBreakBefore: false }),
  image: () => ({ type: "image", title: "", imageUrl: null, pageBreakBefore: false }),
  custom: () => ({ type: "custom", title: "", html: "", pageBreakBefore: false }),
};

// ── Searchable project selector — isolated so typing in the editor never
// re-renders the dropdown, and vice versa ────────────────────────────────
const ProjectDropdown = memo(function ProjectDropdown({
  projects,
  selectedProject,
  ddOpen,
  ddSearch,
  onToggleOpen,
  onSearchChange,
  onSelect,
  ddRef,
}) {
  const filtered = useMemo(() => {
    if (!ddSearch.trim()) return projects;
    const q = ddSearch.toLowerCase();
    return projects.filter(
      (p) =>
        p.NAME.toLowerCase().includes(q) ||
        (p.CATEGORY_NAME || "").toLowerCase().includes(q)
    );
  }, [projects, ddSearch]);

  return (
    <div className={styles.topField} ref={ddRef}>
      <label className={styles.topLabel}>Project</label>
      <button
        type="button"
        className={`${styles.ddTrigger} ${ddOpen ? styles.ddTriggerOpen : ""}`}
        onClick={onToggleOpen}
      >
        <span className={styles.ddTriggerText}>
          {selectedProject?.NAME || "Select a project"}
        </span>
        <svg
          className={styles.ddChevron}
          style={{ transform: ddOpen ? "rotate(180deg)" : "rotate(0deg)" }}
          width="12" height="12" viewBox="0 0 12 12" fill="none"
        >
          <path d="M2 4l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {ddOpen && (
        <div className={styles.ddPanel}>
          <div className={styles.ddSearchWrap}>
            <svg className={styles.ddSearchIcon}
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
            <input
              type="text"
              className={styles.ddSearchInput}
              placeholder="Search projects…"
              value={ddSearch}
              onChange={(e) => onSearchChange(e.target.value)}
              autoFocus
            />
          </div>
          <div className={styles.ddList}>
            {filtered.length === 0 ? (
              <div className={styles.ddEmpty}>No projects match</div>
            ) : (
              filtered.map((p) => {
                const active = p.ID === selectedProject?.ID;
                return (
                  <div
                    key={p.ID}
                    className={`${styles.ddItem} ${active ? styles.ddItemActive : ""}`}
                    onClick={() => onSelect(p.ID)}
                  >
                    <div className={styles.ddItemRow}>
                      <span className={styles.ddItemName}>{p.NAME}</span>
                      {active && <span className={styles.ddItemBadge}>Active</span>}
                    </div>
                    {p.CATEGORY_NAME && <div className={styles.ddItemType}>{p.CATEGORY_NAME}</div>}
                  </div>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
});

// ── Quotation Identity ────────────────────────────────────────────────────
const IdentityFields = memo(function IdentityFields({ number, date, onNumberChange, onDateChange }) {
  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Quotation Number</label>
      <input
        type="text"
        className={styles.textInput}
        value={number}
        onChange={(e) => onNumberChange(e.target.value)}
      />
      <div style={{ height: 12 }} />
      <label className={styles.sectionLabel}>Quotation Date</label>
      <input
        type="date"
        className={styles.textInput}
        value={date || ""}
        onChange={(e) => onDateChange(e.target.value)}
      />
    </div>
  );
});

// ── Letterhead ─────────────────────────────────────────────────────────────
const LetterheadFields = memo(function LetterheadFields({ letterhead, onChange, onUploadLogo }) {
  const logoInputRef = useRef(null);
  const logoSrc = useMemo(() => resolveImageUrl(letterhead.logoUrlOverride), [letterhead.logoUrlOverride]);

  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Letterhead</label>

      <label className={styles.checkboxRow}>
        <input
          type="checkbox"
          checked={!!letterhead.showCompanyLogo}
          onChange={(e) => onChange({ showCompanyLogo: e.target.checked })}
        />
        Show company logo in header
      </label>

      <div className={styles.logoRow}>
        {letterhead.logoUrlOverride ? (
          <div className={styles.logoPreviewBox}>
            <img src={logoSrc} alt="Logo preview" className={styles.logoThumb} />
            <button
              type="button"
              className={styles.removeLogoBtn}
              onClick={() => onChange({ logoUrlOverride: null })}
              title="Use company default logo"
            >
              ×
            </button>
          </div>
        ) : (
          <div className={styles.logoEmpty}>Using company default logo</div>
        )}
        <input
          ref={logoInputRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          className={styles.hiddenInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUploadLogo(file);
          }}
        />
        <button type="button" className={styles.uploadBtn} onClick={() => logoInputRef.current?.click()}>
          {letterhead.logoUrlOverride ? "Replace Logo" : "Upload Logo Override"}
        </button>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Banner Color</label>
          <input
            type="color"
            className={styles.colorInput}
            value={letterhead.bannerColor || "#C8102E"}
            onChange={(e) => onChange({ bannerColor: e.target.value })}
          />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Title</label>
          <input type="text" className={styles.textInput}
            value={letterhead.title || ""}
            onChange={(e) => onChange({ title: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Subtitle</label>
          <input type="text" className={styles.textInput}
            value={letterhead.subtitle || ""}
            onChange={(e) => onChange({ subtitle: e.target.value })} />
        </div>
      </div>
    </div>
  );
});

// ── Company Information ────────────────────────────────────────────────────
const CompanyInfoFields = memo(function CompanyInfoFields({ override, onToggle, onChange }) {
  const on = !!override;
  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Company Information</label>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={on} onChange={(e) => onToggle(e.target.checked)} />
        Override company info for this quotation only
      </label>
      {on ? (
        <div className={styles.fieldStack}>
          <div className={styles.field}>
            <label className={styles.sectionLabel}>Company Name</label>
            <input type="text" className={styles.textInput}
              value={override.LEGAL_NAME || ""}
              onChange={(e) => onChange({ LEGAL_NAME: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.sectionLabel}>Website</label>
            <input type="text" className={styles.textInput}
              value={override.WEBSITE || ""}
              onChange={(e) => onChange({ WEBSITE: e.target.value })} />
          </div>
          <div className={styles.field}>
            <label className={styles.sectionLabel}>Full Address</label>
            <textarea className={styles.textarea} rows={2}
              value={override.FULL_ADDRESS || ""}
              onChange={(e) => onChange({ FULL_ADDRESS: e.target.value })} />
          </div>
          <p className={styles.hint}>Leave a field blank to fall back to the company's default value.</p>
        </div>
      ) : (
        <p className={styles.hint}>Using live company profile — updates to Company Profile automatically apply here.</p>
      )}
    </div>
  );
});

// ── Customer Info block ────────────────────────────────────────────────────
const CustomerInfoFields = memo(function CustomerInfoFields({ customerInfo, onChange }) {
  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Customer Info Block</label>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={!!customerInfo.showBlock}
          onChange={(e) => onChange({ showBlock: e.target.checked })} />
        Show customer info block
      </label>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Label</label>
          <input type="text" className={styles.textInput}
            value={customerInfo.label || ""}
            onChange={(e) => onChange({ label: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Name Placeholder</label>
          <input type="text" className={styles.textInput}
            value={customerInfo.namePlaceholder || ""}
            onChange={(e) => onChange({ namePlaceholder: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Address Placeholder</label>
          <input type="text" className={styles.textInput}
            value={customerInfo.addressPlaceholder || ""}
            onChange={(e) => onChange({ addressPlaceholder: e.target.value })} />
        </div>
      </div>
      <div className={styles.field} style={{ marginTop: 10 }}>
        <label className={styles.sectionLabel}>Additional Free Text</label>
        <textarea className={styles.textarea} rows={2}
          value={customerInfo.freeText || ""}
          onChange={(e) => onChange({ freeText: e.target.value })} />
      </div>
    </div>
  );
});

// ── Signature ───────────────────────────────────────────────────────────────
const SignatureFields = memo(function SignatureFields({ signature, onChange, onUploadImage }) {
  const fileRef = useRef(null);
  const signatureSrc = useMemo(() => resolveImageUrl(signature.imageUrl), [signature.imageUrl]);
  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Signature</label>
      <label className={styles.checkboxRow}>
        <input type="checkbox" checked={!!signature.showBlock}
          onChange={(e) => onChange({ showBlock: e.target.checked })} />
        Show signature block
      </label>
      <div className={styles.logoRow}>
        {signature.imageUrl ? (
          <div className={styles.logoPreviewBox}>
            <img src={signatureSrc} alt="Signature preview" className={styles.logoThumb} />
          </div>
        ) : (
          <div className={styles.logoEmpty}>No signature/stamp uploaded</div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.svg"
          className={styles.hiddenInput}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) onUploadImage(file);
          }}
        />
        <button type="button" className={styles.uploadBtn} onClick={() => fileRef.current?.click()}>
          {signature.imageUrl ? "Replace Image" : "Upload Signature/Stamp"}
        </button>
      </div>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Name</label>
          <input type="text" className={styles.textInput}
            value={signature.name || ""}
            onChange={(e) => onChange({ name: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Designation</label>
          <input type="text" className={styles.textInput}
            value={signature.designation || ""}
            onChange={(e) => onChange({ designation: e.target.value })} />
        </div>
      </div>
    </div>
  );
});

// ── Style ───────────────────────────────────────────────────────────────────
const StyleFields = memo(function StyleFields({ style, onChange }) {
  return (
    <div className={styles.section}>
      <label className={styles.sectionLabel}>Style</label>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Accent Color</label>
          <input type="color" className={styles.colorInput}
            value={style.accentColor || "#C8102E"}
            onChange={(e) => onChange({ accentColor: e.target.value })} />
        </div>
        <div className={styles.field}>
          <label className={styles.sectionLabel}>Page Margin</label>
          <input type="text" className={styles.textInput}
            value={style.pageMargin || ""}
            onChange={(e) => onChange({ pageMargin: e.target.value })} />
        </div>
      </div>
    </div>
  );
});

// ── Sections list (dynamic table/richtext/image/custom blocks) ─────────────
const SectionsList = memo(function SectionsList({
  sections,
  editorKeyBase,
  addType,
  onAddTypeChange,
  onAdd,
  onSectionChange,
  onMove,
  onRemove,
  onUploadImage,
}) {
  return (
    <div className={styles.section}>
      <div className={styles.sectionTitleRow}>
        <span className={styles.sectionLabel}>Sections</span>
        <div className={styles.addSectionRow}>
          <select className={styles.typeSelect} value={addType} onChange={(e) => onAddTypeChange(e.target.value)}>
            <option value="richtext">Rich Text</option>
            <option value="table">Table</option>
            <option value="image">Image</option>
            <option value="custom">Custom</option>
          </select>
          <button type="button" className={styles.addSectionBtn} onClick={onAdd}>+ Add Section</button>
        </div>
      </div>
      {sections.length === 0 ? (
        <p className={styles.hint}>No sections yet — add a table, rich text, image, or custom block.</p>
      ) : (
        sections.map((section, idx) => (
          <SectionBlock
            key={section.id}
            section={section}
            editorKey={`section-${section.id}-${editorKeyBase}`}
            onChange={(updated) => onSectionChange(idx, updated)}
            onMoveUp={() => onMove(idx, -1)}
            onMoveDown={() => onMove(idx, 1)}
            onRemove={() => onRemove(idx)}
            isFirst={idx === 0}
            isLast={idx === sections.length - 1}
            onUploadImage={onUploadImage}
          />
        ))
      )}
    </div>
  );
});

function ProjectQuotationManagement() {
  const toast = useToast();

  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [quotationId, setQuotationId] = useState(null);
  const [quotationNumber, setQuotationNumber] = useState("");
  const [quotationDate, setQuotationDate] = useState("");
  const [content, setContent] = useState(null);
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewDirty, setPreviewDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [downloadingDocx, setDownloadingDocx] = useState(false);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingQuotation, setLoadingQuotation] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [addSectionType, setAddSectionType] = useState("richtext");
  const [ddOpen, setDdOpen] = useState(false);
  const [ddSearch, setDdSearch] = useState("");

  const fetchedRef = useRef(false);
  const ddRef = useRef(null);
  const selectedProjectIdRef = useRef(selectedProjectId);
  const addSectionTypeRef = useRef(addSectionType);
  const quotationNumberRef = useRef(quotationNumber);
  const quotationDateRef = useRef(quotationDate);
  const contentRef = useRef(content);

  useEffect(() => { selectedProjectIdRef.current = selectedProjectId; }, [selectedProjectId]);
  useEffect(() => { addSectionTypeRef.current = addSectionType; }, [addSectionType]);
  useEffect(() => { quotationNumberRef.current = quotationNumber; }, [quotationNumber]);
  useEffect(() => { quotationDateRef.current = quotationDate; }, [quotationDate]);
  useEffect(() => { contentRef.current = content; }, [content]);

  // ── Fetch project list (once, StrictMode-safe) ────────────────────────
  useEffect(() => {
    if (fetchedRef.current) return;
    fetchedRef.current = true;
    projectService
      .getAll()
      .then((res) => {
        const list = res.data || [];
        setProjects(list);
        if (list.length > 0) setSelectedProjectId(list[0].ID);
      })
      .catch(() => toast.showError("Failed to load projects"))
      .finally(() => setLoadingList(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Load quotation when the selected project changes ──────────────────
  useEffect(() => {
    if (!selectedProjectId) return;
    setLoadingQuotation(true);
    projectQuotationService
      .getByProject(selectedProjectId)
      .then((res) => {
        const q = res.data;
        setQuotationId(q.ID);
        setQuotationNumber(q.QUOTATION_NUMBER || "");
        setQuotationDate(q.QUOTATION_DATE || "");
        setContent(q.CONTENT_JSON || null);
        setPreviewHtml(resolvePreviewHtml(q.RENDERED_HTML || ""));
        setPreviewDirty(false);
        setEditorKey((k) => k + 1);
      })
      .catch(() => toast.showError("Failed to load quotation for this project"))
      .finally(() => setLoadingQuotation(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId]);

  // ── Close dropdown on outside click ────────────────────────────────────
  useEffect(() => {
    if (!ddOpen) return;
    const handleOutside = (e) => {
      if (ddRef.current && !ddRef.current.contains(e.target)) {
        setDdOpen(false);
        setDdSearch("");
      }
    };
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [ddOpen]);

  // ── Stable field updaters (functional setState — no `content` dependency,
  // so these never change identity and memoized children skip re-rendering
  // when an unrelated field changes) ─────────────────────────────────────
  const handleToggleDropdown = useCallback(() => setDdOpen((o) => !o), []);
  const handleDdSearchChange = useCallback((v) => setDdSearch(v), []);

  const handleSelectProject = useCallback((id) => {
    setSelectedProjectId(id);
    setDdOpen(false);
    setDdSearch("");
  }, []);

  const handleNumberChange = useCallback((v) => {
    setQuotationNumber(v);
    setPreviewDirty(true);
  }, []);

  const handleDateChange = useCallback((v) => {
    setQuotationDate(v);
    setPreviewDirty(true);
  }, []);

  const handleIntroChange = useCallback((html) => {
    setContent((prev) => ({ ...prev, introHtml: html }));
    setPreviewDirty(true);
  }, []);

  const handleTermsChange = useCallback((html) => {
    setContent((prev) => ({ ...prev, termsHtml: html }));
    setPreviewDirty(true);
  }, []);

  const handleNotesChange = useCallback((html) => {
    setContent((prev) => ({ ...prev, notesHtml: html }));
    setPreviewDirty(true);
  }, []);

  const handleFooterChange = useCallback((html) => {
    setContent((prev) => ({ ...prev, footerHtml: html }));
    setPreviewDirty(true);
  }, []);

  const handleLetterheadChange = useCallback((patch) => {
    setContent((prev) => ({ ...prev, letterhead: { ...prev.letterhead, ...patch } }));
    setPreviewDirty(true);
  }, []);

  const handleCustomerInfoChange = useCallback((patch) => {
    setContent((prev) => ({ ...prev, customerInfo: { ...prev.customerInfo, ...patch } }));
    setPreviewDirty(true);
  }, []);

  const handleSignatureChange = useCallback((patch) => {
    setContent((prev) => ({ ...prev, signature: { ...prev.signature, ...patch } }));
    setPreviewDirty(true);
  }, []);

  const handleStyleChange = useCallback((patch) => {
    setContent((prev) => ({ ...prev, style: { ...prev.style, ...patch } }));
    setPreviewDirty(true);
  }, []);

  const handleCompanyOverrideChange = useCallback((patch) => {
    setContent((prev) => ({
      ...prev,
      companyInfoOverride: { ...prev.companyInfoOverride, ...patch },
    }));
    setPreviewDirty(true);
  }, []);

  const handleToggleCompanyOverride = useCallback((on) => {
    setContent((prev) => ({
      ...prev,
      companyInfoOverride: on ? { LEGAL_NAME: "", WEBSITE: "", FULL_ADDRESS: "" } : null,
    }));
    setPreviewDirty(true);
  }, []);

  const uploadImage = useCallback(
    async (file) => {
      const fd = new FormData();
      fd.append("file", file);
      try {
        const res = await projectQuotationService.uploadImage(selectedProjectIdRef.current, fd);
        return res.data?.url || null;
      } catch {
        toast.showError("Image upload failed");
        return null;
      }
    },
    [toast]
  );

  const handleUploadLogo = useCallback(
    async (file) => {
      const url = await uploadImage(file);
      if (url) handleLetterheadChange({ logoUrlOverride: url });
    },
    [uploadImage, handleLetterheadChange]
  );

  const handleUploadSignature = useCallback(
    async (file) => {
      const url = await uploadImage(file);
      if (url) handleSignatureChange({ imageUrl: url });
    },
    [uploadImage, handleSignatureChange]
  );

  const handleSectionChange = useCallback((idx, updated) => {
    setContent((prev) => {
      const sections = [...prev.sections];
      sections[idx] = updated;
      return { ...prev, sections };
    });
    setPreviewDirty(true);
  }, []);

  const handleSectionMove = useCallback((idx, dir) => {
    setContent((prev) => {
      const sections = [...prev.sections];
      const target = idx + dir;
      if (target < 0 || target >= sections.length) return prev;
      [sections[idx], sections[target]] = [sections[target], sections[idx]];
      sections.forEach((s, i) => { s.order = i; });
      return { ...prev, sections };
    });
    setPreviewDirty(true);
  }, []);

  const handleSectionRemove = useCallback((idx) => {
    setContent((prev) => {
      const sections = prev.sections.filter((_, i) => i !== idx);
      sections.forEach((s, i) => { s.order = i; });
      return { ...prev, sections };
    });
    setPreviewDirty(true);
  }, []);

  const handleAddSection = useCallback(() => {
    setContent((prev) => {
      const builder = NEW_SECTION_DEFAULTS[addSectionTypeRef.current] || NEW_SECTION_DEFAULTS.richtext;
      const newSection = { id: newSectionId(), order: prev.sections.length, ...builder() };
      return { ...prev, sections: [...prev.sections, newSection] };
    });
    setPreviewDirty(true);
  }, []);

  const handleSave = useCallback(async () => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId || !contentRef.current) return;
    setSaving(true);
    try {
      const res = await projectQuotationService.update(projectId, {
        QUOTATION_NUMBER: quotationNumberRef.current,
        QUOTATION_DATE: quotationDateRef.current || null,
        CONTENT_JSON: contentRef.current,
      });
      const q = res.data;
      setQuotationId(q.ID);
      setPreviewHtml(resolvePreviewHtml(q.RENDERED_HTML || ""));
      setPreviewDirty(false);
      toast.showSuccess("Quotation saved");
    } catch {
      toast.showError("Failed to save quotation — please try again.");
    } finally {
      setSaving(false);
    }
  }, [toast]);

  const handleDownloadPdf = useCallback(async () => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setDownloadingPdf(true);
    try {
      const res = await projectQuotationService.downloadPdf(projectId);
      downloadBlob(res.data, `${(quotationNumberRef.current || "quotation").replace(/\//g, "-")}.pdf`);
    } catch {
      toast.showError("Failed to generate PDF");
    } finally {
      setDownloadingPdf(false);
    }
  }, [toast]);

  const handleDownloadDocx = useCallback(async () => {
    const projectId = selectedProjectIdRef.current;
    if (!projectId) return;
    setDownloadingDocx(true);
    try {
      const res = await projectQuotationService.downloadDocx(projectId);
      downloadBlob(res.data, `${(quotationNumberRef.current || "quotation").replace(/\//g, "-")}.docx`);
    } catch {
      toast.showError("Failed to generate Word document");
    } finally {
      setDownloadingDocx(false);
    }
  }, [toast]);

  const selectedProject = useMemo(
    () => projects.find((p) => p.ID === selectedProjectId) || null,
    [projects, selectedProjectId]
  );

  const canSave = !saving && !loadingQuotation && !!selectedProjectId && !!content;
  const canDownload = !previewDirty && !!quotationId && !downloadingPdf && !downloadingDocx;

  if (loadingList) {
    return <div className={styles.page}><div className={styles.loadingMsg}>Loading projects…</div></div>;
  }

  return (
    <div className={styles.page}>
      {/* ── Top bar ── */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <h2 className={styles.title}>Project Quotation Management</h2>
          <p className={styles.subtitle}>
            Edit the quotation document for a project. Each project has its own
            independent quotation — changes here never affect another project.
          </p>
        </div>

        <div className={styles.topRight}>
          <ProjectDropdown
            projects={projects}
            selectedProject={selectedProject}
            ddOpen={ddOpen}
            ddSearch={ddSearch}
            onToggleOpen={handleToggleDropdown}
            onSearchChange={handleDdSearchChange}
            onSelect={handleSelectProject}
            ddRef={ddRef}
          />

          <button className={styles.saveBtn} onClick={handleSave} disabled={!canSave}>
            {saving ? "Saving…" : "Save Quotation"}
          </button>
          <button className={styles.dlBtn} onClick={handleDownloadPdf} disabled={!canDownload}>
            {downloadingPdf ? "Generating…" : "Download PDF"}
          </button>
          <button className={styles.dlBtn} onClick={handleDownloadDocx} disabled={!canDownload}>
            {downloadingDocx ? "Generating…" : "Download Word"}
          </button>
        </div>
      </div>

      {/* ── Split pane ── */}
      <div className={styles.splitPane}>

        {/* LEFT — Editor */}
        <div className={styles.editorPanel}>
          {!selectedProjectId ? (
            <div className={styles.placeholderMsg}>Please select a project to view its quotation.</div>
          ) : loadingQuotation || !content ? (
            <div className={styles.loadingMsg}>Loading quotation…</div>
          ) : (
            <div className={styles.editorInner}>

              <IdentityFields
                number={quotationNumber}
                date={quotationDate}
                onNumberChange={handleNumberChange}
                onDateChange={handleDateChange}
              />

              <LetterheadFields
                letterhead={content.letterhead}
                onChange={handleLetterheadChange}
                onUploadLogo={handleUploadLogo}
              />

              <CompanyInfoFields
                override={content.companyInfoOverride}
                onToggle={handleToggleCompanyOverride}
                onChange={handleCompanyOverrideChange}
              />

              <CustomerInfoFields
                customerInfo={content.customerInfo}
                onChange={handleCustomerInfoChange}
              />

              <div className={styles.section}>
                <label className={styles.sectionLabel}>Introduction</label>
                <RichTextEditor key={`intro-${editorKey}`} initialValue={content.introHtml || ""}
                  onChange={handleIntroChange} />
              </div>

              <SectionsList
                sections={content.sections}
                editorKeyBase={editorKey}
                addType={addSectionType}
                onAddTypeChange={setAddSectionType}
                onAdd={handleAddSection}
                onSectionChange={handleSectionChange}
                onMove={handleSectionMove}
                onRemove={handleSectionRemove}
                onUploadImage={uploadImage}
              />

              <div className={styles.section}>
                <label className={styles.sectionLabel}>Terms &amp; Conditions</label>
                <RichTextEditor key={`terms-${editorKey}`} initialValue={content.termsHtml || ""}
                  onChange={handleTermsChange} />
              </div>

              <div className={styles.section}>
                <label className={styles.sectionLabel}>Notes</label>
                <RichTextEditor key={`notes-${editorKey}`} initialValue={content.notesHtml || ""}
                  onChange={handleNotesChange} />
              </div>

              <SignatureFields
                signature={content.signature}
                onChange={handleSignatureChange}
                onUploadImage={handleUploadSignature}
              />

              <div className={styles.section}>
                <label className={styles.sectionLabel}>
                  Footer
                  <span className={styles.hint}>
                    &nbsp;· Use <code className={styles.code}>{"{{company_website}}"}</code> and{" "}
                    <code className={styles.code}>{"{{company_address}}"}</code> as placeholders
                  </span>
                </label>
                <RichTextEditor key={`footer-${editorKey}`} initialValue={content.footerHtml || ""}
                  onChange={handleFooterChange} />
              </div>

              <StyleFields style={content.style} onChange={handleStyleChange} />

            </div>
          )}
        </div>

        {/* RIGHT — Live preview */}
        <div className={styles.previewPanel}>
          <div className={styles.previewTopBar}>
            <span className={styles.previewLabel}>Preview</span>
            <span className={styles.previewNote}>
              {previewDirty ? "Unsaved changes — preview reflects your last save" : "Up to date with last save"}
            </span>
          </div>
          <iframe
            title="Quotation Preview"
            className={styles.previewFrame}
            srcDoc={previewHtml}
            sandbox="allow-same-origin"
          />
        </div>

      </div>
    </div>
  );
}

export default ProjectQuotationManagement;
