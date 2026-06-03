# 🤖 TelePi DebiStudio Fork

![GitHub release (latest by date)](https://img.shields.io/github/v/release/bigdata2211it-web/telepi?label=release)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)
![platform](https://img.shields.io/badge/platform-Linux%20%7C%20Windows-lightgrey)

> Форк `@futurelab-studio/telepi` — полноценный Telegram-интерфейс для Pi Coding Agent.

## 🚀 Возможности

| Фича | Описание |
|------|----------|
| 🎙 **Voice** | Groq / OpenAI / Sherpa-ONNX, управление ключами через Telegram UI |
| 🔍 **Model search** | `/model <text>` — поиск и фильтрация моделей |
| 🪞 **Mirror** | `/mirror` — создать копию бота за 3 шага (кроссплатформенно) |
| 📁 **Media send** | Локальные файлы и URL → автоотправка, альбомы до 10 |
| ✏️ **Markdown fix** | `**bold**` → HTML, fallback без звёздочек |
| 🦊 **Stealth-browser** | docker-stealthy + MCP-camoufox для обхода WAF/anti-bot |
| 🧠 **1M context** | deepseek-v4-flash-free, minimax-m3-free, mimo-v2.5-free |
| ♿ **Очередь промптов** | inline-кнопки отмены ✖️🛑 с reply на исходное сообщение |
| 🪟 **Windows Service** | NSSM + PowerShell CLI (полный аналог systemd) |

## 📦 Установка

### 🐧 Linux / 🍎 macOS

```bash
# Требования: Node.js v20+, git
git clone https://github.com/bigdata2211it-web/telepi.git
cd telepi
bash install.sh

# Создай конфиг
cp .env.example ~/.config/telepi/config.env
nano ~/.config/telepi/config.env  # вставь токен от @BotFather

# Запуск
tp start
```

### 🪟 Windows

```powershell
# Требования: Node.js v20+, PowerShell 5.1+
git clone https://github.com/bigdata2211it-web/telepi.git
cd telepi

# Установка (скачает NSSM, создаст конфиг, зарегистрирует сервис)
.\install-windows.ps1

# Или с параметрами:
.\install-windows.ps1 -BotToken "123456:ABC..." -UserIds "8570556962"
```

## 📟 Команды

### Управление сервисом

| Действие | 🐧 Linux | 🪟 Windows |
|----------|----------|------------|
| **Запустить** | `tp start` | `.\telepi.ps1 start` |
| **Остановить** | `systemctl --user stop telepi` | `.\telepi.ps1 stop` |
| **Перезапустить** | `systemctl --user restart telepi` | `.\telepi.ps1 restart` |
| **Статус** | `systemctl --user status telepi` | `.\telepi.ps1 status` |
| **Логи** | `journalctl --user -u telepi -f` | `.\telepi.ps1 logs` |
| **Удалить** | `systemctl --user disable --now telepi` | `.\telepi.ps1 remove` |

### Зеркала (--instance / /mirror)

| Действие | 🐧 Linux | 🪟 Windows |
|----------|----------|------------|
| **Запустить зеркало** | `tp start --instance pi-agent-2` | `.\telepi.ps1 start --instance pi-agent-2` |
| **Создать через Telegram** | `/mirror` в чате с ботом | `/mirror` в чате с ботом |
| **Статус зеркала** | `systemctl --user status telepi@pi-agent-2` | `.\telepi.ps1 status --instance pi-agent-2` |

### Внутренние команды Telegram

| Команда | Что делает |
|---------|-----------|
| `/model <text>` | Поиск модели (например, `/model deepseek`) |
| `/session` | Текущая сессия |
| `/sessions` | Список сессий, переключение |
| `/new` | Новая сессия |
| `/mirror` | Создать зеркало (3 шага: токен → имя → admin ID) |
| `/retry` | Повторить последний промпт |
| `/abort` | Прервать текущий ответ |
| `/status` | Диагностика бота |
| ❌✖️ | Отменить последний промпт / убрать из очереди |
| 🛑 | Отменить всё (abort + очистить очередь) |

## 📁 Структура проекта

```
telepi/
├── dist/                     # Скомпилированный код
│   ├── bot.js                # Telegram bot (grammy)
│   ├── create-mirror.js      # Создание зеркал (кроссплатформа)
│   ├── cli.js                # CLI entrypoint
│   ├── config.js             # Загрузка конфига
│   ├── install/              # Установщики (systemd, NSSM, launchd)
│   │   ├── platform.js       # Определение платформы
│   │   ├── systemd.js        # Linux systemd manager
│   │   ├── launchd.js        # macOS launchd manager
│   │   ├── nssm-manager.js   # Windows NSSM manager
│   │   └── service-manager.js # Platform-agnostic facade
│   └── bot/                  # Telegram handlers
│       ├── prompt-handler.js # Обработка промптов + стриминг + очередь
│       ├── chat-task-runner.js # Очередь задач
│       └── telegram-transport.js # sendMessage, editMessage, reply
├── telepi.sh                 # 🐧 Linux entry point
├── telepi.ps1                # 🪟 Windows PowerShell CLI
├── install.sh                # 🐧 Установщик Linux
├── install-windows.ps1       # 🪟 Установщик Windows
├── systemd/                  # systemd unit template
├── .github/workflows/        # CI/CD (GitHub Release по тегу)
├── CHANGELOG.md
└── LICENSE                   # MIT
```

## 🧩 Архитектура сервисов

```
┌──────────┐     ┌──────────────────────┐
│ Telegram │────▶│   Node.js (grammy)   │
│   Bot    │     │  dist/cli.js start   │
└──────────┘     └──────────┬───────────┘
                            │
              ┌─────────────┴─────────────┐
              │                           │
     ┌────────┴────────┐       ┌─────────┴────────┐
     │ 🐧 systemd      │       │ 🪟 NSSM           │
     │ telepi.service  │       │ TelePi service    │
     │ telepi@.service │       │ TelePi-<name>     │
     │ (template)      │       │ (per instance)    │
     └─────────────────┘       └──────────────────┘
              │                           │
     ┌────────┴────────┐       ┌─────────┴────────┐
     │ journalctl      │       │ .ps1 logs        │
     │ ~/.local/state/ │       │ ~/.local/state/  │
     │ telepi/logs/    │       │ telepi/logs/      │
     └─────────────────┘       └──────────────────┘
```

## 🪞 Mirror / Зеркала

Создание копии бота с другим токеном через Telegram UI:

```
/mirror
  → отправляешь токен второго бота (от @BotFather)
  → отправляешь имя (например, pi-agent-2)
  → отправляешь admin user ID
  → ✅ Бот создаёт конфиг, регистрирует сервис и запускает
```

Под капотом `service-manager.js` определяет платформу:
- **Linux:** `systemctl --user enable telepi@<name> --now`
- **Windows:** `nssm install TelePi-<name> ... && nssm start TelePi-<name>`

## 📋 Конфигурация

Конфиг: `~/.config/telepi/config.env` (или `%USERPROFILE%\.config\telepi\config.env` на Windows)

| Переменная | Описание | По умолчанию |
|-----------|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | Токен от @BotFather | **обязательно** |
| `TELEGRAM_ALLOWED_USER_IDS` | ID разрешённых пользователей (через запятую) | **обязательно** |
| `TELEPI_WORKSPACE` | Рабочая директория для сессий | `~/projects` |
| `PI_MODEL` | Модель по умолчанию | — |
| `OPENAI_API_KEY` | Для OpenAI Whisper (voice) | — |
| `SHERPA_ONNX_MODEL_DIR` | Локальная модель для voice | — |
| `TOOL_VERBOSITY` | Детализация вывода (`all`/`summary`/`errors-only`/`none`) | `summary` |

## 🔧 Разработка

```bash
# Клонировать
git clone https://github.com/bigdata2211it-web/telepi.git
cd telepi

# Установить зависимости (включая devDependencies при необходимости)
npm install

# Запустить
npm start
# или
node dist/cli.js start
```

## 📜 Changelog

См. [CHANGELOG.md](./CHANGELOG.md)

## 📄 Лицензия

MIT © DebiStudio
