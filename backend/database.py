import sqlite3
import json
import os
import hmac
import secrets
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any
from .config import settings, KNOWN_INSECURE_SECRET_KEYS
from .auth import hash_password

def get_db_connection() -> sqlite3.Connection:
    """获取 SQLite 数据库连接，启用行字典模式"""
    conn = sqlite3.connect(settings.DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    """初始化数据库表结构与默认配置"""
    conn = get_db_connection()
    cursor = conn.cursor()

    # 1. 人员底库表（包含 512 维特征向量二进制 BLOB）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        student_id TEXT UNIQUE NOT NULL,
        department TEXT NOT NULL,
        avatar_path TEXT,
        embedding BLOB NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 2. 签到记录流水表（支持外发队列 Outbox 最终一致性与重试追踪）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS attendance_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        student_id TEXT NOT NULL,
        department TEXT NOT NULL,
        similarity REAL NOT NULL,
        checkin_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        feishu_status TEXT NOT NULL,
        error_msg TEXT,
        retry_count INTEGER DEFAULT 0,
        feishu_record_id TEXT,
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    );
    """)

    # 动态无损迁移：检查并添加重试追踪字段
    cursor.execute("PRAGMA table_info(attendance_logs)")
    columns = [col[1] for col in cursor.fetchall()]
    if "retry_count" not in columns:
        cursor.execute("ALTER TABLE attendance_logs ADD COLUMN retry_count INTEGER DEFAULT 0")
    if "feishu_record_id" not in columns:
        cursor.execute("ALTER TABLE attendance_logs ADD COLUMN feishu_record_id TEXT")

    # 3. 系统配置表（存储飞书妙搭配置、相似度阈值等）
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS system_config (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    """)

    # 插入默认飞书配置
    cursor.execute("SELECT value FROM system_config WHERE key = 'feishu_config'")
    row = cursor.fetchone()
    if not row:
        default_feishu_config = {
            "mode": "webhook",
            "enabled": True,
            "webhook_url": "",
            "app_id": "",
            "app_secret": "",
            "app_token": "",
            "table_id": ""
        }
        cursor.execute(
            "INSERT INTO system_config (key, value) VALUES (?, ?)",
            ("feishu_config", json.dumps(default_feishu_config, ensure_ascii=False))
        )

    # 4. 插入默认管理员凭证 (账号与 PBKDF2 加盐哈希)
    cursor.execute("SELECT value FROM system_config WHERE key = 'admin_credentials'")
    admin_row = cursor.fetchone()
    if not admin_row:
        salt = secrets.token_hex(16)
        pwd_hash = hash_password(settings.ADMIN_PASSWORD, salt)
        admin_data = {
            "username": settings.ADMIN_USERNAME,
            "salt": salt,
            "password_hash": pwd_hash,
            "created_at": datetime.now().isoformat()
        }
        cursor.execute(
            "INSERT INTO system_config (key, value) VALUES (?, ?)",
            ("admin_credentials", json.dumps(admin_data, ensure_ascii=False))
        )

    conn.commit()
    conn.close()

# ----------------- 特征向量序列化工具 -----------------
def embedding_to_blob(embedding: np.ndarray) -> bytes:
    """将 512 维 float32 特征向量序列化为二进制 BLOB"""
    if not isinstance(embedding, np.ndarray):
        embedding = np.array(embedding, dtype=np.float32)
    else:
        embedding = embedding.astype(np.float32)
    return embedding.tobytes()

def blob_to_embedding(blob: bytes) -> np.ndarray:
    """将二进制 BLOB 反序列化为 512 维 float32 numpy 数组"""
    return np.frombuffer(blob, dtype=np.float32)

# ----------------- 人员底库 CRUD -----------------
def add_user(name: str, student_id: str, department: str, avatar_path: str, embedding: np.ndarray) -> int:
    """录入人员信息及其 512 维特征向量"""
    blob = embedding_to_blob(embedding)
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO users (name, student_id, department, avatar_path, embedding)
        VALUES (?, ?, ?, ?, ?)
        """,
        (name, student_id, department, avatar_path, blob)
    )
    user_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return user_id

def get_user_by_student_id(student_id: str) -> Optional[Dict[str, Any]]:
    """根据学号/工号查询用户"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM users WHERE student_id = ?", (student_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_user_by_id(user_id: int) -> Optional[Dict[str, Any]]:
    """根据 ID 查询用户"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, student_id, department, avatar_path, created_at FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_all_users() -> List[Dict[str, Any]]:
    """获取所有人员基本信息列表（不包含大体积 embedding）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, student_id, department, avatar_path, created_at FROM users ORDER BY id DESC")
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def get_all_user_embeddings() -> List[Dict[str, Any]]:
    """
    预加载全部人员特征向量供内存快速比对
    严禁每次打卡重新读图计算，直接加载 512 维向量
    """
    conn = get_db_connection()
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT id, name, student_id, department, embedding FROM users")
        rows = cursor.fetchall()
    except sqlite3.OperationalError:
        # 当在新环境下数据库表尚未完成 init_db 时，安全返回空列表，防止启动期抛错
        conn.close()
        return []
    conn.close()

    result = []
    for row in rows:
        emb = blob_to_embedding(row["embedding"]) if row["embedding"] is not None else None
        if emb is not None:
            result.append({
                "id": row["id"],
                "name": row["name"],
                "student_id": row["student_id"],
                "department": row["department"],
                "embedding": emb
            })
    return result

def delete_user(user_id: int) -> bool:
    """删除人员信息（连同照片路径与特征向量）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT avatar_path FROM users WHERE id = ?", (user_id,))
    row = cursor.fetchone()
    if row and row["avatar_path"] and os.path.exists(row["avatar_path"]):
        try:
            os.remove(row["avatar_path"])
        except Exception:
            pass

    cursor.execute("DELETE FROM users WHERE id = ?", (user_id,))
    affected = cursor.rowcount > 0
    conn.commit()
    conn.close()
    return affected

# ----------------- 签到流水与高并发防重复 -----------------
def get_latest_checkin_by_user(user_id: int) -> Optional[Dict[str, Any]]:
    """获取指定用户最近一条有效签到记录（包含成功、待处理、失败，用于防重复与幂等判定）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM attendance_logs 
        WHERE user_id = ? AND feishu_status IN ('SUCCESS', 'PENDING', 'REPEATED_SUCCESS', 'FEISHU_PUSH_FAILED')
        ORDER BY checkin_time DESC, id DESC LIMIT 1
        """,
        (user_id,)
    )
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def is_recent_duplicate_checkin(user_id: int, cooldown_seconds: int = None) -> Tuple[bool, Optional[str]]:
    """
    检查是否在防重复冷却期内（如 5 分钟）
    返回: (is_duplicate, last_checkin_time_str)
    """
    if cooldown_seconds is None:
        cooldown_seconds = settings.REPEAT_CHECKIN_COOLDOWN_SECONDS

    last_log = get_latest_checkin_by_user(user_id)
    if not last_log:
        return False, None

    try:
        # SQLite 默认存为 'YYYY-MM-DD HH:MM:SS'
        time_str = last_log["checkin_time"]
        last_time = datetime.strptime(time_str, "%Y-%m-%d %H:%M:%S")
        now = datetime.now()
        elapsed = (now - last_time).total_seconds()
        if elapsed < cooldown_seconds:
            return True, time_str
    except Exception:
        pass
    return False, None

def atomic_record_checkin(
    user_id: int,
    name: str,
    student_id: str,
    department: str,
    similarity: float,
    cooldown_seconds: int = None
) -> Tuple[bool, int, str, Optional[str]]:
    """
    数据库级原子化签到防重与预入库（支持多进程/多 Worker 强并发保护，彻底摒弃全局内存锁）
    
    核心机制：
    1. 在 SQLite 排他即时事务 (BEGIN IMMEDIATE) 中原子读取最近签到记录；
    2. 防重判断严格覆盖 SUCCESS, PENDING, REPEATED_SUCCESS, FEISHU_PUSH_FAILED 等全部有效刷脸记录，
       即便飞书网络响应超时或失败，由于物理人脸已刷入，冷却期仍然生效，彻底解决网络重试导致飞书多维表格出现多条重复记录的幂等缺陷；
    3. 若在冷却期内，原子插入 REPEATED_SKIPPED 并提交，返回 (is_duplicate=True, log_id, now_str, last_time_str)；
    4. 若不在冷却期内，原子插入状态为 PENDING 的签到记录，占位成功后立即提交事务（事务耗时 < 2ms），
       返回 (is_duplicate=False, log_id, now_str, None)；
    5. 多进程多 Worker 并发写入由底层 SQLite 排他事务锁天然序列化，不仅零漏单，而且绝不串行阻塞其他后续人员打卡。
    """
    if cooldown_seconds is None:
        cooldown_seconds = settings.REPEAT_CHECKIN_COOLDOWN_SECONDS

    now = datetime.now()
    now_str = now.strftime("%Y-%m-%d %H:%M:%S")

    conn = get_db_connection()
    conn.isolation_level = None  # 允许手动控制 BEGIN IMMEDIATE
    cursor = conn.cursor()
    cursor.execute("BEGIN IMMEDIATE")

    try:
        # 1. 查找此人在冷却期内的最后一条有效刷脸记录
        cursor.execute(
            """
            SELECT checkin_time FROM attendance_logs 
            WHERE user_id = ? AND feishu_status IN ('SUCCESS', 'PENDING', 'REPEATED_SUCCESS', 'FEISHU_PUSH_FAILED')
            ORDER BY checkin_time DESC, id DESC LIMIT 1
            """,
            (user_id,)
        )
        row = cursor.fetchone()
        is_duplicate = False
        last_time_str = None

        if row and row["checkin_time"]:
            last_time_str = row["checkin_time"]
            try:
                last_time = datetime.strptime(last_time_str, "%Y-%m-%d %H:%M:%S")
                elapsed = (now - last_time).total_seconds()
                if elapsed < cooldown_seconds:
                    is_duplicate = True
            except Exception:
                pass

        if is_duplicate:
            cursor.execute(
                """
                INSERT INTO attendance_logs 
                (user_id, name, student_id, department, similarity, checkin_time, feishu_status, error_msg)
                VALUES (?, ?, ?, ?, ?, ?, 'REPEATED_SKIPPED', ?)
                """,
                (user_id, name, student_id, department, round(float(similarity), 4), now_str, f"防重复规则拦截：最近一次打卡时间为 {last_time_str}")
            )
            log_id = cursor.lastrowid
            cursor.execute("COMMIT")
            return True, log_id, now_str, last_time_str
        else:
            # 首次打卡：立即原子插入 PENDING 状态
            cursor.execute(
                """
                INSERT INTO attendance_logs 
                (user_id, name, student_id, department, similarity, checkin_time, feishu_status, error_msg)
                VALUES (?, ?, ?, ?, ?, ?, 'PENDING', NULL)
                """,
                (user_id, name, student_id, department, round(float(similarity), 4), now_str)
            )
            log_id = cursor.lastrowid
            cursor.execute("COMMIT")
            return False, log_id, now_str, None
    except Exception as e:
        try:
            cursor.execute("ROLLBACK")
        except Exception:
            pass
        raise e
    finally:
        conn.close()

def update_attendance_log_feishu_status(log_id: int, feishu_status: str, error_msg: Optional[str] = None):
    """更新指定流水记录的飞书推送状态与错误描述"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE attendance_logs 
        SET feishu_status = ?, error_msg = ?
        WHERE id = ?
        """,
        (feishu_status, error_msg, log_id)
    )
    conn.commit()
    conn.close()

def get_attendance_log_by_id(log_id: int) -> Optional[Dict[str, Any]]:
    """根据 ID 查询单条签到流水详情"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM attendance_logs WHERE id = ?", (log_id,))
    row = cursor.fetchone()
    conn.close()
    return dict(row) if row else None

def get_failed_attendance_logs(limit: int = 50, max_retries: int = 10) -> List[Dict[str, Any]]:
    """获取同步飞书失败且未超过最大重试次数的流水记录（按时间正序，优先补录早期数据）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM attendance_logs 
        WHERE feishu_status = 'FEISHU_PUSH_FAILED' AND retry_count < ?
        ORDER BY id ASC LIMIT ?
        """,
        (max_retries, limit)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

def mark_attendance_log_synced(log_id: int, feishu_record_id: Optional[str] = None):
    """标记流水记录已成功同步飞书，清除错误提示并记录飞书多维表格 Record ID"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        UPDATE attendance_logs 
        SET feishu_status = 'SUCCESS', error_msg = NULL, feishu_record_id = ?
        WHERE id = ?
        """,
        (feishu_record_id, log_id)
    )
    conn.commit()
    conn.close()

def mark_attendance_log_failed(log_id: int, error_msg: str, increment_retry: bool = True):
    """标记流水记录同步失败，累加重试计数器并记录错误描述"""
    conn = get_db_connection()
    cursor = conn.cursor()
    if increment_retry:
        cursor.execute(
            """
            UPDATE attendance_logs 
            SET feishu_status = 'FEISHU_PUSH_FAILED', error_msg = ?, retry_count = retry_count + 1
            WHERE id = ?
            """,
            (error_msg, log_id)
        )
    else:
        cursor.execute(
            """
            UPDATE attendance_logs 
            SET feishu_status = 'FEISHU_PUSH_FAILED', error_msg = ?
            WHERE id = ?
            """,
            (error_msg, log_id)
        )
    conn.commit()
    conn.close()

def get_sync_statistics() -> Dict[str, int]:
    """获取签到与飞书同步全量统计指标（用于对账与看板展示）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT COUNT(*) FROM attendance_logs")
    total = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM attendance_logs WHERE feishu_status = 'SUCCESS'")
    success = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM attendance_logs WHERE feishu_status = 'FEISHU_PUSH_FAILED'")
    failed = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM attendance_logs WHERE feishu_status = 'REPEATED_SKIPPED'")
    repeated = cursor.fetchone()[0]

    cursor.execute("SELECT COUNT(*) FROM attendance_logs WHERE feishu_status = 'PENDING'")
    pending = cursor.fetchone()[0]

    conn.close()
    return {
        "total": total,
        "success": success,
        "failed": failed,
        "repeated": repeated,
        "pending": pending
    }

def add_attendance_log(
    user_id: int,
    name: str,
    student_id: str,
    department: str,
    similarity: float,
    feishu_status: str,
    error_msg: Optional[str] = None
) -> int:
    """写入签到流水日志"""
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT INTO attendance_logs 
        (user_id, name, student_id, department, similarity, checkin_time, feishu_status, error_msg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (user_id, name, student_id, department, round(float(similarity), 4), now_str, feishu_status, error_msg)
    )
    log_id = cursor.lastrowid
    conn.commit()
    conn.close()
    return log_id

def get_recent_attendance_logs(limit: int = 50) -> List[Dict[str, Any]]:
    """查询最近签到记录流水"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM attendance_logs 
        ORDER BY id DESC LIMIT ?
        """,
        (limit,)
    )
    rows = cursor.fetchall()
    conn.close()
    return [dict(row) for row in rows]

# ----------------- 飞书系统配置 -----------------
def get_feishu_config() -> Dict[str, Any]:
    """读取飞书妙搭集成配置"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM system_config WHERE key = 'feishu_config'")
    row = cursor.fetchone()
    conn.close()
    if row and row["value"]:
        return json.loads(row["value"])
    return {
        "mode": "webhook",
        "enabled": True,
        "webhook_url": "",
        "app_id": "",
        "app_secret": "",
        "app_token": "",
        "table_id": ""
    }

def save_feishu_config(config_dict: Dict[str, Any]):
    """
    保存飞书妙搭集成配置
    若前端未传入新的 app_secret（如为 None、空字符串或脱敏占位符），自动保留服务端现存秘密，防止意外置空或被覆写
    """
    existing = get_feishu_config()
    incoming_secret = config_dict.get("app_secret")
    if not incoming_secret or incoming_secret.strip() == "" or incoming_secret == "************":
        config_dict["app_secret"] = existing.get("app_secret", "")
    else:
        config_dict["app_secret"] = incoming_secret.strip()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        INSERT OR REPLACE INTO system_config (key, value, updated_at)
        VALUES ('feishu_config', ?, CURRENT_TIMESTAMP)
        """,
        (json.dumps(config_dict, ensure_ascii=False),)
    )
    conn.commit()
    conn.close()

def clear_all_attendance_logs() -> bool:
    """清空所有签到流水日志"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("DELETE FROM attendance_logs")
    conn.commit()
    conn.close()
    return True

# ----------------- 实例唯一安全 JWT 签名密钥管理 -----------------
def get_or_create_jwt_secret() -> str:
    """
    获取或生成当前服务实例唯一的 JWT 签名密钥：
    1. 若环境变量中显式配置了有效的 SECRET_KEY 且不属于公开仓库不安全默认值，优先使用该配置；
    2. 否则，检查 SQLite system_config 表中的 jwt_secret_key：
       - 若已存在，则读取复用（确保服务重启不丢失当前管理员会话）；
       - 若不存在，使用 secrets.token_hex(32) 生成不可预测的 256 位强随机密钥并持久化保存。
    3. 彻底阻断任何使用公开仓库默认 SECRET_KEY 离线伪造 admin JWT 的越权攻击路径。
    """
    env_secret = settings.SECRET_KEY
    if env_secret and env_secret.strip() and env_secret.strip() not in KNOWN_INSECURE_SECRET_KEYS:
        return env_secret.strip()

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM system_config WHERE key = 'jwt_secret_key'")
    row = cursor.fetchone()
    if row and row["value"]:
        secret = row["value"]
    else:
        # 首次启动：生成不可预测的 256 位高强度随机密钥并持久化
        secret = secrets.token_hex(32)
        cursor.execute(
            "INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES ('jwt_secret_key', ?, CURRENT_TIMESTAMP)",
            (secret,)
        )
        conn.commit()
    conn.close()
    return secret

# ----------------- 管理员凭证与密码管理 -----------------
def get_admin_credentials() -> Dict[str, Any]:
    """读取管理员真实凭证（账号、盐值与哈希）"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM system_config WHERE key = 'admin_credentials'")
    row = cursor.fetchone()
    conn.close()
    if row:
        try:
            return json.loads(row["value"])
        except Exception:
            pass

    # 若未找到则返回配置默认值
    salt = "default_salt_2026"
    return {
        "username": settings.ADMIN_USERNAME,
        "salt": salt,
        "password_hash": hash_password(settings.ADMIN_PASSWORD, salt)
    }

def verify_admin_password(username: str, password: str) -> bool:
    """验证管理员用户名与密码"""
    creds = get_admin_credentials()
    if creds.get("username") != username:
        return False
    salt = creds.get("salt", "")
    expected_hash = creds.get("password_hash", "")
    computed_hash = hash_password(password, salt)
    return hmac.compare_digest(computed_hash, expected_hash)

def update_admin_password(old_password: str, new_password: str) -> Tuple[bool, str]:
    """
    修改管理员密码并持久化至 SQLite 数据库
    1. 校验旧密码是否匹配
    2. 生成全新密码盐与哈希
    3. 更新写入 SQLite system_config 表
    """
    creds = get_admin_credentials()
    salt = creds.get("salt", "")
    expected_hash = creds.get("password_hash", "")
    computed_hash = hash_password(old_password, salt)
    
    if not hmac.compare_digest(computed_hash, expected_hash):
        return False, "原密码输入不正确"

    if len(new_password) < 4:
        return False, "新密码长度至少需要4位"

    new_salt = secrets.token_hex(16)
    new_hash = hash_password(new_password, new_salt)
    updated_data = {
        "username": creds.get("username", settings.ADMIN_USERNAME),
        "salt": new_salt,
        "password_hash": new_hash,
        "updated_at": datetime.now().isoformat()
    }

    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        "UPDATE system_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = 'admin_credentials'",
        (json.dumps(updated_data, ensure_ascii=False),)
    )
    conn.commit()
    conn.close()
    return True, "密码已成功修改并同步至后端数据库！"

INSECURE_DEFAULT_PASSWORDS = {
    "admin123",
    "admin",
    "face_admin",
    "password",
    "123456",
    "12345678",
    "default"
}

def is_using_default_password() -> bool:
    """检查管理员是否仍在使用初始弱密码或环境默认密码（如 admin123、face_admin 等）"""
    creds = get_admin_credentials()
    salt = creds.get("salt", "")
    expected_hash = creds.get("password_hash", "")
    for pwd in INSECURE_DEFAULT_PASSWORDS:
        computed_hash = hash_password(pwd, salt)
        if hmac.compare_digest(computed_hash, expected_hash):
            return True
    return False



