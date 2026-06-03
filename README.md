# TelePi

Telegram-интерфейс для Pi Coding Agent. Linux + Windows.

## Установка

```bash
git clone https://github.com/bigdata2211it-web/telepi.git
cd telepi
cp .env.example ~/.config/telepi/config.env
# отредактировать: токен от @BotFather, свой user ID
npm start
```

### Windows

```powershell
.\install-windows.ps1
.\telepi.ps1 start
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
