#!/usr/bin/env bash
# Install TelePi DebiStudio fork
#
# Usage:
#   bash install.sh              — установка
#   bash install.sh --instance   — создать инстанс (токен запросит)
#   bash install.sh --from-telepi — перенести конфиг из оригинального telepi

set -e

FORKE_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_DIR="$HOME/.config/telepi"
INSTANCES_DIR="$CONFIG_DIR/instances"

echo "=== TelePi DebiStudio Fork Installation ==="
echo ""

# Проверка Node.js
if ! command -v node &>/dev/null; then
  echo "❌ Node.js not found. Install it first."
  exit 1
fi
echo "✅ Node.js $(node --version)"

# Проверка npm-зависимостей (оригинальный telepi)
if [ ! -d "$FORKE_DIR/node_modules" ]; then
  echo "⚠️  node_modules not found. Symlinking..."
  ln -sf /home/debi/.npm-global/lib/node_modules/@futurelab-studio/telepi/node_modules "$FORKE_DIR/node_modules" 2>/dev/null || {
    echo "❌ Original telepi not found at ~/.npm-global"
    echo "   Install it first: npm i -g @futurelab-studio/telepi"
    exit 1
  }
fi
echo "✅ Dependencies ready"

# Создаём конфиг директорию
mkdir -p "$CONFIG_DIR"
mkdir -p "$INSTANCES_DIR"

# Устанавливаем symlink для telepi команды
if [ ! -f "$HOME/.local/bin/tp" ]; then
  mkdir -p "$HOME/.local/bin"
  ln -sf "$FORKE_DIR/telepi.sh" "$HOME/.local/bin/tp"
  echo "✅ Команда 'tp' установлена (~/.local/bin/tp)"
  echo "   Используй: tp start"
  echo "   Или: tp start --instance mirror"
else
  echo "ℹ️  Команда 'tp' уже существует"
fi

# Копируем systemd сервис
SYSTEMD_DIR="$HOME/.config/systemd/user"
mkdir -p "$SYSTEMD_DIR"
cp "$FORKE_DIR/systemd/telepi@.service" "$SYSTEMD_DIR/"
systemctl --user daemon-reload 2>/dev/null || true
echo "✅ Systemd сервис установлен"

echo ""
echo "=== Установка завершена ==="
echo ""
echo "Дальнейшие шаги:"
echo "  1. Настрой конфиг: nano $CONFIG_DIR/config.env"
echo "     — TELEGRAM_BOT_TOKEN=..."
echo "     — TELEGRAM_ALLOWED_USER_IDS=..."
echo "     — TELEPI_WORKSPACE=/home/user/projects"
echo ""
echo "  2. Запусти бота:"
echo "     tp start"
echo ""
echo "  3. Или создай зеркало:"
echo "     tp start --instance mirror1       (если config в instances/mirror1/)"
echo ""
echo "  4. Если был оригинальный telepi:"
echo "     cp \$HOME/.config/telepi/config.env \$HOME/.config/telepi/config.env.bak"
echo "     tm…… пусть пока, скопируй сам"
echo ""
echo "Подробнее: README.md"
