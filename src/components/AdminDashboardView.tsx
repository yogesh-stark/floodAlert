import React, { useState } from 'react';
import { Activity, Battery, Check, Copy, Cpu, Plus, Send, Sliders } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { AlertChannel, AlertLevel, FloodAlert, Language, SensorNode, Street } from '../types/flood.ts';
import { RiskStatusLabel } from './RiskBadge.tsx';

interface AdminDashboardViewProps {
  streets: Street[];
  sensors: SensorNode[];
  alerts: FloodAlert[];
  lang: Language;
}

const ESP32_SNIPPET = `// StreetFlood Alert — ESP32 + JSN-SR04T Ultrasonic + Tipping-Bucket Rain Gauge
#include <WiFi.h>
#include <HTTPClient.h>

const char* SSID = "YOUR_MUNICIPAL_WIFI";
const char* PASSWORD = "YOUR_WIFI_PASSWORD";
const char* API_URL = "https://YOUR_APP_HOST/api/sensors/ingest";
const char* SENSOR_ID = "esp32-anna-salai";
const float DRAIN_MOUNT_HEIGHT_CM = 150.0;

volatile unsigned int rainTips = 0;
void IRAM_ATTR onRainTip() { rainTips++; } // 0.2mm per bucket tip

float readUltrasonicDistanceCm() {
  digitalWrite(5, LOW); delayMicroseconds(2);
  digitalWrite(5, HIGH); delayMicroseconds(10);
  digitalWrite(5, LOW);
  long duration = pulseIn(18, HIGH, 30000);
  return (duration * 0.0343) / 2.0;
}

void setup() {
  Serial.begin(115200);
  pinMode(5, OUTPUT); pinMode(18, INPUT);
  attachInterrupt(digitalPinToInterrupt(19), onRainTip, FALLING);
  WiFi.begin(SSID, PASSWORD);
  while (WiFi.status() != WL_CONNECTED) delay(500);
}

void loop() {
  float airGapCm = readUltrasonicDistanceCm();
  float waterLevelCm = max(0.0f, DRAIN_MOUNT_HEIGHT_CM - airGapCm);
  float rainfallMmHr = rainTips * 0.2 * 60.0; // scaled from 60s window
  rainTips = 0;

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(API_URL);
    http.addHeader("Content-Type", "application/json");
    String json = "{\\"sensorId\\":\\"" + String(SENSOR_ID) +
                  "\\",\\"waterLevelCm\\":" + String(waterLevelCm, 1) +
                  ",\\"rainfallMmHr\\":" + String(rainfallMmHr, 1) +
                  ",\\"batteryPct\\":92}";
    int code = http.POST(json);
    Serial.printf("Ingest HTTP %d\\n", code);
    http.end();
  }
  delay(60000); // Send telemetry every 60 seconds
}`;

export const AdminDashboardView: React.FC<AdminDashboardViewProps> = ({ streets, sensors, alerts, lang }) => {
  const [editingStreetId, setEditingStreetId] = useState<string>(streets[0]?.id || '');
  const selectedEditStreet = streets.find((s) => s.id === editingStreetId) ?? streets[0];

  const [watchPct, setWatchPct] = useState<number>(selectedEditStreet?.watchPct ?? 50);
  const [warningPct, setWarningPct] = useState<number>(selectedEditStreet?.warningPct ?? 75);
  const [dangerPct, setDangerPct] = useState<number>(selectedEditStreet?.dangerPct ?? 90);
  const [drainDepthCm, setDrainDepthCm] = useState<number>(selectedEditStreet?.drainDepthCm ?? 120);
  const [thresholdMsg, setThresholdMsg] = useState<string | null>(null);

  // Add street form state
  const [newStreetName, setNewStreetName] = useState('');
  const [newArea, setNewArea] = useState('');
  const [newLat, setNewLat] = useState('13.045');
  const [newLng, setNewLng] = useState('80.245');
  const [newAltRoute, setNewAltRoute] = useState('');
  const [addStreetMsg, setAddStreetMsg] = useState<string | null>(null);

  // Manual alert broadcast state
  const [manualStreetId, setManualStreetId] = useState<string>(streets[0]?.id || 'anna-salai');
  const [manualLevel, setManualLevel] = useState<AlertLevel>('warning');
  const [manualMsgEn, setManualMsgEn] = useState('');
  const [manualMsgTa, setManualMsgTa] = useState('');
  const [broadcastFeedback, setBroadcastFeedback] = useState<string | null>(null);

  // ESP32 test ingestion
  const [copiedCode, setCopiedCode] = useState(false);
  const [ingestFeedback, setIngestFeedback] = useState<string | null>(null);

  const handleSelectEditStreet = (id: string) => {
    setEditingStreetId(id);
    const st = streets.find((s) => s.id === id);
    if (st) {
      setWatchPct(st.watchPct);
      setWarningPct(st.warningPct);
      setDangerPct(st.dangerPct);
      setDrainDepthCm(st.drainDepthCm);
    }
    setThresholdMsg(null);
  };

  const handleSaveThresholds = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEditStreet) return;
    const resp = await fetch(`/api/streets/${selectedEditStreet.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ watchPct, warningPct, dangerPct, drainDepthCm }),
    });
    setThresholdMsg(resp.ok ? `Thresholds updated for ${selectedEditStreet.name}.` : 'Failed to update thresholds.');
  };

  const handleAddStreet = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStreetName.trim() || !newArea.trim()) return;
    const resp = await fetch('/api/streets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: newStreetName.trim(),
        area: newArea.trim(),
        lat: Number(newLat) || 13.045,
        lng: Number(newLng) || 80.245,
        alternateRouteEn: newAltRoute.trim() || 'Adjacent Arterial Road',
      }),
    });
    if (resp.ok) {
      setNewStreetName('');
      setNewArea('');
      setNewAltRoute('');
      setAddStreetMsg('Street and ESP32 sensor node added and live on map.');
    }
  };

  const handleManualBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualMsgEn.trim()) return;
    const channels: AlertChannel[] = ['push', 'sms', 'email'];
    const resp = await fetch('/api/alerts/manual', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        streetId: manualStreetId,
        level: manualLevel,
        messageEn: manualMsgEn.trim(),
        messageTa: manualMsgTa.trim() || manualMsgEn.trim(),
        channels,
      }),
    });
    if (resp.ok) {
      setManualMsgEn('');
      setManualMsgTa('');
      setBroadcastFeedback('Emergency notice broadcasted via WebSocket, Push, and SMS log.');
    }
  };

  const handleTestIngest = async () => {
    const target = streets[0];
    if (!target) return;
    const resp = await fetch('/api/sensors/ingest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sensorId: `esp32-${target.id}`,
        waterLevelCm: Math.min(target.drainDepthCm, target.currentWaterCm + 18),
        rainfallMmHr: target.rainfallMmHr + 22,
        batteryPct: 88,
      }),
    });
    if (resp.ok) {
      setIngestFeedback(`Ingested test reading for esp32-${target.id} (+18 cm water, +22 mm/hr rain).`);
    }
  };

  const copySnippet = () => {
    navigator.clipboard.writeText(ESP32_SNIPPET);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Analytics data
  const telemetryComparison = streets.map((s) => ({
    name: s.area,
    waterPct: s.waterPct,
    rainfallMmHr: s.rainfallMmHr,
  }));

  const alertCountsData = [
    { level: 'Watch', count: alerts.filter((a) => a.level === 'watch').length },
    { level: 'Warning', count: alerts.filter((a) => a.level === 'warning').length },
    { level: 'Danger', count: alerts.filter((a) => a.level === 'danger').length },
    { level: 'All Clear', count: alerts.filter((a) => a.level === 'all_clear').length },
  ];

  const historicalPeakData = streets
    .filter((s) => s.historicalEvents.length > 0)
    .map((s) => ({
      street: s.area,
      peakCm: Math.max(...s.historicalEvents.map((e) => e.peakWaterCm)),
    }));

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div>
        <h2 className="font-display text-2xl font-bold text-slate-900">Municipal Admin & Sensor Operations</h2>
        <p className="mt-1 text-sm text-slate-600">
          Monitor ESP32 drain sensor health, tune street risk thresholds, broadcast emergency alerts, and inspect telemetry analytics.
        </p>
      </div>

      {/* Charts Row */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-sm font-bold text-slate-900">Drain Fill (%) vs Rain Intensity (mm/hr)</h3>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={telemetryComparison} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="waterPct" name="Drain %" stroke="#0F4C81" strokeWidth={2} />
                <Line type="monotone" dataKey="rainfallMmHr" name="Rain mm/hr" stroke="#D97706" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-sm font-bold text-slate-900">Alerts Dispatched by Severity</h3>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={alertCountsData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="level" tick={{ fontSize: 11 }} />
                <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="count" name="Alerts Sent" fill="#0F4C81" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-display text-sm font-bold text-slate-900">Historical Peak Flood Depth (cm)</h3>
          <div className="mt-3 h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={historicalPeakData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="street" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <Tooltip />
                <Bar dataKey="peakCm" name="Peak Water (cm)" fill="#B91C1C" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Sensor Health Table */}
      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-[#0F4C81]" />
            <h3 className="font-display text-base font-bold text-slate-900">IoT Sensor Network Health</h3>
          </div>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {sensors.filter((s) => s.status === 'online').length} online ·{' '}
            {sensors.filter((s) => s.status === 'low_battery').length} low battery ·{' '}
            {sensors.filter((s) => s.status === 'offline').length} offline
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-5 py-3 font-semibold">Sensor ID</th>
                <th className="px-5 py-3 font-semibold">Street</th>
                <th className="px-5 py-3 font-semibold">Street Status</th>
                <th className="px-5 py-3 font-semibold">Node State</th>
                <th className="px-5 py-3 font-semibold text-right">Battery</th>
                <th className="px-5 py-3 font-semibold text-right">Firmware</th>
                <th className="px-5 py-3 font-semibold text-right">Last Ping</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sensors.map((sensor) => {
                const st = streets.find((s) => s.id === sensor.streetId);
                return (
                  <tr key={sensor.id} className="hover:bg-slate-50/80">
                    <td className="px-5 py-3 font-mono font-medium text-slate-900">{sensor.id}</td>
                    <td className="px-5 py-3 text-slate-700">{sensor.streetName}</td>
                    <td className="px-5 py-3">
                      {st ? <RiskStatusLabel level={st.riskLevel} lang={lang} compact /> : '—'}
                    </td>
                    <td className="px-5 py-3 font-medium">
                      <span
                        className={
                          sensor.status === 'online'
                            ? 'text-emerald-700'
                            : sensor.status === 'low_battery'
                              ? 'text-amber-700'
                              : 'text-red-700'
                        }
                      >
                        {sensor.status === 'online'
                          ? 'Online'
                          : sensor.status === 'low_battery'
                            ? 'Low Battery'
                            : 'Offline'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-800">
                      <Battery className="mr-1 inline h-3.5 w-3.5 text-slate-400" />
                      {sensor.batteryPct}%
                    </td>
                    <td className="px-5 py-3 text-right font-mono text-slate-600">{sensor.firmwareVersion}</td>
                    <td className="px-5 py-3 text-right font-mono tabular-nums text-slate-500">
                      {new Date(sensor.lastPingAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Admin Controls: Thresholds, Manual Broadcast, Add Street */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Threshold Editor */}
        <form onSubmit={handleSaveThresholds} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-4">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-[#0F4C81]" />
            <h3 className="font-display text-base font-bold text-slate-900">Edit Street Thresholds</h3>
          </div>

          <div>
            <label htmlFor="thresh-street" className="block text-xs font-semibold text-slate-700">
              Select Street
            </label>
            <select
              id="thresh-street"
              value={editingStreetId}
              onChange={(e) => handleSelectEditStreet(e.target.value)}
              className="mt-1 h-10 w-full rounded-xl border border-slate-300 bg-white px-3 text-xs font-medium text-slate-900"
            >
              {streets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="th-depth" className="block text-[11px] font-semibold text-slate-600">
                Drain Depth (cm)
              </label>
              <input
                id="th-depth"
                type="number"
                value={drainDepthCm}
                onChange={(e) => setDrainDepthCm(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="th-watch" className="block text-[11px] font-semibold text-slate-600">
                Watch (%)
              </label>
              <input
                id="th-watch"
                type="number"
                value={watchPct}
                onChange={(e) => setWatchPct(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="th-warn" className="block text-[11px] font-semibold text-slate-600">
                Warning (%)
              </label>
              <input
                id="th-warn"
                type="number"
                value={warningPct}
                onChange={(e) => setWarningPct(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
              />
            </div>
            <div>
              <label htmlFor="th-danger" className="block text-[11px] font-semibold text-slate-600">
                Danger (%)
              </label>
              <input
                id="th-danger"
                type="number"
                value={dangerPct}
                onChange={(e) => setDangerPct(Number(e.target.value))}
                className="mt-1 h-10 w-full rounded-lg border border-slate-300 px-2.5 font-mono text-xs"
              />
            </div>
          </div>

          {thresholdMsg && <p className="text-xs font-medium text-emerald-800">{thresholdMsg}</p>}

          <button
            type="submit"
            className="min-h-[42px] w-full rounded-xl bg-[#0F4C81] text-xs font-semibold text-white hover:bg-[#0c3c66]"
          >
            Save Thresholds
          </button>
        </form>

        {/* Manual Emergency Broadcast */}
        <form onSubmit={handleManualBroadcast} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3.5">
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 text-[#0F4C81]" />
            <h3 className="font-display text-base font-bold text-slate-900">Send Manual Notice</h3>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <select
              value={manualStreetId}
              onChange={(e) => setManualStreetId(e.target.value)}
              aria-label="Target street"
              className="h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-medium"
            >
              {streets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <select
              value={manualLevel}
              onChange={(e) => setManualLevel(e.target.value as AlertLevel)}
              aria-label="Notice severity"
              className="h-10 rounded-xl border border-slate-300 bg-white px-2.5 text-xs font-medium"
            >
              <option value="watch">Watch</option>
              <option value="warning">Warning</option>
              <option value="danger">Danger</option>
              <option value="all_clear">All Clear</option>
            </select>
          </div>

          <textarea
            rows={2}
            required
            value={manualMsgEn}
            onChange={(e) => setManualMsgEn(e.target.value)}
            placeholder="English emergency message..."
            className="w-full rounded-xl border border-slate-300 p-2.5 text-xs"
          />
          <textarea
            rows={2}
            value={manualMsgTa}
            onChange={(e) => setManualMsgTa(e.target.value)}
            placeholder="Tamil message (optional)..."
            className="w-full rounded-xl border border-slate-300 p-2.5 text-xs"
          />

          {broadcastFeedback && <p className="text-xs font-medium text-emerald-800">{broadcastFeedback}</p>}

          <button
            type="submit"
            className="min-h-[42px] w-full rounded-xl bg-slate-900 text-xs font-semibold text-white hover:bg-slate-800"
          >
            Broadcast Emergency Alert
          </button>
        </form>

        {/* Add Street & Sensor */}
        <form onSubmit={handleAddStreet} className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Plus className="h-4 w-4 text-[#0F4C81]" />
            <h3 className="font-display text-base font-bold text-slate-900">Register Street & Sensor</h3>
          </div>

          <input
            type="text"
            required
            value={newStreetName}
            onChange={(e) => setNewStreetName(e.target.value)}
            placeholder="Street name (e.g. Perambur Paper Mills Rd)"
            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs"
          />
          <input
            type="text"
            required
            value={newArea}
            onChange={(e) => setNewArea(e.target.value)}
            placeholder="Neighborhood / Zone (e.g. Perambur)"
            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={newLat}
              onChange={(e) => setNewLat(e.target.value)}
              placeholder="Latitude (13.045)"
              className="h-10 rounded-xl border border-slate-300 px-3 font-mono text-xs"
            />
            <input
              type="text"
              value={newLng}
              onChange={(e) => setNewLng(e.target.value)}
              placeholder="Longitude (80.245)"
              className="h-10 rounded-xl border border-slate-300 px-3 font-mono text-xs"
            />
          </div>
          <input
            type="text"
            value={newAltRoute}
            onChange={(e) => setNewAltRoute(e.target.value)}
            placeholder="Alternate safe route description"
            className="h-10 w-full rounded-xl border border-slate-300 px-3 text-xs"
          />

          {addStreetMsg && <p className="text-xs font-medium text-emerald-800">{addStreetMsg}</p>}

          <button
            type="submit"
            className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-slate-50 text-xs font-semibold text-slate-900 hover:bg-slate-100"
          >
            Add Street & Provision Sensor
          </button>
        </form>
      </div>

      {/* ESP32 Sensor REST API Documentation & Arduino Code Snippet */}
      <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Cpu className="h-5 w-5 text-[#0F4C81]" />
              <h3 className="font-display text-lg font-bold text-slate-900">
                IoT Sensor Ingestion API & ESP32 Firmware Snippet
              </h3>
            </div>
            <p className="mt-1 text-xs text-slate-600">
              Endpoint: <code className="font-mono font-semibold text-slate-900">POST /api/sensors/ingest</code> · Payload:{' '}
              <code className="font-mono text-slate-700">{'{ sensorId, waterLevelCm, rainfallMmHr, batteryPct }'}</code>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleTestIngest}
              className="min-h-[40px] rounded-xl bg-[#0F4C81] px-3.5 text-xs font-semibold text-white hover:bg-[#0c3c66]"
            >
              Send Live Test Ping
            </button>
            <button
              type="button"
              onClick={copySnippet}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
            >
              {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-700" /> : <Copy className="h-3.5 w-3.5" />}
              <span>{copiedCode ? 'Copied' : 'Copy Arduino Code'}</span>
            </button>
          </div>
        </div>

        {ingestFeedback && (
          <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-medium text-emerald-900">
            {ingestFeedback}
          </div>
        )}

        <pre className="mt-4 max-h-80 overflow-x-auto rounded-xl bg-slate-950 p-4 font-mono text-xs leading-relaxed text-slate-100">
          <code>{ESP32_SNIPPET}</code>
        </pre>
      </section>
    </div>
  );
};
