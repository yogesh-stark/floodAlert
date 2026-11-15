import React from 'react';
import {
  Cloud,
  CloudDrizzle,
  CloudLightning,
  CloudRain,
  CloudRainWind,
  CloudSun,
  Sun,
} from 'lucide-react';
import type { Language, WeatherCondition } from '../types/flood.ts';

interface WeatherForecastIconProps {
  condition?: string | null;
  lang?: Language;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

interface ConditionVisual {
  normalized: WeatherCondition;
  labelEn: string;
  labelTa: string;
  icon: React.ComponentType<{ className?: string }>;
  badgeClasses: string;
  iconClasses: string;
}

const CONDITION_VISUALS: Record<WeatherCondition, ConditionVisual> = {
  sunny: {
    normalized: 'sunny',
    labelEn: 'Sunny',
    labelTa: 'வெயில்',
    icon: Sun,
    badgeClasses: 'border-amber-200 bg-amber-50 text-amber-900',
    iconClasses: 'text-amber-600',
  },
  partly_cloudy: {
    normalized: 'partly_cloudy',
    labelEn: 'Partly Cloudy',
    labelTa: 'பகுதி மேகமூட்டம்',
    icon: CloudSun,
    badgeClasses: 'border-amber-200/80 bg-amber-50/70 text-slate-800',
    iconClasses: 'text-amber-600',
  },
  cloudy: {
    normalized: 'cloudy',
    labelEn: 'Cloudy',
    labelTa: 'மேகமூட்டம்',
    icon: Cloud,
    badgeClasses: 'border-slate-200 bg-slate-100 text-slate-700',
    iconClasses: 'text-slate-600',
  },
  rainy: {
    normalized: 'rainy',
    labelEn: 'Rainy',
    labelTa: 'மழை',
    icon: CloudRain,
    badgeClasses: 'border-sky-200 bg-sky-50 text-sky-900',
    iconClasses: 'text-sky-700',
  },
  heavy_rain: {
    normalized: 'heavy_rain',
    labelEn: 'Heavy Rain',
    labelTa: 'கனமழை',
    icon: CloudRainWind,
    badgeClasses: 'border-sky-300 bg-sky-100 text-[#0F4C81]',
    iconClasses: 'text-[#0F4C81]',
  },
  thunderstorm: {
    normalized: 'thunderstorm',
    labelEn: 'Thunderstorm',
    labelTa: 'இடி மின்னல் மழை',
    icon: CloudLightning,
    badgeClasses: 'border-red-200 bg-red-50 text-red-900',
    iconClasses: 'text-red-700',
  },
};

export function normalizeWeatherCondition(condition?: string | null): WeatherCondition {
  const value = (condition || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!value) return 'rainy';
  if (value.includes('thunder') || value.includes('lightning') || value.includes('storm') || value.includes('squall')) {
    return 'thunderstorm';
  }
  if (value.includes('heavy') || value.includes('downpour') || value.includes('cloudburst')) {
    return 'heavy_rain';
  }
  if (value.includes('rain') || value.includes('shower') || value.includes('drizzle') || value.includes('monsoon')) {
    return 'rainy';
  }
  if (value.includes('partly') || value.includes('scattered')) {
    return 'partly_cloudy';
  }
  if (value.includes('cloud') || value.includes('overcast') || value.includes('fog') || value.includes('mist')) {
    return 'cloudy';
  }
  if (value.includes('sun') || value.includes('clear')) {
    return 'sunny';
  }
  return 'rainy';
}

export const WeatherForecastIcon: React.FC<WeatherForecastIconProps> = ({
  condition,
  lang = 'en',
  size = 'sm',
  showLabel = false,
  className = '',
}) => {
  const rawLower = (condition || '').trim().toLowerCase();
  const normalized = normalizeWeatherCondition(condition);
  const visual = CONDITION_VISUALS[normalized];
  const IconComponent = rawLower.includes('drizzle') ? CloudDrizzle : visual.icon;
  const label = lang === 'ta' ? visual.labelTa : visual.labelEn;

  const iconSizeClass =
    size === 'lg' ? 'h-5 w-5' : size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5';

  if (!showLabel) {
    return (
      <span
        className={`inline-flex items-center justify-center rounded-md border p-1 ${visual.badgeClasses} ${className}`}
        title={label}
        aria-label={`Weather forecast condition: ${label}`}
      >
        <IconComponent className={`${iconSizeClass} ${visual.iconClasses}`} />
      </span>
    );
  }

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 text-[11px] font-semibold ${visual.badgeClasses} ${className}`}
      title={label}
      aria-label={`Weather forecast condition: ${label}`}
    >
      <IconComponent className={`${iconSizeClass} shrink-0 ${visual.iconClasses}`} />
      <span>{label}</span>
    </span>
  );
};
