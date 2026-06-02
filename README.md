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

## Команды

| Команда | Что делает |
|---------|-----------|
| `tp start` | Запустить бота |
| `tp start --instance mirror` | Запустить зеркало |
| `systemctl --user restart telepi-debi` | Перезапустить |

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
