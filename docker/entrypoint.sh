#!/bin/sh
set -e

CONFIG_PATH="${MIYOUQIAN_CONFIG_PATH:-/app/state/config.json}"
CONFIG_DIR="$(dirname "$CONFIG_PATH")"
ACCOUNT_PATH="${MIYOUQIAN_ACCOUNT_PATH:-$CONFIG_DIR/account.json}"

export PYTHONPYCACHEPREFIX="${PYTHONPYCACHEPREFIX:-/tmp/.cache/pycache}"

umask 077

# 创建必要的目录
mkdir -p "$CONFIG_DIR" "$CONFIG_DIR/data" "$CONFIG_DIR/logs"

# 如果配置文件不存在，优先寻找 config.json 或 config.yaml，均无则从示例配置复制
if [ ! -f "$CONFIG_PATH" ] && [ ! -f "$CONFIG_DIR/config.yaml" ] && [ ! -f "$CONFIG_DIR/config.json" ]; then
  if [ -f /app/config.example.json ]; then
    echo "[entrypoint] config not found, copying from config.example.json"
    cp /app/config.example.json "$CONFIG_PATH"
  elif [ -f /app/config.example.yaml ]; then
    echo "[entrypoint] config not found, copying from config.example.yaml"
    cp /app/config.example.yaml "$CONFIG_PATH"
  fi
fi

# 如果 account.json 不存在，且没有旧的 credentials.yaml，则初始化为空列表
if [ ! -f "$ACCOUNT_PATH" ] && [ ! -f "$CONFIG_DIR/data/credentials.yaml" ] && [ ! -f "$CONFIG_DIR/credentials.yaml" ]; then
  echo "[]" > "$ACCOUNT_PATH"
fi

chmod 700 "$CONFIG_DIR" "$CONFIG_DIR/data" "$CONFIG_DIR/logs" 2>/dev/null || true
chmod 600 "$CONFIG_PATH" 2>/dev/null || true
[ -f "$ACCOUNT_PATH" ] && chmod 600 "$ACCOUNT_PATH" 2>/dev/null || true

exec "$@"
