# QUIZINOX — Offline Android Quiz App

Telegram-independent, local-first quiz maker/player. The Android build is produced by GitHub Actions.

## What works offline
- Create, edit, duplicate, delete and organize quizzes on the device
- Play quizzes with timer, shuffle, negative marking and explanations
- Local results, attempt history and performance analytics
- Import TXT / JSON / PDF text; export quizzes as JSON/TXT
- Generate PDF result reports
- TXT fixer and emoji formatter
- Local backup / restore

## Optional online features
AI question generation from a topic or PDF and translation require internet and your own Gemini API key. The key is stored only on this device. No key is needed for offline features.

## Build APK
Push to GitHub. Open **Actions → Build QUIZINOX Android APK** and download the `QUIZINOX-APK` artifact.

The APK produced by this workflow is a debug APK suitable for direct testing/installing after enabling “Install unknown apps”. For Play Store release, create a separately signed release build.

## Local development
```bash
npm install
npm run dev
```


## GitHub Actions dependency installation
The workflow deliberately runs `npm install` without npm caching. A committed
`package-lock.json` is not required for this workflow, and setup-node's npm
cache is not enabled (it requires a lockfile). The workflow installs packages
from `package.json` on each build.


## Updated quiz experience
- Exam mode: answer one question at a time; score and full answer review are shown after the final question.
- Practice mode: selecting an answer immediately reveals correctness, the correct option and explanation.
- TXT importer recognizes the supplied QUIZINOX sample layouts:
  - `Q.1)` numbered questions with plain options and `Ex:` explanations
  - `Q1.` questions separated from options by a standalone 😂 separator
  - Lettered options such as `a)`, `b)`, `c)`, `d)`
  - Correct-answer markers such as `✅`, `✔`, or `✓`
- PDF import uses text positioning to preserve line breaks before question parsing.
- PDF → TXT converter extracts selectable text locally. Scanned/image-only PDFs require OCR and are not auto-converted.
- The uploaded QUIZINOX emblem is used for web favicon and Android launcher icons.


Import regression check: the TXT parser was run against all 10 files in the supplied sample ZIP and extracted 50/50 questions from each file (500 questions total), including the two OCR-style answer labels found in the formatted solution sample.
