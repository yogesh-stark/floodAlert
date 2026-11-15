import type { ReadingPoint, RiskLevel, TrendDirection } from '../types/flood.ts';

export interface RiskEvaluationInput {
  currentWaterCm: number;
  drainDepthCm: number;
  watchPct: number;
  warningPct: number;
  dangerPct: number;
  rainfallMmHr: number;
  rainIntensityThresholdMmHr: number;
  recentHistory: ReadingPoint[];
  forecastNext3hMm?: number;
}

export interface RiskEvaluationResult {
  waterPct: number;
  riskScore: number;
  riskLevel: RiskLevel;
  trend: TrendDirection;
  rateOfRiseCmPerMin: number;
  etaDangerMinutes: number | null;
}

export function evaluateStreetRisk(input: RiskEvaluationInput): RiskEvaluationResult {
  const {
    currentWaterCm,
    drainDepthCm,
    watchPct,
    warningPct,
    dangerPct,
    rainfallMmHr,
    rainIntensityThresholdMmHr,
    recentHistory,
    forecastNext3hMm = 0,
  } = input;

  const safeDepth = Math.max(drainDepthCm, 10);
  const waterPct = Math.min(100, Math.round((currentWaterCm / safeDepth) * 100));

  // Compute rate of rise from the last 3 readings (assuming ~5 min intervals or timestamp diff)
  let rateOfRiseCmPerMin = 0;
  if (recentHistory.length >= 2) {
    const prev = recentHistory[recentHistory.length - 2];
    const latest = recentHistory[recentHistory.length - 1];
    const dtMs = Math.max(60_000, new Date(latest.timestamp).getTime() - new Date(prev.timestamp).getTime());
    const dtMin = dtMs / 60_000;
    rateOfRiseCmPerMin = Number(((currentWaterCm - prev.waterLevelCm) / dtMin).toFixed(2));
  }

  let trend: TrendDirection = 'steady';
  if (rateOfRiseCmPerMin > 0.35) trend = 'rising';
  else if (rateOfRiseCmPerMin < -0.25) trend = 'falling';

  // Weighted rule-based risk score (0-100):
  // 55% drain fill percentage + 25% rainfall intensity ratio + 12% rise velocity + 8% 3h weather forecast blend
  const drainFactor = Math.min(1, waterPct / dangerPct) * 55;
  const rainFactor = Math.min(1, rainfallMmHr / Math.max(rainIntensityThresholdMmHr, 10)) * 25;
  const velocityFactor = Math.min(1, Math.max(0, rateOfRiseCmPerMin) / 2.5) * 12;
  const forecastFactor = Math.min(1, forecastNext3hMm / 35) * 8;
  const riskScore = Math.min(100, Math.round(drainFactor + rainFactor + velocityFactor + forecastFactor));

  let riskLevel: RiskLevel = 'safe';
  if (waterPct >= dangerPct || riskScore >= 82) {
    riskLevel = 'danger';
  } else if (waterPct >= warningPct || riskScore >= 62) {
    riskLevel = 'warning';
  } else if (waterPct >= watchPct || rainfallMmHr >= rainIntensityThresholdMmHr * 0.65 || riskScore >= 38) {
    riskLevel = 'watch';
  }

  // Estimate minutes until water crosses danger threshold
  const dangerLevelCm = (dangerPct / 100) * safeDepth;
  let etaDangerMinutes: number | null = null;
  if (currentWaterCm >= dangerLevelCm) {
    etaDangerMinutes = 0;
  } else if (rateOfRiseCmPerMin > 0.2) {
    const remainingCm = dangerLevelCm - currentWaterCm;
    etaDangerMinutes = Math.max(2, Math.min(240, Math.round(remainingCm / rateOfRiseCmPerMin)));
  } else if (rainfallMmHr > rainIntensityThresholdMmHr * 0.7 && waterPct >= watchPct) {
    // Estimate indirect rise from sustained heavy rainfall
    const estimatedCmPerMin = (rainfallMmHr / 60) * 1.4;
    const remainingCm = dangerLevelCm - currentWaterCm;
    etaDangerMinutes = Math.max(5, Math.min(180, Math.round(remainingCm / estimatedCmPerMin)));
  }

  return {
    waterPct,
    riskScore,
    riskLevel,
    trend,
    rateOfRiseCmPerMin,
    etaDangerMinutes,
  };
}
