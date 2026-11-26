#!/usr/bin/env bash
# -*- coding: utf-8 -*-
# MiyoQian Docker 编译与启动脚本

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE_FILE="${SCRIPT_DIR}/docker-compose.yml"

ACTION="up"
NO_CACHE=false
PULL=false
ONLY_APP=false
FOLLOW_LOGS=false

print_help() {
  cat <<'EOF'
用法: ./docker/deploy.sh [动作] [选项]

动作 (默认: up):
  up          编译镜像并后台启动容器
  build       仅编译镜像，不启动容器
  down|stop   停止并移除容器（保留持久化数据卷）
  restart     重启容器
  logs        实时查看容器日志
  status      查看容器运行状态

选项:
  --no-cache            编译时不使用 Docker 缓存
  --pull                编译/启动前拉取最新基础镜像与服务镜像
  --only-app            仅操作 miyouqian 主服务（不启动 test_nine 极验服务）
  -f, --logs            启动完成后立即跟踪输出日志
  --base-image <镜像>   覆盖 Dockerfile 的 BASE_IMAGE 参数
  --pypi-mirror <地址>  覆盖 Dockerfile 的 PYPI_MIRROR 参数
  -h, --help            显示此帮助信息

环境变量（也可直接通过环境变量传入）:
  BASE_IMAGE            基础 Python 镜像地址
  PYPI_MIRROR           PyPI 镜像源地址
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    up|build|down|stop|restart|logs|status)
      ACTION="$1"
      shift
      ;;
    --no-cache)
      NO_CACHE=true
      shift
      ;;
    --pull)
      PULL=true
      shift
      ;;
    --only-app)
      ONLY_APP=true
      shift
      ;;
    -f|--logs)
      FOLLOW_LOGS=true
      shift
      ;;
    --base-image)
      [[ $# -lt 2 ]] && { echo "[错误] --base-image 需要提供参数值" >&2; exit 1; }
      export BASE_IMAGE="$2"
      shift 2
      ;;
    --pypi-mirror)
      [[ $# -lt 2 ]] && { echo "[错误] --pypi-mirror 需要提供参数值" >&2; exit 1; }
      export PYPI_MIRROR="$2"
      shift 2
      ;;
    -h|--help)
      print_help
      exit 0
      ;;
    *)
      echo "[错误] 未知参数: $1" >&2
      echo "使用 --help 查看用法。" >&2
      exit 1
      ;;
  esac
done

[[ "${ACTION}" == "stop" ]] && ACTION="down"

if ! command -v docker >/dev/null 2>&1; then
  echo "[错误] 未检测到 docker 命令，请先安装 Docker。" >&2
  exit 1
fi

if ! docker info >/dev/null 2>&1; then
  echo "[错误] Docker 守护进程未运行或当前用户无权限访问 Docker。" >&2
  exit 1
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE_CMD=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE_CMD=(docker-compose)
else
  echo "[错误] 未检测到 docker compose 或 docker-compose，请先安装 Compose 插件。" >&2
  exit 1
fi

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "[错误] 未找到编排文件: ${COMPOSE_FILE}" >&2
  exit 1
fi

SERVICES=()
if [[ "${ONLY_APP}" == true ]]; then
  SERVICES=("miyouqian")
fi

run_compose() {
  "${COMPOSE_CMD[@]}" -f "${COMPOSE_FILE}" "$@"
}

build_images() {
  local build_flags=()
  [[ "${NO_CACHE}" == true ]] && build_flags+=("--no-cache")
  [[ "${PULL}" == true ]] && build_flags+=("--pull")

  echo "[信息] 正在编译 MiyoQian Docker 镜像..."
  run_compose build "${build_flags[@]}" miyouqian

  if [[ "${PULL}" == true && "${ONLY_APP}" == false ]]; then
    echo "[信息] 正在拉取极验识别服务镜像 (test_nine)..."
    run_compose pull test_nine
  fi
}

case "${ACTION}" in
  build)
    build_images
    echo "[完成] 镜像编译完成。"
    ;;
  up)
    build_images
    echo "[信息] 正在启动容器..."
    run_compose up -d --no-build "${SERVICES[@]}"
    echo ""
    echo "[完成] 服务已启动："
    run_compose ps "${SERVICES[@]}"
    echo ""
    echo "  - Web 控制台: http://127.0.0.1:5890"
    if [[ "${ONLY_APP}" == false ]]; then
      echo "  - 极验接口(容器内): http://test_nine:9645/pass_uni"
      echo "  - 极验接口(宿主机): http://127.0.0.1:9645/pass_uni"
    fi
    echo "  - 查看日志: ${SCRIPT_DIR}/deploy.sh logs"
    if [[ "${FOLLOW_LOGS}" == true ]]; then
      echo ""
      run_compose logs -f --tail=100 "${SERVICES[@]}"
    fi
    ;;
  down)
    echo "[信息] 正在停止并移除容器..."
    run_compose down
    echo "[完成] 容器已停止（数据卷 miyouqian_state 已保留）。"
    ;;
  restart)
    echo "[信息] 正在重启服务..."
    run_compose restart "${SERVICES[@]}"
    run_compose ps "${SERVICES[@]}"
    ;;
  logs)
    run_compose logs -f --tail=100 "${SERVICES[@]}"
    ;;
  status)
    run_compose ps "${SERVICES[@]}"
    ;;
esac
