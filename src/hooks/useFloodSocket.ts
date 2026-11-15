import { useCallback, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../lib/firebase.ts';
import type {
  AlertChannel,
  CommunityReport,
  FloodAlert,
  Language,
  ReliefShelter,
  SensorNode,
  SimulationState,
  Street,
  StreetSubscription,
  WeatherForecast,
} from '../types/flood.ts';

const OFFLINE_CACHE_KEY = 'streetflood_offline_cache_v1';
const LOCAL_SUBS_KEY = 'streetflood_local_subs_v1';

export function useFloodData(lang: Language) {
  const [streets, setStreets] = useState<Street[]>([]);
  const [sensors, setSensors] = useState<SensorNode[]>([]);
  const [alerts, setAlerts] = useState<FloodAlert[]>([]);
  const [reports, setReports] = useState<CommunityReport[]>([]);
  const [shelters, setShelters] = useState<ReliefShelter[]>([]);
  const [forecast, setForecast] = useState<WeatherForecast | null>(null);
  const [simulation, setSimulation] = useState<SimulationState>({
    active: false,
    tick: 0,
    maxTicks: 6,
    intensityLabel: 'Nominal',
  });
  const [wsConnected, setWsConnected] = useState(false);
  const [loading, setLoading] = useState(true);
  const [latestToastAlert, setLatestToastAlert] = useState<FloodAlert | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [subscriptions, setSubscriptions] = useState<StreetSubscription[]>(() => {
    try {
      const raw = localStorage.getItem(LOCAL_SUBS_KEY);
      return raw ? (JSON.parse(raw) as StreetSubscription[]) : [];
    } catch {
      return [];
    }
  });

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  // Firebase Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Ensure public user profile exists in Firestore
        try {
          const userRef = doc(db, 'users', currentUser.uid);
          await setDoc(
            userRef,
            {
              uid: currentUser.uid,
              displayName: (currentUser.displayName || 'Resident').slice(0, 100),
              role: 'resident',
              preferredLang: lang,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch {
          // Non-fatal if user doc already exists with immutable createdAt
        }
      }
    });
    return () => unsub();
  }, [lang]);

  // Firestore real-time subscriptions when authenticated
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'subscriptions'), where('userId', '==', user.uid));
    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const loaded: StreetSubscription[] = [];
        snapshot.forEach((docSnap) => {
          const d = docSnap.data();
          loaded.push({
            id: docSnap.id,
            userId: String(d.userId || user.uid),
            streetId: String(d.streetId || ''),
            streetName: String(d.streetName || ''),
            channels: Array.isArray(d.channels) ? (d.channels as AlertChannel[]) : ['push'],
            radiusMeters: Number(d.radiusMeters || 500),
            active: Boolean(d.active ?? true),
            createdAt: d.createdAt?.toDate ? d.createdAt.toDate().toISOString() : new Date().toISOString(),
            updatedAt: d.updatedAt?.toDate ? d.updatedAt.toDate().toISOString() : new Date().toISOString(),
          });
        });
        setSubscriptions(loaded);
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'subscriptions');
      }
    );
    return () => unsub();
  }, [user]);

  // Initial REST hydration + Offline fallback
  const fetchInitialData = useCallback(async () => {
    try {
      const [streetsRes, sensorsRes, alertsRes, reportsRes, sheltersRes, forecastRes] = await Promise.all([
        fetch('/api/streets'),
        fetch('/api/sensors'),
        fetch('/api/alerts'),
        fetch('/api/reports'),
        fetch('/api/shelters'),
        fetch('/api/weather/forecast'),
      ]);

      if (streetsRes.ok) {
        const sData = (await streetsRes.json()) as Street[];
        const senData = sensorsRes.ok ? ((await sensorsRes.json()) as SensorNode[]) : [];
        const aData = alertsRes.ok ? ((await alertsRes.json()) as FloodAlert[]) : [];
        const rData = reportsRes.ok ? ((await reportsRes.json()) as CommunityReport[]) : [];
        const shData = sheltersRes.ok ? ((await sheltersRes.json()) as ReliefShelter[]) : [];
        const fData = forecastRes.ok ? ((await forecastRes.json()) as WeatherForecast) : null;

        setStreets(sData);
        setSensors(senData);
        setAlerts(aData);
        setReports(rData);
        setShelters(shData);
        if (fData) setForecast(fData);

        try {
          localStorage.setItem(
            OFFLINE_CACHE_KEY,
            JSON.stringify({ streets: sData, sensors: senData, alerts: aData, reports: rData, shelters: shData })
          );
        } catch {
          // Ignore storage quota errors
        }
      }
    } catch {
      try {
        const cached = localStorage.getItem(OFFLINE_CACHE_KEY);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (parsed.streets) setStreets(parsed.streets);
          if (parsed.sensors) setSensors(parsed.sensors);
          if (parsed.alerts) setAlerts(parsed.alerts);
          if (parsed.reports) setReports(parsed.reports);
          if (parsed.shelters) setShelters(parsed.shelters);
        }
      } catch {
        // Ignore parse error
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  // Real WebSocket connection for live sensor & alert updates
  useEffect(() => {
    let active = true;

    function connect() {
      if (!active) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        if (!active) return;
        setWsConnected(true);
      };

      ws.onmessage = (event) => {
        if (!active) return;
        try {
          const msg = JSON.parse(event.data) as { event: string; payload: unknown };
          if (msg.event === 'init:state') {
            const p = msg.payload as {
              streets: Street[];
              sensors: SensorNode[];
              alerts: FloodAlert[];
              reports: CommunityReport[];
              shelters: ReliefShelter[];
              simulation: SimulationState;
              forecast: WeatherForecast;
            };
            setStreets(p.streets);
            setSensors(p.sensors);
            setAlerts(p.alerts);
            setReports(p.reports);
            setShelters(p.shelters);
            setSimulation(p.simulation);
            setForecast(p.forecast);
            setLoading(false);
          } else if (msg.event === 'street:update') {
            const updated = msg.payload as Street;
            setStreets((prev) => {
              const exists = prev.some((s) => s.id === updated.id);
              return exists ? prev.map((s) => (s.id === updated.id ? updated : s)) : [...prev, updated];
            });
          } else if (msg.event === 'sensor:updated') {
            const updated = msg.payload as SensorNode;
            setSensors((prev) => {
              const exists = prev.some((s) => s.id === updated.id);
              return exists ? prev.map((s) => (s.id === updated.id ? updated : s)) : [...prev, updated];
            });
          } else if (msg.event === 'alert:triggered') {
            const alert = msg.payload as FloodAlert;
            setAlerts((prev) => (prev.some((a) => a.id === alert.id) ? prev : [alert, ...prev].slice(0, 60)));
            setLatestToastAlert(alert);
            // Browser Notification if granted
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try {
                new Notification(lang === 'ta' ? alert.titleTa : alert.titleEn, {
                  body: lang === 'ta' ? alert.messageTa : alert.messageEn,
                  icon: '/pwa-192x192.png',
                });
              } catch {
                // Ignore Notification errors on restricted browsers
              }
            }
          } else if (msg.event === 'report:created') {
            const report = msg.payload as CommunityReport;
            setReports((prev) => (prev.some((r) => r.id === report.id) ? prev : [report, ...prev]));
          } else if (msg.event === 'report:updated') {
            const report = msg.payload as CommunityReport;
            setReports((prev) => prev.map((r) => (r.id === report.id ? report : r)));
          } else if (msg.event === 'simulation:status') {
            setSimulation(msg.payload as SimulationState);
          }
        } catch {
          // Ignore malformed message
        }
      };

      ws.onclose = () => {
        if (!active) return;
        setWsConnected(false);
        reconnectTimerRef.current = window.setTimeout(connect, 2500);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();
    return () => {
      active = false;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      wsRef.current?.close();
    };
  }, [lang]);

  const signInWithGoogle = async () => {
    await signInWithPopup(auth, googleProvider);
  };

  const signOutUser = async () => {
    await signOut(auth);
  };

  const toggleStreetSubscription = async (
    street: Street,
    channels: AlertChannel[] = ['push', 'sms', 'email'],
    radiusMeters = 500
  ) => {
    const existing = subscriptions.find((s) => s.streetId === street.id);
    if (user) {
      const subId = `${user.uid}_${street.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
      const subRef = doc(db, 'subscriptions', subId);
      try {
        if (existing) {
          await deleteDoc(subRef);
        } else {
          await setDoc(subRef, {
            userId: user.uid,
            streetId: street.id,
            streetName: street.name,
            channels,
            radiusMeters,
            active: true,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        }
      } catch (err) {
        handleFirestoreError(err, existing ? OperationType.DELETE : OperationType.CREATE, `subscriptions/${subId}`);
      }
      return;
    }

    // Local subscription persistence for guest residents
    const nowIso = new Date().toISOString();
    const next = existing
      ? subscriptions.filter((s) => s.streetId !== street.id)
      : [
          ...subscriptions,
          {
            id: `sub-${street.id}`,
            userId: 'resident-local',
            streetId: street.id,
            streetName: street.name,
            channels,
            radiusMeters,
            active: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        ];
    setSubscriptions(next);
    try {
      localStorage.setItem(LOCAL_SUBS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage error
    }
  };

  return {
    streets,
    sensors,
    alerts,
    reports,
    shelters,
    forecast,
    simulation,
    wsConnected,
    loading,
    latestToastAlert,
    dismissToastAlert: () => setLatestToastAlert(null),
    user,
    subscriptions,
    signInWithGoogle,
    signOutUser,
    toggleStreetSubscription,
  };
}
