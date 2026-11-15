import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  APIProvider,
  APILoadingStatus,
  InfoWindow,
  Map as GoogleMap,
  Pin,
  useAdvancedMarkerRef,
  useApiLoadingStatus,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Eye,
  Layers,
  Navigation,
  OctagonAlert,
  Route as RouteIcon,
  ShieldCheck,
} from 'lucide-react';
import { RISK_COLORS } from './RiskBadge.tsx';
import { RISK_LABELS } from '../lib/i18n.ts';
import type { CommunityReport, Language, ReliefShelter, Street } from '../types/flood.ts';

interface GoogleStreetMapProps {
  apiKey: string;
  streets: Street[];
  selectedStreetId: string | null;
  onSelectStreet: (streetId: string) => void;
  reports: CommunityReport[];
  shelters: ReliefShelter[];
  userLocation: [number, number] | null;
  showSafeRoute: boolean;
  lang: Language;
  onRequestLocation: () => void;
  onFallbackToOsm: () => void;
}

type SelectedInfoTarget =
  | { kind: 'street'; data: Street }
  | { kind: 'shelter'; data: ReliefShelter }
  | { kind: 'report'; data: CommunityReport };

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function StreetCorridorPolylines({
  streets,
  selectedStreetId,
  showSafeRoute,
  onSelectStreet,
}: {
  streets: Street[];
  selectedStreetId: string | null;
  showSafeRoute: boolean;
  onSelectStreet: (id: string) => void;
}) {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    const created: google.maps.Polyline[] = [];

    for (const street of streets) {
      const isSelected = street.id === selectedStreetId;
      const strokeColor = RISK_COLORS[street.riskLevel].stroke;
      const path = street.coordinates.map(([lat, lng]) => ({ lat, lng }));

      if (isSelected) {
        const halo = new google.maps.Polyline({
          path,
          geodesic: true,
          strokeColor: '#0F172A',
          strokeOpacity: 0.32,
          strokeWeight: 12,
          zIndex: 10,
          map,
        });
        created.push(halo);
      }

      const line = new google.maps.Polyline({
        path,
        geodesic: true,
        strokeColor,
        strokeOpacity: 0.92,
        strokeWeight: isSelected ? 8 : 6,
        zIndex: isSelected ? 20 : 12,
        map,
      });
      line.addListener('click', () => onSelectStreet(street.id));
      created.push(line);

      if ((isSelected && showSafeRoute) || (street.riskLevel === 'danger' && showSafeRoute)) {
        const altPath = street.alternateRouteCoords.map(([lat, lng]) => ({ lat, lng }));
        const altLine = new google.maps.Polyline({
          path: altPath,
          geodesic: true,
          strokeColor: '#0284C7',
          strokeOpacity: 0,
          strokeWeight: 4,
          zIndex: 15,
          icons: [
            {
              icon: {
                path: 'M 0,-1 0,1',
                strokeOpacity: 0.9,
                scale: 3,
              },
              offset: '0',
              repeat: '14px',
            },
          ],
          map,
        });
        created.push(altLine);
      }
    }

    polylinesRef.current = created;

    return () => {
      created.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, streets, selectedStreetId, showSafeRoute, onSelectStreet]);

  return null;
}

function SafeShelterRouteOverlay({
  active,
  origin,
  destination,
  onRouteSummary,
}: {
  active: boolean;
  origin: google.maps.LatLngLiteral | null;
  destination: google.maps.LatLngLiteral | null;
  onRouteSummary: (summary: { distanceKm: number; durationMin: number } | null, error?: string | null) => void;
}) {
  const map = useMap();
  const routesLib = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!active || !map || !routesLib || !origin || !destination) {
      onRouteSummary(null, null);
      return;
    }

    let cancelled = false;
    const RouteCtor = (routesLib as unknown as {
      Route: {
        computeRoutes: (req: unknown) => Promise<{
          routes?: Array<{
            distanceMeters?: number;
            durationMillis?: number;
            viewport?: google.maps.LatLngBounds | google.maps.LatLngBoundsLiteral;
            createPolylines?: () => google.maps.Polyline[];
            path?: google.maps.LatLng[];
          }>;
        }>;
      };
    }).Route;

    if (!RouteCtor?.computeRoutes) {
      return;
    }

    RouteCtor.computeRoutes({
      origin,
      destination,
      travelMode: 'DRIVING',
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
    })
      .then((res) => {
        if (cancelled) return;
        const primaryRoute = res?.routes?.[0];
        if (!primaryRoute) {
          onRouteSummary(null, 'No road route returned.');
          return;
        }

        const newPolys = primaryRoute.createPolylines
          ? primaryRoute.createPolylines()
          : primaryRoute.path
            ? [new google.maps.Polyline({ path: primaryRoute.path })]
            : [];

        newPolys.forEach((poly) => {
          poly.setOptions({
            strokeColor: '#0F4C81',
            strokeOpacity: 0.95,
            strokeWeight: 5,
            zIndex: 30,
          });
          poly.setMap(map);
        });
        polylinesRef.current = newPolys;

        if (primaryRoute.viewport) {
          map.fitBounds(primaryRoute.viewport);
        }

        const distanceKm = Number(((primaryRoute.distanceMeters ?? 0) / 1000).toFixed(1));
        const durationMin = Math.max(1, Math.round((primaryRoute.durationMillis ?? 0) / 60000));
        onRouteSummary({ distanceKm, durationMin }, null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (/OVER_QUERY_LIMIT|RESOURCE_EXHAUSTED|429|quota/i.test(msg)) {
          window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
        }
        onRouteSummary(null, 'Route API unavailable; showing preset municipal bypass corridor.');
      });

    return () => {
      cancelled = true;
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [active, map, routesLib, origin, destination, onRouteSummary]);

  return null;
}

function StreetSensorMarker({
  street,
  isSelected,
  lang,
  onSelect,
}: {
  street: Street;
  isSelected: boolean;
  lang: Language;
  onSelect: (street: Street, marker: google.maps.marker.AdvancedMarkerElement) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const mid = street.coordinates[Math.floor(street.coordinates.length / 2)] ?? [13.04, 80.24];
  const color = RISK_COLORS[street.riskLevel].stroke;

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: mid[0], lng: mid[1] }}
      zIndex={isSelected ? 1000 : 120}
      title={`${lang === 'ta' ? street.nameTa : street.name} (${street.waterPct}%)`}
      onClick={() => {
        if (marker) onSelect(street, marker);
      }}
    >
      <div
        className={`flex items-center gap-1 rounded-full border-2 border-white px-2 py-0.5 text-[11px] font-bold text-white shadow-md transition-transform ${
          isSelected ? 'scale-110 ring-2 ring-slate-900/40' : ''
        }`}
        style={{ backgroundColor: color }}
      >
        <span>{street.waterPct}%</span>
      </div>
    </AdvancedMarker>
  );
}

function ShelterPinMarker({
  shelter,
  lang,
  onSelect,
}: {
  shelter: ReliefShelter;
  lang: Language;
  onSelect: (shelter: ReliefShelter, marker: google.maps.marker.AdvancedMarkerElement) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const glyph = shelter.type === 'hospital' ? 'H' : shelter.type === 'shelter' ? 'S' : 'R';
  const bg = shelter.type === 'hospital' ? '#DC2626' : '#0F4C81';

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: shelter.lat, lng: shelter.lng }}
      zIndex={90}
      title={lang === 'ta' ? shelter.nameTa : shelter.name}
      onClick={() => {
        if (marker) onSelect(shelter, marker);
      }}
    >
      <Pin background={bg} borderColor="#FFFFFF" glyphColor="#FFFFFF" glyphText={glyph} scale={0.9} />
    </AdvancedMarker>
  );
}

function ReportPinMarker({
  report,
  onSelect,
}: {
  report: CommunityReport;
  onSelect: (report: CommunityReport, marker: google.maps.marker.AdvancedMarkerElement) => void;
}) {
  const [markerRef, marker] = useAdvancedMarkerRef();
  const isVerified = report.status === 'verified';

  return (
    <AdvancedMarker
      ref={markerRef}
      position={{ lat: report.lat, lng: report.lng }}
      zIndex={80}
      title={report.streetName}
      onClick={() => {
        if (marker) onSelect(report, marker);
      }}
    >
      <Pin
        background={isVerified ? '#EA580C' : '#64748B'}
        borderColor="#FFFFFF"
        glyphColor="#FFFFFF"
        glyphText="!"
        scale={0.82}
      />
    </AdvancedMarker>
  );
}

function InnerGoogleMap({
  streets,
  selectedStreetId,
  onSelectStreet,
  reports,
  shelters,
  userLocation,
  showSafeRoute,
  lang,
  onRequestLocation,
  onFallbackToOsm,
}: Omit<GoogleStreetMapProps, 'apiKey'>) {
  const map = useMap();
  const loadingStatus = useApiLoadingStatus();

  const [showShelters, setShowShelters] = useState(true);
  const [showReports, setShowReports] = useState(true);
  const [computeShelterRoute, setComputeShelterRoute] = useState(false);
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [infoAnchor, setInfoAnchor] = useState<google.maps.marker.AdvancedMarkerElement | null>(null);
  const [infoTarget, setInfoTarget] = useState<SelectedInfoTarget | null>(null);

  useEffect(() => {
    if (loadingStatus === APILoadingStatus.AUTH_FAILURE) {
      window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
    }
  }, [loadingStatus]);

  const selectedStreet = useMemo(
    () => streets.find((s) => s.id === selectedStreetId) ?? streets[0] ?? null,
    [streets, selectedStreetId]
  );

  // Smoothly pan map when selected street changes
  useEffect(() => {
    if (!map || !selectedStreet || selectedStreet.coordinates.length === 0) return;
    const mid = selectedStreet.coordinates[Math.floor(selectedStreet.coordinates.length / 2)];
    map.panTo({ lat: mid[0], lng: mid[1] });
  }, [map, selectedStreet]);

  const nearestShelter = useMemo(() => {
    if (!selectedStreet || shelters.length === 0) return null;
    const mid = selectedStreet.coordinates[Math.floor(selectedStreet.coordinates.length / 2)] ?? [13.04, 80.24];
    return shelters.reduce<{ shelter: ReliefShelter; distKm: number } | null>((best, sh) => {
      const d = haversineKm(mid[0], mid[1], sh.lat, sh.lng);
      if (!best || d < best.distKm) return { shelter: sh, distKm: d };
      return best;
    }, null)?.shelter ?? null;
  }, [selectedStreet, shelters]);

  const routeOrigin = useMemo(() => {
    if (userLocation) return { lat: userLocation[0], lng: userLocation[1] };
    if (!selectedStreet) return null;
    const first = selectedStreet.coordinates[0];
    return first ? { lat: first[0], lng: first[1] } : null;
  }, [userLocation, selectedStreet]);

  const routeDest = useMemo(() => {
    if (!nearestShelter) return null;
    return { lat: nearestShelter.lat, lng: nearestShelter.lng };
  }, [nearestShelter]);

  const handleRouteSummary = useCallback(
    (summary: { distanceKm: number; durationMin: number } | null, error?: string | null) => {
      setRouteSummary(summary);
      setRouteError(error ?? null);
    },
    []
  );

  if (loadingStatus === APILoadingStatus.FAILED || loadingStatus === APILoadingStatus.AUTH_FAILURE) {
    return (
      <div className="flex h-[430px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-amber-200 bg-amber-50/70 p-6 text-center md:h-[560px]">
        <AlertTriangle className="h-8 w-8 text-amber-700" />
        <h3 className="font-display text-base font-bold text-slate-900">
          {lang === 'ta' ? 'Google வரைபடம் ஏற்றப்படவில்லை' : 'Google Maps could not initialize'}
        </h3>
        <p className="max-w-md text-xs text-slate-600">
          Switch to the built-in OpenStreetMap view to inspect live street sensors, relief hubs, and citizen reports without interruption.
        </p>
        <button
          type="button"
          onClick={onFallbackToOsm}
          className="min-h-[42px] rounded-xl bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c3c66]"
        >
          Switch to OpenStreetMap View
        </button>
      </div>
    );
  }

  return (
    <div className="relative isolate flex h-[430px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 md:h-[560px]">
      <GoogleMap
        mapId="DEMO_MAP_ID"
        internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
        defaultCenter={{ lat: 13.025, lng: 80.242 }}
        defaultZoom={12}
        gestureHandling="greedy"
        disableDefaultUI={false}
        fullscreenControl={false}
        streetViewControl={false}
        mapTypeControl={false}
        style={{ width: '100%', height: '100%' }}
      >
        <StreetCorridorPolylines
          streets={streets}
          selectedStreetId={selectedStreetId}
          showSafeRoute={showSafeRoute}
          onSelectStreet={onSelectStreet}
        />

        <SafeShelterRouteOverlay
          active={computeShelterRoute}
          origin={routeOrigin}
          destination={routeDest}
          onRouteSummary={handleRouteSummary}
        />

        {streets.map((street) => (
          <StreetSensorMarker
            key={street.id}
            street={street}
            isSelected={street.id === selectedStreetId}
            lang={lang}
            onSelect={(st, marker) => {
              onSelectStreet(st.id);
              setInfoAnchor(marker);
              setInfoTarget({ kind: 'street', data: st });
            }}
          />
        ))}

        {showShelters &&
          shelters.map((shelter) => (
            <ShelterPinMarker
              key={shelter.id}
              shelter={shelter}
              lang={lang}
              onSelect={(sh, marker) => {
                setInfoAnchor(marker);
                setInfoTarget({ kind: 'shelter', data: sh });
              }}
            />
          ))}

        {showReports &&
          reports
            .filter((r) => r.status !== 'resolved')
            .map((rep) => (
              <ReportPinMarker
                key={rep.id}
                report={rep}
                onSelect={(r, marker) => {
                  setInfoAnchor(marker);
                  setInfoTarget({ kind: 'report', data: r });
                }}
              />
            ))}

        {userLocation && (
          <AdvancedMarker position={{ lat: userLocation[0], lng: userLocation[1] }} title="Your Location" zIndex={500}>
            <div className="h-4 w-4 rounded-full border-2 border-white bg-[#0F4C81] shadow-[0_0_0_4px_rgba(15,76,129,0.28)]" />
          </AdvancedMarker>
        )}

        {infoAnchor && infoTarget && (
          <InfoWindow
            anchor={infoAnchor}
            onCloseClick={() => {
              setInfoAnchor(null);
              setInfoTarget(null);
            }}
          >
            <div className="max-w-[230px] text-slate-900">
              {infoTarget.kind === 'street' && (
                <>
                  <div className="text-xs font-bold">{lang === 'ta' ? infoTarget.data.nameTa : infoTarget.data.name}</div>
                  <div className="mt-1 font-mono text-[11px] text-slate-600">
                    {infoTarget.data.currentWaterCm}/{infoTarget.data.drainDepthCm} cm ({infoTarget.data.waterPct}%) ·{' '}
                    {infoTarget.data.rainfallMmHr} mm/hr
                  </div>
                  <div className="mt-1 text-[11px] font-semibold text-sky-800">
                    Bypass: {lang === 'ta' ? infoTarget.data.alternateRouteTa : infoTarget.data.alternateRouteEn}
                  </div>
                </>
              )}
              {infoTarget.kind === 'shelter' && (
                <>
                  <div className="text-xs font-bold">{lang === 'ta' ? infoTarget.data.nameTa : infoTarget.data.name}</div>
                  <div className="mt-1 text-[11px] text-slate-600">{infoTarget.data.address}</div>
                  <div className="mt-1 text-[11px] font-semibold text-[#0F4C81]">{infoTarget.data.elevationStatus}</div>
                  <div className="mt-1 text-[11px] text-slate-700">
                    Beds: {infoTarget.data.availableBeds}/{infoTarget.data.capacity} · {infoTarget.data.phone}
                  </div>
                </>
              )}
              {infoTarget.kind === 'report' && (
                <>
                  <div className="text-[11px] font-semibold text-orange-700">
                    {infoTarget.data.status === 'verified' ? 'Verified Citizen Report' : 'Unverified Citizen Report'} ·{' '}
                    {infoTarget.data.confirmations} confirmations
                  </div>
                  <div className="mt-0.5 text-xs font-bold">{infoTarget.data.streetName}</div>
                  <div className="mt-1 text-[11px] text-slate-700">{infoTarget.data.description}</div>
                </>
              )}
            </div>
          </InfoWindow>
        )}
      </GoogleMap>

      {/* Top overlay controls */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur-sm">
          <span className="flex items-center gap-1 px-2 text-xs font-semibold text-slate-700">
            <Layers className="h-3.5 w-3.5 text-[#0F4C81]" />
            Layers
          </span>
          <button
            type="button"
            onClick={() => setShowShelters((v) => !v)}
            className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              showShelters ? 'bg-[#0F4C81] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Shelters & Hospitals
          </button>
          <button
            type="button"
            onClick={() => setShowReports((v) => !v)}
            className={`min-h-[34px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              showReports ? 'bg-[#0F4C81] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Citizen Reports
          </button>
          <button
            type="button"
            onClick={() => setComputeShelterRoute((v) => !v)}
            className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              computeShelterRoute ? 'bg-sky-700 text-white' : 'bg-sky-50 text-sky-900 hover:bg-sky-100'
            }`}
          >
            <RouteIcon className="h-3.5 w-3.5" />
            {computeShelterRoute ? 'Hide Shelter Route' : 'Route to Nearest Shelter'}
          </button>
        </div>

        <button
          type="button"
          onClick={onRequestLocation}
          className="pointer-events-auto inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-1.5 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <Navigation className="h-3.5 w-3.5 text-[#0F4C81]" />
          {lang === 'ta' ? 'என் இடம்' : 'My Location'}
        </button>
      </div>

      {/* Live Computed Route Summary */}
      {computeShelterRoute && (routeSummary || routeError) && (
        <div className="pointer-events-auto absolute top-16 left-3 z-10 max-w-xs rounded-xl border border-sky-200 bg-white/95 px-3 py-2 text-xs text-slate-800 shadow-sm">
          {routeSummary ? (
            <div className="font-medium">
              <span className="font-bold text-[#0F4C81]">Shelter Route:</span> {routeSummary.distanceKm} km · ~
              {routeSummary.durationMin} min drive
              {nearestShelter ? ` → ${nearestShelter.name}` : ''}
            </div>
          ) : (
            <div className="text-amber-800">{routeError}</div>
          )}
        </div>
      )}

      {/* Bottom-left color-blind safe legend */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-10 hidden sm:flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm">
        <span className="inline-flex items-center gap-1 text-emerald-800">
          <ShieldCheck className="h-3.5 w-3.5" /> {RISK_LABELS.safe[lang]}
        </span>
        <span className="inline-flex items-center gap-1 text-amber-800">
          <Eye className="h-3.5 w-3.5" /> {RISK_LABELS.watch[lang]}
        </span>
        <span className="inline-flex items-center gap-1 text-orange-800">
          <AlertTriangle className="h-3.5 w-3.5" /> {RISK_LABELS.warning[lang]}
        </span>
        <span className="inline-flex items-center gap-1 text-red-800">
          <OctagonAlert className="h-3.5 w-3.5" /> {RISK_LABELS.danger[lang]}
        </span>
      </div>
    </div>
  );
}

export const GoogleStreetMap: React.FC<GoogleStreetMapProps> = ({ apiKey, ...rest }) => {
  if (!apiKey) {
    return (
      <div className="flex h-[430px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-slate-200 bg-white p-6 text-center md:h-[560px]">
        <AlertTriangle className="h-7 w-7 text-amber-600" />
        <p className="text-sm font-semibold text-slate-900">Google Maps API key not yet loaded in runtime environment.</p>
        <button
          type="button"
          onClick={rest.onFallbackToOsm}
          className="min-h-[40px] rounded-xl bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c3c66]"
        >
          Use OpenStreetMap View
        </button>
      </div>
    );
  }

  return (
    <APIProvider
      apiKey={apiKey}
      language={rest.lang === 'ta' ? 'ta' : 'en'}
      region="IN"
      libraries={['marker', 'routes']}
    >
      <InnerGoogleMap {...rest} />
    </APIProvider>
  );
};
