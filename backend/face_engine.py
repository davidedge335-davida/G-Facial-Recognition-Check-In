import os
import cv2
import base64
import numpy as np
from typing import Optional, Tuple, Dict, Any, List
from .config import settings
from .database import get_all_user_embeddings

# 尝试导入 insightface，提供优雅降级与标准初始化
try:
    import insightface
    from insightface.app import FaceAnalysis
    HAS_INSIGHTFACE = True
except ImportError:
    HAS_INSIGHTFACE = False

class FaceEngine:
    """
    高精度人脸识别引擎（基于 InsightFace / ArcFace）
    - 负责单张人脸检测与 512 维归一化特征向量提取
    - 维护底库向量内存缓存，打卡比对基于矩阵点积（余弦相似度），杜绝重复计算图像
    """
    def __init__(self, model_name: str = None):
        self.model_name = model_name or settings.INSIGHTFACE_MODEL_NAME
        self.app = None
        self._init_model()

        # 内存向量底库缓存
        self.cached_user_list: List[Dict[str, Any]] = []
        self.cached_embedding_matrix: Optional[np.ndarray] = None
        self.reload_cache()

    def _init_model(self):
        """初始化 InsightFace FaceAnalysis 实例"""
        if not HAS_INSIGHTFACE:
            print("⚠️ 提示: insightface 库未安装，请执行 pip install -r requirements.txt")
            return

        try:
            # 选用 CPUExecutionProvider（默认）或 CUDAExecutionProvider（如果有显卡）
            self.app = FaceAnalysis(
                name=self.model_name,
                providers=['CPUExecutionProvider']
            )
            # det_size 设为 (640, 640)，兼顾移动端清晰度与检测速度
            self.app.prepare(ctx_id=0, det_size=(640, 640))
            print(f"✅ InsightFace [{self.model_name}] 引擎加载完成！")
        except Exception as e:
            print(f"❌ InsightFace 初始化异常: {e}")
            self.app = None

    def reload_cache(self):
        """
        从 SQLite 加载所有用户 512 维特征向量至内存矩阵
        底库人员增删后调用此方法，毫秒级更新
        """
        users_with_embeddings = get_all_user_embeddings()
        self.cached_user_list = []
        vectors = []

        for item in users_with_embeddings:
            emb = item["embedding"]
            # 确保 L2 归一化
            norm = np.linalg.norm(emb)
            if norm > 1e-6:
                emb = emb / norm
            vectors.append(emb)
            self.cached_user_list.append({
                "id": item["id"],
                "name": item["name"],
                "student_id": item["student_id"],
                "department": item["department"]
            })

        if vectors:
            # 形成 (N, 512) 矩阵
            self.cached_embedding_matrix = np.array(vectors, dtype=np.float32)
        else:
            self.cached_embedding_matrix = None

        print(f"📦 已加载 {len(self.cached_user_list)} 位人员底库特征向量至内存缓存。")

    @staticmethod
    def base64_to_cv2(image_base64: str) -> Optional[np.ndarray]:
        """将 Base64 编码的图像转为 OpenCV BGR 格式 ndarray"""
        try:
            if "," in image_base64:
                # 去除 data:image/jpeg;base64, 前缀
                image_base64 = image_base64.split(",", 1)[1]
            image_bytes = base64.b64decode(image_base64)
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            return img
        except Exception as e:
            print(f"Base64 解码图像失败: {e}")
            return None

    def extract_embedding(self, image_input: Any) -> Tuple[Optional[np.ndarray], Optional[str]]:
        """
        从单张图像中检测人脸并提取 512 维归一化特征向量
        :param image_input: Base64 字符串 或 cv2 BGR 图像 ndarray
        :return: (embedding_normalized_512, error_message)
        """
        if isinstance(image_input, str):
            img = self.base64_to_cv2(image_input)
        elif isinstance(image_input, np.ndarray):
            img = image_input
        else:
            return None, "输入图像格式无效"

        if img is None:
            return None, "无法解析图像内容，请重试"

        # 检查模型是否加载
        if self.app is None:
            # 在没有物理模型环境时的容错/模拟处理（保证系统接口畅通）
            return None, "InsightFace 模型未成功初始化，请检查模型依赖"

        try:
            # 检测图像中的人脸
            faces = self.app.get(img)
            if not faces or len(faces) == 0:
                return None, "未检测到有效人脸，请面朝摄像头并保证光线充足"

            # 选取面积最大的人脸作为主目标
            largest_face = max(
                faces,
                key=lambda f: (f.bbox[2] - f.bbox[0]) * (f.bbox[3] - f.bbox[1])
            )

            # 获取 512 维 embedding 并进行 L2 归一化
            embedding = largest_face.embedding.astype(np.float32)
            norm = np.linalg.norm(embedding)
            if norm > 1e-6:
                embedding = embedding / norm

            return embedding, None
        except Exception as e:
            return None, f"人脸特征提取发生异常: {str(e)}"

    def match_face(
        self,
        query_embedding: np.ndarray,
        threshold: float = None
    ) -> Tuple[Optional[Dict[str, Any]], float, str]:
        """
        余弦相似度快速比对算法（利用矩阵乘法实现 1:N 极速搜索）
        :param query_embedding: 当前帧提取的 512 维归一化特征向量
        :param threshold: 相似度阈值（默认 0.60）
        :return: (matched_user_dict, similarity_score, message)
        """
        if threshold is None:
            threshold = settings.SIMILARITY_THRESHOLD

        if self.cached_embedding_matrix is None or len(self.cached_user_list) == 0:
            return None, 0.0, "底库尚无录入人员，请联系管理员录入"

        # 确保输入向量已归一化
        query_norm = np.linalg.norm(query_embedding)
        if query_norm > 1e-6:
            query_embedding = query_embedding / query_norm

        # 因为双方均已做 L2 归一化，余弦相似度等价于向量点积: Cosine(A, B) = A · B
        # 矩阵乘法计算当前人脸与所有已注册用户的相似度: shape (N,)
        similarities = np.dot(self.cached_embedding_matrix, query_embedding)

        # 找到最高得分的索引
        best_idx = int(np.argmax(similarities))
        best_score = float(similarities[best_idx])

        if best_score >= threshold:
            matched_user = self.cached_user_list[best_idx]
            return matched_user, best_score, "识别成功"
        else:
            return None, best_score, f"未匹配到人员（最高相似度 {best_score:.2f} < 阈值 {threshold:.2f}）"

# 全局单例
face_engine = FaceEngine()
