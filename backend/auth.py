import base64
import json
import hmac
import hashlib
import time
import secrets
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

try:
    from fastapi import HTTPException, status
except ImportError:
    class HTTPException(Exception):
        def __init__(self, status_code: int, detail: str, headers: Optional[dict] = None):
            self.status_code = status_code
            self.detail = detail
            self.headers = headers
            super().__init__(detail)

    class status:
        HTTP_401_UNAUTHORIZED = 401

from .config import settings

def b64_url_encode(data: bytes) -> str:
    """Base64 URL-safe 无补位编码 (RFC 7515)"""
    return base64.urlsafe_b64encode(data).decode('utf-8').rstrip('=')

def b64_url_decode(s: str) -> bytes:
    """Base64 URL-safe 解码，自动补齐 '='"""
    rem = len(s) % 4
    if rem > 0:
        s += '=' * (4 - rem)
    return base64.urlsafe_b64decode(s.encode('utf-8'))

def hash_password(password: str, salt: str) -> str:
    """使用 PBKDF2-HMAC-SHA256 对密码进行加盐哈希"""
    return hashlib.pbkdf2_hmac(
        'sha256',
        password.encode('utf-8'),
        salt.encode('utf-8'),
        100000
    ).hex()

def get_jwt_signing_key() -> str:
    """获取当前服务实例唯一的安全 JWT 签名密钥（防止使用公开仓库默认值被伪造）"""
    from .database import get_or_create_jwt_secret
    return get_or_create_jwt_secret()

def create_access_token(data: Dict[str, Any], expires_delta: Optional[timedelta] = None) -> str:
    """
    生成标准 HS256 JWT Token (包含 sub, iat, exp 等规范字段)
    """
    to_encode = data.copy()
    now_ts = int(time.time())
    if expires_delta:
        expire_ts = now_ts + int(expires_delta.total_seconds())
    else:
        expire_ts = now_ts + (settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60)
    
    to_encode.update({
        "iat": now_ts,
        "exp": expire_ts
    })

    header = {"alg": settings.ALGORITHM, "typ": "JWT"}
    header_b64 = b64_url_encode(json.dumps(header, separators=(',', ':')).encode('utf-8'))
    payload_b64 = b64_url_encode(json.dumps(to_encode, separators=(',', ':')).encode('utf-8'))
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')

    secret_key = get_jwt_signing_key()
    signature = hmac.new(secret_key.encode('utf-8'), signing_input, hashlib.sha256).digest()
    sig_b64 = b64_url_encode(signature)

    return f"{header_b64}.{payload_b64}.{sig_b64}"

def decode_access_token(token: str) -> Dict[str, Any]:
    """
    解码并验证 HS256 JWT Token
    若签名错误或已过期，抛出标准 401 Unauthorized 异常
    """
    parts = token.split('.')
    if len(parts) != 3:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证格式无效，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    header_b64, payload_b64, sig_b64 = parts
    signing_input = f"{header_b64}.{payload_b64}".encode('utf-8')

    # 1. 验证签名防伪与防篡改
    secret_key = get_jwt_signing_key()
    expected_sig = b64_url_encode(hmac.new(secret_key.encode('utf-8'), signing_input, hashlib.sha256).digest())
    if not hmac.compare_digest(sig_b64, expected_sig):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证签名无效，可能已被篡改或由非受信密钥生成",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. 解析载荷
    try:
        payload = json.loads(b64_url_decode(payload_b64).decode('utf-8'))
    except Exception:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证载荷无法解析",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. 严格校验有效期 exp
    exp = payload.get("exp")
    if not exp or int(exp) < int(time.time()):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return payload
