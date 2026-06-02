# TelePi DebiStudio Fork

Форк `@futurelab-studio/telepi` с патчами:

- ✅ **Voice backend** — выбор sherpa-onnx / Groq / OpenAI, ввод API ключей через чат
- ✅ **Model search** — `/model <текст>` фильтрует модели
- ✅ **Mirror** — создание копий бота через `/mirror`
- ✅ **Media send** — Pi пишет путь к файлу, telepi сам отправляет в чат
- ✅ **Markdown fix** — `**жирный**` → `<b>жирный</b>`, fallback без звёздочек
- ✅ **1M контекст** — deepseek-v4-flash-free, minimax-m3-free
- ✅ **--instance** — запуск конкретного зеркала

## Установка

```bash
# Клонируем профиль
git clone https://github.com/your/DebiForeverProfile ~/DebiForeverProfile

# Ставим
cd ~/DebiForeverProfile/telepi
bash install.sh
```

## Конфиг

`~/.config/telepi/config.env`:

```env
TELEGRAM_BOT_TOKEN=123456:ABC-DEF...
TELEGRAM_ALLOWED_USER_IDS=123456789
TELEPI_WORKSPACE=/home/user/projects
```

## Запуск

```bash
# Основной бот
tp start

# Зеркало
tp start --instance mirror

# Через systemd
systemctl --user start telepi@main
systemctl --user start telepi@mirror
```

## Структура

```
telepi/
├── dist/               ← патенчед код
├── systemd/            ← сервис темплейты
├── telepi.sh           ← entry point (--instance поддержка)
├── install.sh          ← установщик
└── README.md
```

## Обновление

```bash
# Обновить оригинал
npm i -g @futurelab-studio/telepi

# Обновить форк
cp -r /home/debi/.npm-global/lib/node_modules/@futurelab-studio/telepi/dist/* dist/
```

Патчи не слетают — они под гитом в `DebiForeverProfile/`.

## Портируемость

Скопировать на другой сервер:

```bash
scp -r ~/DebiForeverProfile/telepi user@server:~/
# + config.env + systemd enable
```

## Лицензия

Как у оригинала — MIT.
