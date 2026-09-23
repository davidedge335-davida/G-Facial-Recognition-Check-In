import { PersonRecord, CheckinLog, FeishuConfigState } from '../types';

export const DEFAULT_FEISHU_CONFIG: FeishuConfigState = {
  mode: 'webhook',
  enabled: true,
  webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/demo-miaoda-webhook',
  appId: '',
  appSecret: '',
  appToken: '',
  tableId: '',
};

// 预设人员示例数据；头像随站点提供，避免外部图床失败导致相册空白。
export const INITIAL_PERSONS: PersonRecord[] = [
  {
    id: 'user_001',
    name: '张子豪',
    studentId: '20240101',
    department: '计算机学院 / 软件工程2401班',
    avatarUrl: '/images/demo-zhang.jpg',
    embedding: generatePseudo512Vector('user_001_zhangzihao'),
    createdAt: '2026-09-20 10:00:00'
  },
  {
    id: 'user_002',
    name: '林雨薇',
    studentId: '20240102',
    department: '人工智能学院 / 智能科学2402班',
    avatarUrl: '/images/demo-lin.jpg',
    embedding: generatePseudo512Vector('user_002_linyuwei'),
    createdAt: '2026-09-21 09:15:00'
  },
  {
    id: 'user_003',
    name: '陈博文',
    studentId: '20240103',
    department: '电子工程系 / 微电子2401班',
    avatarUrl: '/images/demo-chen.jpg',
    embedding: generatePseudo512Vector('user_003_chenbowen'),
    createdAt: '2026-09-21 14:20:00'
  }
];

/**
 * 确定性生成 512 维 L2 归一化特征向量
 */
export function generatePseudo512Vector(seed: string): number[] {
  const vector: number[] = new Array(512);
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }

  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    h ^= (i * 31);
    h = Math.imul(h, 0x01000193);
    const val = ((h & 0xffff) / 65535) * 2 - 1;
    vector[i] = val;
    sumSq += val * val;
  }

  // L2 归一化
  const norm = Math.sqrt(sumSq) || 1;
  return vector.map(v => v / norm);
}

/**
 * 从 HTML 图像或 Canvas 提取特征向量（512维归一化向量）
 */
export function extractEmbeddingFromImageData(imageData: ImageData): number[] {
  const data = imageData.data;
  const vector: number[] = new Array(512).fill(0);
  const totalPixels = data.length / 4;

  // 划分 32 个空间网格 × 16 种梯度/色彩通道 = 512 维特征
  const step = Math.max(1, Math.floor(totalPixels / 2048));
  for (let i = 0; i < data.length; i += 4 * step) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const gray = (r * 299 + g * 587 + b * 114) / 1000;
    const pixelIdx = i / 4;
    const bin = (Math.floor(gray / 16) + (pixelIdx % 32) * 16) % 512;
    vector[bin] += 1;
  }

  // L2 归一化
  let sumSq = 0;
  for (let i = 0; i < 512; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq) || 1;
  return vector.map(v => v / norm);
}

/**
 * 两个 512 维归一化向量的余弦相似度计算: A · B
 */
export function calculateCosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!vecA || !vecB || vecA.length !== 512 || vecB.length !== 512) return 0;
  let dot = 0;
  for (let i = 0; i < 512; i++) {
    dot += vecA[i] * vecB[i];
  }
  return Math.max(0, Math.min(1, dot));
}

/**
 * 移动端截帧优化：压缩分辨率至 640x480 并输出 Base64
 */
export function captureAndCompressFrame(video: HTMLVideoElement): { base64: string; imageData: ImageData } | null {
  try {
    const canvas = document.createElement('canvas');
    // 限制在 640x480 以内，提升网络传输与人脸检测性能
    const maxWidth = 640;
    const maxHeight = 480;
    let width = video.videoWidth || 640;
    let height = video.videoHeight || 480;

    if (width > maxWidth) {
      height = Math.round((height * maxWidth) / width);
      width = maxWidth;
    }
    if (height > maxHeight) {
      width = Math.round((width * maxHeight) / height);
      height = maxHeight;
    }

    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(video, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const base64 = canvas.toDataURL('image/jpeg', 0.85);

    return { base64, imageData };
  } catch (err) {
    console.error('截取视频帧失败:', err);
    return null;
  }
}

/**
 * 检查人脸是否在中央取景框内（简易光线与反差检测）
 */
export function checkFacePresence(imageData: ImageData): { hasFace: boolean; reason?: string } {
  const { data, width, height } = imageData;
  // 采样中心区域 (宽高各 50%)
  const startX = Math.floor(width * 0.25);
  const endX = Math.floor(width * 0.75);
  const startY = Math.floor(height * 0.25);
  const endY = Math.floor(height * 0.75);

  let totalBrightness = 0;
  let count = 0;
  let varianceSum = 0;
  const samples: number[] = [];

  for (let y = startY; y < endY; y += 4) {
    for (let x = startX; x < endX; x += 4) {
      const idx = (y * width + x) * 4;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const brightness = 0.299 * r + 0.587 * g + 0.114 * b;
      samples.push(brightness);
      totalBrightness += brightness;
      count++;
    }
  }

  const avgBrightness = totalBrightness / (count || 1);
  for (const b of samples) {
    varianceSum += Math.pow(b - avgBrightness, 2);
  }
  const variance = varianceSum / (samples.length || 1);

  if (avgBrightness < 30) {
    return { hasFace: false, reason: '环境光线过暗，请开启补光灯或移步明亮处' };
  }
  if (avgBrightness > 240) {
    return { hasFace: false, reason: '环境光线过强导致曝光过度，请调整角度' };
  }
  if (variance < 200) {
    return { hasFace: false, reason: '未检测到面部起伏特征，请将脸部移入椭圆参考框' };
  }

  return { hasFace: true };
}

/**
 * 本地防重复打卡冷却检测（默认 300 秒 / 5 分钟）
 */
export function checkDuplicateCheckin(
  userId: string,
  logs: CheckinLog[],
  cooldownSeconds: number = 300
): { isDuplicate: boolean; lastTime?: string; remainingSeconds?: number } {
  const userLogs = logs.filter(
    l => l.userId === userId && (l.feishuStatus === 'SUCCESS' || l.feishuStatus === 'LOCAL_SAVED')
  );
  if (userLogs.length === 0) return { isDuplicate: false };

  const latest = userLogs[0]; // 假设降序排列
  const lastTime = new Date(latest.checkinTime).getTime();
  const now = Date.now();
  const diffSec = Math.floor((now - lastTime) / 1000);

  if (diffSec < cooldownSeconds) {
    return {
      isDuplicate: true,
      lastTime: latest.checkinTime,
      remainingSeconds: cooldownSeconds - diffSec
    };
  }

  return { isDuplicate: false };
}

/**
 * 将用户上传的本地照片或相册图片处理为 640x480 的 Base64 与 ImageData
 * 包含文件大小校验、图片格式过滤、零拷贝 ObjectURL 内存保护与友好解码错误提示
 */
export function processImageFile(file: File): Promise<{ base64: string; imageData: ImageData }> {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error('未选择任何文件'));
      return;
    }

    // 1. 校验文件格式
    const isImage = file.type.startsWith('image/') || /\.(jpe?g|png|webp|bmp)$/i.test(file.name);
    if (!isImage) {
      reject(new Error('请选择有效的图片文件（支持 JPG、JPEG、PNG、WEBP 格式）'));
      return;
    }

    // 2. 校验文件大小（限制 15MB 以内，防止移动端超大高分辨率照片撑爆内存）
    const maxSizeBytes = 15 * 1024 * 1024;
    if (file.size > maxSizeBytes) {
      const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
      reject(new Error(`照片文件过大（当前 ${sizeMB}MB，上限 15MB），可能导致手机卡顿，请在相机中选择标准分辨率照片`));
      return;
    }

    // 3. 使用 URL.createObjectURL 零拷贝技术，避免 readAsDataURL 产生数十兆的临时字符串
    let objectUrl: string | null = null;
    try {
      objectUrl = URL.createObjectURL(file);
    } catch (e) {
      // 降级回退
    }

    const cleanup = () => {
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
        objectUrl = null;
      }
    };

    const img = new Image();
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        const maxWidth = 640;
        const maxHeight = 480;
        let width = img.naturalWidth || 640;
        let height = img.naturalHeight || 480;

        if (width <= 0 || height <= 0) {
          cleanup();
          reject(new Error('照片尺寸无效，无法完成面部特征提取'));
          return;
        }

        // 保持比例缩放，减轻移动端渲染与网络传输负担
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          cleanup();
          reject(new Error('系统绘图上下文创建失败，请刷新页面重试'));
          return;
        }

        ctx.drawImage(img, 0, 0, width, height);
        const imageData = ctx.getImageData(0, 0, width, height);
        const base64 = canvas.toDataURL('image/jpeg', 0.85);

        cleanup();
        resolve({ base64, imageData });
      } catch (err: any) {
        cleanup();
        reject(new Error(`照片像素处理失败: ${err.message || '未知错误'}`));
      }
    };

    img.onerror = () => {
      cleanup();
      reject(new Error('照片解码失败，文件可能已损坏或包含不支持的色彩编码，请更换一张正脸免冠照片'));
    };

    if (objectUrl) {
      img.src = objectUrl;
    } else {
      const reader = new FileReader();
      reader.onload = e => {
        img.src = e.target?.result as string;
      };
      reader.onerror = () => reject(new Error('读取本地照片文件受阻'));
      reader.readAsDataURL(file);
    }
  });
}
