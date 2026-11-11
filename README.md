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
- **Sections**: combine several banks under one outcome with *Combine with above*. A section has one label, draw count and points. Its questions come from the banks together, and every form gets the same mix of banks, in proportion to their sizes (what a plain draw from the merged set gives on average). A section prints as one part. *Separate* takes a bank back out, with its share of the draw.
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
2. **Blueprint.** Match the online exam: draw count and points for each pool (or for a section of combined pools), the time limit, instructions and closing line.
3. **Generate.** Choose how many forms you need and check the overlap table.
4. **Review.** Read each form in the preview, and swap or edit any question.
5. **Export.** Print the booklet, answer sheet and key to PDF, or download them as Word files. Printing records which questions were used, so the next make-up draws different ones.

Save the project file after a make-up if you want to reprint the same forms later or keep the usage history on another computer.

## Accessibility

The editor aims for **WCAG 2.1 Level AA**, the standard the ADA Title II rule uses for public colleges and universities. It was checked against WCAG 2.2 AA as well. An audit in November 2026 (axe-core in every step, dialog and style, plus keyboard, zoom and reflow tests) led to these changes:

- **Keyboard**: everything works without a mouse.
  - The first Tab shows a *Skip to the current step* link.
  - Tab reaches the bank import box; press Enter or Space to choose files.
  - On the review page, Tab reaches each question's *Edit* and *Swap* buttons, which screen readers announce as "Edit question 3" and "Swap question 3".
- **Dialogs**: a screen reader announces each dialog's title.
  - Focus moves into the dialog and stays there while it is open; the page behind can't be reached.
  - On closing, focus returns to the button that opened it.
- **Steps**: *Next* and *Back* move focus to the new step's heading, so screen readers announce the step.
- **Status messages**: screen readers read out messages such as "Imported 6 pools" and "Generated 2 forms", and the question editor's problems and warnings as they appear. On-screen messages now stay for at least 4 seconds, longer for long ones.
- **Selected items**: screen readers say which form (A, B…) and which document (*Test booklet*, *Answer sheet*, *Answer key*) is selected.
- **Structure and names**: the app name is the page's main heading.
  - Every group of options and every table heading has a name.
  - The step buttons are named by their visible text ("1 Import banks"), so voice-control users can say what they see.
- **Click targets**: small checkboxes and buttons have at least 24 px of room (WCAG 2.2).
- **Motion**: scrolling is instant instead of smooth when the system asks for reduced motion.
- **Contrast**: text meets 4.5:1 in every style, in Day and Night. Text boxes and menus have outlines of at least 3:1.
- **Narrow screens and zoom**: the page works at 320 px wide (400% zoom) without scrolling sideways.
- **Device settings**: the page follows the system's contrast settings.
  - *Increase contrast* (macOS, iOS and some Windows and Android settings) makes secondary text and borders full strength and focus rings thicker.
  - Windows high-contrast mode keeps the current step, form and document outlined, and dialogs bordered.
- **Word files**: the exam title is *Heading 1*, and *Instructions* and each part are *Heading 2*. Word's navigation pane and screen readers can then move by heading, and Word's Accessibility Checker no longer reports missing headings. The page looks the same. Heading rows of tables repeat on each page and are read as column headings. Pictures carry their descriptions as alt text.

Checker results for this version:
- Google Lighthouse accessibility scores 100.
- HTML_CodeSniffer (pa11y) reports no errors.
- axe reports no WCAG failures in any step, dialog or style.

Two kinds of warnings remain by design:
- Formatting buttons shown as symbols (x², √x) are named in words ("Superscript"). W3C's guidance exempts symbols from the rule that a name must match its visible text.
- HTML_CodeSniffer adds advisory notes it asks people to check by hand.

Still to do: a test with a real screen reader (NVDA, JAWS, VoiceOver). Report accessibility problems through GitHub issues.

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
css/app.css         all styling: the nine styles, contrast settings and the printed page
tools/og-image/     the HTML the preview image is drawn from
js/theme.js         applies the saved style and Day/Night choice before the page paints
js/model.js         question types, pools and the exam blueprint
js/bbimport.js      reading Blackboard question bank .zip files and .bbq.json projects
js/zip.js           reading and writing .zip files (Compression Streams)
js/forms.js         seeded form generation, overlap and usage tracking
js/richtext.js      formatting and math markup (shared with the Question Editor)
js/wysiwyg.js       the visual fields: toolbar, math, pictures and tables
js/paper.js         booklet, answer sheet and key for print and PDF
js/docx.js          Word (.docx) export, with math as native Word equations and real headings
js/samples.js       the six sample banks and sample exam (loaded on demand)
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
