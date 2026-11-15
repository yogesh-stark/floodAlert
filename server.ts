import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { type LiveServerMessage, Modality } from '@google/genai';
import { getGeminiClient } from './server/geminiClient.ts';
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
  WeatherCondition,
  WeatherForecast,
} from './src/types/flood.ts';

const PORT = 3000;

function formatGeminiError(err: unknown, fallback: string): { status: number; message: string; isQuota: boolean } {
  const raw = err instanceof Error ? err.message : String(err || fallback);
  const isQuota = /RESOURCE_EXHAUSTED|PERMISSION_DENIED|429|403|quota|rate-limit|billing|paid/i.test(raw);
  if (isQuota) {
    return {
      status: 429,
      message:
        'Gemini API free-tier quota is temporarily exhausted. Add a billing-enabled GEMINI_API_KEY in Settings > Secrets to restore Search, Maps Grounding, Live Voice, and AI Image Studio.',
      isQuota: true,
    };
  }
  return {
    status: 500,
    message: raw.length > 260 ? fallback : raw,
    isQuota: false,
  };
}

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
function mapWmoToCondition(weatherCode: number | undefined, currentPrecipMm: number, next3hPrecipMm: number): WeatherCondition {
  if (typeof weatherCode === 'number') {
    if (weatherCode >= 95) return 'thunderstorm';
    if (weatherCode === 65 || weatherCode === 82 || weatherCode === 67) return 'heavy_rain';
    if ((weatherCode >= 51 && weatherCode <= 63) || (weatherCode >= 80 && weatherCode <= 81)) return 'rainy';
    if (weatherCode === 3 || weatherCode === 45 || weatherCode === 48) return 'cloudy';
    if (weatherCode === 1 || weatherCode === 2) return 'partly_cloudy';
    if (weatherCode === 0) return 'sunny';
  }
  if (currentPrecipMm >= 12 || next3hPrecipMm >= 30) return 'thunderstorm';
  if (currentPrecipMm >= 5 || next3hPrecipMm >= 16) return 'heavy_rain';
  if (currentPrecipMm >= 0.5 || next3hPrecipMm >= 2) return 'rainy';
  return 'partly_cloudy';
}

let cachedForecast: WeatherForecast = {
  city: 'Chennai, IN',
  condition: 'rainy',
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
      'https://api.open-meteo.com/v1/forecast?latitude=13.0827&longitude=80.2707&hourly=precipitation,precipitation_probability&current=temperature_2m,precipitation,weather_code&forecast_days=1',
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!resp.ok) return cachedForecast;
    const data = (await resp.json()) as {
      current?: { temperature_2m?: number; precipitation?: number; weather_code?: number };
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
    const currentPrecipMm = Number((data.current?.precipitation ?? 0).toFixed(1));
    const next3hPrecipMm = Number(
      next6
        .slice(0, 3)
        .reduce((acc, item) => acc + item.precipMm, 0)
        .toFixed(1)
    );
    const condition = simulationState.active
      ? 'thunderstorm'
      : mapWmoToCondition(data.current?.weather_code, currentPrecipMm, next3hPrecipMm);
    cachedForecast = {
      city: 'Chennai, IN',
      condition,
      currentTempC: Number((data.current?.temperature_2m ?? 28).toFixed(1)),
      currentPrecipMm,
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
app.use(express.json({ limit: '12mb' }));

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
const liveWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const reqUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  if (reqUrl.pathname === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else if (reqUrl.pathname === '/ws-live') {
    liveWss.handleUpgrade(request, socket, head, (ws) => {
      liveWss.emit('connection', ws, request);
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

liveWss.on('connection', async (clientWs, req) => {
  const reqUrl = new URL(req.url || '/ws-live', `http://${req.headers.host || 'localhost'}`);
  const lang = reqUrl.searchParams.get('lang') === 'ta' ? 'ta' : 'en';
  const voiceName = reqUrl.searchParams.get('voice') || 'Zephyr';

  let session: Awaited<ReturnType<ReturnType<typeof getGeminiClient>['live']['connect']>> | null = null;
  let closed = false;

  const streetSummary = streets
    .map(
      (s) =>
        `- ${s.name} (${s.area}): ${s.riskLevel.toUpperCase()}, water ${s.currentWaterCm}/${s.drainDepthCm} cm (${s.waterPct}%), rain ${s.rainfallMmHr} mm/hr${s.etaDangerMinutes !== null ? `, danger ETA ~${s.etaDangerMinutes} min` : ''}, alternate route: ${s.alternateRouteEn}`
    )
    .join('\n');

  const systemInstruction = `You are the StreetFlood Alert live emergency & neighborhood flood voice assistant for Chennai residents and volunteers.
Keep responses calm, clear, concise (2-4 spoken sentences unless asked for details), and action-oriented.
Speak primarily in ${lang === 'ta' ? 'Tamil (தமிழ்)' : 'English'}, or match whichever language the caller speaks.
Current live street drain & rain telemetry right now:
${streetSummary}

Nearby high-ground relief shelters:
${shelters.map((sh) => `- ${sh.name} (${sh.address}, ${sh.elevationStatus}, Tel: ${sh.phone})`).join('\n')}

Always remind callers not to drive or walk through waist-deep flowing floodwater and to stay clear of downed electrical poles.`;

  try {
    const ai = getGeminiClient();
    session = await ai.live.connect({
      model: 'gemini-3.8-live',
      config: {
        responseModalities: [Modality.AUDIO],
        speechConfig: {
          voiceConfig: { prebuiltVoiceConfig: { voiceName } },
        },
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction,
      },
      callbacks: {
        onopen: () => {
          if (!closed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ status: 'connected' }));
          }
        },
        onmessage: (message: LiveServerMessage) => {
          if (closed || clientWs.readyState !== WebSocket.OPEN) return;
          const content = message.serverContent;
          if (content?.inputTranscription?.text) {
            clientWs.send(JSON.stringify({ inputTranscript: content.inputTranscription.text }));
          }
          if (content?.outputTranscription?.text) {
            clientWs.send(JSON.stringify({ outputTranscript: content.outputTranscription.text }));
          }
          for (const part of content?.modelTurn?.parts ?? []) {
            if (part.inlineData?.data) {
              clientWs.send(JSON.stringify({ audio: part.inlineData.data }));
            }
          }
          if (content?.turnComplete) {
            clientWs.send(JSON.stringify({ turnComplete: true }));
          }
          if (content?.interrupted) {
            clientWs.send(JSON.stringify({ interrupted: true }));
          }
        },
        onerror: (err: unknown) => {
          if (!closed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(
              JSON.stringify({
                error: formatGeminiError(err, 'Live voice stream encountered an error.').message,
              })
            );
          }
        },
        onclose: () => {
          if (!closed && clientWs.readyState === WebSocket.OPEN) {
            clientWs.send(JSON.stringify({ status: 'closed' }));
          }
        },
      },
    });
  } catch (err: unknown) {
    if (clientWs.readyState === WebSocket.OPEN) {
      clientWs.send(
        JSON.stringify({
          error: formatGeminiError(
            err,
            'Unable to initialize Gemini Live voice session. Verify GEMINI_API_KEY in Settings > Secrets.'
          ).message,
        })
      );
      clientWs.close();
    }
    return;
  }

  clientWs.on('message', (raw) => {
    if (!session || closed) return;
    try {
      const msg = JSON.parse(raw.toString()) as { audio?: string; text?: string };
      if (msg.audio) {
        session.sendRealtimeInput({
          audio: { data: msg.audio, mimeType: 'audio/pcm;rate=16000' },
        });
      } else if (msg.text) {
        session.sendRealtimeInput({
          text: msg.text,
        });
      }
    } catch {
      // Ignore malformed client message
    }
  });

  clientWs.on('close', () => {
    closed = true;
    try {
      session?.close();
    } catch {
      // Ignore session close error
    }
  });
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
  cachedForecast = {
    ...cachedForecast,
    condition: 'thunderstorm',
    currentPrecipMm: Math.max(cachedForecast.currentPrecipMm, 18.4),
    next3hPrecipMm: Math.max(cachedForecast.next3hPrecipMm, 34.0),
    fetchedAt: new Date().toISOString(),
  };
  broadcast('simulation:status', simulationState);
  broadcast('forecast:update', cachedForecast);

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
  cachedForecast = {
    ...cachedForecast,
    condition: mapWmoToCondition(undefined, 4.2, 14.5),
    currentPrecipMm: 4.2,
    next3hPrecipMm: 14.5,
    fetchedAt: new Date().toISOString(),
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

// Provisioned Google Maps API key config bridge (reads injected env var on server when Vite build-time var isn't set)
app.get('/api/config/maps', (_req, res) => {
  const key = process.env.VITE_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY || '';
  res.json({ mapsApiKey: key });
});

// AI: Live Weather & Civic Flood Advisories via Google Search Grounding
app.post('/api/ai/search', async (req, res) => {
  const { query, lang } = req.body ?? {};
  const userQuery = typeof query === 'string' && query.trim()
    ? query.trim().slice(0, 600)
    : 'Latest Chennai IMD monsoon rainfall alert, Adyar and Velachery flood waterlogging updates today';

  try {
    const ai = getGeminiClient();
    const activeDanger = streets
      .filter((s) => s.riskLevel === 'danger' || s.riskLevel === 'warning')
      .map((s) => `${s.name} (${s.waterPct}% drain full, ${s.rainfallMmHr} mm/hr)`)
      .join('; ');

    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: `Current local StreetFlood telemetry alerts: ${activeDanger || 'No streets currently above Warning threshold'}.\nUser query: ${userQuery}`,
      config: {
        systemInstruction: `You are a civic flood intelligence analyst for Chennai, India. Answer in ${
          lang === 'ta' ? 'Tamil (தமிழ்)' : 'clear, concise English'
        }. Synthesize verified web/weather bulletins cleanly in Markdown bullet points and relate them to street safety.`,
        tools: [{ googleSearch: {} }],
      },
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const sources = rawChunks
      .map((chunk) => chunk.web)
      .filter((w): w is { uri: string; title?: string } => Boolean(w?.uri))
      .map((w) => ({ uri: w.uri, title: w.title || w.uri }));

    res.json({
      text: response.text ?? '',
      sources,
    });
  } catch (err: unknown) {
    const formatted = formatGeminiError(err, 'Search grounding request failed.');
    res.status(formatted.status).json({ error: formatted.message, requiresPaidKey: formatted.isQuota });
  }
});

// AI: Nearby Shelters, Hospitals & Safe Zones via Google Maps Grounding
app.post('/api/ai/maps-grounding', async (req, res) => {
  const { query, lat, lng, lang } = req.body ?? {};
  const userQuery =
    typeof query === 'string' && query.trim()
      ? query.trim().slice(0, 500)
      : 'Find emergency hospitals, elevated public shelters, and 24-hour pharmacies near this location';
  const latitude = typeof lat === 'number' && Number.isFinite(lat) ? lat : 13.0355;
  const longitude = typeof lng === 'number' && Number.isFinite(lng) ? lng : 80.2298;

  try {
    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: 'gemini-4-hydrogen',
      contents: userQuery,
      config: {
        systemInstruction: `You are helping a commuter find safe nearby facilities during heavy rain. Respond in clear Markdown in ${
          lang === 'ta' ? 'Tamil (தமிழ்)' : 'English'
        } and highlight access roads, hours, or emergency readiness when available.`,
        tools: [{ googleMaps: {} }],
        toolConfig: {
          retrievalConfig: {
            latLng: {
              latitude,
              longitude,
            },
          },
        },
      },
    });

    const rawChunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    const places = rawChunks
      .map((chunk) => chunk.maps)
      .filter((m): m is NonNullable<typeof m> => Boolean(m?.uri || m?.title))
      .map((m) => ({
        title: m.title || 'Google Maps Place',
        uri: m.uri || '',
        placeId: m.placeId || '',
        snippets:
          m.placeAnswerSources?.reviewSnippets
            ?.map((s) => ({
              text: s.reviewId ? `${s.googleMapsUri || ''}` : '',
              uri: s.googleMapsUri || '',
            }))
            .filter((s) => s.uri) ?? [],
      }));

    res.json({
      text: response.text ?? '',
      places,
    });
  } catch (err: unknown) {
    const formatted = formatGeminiError(err, 'Google Maps grounding request failed.');
    res.status(formatted.status).json({ error: formatted.message, requiresPaidKey: formatted.isQuota });
  }
});

// AI: Flood Preparedness Visuals & Photo Hazard Editing (gemini-nano-banana-2.1)
app.post('/api/ai/image', async (req, res) => {
  const { prompt, imageBase64, mimeType, aspectRatio, imageSize, useSearchGrounding } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim()) {
    return res.status(400).json({ error: 'A prompt is required to generate or edit an image.' });
  }

  try {
    const ai = getGeminiClient();
    const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];

    if (typeof imageBase64 === 'string' && imageBase64.length > 0) {
      const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
      parts.push({
        inlineData: {
          data: cleanBase64,
          mimeType: typeof mimeType === 'string' && mimeType.startsWith('image/') ? mimeType : 'image/png',
        },
      });
    }
    parts.push({ text: prompt.trim().slice(0, 1200) });

    const validAspects = ['1:1', '3:4', '4:3', '9:16', '16:9', '1:4', '1:8', '4:1', '8:1'];
    const validSizes = ['1K', '2K', '4K'];

    const response = await ai.models.generateContent({
      model: 'gemini-nano-banana-2.1',
      contents: { parts },
      config: {
        imageConfig: {
          aspectRatio: validAspects.includes(aspectRatio) ? aspectRatio : '16:9',
          imageSize: validSizes.includes(imageSize) ? imageSize : '1K',
        },
        ...(useSearchGrounding && !imageBase64
          ? {
              tools: [
                {
                  googleSearch: {
                    searchTypes: {
                      webSearch: {},
                      imageSearch: {},
                    },
                  },
                },
              ],
            }
          : {}),
      },
    });

    let imageUrl: string | null = null;
    let textNote = '';
    for (const part of response.candidates?.[0]?.content?.parts ?? []) {
      if (part.inlineData?.data) {
        const mime = part.inlineData.mimeType ?? 'image/png';
        imageUrl = `data:${mime};base64,${part.inlineData.data}`;
      } else if (part.text) {
        textNote += `${part.text}\n`;
      }
    }

    if (!imageUrl) {
      return res.status(502).json({
        error: textNote.trim() || 'Model returned text without an image output.',
      });
    }

    return res.json({ imageUrl, text: textNote.trim() });
  } catch (err: unknown) {
    const rawMsg = err instanceof Error ? err.message : 'Image generation failed.';
    const isQuotaOrBilling =
      /RESOURCE_EXHAUSTED|PERMISSION_DENIED|429|403|billing|paid|quota/i.test(rawMsg);
    return res.status(isQuotaOrBilling ? 402 : 500).json({
      error: isQuotaOrBilling
        ? 'High-resolution AI image generation requires a billing-enabled Gemini API key in Settings > Secrets. You can still use the built-in Photo Hazard Annotator below.'
        : rawMsg,
      requiresPaidKey: isQuotaOrBilling,
    });
  }
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
