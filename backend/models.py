from typing import Optional, List, Literal
from pydantic import BaseModel, Field
from datetime import datetime

# ----------------- 用户/人员相关模型 -----------------
class UserCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=50, description="人员姓名")
    student_id: str = Field(..., min_length=1, max_length=50, description="学号或工号")
    department: str = Field(..., min_length=1, max_length=100, description="班级或部门")
    photo_base64: str = Field(..., description="人脸正脸照片的 Base64 编码字符串（支持带 data:image 前缀或纯 base64）")

class UserResponse(BaseModel):
    id: int
    name: str
    student_id: str
    department: str
    avatar_url: Optional[str] = None
    created_at: str

# ----------------- 刷脸签到相关模型 -----------------
class CheckinRequest(BaseModel):
    image_base64: str = Field(..., description="手机摄像头截取的单帧人脸图像 Base64")
    threshold: Optional[float] = Field(None, ge=0.1, le=1.0, description="可选自定义余弦相似度阈值")

class MatchedUserInfo(BaseModel):
    id: int
    name: str
    student_id: str
    department: str

class CheckinResponse(BaseModel):
    success: bool
    code: int = Field(..., description="状态码：200 成功，201 重复打卡，400 人脸未检测，404 无匹配人员，500 系统异常")
    message: str
    user: Optional[MatchedUserInfo] = None
    similarity: Optional[float] = None
    checkin_time: Optional[str] = None
    is_repeated: bool = False
    feishu_synced: bool = False
    feishu_message: Optional[str] = None

# ----------------- 飞书妙搭配置模型 -----------------
class FeishuConfigBase(BaseModel):
    mode: Literal["webhook", "bitable"] = Field("webhook", description="集成模式：webhook（推荐轻量）或 bitable（多维表格API）")
    enabled: bool = Field(True, description="是否启用飞书自动同步")
    # 方案 A: 飞书妙搭 Webhook
    webhook_url: Optional[str] = Field(None, description="飞书妙搭/工作流的 Webhook 触发器 URL")
    # 方案 B: 飞书开放平台多维表格 API
    app_id: Optional[str] = Field(None, description="飞书自建应用 App ID (cli_xxx)")
    app_token: Optional[str] = Field(None, description="多维表格 App Token (bascnxxx)")
    table_id: Optional[str] = Field(None, description="多维表格数据表 Table ID (tblxxx)")

class FeishuConfigUpdate(FeishuConfigBase):
    """保存或更新飞书配置请求（只写型敏感字段 app_secret，留空或脱敏符号表示保留现有密钥）"""
    app_secret: Optional[str] = Field(None, description="飞书自建应用 App Secret（留空表示保持服务端现有密钥不变）")

class FeishuConfigResponse(FeishuConfigBase):
    """读取飞书配置响应（严格排除明文 app_secret，仅返回脱敏掩码与存在状态）"""
    has_app_secret: bool = Field(False, description="服务器端是否已安全保存 App Secret")
    app_secret_masked: Optional[str] = Field(None, description="脱敏后的密钥显示标识，例如 ************")

# 向下兼容历史引用
FeishuConfig = FeishuConfigUpdate

class FeishuTestResponse(BaseModel):
    success: bool
    status_code: Optional[int] = None
    message: str
    response_data: Optional[dict] = None

# ----------------- 签到流水日志模型 -----------------
class AttendanceLog(BaseModel):
    id: int
    user_id: int
    name: str
    student_id: str
    department: str
    similarity: float
    checkin_time: str
    feishu_status: str
    error_msg: Optional[str] = None
    retry_count: int = 0
    feishu_record_id: Optional[str] = None

class SyncRetryResponse(BaseModel):
    success: bool
    message: str
    record_id: Optional[str] = None

class BatchSyncRetryResponse(BaseModel):
    total: int
    succeeded: int
    failed: int
    details: List[dict] = []
    message: str

class SyncStatsResponse(BaseModel):
    total: int
    success: int
    failed: int
    repeated: int
    pending: int

# ----------------- 管理员认证模型 -----------------
class AdminLogin(BaseModel):
    username: str
    password: str

class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int = Field(default=86400, description="Token 有效秒数")

class ChangePasswordRequest(BaseModel):
    old_password: str = Field(..., description="原密码")
    new_password: str = Field(..., min_length=4, description="新密码（至少4位）")

class AdminUserResponse(BaseModel):
    username: str
    authenticated: bool = True
    expires_at: Optional[int] = None
    is_default_password: bool = False
