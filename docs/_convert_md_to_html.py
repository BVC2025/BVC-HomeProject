"""
Convert docs/BVC24_DOCUMENTATION.md to a print-ready styled HTML.
Intended to feed Chrome (PDF) and Word (DOCX) conversion steps.
"""

import os
import sys
from pathlib import Path

import markdown

DOCS_DIR = Path(__file__).parent
MD_PATH = DOCS_DIR / "BVC24_DOCUMENTATION.md"
HTML_PATH = DOCS_DIR / "BVC24_DOCUMENTATION.html"

CSS = """
@page {
  size: A4;
  margin: 18mm 16mm 18mm 16mm;
}

* { box-sizing: border-box; }

body {
  font-family: 'Segoe UI', 'Calibri', 'Arial', sans-serif;
  font-size: 11pt;
  color: #0f172a;
  line-height: 1.55;
  margin: 0;
  padding: 0;
  background: white;
}

.cover {
  page-break-after: always;
  padding: 90mm 0 0 0;
  text-align: center;
}

.cover .brand {
  font-size: 14pt;
  letter-spacing: 4pt;
  color: #C8102E;
  font-weight: 800;
  margin-bottom: 12pt;
}

.cover h1 {
  font-size: 28pt;
  margin: 0 0 18pt;
  color: #0f172a;
}

.cover .sub {
  font-size: 13pt;
  color: #64748b;
  margin-bottom: 8pt;
}

.cover .meta {
  margin-top: 40mm;
  font-size: 10pt;
  color: #94a3b8;
}

.cover .accent {
  height: 4pt;
  width: 80mm;
  margin: 0 auto 18pt;
  background: linear-gradient(90deg, #C8102E, #F4B324);
  border-radius: 2pt;
}

h1 {
  font-size: 22pt;
  color: #8B0B1F;
  border-bottom: 2pt solid #C8102E;
  padding-bottom: 6pt;
  margin-top: 28pt;
  page-break-after: avoid;
}

h2 {
  font-size: 16pt;
  color: #C8102E;
  margin-top: 22pt;
  page-break-after: avoid;
}

h3 {
  font-size: 13pt;
  color: #0f172a;
  margin-top: 16pt;
  page-break-after: avoid;
}

h4 {
  font-size: 11pt;
  color: #475569;
  margin-top: 12pt;
  page-break-after: avoid;
}

p { margin: 6pt 0; }

ul, ol {
  margin: 6pt 0;
  padding-left: 18pt;
}

li { margin: 3pt 0; }

a {
  color: #C8102E;
  text-decoration: none;
}

a:hover { text-decoration: underline; }

code {
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 9.5pt;
  background: #fef2f2;
  color: #8B0B1F;
  padding: 1pt 4pt;
  border-radius: 3pt;
}

pre {
  background: #1A0508;
  color: #f8fafc;
  padding: 10pt 14pt;
  border-radius: 6pt;
  border-left: 3pt solid #C8102E;
  overflow-x: auto;
  font-family: 'Consolas', 'Courier New', monospace;
  font-size: 9pt;
  line-height: 1.45;
  page-break-inside: avoid;
}

pre code {
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: inherit;
}

blockquote {
  margin: 8pt 0;
  padding: 6pt 14pt;
  border-left: 3pt solid #F4B324;
  background: #fffaeb;
  color: #6b4226;
  font-style: italic;
}

table {
  width: 100%;
  border-collapse: collapse;
  margin: 10pt 0;
  font-size: 10pt;
  page-break-inside: auto;
}

table th {
  background: linear-gradient(135deg, #C8102E, #8B0B1F);
  color: white;
  text-align: left;
  padding: 6pt 8pt;
  font-weight: 700;
  font-size: 10pt;
}

table td {
  padding: 5pt 8pt;
  border-bottom: 0.5pt solid #e2e8f0;
  vertical-align: top;
}

table tr:nth-child(even) td {
  background: #fafafa;
}

hr {
  border: none;
  border-top: 1pt solid #e2e8f0;
  margin: 18pt 0;
}

strong { color: #0f172a; }

.toc {
  page-break-after: always;
  padding: 14pt 0;
}

.toc h1 {
  border-bottom: 2pt solid #C8102E;
  padding-bottom: 8pt;
  margin-top: 0;
}

.toc ul {
  list-style: none;
  padding-left: 0;
}

.toc ul ul {
  padding-left: 18pt;
  list-style: disc;
}

.toc li { margin: 4pt 0; }

.toc a {
  color: #0f172a;
  text-decoration: none;
}

.toc a:hover {
  color: #C8102E;
}

/* Avoid orphans / widows on small text blocks */
p, li { orphans: 3; widows: 3; }

/* Page break helpers */
h1 { page-break-before: auto; }
"""

COVER_HTML = """
<div class="cover">
  <div class="brand">BVC24 &middot; BHARATH VENDING CORPORATION</div>
  <div class="accent"></div>
  <h1>BVC24 Manufacturing ERP</h1>
  <div class="sub">Complete System Documentation &middot; Edition 1.0</div>
  <div class="sub">Engineering &amp; Implementation Reference</div>
  <div class="meta">
    Chennai, Tamil Nadu, India<br>
    www.bvc24.in
  </div>
</div>
"""


def main():

    if not MD_PATH.exists():

        print(f"ERROR: missing {MD_PATH}", file=sys.stderr)

        sys.exit(1)

    md_text = MD_PATH.read_text(encoding="utf-8")

    body_html = markdown.markdown(
        md_text,
        extensions=[
            "tables",
            "fenced_code",
            "toc",
            "sane_lists",
            "attr_list",
        ],
        output_format="html5",
    )

    full_html = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>BVC24 ERP — Complete System Documentation</title>
<style>{CSS}</style>
</head>
<body>
{COVER_HTML}
{body_html}
</body>
</html>
"""

    HTML_PATH.write_text(full_html, encoding="utf-8")

    size_kb = HTML_PATH.stat().st_size / 1024

    print(f"OK -> {HTML_PATH} ({size_kb:.0f} KB)")


if __name__ == "__main__":

    main()
