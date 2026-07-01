@echo off
chcp 65001 > nul
setlocal enabledelayedexpansion

echo ===================================================
echo   AnkiLocal - プライベート起動システム
echo ===================================================
echo.

cd /d "%~dp0"

:: 1. Pythonの存在確認
where python >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Pythonが見つかりません。PythonをインストールしてPATHに追加してください。
    pause
    exit /b 1
)

:: 2. 仮想環境のセットアップ
if not exist "backend\.venv" (
    echo [INFO] Python仮想環境を作成しています...
    python -m venv backend\.venv
    if !errorlevel! neq 0 (
        echo [ERROR] 仮想環境の作成に失敗しました。
        pause
        exit /b 1
    )
)

:: 3. 仮想環境の有効化とパッケージインストール
echo [INFO] 依存パッケージをインストール中...
call backend\.venv\Scripts\activate.bat
python -m pip install --upgrade pip >nul
pip install -r backend\requirements.txt
if %errorlevel% neq 0 (
    echo [ERROR] パッケージのインストールに失敗しました。
    pause
    exit /b 1
)

:: 4. サーバーのバックグラウンド起動とトークンの取得
echo.
echo [INFO] データベース初期化及びサーバー起動中...
echo.

:: バックグラウンドプロセスとしてFastAPIサーバーを起動
start "AnkiLocal Server" cmd /c "backend\.venv\Scripts\python backend\main.py"

:: サーバーが起動してトークンが生成されるまで少し待機 (最大10秒)
echo [INFO] サーバーの応答を待っています...
timeout /t 3 /nobreak >nul

echo.
echo ===================================================
echo   AnkiLocal が起動しました！
echo   ブラウザで利用可能なトークン付きURLは、別ウィンドウの
echo   [AnkiLocal Server] ログに表示されている
echo   「http://127.0.0.1:8000/?token=...」
echo   をコピーしてブラウザで開いてください。
echo ===================================================
echo.
pause
