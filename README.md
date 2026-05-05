# VEO3-Extensions

Chrome Extension for automating Google Labs Flow (VEO3) video generation and TikTok Studio uploads.

## Features

- **Auto Video Generation** — Automates prompt submission on [labs.google](https://labs.google) Flow
- **WebM → MP4 Conversion** — FFmpeg-powered in-browser video conversion
- **TikTok Studio Auto-Upload** — Automatically uploads generated videos to TikTok Studio
- **Task Manager** — Schedule and queue multiple generation tasks with cron-like scheduling
- **Side Panel UI** — Clean side panel on desktop, popup fallback on mobile
- **Gemini & OpenAI API** — Integrates with both Gemini and OpenAI for prompt assistance

## Installation

1. Clone this repo
2. Open Chrome → `chrome://extensions`
3. Enable **Developer Mode**
4. Click **Load unpacked** → select this folder

## Usage

1. Open [labs.google](https://labs.google) Flow
2. Click the extension icon to open side panel
3. Enter prompts and configure settings
4. Use **Task Manager** to schedule automated runs
5. Videos auto-convert to MP4 and optionally upload to TikTok Studio

## Permissions

| Permission | Reason |
|---|---|
| `sidePanel` | Side panel UI on desktop |
| `activeTab` / `scripting` | Automate Flow page interactions |
| `storage` | Persist tasks and settings |
| `clipboardRead/Write` | Copy/paste prompts |
| `alarms` | Scheduled task execution |

## Files

| File | Role |
|---|---|
| `manifest.json` | Extension config (MV3) |
| `background.js` | Service worker — FFmpeg, task scheduling, TikTok control |
| `sidepanel.js/html` | Main UI |
| `content.js` | Injected into labs.google — DOM automation |
| `tiktok_content.js` | Injected into TikTok Studio — upload automation |
| `task-manager.js` | Task CRUD and schedule logging |
| `styles.css` | Shared styles |

## Requirements

- Chrome 114+ (Manifest V3 + Side Panel API)
- Google Labs Flow access
- TikTok Studio account (for auto-upload)
