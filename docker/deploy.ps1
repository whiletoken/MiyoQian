#Requires -Version 5.1
<#
.SYNOPSIS
MiyoQian Docker 编译与启动脚本 (Windows PowerShell)

.EXAMPLE
.\docker\deploy.ps1
.\docker\deploy.ps1 -NoCache -FollowLogs
.\docker\deploy.ps1 -Action down
.\docker\deploy.ps1 -OnlyApp
#>

[CmdletBinding()]
param(
    [ValidateSet('up', 'build', 'down', 'stop', 'restart', 'logs', 'status')]
    [string]$Action = 'up',

    [switch]$NoCache,
    [switch]$Pull,
    [switch]$OnlyApp,
    [switch]$FollowLogs,
    [string]$BaseImage,
    [string]$PyPIMirror,
    [switch]$Help
)

$ErrorActionPreference = 'Stop'

if ($Help) {
    @'
用法: .\docker\deploy.ps1 [-Action <动作>] [选项]

动作 (默认: up):
  up          编译镜像并后台启动容器
  build       仅编译镜像，不启动容器
  down|stop   停止并移除容器（保留持久化数据卷）
  restart     重启容器
  logs        实时查看容器日志
  status      查看容器运行状态

选项:
  -NoCache              编译时不使用 Docker 缓存
  -Pull                 编译/启动前拉取最新基础镜像与服务镜像
  -OnlyApp              仅操作 miyouqian 主服务（不启动 test_nine 极验服务）
  -FollowLogs           启动完成后立即跟踪输出日志
  -BaseImage <镜像>     覆盖 Dockerfile 的 BASE_IMAGE 参数
  -PyPIMirror <地址>    覆盖 Dockerfile 的 PYPI_MIRROR 参数
  -Help                 显示此帮助信息
'@
    exit 0
}

if ($Action -eq 'stop') {
    $Action = 'down'
}

$ComposeFile = Join-Path $PSScriptRoot 'docker-compose.yml'
if (-not (Test-Path $ComposeFile)) {
    throw "未找到编排文件: $ComposeFile"
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw "未检测到 docker 命令，请先安装 Docker Desktop。"
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    throw "Docker 守护进程未运行，请先启动 Docker Desktop。"
}

$UseV2 = $true
docker compose version *> $null
if ($LASTEXITCODE -ne 0) {
    if (Get-Command docker-compose -ErrorAction SilentlyContinue) {
        $UseV2 = $false
    } else {
        throw "未检测到 docker compose 或 docker-compose。"
    }
}

if ($BaseImage) { $env:BASE_IMAGE = $BaseImage }
if ($PyPIMirror) { $env:PYPI_MIRROR = $PyPIMirror }

$Services = @()
if ($OnlyApp) {
    $Services = @('miyouqian')
}

function Invoke-Compose {
    param([string[]]$ComposeArgs)
    if ($UseV2) {
        & docker compose -f $ComposeFile @ComposeArgs
    } else {
        & docker-compose -f $ComposeFile @ComposeArgs
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Docker Compose 执行失败 (退出码: $LASTEXITCODE)"
    }
}

function Invoke-BuildImages {
    $buildArgs = @('build')
    if ($NoCache) { $buildArgs += '--no-cache' }
    if ($Pull) { $buildArgs += '--pull' }
    $buildArgs += 'miyouqian'

    Write-Host '[信息] 正在编译 MiyoQian Docker 镜像...' -ForegroundColor Cyan
    Invoke-Compose $buildArgs

    if ($Pull -and -not $OnlyApp) {
        Write-Host '[信息] 正在拉取极验识别服务镜像 (test_nine)...' -ForegroundColor Cyan
        Invoke-Compose @('pull', 'test_nine')
    }
}

switch ($Action) {
    'build' {
        Invoke-BuildImages
        Write-Host '[完成] 镜像编译完成。' -ForegroundColor Green
    }
    'up' {
        Invoke-BuildImages
        Write-Host '[信息] 正在启动容器...' -ForegroundColor Cyan
        $upArgs = @('up', '-d', '--no-build') + $Services
        Invoke-Compose $upArgs
        Write-Host ''
        Write-Host '[完成] 服务已启动：' -ForegroundColor Green
        Invoke-Compose (@('ps') + $Services)
        Write-Host ''
        Write-Host '  - Web 控制台: http://127.0.0.1:5890'
        if (-not $OnlyApp) {
            Write-Host '  - 极验接口(容器内): http://test_nine:9645/pass_uni'
            Write-Host '  - 极验接口(宿主机): http://127.0.0.1:9645/pass_uni'
        }
        Write-Host '  - 查看日志: .\docker\deploy.ps1 -Action logs'
        if ($FollowLogs) {
            Write-Host ''
            Invoke-Compose (@('logs', '-f', '--tail=100') + $Services)
        }
    }
    'down' {
        Write-Host '[信息] 正在停止并移除容器...' -ForegroundColor Cyan
        Invoke-Compose @('down')
        Write-Host '[完成] 容器已停止（数据卷 miyouqian_state 已保留）。' -ForegroundColor Green
    }
    'restart' {
        Write-Host '[信息] 正在重启服务...' -ForegroundColor Cyan
        Invoke-Compose (@('restart') + $Services)
        Invoke-Compose (@('ps') + $Services)
    }
    'logs' {
        Invoke-Compose (@('logs', '-f', '--tail=100') + $Services)
    }
    'status' {
        Invoke-Compose (@('ps') + $Services)
    }
}
