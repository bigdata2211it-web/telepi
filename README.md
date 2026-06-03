# 🤖 TelePi DebiStudio Fork

> Форк `@futurelab-studio/telepi` с расширенным функционалом: голосовые бэкенды, поиск моделей, зеркала ботов, отправка медиа, docker-stealthy интеграция.

## Возможности

| Фича | Описание |
|------|----------|
| 🎙 **Voice** | Groq / OpenAI / Sherpa-ONNX, API ключи через Telegram UI |
| 🔍 **Model search** | `/model <текст>` — фильтр + variant (`:high`) |
| 🪞 **Mirror** | `/mirror` — создать копию бота в 3 шага |
| 📁 **Media send** | Локальные файлы и URL → автоотправка, альбомы до 10 |
| ✏️ **Markdown fix** | `**bold**` → HTML, fallback без звёздочек |
| 🦊 **Stealth-browser** | docker-stealthy + MCP-camoufox для обхода защит |
| 🚀 **1M context** | deepseek-v4-flash-free, minimax-m3-free, mimo-v2.5-free |

## Быстрый старт

### 🐧 Linux

```bash
# Установка
cd ~/DebiForeverProfile/telepi
bash install.sh

# Настройка конфига
cp .env.example ~/.config/telepi/config.env
nano ~/.config/telepi/config.env  # вставь токен

# Запуск
tp start
```

### 🪟 Windows

```powershell
# Установка (скачает NSSM, создаст конфиг, зарегистрирует сервис)
.\install-windows.ps1

# Или в одну строку с параметрами:
.\install-windows.ps1 -BotToken "123456:ABC..." -UserIds "8570556962"

# Управление
.\telepi.psl status
.\telepi.psl stop
.\telepi.psl start
.\telepi.psl logs

# Удаление сервиса
.\telepi.psl remove
```

**Требования:**
- Node.js v20+ (https://nodejs.org/)
- PowerShell 5.1+ (встроен в Windows 10/11)

## Команды

| Платформа | Команда | Что делает |
|-----------|---------|-----------|
| 🐧 Linux | `tp start` | Запустить бота |
| 🐧 Linux | `tp start --instance mirror` | Запустить зеркало |
| 🐧 Linux | `systemctl --user restart telepi` | Перезапустить сервис |
| 🪟 Windows | `.\telepi.ps1 start` | Запустить бота |
| 🪟 Windows | `.\telepi.ps1 start --instance mirror` | Запустить зеркало |
| 🪟 Windows | `.\telepi.ps1 status` | Статус сервиса |
| 🪟 Windows | `.\telepi.ps1 logs` | Показать логи |
| 🪟 Windows | `.\telepi.ps1 stop` | Остановить |
| 🪟 Windows | `.\telepi.ps1 restart` | Перезапустить |
| 🪟 Windows | `.\telepi.ps1 remove` | Удалить сервис |

## Структура

```
telepi/
├── dist/              — патенчед код
├── telepi.sh          — entry point (--instance)
├── systemd/           — сервис темплейты
├── install.sh         — установщик
├── update.sh          — обновление форка
├── package.json       — @debi-studio/telepi
├── CHANGELOG.md       — история версий
└── LICENSE            — MIT
```

## Обновление

```bash
bash update.sh
systemctl --user restart telepi-debi
```

## Портируемость

Весь форк самодостаточен. Копируй на любую машину с Node.js:

```bash
tar czf telepi.tar.gz ~/DebiForeverProfile/telepi/
scp telepi.tar.gz user@server:~/
# + node + config.env
```

## Лицензия

MIT © DebiStudio
