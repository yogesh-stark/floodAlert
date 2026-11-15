export type RiskLevel = 'safe' | 'watch' | 'warning' | 'danger';
export type TrendDirection = 'rising' | 'steady' | 'falling';
export type SensorStatus = 'online' | 'offline' | 'low_battery';
export type UserRole = 'resident' | 'reporter' | 'admin';
export type Language = 'en' | 'ta';
export type AlertLevel = 'watch' | 'warning' | 'danger' | 'all_clear';
export type AlertChannel = 'push' | 'sms' | 'whatsapp' | 'email';
export type ReportSeverity = 'ankle' | 'knee' | 'waist' | 'blocked_drain';
export type ReportStatus = 'unverified' | 'verified' | 'resolved';

export interface HistoricalFloodEvent {
  year: number;
  month: string;
  peakWaterCm: number;
  durationHours: number;
  noteEn: string;
  noteTa: string;
}

export interface ReadingPoint {
  timestamp: string;
  waterLevelCm: number;
  rainfallMmHr: number;
  riskScore: number;
}

export interface Street {
  id: string;
  name: string;
  nameTa: string;
  area: string;
  areaTa: string;
  coordinates: [number, number][];
  alternateRouteCoords: [number, number][];
  alternateRouteEn: string;
  alternateRouteTa: string;
  drainDepthCm: number;
  watchPct: number;
  warningPct: number;
  dangerPct: number;
  rainIntensityThresholdMmHr: number;
  currentWaterCm: number;
  waterPct: number;
  rainfallMmHr: number;
  rainfall1hMm: number;
  rainfall3hMm: number;
  rainfall24hMm: number;
  riskScore: number;
  riskLevel: RiskLevel;
  trend: TrendDirection;
  rateOfRiseCmPerMin: number;
  etaDangerMinutes: number | null;
  lastUpdated: string;
  history: ReadingPoint[];
  historicalEvents: HistoricalFloodEvent[];
}

export interface SensorNode {
  id: string;
  streetId: string;
  streetName: string;
  hardwareType: string;
  lat: number;
  lng: number;
  status: SensorStatus;
  batteryPct: number;
  firmwareVersion: string;
  lastPingAt: string;
}

export interface FloodAlert {
  id: string;
  streetId: string;
  streetName: string;
  streetNameTa: string;
  level: AlertLevel;
  titleEn: string;
  titleTa: string;
  messageEn: string;
  messageTa: string;
  alternateRouteEn: string;
  alternateRouteTa: string;
  etaMinutes: number | null;
  channelsDispatched: AlertChannel[];
  isManual: boolean;
  createdAt: string;
}

export interface StreetSubscription {
  id: string;
  userId: string;
  streetId: string;
  streetName: string;
  channels: AlertChannel[];
  radiusMeters: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CommunityReport {
  id: string;
  authorId: string;
  authorName: string;
  streetId: string;
  streetName: string;
  severity: ReportSeverity;
  description: string;
  photoUrl?: string;
  lat: number;
  lng: number;
  status: ReportStatus;
  confirmations: number;
  createdAt: string;
  updatedAt: string;
}

export interface ReliefShelter {
  id: string;
  name: string;
  nameTa: string;
  type: 'shelter' | 'hospital' | 'relief_hub';
  address: string;
  lat: number;
  lng: number;
  capacity: number;
  availableBeds: number;
  elevationStatus: string;
  phone: string;
  photoUrl?: string;
}

export interface WeatherForecast {
  city: string;
  currentTempC: number;
  currentPrecipMm: number;
  next3hPrecipMm: number;
  hourly: { time: string; precipMm: number; probPct: number }[];
  source: string;
  fetchedAt: string;
}

export interface SimulationState {
  active: boolean;
  tick: number;
  maxTicks: number;
  intensityLabel: string;
}
