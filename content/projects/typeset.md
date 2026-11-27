---
problem: "LaTeX CVs look excellent, but editing raw LaTeX is slow and error-prone, and most online CV builders upload your personal details to someone else's server. Typeset gives you the LaTeX look with a simple form, entirely in your browser."
platform: "Any modern browser, desktop or mobile"
---

## What it does

Typeset is a CV editor that runs in a single web page. You fill in your details section by section, and a page-accurate preview updates as you type, laid out in Latin Modern, the typeface of LaTeX documents.

When you're done, you can:

- **Download a PDF** through the browser's print dialog, with real, selectable text that applicant tracking systems can read
- **Download the LaTeX source** (`.tex`) and compile it with pdfLaTeX, or **open it directly in Overleaf**
- **Copy the LaTeX** to paste anywhere
- **Save a JSON backup** and import it later or on another device

## Key features

- Sections for education, experience, activities, projects, skills, languages, awards, certifications, publications, references or anything custom, each reorderable by drag and drop and hideable without deleting
- Inline formatting with `**bold**`, `*italic*` and `[links](https://…)`; emails and web addresses in the header become links automatically
- Design presets (Classic, Jake's, Modern and Compact), plus paper size, font size, margins, spacing, heading and name styles, bullets, separators and an accent colour
- A LaTeX view with syntax highlighting, and an optional custom preamble for the export
- Several CVs side by side, with undo and redo, and automatic pagination that shows how full the last page is
- Light and dark modes, keyboard shortcuts and a layout that works on phones

## Private by design

Your CV is saved only in your own browser's storage. There are no accounts and no server, and nothing is uploaded. The only time the app talks to the internet is if you choose **Open in Overleaf**, which sends the generated LaTeX to Overleaf. Once the page has loaded, everything else works offline.

## How it is built

Typeset is one self-contained HTML file with no dependencies: plain JavaScript, CSS and embedded Latin Modern fonts (GUST Font License). The preview measures every block and paginates it with spacing tuned to match pdfLaTeX's article class at 10, 11 and 12 pt. The exported `.tex` follows the layout of Jake Gutierrez's widely used résumé template (MIT licence).
