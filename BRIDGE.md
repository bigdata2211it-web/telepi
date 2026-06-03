# BRIDGE — TelePi

> **Это запускаемый проект, не документация.**
> Telegram-бот для Pi Coding Agent. Node.js v20+, grammy framework.

## Быстрый старт

### Напрямую (npm)
```bash
cd /home/debi/DebiForeverProfile/telepi
npm start
```

### Docker
```bash
docker build -t telepi .
docker run -d --name telepi \
  --restart unless-stopped \
  -v ~/.config/telepi/config.env:/root/.config/telepi/config.env:ro \
  -v ~/.pi:/root/.pi:ro \
  -v ~/projects:/workspace \
  telepi
```

## Статус

- ✅ `dist/` — готовый JS-код (скомпилирован)
- ✅ `node_modules/` — зависимости установлены
- ✅ `~/.config/telepi/config.env` — токен + user ID + workspace
- ✅ Node.js v24.15.0

## Структура

| Путь | Назначение |
|------|-----------|
| `dist/index.js` | entry point |
| `dist/bot.js` | Telegram bot (grammy) |
| `dist/voice.js` | голосовой бэкенд (sherpa-onnx) |
| `dist/create-mirror.js` | клонирование бота |
| `dist/pi-session.js` | сессии Pi Coding Agent |
| `telepi.sh` | Linux launcher |
| `telepi.ps1` | Windows launcher |
| `install.sh` | Linux установка |
| `install-windows.ps1` | Windows установка с NSSM |

## Профиль

- DebiForeverProfile: `/home/debi/DebiForeverProfile/`
- Команды Pi: `sendto` — отправить сообщение через telepi
- Скиллы: `telepi-media-send`, `telepi-multi-bot-send`, `sendto`

## Команды бота

`/mirror` `/model <name>` `/new` `/sessions` `/abort` `/retry`
