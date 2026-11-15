import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera,
  Download,
  ExternalLink,
  Globe,
  Image as ImageIcon,
  Loader2,
  MapPin,
  Mic,
  MicOff,
  PhoneOff,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  Wand2,
} from 'lucide-react';
import type { Language, Street } from '../types/flood.ts';

interface FloodAICenterViewProps {
  streets: Street[];
  selectedStreet: Street | null;
  userLocation: [number, number] | null;
  lang: Language;
  onRequestLocation: () => void;
}

type AITab = 'search' | 'maps' | 'voice' | 'studio';

interface GroundedWebSource {
  uri: string;
  title: string;
}

interface GroundedPlace {
  title: string;
  uri: string;
  placeId?: string;
  snippets?: Array<{ text: string; uri: string }>;
}

interface TranscriptEntry {
  id: string;
  role: 'user' | 'assistant' | 'system';
  text: string;
}

function pcmFloatToInt16Base64(float32: Float32Array): string {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(int16.buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64PcmToFloat32(base64: string): Float32Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  const int16 = new Int16Array(bytes.buffer);
  const float32 = new Float32Array(int16.length);
  for (let i = 0; i < int16.length; i++) {
    float32[i] = int16[i] / 0x8000;
  }
  return float32;
}

function renderSimpleMarkdown(text: string): React.ReactNode {
  const lines = text.split('\n');
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-700">
      {lines.map((line, i) => {
        const trimmed = line.trim();
        if (!trimmed) return <div key={i} className="h-1" />;
        if (trimmed.startsWith('### ')) {
          return (
            <h4 key={i} className="pt-1 font-display text-sm font-bold text-slate-900">
              {trimmed.slice(4)}
            </h4>
          );
        }
        if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) {
          return (
            <h3 key={i} className="pt-1 font-display text-base font-bold text-slate-900">
              {trimmed.replace(/^#+\s*/, '')}
            </h3>
          );
        }
        if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
          const content = trimmed.slice(2).replace(/\*\*(.*?)\*\*/g, '$1');
          return (
            <div key={i} className="flex items-start gap-2 pl-1">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[#0F4C81]" />
              <span>{content}</span>
            </div>
          );
        }
        return <p key={i}>{trimmed.replace(/\*\*(.*?)\*\*/g, '$1')}</p>;
      })}
    </div>
  );
}

export const FloodAICenterView: React.FC<FloodAICenterViewProps> = ({
  streets,
  selectedStreet,
  userLocation,
  lang,
  onRequestLocation,
}) => {
  const [activeTab, setActiveTab] = useState<AITab>('search');

  // 1. Search Grounding state
  const [searchPrompt, setSearchPrompt] = useState(
    'Latest Chennai monsoon rainfall alert, storm drain advisories, and road closures today'
  );
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult, setSearchResult] = useState<{ text: string; sources: GroundedWebSource[] } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  // 2. Maps Grounding state
  const [mapsPrompt, setMapsPrompt] = useState(
    'Emergency hospitals, elevated community shelters, and 24-hour pharmacies near this street'
  );
  const [mapsLoading, setMapsLoading] = useState(false);
  const [mapsResult, setMapsResult] = useState<{ text: string; places: GroundedPlace[] } | null>(null);
  const [mapsError, setMapsError] = useState<string | null>(null);

  // 3. Live Voice Assistant state
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceConnecting, setVoiceConnecting] = useState(false);
  const [micMuted, setMicMuted] = useState(false);
  const [voiceName, setVoiceName] = useState<'Zephyr' | 'Kore' | 'Puck' | 'Fenrir'>('Zephyr');
  const [voiceTextDraft, setVoiceTextDraft] = useState('');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([]);

  const liveWsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const micMutedRef = useRef(false);
  micMutedRef.current = micMuted;

  // 4. Image Studio & Hazard Annotator state
  const [studioMode, setStudioMode] = useState<'annotator' | 'gemini'>('gemini');
  const [imagePrompt, setImagePrompt] = useState(
    'Clear calm infographic illustration showing 3 steps to protect parked vehicles and electrical mains when street storm drains reach 75% capacity in Chennai, high-contrast editorial style'
  );
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '1:1' | '4:3' | '9:16'>('16:9');
  const [imageSize, setImageSize] = useState<'1K' | '2K' | '4K'>('1K');
  const [useImageSearchGrounding, setUseImageSearchGrounding] = useState(false);
  const [sourcePhoto, setSourcePhoto] = useState<{ dataUrl: string; mimeType: string } | null>(null);
  const [generatedImage, setGeneratedImage] = useState<{ url: string; note: string } | null>(null);
  const [imageLoading, setImageLoading] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);

  // Built-in Canvas Hazard Annotator state
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [annotDepthTag, setAnnotDepthTag] = useState<'15 cm Ankle' | '45 cm Knee' | '75+ cm Danger' | 'Safe Bypass →'>('45 cm Knee');
  const [annotMarkers, setAnnotMarkers] = useState<Array<{ x: number; y: number; label: string; color: string }>>([]);
  const [annotBgImage, setAnnotBgImage] = useState<HTMLImageElement | null>(null);

  // Active street coordinates for Maps Grounding
  const targetCoords = (() => {
    if (userLocation) return { lat: userLocation[0], lng: userLocation[1], label: 'Your GPS Location' };
    if (selectedStreet && selectedStreet.coordinates.length > 0) {
      const mid = selectedStreet.coordinates[Math.floor(selectedStreet.coordinates.length / 2)];
      return { lat: mid[0], lng: mid[1], label: selectedStreet.name };
    }
    return { lat: 13.0574, lng: 80.2535, label: 'Chennai Central Corridor' };
  })();

  const handleRunSearchGrounding = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? searchPrompt).trim();
    if (!q) return;
    if (overrideQuery) setSearchPrompt(overrideQuery);
    setSearchLoading(true);
    setSearchError(null);
    try {
      const resp = await fetch('/api/ai/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, lang }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setSearchError(data.error || 'Unable to run Google Search grounding.');
      } else {
        setSearchResult({ text: data.text || '', sources: data.sources || [] });
      }
    } catch {
      setSearchError('Network error reaching search grounding endpoint.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleRunMapsGrounding = async (overrideQuery?: string) => {
    const q = (overrideQuery ?? mapsPrompt).trim();
    if (!q) return;
    if (overrideQuery) setMapsPrompt(overrideQuery);
    setMapsLoading(true);
    setMapsError(null);
    try {
      const resp = await fetch('/api/ai/maps-grounding', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: q,
          lat: targetCoords.lat,
          lng: targetCoords.lng,
          lang,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setMapsError(data.error || 'Unable to run Google Maps grounding.');
      } else {
        setMapsResult({ text: data.text || '', places: data.places || [] });
      }
    } catch {
      setMapsError('Network error reaching Google Maps grounding endpoint.');
    } finally {
      setMapsLoading(false);
    }
  };

  const stopAllPlayback = useCallback(() => {
    activeSourcesRef.current.forEach((src) => {
      try {
        src.stop();
      } catch {
        // Ignore already stopped
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
  }, []);

  const stopVoiceSession = useCallback(() => {
    stopAllPlayback();
    try {
      processorRef.current?.disconnect();
    } catch {
      // Ignore
    }
    processorRef.current = null;
    mediaStreamRef.current?.getTracks().forEach((tr) => tr.stop());
    mediaStreamRef.current = null;

    if (inputCtxRef.current && inputCtxRef.current.state !== 'closed') {
      inputCtxRef.current.close().catch(() => {});
    }
    inputCtxRef.current = null;

    if (outputCtxRef.current && outputCtxRef.current.state !== 'closed') {
      outputCtxRef.current.close().catch(() => {});
    }
    outputCtxRef.current = null;

    if (liveWsRef.current) {
      try {
        liveWsRef.current.close();
      } catch {
        // Ignore
      }
      liveWsRef.current = null;
    }
    setVoiceActive(false);
    setVoiceConnecting(false);
  }, [stopAllPlayback]);

  useEffect(() => {
    return () => {
      stopVoiceSession();
    };
  }, [stopVoiceSession]);

  const schedulePcmPlayback = useCallback((base64Audio: string) => {
    const ctx = outputCtxRef.current;
    if (!ctx) return;
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const float32 = base64PcmToFloat32(base64Audio);
    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);

    const now = ctx.currentTime;
    const startAt = Math.max(now, nextStartTimeRef.current);
    nextStartTimeRef.current = startAt + buffer.duration;

    activeSourcesRef.current.add(src);
    src.onended = () => {
      activeSourcesRef.current.delete(src);
    };
    src.start(startAt);
  }, []);

  const startVoiceSession = async () => {
    if (voiceActive || voiceConnecting) return;
    setVoiceError(null);
    setVoiceConnecting(true);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const inputCtx = new AudioContext({ sampleRate: 16000 });
      const outputCtx = new AudioContext({ sampleRate: 24000 });
      inputCtxRef.current = inputCtx;
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws-live?lang=${lang}&voice=${voiceName}`);
      liveWsRef.current = ws;

      ws.onopen = () => {
        const source = inputCtx.createMediaStreamSource(stream);
        const processor = inputCtx.createScriptProcessor(4096, 1, 1);
        processorRef.current = processor;

        processor.onaudioprocess = (e) => {
          if (micMutedRef.current) return;
          if (ws.readyState !== WebSocket.OPEN) return;
          const base64 = pcmFloatToInt16Base64(e.inputBuffer.getChannelData(0));
          ws.send(JSON.stringify({ audio: base64 }));
        };

        source.connect(processor);
        processor.connect(inputCtx.destination);
        setVoiceConnecting(false);
        setVoiceActive(true);
        setTranscripts((prev) => [
          ...prev,
          {
            id: `sys-${Date.now()}`,
            role: 'system',
            text:
              lang === 'ta'
                ? 'நேரலை குரல் இணைப்பு தயாராக உள்ளது. உங்கள் தெரு நிலவரம் குறித்து கேளுங்கள்.'
                : 'Live flood voice channel connected. Ask about any monitored street, ETA, or safe alternate route.',
          },
        ]);
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data) as {
            audio?: string;
            inputTranscript?: string;
            outputTranscript?: string;
            interrupted?: boolean;
            error?: string;
          };
          if (msg.error) {
            setVoiceError(msg.error);
            stopVoiceSession();
            return;
          }
          if (msg.interrupted) {
            stopAllPlayback();
          }
          if (msg.audio) {
            schedulePcmPlayback(msg.audio);
          }
          if (msg.inputTranscript) {
            setTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'user') {
                return [...prev.slice(0, -1), { ...last, text: last.text + msg.inputTranscript }];
              }
              return [...prev, { id: `u-${Date.now()}`, role: 'user', text: msg.inputTranscript! }];
            });
          }
          if (msg.outputTranscript) {
            setTranscripts((prev) => {
              const last = prev[prev.length - 1];
              if (last && last.role === 'assistant') {
                return [...prev.slice(0, -1), { ...last, text: last.text + msg.outputTranscript }];
              }
              return [...prev, { id: `a-${Date.now()}`, role: 'assistant', text: msg.outputTranscript! }];
            });
          }
        } catch {
          // Ignore malformed frame
        }
      };

      ws.onerror = () => {
        setVoiceError('WebSocket connection error on /ws-live.');
        stopVoiceSession();
      };

      ws.onclose = () => {
        setVoiceActive(false);
        setVoiceConnecting(false);
      };
    } catch (err: unknown) {
      setVoiceError(
        err instanceof Error
          ? err.message
          : 'Microphone access denied or unavailable. Please allow microphone permission to start voice chat.'
      );
      stopVoiceSession();
    }
  };

  const sendVoiceTextMessage = () => {
    const trimmed = voiceTextDraft.trim();
    if (!trimmed || !liveWsRef.current || liveWsRef.current.readyState !== WebSocket.OPEN) return;
    liveWsRef.current.send(JSON.stringify({ text: trimmed }));
    setTranscripts((prev) => [...prev, { id: `ut-${Date.now()}`, role: 'user', text: trimmed }]);
    setVoiceTextDraft('');
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      setSourcePhoto({ dataUrl, mimeType: file.type || 'image/png' });
      const img = new Image();
      img.onload = () => setAnnotBgImage(img);
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };

  const handleRunGeminiImage = async () => {
    if (!imagePrompt.trim()) return;
    setImageLoading(true);
    setImageError(null);
    try {
      const resp = await fetch('/api/ai/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: imagePrompt,
          imageBase64: sourcePhoto?.dataUrl,
          mimeType: sourcePhoto?.mimeType,
          aspectRatio,
          imageSize,
          useSearchGrounding: useImageSearchGrounding,
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        setImageError(data.error || 'Image studio request failed.');
      } else {
        setGeneratedImage({ url: data.imageUrl, note: data.text || '' });
      }
    } catch {
      setImageError('Network error connecting to image studio.');
    } finally {
      setImageLoading(false);
    }
  };

  // Render Canvas Hazard Annotator preview
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || studioMode !== 'annotator') return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (annotBgImage) {
      const scale = Math.max(W / annotBgImage.width, H / annotBgImage.height);
      const dw = annotBgImage.width * scale;
      const dh = annotBgImage.height * scale;
      ctx.drawImage(annotBgImage, (W - dw) / 2, (H - dh) / 2, dw, dh);
    } else {
      // Crisp procedural street corridor template
      const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.55);
      skyGrad.addColorStop(0, '#1E293B');
      skyGrad.addColorStop(1, '#475569');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, W, H * 0.55);

      ctx.fillStyle = '#334155';
      ctx.fillRect(0, H * 0.55, W, H * 0.45);

      // Curb + storm drain grate
      ctx.fillStyle = '#94A3B8';
      ctx.fillRect(0, H * 0.53, W, 12);
      ctx.fillStyle = '#0F172A';
      ctx.fillRect(W * 0.18, H * 0.65, 96, 32);
      ctx.strokeStyle = '#64748B';
      ctx.lineWidth = 3;
      for (let gx = W * 0.18 + 12; gx < W * 0.18 + 90; gx += 14) {
        ctx.beginPath();
        ctx.moveTo(gx, H * 0.65 + 4);
        ctx.lineTo(gx, H * 0.65 + 28);
        ctx.stroke();
      }
      // Road dashed markings
      ctx.fillStyle = '#E2E8F0';
      for (let rx = 40; rx < W; rx += 90) {
        ctx.fillRect(rx, H * 0.78, 48, 6);
      }
    }

    // Header Alert Banner overlay
    const st = selectedStreet || streets[0];
    ctx.fillStyle = 'rgba(15, 23, 42, 0.88)';
    ctx.fillRect(0, 0, W, 52);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 16px system-ui, sans-serif';
    ctx.fillText(
      `STREETFLOOD ALERT · ${(st ? (lang === 'ta' ? st.nameTa : st.name) : 'Chennai Corridor').slice(0, 44)}`,
      16,
      24
    );
    ctx.fillStyle = '#CBD5E1';
    ctx.font = '12px monospace';
    ctx.fillText(
      st
        ? `Water ${st.currentWaterCm}/${st.drainDepthCm} cm (${st.waterPct}%) · Rain ${st.rainfallMmHr} mm/hr · ${new Date().toLocaleTimeString()}`
        : 'Field Waterlogging Hazard Annotation',
      16,
      42
    );

    // Draw hazard pins placed by user
    for (const m of annotMarkers) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(m.x, m.y, 12, 0, Math.PI * 2);
      ctx.fillStyle = m.color;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#FFFFFF';
      ctx.stroke();

      ctx.font = 'bold 12px system-ui, sans-serif';
      const tw = ctx.measureText(m.label).width;
      ctx.fillStyle = 'rgba(15, 23, 42, 0.92)';
      ctx.fillRect(m.x + 16, m.y - 12, tw + 16, 24);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillText(m.label, m.x + 24, m.y + 4);
      ctx.restore();
    }
  }, [studioMode, annotBgImage, annotMarkers, selectedStreet, streets, lang]);

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const colorMap: Record<typeof annotDepthTag, string> = {
      '15 cm Ankle': '#D97706',
      '45 cm Knee': '#EA580C',
      '75+ cm Danger': '#DC2626',
      'Safe Bypass →': '#0284C7',
    };
    setAnnotMarkers((prev) => [...prev, { x, y, label: annotDepthTag, color: colorMap[annotDepthTag] }]);
  };

  const handleDownloadAnnotated = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `streetflood-hazard-${Date.now()}.png`;
    a.click();
  };

  return (
    <section className="mx-auto max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center">
        <div>
          <p className="text-xs font-semibold tracking-wide text-[#0F4C81]">
            {lang === 'ta' ? 'AI புலனாய்வு & குரல் உதவி மையம்' : 'AI Flood Intelligence, Voice & Visual Studio'}
          </p>
          <h1 className="mt-1 font-display text-2xl font-bold tracking-tight text-slate-900">
            {lang === 'ta' ? 'நேரலை தேடல், இடங்கள், குரல் & படக் கருவிகள்' : 'Grounded Weather Search, Place Locator, Voice & Photo Studio'}
          </h1>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-xl border border-slate-200 bg-slate-100 p-1">
          {(
            [
              { id: 'search', label: 'Google Search Data', icon: Globe },
              { id: 'maps', label: 'Google Maps Data', icon: MapPin },
              { id: 'voice', label: 'Live Voice', icon: Mic },
              { id: 'studio', label: 'Image Studio', icon: ImageIcon },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors whitespace-nowrap ${
                  active ? 'bg-[#0F4C81] text-white' : 'text-slate-700 hover:bg-white'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* PANEL 1: Google Search Grounding */}
      {activeTab === 'search' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-[#0F4C81]" />
              <h2 className="font-display text-base font-bold text-slate-900">Live Monsoon & Civic Web Grounding</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Queries real-time web weather bulletins, civic drainage releases, and traffic diversions alongside live StreetFlood drain sensor states.
            </p>

            <div className="flex flex-wrap gap-1.5">
              {[
                'Chennai IMD rainfall alert & cyclone bulletin today',
                'Velachery & Pallikaranai waterlogging traffic updates',
                'Greater Chennai Corporation flood helpline & pump status',
                'Chembarambakkam & Adyar river outflow status',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleRunSearchGrounding(preset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-[#0F4C81] hover:bg-sky-50"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-2">
              <textarea
                rows={3}
                value={searchPrompt}
                onChange={(e) => setSearchPrompt(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none"
                placeholder="Ask about current storm bulletins, road closures, or monsoon warnings..."
              />
              <button
                type="button"
                disabled={searchLoading}
                onClick={() => handleRunSearchGrounding()}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0F4C81] px-4 text-sm font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-60"
              >
                {searchLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                <span>{searchLoading ? 'Searching live web...' : 'Fetch Grounded Advisory'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <h3 className="font-display text-sm font-bold text-slate-900">Grounded Bulletin & Verified Web Sources</h3>
            {searchError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
                {searchError}
              </div>
            )}
            {!searchResult && !searchLoading && !searchError && (
              <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                Select a bulletin topic or enter a query to fetch live Google Search grounded updates with source citations.
              </div>
            )}
            {searchLoading && (
              <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-[#0F4C81]" />
                <span>Checking live meteorological and civic feeds...</span>
              </div>
            )}
            {searchResult && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  {renderSimpleMarkdown(searchResult.text)}
                </div>
                {searchResult.sources.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Cited Web Sources</div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      {searchResult.sources.map((src, idx) => (
                        <a
                          key={`${src.uri}-${idx}`}
                          href={src.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-[#0F4C81] hover:bg-sky-50"
                        >
                          <span className="truncate">{src.title}</span>
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                        </a>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PANEL 2: Google Maps Grounding */}
      {activeTab === 'maps' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-5 w-5 text-[#0F4C81]" />
                <h2 className="font-display text-base font-bold text-slate-900">Google Maps Safe Place Finder</h2>
              </div>
              <button
                type="button"
                onClick={onRequestLocation}
                className="rounded-lg border border-slate-200 px-2.5 py-1 text-xs font-semibold text-[#0F4C81] hover:bg-sky-50"
              >
                Use GPS
              </button>
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
              Search center: <strong className="text-slate-900">{targetCoords.label}</strong>{' '}
              <span className="font-mono text-[11px]">
                ({targetCoords.lat.toFixed(4)}, {targetCoords.lng.toFixed(4)})
              </span>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {[
                '24-hour emergency hospitals and trauma clinics nearby',
                'Public schools, community halls, or elevated shelters nearby',
                '24/7 pharmacies and medical supply stores nearby',
                'Open fuel stations and safe multi-level parking garages',
              ].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => handleRunMapsGrounding(preset)}
                  className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 hover:border-[#0F4C81] hover:bg-sky-50"
                >
                  {preset}
                </button>
              ))}
            </div>

            <div className="space-y-2 pt-1">
              <textarea
                rows={3}
                value={mapsPrompt}
                onChange={(e) => setMapsPrompt(e.target.value)}
                className="w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none"
                placeholder="Ask for hospitals, elevated parking, pharmacies, or shelters near this corridor..."
              />
              <button
                type="button"
                disabled={mapsLoading}
                onClick={() => handleRunMapsGrounding()}
                className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0F4C81] px-4 text-sm font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-60"
              >
                {mapsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4" />}
                <span>{mapsLoading ? 'Searching Google Maps places...' : 'Find Grounded Places'}</span>
              </button>
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <h3 className="font-display text-sm font-bold text-slate-900">Verified Places & Direct Google Maps Links</h3>
            {mapsError && (
              <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-800">
                {mapsError}
              </div>
            )}
            {!mapsResult && !mapsLoading && !mapsError && (
              <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                Run a search to list real nearby hospitals, pharmacies, and shelters anchored via Google Maps Grounding.
              </div>
            )}
            {mapsLoading && (
              <div className="mt-8 flex items-center justify-center gap-2 text-sm text-slate-500">
                <Loader2 className="h-4 w-4 animate-spin text-[#0F4C81]" />
                <span>Retrieving nearby places via Google Maps...</span>
              </div>
            )}
            {mapsResult && (
              <div className="mt-4 space-y-4">
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-4">
                  {renderSimpleMarkdown(mapsResult.text)}
                </div>
                {mapsResult.places.length > 0 && (
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Google Maps Places ({mapsResult.places.length})</div>
                    <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
                      {mapsResult.places.map((p, idx) => (
                        <div key={`${p.title}-${idx}`} className="rounded-xl border border-slate-200 bg-white p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-xs font-bold text-slate-900">{p.title}</span>
                            {p.uri && (
                              <a
                                href={p.uri}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex shrink-0 items-center gap-1 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-semibold text-[#0F4C81] hover:bg-sky-100"
                              >
                                <span>Open Map</span>
                                <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                          {p.snippets && p.snippets.length > 0 && (
                            <div className="mt-1.5 flex flex-wrap gap-2">
                              {p.snippets.map((sn, sIdx) => (
                                <a
                                  key={sIdx}
                                  href={sn.uri}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-[11px] text-slate-600 underline hover:text-[#0F4C81]"
                                >
                                  Review snippet #{sIdx + 1}
                                </a>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* PANEL 3: Live Voice Conversations (Gemini Live API) */}
      {activeTab === 'voice' && (
        <div className="grid gap-6 lg:grid-cols-12">
          <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
            <div className="flex items-center gap-2">
              <Volume2 className="h-5 w-5 text-[#0F4C81]" />
              <h2 className="font-display text-base font-bold text-slate-900">Hands-Free Flood Voice Assistant</h2>
            </div>
            <p className="text-xs leading-relaxed text-slate-600">
              Speak directly in English or Tamil (தமிழ்) while commuting or inspecting drains. Streams live bidirectional audio aware of current street sensor telemetry.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-700">Assistant Voice</label>
              <div className="mt-1.5 grid grid-cols-4 gap-1.5">
                {(['Zephyr', 'Kore', 'Puck', 'Fenrir'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    disabled={voiceActive}
                    onClick={() => setVoiceName(v)}
                    className={`min-h-[36px] rounded-lg border text-xs font-semibold transition-colors ${
                      voiceName === v
                        ? 'border-[#0F4C81] bg-[#0F4C81] text-white'
                        : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 disabled:opacity-50'
                    }`}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>

            {voiceError && (
              <div className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-800">
                {voiceError}
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              {!voiceActive ? (
                <button
                  type="button"
                  disabled={voiceConnecting}
                  onClick={startVoiceSession}
                  className="inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl bg-[#0F4C81] px-4 text-sm font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-60"
                >
                  {voiceConnecting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mic className="h-4 w-4" />}
                  <span>{voiceConnecting ? 'Connecting voice...' : 'Start Live Voice Call'}</span>
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => setMicMuted((m) => !m)}
                    className={`inline-flex min-h-[48px] flex-1 items-center justify-center gap-2 rounded-xl border px-4 text-sm font-semibold ${
                      micMuted
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-slate-300 bg-white text-slate-800 hover:bg-slate-50'
                    }`}
                  >
                    {micMuted ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4 text-emerald-700" />}
                    <span>{micMuted ? 'Mic Muted' : 'Mic Live'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={stopVoiceSession}
                    className="inline-flex min-h-[48px] items-center justify-center gap-2 rounded-xl bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    <PhoneOff className="h-4 w-4" />
                    <span>End</span>
                  </button>
                </>
              )}
            </div>

            {voiceActive && (
              <div className="space-y-2 border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-700">Or send a quick text prompt over the live session:</div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={voiceTextDraft}
                    onChange={(e) => setVoiceTextDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') sendVoiceTextMessage();
                    }}
                    placeholder="Ask e.g. Which streets are at Danger right now?"
                    className="h-10 flex-1 rounded-lg border border-slate-300 px-3 text-xs focus:border-[#0F4C81] focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={sendVoiceTextMessage}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-slate-900 px-3 text-xs font-semibold text-white hover:bg-slate-800"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="font-display text-sm font-bold text-slate-900">Live Voice Conversation Transcript</h3>
              <span className="text-xs font-medium text-slate-500">
                {voiceActive ? 'Audio stream active (16kHz in / 24kHz out)' : 'Standby'}
              </span>
            </div>
            <div className="mt-3 flex-1 space-y-2.5 overflow-y-auto max-h-[340px] pr-1">
              {transcripts.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-8 text-center text-xs text-slate-500">
                  Press &ldquo;Start Live Voice Call&rdquo; and ask: &ldquo;Which Chennai streets should I avoid right now?&rdquo; or speak in Tamil.
                </div>
              ) : (
                transcripts.map((entry) => (
                  <div
                    key={entry.id}
                    className={`rounded-xl px-3.5 py-2.5 text-xs leading-relaxed ${
                      entry.role === 'user'
                        ? 'ml-8 bg-[#0F4C81] text-white'
                        : entry.role === 'assistant'
                          ? 'mr-8 border border-slate-200 bg-slate-50 text-slate-800'
                          : 'bg-sky-50 text-sky-900 text-center font-medium'
                    }`}
                  >
                    {entry.text}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* PANEL 4: Create & Edit Images + Field Hazard Annotator */}
      {activeTab === 'studio' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4">
            <div className="flex items-center gap-2">
              <Camera className="h-5 w-5 text-[#0F4C81]" />
              <div>
                <h2 className="font-display text-base font-bold text-slate-900">Flood Visual & Photo Hazard Studio</h2>
                <p className="text-xs text-slate-500">
                  Generate preparedness visuals with Gemini Image AI or annotate street flood photos directly on canvas.
                </p>
              </div>
            </div>
            <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => setStudioMode('gemini')}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${
                  studioMode === 'gemini' ? 'bg-[#0F4C81] text-white' : 'text-slate-700 hover:bg-white'
                }`}
              >
                AI Image Generate & Edit
              </button>
              <button
                type="button"
                onClick={() => setStudioMode('annotator')}
                className={`min-h-[36px] rounded-lg px-3 text-xs font-semibold ${
                  studioMode === 'annotator' ? 'bg-[#0F4C81] text-white' : 'text-slate-700 hover:bg-white'
                }`}
              >
                Canvas Photo Annotator
              </button>
            </div>
          </div>

          {studioMode === 'gemini' ? (
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    Optional Reference Street Photo (for AI Editing)
                  </label>
                  <div className="mt-1.5 flex items-center gap-2">
                    <label className="inline-flex min-h-[40px] cursor-pointer items-center gap-1.5 rounded-lg border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100">
                      <Upload className="h-3.5 w-3.5" />
                      <span>{sourcePhoto ? 'Replace Photo' : 'Upload Street Photo'}</span>
                      <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                    </label>
                    {sourcePhoto && (
                      <button
                        type="button"
                        onClick={() => setSourcePhoto(null)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 hover:bg-slate-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Clear
                      </button>
                    )}
                  </div>
                  {sourcePhoto && (
                    <img
                      src={sourcePhoto.dataUrl}
                      alt="Uploaded street reference"
                      className="mt-2 h-28 w-full rounded-xl border border-slate-200 object-cover"
                    />
                  )}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Aspect Ratio</label>
                    <select
                      value={aspectRatio}
                      onChange={(e) => setAspectRatio(e.target.value as typeof aspectRatio)}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-xs font-medium text-slate-900"
                    >
                      <option value="16:9">16:9 Landscape</option>
                      <option value="1:1">1:1 Square</option>
                      <option value="4:3">4:3 Poster</option>
                      <option value="9:16">9:16 Mobile Story</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">Resolution</label>
                    <select
                      value={imageSize}
                      onChange={(e) => setImageSize(e.target.value as typeof imageSize)}
                      className="mt-1 h-10 w-full rounded-lg border border-slate-300 bg-slate-50 px-2.5 text-xs font-medium text-slate-900"
                    >
                      <option value="1K">1K Standard</option>
                      <option value="2K">2K High Detail</option>
                      <option value="4K">4K Ultra Print</option>
                    </select>
                  </div>
                </div>

                {!sourcePhoto && (
                  <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                    <input
                      type="checkbox"
                      checked={useImageSearchGrounding}
                      onChange={(e) => setUseImageSearchGrounding(e.target.checked)}
                      className="h-4 w-4 rounded border-slate-300 text-[#0F4C81]"
                    />
                    <span>Ground visual generation with real-time Google Web &amp; Image Search</span>
                  </label>
                )}

                <div>
                  <label className="block text-xs font-semibold text-slate-700">
                    {sourcePhoto ? 'Photo Edit Instruction' : 'Visual Generation Prompt'}
                  </label>
                  <textarea
                    rows={3}
                    value={imagePrompt}
                    onChange={(e) => setImagePrompt(e.target.value)}
                    className="mt-1 w-full rounded-xl border border-slate-300 bg-slate-50 p-3 text-xs text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none"
                  />
                </div>

                <button
                  type="button"
                  disabled={imageLoading}
                  onClick={handleRunGeminiImage}
                  className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-[#0F4C81] px-4 text-sm font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-60"
                >
                  {imageLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  <span>
                    {imageLoading
                      ? 'Rendering visual...'
                      : sourcePhoto
                        ? 'Edit Street Photo with AI'
                        : 'Generate Flood Visual'}
                  </span>
                </button>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-7">
                <h3 className="font-display text-sm font-bold text-slate-900">Generated Visual Output</h3>
                {imageError && (
                  <div className="mt-3 space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-900">
                    <p className="font-semibold">{imageError}</p>
                    <button
                      type="button"
                      onClick={() => setStudioMode('annotator')}
                      className="rounded-lg bg-amber-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-950"
                    >
                      Open Instant Canvas Photo Annotator
                    </button>
                  </div>
                )}
                {!generatedImage && !imageLoading && !imageError && (
                  <div className="mt-6 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-10 text-center text-xs text-slate-500">
                    Generate a monsoon preparedness guide, neighborhood drain diagram, or upload a street photo to annotate flood depth scenarios.
                  </div>
                )}
                {imageLoading && (
                  <div className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-500">
                    <Loader2 className="h-5 w-5 animate-spin text-[#0F4C81]" />
                    <span>Synthesizing high-resolution flood visual...</span>
                  </div>
                )}
                {generatedImage && (
                  <div className="mt-4 space-y-3">
                    <img
                      src={generatedImage.url}
                      alt="Generated flood preparedness visual"
                      className="max-h-[420px] w-full rounded-xl border border-slate-200 object-contain bg-slate-950"
                    />
                    {generatedImage.note && <p className="text-xs text-slate-600">{generatedImage.note}</p>}
                    <a
                      href={generatedImage.url}
                      download={`streetflood-visual-${Date.now()}.png`}
                      className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-slate-300 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    >
                      <Download className="h-3.5 w-3.5" />
                      <span>Download PNG</span>
                    </a>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-12">
              <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-5 lg:col-span-4">
                <h3 className="font-display text-sm font-bold text-slate-900">1. Load Photo or Corridor Scene</h3>
                <label className="inline-flex min-h-[42px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-300 bg-slate-50 px-3 text-xs font-semibold text-slate-800 hover:bg-slate-100">
                  <Upload className="h-4 w-4" />
                  <span>Upload Field Photo</span>
                  <input type="file" accept="image/*" onChange={handlePhotoUpload} className="hidden" />
                </label>

                <div>
                  <h3 className="font-display text-sm font-bold text-slate-900">2. Select Hazard Stamp</h3>
                  <p className="mt-0.5 text-xs text-slate-500">Click anywhere on the canvas to place markers.</p>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    {(['15 cm Ankle', '45 cm Knee', '75+ cm Danger', 'Safe Bypass →'] as const).map((tag) => (
                      <button
                        key={tag}
                        type="button"
                        onClick={() => setAnnotDepthTag(tag)}
                        className={`min-h-[38px] rounded-lg border px-2 text-xs font-semibold ${
                          annotDepthTag === tag
                            ? 'border-[#0F4C81] bg-[#0F4C81] text-white'
                            : 'border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
                        }`}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setAnnotMarkers([])}
                    className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Clear Stamps
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadAnnotated}
                    className="inline-flex min-h-[42px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0F4C81] px-3 text-xs font-semibold text-white hover:bg-[#0c3c66]"
                  >
                    <Download className="h-3.5 w-3.5" />
                    Export PNG
                  </button>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white p-4 lg:col-span-8">
                <canvas
                  ref={canvasRef}
                  width={840}
                  height={480}
                  onClick={handleCanvasClick}
                  className="w-full cursor-crosshair rounded-xl border border-slate-200 bg-slate-900"
                />
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
};
