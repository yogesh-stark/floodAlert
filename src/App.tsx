import React, { useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  CloudRain,
  Map as MapIcon,
  RotateCcw,
  Shield,
  ShieldCheck,
  UserCheck,
  X,
} from 'lucide-react';
import { AdminDashboardView } from './components/AdminDashboardView.tsx';
import { AlertsRoutesView } from './components/AlertsRoutesView.tsx';
import { CommunityReportView } from './components/CommunityReportView.tsx';
import { HeroLandingSection } from './components/HeroLandingSection.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import { PreparednessView } from './components/PreparednessView.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { AlertLevelLabel, RiskStatusLabel } from './components/RiskBadge.tsx';
import { StreetInspector } from './components/StreetInspector.tsx';
import { StreetMap } from './components/StreetMap.tsx';
import { useFloodData } from './hooks/useFloodSocket.ts';
import { t } from './lib/i18n.ts';
import type { Language, UserRole } from './types/flood.ts';

type ActiveTab = 'map' | 'alerts' | 'report' | 'prepare' | 'admin';

function distanceSq(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return (lat1 - lat2) ** 2 + (lng1 - lng2) ** 2;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<ActiveTab>('map');
  const [lang, setLang] = useState<Language>('en');
  const [role, setRole] = useState<UserRole>('resident');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedStreetId, setSelectedStreetId] = useState<string | null>('madipakkam-koot');
  const [showSafeRoute, setShowSafeRoute] = useState(true);
  const [userLocation, setUserLocation] = useState<[number, number] | null>(null);
  const [locationNotice, setLocationNotice] = useState<string | null>(null);

  const mapWorkspaceRef = useRef<HTMLDivElement | null>(null);

  const {
    streets,
    sensors,
    alerts,
    reports,
    shelters,
    forecast,
    simulation,
    wsConnected,
    loading,
    latestToastAlert,
    dismissToastAlert,
    user,
    subscriptions,
    signInWithGoogle,
    signOutUser,
    toggleStreetSubscription,
  } = useFloodData(lang);

  const copy = t(lang);

  const selectedStreet = useMemo(() => {
    if (!streets.length) return null;
    return streets.find((s) => s.id === selectedStreetId) ?? streets[0];
  }, [streets, selectedStreetId]);

  const subscribedIds = useMemo(() => new Set(subscriptions.map((s) => s.streetId)), [subscriptions]);

  const handleUseMyLocation = () => {
    if (!navigator.geolocation) {
      setUserLocation([13.057, 80.253]);
      setSelectedStreetId('anna-salai');
      setLocationNotice('Geolocation unavailable — centered on Anna Salai pilot corridor.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setUserLocation([lat, lng]);

        // Snap to nearest monitored street
        if (streets.length > 0) {
          let nearest = streets[0];
          let minD = Infinity;
          for (const st of streets) {
            const mid = st.coordinates[Math.floor(st.coordinates.length / 2)];
            const d = distanceSq(lat, lng, mid[0], mid[1]);
            if (d < minD) {
              minD = d;
              nearest = st;
            }
          }
          setSelectedStreetId(nearest.id);
          setLocationNotice(`Centered on nearest monitored street: ${nearest.name}`);
        }
      },
      () => {
        // Fallback to Chennai central coordinate if permission denied
        setUserLocation([13.0574, 80.2535]);
        setSelectedStreetId('anna-salai');
        setLocationNotice('Location permission declined — showing Anna Salai corridor.');
      },
      { timeout: 5000 }
    );
  };

  const handleSimulateHeavyRain = async () => {
    await fetch('/api/simulate/heavy-rain', { method: 'POST' });
    setActiveTab('map');
    mapWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const handleResetDemo = async () => {
    await fetch('/api/simulate/reset', { method: 'POST' });
  };

  const handleJumpToMap = () => {
    setActiveTab('map');
    setTimeout(() => {
      mapWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const handleSelectStreetFromAlerts = (streetId: string) => {
    setSelectedStreetId(streetId);
    setShowSafeRoute(true);
    setActiveTab('map');
    setTimeout(() => {
      mapWorkspaceRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const navItems: { id: ActiveTab; label: string }[] = [
    { id: 'map', label: copy.navMap },
    { id: 'alerts', label: copy.navAlerts },
    { id: 'report', label: copy.navReport },
    { id: 'prepare', label: copy.navPrepare },
    { id: 'admin', label: copy.navAdmin },
  ];

  return (
    <div className="min-h-screen bg-slate-50 pb-16 text-slate-900 md:pb-0">
      {/* Top Bar Contract: Exactly 3 zones separated by gap-8 */}
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-8 px-4 sm:px-6 lg:px-8">
          {/* Zone 1: Single text wordmark */}
          <a
            href="#top"
            onClick={(e) => {
              e.preventDefault();
              setActiveTab('map');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
          >
            {copy.brand}
          </a>

          {/* Zone 2: 5 concise single-line text nav links */}
          <nav className="hidden items-center gap-6 md:flex" aria-label="Primary navigation">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`min-h-[40px] border-b-2 text-sm font-medium transition-colors whitespace-nowrap shrink-0 ${
                  activeTab === item.id
                    ? 'border-[#0F4C81] text-[#0F4C81] font-semibold'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            ))}
          </nav>

          {/* Zone 3: Single primary action button */}
          <div className="shrink-0">
            {user ? (
              <button
                type="button"
                onClick={signOutUser}
                className="min-h-[40px] rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
              >
                {copy.signOut} ({user.displayName?.split(' ')[0] || 'User'})
              </button>
            ) : (
              <button
                type="button"
                onClick={signInWithGoogle}
                className="min-h-[40px] rounded-lg bg-[#0F4C81] px-4 py-1.5 text-xs font-semibold text-white hover:bg-[#0c3c66] whitespace-nowrap shrink-0"
              >
                {copy.signInGoogle}
              </button>
            )}
          </div>
        </div>
      </header>

      {/* Workspace Control Toolbar (Role switcher, Language toggle, Demo simulator, PWA Install) */}
      <div className="border-b border-slate-200 bg-slate-100/80">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center gap-2">
            {/* Role view selector */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="User role view">
              {(
                [
                  { id: 'resident', label: copy.roleResident },
                  { id: 'reporter', label: copy.roleReporter },
                  { id: 'admin', label: copy.roleAdmin },
                ] as const
              ).map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    setRole(r.id);
                    if (r.id === 'admin') setActiveTab('admin');
                    if (r.id === 'reporter') setActiveTab('report');
                  }}
                  className={`min-h-[36px] rounded-md px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    role === r.id ? 'bg-[#0F4C81] text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>

            {/* Language toggle EN | தமிழ் */}
            <div className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white p-0.5" role="group" aria-label="Language toggle">
              <button
                type="button"
                onClick={() => setLang('en')}
                className={`min-h-[36px] rounded-md px-2.5 text-xs font-semibold whitespace-nowrap ${
                  lang === 'en' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                EN
              </button>
              <button
                type="button"
                onClick={() => setLang('ta')}
                className={`min-h-[36px] rounded-md px-2.5 text-xs font-semibold whitespace-nowrap ${
                  lang === 'ta' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                தமிழ்
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="hidden items-center gap-1.5 text-xs text-slate-600 lg:inline-flex">
              <UserCheck className="h-3.5 w-3.5 text-[#0F4C81]" />
              {wsConnected ? 'Real-time WebSocket stream' : 'Reconnecting stream...'}
            </span>

            <button
              type="button"
              onClick={handleSimulateHeavyRain}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg bg-amber-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 whitespace-nowrap shrink-0 transition-colors"
            >
              <CloudRain className="h-4 w-4" />
              <span>
                {simulation.active ? `${copy.simulatingRain} (${simulation.tick}/${simulation.maxTicks})` : copy.simulateHeavyRain}
              </span>
            </button>

            <button
              type="button"
              onClick={handleResetDemo}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{copy.resetDemo}</span>
            </button>

            <PWAInstallButton />
          </div>
        </div>
      </div>

      {/* Live Toast Notification Banner on Real-Time Alert */}
      {latestToastAlert && (
        <div className="mx-auto max-w-7xl px-4 pt-4 sm:px-6 lg:px-8">
          <div
            role="alert"
            className="flex items-start justify-between gap-4 rounded-2xl border border-orange-300 bg-orange-50 px-4 py-3 text-slate-900 shadow-sm"
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <AlertLevelLabel level={latestToastAlert.level} lang={lang} />
                <span className="text-xs text-slate-500">· Dispatched to {latestToastAlert.channelsDispatched.join(', ')}</span>
              </div>
              <p className="text-sm font-semibold">{lang === 'ta' ? latestToastAlert.titleTa : latestToastAlert.titleEn}</p>
              <p className="text-xs text-slate-700">{lang === 'ta' ? latestToastAlert.messageTa : latestToastAlert.messageEn}</p>
            </div>
            <button
              type="button"
              onClick={dismissToastAlert}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-orange-100"
              aria-label="Dismiss alert banner"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main>
        {activeTab === 'map' && (
          <>
            <HeroLandingSection
              lang={lang}
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              onUseMyLocation={handleUseMyLocation}
              streets={streets}
              onSelectStreet={setSelectedStreetId}
              onJumpToMap={handleJumpToMap}
            />

            <section ref={mapWorkspaceRef} className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
              {locationNotice && (
                <div className="mb-4 flex items-center justify-between rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-xs font-medium text-sky-900">
                  <span>{locationNotice}</span>
                  <button type="button" onClick={() => setLocationNotice(null)} className="text-sky-700 hover:underline">
                    Dismiss
                  </button>
                </div>
              )}

              {/* Map + Inspector Split */}
              <div className="grid gap-6 lg:grid-cols-12">
                <div className="space-y-4 lg:col-span-7">
                  {loading && streets.length === 0 ? (
                    <div className="flex h-[430px] items-center justify-center rounded-2xl border border-slate-200 bg-white text-sm text-slate-500">
                      Loading live street sensor map...
                    </div>
                  ) : (
                    <StreetMap
                      streets={streets}
                      selectedStreetId={selectedStreet?.id ?? null}
                      onSelectStreet={setSelectedStreetId}
                      reports={reports}
                      shelters={shelters}
                      userLocation={userLocation}
                      showSafeRoute={showSafeRoute}
                      lang={lang}
                      onRequestLocation={handleUseMyLocation}
                    />
                  )}

                  {/* Quick Street Status Grid ("Is my street safe right now?") */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <h3 className="font-display text-sm font-bold text-slate-900">
                        {lang === 'ta' ? 'தெரு வாரியான தற்போதைய நிலை' : 'Monitored Streets — Live Status'}
                      </h3>
                      <span className="text-xs text-slate-500">Tap any street to inspect</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {streets.map((st) => {
                        const isSel = selectedStreet?.id === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => setSelectedStreetId(st.id)}
                            className={`flex min-h-[56px] items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition-colors ${
                              isSel
                                ? 'border-[#0F4C81] bg-[#0F4C81]/5'
                                : 'border-slate-200 bg-white hover:bg-slate-50'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="truncate text-xs font-semibold text-slate-900">
                                {lang === 'ta' ? st.nameTa : st.name}
                              </div>
                              <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                {st.currentWaterCm} cm ({st.waterPct}%) · {st.rainfallMmHr} mm/hr
                              </div>
                            </div>
                            <RiskStatusLabel level={st.riskLevel} lang={lang} compact />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <div className="lg:col-span-5">
                  <StreetInspector
                    street={selectedStreet}
                    shelters={shelters}
                    forecast={forecast}
                    isSubscribed={!!(selectedStreet && subscribedIds.has(selectedStreet.id))}
                    onToggleSubscribe={(st) => toggleStreetSubscription(st)}
                    showSafeRoute={showSafeRoute}
                    onToggleSafeRoute={() => setShowSafeRoute((v) => !v)}
                    lang={lang}
                  />
                </div>
              </div>
            </section>
          </>
        )}

        {activeTab === 'alerts' && (
          <AlertsRoutesView
            streets={streets}
            alerts={alerts}
            shelters={shelters}
            subscriptions={subscriptions}
            onToggleSubscribe={toggleStreetSubscription}
            onSelectStreetOnMap={handleSelectStreetFromAlerts}
            lang={lang}
          />
        )}

        {activeTab === 'report' && (
          <CommunityReportView
            streets={streets}
            reports={reports}
            role={role}
            userName={user?.displayName || ''}
            lang={lang}
          />
        )}

        {activeTab === 'prepare' && <PreparednessView streets={streets} lang={lang} />}

        {activeTab === 'admin' && (
          <AdminDashboardView streets={streets} sensors={sensors} alerts={alerts} lang={lang} />
        )}
      </main>

      {/* Quiet Footer */}
      <footer className="mt-12 border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-4 px-4 py-6 text-xs text-slate-500 sm:flex-row sm:items-center sm:px-6 lg:px-8">
          <div className="font-display font-semibold text-slate-800">StreetFlood Alert</div>
          <div>Street-level rain gauge & ultrasonic storm-drain early warning system · English / தமிழ்</div>
        </div>
      </footer>

      {/* Fixed Mobile Bottom Tab Bar (Thumb Zone) */}
      <nav
        aria-label="Mobile navigation"
        className="fixed inset-x-0 bottom-0 z-40 grid h-14 grid-cols-5 border-t border-slate-200 bg-white/95 backdrop-blur-md md:hidden"
      >
        {(
          [
            { id: 'map', label: 'Map', icon: MapIcon },
            { id: 'alerts', label: 'Alerts', icon: Bell },
            { id: 'report', label: 'Report', icon: AlertTriangle },
            { id: 'prepare', label: 'Prepare', icon: ShieldCheck },
            { id: 'admin', label: 'Admin', icon: Shield },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
                active ? 'text-[#0F4C81]' : 'text-slate-500'
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      <OfflineIndicator />
    </div>
  );
}
