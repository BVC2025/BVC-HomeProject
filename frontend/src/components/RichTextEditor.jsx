import { memo, useCallback, useEffect, useRef } from "react";
import styles from "./RichTextEditor.module.css";

// Uses document.execCommand — deprecated in spec but universally supported in
// all production browsers and appropriate for an internal admin tool.
const exec = (cmd, value = null) => document.execCommand(cmd, false, value);

const BLOCK_OPTIONS = [
  { value: "",   label: "Paragraph" },
  { value: "h1", label: "Heading 1" },
  { value: "h2", label: "Heading 2" },
  { value: "h3", label: "Heading 3" },
];

const TOOLS = [
  { cmd: "bold",                icon: "B",   title: "Bold",           cls: "bold" },
  { cmd: "italic",              icon: "I",   title: "Italic",         cls: "italic" },
  { cmd: "underline",           icon: "U",   title: "Underline",      cls: "underline" },
  { cmd: "strikeThrough",       icon: "S",   title: "Strikethrough",  cls: "strike" },
  { type: "sep" },
  { cmd: "insertUnorderedList", icon: "UL",  title: "Bullet List" },
  { cmd: "insertOrderedList",   icon: "OL",  title: "Numbered List" },
  { type: "sep" },
  { cmd: "justifyLeft",         icon: "⬤←", title: "Align Left" },
  { cmd: "justifyCenter",       icon: "⬤—", title: "Centre" },
  { cmd: "justifyRight",        icon: "→⬤", title: "Align Right" },
  { type: "sep" },
  { cmd: "createLink",          icon: "Link",   title: "Insert Hyperlink" },
  { cmd: "unlink",              icon: "Unlink", title: "Remove Hyperlink" },
  { cmd: "insertImage",         icon: "Img",    title: "Insert Image (URL)" },
  { type: "sep" },
  { cmd: "undo",                icon: "↩",  title: "Undo" },
  { cmd: "redo",                icon: "↪",  title: "Redo" },
];

const RichTextEditor = memo(function RichTextEditor({ initialValue, onChange }) {
  const editorRef = useRef(null);

  // Set content on mount — intentionally mount-only; parent uses `key` to remount
  // when a different template is loaded (avoids cursor-position issues from
  // syncing innerHTML with React state on every keystroke).
  useEffect(() => {
    if (editorRef.current) {
      editorRef.current.innerHTML = initialValue || "<p><br></p>";
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const notifyChange = useCallback(() => {
    onChange?.(editorRef.current?.innerHTML ?? "");
  }, [onChange]);

  // ── Toolbar actions ──────────────────────────────────────────────────────
  const handleFormat = useCallback(
    (cmd) => {
      editorRef.current?.focus();
      if (cmd === "createLink") {
        const url = window.prompt("Enter link URL:", "https://");
        if (url?.trim()) exec("createLink", url.trim());
      } else if (cmd === "insertImage") {
        const url = window.prompt("Enter image URL:", "https://");
        if (url?.trim()) {
          exec(
            "insertHTML",
            `<img src="${url.trim()}" alt="image"
                  style="max-width:100%;height:auto;display:block;margin:8px 0;">`
          );
        }
      } else {
        exec(cmd);
      }
      notifyChange();
    },
    [notifyChange]
  );

  const handleBlockChange = useCallback(
    (e) => {
      const val = e.target.value;
      editorRef.current?.focus();
      exec("formatBlock", val ? `<${val}>` : "<p>");
      // Reset select to placeholder so it reflects actual cursor state
      e.target.value = "";
      notifyChange();
    },
    [notifyChange]
  );

  // ── Paste — strip external styles, keep basic formatting ────────────────
  const handlePaste = useCallback(
    (e) => {
      e.preventDefault();
      const html = e.clipboardData.getData("text/html");
      if (html) {
        const tmp = document.createElement("div");
        tmp.innerHTML = html;
        tmp.querySelectorAll("script,link,meta,style").forEach((el) => el.remove());
        tmp.querySelectorAll("*").forEach((el) => {
          el.removeAttribute("class");
          el.removeAttribute("style");
          el.removeAttribute("id");
        });
        exec("insertHTML", tmp.innerHTML);
      } else {
        exec("insertText", e.clipboardData.getData("text/plain"));
      }
      notifyChange();
    },
    [notifyChange]
  );

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className={styles.wrapper}>
      {/* Toolbar — use onMouseDown + preventDefault to keep editor focus */}
      <div className={styles.toolbar} onMouseDown={(e) => e.preventDefault()}>
        <select
          className={styles.blockSelect}
          defaultValue=""
          onChange={handleBlockChange}
          title="Text style"
        >
          {BLOCK_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <span className={styles.sep} />

        {TOOLS.map((t, i) => {
          if (t.type === "sep") return <span key={i} className={styles.sep} />;
          return (
            <button
              key={t.cmd}
              type="button"
              title={t.title}
              className={`${styles.toolBtn} ${t.cls ? styles[t.cls] : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                handleFormat(t.cmd);
              }}
            >
              {t.icon}
            </button>
          );
        })}
      </div>

      {/* Editable content area */}
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        className={styles.editArea}
        onInput={notifyChange}
        onBlur={notifyChange}
        onPaste={handlePaste}
        data-placeholder="Start typing your email content here…"
      />
    </div>
  );
});

export default RichTextEditor;
