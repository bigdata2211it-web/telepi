#!/usr/bin/env bash
# telepi-fork-update.sh — обновить форк из оригинала
# Запуск: bash telepi/update.sh
# Патчи не слетают — они под гитом.

set -e

FORKE_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ORIG_DIR="$HOME/.npm-global/lib/node_modules/@futurelab-studio/telepi"
BACKUP_DIR="$FORKE_DIR/.dist-backup"

echo "=== TelePi Fork Update ==="
echo ""

# Проверка оригинала
if [ ! -d "$ORIG_DIR/dist" ]; then
  echo "❌ Original telepi not found at $ORIG_DIR"
  echo "   Установи: npm i -g @futurelab-studio/telepi"
  exit 1
fi

# Бекап текущего dist
echo "📦 Backing up current dist..."
rm -rf "$BACKUP_DIR"
cp -r "$FORKE_DIR/dist" "$BACKUP_DIR"
echo "   → $BACKUP_DIR"

# Копируем новый dist из оригинала
echo "📥 Copying new dist from original..."
cp -r "$ORIG_DIR/dist/"* "$FORKE_DIR/dist/"

# Помечаем наши файлы (восстанавливаем из бекапа если оригинал их затер)
echo "🔧 Restoring DebiStudio patches..."
OUR_FILES="
  bot.js
  bot/chat-state.js
  bot/commands/model.js
  bot/message-rendering.js
  bot/prompt-handler.js
  format.js
  voice.js
  media-sender.js
  create-mirror.js
  pi-session.js
"

for file in $OUR_FILES; do
  if [ -f "$BACKUP_DIR/$file" ]; then
    # Проверяем, отличается ли наш патч от нового оригинала
    if [ -f "$FORKE_DIR/dist/$file" ]; then
      if ! cmp -s "$BACKUP_DIR/$file" "$FORKE_DIR/dist/$file"; then
        cp "$BACKUP_DIR/$file" "$FORKE_DIR/dist/$file"
        echo "   ✅ $file (patched)"
      else
        echo "   ➖ $file (unchanged)"
      fi
    else
      cp "$BACKUP_DIR/$file" "$FORKE_DIR/dist/$file"
      echo "   ✅ $file (restored from backup)"
    fi
  fi
done

# Синхронизируем node_modules
echo "🔗 Syncing node_modules..."
ln -sf "$ORIG_DIR/node_modules" "$FORKE_DIR/node_modules" 2>/dev/null

# Проверка
echo ""
echo "=== Проверка ==="
if command -v node &>/dev/null; then
  ERROR=$(node --check "$FORKE_DIR/dist/bot.js" 2>&1) || {
    echo "❌ Syntax error in bot.js! Откатываю..."
    cp -r "$BACKUP_DIR/"* "$FORKE_DIR/dist/"
    echo "   Откат выполнен. Проверь вручную."
    exit 1
  }
  echo "✅ Syntax check passed"
fi

# Очищаем бекап
echo "🧹 Cleaning up..."
rm -rf "$BACKUP_DIR"

echo ""
echo "=== Готово ==="
echo "Форк обновлён до версии оригинала + наши патчи."
echo "Перезапусти бота: systemctl --user restart telepi-debi"
