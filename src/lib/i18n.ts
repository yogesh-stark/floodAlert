import type { AlertLevel, Language, ReportSeverity, RiskLevel, TrendDirection } from '../types/flood.ts';

export const RISK_LABELS: Record<RiskLevel, { en: string; ta: string }> = {
  safe: { en: 'Safe', ta: 'பாதுகாப்பு' },
  watch: { en: 'Watch', ta: 'கவனம்' },
  warning: { en: 'Warning', ta: 'எச்சரிக்கை' },
  danger: { en: 'Danger', ta: 'அபாயம்' },
};

export const ALERT_LABELS: Record<AlertLevel, { en: string; ta: string }> = {
  watch: { en: 'Watch', ta: 'கவனம்' },
  warning: { en: 'Warning', ta: 'எச்சரிக்கை' },
  danger: { en: 'Danger', ta: 'அபாயம்' },
  all_clear: { en: 'All Clear', ta: 'நிலைமை சீரானது' },
};

export const TREND_LABELS: Record<TrendDirection, { en: string; ta: string }> = {
  rising: { en: 'Rising', ta: 'உயர்கிறது' },
  steady: { en: 'Steady', ta: 'நிலையானது' },
  falling: { en: 'Falling', ta: 'குறைகிறது' },
};

export const SEVERITY_LABELS: Record<ReportSeverity, { en: string; ta: string }> = {
  ankle: { en: 'Ankle-deep (~15 cm)', ta: 'கணுக்கால் அளவு (~15 செ.மீ)' },
  knee: { en: 'Knee-deep (~45 cm)', ta: 'முழங்கால் அளவு (~45 செ.மீ)' },
  waist: { en: 'Waist-deep (75+ cm)', ta: 'இடுப்பு அளவு (75+ செ.மீ)' },
  blocked_drain: { en: 'Blocked storm drain', ta: 'அடைபட்ட மழைநீர் வடிகால்' },
};

export const UI_COPY = {
  en: {
    brand: 'StreetFlood Alert',
    navMap: 'Live Map',
    navAI: 'AI & Voice',
    navGame: '3D Rescue',
    navAlerts: 'Alerts & Routes',
    navReport: 'Report',
    navPrepare: 'Prepare',
    navAdmin: 'Admin',
    checkMyStreet: 'Check My Street',
    heroKicker: 'Hyper-local drain & rain telemetry · Chennai Pilot',
    heroTitle: 'Know if your street is flooding before water reaches your doorstep.',
    heroSubtitle:
      'Citywide weather forecasts miss street-level bottlenecks. StreetFlood Alert pairs ultrasonic storm-drain sensors with rain gauges to warn residents 20–45 minutes before streets become impassable.',
    searchPlaceholder: 'Search street or neighborhood (e.g. Anna Salai, Velachery)...',
    useMyLocation: 'Use My Location',
    simulateHeavyRain: 'Simulate Heavy Rain',
    simulatingRain: 'Heavy Rain Active',
    resetDemo: 'Drain & Reset',
    howItWorksTitle: 'How early street warnings work',
    step1Title: '01. Street Sensors',
    step1Desc: 'Ultrasonic drain depth and tipping-bucket rain gauges report every 60 seconds.',
    step2Title: '02. Risk Engine',
    step2Desc: 'Combines drain fill %, rate of rise, and 3-hour forecast to estimate time to danger.',
    step3Title: '03. Plain Alerts',
    step3Desc: 'Sends English & Tamil warnings with safe alternate routes via Push, SMS, and Email.',
    step4Title: '04. Residents Act',
    step4Desc: 'Commuters reroute early and move parked vehicles before drains overflow.',
    waterLevel: 'Drain Water Level',
    rainIntensity: 'Rain Intensity',
    rainTotals: 'Rainfall (1h / 3h / 24h)',
    trend: 'Level Trend',
    etaDanger: 'Est. Time to Danger',
    noImmediateDanger: 'Not rising toward danger',
    alternateRoute: 'Safe Alternate Route',
    subscribeStreet: 'Subscribe to Street Alerts',
    subscribedStreet: 'Subscribed to Alerts',
    nearestSafeHub: 'Nearest Relief Shelter',
    signInGoogle: 'Sign In with Google',
    signOut: 'Sign Out',
    roleResident: 'Resident',
    roleReporter: 'Volunteer Reporter',
    roleAdmin: 'Municipal Admin',
    submitReport: 'Submit Waterlogging Report',
    beforeFlood: 'Before Monsoon / Heavy Rain',
    duringFlood: 'During Rising Water',
    afterFlood: 'After Water Recedes',
    helplinesTitle: 'Emergency Contacts & Helplines',
    pastHistoryTitle: 'Past Flooding History by Street',
  },
  ta: {
    brand: 'StreetFlood Alert',
    navMap: 'நேரலை வரைபடம்',
    navAI: 'AI & குரல்',
    navGame: '3D மீட்பு',
    navAlerts: 'எச்சரிக்கை & பாதை',
    navReport: 'புகார்',
    navPrepare: 'முன்னெச்சரிக்கை',
    navAdmin: 'நிர்வாகம்',
    checkMyStreet: 'என் தெருவை சரிபார்',
    heroKicker: 'தெரு அளவிலான வடிகால் & மழை அளவீடு · சென்னை',
    heroTitle: 'உங்கள் தெருவில் வெள்ளம் வருவதற்கு முன்பே முன்கூட்டியே அறியுங்கள்.',
    heroSubtitle:
      'நகர அளவிலான வானிலை அறிக்கைகள் தெரு அளவிலான வடிகால் நிரம்பலைக் காட்டுவதில்லை. StreetFlood Alert வடிகால் சென்சார்கள் மற்றும் மழைமானிகளை இணைத்து 20–45 நிமிடங்களுக்கு முன்பே எச்சரிக்கிறது.',
    searchPlaceholder: 'தெரு அல்லது பகுதியைத் தேடுங்கள் (எ.கா. அண்ணா சாலை, வேளச்சேரி)...',
    useMyLocation: 'என் இருப்பிடம்',
    simulateHeavyRain: 'கனமழை சோதனை',
    simulatingRain: 'கனமழை சோதனை செயல்பாட்டில்',
    resetDemo: 'நீர் வடிப்பு & மீட்டமை',
    howItWorksTitle: 'தெரு அளவிலான எச்சரிக்கை எவ்வாறு செயல்படுகிறது',
    step1Title: '01. தெரு சென்சார்கள்',
    step1Desc: 'அல்ட்ராசோனிக் வடிகால் சென்சார்கள் & மழைமானிகள் 60 வினாடிகளுக்கு ஒருமுறை தகவல் அனுப்பும்.',
    step2Title: '02. அபாய கணிப்பு',
    step2Desc: 'நீர் நிரம்பும் வேகம் மற்றும் மழை அளவைக் கணக்கிட்டு அபாய நேரத்தை கணிக்கும்.',
    step3Title: '03. எளிய எச்சரிக்கை',
    step3Desc: 'தமிழ் & ஆங்கிலத்தில் மாற்றுப் பாதையுடன் Push, SMS, மின்னஞ்சல் எச்சரிக்கை.',
    step4Title: '04. பாதுகாப்பு நடவடிக்கை',
    step4Desc: 'குடியிருப்பாளர்கள் வாகனங்களை பாதுகாத்து பாதுகாப்பான பாதையில் செல்லலாம்.',
    waterLevel: 'வடிகால் நீர் மட்டம்',
    rainIntensity: 'மழை அளவு',
    rainTotals: 'மொத்த மழை (1ம / 3ம / 24ம)',
    trend: 'நீர் நிலை போக்கு',
    etaDanger: 'அபாய நிலை அடையும் நேரம்',
    noImmediateDanger: 'தற்போது அபாய உயர்வு இல்லை',
    alternateRoute: 'பாதுகாப்பான மாற்றுப் பாதை',
    subscribeStreet: 'எச்சரிக்கை பெற இணையவும்',
    subscribedStreet: 'எச்சரிக்கை இயக்கப்பட்டது',
    nearestSafeHub: 'அருகிலுள்ள நிவாரண மையம்',
    signInGoogle: 'Google மூலம் உள்நுழைய',
    signOut: 'வெளியேறு',
    roleResident: 'குடியிருப்பாளர்',
    roleReporter: 'தன்னார்வலர்',
    roleAdmin: 'நகராட்சி நிர்வாகம்',
    submitReport: 'நீர் தேக்கம் புகார் அளிக்கவும்',
    beforeFlood: 'மழைக்காலத்திற்கு முன்',
    duringFlood: 'நீர் உயரும் போது',
    afterFlood: 'நீர் வடிந்த பிறகு',
    helplinesTitle: 'அவசர உதவி எண்கள்',
    pastHistoryTitle: 'தெரு வாரியான முந்தைய வெள்ள வரலாறு',
  },
} as const;

export function t(lang: Language) {
  return UI_COPY[lang];
}

export function formatAlertCopy(params: {
  streetName: string;
  streetNameTa: string;
  level: AlertLevel;
  etaMinutes: number | null;
  alternateRouteEn: string;
  alternateRouteTa: string;
}): { titleEn: string; titleTa: string; messageEn: string; messageTa: string } {
  const { streetName, streetNameTa, level, etaMinutes, alternateRouteEn, alternateRouteTa } = params;
  if (level === 'all_clear') {
    return {
      titleEn: `All Clear · ${streetName}`,
      titleTa: `நிலைமை சீரானது · ${streetNameTa}`,
      messageEn: `Drain levels have receded on ${streetName}. Street is now passable, though minor puddles may remain.`,
      messageTa: `${streetNameTa} பகுதியில் வடிகால் நீர் மட்டம் குறைந்துள்ளது. சாலை தற்போது போக்குவரத்திற்கு ஏற்றது.`,
    };
  }

  const etaTextEn = etaMinutes !== null ? `Expected to reach danger level in ~${etaMinutes} min.` : 'Water level is elevated.';
  const etaTextTa =
    etaMinutes !== null ? `~${etaMinutes} நிமிடங்களில் அபாய நிலையை எட்டும் என எதிர்பார்க்கப்படுகிறது.` : 'நீர் மட்டம் உயர்ந்துள்ளது.';

  if (level === 'danger') {
    return {
      titleEn: `Danger · Avoid ${streetName}`,
      titleTa: `அபாயம் · ${streetNameTa} தவிர்க்கவும்`,
      messageEn: `Critical waterlogging on ${streetName}. Drain capacity exceeded. Avoid this street. Alternate route: ${alternateRouteEn}`,
      messageTa: `${streetNameTa} பகுதியில் அதிகளவு நீர் தேங்கியுள்ளது. இந்த சாலையைத் தவிர்க்கவும். மாற்றுப் பாதை: ${alternateRouteTa}`,
    };
  }

  if (level === 'warning') {
    return {
      titleEn: `Warning · Water rising on ${streetName}`,
      titleTa: `எச்சரிக்கை · ${streetNameTa} நீர் உயர்கிறது`,
      messageEn: `Water rising on ${streetName}. ${etaTextEn} Avoid this street. Alternate route: ${alternateRouteEn}`,
      messageTa: `${streetNameTa} பகுதியில் நீர் மட்டம் வேகமாக உயர்கிறது. ${etaTextTa} இந்த சாலையைத் தவிர்க்கவும். மாற்றுப் பாதை: ${alternateRouteTa}`,
    };
  }

  return {
    titleEn: `Watch · Heavy runoff on ${streetName}`,
    titleTa: `கவனம் · ${streetNameTa} மழைநீர் வரத்து`,
    messageEn: `Drain level rising on ${streetName}. ${etaTextEn} Monitor updates or use ${alternateRouteEn}.`,
    messageTa: `${streetNameTa} பகுதியில் வடிகால் நீர் மட்டம் உயர்கிறது. ${etaTextTa} மாற்றுப் பாதை: ${alternateRouteTa}`,
  };
}
