# ============================================================
# config.py - アプリケーション設定管理（SSOT）
# ============================================================
# すべての設定値をここに集約し、ハードコーディングを排除する。
# 環境変数から読み込み、デフォルト値を提供する。
# ============================================================

import os
import secrets
from pathlib import Path
from dataclasses import dataclass, field


def _generate_token() -> str:
    """起動時にランダムなアクセストークンを生成する"""
    return secrets.token_urlsafe(32)


@dataclass(frozen=True)
class AppConfig:
    """
    アプリケーション全体の設定（イミュータブル）

    frozen=True により、インスタンス生成後の変更を禁止する。
    """

    # --- サーバー設定 ---
    HOST: str = field(default_factory=lambda: os.environ.get("HOST", "0.0.0.0"))
    PORT: int = field(
        default_factory=lambda: int(os.environ.get("PORT", "8000"))
    )

    # --- 認証設定 ---
    ACCESS_TOKEN: str = field(
        default_factory=lambda: os.environ.get("ACCESS_TOKEN", "")
    )

    # --- データベース設定 ---
    DB_PATH: str = field(
        default_factory=lambda: os.environ.get(
            "DB_PATH",
            str(Path(__file__).resolve().parent / "data" / "ankilocal.db"),
        )
    )

    # --- フロントエンド配信パス ---
    FRONTEND_DIR: str = field(
        default_factory=lambda: str(
            Path(__file__).resolve().parent.parent / "frontend"
        )
    )

    # --- 学習設定 ---
    STUDY_BATCH_SIZE: int = 20  # 1回の学習リクエストで返すカード上限

    # --- SRSパラメータ ---
    SRS_MIN_EASE_FACTOR: float = 1.3
    SRS_DEFAULT_EASE_FACTOR: float = 2.5
    SRS_AGAIN_INTERVAL_MINUTES: int = 1
    SRS_HARD_INTERVAL_MULTIPLIER: float = 1.2
    SRS_HARD_EASE_DELTA: float = -0.15
    SRS_EASY_EASE_DELTA: float = 0.15

    # --- APIパスプレフィックス ---
    API_PREFIX: str = "/api"

    def __post_init__(self) -> None:
        """トークン未指定時に自動生成してコンソールに表示する"""
        if not self.ACCESS_TOKEN:
            generated = _generate_token()
            # frozen=True のため object.__setattr__ で設定
            object.__setattr__(self, "ACCESS_TOKEN", generated)
            print("=" * 60)
            print("  アクセストークンが自動生成されました:")
            print(f"  {generated}")
            print("=" * 60)


# --- シングルトン設定インスタンス ---
settings = AppConfig()
