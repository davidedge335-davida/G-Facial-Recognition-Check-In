import os

try:
    from pydantic_settings import BaseSettings
except ImportError:
    try:
        from pydantic import BaseSettings
    except ImportError:
        class BaseSettings:
            def __init__(self, **kwargs):
                for k, v in self.__class__.__dict__.items():
                    if not k.startswith("_") and not callable(v):
                        env_val = os.getenv(k)
                        if env_val is not None:
                            try:
                                v_type = type(v)
                                setattr(self, k, v_type(env_val))
                            except Exception:
                                setattr(self, k, env_val)
                        else:
                            setattr(self, k, v)
                for k, v in kwargs.items():
                    setattr(self, k, v)

class Settings(BaseSettings):
    # 服务基础配置
    APP_NAME: str = "移动端人脸识别签到系统"
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # 存储路径
    BASE_DIR: str = os.path.dirname(os.path.abspath(__file__))
    DATA_DIR: str = os.path.join(BASE_DIR, "data")
    AVATARS_DIR: str = os.path.join(BASE_DIR, "data", "avatars")
    DB_PATH: str = os.path.join(BASE_DIR, "data", "face_attendance.db")

    # 人脸算法参数
    # InsightFace 模型名，默认 "buffalo_s"（轻量适合CPU）或 "buffalo_l"（高精度）
    INSIGHTFACE_MODEL_NAME: str = "buffalo_s"
    # 余弦相似度阈值，一般 ArcFace 取 0.55~0.65，默认推荐 0.60
    SIMILARITY_THRESHOLD: float = 0.60
    # 防重复签到冷却时间（秒），默认 5 分钟 (300 秒)
    REPEAT_CHECKIN_COOLDOWN_SECONDS: int = 300

    # 管理员认证与安全配置
    ADMIN_USERNAME: str = "admin"
    ADMIN_PASSWORD: str = "admin123"
    # SECRET_KEY 生产部署强烈建议通过环境变量注入 64 位强随机字符串
    # 若未设置或使用了公开仓库默认值，系统将在启动时自动从 SQLite 中获取/持久化实例级高强度随机密钥
    SECRET_KEY: str = ""
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 1440  # 24小时
    ENVIRONMENT: str = "production"

    class Config:
        env_file = ".env"
        extra = "allow"

KNOWN_INSECURE_SECRET_KEYS = {
    "feishu-face-checkin-secret-token-key-2026",
    "secret",
    "admin123",
    "default",
    "changeme",
    "password",
    ""
}

settings = Settings()

# 确保数据目录存在
os.makedirs(settings.DATA_DIR, exist_ok=True)
os.makedirs(settings.AVATARS_DIR, exist_ok=True)
