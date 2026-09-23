import os
import uuid
from datetime import datetime
from contextlib import asynccontextmanager
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Depends, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from .config import settings
from .models import (
    UserCreate, UserResponse,
    CheckinRequest, CheckinResponse, MatchedUserInfo,
    FeishuConfig, FeishuTestResponse,
    AttendanceLog, AdminLogin, TokenResponse
)
from .database import (
    init_db, add_user, get_user_by_student_id, get_all_users, delete_user,
    is_recent_duplicate_checkin, add_attendance_log, get_recent_attendance_logs,
    get_feishu_config, save_feishu_config
)
from .face_engine import face_engine
from .feishu_service import feishu_service

security = HTTPBearer(auto_error=False)
ADMIN_TOKEN_VALUE = "admin-logged-in-token-2026"

async def verify_admin(credentials: Optional[HTTPAuthorizationCredentials] = Depends(security)):
    """验证管理员 Bearer Token，保护后台敏感接口"""
    if not credentials or credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="缺少管理员 Token，请先登录后台",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if credentials.credentials != ADMIN_TOKEN_VALUE:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="管理员凭证无效或已过期，请重新登录",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return True

@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化数据库与人脸内存缓存"""
    print("🚀 启动人脸识别签到系统后台...")
    init_db()
    face_engine.reload_cache()
    yield
    print("🛑 正在关闭人脸识别签到系统后台...")

app = FastAPI(
    title=settings.APP_NAME,
    description="基于 InsightFace 512 维特征向量比对与飞书妙搭集成的移动端刷脸签到系统",
    version="1.0.0",
    lifespan=lifespan
)

# 允许跨域请求（方便局域网手机浏览器及开发环境调用）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 挂载静态头像目录
app.mount("/avatars", StaticFiles(directory=settings.AVATARS_DIR), name="avatars")

# ----------------- 健康检查 -----------------
@app.get("/api/health")
async def health_check():
    return {
        "status": "online",
        "app_name": settings.APP_NAME,
        "cached_users_count": len(face_engine.cached_user_list),
        "similarity_threshold": settings.SIMILARITY_THRESHOLD,
        "timestamp": datetime.now().isoformat()
    }

# ----------------- 核心业务：移动端刷脸签到接口 -----------------
@app.post("/api/checkin", response_model=CheckinResponse)
async def checkin(request: CheckinRequest):
    """
    移动端人脸识别打卡接口
    1. 前端截取 640x480 单帧图像 Base64 上传
    2. 后端 InsightFace 提取 512 维特征向量
    3. 内存矩阵余弦相似度极速比对（杜绝重复读底库）
    4. 防重复打卡判定（5 分钟内重复签到提示且不推飞书）
    5. 异步推送到飞书妙搭（Webhook 或 多维表格 API）
    """
    now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    # 1. 提取当前人脸特征向量
    query_embedding, err = face_engine.extract_embedding(request.image_base64)
    if err or query_embedding is None:
        return CheckinResponse(
            success=False,
            code=400,
            message=err or "未能在画面中检测到有效人脸，请正对手机摄像头"
        )

    # 2. 余弦相似度比对
    threshold = request.threshold or settings.SIMILARITY_THRESHOLD
    matched_user, similarity, match_msg = face_engine.match_face(query_embedding, threshold=threshold)

    if not matched_user:
        return CheckinResponse(
            success=False,
            code=404,
            message="未匹配到人员，请联系管理员录入照片底库",
            similarity=round(similarity, 4)
        )

    user_info = MatchedUserInfo(
        id=matched_user["id"],
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"]
    )

    # 3. 防重复打卡判定（如 5 分钟内）
    is_duplicate, last_time = is_recent_duplicate_checkin(
        matched_user["id"],
        cooldown_seconds=settings.REPEAT_CHECKIN_COOLDOWN_SECONDS
    )

    if is_duplicate:
        # 重复签到：记录日志为 REPEATED，但不重复向飞书推送
        add_attendance_log(
            user_id=matched_user["id"],
            name=matched_user["name"],
            student_id=matched_user["student_id"],
            department=matched_user["department"],
            similarity=similarity,
            feishu_status="REPEATED_SKIPPED",
            error_msg=f"防重复规则拦截：最近一次打卡时间为 {last_time}"
        )
        return CheckinResponse(
            success=True,
            code=201,
            message=f"您已签到成功（上次签到时间：{last_time}），请勿重复刷脸！",
            user=user_info,
            similarity=round(similarity, 4),
            checkin_time=now_str,
            is_repeated=True,
            feishu_synced=False,
            feishu_message="处于防重复冷却期内，无需重复同步飞书"
        )

    # 4. 首次签到成功：推送至飞书妙搭
    feishu_ok, feishu_msg = await feishu_service.push_checkin(
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"],
        similarity=similarity,
        checkin_time=now_str
    )

    # 5. 持久化记录到 SQLite 签到日志
    add_attendance_log(
        user_id=matched_user["id"],
        name=matched_user["name"],
        student_id=matched_user["student_id"],
        department=matched_user["department"],
        similarity=similarity,
        feishu_status="SUCCESS" if feishu_ok else "FEISHU_PUSH_FAILED",
        error_msg=None if feishu_ok else feishu_msg
    )

    return CheckinResponse(
        success=True,
        code=200,
        message="签到成功！",
        user=user_info,
        similarity=round(similarity, 4),
        checkin_time=now_str,
        is_repeated=False,
        feishu_synced=feishu_ok,
        feishu_message=feishu_msg
    )

# ----------------- 管理后台：人员底库管理 -----------------
@app.post("/api/users", response_model=UserResponse, dependencies=[Depends(verify_admin)])
async def create_user(user_in: UserCreate):
    """
    录入人员底库信息（需管理员鉴权）
    1. 校验学号/工号唯一性
    2. 检测人脸并提取 512 维特征向量（若未识别人脸直接拒绝并提示）
    3. 保存原图留档，存入 SQLite 并重载内存向量矩阵
    """
    # 检查学号是否已存在
    existing = get_user_by_student_id(user_in.student_id)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"学号/工号 [{user_in.student_id}] 已存在，无法重复录入"
        )

    # 提取特征向量
    embedding, err = face_engine.extract_embedding(user_in.photo_base64)
    if err or embedding is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"照片人脸校验失败: {err or '未检测到清晰人脸，请上传正面免冠照片'}"
        )

    # 保存照片到本地目录
    avatar_filename = f"{user_in.student_id}_{uuid.uuid4().hex[:8]}.jpg"
    avatar_path = os.path.join(settings.AVATARS_DIR, avatar_filename)
    try:
        img_bgr = face_engine.base64_to_cv2(user_in.photo_base64)
        if img_bgr is not None:
            import cv2
            cv2.imwrite(avatar_path, img_bgr)
    except Exception as e:
        print(f"保存头像原图异常（不影响入库）: {e}")

    # 存入数据库
    user_id = add_user(
        name=user_in.name,
        student_id=user_in.student_id,
        department=user_in.department,
        avatar_path=avatar_path,
        embedding=embedding
    )

    # 立即热重载内存缓存（使新增人员无需重启服务立即可刷脸）
    face_engine.reload_cache()

    return UserResponse(
        id=user_id,
        name=user_in.name,
        student_id=user_in.student_id,
        department=user_in.department,
        avatar_url=f"/avatars/{avatar_filename}",
        created_at=datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    )

@app.get("/api/users", response_model=List[UserResponse])
async def list_users():
    """获取所有录入人员列表"""
    users = get_all_users()
    res = []
    for u in users:
        avatar_url = None
        if u.get("avatar_path"):
            fname = os.path.basename(u["avatar_path"])
            avatar_url = f"/avatars/{fname}"
        res.append(UserResponse(
            id=u["id"],
            name=u["name"],
            student_id=u["student_id"],
            department=u["department"],
            avatar_url=avatar_url,
            created_at=str(u.get("created_at", ""))
        ))
    return res

@app.delete("/api/users/{user_id}", dependencies=[Depends(verify_admin)])
async def remove_user(user_id: int):
    """删除人员信息（连同特征向量与头像，需管理员鉴权）"""
    ok = delete_user(user_id)
    if not ok:
        raise HTTPException(status_code=404, detail="未找到该人员")
    face_engine.reload_cache()
    return {"success": True, "message": "人员已成功删除"}

# ----------------- 管理后台：飞书妙搭配置与连通性测试 -----------------
@app.get("/api/config/feishu", response_model=FeishuConfig, dependencies=[Depends(verify_admin)])
async def get_feishu_configuration():
    """读取当前飞书配置（需管理员鉴权）"""
    cfg = get_feishu_config()
    return FeishuConfig(**cfg)

@app.post("/api/config/feishu", dependencies=[Depends(verify_admin)])
async def update_feishu_configuration(config: FeishuConfig):
    """更新保存飞书配置（需管理员鉴权）"""
    save_feishu_config(config.model_dump())
    return {"success": True, "message": "飞书配置已成功保存！"}

@app.post("/api/feishu/test", response_model=FeishuTestResponse, dependencies=[Depends(verify_admin)])
async def test_feishu_integration(custom_cfg: Optional[FeishuConfig] = None):
    """测试飞书妙搭 Webhook 或多维表格 API 连通性（需管理员鉴权）"""
    cfg_dict = custom_cfg.model_dump() if custom_cfg else None
    success, message, data = await feishu_service.test_connection(cfg_dict)
    return FeishuTestResponse(
        success=success,
        message=message,
        response_data=data
    )

# ----------------- 管理后台：流水审计与统计 -----------------
@app.get("/api/logs", response_model=List[AttendanceLog], dependencies=[Depends(verify_admin)])
async def get_logs(limit: int = 50):
    """查询最近的签到流水日志（需管理员鉴权）"""
    logs = get_recent_attendance_logs(limit=limit)
    return [AttendanceLog(**log) for log in logs]

# ----------------- 管理员简易登录 -----------------
@app.post("/api/auth/login", response_model=TokenResponse)
async def login(auth: AdminLogin):
    """管理员登录验证"""
    if auth.username == settings.ADMIN_USERNAME and auth.password == settings.ADMIN_PASSWORD:
        return TokenResponse(access_token="admin-logged-in-token-2026", token_type="bearer")
    raise HTTPException(status_code=401, detail="账号或密码错误")
