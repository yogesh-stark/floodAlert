import React from 'react';
import { AlertTriangle, Eye, OctagonAlert, ShieldCheck, CheckCircle2 } from 'lucide-react';
import { ALERT_LABELS, RISK_LABELS } from '../lib/i18n.ts';
import type { AlertLevel, Language, RiskLevel } from '../types/flood.ts';

export const RISK_COLORS: Record<RiskLevel, { stroke: string; bg: string; text: string; border: string }> = {
  safe: { stroke: '#15803D', bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200' },
  watch: { stroke: '#A16207', bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200' },
  warning: { stroke: '#C2410C', bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200' },
  danger: { stroke: '#B91C1C', bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200' },
};

export const RiskIcon: React.FC<{ level: RiskLevel | AlertLevel; className?: string }> = ({
  level,
  className = 'h-4 w-4',
}) => {
  if (level === 'safe' || level === 'all_clear') return <ShieldCheck className={className} aria-hidden="true" />;
  if (level === 'watch') return <Eye className={className} aria-hidden="true" />;
  if (level === 'warning') return <AlertTriangle className={className} aria-hidden="true" />;
  return <OctagonAlert className={className} aria-hidden="true" />;
};

interface RiskStatusLabelProps {
  level: RiskLevel;
  lang: Language;
  compact?: boolean;
}

export const RiskStatusLabel: React.FC<RiskStatusLabelProps> = ({ level, lang, compact = false }) => {
  const style = RISK_COLORS[level];
  const label = RISK_LABELS[level][lang];

  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold ${style.text} ${compact ? 'text-xs' : 'text-sm'}`}>
      <RiskIcon level={level} className={compact ? 'h-3.5 w-3.5' : 'h-4 w-4'} />
      <span>{label}</span>
    </span>
  );
};

export const AlertLevelLabel: React.FC<{ level: AlertLevel; lang: Language }> = ({ level, lang }) => {
  const colorMap: Record<AlertLevel, string> = {
    all_clear: 'text-emerald-800',
    watch: 'text-amber-800',
    warning: 'text-orange-800',
    danger: 'text-red-800',
  };
  const Icon = level === 'all_clear' ? CheckCircle2 : null;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-semibold ${colorMap[level]}`}>
      {Icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : <RiskIcon level={level} className="h-3.5 w-3.5" />}
      <span>{ALERT_LABELS[level][lang]}</span>
    </span>
  );
};
