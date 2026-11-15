import { evaluateStreetRisk } from '../src/lib/riskEngine.ts';
import type {
  CommunityReport,
  FloodAlert,
  ReadingPoint,
  ReliefShelter,
  SensorNode,
  Street,
} from '../src/types/flood.ts';

function buildHistory(baseWaterCm: number, baseRainMm: number, risingBias = 0): ReadingPoint[] {
  const now = Date.now();
  const points: ReadingPoint[] = [];
  for (let i = 11; i >= 0; i--) {
    const ts = new Date(now - i * 15 * 60_000).toISOString();
    const step = 11 - i;
    const water = Math.max(8, Number((baseWaterCm - (11 - step) * risingBias + Math.sin(step * 0.7) * 2).toFixed(1)));
    const rain = Math.max(0, Number((baseRainMm + Math.cos(step * 0.6) * 2.5).toFixed(1)));
    points.push({
      timestamp: ts,
      waterLevelCm: water,
      rainfallMmHr: rain,
      riskScore: Math.min(100, Math.round((water / 120) * 65 + (rain / 50) * 35)),
    });
  }
  return points;
}

interface StreetSeed {
  id: string;
  name: string;
  nameTa: string;
  area: string;
  areaTa: string;
  coordinates: [number, number][];
  alternateRouteCoords: [number, number][];
  alternateRouteEn: string;
  alternateRouteTa: string;
  drainDepthCm: number;
  watchPct: number;
  warningPct: number;
  dangerPct: number;
  rainIntensityThresholdMmHr: number;
  baseWaterCm: number;
  baseRainMmHr: number;
  rainfall1hMm: number;
  rainfall3hMm: number;
  rainfall24hMm: number;
  risingBias: number;
  historicalEvents: Street['historicalEvents'];
}

const STREET_SEEDS: StreetSeed[] = [
  {
    id: 'anna-salai',
    name: 'Anna Salai (Near Bus Stand)',
    nameTa: 'அண்ணா சாலை (பேருந்து நிலையம் அருகில்)',
    area: 'Thousand Lights',
    areaTa: 'ஆயிரம் விளக்கு',
    coordinates: [
      [13.0612, 80.2554],
      [13.0574, 80.2535],
      [13.0531, 80.2512],
    ],
    alternateRouteCoords: [
      [13.0612, 80.2554],
      [13.0598, 80.2468],
      [13.0538, 80.2452],
      [13.0531, 80.2512],
    ],
    alternateRouteEn: 'Cathedral Rd → Nungambakkam High Rd → Greams Rd',
    alternateRouteTa: 'கதீட்ரல் சாலை → நுங்கம்பாக்கம் நெடுஞ்சாலை → கிரீம்ஸ் சாலை',
    drainDepthCm: 120,
    watchPct: 50,
    warningPct: 72,
    dangerPct: 88,
    rainIntensityThresholdMmHr: 35,
    baseWaterCm: 34,
    baseRainMmHr: 6.4,
    rainfall1hMm: 8.2,
    rainfall3hMm: 16.5,
    rainfall24hMm: 31.0,
    risingBias: 0.2,
    historicalEvents: [
      {
        year: 2023,
        month: 'December',
        peakWaterCm: 112,
        durationHours: 9,
        noteEn: 'Cyclone Michaung storm surge backed up Cooum outfall.',
        noteTa: 'மிக்ஜாம் புயல் காரணமாக கூவம் முகத்துவார நீர் தேங்கியது.',
      },
      {
        year: 2021,
        month: 'November',
        peakWaterCm: 94,
        durationHours: 6,
        noteEn: 'Subway pump trip caused 6h bus diversion.',
        noteTa: 'சுரங்கப்பாதை பம்ப் பழுதால் 6 மணி நேரம் போக்குவரத்து மாற்றம்.',
      },
    ],
  },
  {
    id: 'velachery-main',
    name: 'Velachery Main Road (Vijayanagar)',
    nameTa: 'வேளச்சேரி பிரதான சாலை (விஜயநகர்)',
    area: 'Velachery',
    areaTa: 'வேளச்சேரி',
    coordinates: [
      [12.9794, 80.2208],
      [12.9756, 80.2224],
      [12.9712, 80.2241],
    ],
    alternateRouteCoords: [
      [12.9794, 80.2208],
      [12.9822, 80.2312],
      [12.9735, 80.2335],
      [12.9712, 80.2241],
    ],
    alternateRouteEn: 'Taramani Link Rd → OMR Elevated Corridor',
    alternateRouteTa: 'தரமணி இணைப்புச் சாலை → OMR மேம்பாலம்',
    drainDepthCm: 110,
    watchPct: 48,
    warningPct: 70,
    dangerPct: 85,
    rainIntensityThresholdMmHr: 30,
    baseWaterCm: 58,
    baseRainMmHr: 18.4,
    rainfall1hMm: 19.6,
    rainfall3hMm: 38.0,
    rainfall24hMm: 62.4,
    risingBias: 1.4,
    historicalEvents: [
      {
        year: 2023,
        month: 'December',
        peakWaterCm: 128,
        durationHours: 18,
        noteEn: 'Pallikaranai marsh overflow flooded Vijayanagar roundabout.',
        noteTa: 'பள்ளிக்கரணை சதுப்புநிலம் நிரம்பி விஜயநகர் சந்திப்பில் வெள்ளம்.',
      },
    ],
  },
  {
    id: 'south-usman',
    name: 'South Usman Road (T. Nagar Ramp)',
    nameTa: 'தெற்கு உஸ்மான் சாலை (தி.நகர்)',
    area: 'T. Nagar',
    areaTa: 'தி. நகர்',
    coordinates: [
      [13.0394, 80.2314],
      [13.0355, 80.2298],
      [13.0312, 80.2284],
    ],
    alternateRouteCoords: [
      [13.0394, 80.2314],
      [13.0412, 80.2242],
      [13.0332, 80.2225],
      [13.0312, 80.2284],
    ],
    alternateRouteEn: 'Bazullah Rd → North Boag Rd → GN Chetty Rd',
    alternateRouteTa: 'பசுல்லா சாலை → வடக்கு போக் சாலை → ஜி.என். செட்டி சாலை',
    drainDepthCm: 115,
    watchPct: 50,
    warningPct: 75,
    dangerPct: 90,
    rainIntensityThresholdMmHr: 32,
    baseWaterCm: 36,
    baseRainMmHr: 7.5,
    rainfall1hMm: 8.8,
    rainfall3hMm: 19.2,
    rainfall24hMm: 35.4,
    risingBias: 0.1,
    historicalEvents: [
      {
        year: 2022,
        month: 'November',
        peakWaterCm: 88,
        durationHours: 5,
        noteEn: 'Mambalam canal crest caused localized commercial street runoff.',
        noteTa: 'மாம்பலம் கால்வாய் நிரம்பியதால் கடைவீதியில் நீர் தேங்கியது.',
      },
    ],
  },
  {
    id: 'madipakkam-koot',
    name: 'Madipakkam Koot Road',
    nameTa: 'மடிப்பாக்கம் கூட் சாலை',
    area: 'Madipakkam',
    areaTa: 'மடிப்பாக்கம்',
    coordinates: [
      [12.9636, 80.1972],
      [12.9602, 80.2004],
      [12.9564, 80.2036],
    ],
    alternateRouteCoords: [
      [12.9636, 80.1972],
      [12.9675, 80.1912],
      [12.9585, 80.1904],
      [12.9564, 80.2036],
    ],
    alternateRouteEn: 'Inner Ring Rd → Velachery Bypass Elevated Link',
    alternateRouteTa: 'உள் வட்டச் சாலை → வேளச்சேரி புறவழிச்சாலை',
    drainDepthCm: 100,
    watchPct: 45,
    warningPct: 68,
    dangerPct: 84,
    rainIntensityThresholdMmHr: 28,
    baseWaterCm: 72,
    baseRainMmHr: 24.5,
    rainfall1hMm: 26.2,
    rainfall3hMm: 49.0,
    rainfall24hMm: 78.5,
    risingBias: 2.1,
    historicalEvents: [
      {
        year: 2023,
        month: 'December',
        peakWaterCm: 135,
        durationHours: 24,
        noteEn: 'Low-lying basin held water until pumping units arrived.',
        noteTa: 'தாழ்வான பகுதி என்பதால் 24 மணி நேரம் நீர் தேங்கியது.',
      },
    ],
  },
  {
    id: 'kotturpuram-bridge',
    name: 'Kotturpuram Bridge Approach',
    nameTa: 'கோட்டூர்புரம் பாலம் அணுகு சாலை',
    area: 'Kotturpuram',
    areaTa: 'கோட்டூர்புரம்',
    coordinates: [
      [13.0172, 80.2418],
      [13.0141, 80.2441],
      [13.0108, 80.2468],
    ],
    alternateRouteCoords: [
      [13.0172, 80.2418],
      [13.0155, 80.2335],
      [13.0085, 80.2388],
      [13.0108, 80.2468],
    ],
    alternateRouteEn: 'Sardar Patel Rd → Gandhi Mandapam Flyover',
    alternateRouteTa: 'சர்தார் படேல் சாலை → காந்தி மண்டபம் மேம்பாலம்',
    drainDepthCm: 140,
    watchPct: 55,
    warningPct: 75,
    dangerPct: 90,
    rainIntensityThresholdMmHr: 40,
    baseWaterCm: 42,
    baseRainMmHr: 5.2,
    rainfall1hMm: 6.4,
    rainfall3hMm: 14.0,
    rainfall24hMm: 27.6,
    risingBias: -0.1,
    historicalEvents: [
      {
        year: 2015,
        month: 'December',
        peakWaterCm: 165,
        durationHours: 36,
        noteEn: 'Adyar river discharge breached bridge embankment.',
        noteTa: 'அடையாறு ஆற்று வெள்ளம் காரணமாக பாலம் மூடப்பட்டது.',
      },
    ],
  },
  {
    id: 'saidapet-jones',
    name: 'Saidapet Jones Road Subway',
    nameTa: 'சைதாப்பேட்டை ஜோன்ஸ் சாலை சுரங்கப்பாதை',
    area: 'Saidapet',
    areaTa: 'சைதாப்பேட்டை',
    coordinates: [
      [13.0221, 80.2244],
      [13.0206, 80.2268],
      [13.0191, 80.2296],
    ],
    alternateRouteCoords: [
      [13.0221, 80.2244],
      [13.0258, 80.2275],
      [13.0225, 80.2324],
      [13.0191, 80.2296],
    ],
    alternateRouteEn: 'Anna Salai Little Mount Overpass → Guindy Rd',
    alternateRouteTa: 'அண்ணா சாலை சின்னமலை மேம்பாலம் → கிண்டி சாலை',
    drainDepthCm: 105,
    watchPct: 45,
    warningPct: 68,
    dangerPct: 85,
    rainIntensityThresholdMmHr: 30,
    baseWaterCm: 31,
    baseRainMmHr: 8.1,
    rainfall1hMm: 9.0,
    rainfall3hMm: 18.4,
    rainfall24hMm: 34.2,
    risingBias: 0.3,
    historicalEvents: [
      {
        year: 2023,
        month: 'November',
        peakWaterCm: 98,
        durationHours: 4,
        noteEn: 'Subway closed briefly during peak cloudburst.',
        noteTa: 'மழை வெள்ளத்தால் சுரங்கப்பாதை 4 மணி நேரம் மூடப்பட்டது.',
      },
    ],
  },
  {
    id: 'mylapore-luz',
    name: 'Mylapore Luz Corner',
    nameTa: 'மயிலாப்பூர் லஸ் கார்னர்',
    area: 'Mylapore',
    areaTa: 'மயிலாப்பூர்',
    coordinates: [
      [13.0361, 80.2662],
      [13.0338, 80.2684],
      [13.0312, 80.2709],
    ],
    alternateRouteCoords: [
      [13.0361, 80.2662],
      [13.0412, 80.2715],
      [13.0345, 80.2762],
      [13.0312, 80.2709],
    ],
    alternateRouteEn: 'Dr. Radhakrishnan Salai → Santhome High Rd',
    alternateRouteTa: 'டாக்டர் ராதாகிருஷ்ணன் சாலை → சாந்தோம் நெடுஞ்சாலை',
    drainDepthCm: 115,
    watchPct: 52,
    warningPct: 74,
    dangerPct: 88,
    rainIntensityThresholdMmHr: 36,
    baseWaterCm: 28,
    baseRainMmHr: 4.8,
    rainfall1hMm: 5.5,
    rainfall3hMm: 12.1,
    rainfall24hMm: 22.8,
    risingBias: -0.2,
    historicalEvents: [
      {
        year: 2021,
        month: 'November',
        peakWaterCm: 79,
        durationHours: 3,
        noteEn: 'Buckingham Canal high tide slowed storm runoff.',
        noteTa: 'பக்கிங்காம் கால்வாய் உயர் மட்டத்தால் நீர் வடிதல் தாமதம்.',
      },
    ],
  },
  {
    id: 'adyar-lb-road',
    name: 'Adyar LB Road (Indira Nagar)',
    nameTa: 'அடையாறு L.B. சாலை (இந்திரா நகர்)',
    area: 'Adyar',
    areaTa: 'அடையாறு',
    coordinates: [
      [13.0002, 80.2561],
      [12.9964, 80.2572],
      [12.9922, 80.2586],
    ],
    alternateRouteCoords: [
      [13.0002, 80.2561],
      [12.9994, 80.2642],
      [12.9925, 80.2654],
      [12.9922, 80.2586],
    ],
    alternateRouteEn: 'Besant Avenue → Thiruvanmiyur Beach Rd',
    alternateRouteTa: 'பெசன்ட் அவென்யூ → திருவான்மியூர் கடற்கரை சாலை',
    drainDepthCm: 125,
    watchPct: 52,
    warningPct: 75,
    dangerPct: 90,
    rainIntensityThresholdMmHr: 38,
    baseWaterCm: 33,
    baseRainMmHr: 5.9,
    rainfall1hMm: 7.0,
    rainfall3hMm: 15.6,
    rainfall24hMm: 28.0,
    risingBias: 0.0,
    historicalEvents: [
      {
        year: 2022,
        month: 'December',
        peakWaterCm: 84,
        durationHours: 4,
        noteEn: 'Localized ponding cleared after silt trap cleaning.',
        noteTa: 'வடிகால் தூர்வாரிய பிறகு நீர் விரைவாக வடிந்தது.',
      },
    ],
  },
];

export function createInitialStreets(): Street[] {
  const nowIso = new Date().toISOString();
  return STREET_SEEDS.map((seed) => {
    const history = buildHistory(seed.baseWaterCm, seed.baseRainMmHr, seed.risingBias);
    const evalRes = evaluateStreetRisk({
      currentWaterCm: seed.baseWaterCm,
      drainDepthCm: seed.drainDepthCm,
      watchPct: seed.watchPct,
      warningPct: seed.warningPct,
      dangerPct: seed.dangerPct,
      rainfallMmHr: seed.baseRainMmHr,
      rainIntensityThresholdMmHr: seed.rainIntensityThresholdMmHr,
      recentHistory: history,
      forecastNext3hMm: 12,
    });

    return {
      id: seed.id,
      name: seed.name,
      nameTa: seed.nameTa,
      area: seed.area,
      areaTa: seed.areaTa,
      coordinates: seed.coordinates,
      alternateRouteCoords: seed.alternateRouteCoords,
      alternateRouteEn: seed.alternateRouteEn,
      alternateRouteTa: seed.alternateRouteTa,
      drainDepthCm: seed.drainDepthCm,
      watchPct: seed.watchPct,
      warningPct: seed.warningPct,
      dangerPct: seed.dangerPct,
      rainIntensityThresholdMmHr: seed.rainIntensityThresholdMmHr,
      currentWaterCm: seed.baseWaterCm,
      waterPct: evalRes.waterPct,
      rainfallMmHr: seed.baseRainMmHr,
      rainfall1hMm: seed.rainfall1hMm,
      rainfall3hMm: seed.rainfall3hMm,
      rainfall24hMm: seed.rainfall24hMm,
      riskScore: evalRes.riskScore,
      riskLevel: evalRes.riskLevel,
      trend: evalRes.trend,
      rateOfRiseCmPerMin: evalRes.rateOfRiseCmPerMin,
      etaDangerMinutes: evalRes.etaDangerMinutes,
      lastUpdated: nowIso,
      history,
      historicalEvents: seed.historicalEvents,
    };
  });
}

export function createInitialSensors(streets: Street[]): SensorNode[] {
  const nowIso = new Date().toISOString();
  return streets.map((street, idx) => {
    const mid = street.coordinates[Math.floor(street.coordinates.length / 2)];
    const status = idx === 6 ? 'low_battery' : 'online';
    const batteryPct = idx === 6 ? 19 : 76 + ((idx * 7) % 23);
    return {
      id: `esp32-${street.id}`,
      streetId: street.id,
      streetName: street.name,
      hardwareType: 'ESP32-S3 + JSN-SR04T + TippingBucket',
      lat: mid[0],
      lng: mid[1],
      status,
      batteryPct,
      firmwareVersion: 'v2.4.1',
      lastPingAt: nowIso,
    };
  });
}

export function createInitialAlerts(): FloodAlert[] {
  const now = Date.now();
  return [
    {
      id: 'alert-seed-1',
      streetId: 'madipakkam-koot',
      streetName: 'Madipakkam Koot Road',
      streetNameTa: 'மடிப்பாக்கம் கூட் சாலை',
      level: 'warning',
      titleEn: 'Warning · Water rising on Madipakkam Koot Road',
      titleTa: 'எச்சரிக்கை · மடிப்பாக்கம் கூட் சாலை நீர் உயர்கிறது',
      messageEn:
        'Water rising on Madipakkam Koot Road. Expected to reach danger level in ~18 min. Avoid this street. Alternate route: Inner Ring Rd → Velachery Bypass Elevated Link',
      messageTa:
        'மடிப்பாக்கம் கூட் சாலை பகுதியில் நீர் மட்டம் வேகமாக உயர்கிறது. ~18 நிமிடங்களில் அபாய நிலையை எட்டும். இந்த சாலையைத் தவிர்க்கவும். மாற்றுப் பாதை: உள் வட்டச் சாலை → வேளச்சேரி புறவழிச்சாலை',
      alternateRouteEn: 'Inner Ring Rd → Velachery Bypass Elevated Link',
      alternateRouteTa: 'உள் வட்டச் சாலை → வேளச்சேரி புறவழிச்சாலை',
      etaMinutes: 18,
      channelsDispatched: ['push', 'sms', 'email'],
      isManual: false,
      createdAt: new Date(now - 6 * 60_000).toISOString(),
    },
    {
      id: 'alert-seed-2',
      streetId: 'velachery-main',
      streetName: 'Velachery Main Road (Vijayanagar)',
      streetNameTa: 'வேளச்சேரி பிரதான சாலை (விஜயநகர்)',
      level: 'watch',
      titleEn: 'Watch · Heavy runoff on Velachery Main Road (Vijayanagar)',
      titleTa: 'கவனம் · வேளச்சேரி பிரதான சாலை மழைநீர் வரத்து',
      messageEn:
        'Drain level at 53% capacity on Velachery Main Road near Vijayanagar. Expected to reach danger level in ~38 min if rain persists.',
      messageTa:
        'வேளச்சேரி பிரதான சாலை (விஜயநகர்) பகுதியில் வடிகால் 53% நிரம்பியுள்ளது. மழை தொடர்ந்தால் ~38 நிமிடங்களில் அபாய நிலையை எட்டும்.',
      alternateRouteEn: 'Taramani Link Rd → OMR Elevated Corridor',
      alternateRouteTa: 'தரமணி இணைப்புச் சாலை → OMR மேம்பாலம்',
      etaMinutes: 38,
      channelsDispatched: ['push'],
      isManual: false,
      createdAt: new Date(now - 14 * 60_000).toISOString(),
    },
  ];
}

export function createInitialReports(): CommunityReport[] {
  const now = Date.now();
  return [
    {
      id: 'rep-seed-1',
      authorId: 'volunteer-karthik',
      authorName: 'Karthik S. (Volunteer)',
      streetId: 'anna-salai',
      streetName: 'Anna Salai (Near Bus Stand)',
      severity: 'ankle',
      description: 'Runoff pooling along the eastbound bus shelter lane; outer traffic lane remains clear.',
      photoUrl: 'asset:report_anna',
      lat: 13.0574,
      lng: 80.2535,
      status: 'verified',
      confirmations: 4,
      createdAt: new Date(now - 28 * 60_000).toISOString(),
      updatedAt: new Date(now - 20 * 60_000).toISOString(),
    },
    {
      id: 'rep-seed-2',
      authorId: 'resident-priya',
      authorName: 'Priya R.',
      streetId: 'madipakkam-koot',
      streetName: 'Madipakkam Koot Road',
      severity: 'blocked_drain',
      description: 'Storm drain grate near corner pharmacy clogged with leaves, water backing up across curb.',
      photoUrl: 'asset:report_drain',
      lat: 12.9602,
      lng: 80.2004,
      status: 'unverified',
      confirmations: 2,
      createdAt: new Date(now - 12 * 60_000).toISOString(),
      updatedAt: new Date(now - 12 * 60_000).toISOString(),
    },
  ];
}

export const INITIAL_SHELTERS: ReliefShelter[] = [
  {
    id: 'shelter-1',
    name: 'Corporation Community Relief Hall — T. Nagar',
    nameTa: 'மாநகராட்சி சமூக நிவாரண மையம் — தி.நகர்',
    type: 'shelter',
    address: '14 Habibullah Road, T. Nagar, Chennai 600017',
    lat: 13.0462,
    lng: 80.2368,
    capacity: 220,
    availableBeds: 185,
    elevationStatus: 'Elevated ground (+2.4m above street)',
    phone: '044-2815-4012',
    photoUrl: 'asset:shelter_hub',
  },
  {
    id: 'shelter-2',
    name: 'Government Royapettah Hospital Emergency Wing',
    nameTa: 'அரசு ராயப்பேட்டை மருத்துவமனை அவசர பிரிவு',
    type: 'hospital',
    address: 'Westcott Rd, Royapettah, Chennai 600014',
    lat: 13.0548,
    lng: 80.2642,
    capacity: 400,
    availableBeds: 96,
    elevationStatus: 'Dry access via Whites Rd',
    phone: '044-2848-3051',
  },
  {
    id: 'shelter-3',
    name: 'Velachery Govt Higher Secondary School Relief Camp',
    nameTa: 'வேளச்சேரி அரசு மேல்நிலைப் பள்ளி நிவாரண முகாம்',
    type: 'shelter',
    address: '100 Feet Bypass Rd, Velachery, Chennai 600042',
    lat: 12.9825,
    lng: 80.2286,
    capacity: 300,
    availableBeds: 240,
    elevationStatus: 'Upper-floor classrooms dry',
    phone: '044-2243-1913',
    photoUrl: 'asset:shelter_hub',
  },
  {
    id: 'shelter-4',
    name: 'Adyar Municipal Pump & Relief Hub',
    nameTa: 'அடையாறு நகராட்சி நிவாரண மையம்',
    type: 'relief_hub',
    address: 'Gandhi Nagar 1st Main Rd, Adyar, Chennai 600020',
    lat: 13.0055,
    lng: 80.2524,
    capacity: 150,
    availableBeds: 128,
    elevationStatus: '24/7 backup generator & medical boat',
    phone: '044-2441-1913',
  },
];
