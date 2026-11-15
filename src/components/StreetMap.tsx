import React, { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import { Layers, Navigation, ShieldCheck, Eye, AlertTriangle, OctagonAlert } from 'lucide-react';
import { RISK_COLORS } from './RiskBadge.tsx';
import { RISK_LABELS } from '../lib/i18n.ts';
import type { CommunityReport, Language, ReliefShelter, Street } from '../types/flood.ts';

interface StreetMapProps {
  streets: Street[];
  selectedStreetId: string | null;
  onSelectStreet: (streetId: string) => void;
  reports: CommunityReport[];
  shelters: ReliefShelter[];
  userLocation: [number, number] | null;
  showSafeRoute: boolean;
  lang: Language;
  onRequestLocation: () => void;
}

export const StreetMap: React.FC<StreetMapProps> = ({
  streets,
  selectedStreetId,
  onSelectStreet,
  reports,
  shelters,
  userLocation,
  showSafeRoute,
  lang,
  onRequestLocation,
}) => {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const layersRef = useRef<L.LayerGroup | null>(null);

  const [showShelters, setShowShelters] = useState(true);
  const [showReports, setShowReports] = useState(true);

  // Initialize Leaflet map once
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [13.025, 80.242],
      zoom: 12,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '&copy; OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map);

    const group = L.layerGroup().addTo(map);
    mapRef.current = map;
    layersRef.current = group;

    return () => {
      map.remove();
      mapRef.current = null;
      layersRef.current = null;
    };
  }, []);

  // Re-render streets, safe alternate routes, reports, shelters, and user marker
  useEffect(() => {
    const map = mapRef.current;
    const group = layersRef.current;
    if (!map || !group) return;

    group.clearLayers();

    for (const street of streets) {
      const isSelected = street.id === selectedStreetId;
      const color = RISK_COLORS[street.riskLevel].stroke;
      const labelName = lang === 'ta' ? street.nameTa : street.name;
      const statusText = RISK_LABELS[street.riskLevel][lang];

      // Outer halo for selected street
      if (isSelected) {
        L.polyline(street.coordinates, {
          color: '#0F172A',
          weight: 12,
          opacity: 0.35,
          lineCap: 'round',
        }).addTo(group);
      }

      // Main street status polyline
      const line = L.polyline(street.coordinates, {
        color,
        weight: isSelected ? 8 : 6,
        opacity: 0.92,
        lineCap: 'round',
      }).addTo(group);

      line.bindTooltip(
        `${labelName} · ${statusText} (${street.waterPct}%)`,
        { sticky: true, className: 'street-label-tooltip' }
      );
      line.on('click', () => onSelectStreet(street.id));

      // Sensor midpoint marker
      const mid = street.coordinates[Math.floor(street.coordinates.length / 2)];
      const sensorMarker = L.circleMarker(mid, {
        radius: isSelected ? 8 : 6,
        color: '#FFFFFF',
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      }).addTo(group);
      sensorMarker.on('click', () => onSelectStreet(street.id));

      // Safe alternate route polyline if selected or in danger/warning
      if ((isSelected && showSafeRoute) || (street.riskLevel === 'danger' && showSafeRoute)) {
        const altLine = L.polyline(street.alternateRouteCoords, {
          color: '#0284C7',
          weight: 4,
          dashArray: '8 8',
          opacity: 0.9,
        }).addTo(group);
        altLine.bindTooltip(
          `${lang === 'ta' ? 'மாற்றுப் பாதை' : 'Safe Alternate'}: ${
            lang === 'ta' ? street.alternateRouteTa : street.alternateRouteEn
          }`,
          { sticky: true, className: 'street-label-tooltip' }
        );
      }
    }

    // Relief shelters & hospitals
    if (showShelters) {
      for (const shelter of shelters) {
        const badgeChar = shelter.type === 'hospital' ? 'H' : shelter.type === 'shelter' ? 'S' : 'R';
        const bgColor = shelter.type === 'hospital' ? '#DC2626' : '#0F4C81';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:26px;height:26px;border-radius:8px;background:${bgColor};color:#fff;font-weight:700;font-size:12px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.28);">${badgeChar}</div>`,
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        const marker = L.marker([shelter.lat, shelter.lng], { icon }).addTo(group);
        marker.bindPopup(
          `<div style="min-width:190px">
            <strong style="font-size:13px;color:#0F172A">${lang === 'ta' ? shelter.nameTa : shelter.name}</strong>
            <div style="font-size:11px;color:#475569;margin-top:4px">${shelter.address}</div>
            <div style="font-size:11px;color:#0F4C81;font-weight:600;margin-top:6px">${shelter.elevationStatus}</div>
            <div style="font-size:11px;color:#334155;margin-top:4px">Beds open: ${shelter.availableBeds}/${shelter.capacity} · Tel: ${shelter.phone}</div>
          </div>`
        );
      }
    }

    // Community waterlogging reports
    if (showReports) {
      for (const rep of reports) {
        if (rep.status === 'resolved') continue;
        const isVerified = rep.status === 'verified';
        const icon = L.divIcon({
          className: '',
          html: `<div style="width:24px;height:24px;border-radius:9999px;background:${
            isVerified ? '#EA580C' : '#64748B'
          };color:#fff;font-weight:700;font-size:11px;display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.25);">!</div>`,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
        });
        const marker = L.marker([rep.lat, rep.lng], { icon }).addTo(group);
        marker.bindPopup(
          `<div style="min-width:190px">
            <div style="font-size:11px;font-weight:600;color:${isVerified ? '#C2410C' : '#475569'}">${
            isVerified ? 'Verified Citizen Report' : 'Unverified Citizen Report'
          } · ${rep.confirmations} confirmations</div>
            <strong style="font-size:13px;color:#0F172A;display:block;margin-top:2px">${rep.streetName}</strong>
            <p style="font-size:12px;color:#334155;margin-top:4px">${rep.description}</p>
          </div>`
        );
      }
    }

    // User location pin
    if (userLocation) {
      const userIcon = L.divIcon({
        className: '',
        html: `<div style="width:18px;height:18px;border-radius:9999px;background:#0F4C81;border:3px solid #fff;box-shadow:0 0 0 4px rgba(15,76,129,0.28);"></div>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
      });
      L.marker(userLocation, { icon: userIcon }).addTo(group).bindTooltip('Your Location');
    }
  }, [streets, selectedStreetId, reports, shelters, userLocation, showSafeRoute, showShelters, showReports, lang, onSelectStreet]);

  // Pan map smoothly when user selects a street
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !selectedStreetId) return;
    const street = streets.find((s) => s.id === selectedStreetId);
    if (!street || street.coordinates.length === 0) return;
    const mid = street.coordinates[Math.floor(street.coordinates.length / 2)];
    map.panTo(mid, { animate: true, duration: 0.45 });
  }, [selectedStreetId, streets]);

  return (
    <div className="relative flex h-[430px] w-full flex-col overflow-hidden rounded-2xl border border-slate-200 bg-slate-100 md:h-[560px]">
      <div ref={mapContainerRef} className="h-full w-full" aria-label="Interactive street flood risk map" />

      {/* Top-left map layer controls */}
      <div className="pointer-events-none absolute top-3 left-3 right-3 z-[400] flex flex-wrap items-center justify-between gap-2">
        <div className="pointer-events-auto flex flex-wrap items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 p-1.5 shadow-sm backdrop-blur-sm">
          <span className="flex items-center gap-1 px-2 text-xs font-semibold text-slate-700">
            <Layers className="h-3.5 w-3.5 text-[#0F4C81]" />
            Layers
          </span>
          <button
            type="button"
            onClick={() => setShowShelters((v) => !v)}
            className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              showShelters ? 'bg-[#0F4C81] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Shelters & Hospitals
          </button>
          <button
            type="button"
            onClick={() => setShowReports((v) => !v)}
            className={`min-h-[36px] rounded-lg px-2.5 text-xs font-medium transition-colors whitespace-nowrap ${
              showReports ? 'bg-[#0F4C81] text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
            }`}
          >
            Citizen Reports
          </button>
        </div>

        <button
          type="button"
          onClick={onRequestLocation}
          className="pointer-events-auto inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-semibold text-slate-800 shadow-sm backdrop-blur-sm hover:bg-slate-50 whitespace-nowrap"
        >
          <Navigation className="h-3.5 w-3.5 text-[#0F4C81]" />
          {lang === 'ta' ? 'என் இடம்' : 'My Location'}
        </button>
      </div>

      {/* Bottom-left color-blind safe legend */}
      <div className="pointer-events-auto absolute bottom-3 left-3 z-[400] hidden sm:flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-xs font-medium text-slate-700 shadow-sm backdrop-blur-sm">
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
        <span className="text-slate-400">·</span>
        <span className="inline-flex items-center gap-1.5 text-sky-700">
          <span className="inline-block h-0.5 w-4 border-t-2 border-dashed border-sky-600" />
          {lang === 'ta' ? 'மாற்றுப் பாதை' : 'Safe Bypass'}
        </span>
      </div>
    </div>
  );
};
