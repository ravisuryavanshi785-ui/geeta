# RS Movie Spot — AI Video Generator

A full-stack React + TypeScript + Express web application rewritten from the original Android project.

## Features
- **Script Generation & Preview**: Uses Groq chat models with Auto, Exact Script, and AI Prompt modes, 17 languages, Male/Female voice selection, and 5 voice tone styles.
- **Trending Movie Topics**: Fetches recent Bollywood, Hollywood, and Tollywood movie news ideas from Google News RSS.
- **Editable Scene Cards**: Customize per-scene visual source (`AI`, `Photo`, `Clip`, `Meme`), layout mode (`Single`, `Split 2`, `Flip 2`), internet query, stat badge, and voiceover text.
- **Automated Video Rendering Pipeline**:
  - Microsoft Edge Neural TTS WebSocket synthesis with Google Translate TTS fallback and per-emotion FFmpeg EQ/tempo processing.
  - Cloudflare Workers AI image generation (`flux-2-klein-9b`, `lucid-origin`, `flux-1-schnell`) with IMDb, iTunes, Wikipedia, Wikimedia Commons, Openverse, Coub, and Tenor media fetching.
  - Built-in 8-style procedural BGM synthesizer with voice-activity auto-ducking or custom BGM audio upload.
  - FFmpeg segment motion (`zoompan`), pop captions, stat badges, watermark, subscribe end-card, cross-dissolve transitions, MP4 export, and JPG cover thumbnail generation.
- **YouTube Upload Kit**: Generates ready-to-copy YouTube title, description + hashtags, and pinned comment.

## Environment Variables
See `.env.example`:
- `GROQ_API_KEY`
- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`

## Commands
- `npm run dev` — Start Express + Vite dev server on port 3000
- `npm run build` — Build frontend bundle with Vite
- `npm run start` — Start production Node.js server on port 3000
- `npm run lint` — Run TypeScript typechecking
