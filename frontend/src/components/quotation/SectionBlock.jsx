import { memo, useCallback, useMemo, useRef, useState } from "react";
import RichTextEditor from "../RichTextEditor";
import LineItemsTableEditor from "./LineItemsTableEditor";
import { API_BASE_URL } from "../../services/api";
import styles from "./SectionBlock.module.css";

const TYPE_LABELS = {
  richtext: "Rich Text",
  table: "Table",
  image: "Image",
  custom: "Custom",
};

// Uploaded image URLs are stored as backend-relative paths (e.g.
// "/static/quotation/xxx.png") — resolve to absolute so the browser loads
// them from the API origin, not the frontend's. Same pattern already used
// by CompanyProfilePage's logoSrc / AdminDashboardV2's photoSrc.
function resolveImageUrl(url) {
  if (!url) return url;
  return url.startsWith("http") ? url : `${API_BASE_URL}${url}`;
}

const SectionBlock = memo(function SectionBlock({
  section,
  onChange,
  onMoveUp,
  onMoveDown,
  onRemove,
  isFirst,
  isLast,
  editorKey,
  onUploadImage,
}) {
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);
  const imageSrc = useMemo(() => resolveImageUrl(section.imageUrl), [section.imageUrl]);

  const update = useCallback(
    (patch) => onChange({ ...section, ...patch }),
    [section, onChange]
  );

  const handleImageFile = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file || !onUploadImage) return;
      setUploading(true);
      try {
        const url = await onUploadImage(file);
        if (url) update({ imageUrl: url });
      } finally {
        setUploading(false);
      }
    },
    [onUploadImage, update]
  );

  return (
    <div className={styles.block}>
      <div className={styles.headerRow}>
        <span className={styles.typeTag}>{TYPE_LABELS[section.type] || section.type}</span>
        <input
          type="text"
          className={styles.titleInput}
          value={section.title || ""}
          onChange={(e) => update({ title: e.target.value })}
          placeholder="Section title (optional)"
        />
        <label className={styles.pageBreakLabel}>
          <input
            type="checkbox"
            checked={!!section.pageBreakBefore}
            onChange={(e) => update({ pageBreakBefore: e.target.checked })}
          />
          Start on new page
        </label>
        <div className={styles.controls}>
          <button type="button" className={styles.ctrlBtn} onClick={onMoveUp} disabled={isFirst} title="Move up">↑</button>
          <button type="button" className={styles.ctrlBtn} onClick={onMoveDown} disabled={isLast} title="Move down">↓</button>
          <button type="button" className={styles.removeBtn} onClick={onRemove} title="Remove section">Remove</button>
        </div>
      </div>

      <div className={styles.body}>
        {(section.type === "richtext" || section.type === "custom") && (
          <RichTextEditor
            key={editorKey}
            initialValue={section.html || ""}
            onChange={(html) => update({ html })}
          />
        )}

        {section.type === "table" && (
          <LineItemsTableEditor
            rows={section.rows || []}
            onChange={(rows) => update({ rows })}
          />
        )}

        {section.type === "image" && (
          <div className={styles.imageRow}>
            {section.imageUrl ? (
              <img src={imageSrc} alt="Section" className={styles.imagePreview} />
            ) : (
              <div className={styles.imageEmpty}>No image uploaded</div>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept=".png,.jpg,.jpeg,.webp,.svg"
              className={styles.hiddenInput}
              onChange={handleImageFile}
            />
            <button
              type="button"
              className={styles.uploadBtn}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : section.imageUrl ? "Replace Image" : "Upload Image"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
});

export default SectionBlock;
