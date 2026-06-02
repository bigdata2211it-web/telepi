#!/usr/bin/env bash
# telepi — форк DebiStudio
# Выбор инстанса: telepi start --instance mirror
# Без --instance: обычный запуск

set -e

TELEPI_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="/usr/bin/node"

# Парсим --instance
INSTANCE=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --instance)
      INSTANCE="$2"
      shift 2
      ;;
    --instance=*)
      INSTANCE="${1#*=}"
      shift
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

# Если указан инстанс — подменяем TELEPI_CONFIG
if [ -n "$INSTANCE" ]; then
  INSTANCE_CONFIG="$HOME/.config/telepi/instances/$INSTANCE/config.env"
  if [ ! -f "$INSTANCE_CONFIG" ]; then
    echo "❌ Instance '$INSTANCE' not found: $INSTANCE_CONFIG"
    echo "   Create it with: telepi-clone $INSTANCE <token>"
    exit 1
  fi
  export TELEPI_CONFIG="$INSTANCE_CONFIG"
fi
# Если инстанс не указан — TELEPI_CONFIG не трогаем, telepi прочитает дефолтный путь

exec "$NODE" "$TELEPI_DIR/dist/cli.js" "${ARGS[@]}"
