import React, { useState } from 'react';
import { Camera, CheckCircle2, Clock, MapPin, ThumbsUp, Upload } from 'lucide-react';
import { ASSETS, resolveReportPhoto } from '../lib/assets.ts';
import { SEVERITY_LABELS, t } from '../lib/i18n.ts';
import type { CommunityReport, Language, ReportSeverity, Street, UserRole } from '../types/flood.ts';

interface CommunityReportViewProps {
  streets: Street[];
  reports: CommunityReport[];
  role: UserRole;
  userName: string;
  lang: Language;
  onReportSubmitted?: () => void;
}

export const CommunityReportView: React.FC<CommunityReportViewProps> = ({
  streets,
  reports,
  role,
  userName,
  lang,
  onReportSubmitted,
}) => {
  const copy = t(lang);
  const [streetId, setStreetId] = useState(streets[0]?.id || 'anna-salai');
  const [severity, setSeverity] = useState<ReportSeverity>('ankle');
  const [description, setDescription] = useState('');
  const [photoPreview, setPhotoPreview] = useState<string>('asset:report_anna');
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoPreview(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) return;
    setSubmitting(true);
    setFeedback(null);
    try {
      const targetStreet = streets.find((s) => s.id === streetId);
      const mid = targetStreet?.coordinates[Math.floor(targetStreet.coordinates.length / 2)] ?? [13.05, 80.25];
      const resp = await fetch('/api/reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          authorId: role === 'reporter' ? 'volunteer-reporter' : 'resident-user',
          authorName: userName || (role === 'reporter' ? 'Volunteer Reporter' : 'Neighborhood Resident'),
          streetId,
          severity,
          description: description.trim(),
          photoUrl: photoPreview,
          lat: mid[0],
          lng: mid[1],
        }),
      });
      if (resp.ok) {
        setDescription('');
        setFeedback('Report submitted and pinned on the live map as Unverified until confirmed.');
        onReportSubmitted?.();
      } else {
        setFeedback('Could not submit report. Please verify all fields.');
      }
    } catch {
      setFeedback('Network error while submitting report.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReportAction = async (reportId: string, action: 'confirm' | 'verify' | 'resolve') => {
    await fetch(`/api/reports/${reportId}/verify`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    });
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="grid gap-8 lg:grid-cols-12">
        {/* Left 5 cols: Submit Waterlogging Report Form */}
        <section className="rounded-2xl border border-slate-200 bg-white p-5 sm:p-6 lg:col-span-5">
          <h2 className="font-display text-xl font-bold text-slate-900">{copy.submitReport}</h2>
          <p className="mt-1 text-xs text-slate-600">
            Reports appear immediately as map pins marked Unverified until confirmed by 3 residents or a municipal admin.
          </p>

          <form onSubmit={handleSubmit} className="mt-5 space-y-4">
            <div>
              <label htmlFor="rep-street" className="block text-xs font-semibold text-slate-700">
                Street / Corridor
              </label>
              <select
                id="rep-street"
                value={streetId}
                onChange={(e) => setStreetId(e.target.value)}
                className="mt-1.5 h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none"
              >
                {streets.map((s) => (
                  <option key={s.id} value={s.id}>
                    {lang === 'ta' ? s.nameTa : s.name} ({s.area})
                  </option>
                ))}
              </select>
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700">Observed Water Depth / Issue</span>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                {(['ankle', 'knee', 'waist', 'blocked_drain'] as const).map((sev) => (
                  <button
                    key={sev}
                    type="button"
                    onClick={() => setSeverity(sev)}
                    className={`min-h-[44px] rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors ${
                      severity === sev
                        ? 'border-[#0F4C81] bg-[#0F4C81]/10 text-[#0F4C81]'
                        : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                    }`}
                  >
                    {SEVERITY_LABELS[sev][lang]}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label htmlFor="rep-desc" className="block text-xs font-semibold text-slate-700">
                On-ground Observation
              </label>
              <textarea
                id="rep-desc"
                rows={3}
                required
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Describe exact landmark, lane blockage, or drain overflow..."
                className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white p-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#0F4C81] focus:outline-none"
              />
            </div>

            <div>
              <span className="block text-xs font-semibold text-slate-700">Street Photo Evidence</span>
              <div className="mt-1.5 flex flex-wrap items-center gap-2">
                <label className="inline-flex min-h-[42px] cursor-pointer items-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-100">
                  <Upload className="h-3.5 w-3.5" />
                  <span>Upload Photo</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="sr-only" />
                </label>
                <button
                  type="button"
                  onClick={() => setPhotoPreview('asset:report_anna')}
                  className="min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  <Camera className="mr-1 inline h-3.5 w-3.5" />
                  Bus Stop Sample
                </button>
                <button
                  type="button"
                  onClick={() => setPhotoPreview('asset:report_drain')}
                  className="min-h-[42px] rounded-xl border border-slate-200 px-3 text-xs font-medium text-slate-600 hover:bg-slate-50"
                >
                  Drain Grate Sample
                </button>
              </div>

              {photoPreview && (
                <div className="mt-2.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                  <img
                    src={resolveReportPhoto(photoPreview) || ASSETS.reportAnna}
                    alt="Waterlogging preview"
                    referrerPolicy="no-referrer"
                    className="h-36 w-full object-cover"
                  />
                </div>
              )}
            </div>

            {feedback && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3.5 py-2.5 text-xs font-medium text-emerald-900">
                {feedback}
              </div>
            )}

            <button
              type="submit"
              disabled={submitting}
              className="min-h-[46px] w-full rounded-xl bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-60"
            >
              {submitting ? 'Submitting...' : copy.submitReport}
            </button>
          </form>
        </section>

        {/* Right 7 cols: Community Reports Feed */}
        <section className="space-y-4 lg:col-span-7">
          <div>
            <h2 className="font-display text-2xl font-bold text-slate-900">
              {lang === 'ta' ? 'குடியிருப்பாளர் & தன்னார்வலர் புகார்கள்' : 'Community Waterlogging Feed'}
            </h2>
            <p className="text-sm text-slate-600">
              Neighbors can confirm active reports; Municipal admins can verify or mark drains cleared.
            </p>
          </div>

          <div className="space-y-4">
            {reports.map((rep) => {
              const imgSrc = resolveReportPhoto(rep.photoUrl);
              return (
                <article
                  key={rep.id}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white sm:flex"
                >
                  {imgSrc && (
                    <div className="sm:w-48 sm:shrink-0">
                      <img
                        src={imgSrc}
                        alt={`Waterlogging reported at ${rep.streetName}`}
                        referrerPolicy="no-referrer"
                        className="h-44 w-full object-cover sm:h-full"
                      />
                    </div>
                  )}
                  <div className="flex flex-1 flex-col justify-between p-4 sm:p-5">
                    <div>
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                        <span
                          className={`inline-flex items-center gap-1 font-semibold ${
                            rep.status === 'verified'
                              ? 'text-emerald-800'
                              : rep.status === 'resolved'
                                ? 'text-slate-500'
                                : 'text-amber-800'
                          }`}
                        >
                          {rep.status === 'verified' ? (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          ) : (
                            <Clock className="h-3.5 w-3.5" />
                          )}
                          {rep.status === 'verified'
                            ? 'Verified'
                            : rep.status === 'resolved'
                              ? 'Resolved'
                              : 'Unverified'}
                        </span>
                        <span className="font-mono text-slate-500 tabular-nums">
                          {new Date(rep.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ·{' '}
                          {rep.confirmations} confirmations
                        </span>
                      </div>

                      <h3 className="mt-1.5 flex items-center gap-1.5 font-display text-base font-bold text-slate-900">
                        <MapPin className="h-4 w-4 text-[#0F4C81]" />
                        <span>{rep.streetName}</span>
                      </h3>
                      <p className="mt-0.5 text-xs font-medium text-slate-500">{SEVERITY_LABELS[rep.severity][lang]} · Reported by {rep.authorName}</p>
                      <p className="mt-2 text-sm text-slate-700">{rep.description}</p>
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                      {rep.status !== 'resolved' && (
                        <button
                          type="button"
                          onClick={() => handleReportAction(rep.id, 'confirm')}
                          className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                        >
                          <ThumbsUp className="h-3.5 w-3.5 text-[#0F4C81]" />
                          <span>Confirm Sighting (+1)</span>
                        </button>
                      )}
                      {role === 'admin' && rep.status === 'unverified' && (
                        <button
                          type="button"
                          onClick={() => handleReportAction(rep.id, 'verify')}
                          className="min-h-[38px] rounded-lg bg-emerald-700 px-3 text-xs font-semibold text-white hover:bg-emerald-800"
                        >
                          Admin Verify
                        </button>
                      )}
                      {role === 'admin' && rep.status !== 'resolved' && (
                        <button
                          type="button"
                          onClick={() => handleReportAction(rep.id, 'resolve')}
                          className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                        >
                          Mark Cleared
                        </button>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
};
