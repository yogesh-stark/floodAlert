import React from 'react';
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  Bell,
  BellRing,
  Clock,
  CloudRain,
  Compass,
  Droplets,
  MapPin,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t, TREND_LABELS } from '../lib/i18n.ts';
import type { Language, ReliefShelter, Street, WeatherForecast } from '../types/flood.ts';
import { RISK_COLORS, RiskStatusLabel } from './RiskBadge.tsx';
import { WeatherForecastIcon } from './WeatherForecastIcon.tsx';

interface StreetInspectorProps {
  street: Street | null;
  shelters: ReliefShelter[];
  forecast: WeatherForecast | null;
  isSubscribed: boolean;
  onToggleSubscribe: (street: Street) => void;
  showSafeRoute: boolean;
  onToggleSafeRoute: () => void;
  lang: Language;
}

interface SevenDayPoint {
  day: string;
  fullDate: string;
  avgWaterCm: number;
  peakWaterCm: number;
  drainPctPeak: number;
  totalRainfallMm: number;
}

function hashStreetId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 10000;
  }
  return h;
}

function buildSevenDayWaterTrend(street: Street, lang: Language): SevenDayPoint[] {
  const seed = hashStreetId(street.id);
  const weekdayFmt = new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-US', { weekday: 'short' });
  const dateFmt = new Intl.DateTimeFormat(lang === 'ta' ? 'ta-IN' : 'en-US', { month: 'short', day: 'numeric' });
  const historyPeak = street.history.reduce((max, pt) => Math.max(max, pt.waterLevelCm), street.currentWaterCm);
  const historyAvg =
    street.history.length > 0
      ? street.history.reduce((sum, pt) => sum + pt.waterLevelCm, 0) / street.history.length
      : street.currentWaterCm;
  const baseline = Math.max(14, Math.min(street.drainDepthCm * 0.55, historyAvg * 0.78));
  const isSlowDraining = street.waterPct >= street.watchPct || street.rateOfRiseCmPerMin > 0.2;

  const points: SevenDayPoint[] = [];
  for (let daysAgo = 6; daysAgo >= 0; daysAgo--) {
    const dt = new Date(Date.now() - daysAgo * 24 * 60 * 60_000);
    const fullDate = dateFmt.format(dt);
    if (daysAgo === 0) {
      const peakToday = Number(Math.max(street.currentWaterCm, historyPeak).toFixed(1));
      const avgToday = Number(((historyAvg + street.currentWaterCm) / 2).toFixed(1));
      const rainToday = Number(Math.max(street.rainfall24hMm, street.rainfall1hMm).toFixed(1));
      points.push({
        day: lang === 'ta' ? 'இன்று' : 'Today',
        fullDate,
        avgWaterCm: avgToday,
        peakWaterCm: peakToday,
        drainPctPeak: Math.min(100, Math.round((peakToday / Math.max(1, street.drainDepthCm)) * 100)),
        totalRainfallMm: rainToday,
      });
      continue;
    }

    const idx = 6 - daysAgo;
    const phase = idx * 0.9 + (seed % 7);
    const isPrimaryStormDay = idx === 1 + (seed % 2);
    const isSecondaryStormDay = idx === 4;
    const stormPulse = isSecondaryStormDay ? 18 + (seed % 14) : isPrimaryStormDay ? 10 + (seed % 10) : 0;
    const trendSlope = isSlowDraining ? idx * 3.4 : Math.sin(phase) * 3.5;
    const rawAvg = Math.max(10, Math.min(street.drainDepthCm * 0.85, baseline + trendSlope + Math.cos(phase) * 4.5));
    const rawPeak = Math.min(street.drainDepthCm * 0.98, rawAvg + 8 + stormPulse + (seed % 6));

    const avgWaterCm = Number(rawAvg.toFixed(1));
    const peakWaterCm = Number(Math.max(avgWaterCm + 3, rawPeak).toFixed(1));
    const baseDailyRain = 6 + (seed % 8) + Math.abs(Math.sin(phase)) * 12;
    const totalRainfallMm = Number((baseDailyRain + stormPulse * 2.1).toFixed(1));

    points.push({
      day: weekdayFmt.format(dt),
      fullDate,
      avgWaterCm,
      peakWaterCm,
      drainPctPeak: Math.min(100, Math.round((peakWaterCm / Math.max(1, street.drainDepthCm)) * 100)),
      totalRainfallMm,
    });
  }

  return points;
}

function selectPeakFloodMarkers(points: SevenDayPoint[], warningCm: number): { point: SevenDayPoint; index: number }[] {
  if (points.length === 0) return [];
  // Primary historical peak from the prior 6 days
  let priorPeakIdx = 0;
  for (let i = 1; i < points.length - 1; i++) {
    if (points[i].peakWaterCm > points[priorPeakIdx].peakWaterCm) {
      priorPeakIdx = i;
    }
  }
  const markers: { point: SevenDayPoint; index: number }[] = [{ point: points[priorPeakIdx], index: priorPeakIdx }];

  // Include a second non-adjacent peak day (e.g. Today if elevated/highest, or an earlier storm spike)
  let secondIdx = -1;
  let secondVal = -1;
  for (let i = 0; i < points.length; i++) {
    if (Math.abs(i - priorPeakIdx) < 2) continue;
    const pt = points[i];
    if ((pt.peakWaterCm >= warningCm || pt.peakWaterCm > points[priorPeakIdx].peakWaterCm) && pt.peakWaterCm > secondVal) {
      secondVal = pt.peakWaterCm;
      secondIdx = i;
    }
  }
  if (secondIdx !== -1) {
    markers.push({ point: points[secondIdx], index: secondIdx });
  }

  return markers.sort((a, b) => a.index - b.index);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export const StreetInspector: React.FC<StreetInspectorProps> = ({
  street,
  shelters,
  forecast,
  isSubscribed,
  onToggleSubscribe,
  showSafeRoute,
  onToggleSafeRoute,
  lang,
}) => {
  const copy = t(lang);

  if (!street) {
    return (
      <div className="flex h-full min-h-[360px] flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white p-8 text-center">
        <MapPin className="h-8 w-8 text-slate-400" />
        <h3 className="mt-3 font-display text-lg font-semibold text-slate-900">Select a street on the map</h3>
        <p className="mt-1 max-w-xs text-sm text-slate-600">
          Tap any color-coded street corridor to inspect live drain depth, rainfall totals, and safe bypass routes.
        </p>
      </div>
    );
  }

  const mid = street.coordinates[Math.floor(street.coordinates.length / 2)] ?? [13.04, 80.24];
  const nearestShelter = shelters.reduce<{ shelter: ReliefShelter; distKm: number } | null>((best, sh) => {
    const d = haversineKm(mid[0], mid[1], sh.lat, sh.lng);
    if (!best || d < best.distKm) return { shelter: sh, distKm: d };
    return best;
  }, null);

  const dangerCm = Math.round((street.dangerPct / 100) * street.drainDepthCm);
  const warningCm = Math.round((street.warningPct / 100) * street.drainDepthCm);
  const chartData = street.history.map((pt) => ({
    time: new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    waterCm: pt.waterLevelCm,
    rainMm: pt.rainfallMmHr,
  }));

  const sevenDayData = buildSevenDayWaterTrend(street, lang);
  const peakFloodMarkers = selectPeakFloodMarkers(sevenDayData, warningCm);
  const sevenDayPeak = Math.max(...sevenDayData.map((d) => d.peakWaterCm));
  const sevenDayAvg = Number(
    (sevenDayData.reduce((acc, d) => acc + d.avgWaterCm, 0) / Math.max(1, sevenDayData.length)).toFixed(1)
  );
  const weekDeltaCm = Number((sevenDayData[sevenDayData.length - 1].avgWaterCm - sevenDayData[0].avgWaterCm).toFixed(1));
  const yMax = Math.max(street.drainDepthCm, dangerCm + 15, Math.ceil(sevenDayPeak + 12));

  const TrendIcon =
    street.trend === 'rising' ? ArrowUpRight : street.trend === 'falling' ? ArrowDownRight : ArrowRight;

  return (
    <aside
      aria-label="Street telemetry details"
      className="flex flex-col gap-5 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6"
    >
      {/* Top street header & unboxed metadata */}
      <div className="flex flex-col gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold tracking-tight text-slate-900">
              {lang === 'ta' ? street.nameTa : street.name}
            </h2>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {lang === 'ta' ? street.areaTa : street.area} · Risk Score {street.riskScore}/100 · Updated{' '}
              {new Date(street.lastUpdated).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
            </p>
          </div>
          <div className={`shrink-0 rounded-lg border px-2.5 py-1.5 ${RISK_COLORS[street.riskLevel].bg} ${RISK_COLORS[street.riskLevel].border}`}>
            <RiskStatusLabel level={street.riskLevel} lang={lang} />
          </div>
        </div>

        {/* Drain capacity fill meter */}
        <div>
          <div className="flex items-center justify-between text-xs font-medium text-slate-600 tabular-nums">
            <span>
              {copy.waterLevel}: <strong className="text-slate-900">{street.currentWaterCm} cm</strong> / {street.drainDepthCm} cm
            </span>
            <span className="font-mono font-semibold text-slate-900">{street.waterPct}%</span>
          </div>
          <div className="mt-1.5 h-2.5 w-full overflow-hidden rounded-full bg-slate-100">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${Math.min(100, street.waterPct)}%`,
                backgroundColor: RISK_COLORS[street.riskLevel].stroke,
              }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-slate-400 tabular-nums">
            <span>Watch {street.watchPct}%</span>
            <span>Warning {street.warningPct}%</span>
            <span>Danger {street.dangerPct}%</span>
          </div>
        </div>
      </div>

      {/* 4 Telemetry Metrics Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <CloudRain className="h-3.5 w-3.5 text-[#0F4C81]" />
            <span>{copy.rainIntensity}</span>
          </div>
          <div className="mt-1 font-mono text-lg font-semibold text-slate-900 tabular-nums">
            {street.rainfallMmHr} mm/hr
          </div>
          <div className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
            1h: {street.rainfall1hMm} · 3h: {street.rainfall3hMm} · 24h: {street.rainfall24hMm} mm
          </div>
        </div>

        <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
            <Droplets className="h-3.5 w-3.5 text-[#0F4C81]" />
            <span>{copy.trend}</span>
          </div>
          <div className="mt-1 flex items-center gap-1 text-lg font-semibold text-slate-900">
            <TrendIcon className="h-4 w-4 text-slate-700" />
            <span>{TREND_LABELS[street.trend][lang]}</span>
          </div>
          <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            {street.rateOfRiseCmPerMin >= 0 ? '+' : ''}
            {street.rateOfRiseCmPerMin} cm/min
          </div>
        </div>

        <div className="col-span-2 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50/70 px-3.5 py-2.5">
          <div className="flex items-center gap-2 text-xs font-medium text-slate-600">
            <Clock className="h-4 w-4 text-[#0F4C81]" />
            <span>{copy.etaDanger}</span>
          </div>
          <span className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
            {street.etaDangerMinutes === 0
              ? lang === 'ta'
                ? 'தற்போது அபாய நிலையில்'
                : 'At danger threshold'
              : street.etaDangerMinutes !== null
                ? `~${street.etaDangerMinutes} min`
                : copy.noImmediateDanger}
          </span>
        </div>
      </div>

      {/* Water Level & Rainfall Trend Chart */}
      <div>
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs font-semibold text-slate-700">
            {lang === 'ta' ? 'வடிகால் நீர் மட்டப் போக்கு (cm)' : 'Drain Water Level Trend (cm)'}
          </span>
          {forecast && (
            <div className="flex items-center gap-2">
              <WeatherForecastIcon condition={forecast.condition} lang={lang} showLabel />
              <span className="text-[11px] text-slate-500 tabular-nums">
                {forecast.currentTempC}°C · {lang === 'ta' ? 'அடுத்த 3மணி:' : 'Next 3h:'} {forecast.next3hPrecipMm} mm
              </span>
            </div>
          )}
        </div>
        <div className="h-36 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 6, right: 8, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="time" tick={{ fontSize: 10, fill: '#64748B' }} minTickGap={18} />
              <YAxis tick={{ fontSize: 10, fill: '#64748B' }} domain={[0, Math.max(street.drainDepthCm, dangerCm + 15)]} />
              <Tooltip
                contentStyle={{ fontSize: '12px', borderRadius: '8px', borderColor: '#CBD5E1' }}
              />
              <ReferenceLine y={dangerCm} stroke="#B91C1C" strokeDasharray="4 4" />
              <Area
                type="monotone"
                dataKey="waterCm"
                name="Water (cm)"
                stroke={RISK_COLORS[street.riskLevel].stroke}
                fill={RISK_COLORS[street.riskLevel].stroke}
                fillOpacity={0.14}
                strokeWidth={2}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 7-Day Water Level Pattern Chart */}
      <div className="border-t border-slate-100 pt-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-xs font-semibold text-slate-800">
            {lang === 'ta' ? '7-நாள் நீர் மட்டப் போக்கு (cm)' : '7-Day Water Level Pattern (cm)'}
          </h3>
          <span className="font-mono text-[11px] text-slate-500 tabular-nums">
            {lang === 'ta' ? `உச்சம் ${sevenDayPeak} cm · சராசரி ${sevenDayAvg} cm` : `7d Peak ${sevenDayPeak} cm · Avg ${sevenDayAvg} cm`}
          </span>
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-500">
          {weekDeltaCm > 4
            ? lang === 'ta'
              ? `வாரத்தின் தொடக்கத்தை விட அடிப்படை நீர் மட்டம் +${weekDeltaCm} cm உயர்ந்துள்ளது — மெதுவான வடிதல்.`
              : `Baseline drain retention is +${weekDeltaCm} cm higher than 6 days ago — monitor closely during rain spells.`
            : lang === 'ta'
              ? 'கடந்த 7 நாட்களில் மழைக்குப் பிறகு வடிகால் நீர் சீராக வடிந்துள்ளது.'
              : 'Drains have consistently receded toward baseline between rainfall pulses over the past 7 days.'}
        </p>

        <div className="mt-2.5 h-52 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={sevenDayData} margin={{ top: 28, right: 16, left: -24, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#64748B' }} />
              <YAxis tick={{ fontSize: 10, fill: '#64748B' }} domain={[0, yMax]} />
              <Tooltip
                contentStyle={{ fontSize: '12px', borderRadius: '8px', borderColor: '#CBD5E1' }}
                labelFormatter={(_label, payload) => {
                  const pt = payload?.[0]?.payload as SevenDayPoint | undefined;
                  return pt
                    ? `${pt.day} (${pt.fullDate}) · ${pt.totalRainfallMm} mm rain · ${pt.drainPctPeak}% cap.`
                    : String(_label);
                }}
              />
              <Legend wrapperStyle={{ fontSize: '11px', paddingTop: '4px' }} />
              <ReferenceLine y={warningCm} stroke="#D97706" strokeDasharray="3 3" />
              <ReferenceLine y={dangerCm} stroke="#B91C1C" strokeDasharray="4 4" />
              {peakFloodMarkers.map((marker) => (
                <ReferenceLine
                  key={marker.point.day}
                  x={marker.point.day}
                  stroke="#B91C1C"
                  strokeDasharray="4 4"
                  strokeWidth={1.5}
                  label={({ viewBox }: { viewBox?: { x?: number; y?: number } }) => {
                    const x = viewBox?.x ?? 0;
                    const y = viewBox?.y ?? 28;
                    const textAnchor =
                      marker.index === 0 ? 'start' : marker.index === sevenDayData.length - 1 ? 'end' : 'middle';
                    const rainLabel =
                      lang === 'ta' ? `${marker.point.totalRainfallMm} mm மழை` : `${marker.point.totalRainfallMm} mm rain`;
                    const dateLabel =
                      lang === 'ta' ? `உச்சம் · ${marker.point.fullDate}` : `Peak · ${marker.point.fullDate}`;
                    return (
                      <g>
                        <text
                          x={x}
                          y={y - 16}
                          textAnchor={textAnchor}
                          fill="#991B1B"
                          fontSize={9.5}
                          fontWeight={600}
                        >
                          {dateLabel}
                        </text>
                        <text
                          x={x}
                          y={y - 5}
                          textAnchor={textAnchor}
                          fill="#0F4C81"
                          fontSize={10}
                          fontWeight={600}
                          fontFamily="IBM Plex Mono, monospace"
                        >
                          {rainLabel}
                        </text>
                      </g>
                    );
                  }}
                />
              ))}
              <Line
                type="monotone"
                dataKey="peakWaterCm"
                name={lang === 'ta' ? 'உச்ச அளவு (cm)' : 'Daily Peak (cm)'}
                stroke="#0F4C81"
                strokeWidth={2.25}
                dot={{ r: 3, fill: '#0F4C81', strokeWidth: 0 }}
                activeDot={{ r: 5 }}
              />
              <Line
                type="monotone"
                dataKey="avgWaterCm"
                name={lang === 'ta' ? 'சராசரி (cm)' : 'Daily Avg (cm)'}
                stroke="#64748B"
                strokeWidth={1.75}
                strokeDasharray="4 3"
                dot={{ r: 2.5, fill: '#64748B', strokeWidth: 0 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500 tabular-nums">
          <span className="inline-flex items-center gap-1.5 font-medium text-red-800">
            <span className="inline-block h-3 w-0 border-l-2 border-dashed border-red-700" />
            {lang === 'ta' ? 'வெள்ள உச்ச நாட்கள்:' : 'Peak flood dates:'}
          </span>
          {peakFloodMarkers.map((m, idx) => (
            <span key={m.point.day}>
              {idx > 0 ? '· ' : ''}
              {m.point.fullDate} ({m.point.peakWaterCm} cm, {m.point.totalRainfallMm} mm)
            </span>
          ))}
          {street.historicalEvents[0] && (
            <span>
              · {lang === 'ta' ? 'முந்தைய பதிவு:' : 'Record:'} {street.historicalEvents[0].month}{' '}
              {street.historicalEvents[0].year} ({street.historicalEvents[0].peakWaterCm} cm)
            </span>
          )}
        </div>
      </div>

      {/* Safe Alternate Route & Nearest Shelter */}
      <div className="space-y-2.5 border-t border-slate-100 pt-4 text-xs">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="flex items-center gap-1.5 font-semibold text-slate-800">
              <Compass className="h-3.5 w-3.5 text-sky-700" />
              <span>{copy.alternateRoute}</span>
            </div>
            <p className="mt-1 text-slate-600">{lang === 'ta' ? street.alternateRouteTa : street.alternateRouteEn}</p>
          </div>
          <button
            type="button"
            onClick={onToggleSafeRoute}
            className={`min-h-[36px] shrink-0 rounded-lg border px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap ${
              showSafeRoute
                ? 'border-sky-600 bg-sky-50 text-sky-800'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            }`}
          >
            {showSafeRoute ? 'Hide on Map' : 'Show on Map'}
          </button>
        </div>

        {nearestShelter && (
          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <div className="flex items-center justify-between text-slate-700">
              <span className="font-semibold">{copy.nearestSafeHub}</span>
              <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                {nearestShelter.distKm.toFixed(1)} km away
              </span>
            </div>
            <p className="mt-1 font-medium text-slate-900">
              {lang === 'ta' ? nearestShelter.shelter.nameTa : nearestShelter.shelter.name}
            </p>
            <p className="mt-0.5 text-[11px] text-slate-500">
              {nearestShelter.shelter.elevationStatus} · {nearestShelter.shelter.phone}
            </p>
          </div>
        )}
      </div>

      {/* Subscribe CTA */}
      <button
        type="button"
        onClick={() => onToggleSubscribe(street)}
        className={`flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors ${
          isSubscribed
            ? 'border border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
            : 'bg-[#0F4C81] text-white hover:bg-[#0c3c66]'
        }`}
      >
        {isSubscribed ? <BellRing className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
        <span>{isSubscribed ? copy.subscribedStreet : copy.subscribeStreet}</span>
      </button>
    </aside>
  );
};
