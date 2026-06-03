<#
.SYNOPSIS
    TelePi DebiStudio Fork — PowerShell CLI для управления ботом на Windows
.DESCRIPTION
    Установка, запуск, остановка, статус и логи TelePi как Windows Service (NSSM).
    Аналог telepi.sh + systemd для Linux.

.PARAMETER Command
    install   — установить/переустановить сервис через NSSM
    remove    — удалить сервис
    start     — запустить сервис
    stop      — остановить сервис
    restart   — перезапустить сервис
    status    — статус сервиса
    logs      — показать путь к логам
    version   — версия

.PARAMETER Instance
    Имя инстанса (зеркала). Если указан — используется конфиг из
    ~\.config\telepi\instances\<Instance>\config.env

.EXAMPLE
    .\telepi.ps1 start
    .\telepi.ps1 start --instance pi-agent-2
    .\telepi.ps1 status
    .\telepi.ps1 install
    .\telepi.ps1 remove
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('install','remove','start','stop','restart','status','logs','version')]
    [string]$Command = 'start',

    [Alias('i')]
    [string]$Instance = ''
)

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodeExe = "node"
$CliPath = Join-Path $ScriptDir "dist" "cli.js"
$ServiceName = "TelePi"

if ($Instance) {
    $ServiceName = "TelePi-$Instance"
    $InstanceConfig = Join-Path $HOME ".config" "telepi" "instances" $Instance "config.env"
    if (-not (Test-Path $InstanceConfig)) {
        Write-Error "❌ Instance '$Instance' not found: $InstanceConfig"
        exit 1
    }
    $Env:TELEPI_CONFIG = $InstanceConfig
}

function Test-Nssm {
    $nssm = Get-Command "nssm.exe" -ErrorAction SilentlyContinue
    if (-not $nssm) {
        # Check local dir
        $localNssm = Join-Path $ScriptDir "nssm.exe"
        if (Test-Path $localNssm) {
            return $localNssm
        }
        return $null
    }
    return $nssm.Source
}

function Invoke-Nssm {
    param([string[]]$Arguments)
    $nssm = Test-Nssm
    if (-not $nssm) {
        Write-Error "❌ NSSM не найден. Установи: .\install-windows.ps1"
        exit 1
    }
    & $nssm $Arguments 2>&1
}

# --- Команды ---

switch ($Command) {
    "install" {
        $nssm = Test-Nssm
        if (-not $nssm) {
            Write-Error "❌ NSSM не найден. Сначала запусти install-windows.ps1"
            exit 1
        }

        # Проверяем не установлен ли уже
        $existing = Invoke-Nssm @("status", $ServiceName) 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Warning "⚠️  Сервис '$ServiceName' уже существует. Останавливаю и переустанавливаю..."
            Invoke-Nssm @("stop", $ServiceName) | Out-Null
            Start-Sleep 1
            Invoke-Nssm @("remove", $ServiceName, "confirm") | Out-Null
            Start-Sleep 1
        }

        # Полный путь к node
        $nodePath = (Get-Command "node.exe").Source
        $fullCliPath = (Resolve-Path $CliPath).Path

        Write-Host "📦 Устанавливаю сервис '$ServiceName'..." -ForegroundColor Cyan
        Invoke-Nssm @("install", $ServiceName, $nodePath, "$fullCliPath start")

        # AppDirectory — чтобы relative пути работали
        Invoke-Nssm @("set", $ServiceName, "AppDirectory", $ScriptDir)

        # Environment
        if ($Instance) {
            Invoke-Nssm @("set", $ServiceName, "AppEnvironmentExtra", "TELEPI_CONFIG=$Env:TELEPI_CONFIG")
        }

        # Restart при падении
        Invoke-Nssm @("set", $ServiceName, "AppThrottle", "0")
        Invoke-Nssm @("set", $ServiceName, "AppExit", "Restart")
        Invoke-Nssm @("set", $ServiceName, "AppRestartDelay", "10000")

        # Логи: stdout и stderr в отдельные файлы
        $logDir = Join-Path $HOME ".local" "state" "telepi" "logs"
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
        $instanceSuffix = if ($Instance) { "-$Instance" } else { "" }
        Invoke-Nssm @("set", $ServiceName, "AppStdout", (Join-Path $logDir "telepi$instanceSuffix.out.log"))
        Invoke-Nssm @("set", $ServiceName, "AppStderr", (Join-Path $logDir "telepi$instanceSuffix.err.log"))

        # Ротация логов
        Invoke-Nssm @("set", $ServiceName, "AppRotateFiles", "1")
        Invoke-Nssm @("set", $ServiceName, "AppRotateOnline", "1")
        Invoke-Nssm @("set", $ServiceName, "AppRotateBytes", "10485760")  # 10 MB

        Write-Host "✅ Сервис '$ServiceName' установлен." -ForegroundColor Green
        Write-Host "🚀 Запусти: .\telepi.ps1 start$($Instance ? " --instance $Instance" : '')" -ForegroundColor Yellow
    }

    "remove" {
        Write-Host "🗑️  Удаляю сервис '$ServiceName'..." -ForegroundColor Yellow
        Invoke-Nssm @("stop", $ServiceName) | Out-Null
        Start-Sleep 1
        Invoke-Nssm @("remove", $ServiceName, "confirm") | Out-Null
        Write-Host "✅ Сервис '$ServiceName' удалён." -ForegroundColor Green
    }

    "start" {
        Write-Host "🚀 Запускаю '$ServiceName'..." -ForegroundColor Cyan
        Invoke-Nssm @("start", $ServiceName)
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Сервис '$ServiceName' запущен." -ForegroundColor Green
        } else {
            Write-Error "❌ Не удалось запустить. Проверь: .\telepi.ps1 status"
        }
    }

    "stop" {
        Write-Host "🛑 Останавливаю '$ServiceName'..." -ForegroundColor Yellow
        Invoke-Nssm @("stop", $ServiceName)
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Сервис '$ServiceName' остановлен." -ForegroundColor Green
        }
    }

    "restart" {
        Write-Host "🔄 Перезапускаю '$ServiceName'..." -ForegroundColor Cyan
        Invoke-Nssm @("restart", $ServiceName)
        if ($LASTEXITCODE -eq 0) {
            Write-Host "✅ Сервис '$ServiceName' перезапущен." -ForegroundColor Green
        }
    }

    "status" {
        $nssm = Test-Nssm
        if (-not $nssm) {
            Write-Warning "⚠️  NSSM не установлен. Бот работает только вручную: node dist\cli.js start"
            exit 0
        }
        $status = Invoke-Nssm @("status", $ServiceName) 2>$null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "📊 Сервис: $ServiceName" -ForegroundColor Cyan
            Write-Host "   Статус: $status" -ForegroundColor Green
            # Покажи PID
            $pidInfo = Invoke-Nssm @("get", $ServiceName, "ProcessId") 2>$null
            if ($pidInfo -and $pidInfo -match '\d+') {
                Write-Host "   PID:    $pidInfo" -ForegroundColor Gray
            }

            # Покажи логи
            $logDir = Join-Path $HOME ".local" "state" "telepi" "logs"
            $instanceSuffix = if ($Instance) { "-$Instance" } else { "" }
            $outLog = Join-Path $logDir "telepi$instanceSuffix.out.log"
            $errLog = Join-Path $logDir "telepi$instanceSuffix.err.log"
            if (Test-Path $outLog) {
                Write-Host "   Logs:   $outLog" -ForegroundColor Gray
            }
        } else {
            Write-Host "📊 Сервис: $ServiceName — ❌ не запущен" -ForegroundColor Red
        }
    }

    "logs" {
        $logDir = Join-Path $HOME ".local" "state" "telepi" "logs"
        $instanceSuffix = if ($Instance) { "-$Instance" } else { "" }
        $outLog = Join-Path $logDir "telepi$instanceSuffix.out.log"
        $errLog = Join-Path $logDir "telepi$instanceSuffix.err.log"

        Write-Host "📁 Логи TelePi:" -ForegroundColor Cyan
        if (Test-Path $outLog) { Write-Host "   stdout: $outLog" -ForegroundColor Gray }
        else                   { Write-Host "   stdout: $outLog (нет)" -ForegroundColor DarkGray }
        if (Test-Path $errLog) { Write-Host "   stderr: $errLog" -ForegroundColor Gray }
        else                   { Write-Host "   stderr: $errLog (нет)" -ForegroundColor DarkGray }

        Write-Host "`n📋 Хвост stdout (последние 20 строк):" -ForegroundColor Yellow
        if (Test-Path $outLog) {
            Get-Content -Path $outLog -Tail 20 -ErrorAction SilentlyContinue
        } else {
            Write-Host "   (пусто)"
        }
    }

    "version" {
        $pkg = Get-Content (Join-Path $ScriptDir "package.json") | ConvertFrom-Json
        Write-Host "TelePi $($pkg.version)" -ForegroundColor Cyan
        Write-Host "  $(Get-Item (Join-Path $ScriptDir "dist" "cli.js")).LastWriteTime.ToString('yyyy-MM-dd HH:mm')"
    }
}
