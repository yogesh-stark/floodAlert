import React, { useEffect, useState } from 'react';
import { CheckSquare, History, PhoneCall, Square } from 'lucide-react';
import { t } from '../lib/i18n.ts';
import type { Language, Street } from '../types/flood.ts';

interface PreparednessViewProps {
  streets: Street[];
  lang: Language;
}

const CHECKLIST_KEY = 'streetflood_prep_checklist_v1';

const CHECKLIST_ITEMS = {
  before: [
    {
      id: 'b1',
      en: 'Subscribe to your home street and work commute corridor in Alerts.',
      ta: 'உங்கள் வீட்டுத் தெரு மற்றும் பணிப் பாதைக்கு எச்சரிக்கை சந்தா செய்யுங்கள்.',
    },
    {
      id: 'b2',
      en: 'Clear leaves and plastic debris from the roadside storm drain grate near your gate.',
      ta: 'வீட்டு வாசல் அருகே உள்ள மழைநீர் வடிகால் மூடியில் உள்ள குப்பைகளை அகற்றவும்.',
    },
    {
      id: 'b3',
      en: 'Keep power banks charged, drinking water stored, and emergency medicines in a waterproof pouch.',
      ta: 'பவர் பேங்க், குடிநீர் மற்றும் அவசர மருந்துகளை நீர்ப்புகா பையில் தயாராக வைக்கவும்.',
    },
    {
      id: 'b4',
      en: 'Identify elevated parking along your street’s alternate bypass before heavy rain begins.',
      ta: 'கனமழைக்கு முன் வாகனங்களை நிறுத்த உயரமான மாற்று இடத்தைத் தேர்ந்தெடுக்கவும்.',
    },
  ],
  during: [
    {
      id: 'd1',
      en: 'Move vehicles when drain fill reaches Warning (75%) — do not wait for surface flooding.',
      ta: 'வடிகால் 75% நிரம்பும் போதே வாகனங்களை பாதுகாப்பான இடத்திற்கு நகர்த்தவும்.',
    },
    {
      id: 'd2',
      en: 'Avoid walking or driving through moving water above ankle depth or near open manholes.',
      ta: 'கணுக்கால் அளவிற்கு மேல் நீர் தேங்கிய தெருக்களில் நடப்பதையோ வாகனம் ஓட்டுவதையோ தவிர்க்கவும்.',
    },
    {
      id: 'd3',
      en: 'Switch off main electrical breakers if water enters ground-floor rooms.',
      ta: 'தரைத்தளத்திற்குள் நீர் புகுந்தால் உடனடியாக மின் இணைப்பைத் துண்டிக்கவும்.',
    },
  ],
  after: [
    {
      id: 'a1',
      en: 'Wait for an "All Clear" alert before returning through low-lying subways.',
      ta: 'தாழ்வான சுரங்கப்பாதைகளில் செல்ல "நிலைமை சீரானது" எச்சரிக்கை வரும் வரை காத்திருக்கவும்.',
    },
    {
      id: 'a2',
      en: 'Report lingering blocked drains or fallen wires using the Report tab.',
      ta: 'தொடர்ந்து அடைபட்ட வடிகால்கள் அல்லது அறுந்த மின்கம்பிகளை புகார் பிரிவில் தெரிவிக்கவும்.',
    },
    {
      id: 'a3',
      en: 'Boil tap water and disinfect floors exposed to stormwater runoff.',
      ta: 'குடிநீரைக் காய்ச்சி குடிக்கவும்; மழைநீர் புகுந்த தளங்களைக் கிருமிநாசினி கொண்டு சுத்தம் செய்யவும்.',
    },
  ],
};

const HELPLINES = [
  { labelEn: 'Chennai Corporation Flood Control', labelTa: 'சென்னை மாநகராட்சி வெள்ளக் கட்டுப்பாடு', number: '1913', note: '24/7 Civic Helpline' },
  { labelEn: 'State Disaster Emergency Response', labelTa: 'மாநில பேரிடர் அவசர உதவி', number: '1077', note: 'District Emergency' },
  { labelEn: 'NDRF Flood Rescue', labelTa: 'தேசிய பேரிடர் மீட்புப் படை', number: '1070', note: 'Boat & Evacuation' },
  { labelEn: 'Medical Ambulance (108)', labelTa: 'மருத்துவ அவசர ஊர்தி', number: '108', note: 'Emergency Medical' },
  { labelEn: 'TANGEDCO Power Outage / Downed Line', labelTa: 'மின்சார வாரியம் (TNEB)', number: '9498794987', note: 'Electrical Safety' },
];

export const PreparednessView: React.FC<PreparednessViewProps> = ({ streets, lang }) => {
  const copy = t(lang);
  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem(CHECKLIST_KEY);
      return raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(CHECKLIST_KEY, JSON.stringify(checked));
    } catch {
      // Ignore storage failure
    }
  }, [checked]);

  const toggleItem = (id: string) => {
    setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  return (
    <div className="mx-auto max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      {/* Checklist Section */}
      <section>
        <h2 className="font-display text-2xl font-bold text-slate-900">
          {lang === 'ta' ? 'வெள்ள பாதுகாப்பு சரிபார்ப்புப் பட்டியல்' : 'Flood Safety Checklist'}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Saved locally on your device so you can check critical safety actions even offline.
        </p>

        <div className="mt-5 grid gap-6 lg:grid-cols-3">
          {(
            [
              { title: copy.beforeFlood, items: CHECKLIST_ITEMS.before },
              { title: copy.duringFlood, items: CHECKLIST_ITEMS.during },
              { title: copy.afterFlood, items: CHECKLIST_ITEMS.after },
            ] as const
          ).map((group) => (
            <div key={group.title} className="rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="font-display text-base font-bold text-slate-900">{group.title}</h3>
              <ul className="mt-3 space-y-2.5">
                {group.items.map((item) => {
                  const isDone = !!checked[item.id];
                  return (
                    <li key={item.id}>
                      <button
                        type="button"
                        onClick={() => toggleItem(item.id)}
                        className="flex min-h-[44px] w-full items-start gap-2.5 rounded-xl p-2 text-left text-sm transition-colors hover:bg-slate-50"
                      >
                        {isDone ? (
                          <CheckSquare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
                        ) : (
                          <Square className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <span className={isDone ? 'text-slate-400 line-through' : 'text-slate-700'}>
                          {lang === 'ta' ? item.ta : item.en}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* Emergency Helplines + Past Flooding History */}
      <div className="grid gap-8 lg:grid-cols-12">
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-5">
          <div className="flex items-center gap-2">
            <PhoneCall className="h-5 w-5 text-[#0F4C81]" />
            <h3 className="font-display text-xl font-bold text-slate-900">{copy.helplinesTitle}</h3>
          </div>
          <div className="mt-4 divide-y divide-slate-100">
            {HELPLINES.map((line) => (
              <div key={line.number} className="flex items-center justify-between gap-3 py-3.5">
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    {lang === 'ta' ? line.labelTa : line.labelEn}
                  </div>
                  <div className="text-xs text-slate-500">{line.note}</div>
                </div>
                <a
                  href={`tel:${line.number}`}
                  className="inline-flex min-h-[42px] items-center rounded-xl border border-slate-300 bg-slate-50 px-3.5 font-mono text-sm font-bold text-[#0F4C81] hover:bg-slate-100 whitespace-nowrap"
                >
                  {line.number}
                </a>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-7">
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-[#0F4C81]" />
            <h3 className="font-display text-xl font-bold text-slate-900">{copy.pastHistoryTitle}</h3>
          </div>
          <div className="mt-4 space-y-4">
            {streets
              .filter((st) => st.historicalEvents.length > 0)
              .map((st) => (
                <div key={st.id} className="rounded-xl border border-slate-200 bg-slate-50/70 p-4">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-display text-sm font-bold text-slate-900">
                      {lang === 'ta' ? st.nameTa : st.name}
                    </h4>
                    <span className="text-xs text-slate-500">{st.area}</span>
                  </div>
                  <div className="mt-2 space-y-2">
                    {st.historicalEvents.map((ev, idx) => (
                      <div key={idx} className="text-xs text-slate-700">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {ev.month} {ev.year} · Peak {ev.peakWaterCm} cm ({ev.durationHours}h)
                        </span>
                        <p className="mt-0.5 text-slate-600">{lang === 'ta' ? ev.noteTa : ev.noteEn}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
          </div>
        </section>
      </div>
    </div>
  );
};
