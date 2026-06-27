export enum AppView {
  LANDING = 'LANDING',
  LOGIN = 'LOGIN',
  DASHBOARD = 'DASHBOARD',
  DAILY_ENTRY = 'DAILY_ENTRY',
  COPILOT = 'COPILOT',
  // ERP module workspaces
  PLANNING = 'PLANNING',
  PRODUCTION = 'PRODUCTION',
  FINANCE = 'FINANCE',
  INVENTORY = 'INVENTORY',
  PROCUREMENT = 'PROCUREMENT',
  QAQC = 'QAQC',
  HSE = 'HSE',
  RISK = 'RISK',
  DOCUMENTS = 'DOCUMENTS',
  REPORTS = 'REPORTS',
  NOTIFICATIONS = 'NOTIFICATIONS',
  SCHEDULING = 'SCHEDULING',
  PROFITABILITY = 'PROFITABILITY',
  FIELDOPS = 'FIELDOPS',
  APPROVALS = 'APPROVALS',
  PORTFOLIO = 'PORTFOLIO',
  ADMIN = 'ADMIN',
  HR = 'HR',
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isThinking?: boolean;
  widgetData?: {
    trendValue: string;
    trendType: 'critical' | 'warning' | 'optimal';
    heights: number[];
    caption: string;
  };
}

export interface DailyProductionEntry {
  id: string;
  date: string;
  wbsActivity: string;
  plannedQty: number;
  actualQty: number;
  laborHours: number;
  weatherCondition: string;
  equipmentHours?: number;
  remarks?: string;
  photos: string[];
  status: 'draft' | 'synced';
  timestamp?: string;
}

export interface Project {
  id: string;
  name: string;
  progress: number;
  status: 'optimal' | 'warning' | 'critical';
  yieldValue: string;
  activeCrews: number;
  costVariance: string;
  location: string;
}

export interface AiInsightAlert {
  id: string;
  type: string;
  site: string;
  title: string;
  description: string;
  severity: 'critical' | 'warning' | 'optimal';
  actionLabel?: string;
}
