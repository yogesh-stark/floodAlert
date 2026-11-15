import React from 'react';
import { Navigation, Search } from 'lucide-react';
import { ASSETS } from '../lib/assets.ts';
import { t } from '../lib/i18n.ts';
import type { Language, Street } from '../types/flood.ts';

interface HeroLandingSectionProps {
  lang: Language;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onUseMyLocation: () => void;
  streets: Street[];
  onSelectStreet: (streetId: string) => void;
  onJumpToMap: () => void;
}

export const HeroLandingSection: React.FC<HeroLandingSectionProps> = ({
  lang,
  searchQuery,
  onSearchChange,
  onUseMyLocation,
  streets,
  onSelectStreet,
  onJumpToMap,
}) => {
  const copy = t(lang);
  const dangerCount = streets.filter((s) => s.riskLevel === 'danger' || s.riskLevel === 'warning').length;
  const matching =
    searchQuery.trim().length > 0
      ? streets.filter(
          (s) =>
            s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.area.toLowerCase().includes(searchQuery.toLowerCase()) ||
            s.nameTa.includes(searchQuery)
        )
      : [];

  return (
    <section className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <div className="grid items-stretch gap-8 lg:grid-cols-12">
          {/* Left column: Value proposition + instant "Is my street safe?" search */}
          <div className="flex flex-col justify-between lg:col-span-7">
            <div>
              <p className="text-xs font-semibold tracking-wide text-[#0F4C81]">{copy.heroKicker}</p>
              <h1 className="mt-2 font-display text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl lg:text-[42px] lg:leading-[1.12] [text-wrap:balance]">
                {copy.heroTitle}
              </h1>
              <p className="mt-3 max-w-2xl text-base leading-relaxed text-slate-600">{copy.heroSubtitle}</p>

              {/* Quick Street Lookup */}
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute top-1/2 left-3.5 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => onSearchChange(e.target.value)}
                    placeholder={copy.searchPlaceholder}
                    aria-label={copy.searchPlaceholder}
                    className="h-12 w-full rounded-xl border border-slate-300 bg-slate-50 pr-4 pl-10 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0F4C81] focus:bg-white focus:outline-none"
                  />
                  {matching.length > 0 && (
                    <div className="absolute right-0 left-0 z-30 mt-1.5 max-h-60 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                      {matching.map((st) => (
                        <button
                          key={st.id}
                          type="button"
                          onClick={() => {
                            onSelectStreet(st.id);
                            onSearchChange('');
                            onJumpToMap();
                          }}
                          className="flex min-h-[44px] w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50"
                        >
                          <span className="font-medium text-slate-900">{lang === 'ta' ? st.nameTa : st.name}</span>
                          <span className="font-mono text-xs text-slate-500 tabular-nums">{st.waterPct}% drain</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    onUseMyLocation();
                    onJumpToMap();
                  }}
                  className="inline-flex h-12 min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[#0F4C81] px-5 text-sm font-semibold text-white hover:bg-[#0c3c66] whitespace-nowrap shrink-0 transition-colors"
                >
                  <Navigation className="h-4 w-4" />
                  <span>{copy.useMyLocation}</span>
                </button>
              </div>
            </div>

            {/* Clean KPI summary strip */}
            <div className="mt-7 grid grid-cols-3 gap-4 border-t border-slate-100 pt-5">
              <div>
                <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">{streets.length}</div>
                <div className="text-xs text-slate-500">Monitored streets</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">{dangerCount}</div>
                <div className="text-xs text-slate-500">Elevated risk right now</div>
              </div>
              <div>
                <div className="font-mono text-2xl font-bold text-slate-900 tabular-nums">60s</div>
                <div className="text-xs text-slate-500">Sensor telemetry interval</div>
              </div>
            </div>
          </div>

          {/* Right column: Documentary sensor image */}
          <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 lg:col-span-5">
            <img
              src={ASSETS.heroSensor}
              alt="Ultrasonic storm-drain water-level sensor and rain gauge pole mounted beside a city street curb"
              referrerPolicy="no-referrer"
              className="h-64 w-full object-cover lg:h-full"
            />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-slate-950/85 via-slate-950/45 to-transparent p-5 text-white">
              <p className="text-xs font-medium text-slate-200">Field Telemetry Node · ESP32 + Ultrasonic Depth</p>
              <p className="mt-0.5 text-sm font-semibold">
                Measures curb drain fill in centimeters before surface water spills across lanes.
              </p>
            </div>
          </div>
        </div>

        {/* 4-Step Mechanism Flow */}
        <div className="mt-8 border-t border-slate-100 pt-6">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500">{copy.howItWorksTitle}</h2>
          <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="font-display text-sm font-bold text-slate-900">{copy.step1Title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{copy.step1Desc}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="font-display text-sm font-bold text-slate-900">{copy.step2Title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{copy.step2Desc}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="font-display text-sm font-bold text-slate-900">{copy.step3Title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{copy.step3Desc}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
              <h3 className="font-display text-sm font-bold text-slate-900">{copy.step4Title}</h3>
              <p className="mt-1 text-xs leading-relaxed text-slate-600">{copy.step4Desc}</p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
