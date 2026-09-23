export interface PersonRecord {
  id: string;
  name: string;
  studentId: string;
  department: string;
  avatarUrl: string;
  embedding: number[];
  createdAt: string;
}

export interface CheckinLog {
  id: string;
  userId: string;
  name: string;
  studentId: string;
  department: string;
  similarity: number;
  checkinTime: string;
  feishuStatus: 'SUCCESS' | 'REPEATED_SKIPPED' | 'FEISHU_PUSH_FAILED' | 'LOCAL_SAVED';
  errorMsg?: string;
}

export interface FeishuConfigState {
  mode: 'webhook' | 'bitable';
  enabled: boolean;
  webhookUrl: string;
  appId: string;
  appSecret: string;
  appToken: string;
  tableId: string;
}

export interface CheckinResultState {
  status: 'idle' | 'scanning' | 'success' | 'repeated' | 'not_found' | 'error';
  message: string;
  user?: PersonRecord;
  similarity?: number;
  checkinTime?: string;
  isRepeated?: boolean;
  feishuSynced?: boolean;
  feishuMsg?: string;
}
