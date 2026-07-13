"""
Build docs/BVC_ERP_COMPLETE_DOCUMENTATION.pdf from the corresponding
markdown source.

Reuses the professional markdown-to-PDF pipeline defined in
build_employee_module_pdf.py (BVC red palette, cover page, TOC,
styled tables, callouts). Only the source + destination paths change.

Usage:
    cd backend
    .\\venv\\Scripts\\python.exe -m scripts.build_complete_documentation_pdf
"""

import sys
from pathlib import Path


def main() -> int:

    repo_root = Path(__file__).resolve().parents[2]
    md_file  = repo_root / "docs" / "BVC_ERP_COMPLETE_DOCUMENTATION.md"
    pdf_file = repo_root / "docs" / "BVC_ERP_COMPLETE_DOCUMENTATION.pdf"

    if not md_file.exists():
        print(f"ERROR: markdown source not found — {md_file}", file=sys.stderr)
        return 1

    print(f"Source: {md_file}")
    print(f"Target: {pdf_file}")
    print()

    # Reuse the builder from build_employee_module_pdf.py — it's a
    # pure function that takes (md_path, out_path) and writes the PDF.
    from scripts.build_employee_module_pdf import build_pdf

    build_pdf(md_file, pdf_file)

    size_kb = pdf_file.stat().st_size / 1024
    print(f"Done. Wrote {size_kb:.1f} KB to:")
    print(f"  {pdf_file}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
