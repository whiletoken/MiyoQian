# MiyoQian 缓存隔离与源码零污染规范 (Cache & Hygiene Rules)

在软件工程中，源码目录树被编译器产物、测试缓存或字节码文件污染是导致构建不稳定、Diff 混乱以及容器镜像体积虚高的常见根源。MiyoQian 项目实行严格的**“最外层归集与零污染”**原则。

--------------------------------------------------------------------------------

## 1. 核心铁律：禁止在源码目录生成字节码与构建产物

1. **源码洁净**：
   - `miyouqian/` 核心源码目录严禁产生任何 `__pycache__/` 文件夹或 `.pyc` 字节码文件。
   - `tests/` 单元测试目录严禁产生任何 `__pycache__/` 文件夹。
2. **构建输出统一归集**：
   - 所有的构建打包产物（`sdist` 源码包、`wheel` 二进制包）统一归集至项目根目录的 `dist/` 目录。
   - 所有的临时测试、覆盖率缓存统一归集至项目根目录的 `.cache/` 目录。

--------------------------------------------------------------------------------

## 2. 字节码全局重定向机制 (`sitecustomize.py`)

Python 在启动加载任何模块前，会自动导入位于工作目录或 `sys.path` 下的 `sitecustomize.py`。
本项目通过在项目根目录设立 `sitecustomize.py` 实现全自动化重定向：

```python
# sitecustomize.py
import os
import pathlib
import sys

_root = pathlib.Path(__file__).resolve().parent
_cache_dir = _root / ".cache" / "pycache"

if not sys.pycache_prefix:
    sys.pycache_prefix = str(_cache_dir)
    os.environ["PYTHONPYCACHEPREFIX"] = str(_cache_dir)
```

### 运行时多层兜底保障
为确保在非交互式命令、独立脚本入口、pytest 等多种调用链条下均生效：
1. **`main.py` / `index.py` 入口防御**：
   在入口脚本头部再次检测并补齐 `sys.pycache_prefix` 与 `PYTHONPYCACHEPREFIX` 环境变量。
2. **`pyproject.toml` 测试配置**：
   在 `[tool.pytest.ini_options]` 中配置 `cache_dir = ".cache/pytest"`，将 pytest 的临时索引统一归集。
3. **Docker 运行时**：
   在 Dockerfile 及 entrypoint 中配置 `ENV PYTHONPYCACHEPREFIX=/app/.cache/pycache`。

--------------------------------------------------------------------------------

## 3. 忽略规则规范 (`.gitignore` & `.dockerignore`)

为了保证本地开发不污染 Git 提交历史，构建时不污染 Docker 上下文，必须保持以下配置同步：

```text
# 根目录与全局字节码缓存
.cache/
__pycache__/
*.py[cod]

# 构建打包产物
dist/
build/
*.egg-info/
```

在执行 Git Commit 前，任何包含 `__pycache__` 或 `.pyc` 的修改一律视为违规，严禁提交进代码仓库。
