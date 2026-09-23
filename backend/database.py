import sqlite3
import json
import os
import numpy as np
from datetime import datetime, timedelta
from typing import List, Dict, Optional, Tuple, Any
from .config import settings

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

    # 2. 签到记录流水表
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
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE SET NULL
    );
    """)

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
    cursor.execute("SELECT id, name, student_id, department, embedding FROM users")
    rows = cursor.fetchall()
    conn.close()

    result = []
    for row in rows:
        result.append({
            "id": row["id"],
            "name": row["name"],
            "student_id": row["student_id"],
            "department": row["department"],
            "embedding": blob_to_embedding(row["embedding"])
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

# ----------------- 签到流水与防重复 -----------------
def get_latest_checkin_by_user(user_id: int) -> Optional[Dict[str, Any]]:
    """获取指定用户最近一条签到成功记录"""
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        SELECT * FROM attendance_logs 
        WHERE user_id = ? AND feishu_status IN ('SUCCESS', 'PENDING', 'REPEATED_SUCCESS')
        ORDER BY checkin_time DESC LIMIT 1
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
    """保存飞书妙搭集成配置"""
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
