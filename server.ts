import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import {
  createInitialAlerts,
  createInitialReports,
  createInitialSensors,
  createInitialStreets,
  INITIAL_SHELTERS,
} from './server/seedData.ts';
import { formatAlertCopy } from './src/lib/i18n.ts';
import { evaluateStreetRisk } from './src/lib/riskEngine.ts';
import type {
  AlertChannel,
  AlertLevel,
  CommunityReport,
  FloodAlert,
  ReportSeverity,
  SensorNode,
  SimulationState,
  Street,
  WeatherForecast,
} from './src/types/flood.ts';

const PORT = 3000;

let streets: Street[] = createInitialStreets();
let sensors: SensorNode[] = createInitialSensors(streets);
let alerts: FloodAlert[] = createInitialAlerts();
let reports: CommunityReport[] = createInitialReports();
const shelters = INITIAL_SHELTERS;

let simulationState: SimulationState = {
  active: false,
  tick: 0,
  maxTicks: 6,
  intensityLabel: 'Nominal',
};

let simulationTimer: NodeJS.Timeout | null = null;
let cachedForecast: WeatherForecast = {
  city: 'Chennai, IN',
  currentTempC: 27.4,
  currentPrecipMm: 4.2,
  next3hPrecipMm: 14.5,
  hourly: [
    { time: 'Now', precipMm: 4.2, probPct: 68 },
    { time: '+1h', precipMm: 6.1, probPct: 75 },
    { time: '+2h', precipMm: 4.8, probPct: 70 },
    { time: '+3h', precipMm: 3.6, probPct: 60 },
    { time: '+4h', precipMm: 2.1, probPct: 45 },
    { time: '+5h', precipMm: 1.0, probPct: 30 },
  ],
  source: 'Baseline Monsoon Model',
  fetchedAt: new Date().toISOString(),
};

async function refreshWeatherForecast(): Promise<WeatherForecast> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);
    const resp = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=13.0827&longitude=80.2707&hourly=precipitation,precipitation_probability&current=temperature_2m,precipitation&forecast_days=1',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resp.ok) return cachedForecast;
    const data = (await resp.json()) as {
      current?: { temperature_2m?: number; precipitation?: number };
      hourly?: { time?: string[]; precipitation?: number[]; precipitation_probability?: number[] };
    };
    const currentHourIdx = Math.min(23, new Date().getHours());
    const hourlyTimes = data.hourly?.time ?? [];
    const hourlyPrecip = data.hourly?.precipitation ?? [];
    const hourlyProb = data.hourly?.precipitation_probability ?? [];
    const next6 = Array.from({ length: 6 }, (_, offset) => {
      const idx = Math.min(hourlyTimes.length - 1, currentHourIdx + offset);
      return {
        time: offset === 0 ? 'Now' : `+${offset}h`,
        precipMm: Number((hourlyPrecip[idx] ?? 0).toFixed(1)),
        probPct: Math.round(hourlyProb[idx] ?? 20),
      };
    });
    const next3hPrecipMm = Number(
      next6
        .slice(0, 3)
        .reduce((acc, item) => acc + item.precipMm, 0)
        .toFixed(1)
    );
    cachedForecast = {
      city: 'Chennai, IN',
      currentTempC: Number((data.current?.temperature_2m ?? 28).toFixed(1)),
      currentPrecipMm: Number((data.current?.precipitation ?? 0).toFixed(1)),
      next3hPrecipMm,
      hourly: next6,
      source: 'Open-Meteo Live API',
      fetchedAt: new Date().toISOString(),
    };
  } catch {
    // Keep last forecast on network timeout
  }
  return cachedForecast;
}

const app = express();
app.use(express.json({ limit: '4mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (reqUrl.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  }
});

function broadcast(event: string, payload: unknown) {
  const message = JSON.stringify({ event, payload, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  }
}

wss.on('connection', (ws) => {
  ws.send(
    JSON.stringify({
      event: 'init:state',
      payload: {
        streets,
        sensors,
        alerts,
        reports,
        shelters,
        simulation: simulationState,
        forecast: cachedForecast,
      },
      timestamp: new Date().toISOString(),
    })
  );
});

function applySensorReading(params: {
  sensorId: string;
  streetId?: string;
  waterLevelCm: number;
  rainfallMmHr: number;
  batteryPct?: number;
}) {
  const nowIso = new Date().toISOString();
  const sensor = sensors.find((s) => s.id === params.sensorId) ?? sensors.find((s) => s.streetId === params.streetId);
  const targetStreetId = params.streetId ?? sensor?.streetId;
  const streetIdx = streets.findIndex((st) => st.id === targetStreetId);
  if (streetIdx === -1) return null;

  const street = streets[streetIdx];
  const prevLevel = street.riskLevel;

  const nextHistory = [
    ...street.history.slice(-23),
    {
      timestamp: nowIso,
      waterLevelCm: Number(params.waterLevelCm.toFixed(1)),
      rainfallMmHr: Number(params.rainfallMmHr.toFixed(1)),
      riskScore: street.riskScore,
    },
  ];

  const evalRes = evaluateStreetRisk({
    currentWaterCm: params.waterLevelCm,
    drainDepthCm: street.drainDepthCm,
    watchPct: street.watchPct,
    warningPct: street.warningPct,
    dangerPct: street.dangerPct,
    rainfallMmHr: params.rainfallMmHr,
    rainIntensityThresholdMmHr: street.rainIntensityThresholdMmHr,
    recentHistory: nextHistory,
    forecastNext3hMm: Math.max(cachedForecast.next3hPrecipMm, simulationState.active ? 32 : 0),
  });

  nextHistory[nextHistory.length - 1].riskScore = evalRes.riskScore;

  const deltaRain1h = Number((params.rainfallMmHr * 0.25).toFixed(1));
  const updatedStreet: Street = {
    ...street,
    currentWaterCm: Number(params.waterLevelCm.toFixed(1)),
    waterPct: evalRes.waterPct,
    rainfallMmHr: Number(params.rainfallMmHr.toFixed(1)),
    rainfall1hMm: Number(Math.max(params.rainfallMmHr * 0.8, street.rainfall1hMm + deltaRain1h * 0.1).toFixed(1)),
    rainfall3hMm: Number((street.rainfall3hMm + deltaRain1h * 0.1).toFixed(1)),
    rainfall24hMm: Number((street.rainfall24hMm + deltaRain1h * 0.1).toFixed(1)),
    riskScore: evalRes.riskScore,
    riskLevel: evalRes.riskLevel,
    trend: evalRes.trend,
    rateOfRiseCmPerMin: evalRes.rateOfRiseCmPerMin,
    etaDangerMinutes: evalRes.etaDangerMinutes,
    lastUpdated: nowIso,
    history: nextHistory,
  };

  streets[streetIdx] = updatedStreet;

  if (sensor) {
    const nextBattery = params.batteryPct ?? sensor.batteryPct;
    const updatedSensor: SensorNode = {
      ...sensor,
      batteryPct: nextBattery,
      status: nextBattery < 25 ? 'low_battery' : 'online',
      lastPingAt: nowIso,
    };
    sensors = sensors.map((s) => (s.id === sensor.id ? updatedSensor : s));
    broadcast('sensor:updated', updatedSensor);
  }

  broadcast('street:update', updatedStreet);

  // Trigger escalation or all-clear alert when level shifts
  let triggeredAlert: FloodAlert | null = null;
  if (evalRes.riskLevel !== prevLevel) {
    const levelOrder = { safe: 0, watch: 1, warning: 2, danger: 3 };
    if (levelOrder[evalRes.riskLevel] > levelOrder[prevLevel] && evalRes.riskLevel !== 'safe') {
      const alertLevel: AlertLevel = evalRes.riskLevel;
      const copy = formatAlertCopy({
        streetName: updatedStreet.name,
        streetNameTa: updatedStreet.nameTa,
        level: alertLevel,
        etaMinutes: updatedStreet.etaDangerMinutes,
        alternateRouteEn: updatedStreet.alternateRouteEn,
        alternateRouteTa: updatedStreet.alternateRouteTa,
      });
      triggeredAlert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        streetId: updatedStreet.id,
        streetName: updatedStreet.name,
        streetNameTa: updatedStreet.nameTa,
        level: alertLevel,
        titleEn: copy.titleEn,
        titleTa: copy.titleTa,
        messageEn: copy.messageEn,
        messageTa: copy.messageTa,
        alternateRouteEn: updatedStreet.alternateRouteEn,
        alternateRouteTa: updatedStreet.alternateRouteTa,
        etaMinutes: updatedStreet.etaDangerMinutes,
        channelsDispatched: alertLevel === 'danger' ? ['push', 'sms', 'whatsapp', 'email'] : ['push', 'sms'],
        isManual: false,
        createdAt: nowIso,
      };
    } else if (evalRes.riskLevel === 'safe' && levelOrder[prevLevel] >= 2) {
      const copy = formatAlertCopy({
        streetName: updatedStreet.name,
        streetNameTa: updatedStreet.nameTa,
        level: 'all_clear',
        etaMinutes: null,
        alternateRouteEn: updatedStreet.alternateRouteEn,
        alternateRouteTa: updatedStreet.alternateRouteTa,
      });
      triggeredAlert = {
        id: `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        streetId: updatedStreet.id,
        streetName: updatedStreet.name,
        streetNameTa: updatedStreet.nameTa,
        level: 'all_clear',
        titleEn: copy.titleEn,
        titleTa: copy.titleTa,
        messageEn: copy.messageEn,
        messageTa: copy.messageTa,
        alternateRouteEn: updatedStreet.alternateRouteEn,
        alternateRouteTa: updatedStreet.alternateRouteTa,
        etaMinutes: null,
        channelsDispatched: ['push', 'sms', 'email'],
        isManual: false,
        createdAt: nowIso,
      };
    }

    if (triggeredAlert) {
      alerts = [triggeredAlert, ...alerts].slice(0, 60);
      broadcast('alert:triggered', triggeredAlert);
    }
  }

  return { street: updatedStreet, alert: triggeredAlert };
}

// REST Endpoints
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, streetsCount: streets.length, sensorsCount: sensors.length });
});

app.get('/api/streets', (_req, res) => {
  res.json(streets);
});

app.get('/api/sensors', (_req, res) => {
  res.json(sensors);
});

app.get('/api/alerts', (_req, res) => {
  res.json(alerts);
});

app.get('/api/reports', (_req, res) => {
  res.json(reports);
});

app.get('/api/shelters', (_req, res) => {
  res.json(shelters);
});

app.get('/api/weather/forecast', async (_req, res) => {
  const forecast = await refreshWeatherForecast();
  res.json(forecast);
});

// Real IoT ESP32 Ingestion Endpoint
app.post('/api/sensors/ingest', (req, res) => {
  const { sensorId, streetId, waterLevelCm, rainfallMmHr, batteryPct } = req.body ?? {};
  if (typeof waterLevelCm !== 'number' || typeof rainfallMmHr !== 'number' || (!sensorId && !streetId)) {
    return res.status(400).json({
      error: 'Invalid telemetry payload. Required: sensorId (or streetId), waterLevelCm (number), rainfallMmHr (number).',
    });
  }
  const result = applySensorReading({
    sensorId: String(sensorId || ''),
    streetId: streetId ? String(streetId) : undefined,
    waterLevelCm: Math.max(0, Math.min(400, waterLevelCm)),
    rainfallMmHr: Math.max(0, Math.min(300, rainfallMmHr)),
    batteryPct: typeof batteryPct === 'number' ? Math.max(0, Math.min(100, batteryPct)) : undefined,
  });

  if (!result) {
    return res.status(404).json({ error: 'Sensor or street ID not registered.' });
  }
  return res.status(201).json(result);
});

// Realistic Heavy Rain Demo Simulator (shifts streets green -> yellow -> orange -> red)
app.post('/api/simulate/heavy-rain', (_req, res) => {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }

  simulationState = {
    active: true,
    tick: 1,
    maxTicks: 6,
    intensityLabel: 'Severe Monsoon Cloudburst (65–95 mm/hr)',
  };
  broadcast('simulation:status', simulationState);

  const runTick = () => {
    const targetMultipliers: Record<string, number> = {
      'anna-salai': 1.24,
      'velachery-main': 1.32,
      'madipakkam-koot': 1.28,
      'saidapet-jones': 1.18,
      'south-usman': 1.12,
      'kotturpuram-bridge': 0.96,
      'mylapore-luz': 0.88,
      'adyar-lb-road': 0.92,
    };

    for (const street of streets) {
      const mult = targetMultipliers[street.id] ?? 1.05;
      const stepWater = street.currentWaterCm + (11.5 + Math.random() * 4.5) * mult;
      const clampedWater = Math.min(street.drainDepthCm * 1.06, stepWater);
      const nextRain = Math.min(115, street.rainfallMmHr + 11.5 * mult);
      applySensorReading({
        sensorId: `esp32-${street.id}`,
        streetId: street.id,
        waterLevelCm: clampedWater,
        rainfallMmHr: nextRain,
      });
    }
  };

  runTick();

  simulationTimer = setInterval(() => {
    if (simulationState.tick >= simulationState.maxTicks) {
      if (simulationTimer) clearInterval(simulationTimer);
      simulationTimer = null;
      simulationState = { ...simulationState, active: false, intensityLabel: 'Peak Cloudburst Reached' };
      broadcast('simulation:status', simulationState);
      return;
    }
    simulationState = { ...simulationState, tick: simulationState.tick + 1 };
    broadcast('simulation:status', simulationState);
    runTick();
  }, 2200);

  res.json({ started: true, simulation: simulationState });
});

app.post('/api/simulate/reset', (_req, res) => {
  if (simulationTimer) {
    clearInterval(simulationTimer);
    simulationTimer = null;
  }
  const previousLevels = new Map(streets.map((s) => [s.id, s.riskLevel]));
  streets = createInitialStreets();
  sensors = createInitialSensors(streets);
  simulationState = {
    active: false,
    tick: 0,
    maxTicks: 6,
    intensityLabel: 'Nominal',
  };

  for (const street of streets) {
    const prev = previousLevels.get(street.id);
    if (prev === 'danger' || prev === 'warning') {
      const copy = formatAlertCopy({
        streetName: street.name,
        streetNameTa: street.nameTa,
        level: 'all_clear',
        etaMinutes: null,
        alternateRouteEn: street.alternateRouteEn,
        alternateRouteTa: street.alternateRouteTa,
      });
      const clearAlert: FloodAlert = {
        id: `alert-clear-${street.id}-${Date.now()}`,
        streetId: street.id,
        streetName: street.name,
        streetNameTa: street.nameTa,
        level: 'all_clear',
        titleEn: copy.titleEn,
        titleTa: copy.titleTa,
        messageEn: copy.messageEn,
        messageTa: copy.messageTa,
        alternateRouteEn: street.alternateRouteEn,
        alternateRouteTa: street.alternateRouteTa,
        etaMinutes: null,
        channelsDispatched: ['push', 'sms', 'email'],
        isManual: false,
        createdAt: new Date().toISOString(),
      };
      alerts = [clearAlert, ...alerts].slice(0, 60);
      broadcast('alert:triggered', clearAlert);
    }
  }

  broadcast('init:state', {
    streets,
    sensors,
    alerts,
    reports,
    shelters,
    simulation: simulationState,
    forecast: cachedForecast,
  });

  res.json({ reset: true, streets });
});

// Admin: Manual Alert Broadcast
app.post('/api/alerts/manual', (req, res) => {
  const { streetId, level, messageEn, messageTa, channels } = req.body ?? {};
  const street = streets.find((s) => s.id === streetId);
  if (!street || !messageEn) {
    return res.status(400).json({ error: 'Valid streetId and messageEn are required.' });
  }
  const alertLevel: AlertLevel = ['watch', 'warning', 'danger', 'all_clear'].includes(level) ? level : 'warning';
  const alert: FloodAlert = {
    id: `alert-manual-${Date.now()}`,
    streetId: street.id,
    streetName: street.name,
    streetNameTa: street.nameTa,
    level: alertLevel,
    titleEn: `Municipal Notice · ${street.name}`,
    titleTa: `நகராட்சி அறிவிப்பு · ${street.nameTa}`,
    messageEn: String(messageEn).slice(0, 500),
    messageTa: String(messageTa || messageEn).slice(0, 500),
    alternateRouteEn: street.alternateRouteEn,
    alternateRouteTa: street.alternateRouteTa,
    etaMinutes: street.etaDangerMinutes,
    channelsDispatched: Array.isArray(channels) && channels.length > 0 ? (channels as AlertChannel[]) : ['push', 'sms', 'email'],
    isManual: true,
    createdAt: new Date().toISOString(),
  };
  alerts = [alert, ...alerts].slice(0, 60);
  broadcast('alert:triggered', alert);
  res.status(201).json(alert);
});

// Admin: Add or Edit Street & Thresholds
app.post('/api/streets', (req, res) => {
  const { name, nameTa, area, lat, lng, drainDepthCm, watchPct, warningPct, dangerPct, alternateRouteEn } = req.body ?? {};
  if (!name || !area || typeof lat !== 'number' || typeof lng !== 'number') {
    return res.status(400).json({ error: 'Street name, area, lat, and lng are required.' });
  }
  const id = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const newStreet: Street = {
    id: streets.some((s) => s.id === id) ? `${id}-${Date.now().toString(36).slice(-4)}` : id,
    name: String(name),
    nameTa: String(nameTa || name),
    area: String(area),
    areaTa: String(area),
    coordinates: [
      [lat - 0.0025, lng - 0.0018],
      [lat, lng],
      [lat + 0.0025, lng + 0.0018],
    ],
    alternateRouteCoords: [
      [lat - 0.0025, lng - 0.0018],
      [lat - 0.001, lng + 0.0045],
      [lat + 0.0025, lng + 0.0018],
    ],
    alternateRouteEn: String(alternateRouteEn || 'Adjacent Arterial Bypass'),
    alternateRouteTa: String(alternateRouteEn || 'அருகிலுள்ள மாற்று சாலை'),
    drainDepthCm: Number(drainDepthCm) || 120,
    watchPct: Number(watchPct) || 50,
    warningPct: Number(warningPct) || 75,
    dangerPct: Number(dangerPct) || 90,
    rainIntensityThresholdMmHr: 35,
    currentWaterCm: 24,
    waterPct: 20,
    rainfallMmHr: 4,
    rainfall1hMm: 5,
    rainfall3hMm: 11,
    rainfall24hMm: 21,
    riskScore: 18,
    riskLevel: 'safe',
    trend: 'steady',
    rateOfRiseCmPerMin: 0,
    etaDangerMinutes: null,
    lastUpdated: new Date().toISOString(),
    history: [
      { timestamp: new Date(Date.now() - 30 * 60_000).toISOString(), waterLevelCm: 22, rainfallMmHr: 3.5, riskScore: 16 },
      { timestamp: new Date(Date.now() - 15 * 60_000).toISOString(), waterLevelCm: 23, rainfallMmHr: 4.0, riskScore: 17 },
      { timestamp: new Date().toISOString(), waterLevelCm: 24, rainfallMmHr: 4.0, riskScore: 18 },
    ],
    historicalEvents: [],
  };
  streets = [...streets, newStreet];

  const newSensor: SensorNode = {
    id: `esp32-${newStreet.id}`,
    streetId: newStreet.id,
    streetName: newStreet.name,
    hardwareType: 'ESP32-S3 + JSN-SR04T + TippingBucket',
    lat,
    lng,
    status: 'online',
    batteryPct: 100,
    firmwareVersion: 'v2.4.1',
    lastPingAt: new Date().toISOString(),
  };
  sensors = [...sensors, newSensor];

  broadcast('street:update', newStreet);
  broadcast('sensor:updated', newSensor);
  res.status(201).json({ street: newStreet, sensor: newSensor });
});

app.patch('/api/streets/:id', (req, res) => {
  const { id } = req.params;
  const idx = streets.findIndex((s) => s.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Street not found.' });

  const prev = streets[idx];
  const { drainDepthCm, watchPct, warningPct, dangerPct, rainIntensityThresholdMmHr, alternateRouteEn } = req.body ?? {};
  const merged: Street = {
    ...prev,
    drainDepthCm: typeof drainDepthCm === 'number' ? drainDepthCm : prev.drainDepthCm,
    watchPct: typeof watchPct === 'number' ? watchPct : prev.watchPct,
    warningPct: typeof warningPct === 'number' ? warningPct : prev.warningPct,
    dangerPct: typeof dangerPct === 'number' ? dangerPct : prev.dangerPct,
    rainIntensityThresholdMmHr:
      typeof rainIntensityThresholdMmHr === 'number' ? rainIntensityThresholdMmHr : prev.rainIntensityThresholdMmHr,
    alternateRouteEn: typeof alternateRouteEn === 'string' && alternateRouteEn.trim() ? alternateRouteEn : prev.alternateRouteEn,
  };

  const evalRes = evaluateStreetRisk({
    currentWaterCm: merged.currentWaterCm,
    drainDepthCm: merged.drainDepthCm,
    watchPct: merged.watchPct,
    warningPct: merged.warningPct,
    dangerPct: merged.dangerPct,
    rainfallMmHr: merged.rainfallMmHr,
    rainIntensityThresholdMmHr: merged.rainIntensityThresholdMmHr,
    recentHistory: merged.history,
    forecastNext3hMm: cachedForecast.next3hPrecipMm,
  });

  const updated: Street = {
    ...merged,
    ...evalRes,
    lastUpdated: new Date().toISOString(),
  };
  streets[idx] = updated;
  broadcast('street:update', updated);
  res.json(updated);
});

// Community Reports
app.post('/api/reports', (req, res) => {
  const { authorId, authorName, streetId, severity, description, photoUrl, lat, lng } = req.body ?? {};
  const street = streets.find((s) => s.id === streetId);
  if (!street || !description) {
    return res.status(400).json({ error: 'Valid streetId and description are required.' });
  }
  const mid = street.coordinates[Math.floor(street.coordinates.length / 2)];
  const nowIso = new Date().toISOString();
  const validSeverities: ReportSeverity[] = ['ankle', 'knee', 'waist', 'blocked_drain'];
  const report: CommunityReport = {
    id: `rep-${Date.now()}`,
    authorId: String(authorId || 'resident-guest'),
    authorName: String(authorName || 'Resident'),
    streetId: street.id,
    streetName: street.name,
    severity: validSeverities.includes(severity) ? severity : 'ankle',
    description: String(description).slice(0, 400),
    photoUrl: typeof photoUrl === 'string' && photoUrl.length > 0 ? photoUrl : undefined,
    lat: typeof lat === 'number' ? lat : mid[0],
    lng: typeof lng === 'number' ? lng : mid[1],
    status: 'unverified',
    confirmations: 1,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
  reports = [report, ...reports];
  broadcast('report:created', report);
  res.status(201).json(report);
});

app.patch('/api/reports/:id/verify', (req, res) => {
  const { id } = req.params;
  const { action } = req.body ?? {};
  const idx = reports.findIndex((r) => r.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Report not found.' });
  const prev = reports[idx];
  const nowIso = new Date().toISOString();
  let updated: CommunityReport;

  if (action === 'confirm') {
    const nextConfirmations = prev.confirmations + 1;
    updated = {
      ...prev,
      confirmations: nextConfirmations,
      status: nextConfirmations >= 3 && prev.status === 'unverified' ? 'verified' : prev.status,
      updatedAt: nowIso,
    };
  } else if (action === 'verify') {
    updated = { ...prev, status: 'verified', updatedAt: nowIso };
  } else if (action === 'resolve') {
    updated = { ...prev, status: 'resolved', updatedAt: nowIso };
  } else {
    return res.status(400).json({ error: 'Unsupported action.' });
  }

  reports[idx] = updated;
  broadcast('report:updated', updated);
  res.json(updated);
});

async function startServer() {
  await refreshWeatherForecast();

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false, ws: { server, path: '/vite-hmr' } },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`StreetFlood Alert server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
