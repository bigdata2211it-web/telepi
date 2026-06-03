# TelePi

Telegram-интерфейс для Pi Coding Agent. Linux + Windows.

## Установка

### Linux / macOS (npm)

```bash
git clone https://github.com/bigdata2211it-web/telepi.git
cd telepi
cp .env.example ~/.config/telepi/config.env
# отредактировать: токен от @BotFather, свой user ID
npm start
```

### Windows (npm)

```powershell
.\install-windows.ps1
.\telepi.ps1 start
```

### Docker (любая платформа)

```bash
# 1. Клонировать
cd telepi

# 2. Собрать образ
docker build -t telepi .

# 3. Создать конфиг
mkdir -p ~/.config/telepi
cat > ~/.config/telepi/config.env << 'EOF'
TELEGRAM_BOT_TOKEN=твой_токен_от_BotFather
TELEGRAM_ALLOWED_USER_IDS=твой_telegram_id
TELEPI_WORKSPACE=/workspace
# PI_MODEL=opencode/deepseek-v4-flash-free
EOF

# 4. Запустить
docker run -d --name telepi \
  --restart unless-stopped \
  -v ~/.config/telepi/config.env:/root/.config/telepi/config.env:ro \
  -v ~/.pi:/root/.pi:ro \
  -v ~/projects:/workspace \
  telepi

# 5. Логи
docker logs -f telepi
```

## Команды

| Linux | Windows |
|-------|---------|
| `tp start` | `.\telepi.ps1 start` |
| `tp start --instance mirror` | `.\telepi.ps1 start --instance mirror` |
| `systemctl --user stop telepi` | `.\telepi.ps1 stop` |
| `journalctl --user -u telepi -f` | `.\telepi.ps1 logs` |

### Telegram

`/mirror` — создать копию бота. `/model deepseek` — поиск модели. `/new` — новая сессия. `/abort` — прервать.

## Структура

```
telepi/
├── dist/                    # готовый код
├── telepi.sh / telepi.ps1  # entry points
├── install.sh / install-windows.ps1
├── systemd/                 # systemd unit
├── CHANGELOG.md
└── package.json
```

## Конфиг

`~/.config/telepi/config.env`

| Параметр | Обязательно |
|----------|-------------|
| `TELEGRAM_BOT_TOKEN` | да |
| `TELEGRAM_ALLOWED_USER_IDS` | да |
| `TELEPI_WORKSPACE` | нет (по умолч. `~/projects`) |
| `PI_MODEL` | нет |
| `OPENAI_API_KEY` | нет (voice) |
| `SHERPA_ONNX_MODEL_DIR` | нет (voice) |

## Лицензия

MIT
