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
