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
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { t, TREND_LABELS } from '../lib/i18n.ts';
import type { Language, ReliefShelter, Street, WeatherForecast } from '../types/flood.ts';
import { RISK_COLORS, RiskStatusLabel } from './RiskBadge.tsx';

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
  const chartData = street.history.map((pt) => ({
    time: new Date(pt.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    waterCm: pt.waterLevelCm,
    rainMm: pt.rainfallMmHr,
  }));

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
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-slate-700">
            {lang === 'ta' ? 'வடிகால் நீர் மட்டப் போக்கு (cm)' : 'Drain Water Level Trend (cm)'}
          </span>
          {forecast && (
            <span className="text-[11px] text-slate-500 tabular-nums">
              Next 3h Forecast: {forecast.next3hPrecipMm} mm
            </span>
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
