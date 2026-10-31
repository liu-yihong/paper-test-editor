# Paper Test Editor

> **Disclaimer:** Blackboard is a trademark of Anthology Inc. This is an independent project and is not affiliated with or endorsed by Anthology.

Turn Blackboard question banks into **supervised paper versions** of an online exam, for make-ups you can't monitor on a student's own laptop.

The paper version covers the same outcomes at the same difficulty and time limit. You can print several **parallel forms** at once, each drawing different questions from the same pools, so a leaked or remembered question gives little advantage.

- **Live site:** <https://blog.yihong-liu.com/paper-test-editor/>
- **Companion:** [Blackboard Question Editor](https://github.com/liu-yihong/blackboard-question-editor), which writes the question banks this editor reads
- **Author:** Yihong Liu (the commander), [blog.yihong-liu.com](https://blog.yihong-liu.com/) & [Claude by Anthropic](https://claude.com/) (who did the dirty coding work)

It is a static website: plain HTML, CSS and JavaScript with no server and no build step. Questions never leave your browser.

## Privacy

Questions, forms and usage history stay in your browser. The page never sends them anywhere, and GitHub only sees that someone downloaded the page files.

`index.html` carries a Content Security Policy that only allows files from this site and blocks the page from sending data anywhere (`connect-src 'none'`). Every library and font is served from this repository, and the page uses your device's own fonts first, so normally nothing else is downloaded either.

## Features

- **Import** Blackboard question bank `.zip` files (pool or test exports, as written by Blackboard or the Question Editor) and Question Editor `.bbq.json` projects. Each bank becomes a pool, with its question count and type mix.
- **Blueprint**: order the pools and set, for each one, how many questions to draw, the points per question and an optional outcome label. A warning shows when a pool is too small for its draw count.
- **Generate several forms at once** (A, B, C …) with as little overlap as possible:
  - When a pool is large enough, forms share no questions from it.
  - Otherwise each question is used about equally often, and shared questions are spread evenly across pairs of forms.
  - An overlap table shows how many questions each pair of forms shares.
  - Questions used least, or least recently, are drawn first. The usage history can be viewed and reset.
  - Question order and answer choices are shuffled. "All of the above" and "None of the above" stay last, and True/False is never reordered.
  - Each form keeps its seed and full contents, so it can be reprinted exactly.
- **Review and edit**: swap any question for another from the same pool (ranked by overlap and usage), or edit it on one form or in the pool. Editing is WYSIWYG, with bold, italics, sub- and superscript, code, lists, math, pictures and tables, and a live preview of the printed page.
- **All 8 question types**: Multiple choice, Multiple answer, True/False, Essay, Matching (two columns, with optional extra matches), Fill in the blank, Fill in multiple blanks and Numeric.
- **Three documents per form**:
  - *Test booklet*: a cover page or header with course, title, form code, time limit, instructions and name/ID/date lines. No question splits across pages, and every page shows "Page X of Y" and the form code.
  - *Answer sheet*: bubbles or letter boxes, labelled boxes for blanks, numbers and matching, and adjustable essay space. Students can also answer in the booklet instead.
  - *Answer key*: answers in answer-sheet order, with points and room for essay rubric notes.
- **Export** as PDF (the browser's print dialog) or as Word `.docx` built in the browser, with math as native Word equations. Batch export gives a `.zip` of Word files for every form, or one combined print.
- **Accommodations**: large print, essay lines per question, and Letter or A4 paper.
- **Projects**: work autosaves in the browser. *New project*, *Open project…* and *Save project* work with `.ptest.json` files that hold the exam, pools, forms and usage history.
- **Nine styles** from the *Style* menu, the same set as the Question Editor: *Paper* (the original look), *System* (classic Mac), *Windows 98*, *Windows XP*, *Windows 7*, *Pico*, *MVP*, *new.css* and *Sakura*. *Day*, *Night* and *Auto* work with Paper and the modern styles. The printed pages are always black on white.
- **Sample banks**: *Load six sample banks* adds two SQL banks and four MIS banks with a ready-made 75-minute midterm, to try every feature.

## How you can use it

1. **Import banks.** In Blackboard, export the online exam's question banks (or use the `.zip` files from the Question Editor) and drop them onto the page.
2. **Blueprint.** Match the online exam: draw count and points for each pool, the time limit, instructions and closing line.
3. **Generate.** Choose how many forms you need and check the overlap table.
4. **Review.** Read each form in the preview, and swap or edit any question.
5. **Export.** Print the booklet, answer sheet and key to PDF, or download them as Word files. Printing records which questions were used, so the next make-up draws different ones.

Save the project file after a make-up if you want to reprint the same forms later or keep the usage history on another computer.

## Known limits

- PDF page footers ("Page X of Y" and the form code) need Chrome or Edge, because they use CSS page margin boxes.
- Changing the numbers in Numeric questions, and sending forms back to Blackboard, are out of scope.
- The answer sheet is designed for hand grading, not for scanners.

## Files

```
index.html          page markup and Content Security Policy
favicon.svg         logo and browser-tab icon (Noto Emoji writing hand), with PNG fallbacks
favicon-32.png
apple-touch-icon.png
og-image.png        link-preview image (Open Graph / X card), 2400 × 1260
css/app.css         all styling: the nine styles and the printed page
tools/og-image/     the HTML the preview image is drawn from
js/theme.js         applies the saved style and Day/Night choice before the page paints
js/model.js         question types, pools and the exam blueprint
js/bbimport.js      reading Blackboard question bank .zip files and .bbq.json projects
js/zip.js           reading and writing .zip files (Compression Streams)
js/forms.js         seeded form generation, overlap and usage tracking
js/richtext.js      formatting and math markup (shared with the Question Editor)
js/wysiwyg.js       the visual fields: toolbar, math, pictures and tables
js/paper.js         booklet, answer sheet and key for print and PDF
js/docx.js          Word (.docx) export, with math as native Word equations
js/samples.js       the six sample banks and sample exam
js/app.js           the editor interface
vendor/             KaTeX (math), served locally
fonts/              Carlito subset (printed paper), IBM Plex and Inter fallback fonts, with licences
```

## Licences

The editor's own code: MIT (`LICENSE`)

Third-party parts and their licences:
- KaTeX: MIT (`vendor/LICENSE-KaTeX.txt`)
- Carlito font (Latin subset, renamed "PTE Paper Sans"): SIL Open Font License 1.1 (`fonts/LICENSE-Carlito.txt`)
- IBM Plex fonts: SIL Open Font License 1.1 (`fonts/LICENSE-IBM-Plex.txt`)
- Inter font: SIL Open Font License 1.1 (`fonts/LICENSE-Inter.txt`)
- Noto Emoji "writing hand" artwork, by Google: SIL Open Font License 1.1 (`fonts/LICENSE-Noto-Emoji.txt`)

Form generation uses the cyrb53 hash and Mulberry32 generator published by bryc (public domain) and a Fisher–Yates shuffle. The Word export follows ECMA-376 (Office Open XML), with math converted from MathML to OMML. The question bank reader follows the same Blackboard documentation and real pool exports as the Question Editor.

The retro and modern styles are re-created in this project's own CSS, inspired by System.css, 98.css, XP.css, 7.css, Pico CSS, MVP.css, new.css and Sakura (all MIT). No code from those projects is included. The editor's Credits window lists every source with links.
