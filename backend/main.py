# ============================================================
# main.py - FastAPIエントリーポイント
# ============================================================
# アプリケーションの起動設定、ミドルウェア、ルーター登録、
# 静的ファイル配信、DB初期化を行う。
# ============================================================

import os
from pathlib import Path
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from config import settings
from database import init_db
from routers import decks, cards, stats


# --- ライフサイクル管理 ---

@asynccontextmanager
async def lifespan(app: FastAPI):
    """起動時にDB初期化を実行する"""
    await init_db()
    print(f"データベース初期化完了: {settings.DB_PATH}")
    print(f"サーバー起動: http://{settings.HOST}:{settings.PORT}")
    print(f"アクセスURL例: http://localhost:{settings.PORT}/?token={settings.ACCESS_TOKEN}")
    yield


# --- FastAPIアプリケーション ---

app = FastAPI(
    title="AnkiLocal API",
    description="スペースドリピティション学習Webアプリ バックエンドAPI",
    version="1.0.0",
    lifespan=lifespan,
)


# --- トークン認証ミドルウェア ---

class TokenAuthMiddleware(BaseHTTPMiddleware):
    """
    /api/ パスへのリクエストにトークン認証を適用するミドルウェア。

    以下のいずれかでトークンを渡す:
    - クエリパラメータ: ?token=xxx
    - Authorizationヘッダー: Bearer xxx
    """

    async def dispatch(self, request: Request, call_next):
        path = request.url.path

        # /api/ パスのみ認証を適用
        if path.startswith(settings.API_PREFIX):
            token = request.query_params.get("token")
            if not token:
                auth_header = request.headers.get("Authorization", "")
                if auth_header.startswith("Bearer "):
                    token = auth_header[7:]

            if token != settings.ACCESS_TOKEN:
                return JSONResponse(
                    status_code=401,
                    content={"detail": "認証エラー: 無効なトークンです"},
                )

        response = await call_next(request)
        return response


app.add_middleware(TokenAuthMiddleware)


# --- ルーター登録 ---

app.include_router(decks.router)
app.include_router(cards.router)
app.include_router(stats.router)


# --- ルートリダイレクト ---

@app.get("/")
async def root_redirect(token: str = ""):
    """ルートパスへのアクセスを index.html にリダイレクトする"""
    redirect_url = "/index.html"
    if token:
        redirect_url += f"?token={token}"
    return RedirectResponse(url=redirect_url)


# --- 静的ファイル配信 ---

frontend_dir = Path(settings.FRONTEND_DIR)
if frontend_dir.exists():
    app.mount("/", StaticFiles(directory=str(frontend_dir), html=True), name="frontend")
else:
    # フロントエンドディレクトリが存在しない場合の警告
    print(f"警告: フロントエンドディレクトリが見つかりません: {frontend_dir}")
    print("  静的ファイル配信は無効です。APIのみ動作します。")


# --- スクリプト直接実行 ---

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host=settings.HOST,
        port=settings.PORT,
        reload=True,
    )
