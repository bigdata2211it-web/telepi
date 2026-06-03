# TelePi Architecture

```mermaid
graph TD
    subgraph "TelePi Core"
        ENV[config.env<br/>TELEGRAM_BOT_TOKEN<br/>TELEGRAM_ALLOWED_USER_IDS<br/>TELEPI_WORKSPACE] --> INDEX[dist/index.js]
        INDEX --> BOT[dist/bot.js<br/>grammy framework]
        INDEX --> CLI[dist/cli.js<br/>entry point]
        
        BOT --> SESSION[dist/pi-session.js<br/>Pi Coding Agent Session]
        BOT --> MIRROR[dist/create-mirror.js<br/>Bot Mirroring]
        BOT --> VOICE[dist/voice.js<br/>Voice via sherpa-onnx]
        
        SESSION --> PI[Pi Coding Agent API]
        MIRROR --> SERVICE[dist/install/service-manager.js<br/>systemd / NSSM]
        VOICE --> SHERPA[sherpa-onnx-node<br/>OnlineRecognizer<br/>OfflineRecognizer<br/>OfflineTts]
    end

    subgraph "Data"
        MODELS[~/.pi/agent/models.json] --> PI
        CONFIG[~/.config/telepi/config.env] --> ENV
        INSTANCES[~/.config/telepi/instances/*/] --> MIRROR
    end

    subgraph "Deploy"
        DOCKER[Dockerfile<br/>multi-stage build] --> IMAGE[Docker Image<br/>node:20-slim + ffmpeg]
        NATIVE[install.sh / install-windows.ps1] --> SERVICE
        IMAGE --> CONTAINER[docker run<br/>--restart unless-stopped]
        CONTAINER --> VOL_CONFIG[-v config.env]
        CONTAINER --> VOL_PI[-v .pi]
        CONTAINER --> VOL_WORK[-v projects:/workspace]
    end

    subgraph "User"
        TG[Telegram User] --> |/start /new /mirror| BOT
        TG --> |voice message| VOICE
        TG --> |text| SESSION
    end
```

## Data Flow

```
User → Telegram → bot.js (grammy) → pi-session.js → Pi Coding Agent API → OpenAI/Anthropic/DeepSeek
Voice: User → Telegram (voice) → voice.js → sherpa-onnx → text → pi-session.js
Mirror: User → /mirror → create-mirror.js → new bot instance with own token
```

## Key Files

| Path | Purpose |
|------|---------|
| `dist/index.js` | Entry point, loads config, starts bot |
| `dist/bot.js` | Telegram bot handlers (grammy) |
| `dist/voice.js` | Voice transcription (sherpa-onnx) |
| `dist/pi-session.js` | Pi Coding Agent session management |
| `dist/create-mirror.js` | Bot mirroring (multi-instance) |
| `dist/install/service-manager.js` | Cross-platform service (systemd/NSSM) |
| `Dockerfile` | Multi-stage Docker build |
| `BRIDGE.md` | AI agent entry point |

## Dependencies

- grammy — Telegram Bot API framework
- @mariozechner/pi-coding-agent — Pi Coding Agent integration
- sherpa-onnx-node — local voice recognition (optional)
- ffmpeg — audio conversion (optional, for voice)
