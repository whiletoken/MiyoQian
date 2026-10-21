ARG BASE_IMAGE=docker.m.daocloud.io/library/python:3.11-slim-bookworm
ARG UV_IMAGE=ghcr.nju.edu.cn/astral-sh/uv:0.7.3

# ==================== 构建阶段 ====================
FROM ${UV_IMAGE} AS uv-bin

FROM ${BASE_IMAGE} AS builder

# 替换 Debian 软件源为阿里云镜像，加速系统工具依赖安装
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null || true

# 复制 uv 二进制工具
COPY --from=uv-bin /uv /usr/local/bin/uv

WORKDIR /build

# 国内源参数（默认阿里云镜像源，支持清华源等覆盖；若需官方源可传 https://pypi.org）
ARG PYPI_MIRROR=https://mirrors.aliyun.com/pypi

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 复制依赖定义与锁定文件（利用 Docker 缓存层）
COPY pyproject.toml uv.lock ./

# 1. 规范化镜像源地址（兼容末尾斜杠及 /simple 后缀）
# 2. 替换 uv.lock 中的下载源，避免 --frozen 模式强制直连外网 files.pythonhosted.org
# 3. 安装依赖至独立虚拟环境 /opt/venv 并清理构建缓存
RUN set -e; \
    if [ -n "${PYPI_MIRROR}" ] && [ "${PYPI_MIRROR}" != "https://pypi.org" ]; then \
    PYPI_URL="${PYPI_MIRROR%/}"; \
    PYPI_URL="${PYPI_URL%/simple}"; \
    export UV_INDEX_URL="${PYPI_URL}/simple"; \
    export UV_DEFAULT_INDEX="${PYPI_URL}/simple"; \
    sed -i "s|https://files.pythonhosted.org|${PYPI_URL}|g" uv.lock; \
    sed -i "s|https://pypi.org/simple|${PYPI_URL}/simple|g" uv.lock; \
    fi; \
    uv sync --frozen --no-dev --no-install-project; \
    uv cache clean

# ==================== 运行阶段 ====================
FROM ${BASE_IMAGE} AS runner

WORKDIR /app

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/opt/venv/bin:${PATH}"

# 替换 Debian 软件源为阿里云镜像
RUN sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list.d/debian.sources 2>/dev/null || \
    sed -i 's/deb.debian.org/mirrors.aliyun.com/g' /etc/apt/sources.list 2>/dev/null || true

# 创建低权限系统用户及运行所需的数据/日志目录
RUN groupadd --system myq \
    && useradd --system --gid myq --home-dir /app --shell /usr/sbin/nologin myq \
    && mkdir -p /app/state/data /app/state/logs \
    && chown -R myq:myq /app

# 从构建阶段仅复制生产依赖虚拟环境，直接指定属主（避免二次 chown 导致镜像层数据重复翻倍）
COPY --from=builder --chown=myq:myq /opt/venv /opt/venv

# 复制运行时必需源码及配置（不包含测试、开发依赖与构建缓存）
COPY --chown=myq:myq miyouqian/ ./miyouqian/
COPY --chown=myq:myq main.py .
COPY --chown=myq:myq config.example.yaml config.example.json ./
COPY --chown=myq:myq docker/entrypoint.sh /entrypoint.sh

# 兼容 Windows CRLF 换行符并设置启动脚本权限
RUN sed -i 's/\r$//' /entrypoint.sh && chmod 755 /entrypoint.sh

EXPOSE 5890

VOLUME ["/app/state"]

USER myq

HEALTHCHECK --interval=60s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:5890/api/auth/status', timeout=3).read()"

ENTRYPOINT ["/entrypoint.sh"]
CMD ["python", "main.py", "--config", "/app/state/config.json", "serve", "--host", "0.0.0.0", "--port", "5890"]
