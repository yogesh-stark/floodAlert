import React, { useState } from 'react';
import { Bell, BellRing, Check, Compass, Mail, MessageSquare, PhoneCall, Shield } from 'lucide-react';
import { ASSETS, resolveReportPhoto } from '../lib/assets.ts';
import type {
  AlertChannel,
  FloodAlert,
  Language,
  ReliefShelter,
  Street,
  StreetSubscription,
} from '../types/flood.ts';
import { AlertLevelLabel, RiskStatusLabel } from './RiskBadge.tsx';

interface AlertsRoutesViewProps {
  streets: Street[];
  alerts: FloodAlert[];
  shelters: ReliefShelter[];
  subscriptions: StreetSubscription[];
  onToggleSubscribe: (street: Street, channels?: AlertChannel[], radiusMeters?: number) => void;
  onSelectStreetOnMap: (streetId: string) => void;
  lang: Language;
}

export const AlertsRoutesView: React.FC<AlertsRoutesViewProps> = ({
  streets,
  alerts,
  shelters,
  subscriptions,
  onToggleSubscribe,
  onSelectStreetOnMap,
  lang,
}) => {
  const [filter, setFilter] = useState<'all' | 'urgent' | 'all_clear'>('all');
  const [selectedChannels, setSelectedChannels] = useState<AlertChannel[]>(['push', 'sms', 'email']);
  const [radiusMeters, setRadiusMeters] = useState(500);
  const [pushStatus, setPushStatus] = useState<string>(
    typeof Notification !== 'undefined' ? Notification.permission : 'unsupported'
  );

  const requestPushPermission = async () => {
    if (typeof Notification === 'undefined') return;
    const perm = await Notification.requestPermission();
    setPushStatus(perm);
  };

  const toggleChannel = (ch: AlertChannel) => {
    setSelectedChannels((prev) => {
      if (prev.includes(ch)) {
        return prev.length > 1 ? prev.filter((c) => c !== ch) : prev;
      }
      return [...prev, ch];
    });
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'urgent') return a.level === 'danger' || a.level === 'warning';
    if (filter === 'all_clear') return a.level === 'all_clear';
    return true;
  });

  const flaggedStreets = streets.filter((s) => s.riskLevel !== 'safe');

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left 7 cols: Live Bilingual Alerts Feed */}
        <div className="space-y-4 lg:col-span-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-2xl font-bold text-slate-900">
                {lang === 'ta' ? 'நேரலை தெரு எச்சரிக்கைகள்' : 'Live Street-Level Alerts'}
              </h2>
              <p className="text-sm text-slate-600">
                {lang === 'ta'
                  ? 'நீர் மட்டம் உயரும் போதும் வடியும் போதும் உடனடி எச்சரிக்கைகள்.'
                  : 'Plain-language warnings with estimated time to danger and alternate routes.'}
              </p>
            </div>

            <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setFilter('all')}
                className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All ({alerts.length})
              </button>
              <button
                type="button"
                onClick={() => setFilter('urgent')}
                className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filter === 'urgent' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Warning & Danger
              </button>
              <button
                type="button"
                onClick={() => setFilter('all_clear')}
                className={`min-h-[36px] rounded-md px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  filter === 'all_clear' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                All Clear
              </button>
            </div>
          </div>

          <div className="space-y-3">
            {filteredAlerts.length === 0 ? (
              <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">
                No alerts matching this filter right now.
              </div>
            ) : (
              filteredAlerts.map((alert) => (
                <article
                  key={alert.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5 transition-colors hover:border-slate-300"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <AlertLevelLabel level={alert.level} lang={lang} />
                    <span className="font-mono text-xs text-slate-500 tabular-nums">
                      {new Date(alert.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                      {alert.channelsDispatched.join(' / ').toUpperCase()}
                      {alert.isManual ? ' · Municipal Notice' : ''}
                    </span>
                  </div>

                  <h3 className="mt-2 font-display text-base font-bold text-slate-900">
                    {lang === 'ta' ? alert.titleTa : alert.titleEn}
                  </h3>
                  <p className="mt-1 text-sm leading-relaxed text-slate-700">
                    {lang === 'ta' ? alert.messageTa : alert.messageEn}
                  </p>

                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 text-xs">
                    <span className="text-slate-600">
                      <strong className="text-slate-800">{lang === 'ta' ? 'மாற்றுப் பாதை:' : 'Alternate:'}</strong>{' '}
                      {lang === 'ta' ? alert.alternateRouteTa : alert.alternateRouteEn}
                    </span>
                    <button
                      type="button"
                      onClick={() => onSelectStreetOnMap(alert.streetId)}
                      className="min-h-[36px] font-semibold text-[#0F4C81] hover:underline whitespace-nowrap"
                    >
                      Inspect on Map →
                    </button>
                  </div>
                </article>
              ))
            )}
          </div>
        </div>

        {/* Right 5 cols: Street Subscriptions & Notification Channels */}
        <div className="space-y-6 lg:col-span-5">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-display text-lg font-bold text-slate-900">
                  {lang === 'ta' ? 'உங்கள் தெரு எச்சரிக்கை சந்தாக்கள்' : 'My Street Alert Subscriptions'}
                </h3>
                <p className="mt-1 text-xs text-slate-600">
                  Choose delivery channels and monitoring radius around your home or commute streets.
                </p>
              </div>
              <button
                type="button"
                onClick={requestPushPermission}
                className="min-h-[38px] shrink-0 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100 whitespace-nowrap"
              >
                {pushStatus === 'granted' ? 'Push Enabled' : 'Enable Push'}
              </button>
            </div>

            {/* Channel toggles */}
            <div className="mt-4 space-y-3 border-b border-slate-100 pb-4">
              <div className="text-xs font-semibold text-slate-700">Delivery Channels (FCM, Mock SMS/WhatsApp, Email)</div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {(
                  [
                    { id: 'push', label: 'Push', icon: Bell },
                    { id: 'sms', label: 'SMS', icon: PhoneCall },
                    { id: 'whatsapp', label: 'WhatsApp', icon: MessageSquare },
                    { id: 'email', label: 'Email', icon: Mail },
                  ] as const
                ).map((ch) => {
                  const active = selectedChannels.includes(ch.id);
                  const Icon = ch.icon;
                  return (
                    <button
                      key={ch.id}
                      type="button"
                      onClick={() => toggleChannel(ch.id)}
                      className={`flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border text-xs font-semibold transition-colors ${
                        active
                          ? 'border-[#0F4C81] bg-[#0F4C81]/10 text-[#0F4C81]'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{ch.label}</span>
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center justify-between pt-1 text-xs">
                <label htmlFor="radius-select" className="font-medium text-slate-600">
                  Alert Radius around street sensor
                </label>
                <select
                  id="radius-select"
                  value={radiusMeters}
                  onChange={(e) => setRadiusMeters(Number(e.target.value))}
                  className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800"
                >
                  <option value={250}>250 m</option>
                  <option value={500}>500 m</option>
                  <option value={1000}>1,000 m</option>
                  <option value={2000}>2,000 m</option>
                </select>
              </div>
            </div>

            {/* Street subscribe toggles */}
            <div className="mt-4 divide-y divide-slate-100">
              {streets.map((street) => {
                const sub = subscriptions.find((s) => s.streetId === street.id);
                return (
                  <div key={street.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-slate-900">
                        {lang === 'ta' ? street.nameTa : street.name}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                        <RiskStatusLabel level={street.riskLevel} lang={lang} compact />
                        <span>·</span>
                        <span className="font-mono tabular-nums">{street.waterPct}%</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onToggleSubscribe(street, selectedChannels, radiusMeters)}
                      className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                        sub
                          ? 'border border-emerald-300 bg-emerald-50 text-emerald-900'
                          : 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                      }`}
                    >
                      {sub ? <Check className="h-3.5 w-3.5" /> : <BellRing className="h-3.5 w-3.5" />}
                      <span>{sub ? 'Subscribed' : 'Subscribe'}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      </div>

      {/* Safe Route Suggestions & Shelters Directory */}
      <section className="border-t border-slate-200 pt-8">
        <div className="grid gap-8 lg:grid-cols-12">
          <div className="space-y-4 lg:col-span-6">
            <div className="flex items-center gap-2">
              <Compass className="h-5 w-5 text-[#0F4C81]" />
              <h3 className="font-display text-xl font-bold text-slate-900">
                {lang === 'ta' ? 'பாதுகாப்பான மாற்றுப் பாதைகள்' : 'Active Safe Alternate Routes'}
              </h3>
            </div>
            <div className="space-y-3">
              {(flaggedStreets.length > 0 ? flaggedStreets : streets.slice(0, 3)).map((st) => (
                <div key={st.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{lang === 'ta' ? st.nameTa : st.name}</span>
                    <RiskStatusLabel level={st.riskLevel} lang={lang} compact />
                  </div>
                  <p className="mt-1.5 text-sm text-slate-700">
                    <strong className="text-sky-800">{lang === 'ta' ? 'பரிந்துரைக்கப்பட்ட பாதை:' : 'Recommended Bypass:'}</strong>{' '}
                    {lang === 'ta' ? st.alternateRouteTa : st.alternateRouteEn}
                  </p>
                  <button
                    type="button"
                    onClick={() => onSelectStreetOnMap(st.id)}
                    className="mt-2 min-h-[36px] text-xs font-semibold text-[#0F4C81] hover:underline"
                  >
                    Highlight Bypass on Map →
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-6">
            <div className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-[#0F4C81]" />
              <h3 className="font-display text-xl font-bold text-slate-900">
                {lang === 'ta' ? 'நிவாரண மையங்கள் & மருத்துவமனைகள்' : 'Nearby Relief Shelters & Hospitals'}
              </h3>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <img
                src={resolveReportPhoto('asset:shelter_hub') || ASSETS.shelterHub}
                alt="Elevated municipal community relief center"
                referrerPolicy="no-referrer"
                className="h-44 w-full object-cover"
              />
              <div className="divide-y divide-slate-100 p-4">
                {shelters.map((sh) => (
                  <div key={sh.id} className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-bold text-slate-900">{lang === 'ta' ? sh.nameTa : sh.name}</h4>
                        <p className="mt-0.5 text-xs text-slate-600">{sh.address}</p>
                      </div>
                      <span className="font-mono text-xs font-semibold text-emerald-800 tabular-nums whitespace-nowrap">
                        {sh.availableBeds}/{sh.capacity} beds
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {sh.elevationStatus} · Tel: <a href={`tel:${sh.phone}`} className="font-mono text-[#0F4C81] underline">{sh.phone}</a>
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
