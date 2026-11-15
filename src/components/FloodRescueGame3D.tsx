import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Award,
  ChevronDown,
  ChevronUp,
  Droplets,
  Heart,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
  Volume2,
  VolumeX,
  Wrench,
} from 'lucide-react';
import type { Language, Street } from '../types/flood.ts';

interface FloodRescueGame3DProps {
  streets: Street[];
  lang: Language;
  onExit?: () => void;
}

type GamePhase = 'title' | 'playing' | 'paused' | 'victory' | 'gameover';
type CameraMode = 'chase' | 'overhead';

interface HudSnapshot {
  phase: GamePhase;
  score: number;
  floodPct: number;
  hullPct: number;
  drainsCleared: number;
  rescuedCount: number;
  carryingCount: number;
  timeRemaining: number;
  hintText: string;
}

// Pre-allocated math helpers (zero GC inside animation loop)
const _vec3 = new THREE.Vector3();
const _vec3B = new THREE.Vector3();
const _vec3C = new THREE.Vector3();
const _mat4 = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _color = new THREE.Color();

function createProceduralAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(0, 0, 512, 512);

  // Subtle wet aggregate speckle
  for (let i = 0; i < 4200; i++) {
    const x = (i * 73) % 512;
    const y = ((i * 137) % 512);
    const v = 26 + ((i * 17) % 24);
    ctx.fillStyle = `rgb(${v},${v + 7},${v + 16})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Sidewalk curb lines & dashed center divider
  ctx.fillStyle = '#475569';
  ctx.fillRect(0, 0, 36, 512);
  ctx.fillRect(476, 0, 36, 512);

  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(42, 0, 6, 512);
  ctx.fillRect(464, 0, 6, 512);

  ctx.fillStyle = '#facc15';
  for (let y = 16; y < 512; y += 64) {
    ctx.fillRect(251, y, 10, 36);
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 10);
  tex.anisotropy = maxAnisotropy;
  return tex;
}

function createFacadeTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#334155';
  ctx.fillRect(0, 0, 256, 256);

  for (let row = 0; row < 8; row++) {
    for (let col = 0; col < 6; col++) {
      const lit = (row * 7 + col * 3) % 5 === 0;
      ctx.fillStyle = lit ? '#fde68a' : '#1e293b';
      ctx.fillRect(14 + col * 38, 14 + row * 30, 24, 18);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = maxAnisotropy;
  return tex;
}

class ProceduralAudioEngine {
  private ctx: AudioContext | null = null;
  public muted = false;

  private ensureContext(): AudioContext | null {
    if (this.muted) return null;
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public playChime(freqStart: number, freqEnd: number, duration = 0.22, type: OscillatorType = 'triangle') {
    const ctx = this.ensureContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqStart, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, freqEnd), now + duration);
    gain.gain.setValueAtTime(0.14, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playDrainCleared() {
    this.playChime(392, 784, 0.28, 'triangle');
    window.setTimeout(() => this.playChime(587, 987, 0.2, 'sine'), 90);
  }

  public playRescuePickup() {
    this.playChime(523, 880, 0.18, 'sine');
  }

  public playShelterDropoff() {
    this.playChime(523, 659, 0.16, 'triangle');
    window.setTimeout(() => this.playChime(659, 1046, 0.26, 'triangle'), 110);
  }

  public playHazardBump() {
    this.playChime(150, 52, 0.24, 'sawtooth');
  }

  public dispose() {
    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
    }
    this.ctx = null;
  }
}

export const FloodRescueGame3D: React.FC<FloodRescueGame3DProps> = ({ streets, lang, onExit }) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<ProceduralAudioEngine | null>(null);

  const [hud, setHud] = useState<HudSnapshot>({
    phase: 'title',
    score: 0,
    floodPct: 38,
    hullPct: 100,
    drainsCleared: 0,
    rescuedCount: 0,
    carryingCount: 0,
    timeRemaining: 90,
    hintText: 'Drive to pulsing storm drains & press Clear Drain [Space] before water overflows.',
  });
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [muted, setMuted] = useState(false);
  const [expanded, setExpanded] = useState(false);

  const controlsRef = useRef({
    forward: false,
    backward: false,
    left: false,
    right: false,
    actionTriggered: false,
    cameraMode: 'chase' as CameraMode,
  });
  const phaseControlRef = useRef<{
    setPhase: (p: GamePhase) => void;
    resetGame: () => void;
  } | null>(null);

  controlsRef.current.cameraMode = cameraMode;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const audio = new ProceduralAudioEngine();
    audioRef.current = audio;

    // 1. Software WebGL probe
    const isSoftwareGl = (() => {
      const probe = document.createElement('canvas').getContext('webgl2');
      if (!probe) return true;
      const ext = probe.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : probe.RENDERER;
      const gpu = String(probe.getParameter(param));
      probe.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const renderer = new THREE.WebGLRenderer({
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setSize(container.clientWidth || 800, container.clientHeight || 560);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const horizonColor = new THREE.Color(0x1e293b);
    scene.background = horizonColor;
    scene.fog = new THREE.FogExp2(0x1e293b, 0.011);

    // 2. Mandatory Studio Environment Reflection
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    const roomEnv = new RoomEnvironment();
    const envTarget = pmremGenerator.fromScene(roomEnv, 0.04);
    scene.environment = envTarget.texture;
    roomEnv.dispose();
    pmremGenerator.dispose();

    const camera = new THREE.PerspectiveCamera(
      52,
      (container.clientWidth || 800) / Math.max(1, container.clientHeight || 560),
      0.2,
      260
    );
    camera.position.set(0, 12, 18);

    // 3. Balanced 3-Point Warm/Cool Lighting Rig
    const hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x1e293b, 0.95);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfff1d6, 2.2);
    keyLight.position.set(22, 34, 18);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 2;
    keyLight.shadow.camera.far = 110;
    const d = 36;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0xbae6fd, 0.75);
    rimLight.position.set(-24, 18, -28);
    scene.add(rimLight);

    // Track disposable resources
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const asphaltTex = createProceduralAsphaltTexture(maxAniso);
    const facadeTex = createFacadeTexture(maxAniso);

    // 4. Street Corridor & Extended Surrounding Ground (no boxed-in wall void)
    const roadMat = new THREE.MeshStandardMaterial({
      map: asphaltTex,
      roughness: 0.42,
      metalness: 0.12,
    });
    const roadMesh = new THREE.Mesh(new THREE.PlaneGeometry(24, 180), roadMat);
    roadMesh.rotation.x = -Math.PI / 2;
    roadMesh.position.y = 0;
    roadMesh.receiveShadow = true;
    scene.add(roadMesh);

    const terrainMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.9,
      metalness: 0.05,
    });
    const terrainMesh = new THREE.Mesh(new THREE.PlaneGeometry(240, 260), terrainMat);
    terrainMesh.rotation.x = -Math.PI / 2;
    terrainMesh.position.y = -0.04;
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Raised Left & Right Sidewalk Curbs (offset Y >= 0.02)
    const curbMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.8, metalness: 0.08 });
    const leftCurb = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 180), curbMat);
    leftCurb.position.set(-14.5, 0.175, 0);
    leftCurb.receiveShadow = true;
    scene.add(leftCurb);

    const rightCurb = new THREE.Mesh(new THREE.BoxGeometry(5, 0.35, 180), curbMat);
    rightCurb.position.set(14.5, 0.175, 0);
    rightCurb.receiveShadow = true;
    scene.add(rightCurb);

    // 5. Dynamic Storm-Water Shader Surface (MeshStandardMaterial + onBeforeCompile)
    const waterUniforms = { uTime: { value: 0 } };
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.14,
      metalness: 0.28,
      transparent: true,
      opacity: 0.72,
      envMapIntensity: 1.3,
    });
    waterMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = waterUniforms.uTime;
      shader.vertexShader = `uniform float uTime;\n` + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        float waveA = sin(position.x * 0.45 + uTime * 2.4) * 0.05;
        float waveB = cos(position.y * 0.35 - uTime * 1.9) * 0.05;
        transformed.z += waveA + waveB;`
      );
    };
    const waterMesh = new THREE.Mesh(new THREE.PlaneGeometry(180, 200, 44, 52), waterMat);
    waterMesh.rotation.x = -Math.PI / 2;
    waterMesh.position.y = 0.25;
    waterMesh.receiveShadow = true;
    scene.add(waterMesh);

    // 6. Instanced Roadside Buildings & Trees extending into fog
    const buildingMat = new THREE.MeshStandardMaterial({
      map: facadeTex,
      roughness: 0.65,
      metalness: 0.1,
    });
    const buildingGeom = new THREE.BoxGeometry(1, 1, 1);
    const buildingCount = 36;
    const buildingsInst = new THREE.InstancedMesh(buildingGeom, buildingMat, buildingCount);
    buildingsInst.castShadow = !isSoftwareGl;
    buildingsInst.receiveShadow = true;
    for (let i = 0; i < buildingCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const z = -76 + row * 9;
      const h = 7 + ((i * 5) % 14);
      const w = 8 + ((i * 3) % 4);
      const dLen = 6 + ((i * 7) % 3);
      const x = side * (23 + w * 0.5 + ((i * 2) % 3));
      _vec3.set(x, h * 0.5, z);
      _scale.set(w, h, dLen);
      _quat.identity();
      _mat4.compose(_vec3, _quat, _scale);
      buildingsInst.setMatrixAt(i, _mat4);
      _color.setHSL(0.59, 0.16, 0.52 + ((i * 11) % 18) * 0.01);
      buildingsInst.setColorAt(i, _color);
    }
    buildingsInst.instanceMatrix.needsUpdate = true;
    if (buildingsInst.instanceColor) buildingsInst.instanceColor.needsUpdate = true;
    buildingsInst.computeBoundingSphere();
    scene.add(buildingsInst);

    // Instanced Trees (trunk + foliage canopy pairs with ±15% scale variation)
    const treeCount = 28;
    const trunkInst = new THREE.InstancedMesh(
      new THREE.CylinderGeometry(0.18, 0.26, 2.8, 8),
      new THREE.MeshStandardMaterial({ color: 0x5c4033, roughness: 0.9, metalness: 0.02 }),
      treeCount
    );
    const canopyInst = new THREE.InstancedMesh(
      new THREE.DodecahedronGeometry(1.5, 1),
      new THREE.MeshStandardMaterial({ color: 0x15803d, roughness: 0.78, metalness: 0.04 }),
      treeCount
    );
    trunkInst.castShadow = !isSoftwareGl;
    canopyInst.castShadow = !isSoftwareGl;
    for (let i = 0; i < treeCount; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const row = Math.floor(i / 2);
      const z = -72 + row * 11;
      const x = side * 14.5;
      const s = 0.85 + ((i * 13) % 30) * 0.01;
      _vec3.set(x, 0.35 + 1.4 * s, z);
      _scale.set(s, s, s);
      _quat.identity();
      _mat4.compose(_vec3, _quat, _scale);
      trunkInst.setMatrixAt(i, _mat4);

      _vec3.set(x, 0.35 + 3.2 * s, z);
      _scale.set(s * 1.1, s * 0.95, s * 1.1);
      _mat4.compose(_vec3, _quat, _scale);
      canopyInst.setMatrixAt(i, _mat4);

      _color.setHSL(0.37, 0.55, 0.32 + ((i * 7) % 12) * 0.012);
      canopyInst.setColorAt(i, _color);
    }
    trunkInst.instanceMatrix.needsUpdate = true;
    canopyInst.instanceMatrix.needsUpdate = true;
    if (canopyInst.instanceColor) canopyInst.instanceColor.needsUpdate = true;
    trunkInst.computeBoundingSphere();
    canopyInst.computeBoundingSphere();
    scene.add(trunkInst, canopyInst);

    // 7. Hero Composite 9-Part Amphibious Flood Rescue Vehicle (THREE.Group, bottom-center pivot)
    const roverGroup = new THREE.Group();
    const hullShape = new THREE.Shape();
    hullShape.moveTo(-1.05, -1.85);
    hullShape.lineTo(1.05, -1.85);
    hullShape.lineTo(1.15, 0.9);
    hullShape.lineTo(0.65, 1.95);
    hullShape.lineTo(-0.65, 1.95);
    hullShape.lineTo(-1.15, 0.9);
    hullShape.closePath();

    const hullGeom = new THREE.ExtrudeGeometry(hullShape, {
      depth: 0.65,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.08,
      bevelThickness: 0.08,
    });
    hullGeom.rotateX(Math.PI / 2);
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.34, metalness: 0.22 });
    const hullMesh = new THREE.Mesh(hullGeom, hullMat);
    hullMesh.position.y = 0.95;
    hullMesh.castShadow = !isSoftwareGl;
    roverGroup.add(hullMesh);

    // Rubberized fender bumper (high roughness contrast)
    const rubberMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.88, metalness: 0.04 });
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(2.38, 0.24, 3.85), rubberMat);
    bumper.position.set(0, 0.48, 0);
    roverGroup.add(bumper);

    // Brushed aluminum side rails
    const metalRailMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.22, metalness: 0.88 });
    for (const sx of [-1.02, 1.02]) {
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.5, 8), metalRailMat);
      rail.rotation.x = Math.PI / 2;
      rail.position.set(sx, 1.12, -0.1);
      roverGroup.add(rail);
    }

    // Enclosed cab + tinted optical glass canopy
    const cabBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.55, 0.68, 1.5),
      new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.3, metalness: 0.15 })
    );
    cabBody.position.set(0, 1.28, 0.15);
    cabBody.castShadow = !isSoftwareGl;
    roverGroup.add(cabBody);

    const glassMat = new THREE.MeshPhysicalMaterial({
      color: 0x0c4a6e,
      roughness: 0.08,
      metalness: 0.1,
      clearcoat: 1.0,
      transparent: true,
      opacity: isSoftwareGl ? 0.65 : 0.82,
    });
    const windshield = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.42, 1.28), glassMat);
    windshield.position.set(0, 1.38, 0.22);
    roverGroup.add(windshield);

    // Roof emergency lightbar + beacon PointLight
    const amberBeacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.14, 0.22),
      new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 1.8, roughness: 0.2 })
    );
    amberBeacon.position.set(-0.32, 1.7, 0.15);
    const blueBeacon = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.14, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x0ea5e9, emissive: 0x0ea5e9, emissiveIntensity: 1.8, roughness: 0.2 })
    );
    blueBeacon.position.set(0.32, 1.7, 0.15);
    roverGroup.add(amberBeacon, blueBeacon);

    const roverHeadlight = new THREE.PointLight(0xfffbeb, 3.5, 18, 1.5);
    roverHeadlight.position.set(0, 1.2, 2.1);
    roverGroup.add(roverHeadlight);

    // 4 low-pressure amphibious tires
    const wheelGeom = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 14);
    wheelGeom.rotateZ(Math.PI / 2);
    for (const [wx, wz] of [
      [-1.12, 1.15],
      [1.12, 1.15],
      [-1.12, -1.15],
      [1.12, -1.15],
    ]) {
      const wheel = new THREE.Mesh(wheelGeom, rubberMat);
      wheel.position.set(wx, 0.42, wz);
      roverGroup.add(wheel);
    }

    // Rear spinning impeller turbine
    const impellerGroup = new THREE.Group();
    const impellerRing = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 16), metalRailMat);
    const impellerBlade = new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.08, 0.04), hullMat);
    impellerGroup.add(impellerRing, impellerBlade);
    impellerGroup.position.set(0, 0.62, -1.96);
    roverGroup.add(impellerGroup);

    // Commuter passenger indicator badge on rear deck (visible when carrying)
    const passengerIndicator = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.26, 0.55, 10),
      new THREE.MeshStandardMaterial({ color: 0x10b981, emissive: 0x059669, emissiveIntensity: 0.7, roughness: 0.4 })
    );
    passengerIndicator.position.set(0, 1.18, -1.1);
    passengerIndicator.visible = false;
    roverGroup.add(passengerIndicator);

    roverGroup.position.set(0, 0, 22);
    scene.add(roverGroup);

    // 8. Elevated Relief Shelter Hub (Composite 5-part THREE.Group)
    const shelterGroup = new THREE.Group();
    const plinth = new THREE.Mesh(
      new THREE.BoxGeometry(8.5, 1.4, 8.5),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.8, metalness: 0.06 })
    );
    plinth.position.y = 0.7;
    plinth.receiveShadow = true;
    shelterGroup.add(plinth);

    const canopyRoof = new THREE.Mesh(
      new THREE.BoxGeometry(8.8, 0.35, 8.8),
      new THREE.MeshStandardMaterial({ color: 0x0f4c81, roughness: 0.35, metalness: 0.45 })
    );
    canopyRoof.position.y = 4.6;
    canopyRoof.castShadow = !isSoftwareGl;
    shelterGroup.add(canopyRoof);

    for (const [cx, cz] of [
      [-3.6, -3.6],
      [3.6, -3.6],
      [-3.6, 3.6],
      [3.6, 3.6],
    ]) {
      const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.3, 10), metalRailMat);
      pillar.position.set(cx, 2.95, cz);
      shelterGroup.add(pillar);
    }

    const crossMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.2,
      roughness: 0.25,
    });
    const crossH = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.65, 0.25), crossMat);
    const crossV = new THREE.Mesh(new THREE.BoxGeometry(0.65, 2.4, 0.25), crossMat);
    crossH.position.set(0, 3.3, 4.45);
    crossV.position.set(0, 3.3, 4.45);
    shelterGroup.add(crossH, crossV);

    shelterGroup.position.set(-7.2, 0, 34);
    scene.add(shelterGroup);

    // 9. Interactive Storm Drain Nodes (5 composite 5-part stations along street curbs)
    interface DrainNode {
      id: number;
      group: THREE.Group;
      debris: THREE.Mesh;
      beaconMat: THREE.MeshStandardMaterial;
      x: number;
      z: number;
      clogged: boolean;
      respawnTimer: number;
    }

    const drainSpots: Array<[number, number]> = [
      [-9.2, 12],
      [9.2, 2],
      [-9.2, -16],
      [9.2, -30],
      [-9.2, -46],
    ];

    const drainNodes: DrainNode[] = drainSpots.map(([dx, dz], idx) => {
      const g = new THREE.Group();
      const pad = new THREE.Mesh(
        new THREE.BoxGeometry(2.6, 0.22, 2.6),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.85, metalness: 0.1 })
      );
      pad.position.y = 0.11;

      const grate = new THREE.Mesh(
        new THREE.BoxGeometry(1.7, 0.26, 1.7),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.4, metalness: 0.8 })
      );
      grate.position.y = 0.14;

      const debris = new THREE.Mesh(
        new THREE.DodecahedronGeometry(0.75, 0),
        new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.92, metalness: 0.02 })
      );
      debris.scale.set(1.2, 0.55, 1.2);
      debris.position.y = 0.45;

      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 2.9, 8), metalRailMat);
      pole.position.set(dx < 0 ? -1.05 : 1.05, 1.45, 0);

      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xef4444,
        emissiveIntensity: 1.5,
        roughness: 0.2,
      });
      const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 12), beaconMat);
      beacon.position.set(dx < 0 ? -1.05 : 1.05, 3.05, 0);

      g.add(pad, grate, debris, pole, beacon);
      g.position.set(dx, 0, dz);
      scene.add(g);

      return {
        id: idx,
        group: g,
        debris,
        beaconMat,
        x: dx,
        z: dz,
        clogged: idx < 3,
        respawnTimer: idx < 3 ? 0 : 8 + idx * 5,
      };
    });

    // 10. Stranded Commuters (4 multi-part groups on curb bus islands)
    interface CommuterTarget {
      group: THREE.Group;
      x: number;
      z: number;
      active: boolean;
      respawnTimer: number;
    }

    const commuterCoords: Array<[number, number]> = [
      [11.2, 16],
      [-11.2, -6],
      [11.2, -22],
      [-11.2, -38],
    ];

    const commuters: CommuterTarget[] = commuterCoords.map(([cx, cz], idx) => {
      const g = new THREE.Group();
      const torso = new THREE.Mesh(
        new THREE.CylinderGeometry(0.28, 0.34, 0.95, 10),
        new THREE.MeshStandardMaterial({ color: 0xfacc15, roughness: 0.55, metalness: 0.05 })
      );
      torso.position.y = 0.85;
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.24, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0xfde68a, roughness: 0.6 })
      );
      head.position.y = 1.55;
      const beaconRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.9, 0.07, 8, 20),
        new THREE.MeshStandardMaterial({ color: 0x38bdf8, emissive: 0x0284c7, emissiveIntensity: 1.4 })
      );
      beaconRing.rotation.x = Math.PI / 2;
      beaconRing.position.y = 0.35;

      g.add(torso, head, beaconRing);
      g.position.set(cx, 0.3, cz);
      g.visible = idx < 2;
      scene.add(g);
      return { group: g, x: cx, z: cz, active: idx < 2, respawnTimer: idx < 2 ? 0 : 10 + idx * 4 };
    });

    // 11. Drifting Storm Hazards (barrels/debris crates)
    interface HazardDrum {
      mesh: THREE.Group;
      x: number;
      z: number;
      vx: number;
      cooldown: number;
    }

    const hazards: HazardDrum[] = [];
    const hazardMat = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.45, metalness: 0.35 });
    const stripeMat = new THREE.MeshStandardMaterial({ color: 0xfef08a, roughness: 0.4, metalness: 0.1 });
    for (let i = 0; i < 5; i++) {
      const hg = new THREE.Group();
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.0, 12), hazardMat);
      body.position.y = 0.5;
      const band = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.57, 0.24, 12), stripeMat);
      band.position.y = 0.55;
      hg.add(body, band);
      const hx = (i % 2 === 0 ? -4.5 : 4.5);
      const hz = -38 + i * 16;
      hg.position.set(hx, 0.1, hz);
      scene.add(hg);
      hazards.push({ mesh: hg, x: hx, z: hz, vx: i % 2 === 0 ? 1.8 : -1.8, cooldown: 0 });
    }

    // 12. Monsoon Rain Streaks (Points with zero per-frame allocations)
    const rainCount = 750;
    const rainPositions = new Float32Array(rainCount * 3);
    for (let i = 0; i < rainCount; i++) {
      rainPositions[i * 3] = (Math.random() - 0.5) * 65;
      rainPositions[i * 3 + 1] = Math.random() * 28;
      rainPositions[i * 3 + 2] = (Math.random() - 0.5) * 90;
    }
    const rainGeo = new THREE.BufferGeometry();
    rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
    const rainMat = new THREE.PointsMaterial({
      color: 0xbae6fd,
      size: 0.24,
      transparent: true,
      opacity: 0.55,
    });
    const rainPoints = new THREE.Points(rainGeo, rainMat);
    scene.add(rainPoints);

    // Mutable Simulation State inside Effect
    let phase: GamePhase = 'title';
    let score = 0;
    let floodPct = 38;
    let hullPct = 100;
    let drainsCleared = 0;
    let rescuedCount = 0;
    let carryingCount = 0;
    let timeRemaining = 90;
    let hintText = 'Drive near red storm drains & press Clear Drain [Space]!';

    const roverState = {
      x: 0,
      z: 22,
      heading: Math.PI, // facing -Z down the boulevard
      speed: 0,
    };

    const syncDrainsVisual = () => {
      for (const node of drainNodes) {
        node.debris.visible = node.clogged;
        node.beaconMat.color.setHex(node.clogged ? 0xef4444 : 0x10b981);
        node.beaconMat.emissive.setHex(node.clogged ? 0xef4444 : 0x10b981);
      }
    };
    syncDrainsVisual();

    const resetGameState = () => {
      score = 0;
      floodPct = 38;
      hullPct = 100;
      drainsCleared = 0;
      rescuedCount = 0;
      carryingCount = 0;
      timeRemaining = 90;
      roverState.x = 0;
      roverState.z = 22;
      roverState.heading = Math.PI;
      roverState.speed = 0;
      passengerIndicator.visible = false;
      drainNodes.forEach((n, idx) => {
        n.clogged = idx < 3;
        n.respawnTimer = idx < 3 ? 0 : 7 + idx * 4;
      });
      syncDrainsVisual();
      commuters.forEach((c, idx) => {
        c.active = idx < 2;
        c.group.visible = c.active;
        c.respawnTimer = c.active ? 0 : 8 + idx * 4;
      });
      hintText = 'Patrol active! Clear red clogged drains & rescue commuters to the green shelter.';
      phase = 'playing';
      setHud({
        phase,
        score,
        floodPct,
        hullPct,
        drainsCleared,
        rescuedCount,
        carryingCount,
        timeRemaining,
        hintText,
      });
    };

    phaseControlRef.current = {
      setPhase: (next: GamePhase) => {
        phase = next;
        setHud((prev) => ({ ...prev, phase }));
      },
      resetGame: resetGameState,
    };

    // Keyboard controls
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') controlsRef.current.forward = true;
      if (k === 's' || e.key === 'ArrowDown') controlsRef.current.backward = true;
      if (k === 'a' || e.key === 'ArrowLeft') controlsRef.current.left = true;
      if (k === 'd' || e.key === 'ArrowRight') controlsRef.current.right = true;
      if (e.code === 'Space') {
        e.preventDefault();
        controlsRef.current.actionTriggered = true;
      }
      if (k === 'h') {
        setDockCollapsed((v) => !v);
      }
      if (k === 'p') {
        if (phase === 'playing') phaseControlRef.current?.setPhase('paused');
        else if (phase === 'paused') phaseControlRef.current?.setPhase('playing');
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      if (k === 'w' || e.key === 'ArrowUp') controlsRef.current.forward = false;
      if (k === 's' || e.key === 'ArrowDown') controlsRef.current.backward = false;
      if (k === 'a' || e.key === 'ArrowLeft') controlsRef.current.left = false;
      if (k === 'd' || e.key === 'ArrowRight') controlsRef.current.right = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 560;
      camera.aspect = w / Math.max(1, h);
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', onResize);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    const clock = new THREE.Clock();
    let frameId = 0;
    let hudSyncAcc = 0;
    let disposed = false;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      gl.flush();
      const poll = () => {
        if (disposed) {
          if (sync) gl.deleteSync(sync);
          return;
        }
        const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          if (sync) gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 80);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    const tick = () => {
      if (disposed) return;
      const dt = Math.min(clock.getDelta(), 0.05);
      const elapsed = clock.getElapsedTime();

      waterUniforms.uTime.value = elapsed;

      // Animate rain streaks around rover
      const posAttr = rainGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < rainCount; i++) {
        let ry = posAttr.getY(i) - dt * 24;
        if (ry < 0) {
          ry = 26;
          posAttr.setX(i, roverState.x + (Math.random() - 0.5) * 65);
          posAttr.setZ(i, roverState.z + (Math.random() - 0.5) * 90);
        }
        posAttr.setY(i, ry);
      }
      posAttr.needsUpdate = true;

      if (phase === 'playing') {
        timeRemaining = Math.max(0, timeRemaining - dt);

        // Steering & propulsion
        const turnInput = (controlsRef.current.left ? 1 : 0) - (controlsRef.current.right ? 1 : 0);
        const throttleInput = (controlsRef.current.forward ? 1 : 0) - (controlsRef.current.backward ? 1 : 0);

        roverState.heading += turnInput * 2.45 * dt;
        const targetSpeed = throttleInput * 14.5;
        roverState.speed = THREE.MathUtils.damp(roverState.speed, targetSpeed, 6.5, dt);

        roverState.x += Math.sin(roverState.heading) * roverState.speed * dt;
        roverState.z += Math.cos(roverState.heading) * roverState.speed * dt;

        // Keep within boulevard corridor bounds
        roverState.x = THREE.MathUtils.clamp(roverState.x, -11.2, 11.2);
        roverState.z = THREE.MathUtils.clamp(roverState.z, -62, 46);

        // Hydro impeller rotation & subtle wave bob
        impellerGroup.rotation.z += (4 + Math.abs(roverState.speed) * 1.6) * dt;
        const waterY = 0.14 + (floodPct / 100) * 1.15;
        waterMesh.position.y = THREE.MathUtils.damp(waterMesh.position.y, waterY, 4, dt);

        const roverY = Math.max(0.02, waterMesh.position.y - 0.25) + Math.sin(elapsed * 4.2) * 0.04;
        roverGroup.position.set(roverState.x, roverY, roverState.z);
        roverGroup.rotation.y = roverState.heading;
        roverGroup.rotation.z = THREE.MathUtils.damp(roverGroup.rotation.z, -turnInput * 0.08, 8, dt);

        // Drain surge rate depends on how many drains remain clogged
        let activeClogs = 0;
        for (const node of drainNodes) {
          if (node.clogged) {
            activeClogs++;
            node.group.position.y = Math.sin(elapsed * 5 + node.id) * 0.03;
          } else {
            node.respawnTimer -= dt;
            if (node.respawnTimer <= 0) {
              node.clogged = true;
              node.respawnTimer = 0;
              syncDrainsVisual();
            }
          }
        }
        floodPct = THREE.MathUtils.clamp(floodPct + (0.65 + activeClogs * 0.72) * dt, 10, 100);

        // Handle Drain Clearing (automatic proximity prompt OR Space trigger)
        let nearCloggedDrain: DrainNode | null = null;
        for (const node of drainNodes) {
          if (!node.clogged) continue;
          const dist = Math.hypot(roverState.x - node.x, roverState.z - node.z);
          if (dist < 4.5) {
            nearCloggedDrain = node;
            break;
          }
        }

        if (controlsRef.current.actionTriggered) {
          controlsRef.current.actionTriggered = false;
          if (nearCloggedDrain) {
            nearCloggedDrain.clogged = false;
            nearCloggedDrain.respawnTimer = 15;
            syncDrainsVisual();
            drainsCleared += 1;
            score += 150;
            floodPct = Math.max(12, floodPct - 14);
            audio.playDrainCleared();
            hintText = `Drain #${nearCloggedDrain.id + 1} cleared! Flood surge dropped -14%.`;
          } else {
            hintText = 'Move within 4.5m of a red pulsing drain pole to clear it!';
          }
        } else if (nearCloggedDrain) {
          hintText = 'In range! Press [Space] or tap Clear Drain now!';
        }

        // Stranded commuter pickup & drop-off at Relief Shelter
        for (const c of commuters) {
          if (!c.active) {
            c.respawnTimer -= dt;
            if (c.respawnTimer <= 0 && carryingCount === 0) {
              c.active = true;
              c.group.visible = true;
            }
            continue;
          }
          c.group.rotation.y += dt * 1.4;
          const dist = Math.hypot(roverState.x - c.x, roverState.z - c.z);
          if (dist < 3.4 && carryingCount < 2) {
            c.active = false;
            c.group.visible = false;
            c.respawnTimer = 14;
            carryingCount += 1;
            passengerIndicator.visible = true;
            audio.playRescuePickup();
            hintText = `Commuter aboard (${carryingCount}/2)! Deliver to green Relief Hub at South end.`;
          }
        }

        // Relief shelter drop-off
        const distShelter = Math.hypot(roverState.x - -7.2, roverState.z - 34);
        if (distShelter < 6.4 && carryingCount > 0) {
          rescuedCount += carryingCount;
          score += carryingCount * 300;
          floodPct = Math.max(10, floodPct - carryingCount * 5);
          carryingCount = 0;
          passengerIndicator.visible = false;
          audio.playShelterDropoff();
          hintText = `Safe delivery! ${rescuedCount} commuters sheltered (+300 pts each).`;
        }

        // Drifting storm hazards collision
        for (const hz of hazards) {
          if (hz.cooldown > 0) hz.cooldown -= dt;
          hz.x += hz.vx * dt;
          if (hz.x > 10.5 || hz.x < -10.5) hz.vx *= -1;
          hz.mesh.position.set(hz.x, Math.max(0.05, waterMesh.position.y - 0.1), hz.z);
          hz.mesh.rotation.y += dt * 1.2;

          if (hz.cooldown <= 0 && Math.hypot(roverState.x - hz.x, roverState.z - hz.z) < 2.2) {
            hz.cooldown = 1.6;
            hullPct = Math.max(0, hullPct - 18);
            roverState.speed *= -0.4;
            audio.playHazardBump();
            hintText = 'Collision with drifting storm drum! Hull damaged (-18%).';
          }
        }

        // Win / Loss conditions
        if (floodPct >= 100 || hullPct <= 0) {
          phase = 'gameover';
          hintText = floodPct >= 100 ? 'Street drains overflowed!' : 'Rescue rover hull disabled!';
        } else if (timeRemaining <= 0) {
          phase = 'victory';
          score += Math.round(hullPct * 5);
          hintText = 'Monsoon cloudburst peak survived! Street corridor stayed passable.';
        }
      } else {
        // Gentle idle bob on title / pause screens
        roverGroup.position.y = 0.08 + Math.sin(elapsed * 2.5) * 0.05;
        impellerGroup.rotation.z += 2.2 * dt;
      }

      // Smoothly damped camera follow
      if (controlsRef.current.cameraMode === 'chase') {
        const camBack = 14;
        const camHeight = 8.8;
        _vec3.set(
          roverState.x - Math.sin(roverState.heading) * camBack,
          camHeight,
          roverState.z - Math.cos(roverState.heading) * camBack
        );
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _vec3.x, 5.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _vec3.y, 5.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _vec3.z, 5.5, dt);

        _vec3B.set(
          roverState.x + Math.sin(roverState.heading) * 6,
          1.2,
          roverState.z + Math.cos(roverState.heading) * 6
        );
        camera.lookAt(_vec3B);
      } else {
        _vec3C.set(roverState.x, 28, roverState.z + 10);
        camera.position.x = THREE.MathUtils.damp(camera.position.x, _vec3C.x, 4.5, dt);
        camera.position.y = THREE.MathUtils.damp(camera.position.y, _vec3C.y, 4.5, dt);
        camera.position.z = THREE.MathUtils.damp(camera.position.z, _vec3C.z, 4.5, dt);
        camera.lookAt(roverState.x, 0.5, roverState.z - 2);
      }

      hudSyncAcc += dt;
      if (hudSyncAcc >= 0.14 || phase === 'gameover' || phase === 'victory') {
        hudSyncAcc = 0;
        setHud({
          phase,
          score,
          floodPct: Math.round(floodPct),
          hullPct: Math.round(hullPct),
          drainsCleared,
          rescuedCount,
          carryingCount,
          timeRemaining: Math.ceil(timeRemaining),
          hintText,
        });
      }

      renderer.render(scene, camera);
      if (isSoftwareGl) afterDraw(tick);
      else frameId = requestAnimationFrame(tick);
    };

    if (isSoftwareGl) afterDraw(tick);
    else frameId = requestAnimationFrame(tick);

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('resize', onResize);
      audio.dispose();

      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh || obj instanceof THREE.Points) {
          obj.geometry?.dispose();
          if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
          else obj.material?.dispose();
        }
      });
      asphaltTex.dispose();
      facadeTex.dispose();
      envTarget.dispose();
      renderer.dispose();
      if (renderer.domElement.parentElement === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  const toggleMute = () => {
    setMuted((m) => {
      const next = !m;
      if (audioRef.current) audioRef.current.muted = next;
      return next;
    });
  };

  const primaryCorridor = streets[0]?.name || 'Anna Salai / Velachery Pilot';

  return (
    <section
      className={
        expanded
          ? 'fixed inset-0 z-[1200] flex flex-col bg-slate-950'
          : 'mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8'
      }
    >
      <div
        className={`relative overflow-hidden border border-slate-800 bg-slate-950 ${
          expanded ? 'h-full w-full' : 'h-[580px] w-full rounded-2xl shadow-lg md:h-[660px]'
        }`}
      >
        {/* Dedicated empty mount container for WebGL canvas */}
        <div ref={mountRef} className="absolute inset-0 h-full w-full" aria-label="Drain Defense 3D Flood Rescue Game" />

        {/* Minimal Top-Left Live HUD Badge (solid dark surface — zero backdrop-filter over WebGL, zero pulsing dots) */}
        <div className="pointer-events-none absolute top-3 left-3 right-3 z-10 flex flex-wrap items-start justify-between gap-2">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-slate-700 bg-slate-900/92 px-3.5 py-2 text-xs text-slate-100 shadow-md">
            <div>
              <span className="font-display font-bold text-white">Drain Defense 3D</span>
              <span className="ml-2 hidden text-[11px] text-slate-400 sm:inline">{primaryCorridor}</span>
            </div>
            <span className="text-slate-600">|</span>
            <span className="font-mono font-semibold text-amber-300 tabular-nums">Score {hud.score}</span>
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Droplets className="h-3.5 w-3.5 text-sky-400" />
              Surge {hud.floodPct}%
            </span>
            <span className="inline-flex items-center gap-1 font-mono tabular-nums">
              <Heart className="h-3.5 w-3.5 text-rose-400" />
              Hull {hud.hullPct}%
            </span>
            <span className="font-mono text-emerald-300 tabular-nums">
              Rescued {hud.rescuedCount} {hud.carryingCount > 0 ? `(+${hud.carryingCount} aboard)` : ''}
            </span>
            <span className="font-mono text-slate-300 tabular-nums">{hud.timeRemaining}s</span>
          </div>

          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-700 bg-slate-900/92 px-2.5 text-xs font-semibold text-slate-100 hover:bg-slate-800"
            >
              {expanded ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline">{expanded ? 'Exit Fullscreen' : 'Fullscreen'}</span>
            </button>
            {onExit && (
              <button
                type="button"
                onClick={onExit}
                className="inline-flex h-9 items-center rounded-lg border border-slate-700 bg-slate-900/92 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-800"
              >
                Back to Map
              </button>
            )}
          </div>
        </div>

        {/* Live Mission Hint Strip (Compact, Top Center) */}
        {hud.phase === 'playing' && (
          <div className="pointer-events-none absolute top-16 left-1/2 z-10 hidden -translate-x-1/2 rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-1 text-[11px] font-medium text-sky-200 sm:block">
            {hud.hintText}
          </div>
        )}

        {/* Title / Pause / Victory / Game Over Modal Overlay */}
        {hud.phase !== 'playing' && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-slate-950/75 p-4">
            <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-6 text-center text-white shadow-2xl">
              {hud.phase === 'title' && (
                <>
                  <p className="text-xs font-semibold tracking-wider text-sky-400">INTERACTIVE 3D FLOOD SIMULATOR</p>
                  <h2 className="mt-1 font-display text-2xl font-bold">
                    {lang === 'ta' ? 'வடிகால் பாதுகாப்பு 3D' : 'Drain Defense 3D: Monsoon Patrol'}
                  </h2>
                  <p className="mt-2 text-xs leading-relaxed text-slate-300">
                    Pilot the municipal amphibious rescue rover through rising floodwaters. Clear clogged storm drains (Space) to lower flood surge, dodge drifting barrels, and ferry stranded commuters to the elevated green Relief Hub!
                  </p>
                  <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-left text-[11px] text-slate-300">
                    <div><strong className="text-white">WASD / Arrows:</strong> Steer Rover</div>
                    <div><strong className="text-white">Space:</strong> Clear Storm Drain</div>
                    <div><strong className="text-white">H Key:</strong> Toggle Bottom Dock</div>
                    <div><strong className="text-white">P Key:</strong> Pause Simulation</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => phaseControlRef.current?.resetGame()}
                    className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-500"
                  >
                    <Play className="h-4 w-4" />
                    <span>Launch Monsoon Patrol</span>
                  </button>
                </>
              )}

              {hud.phase === 'paused' && (
                <>
                  <h2 className="font-display text-2xl font-bold">Patrol Paused</h2>
                  <p className="mt-1 text-xs text-slate-300">
                    Score {hud.score} · Drains cleared {hud.drainsCleared} · Rescued {hud.rescuedCount}
                  </p>
                  <div className="mt-5 flex gap-2">
                    <button
                      type="button"
                      onClick={() => phaseControlRef.current?.setPhase('playing')}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#0F4C81] text-sm font-semibold text-white hover:bg-[#0c3c66]"
                    >
                      <Play className="h-4 w-4" />
                      Resume
                    </button>
                    <button
                      type="button"
                      onClick={() => phaseControlRef.current?.resetGame()}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl border border-slate-700 bg-slate-800 text-sm font-semibold text-white hover:bg-slate-700"
                    >
                      <RotateCcw className="h-4 w-4" />
                      Restart
                    </button>
                  </div>
                </>
              )}

              {(hud.phase === 'victory' || hud.phase === 'gameover') && (
                <>
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-slate-800">
                    {hud.phase === 'victory' ? (
                      <Award className="h-6 w-6 text-emerald-400" />
                    ) : (
                      <ShieldAlert className="h-6 w-6 text-rose-400" />
                    )}
                  </div>
                  <h2 className="mt-3 font-display text-2xl font-bold">
                    {hud.phase === 'victory' ? 'Corridor Kept Passable!' : 'Drain Overflow Reached'}
                  </h2>
                  <p className="mt-1 text-xs text-slate-300">{hud.hintText}</p>
                  <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl border border-slate-800 bg-slate-950/70 p-3 text-xs">
                    <div>
                      <div className="text-[11px] text-slate-400">Final Score</div>
                      <div className="font-mono text-base font-bold text-amber-300">{hud.score}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Drains Cleared</div>
                      <div className="font-mono text-base font-bold text-sky-300">{hud.drainsCleared}</div>
                    </div>
                    <div>
                      <div className="text-[11px] text-slate-400">Rescued</div>
                      <div className="font-mono text-base font-bold text-emerald-300">{hud.rescuedCount}</div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => phaseControlRef.current?.resetGame()}
                    className="mt-5 inline-flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-orange-600 px-5 text-sm font-bold text-white hover:bg-orange-500"
                  >
                    <RotateCcw className="h-4 w-4" />
                    <span>Play Another Patrol</span>
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* Unified Collapsible Bottom Control Dock (Zero Mid-Screen Occlusion) */}
        <div
          className={`absolute left-1/2 z-20 -translate-x-1/2 transition-transform duration-200 ${
            dockCollapsed ? 'bottom-0 translate-y-[calc(100%-34px)]' : 'bottom-3 translate-y-0'
          } w-[min(900px,95%)]`}
        >
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => setDockCollapsed((v) => !v)}
              className="inline-flex h-8 items-center gap-1 rounded-t-xl border border-b-0 border-slate-700 bg-slate-900/95 px-3 text-[11px] font-semibold text-slate-200 hover:text-white"
            >
              {dockCollapsed ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              <span>{dockCollapsed ? 'Show Controls [H]' : 'Hide Controls [H]'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-slate-700 bg-slate-900/95 px-3 py-2.5 text-xs text-slate-100 shadow-xl">
            {/* On-screen Drive Controls for Touch & Mouse */}
            <div className="flex items-center gap-1">
              {(
                [
                  { label: '◀', key: 'left' },
                  { label: '▲', key: 'forward' },
                  { label: '▼', key: 'backward' },
                  { label: '▶', key: 'right' },
                ] as const
              ).map((btn) => (
                <button
                  key={btn.key}
                  type="button"
                  onPointerDown={() => {
                    controlsRef.current[btn.key] = true;
                  }}
                  onPointerUp={() => {
                    controlsRef.current[btn.key] = false;
                  }}
                  onPointerLeave={() => {
                    controlsRef.current[btn.key] = false;
                  }}
                  className="flex h-10 w-10 touch-none items-center justify-center rounded-lg border border-slate-700 bg-slate-800 font-bold text-white active:bg-[#0F4C81]"
                >
                  {btn.label}
                </button>
              ))}
            </div>

            {/* Primary Action: Clear Drain */}
            <button
              type="button"
              onClick={() => {
                controlsRef.current.actionTriggered = true;
              }}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-500 active:bg-orange-700"
            >
              <Wrench className="h-3.5 w-3.5" />
              <span>Clear Drain [Space]</span>
            </button>

            {/* Utility Controls */}
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setCameraMode((m) => (m === 'chase' ? 'overhead' : 'chase'))}
                className="min-h-[38px] rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Cam: {cameraMode === 'chase' ? 'Chase' : 'Overhead'}
              </button>
              <button
                type="button"
                onClick={toggleMute}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                aria-label={muted ? 'Unmute audio' : 'Mute audio'}
              >
                {muted ? <VolumeX className="h-4 w-4 text-slate-400" /> : <Volume2 className="h-4 w-4 text-sky-400" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (hud.phase === 'playing') phaseControlRef.current?.setPhase('paused');
                  else if (hud.phase === 'paused') phaseControlRef.current?.setPhase('playing');
                }}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                aria-label="Pause or resume"
              >
                {hud.phase === 'paused' ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => phaseControlRef.current?.resetGame()}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 text-slate-200 hover:bg-slate-700"
                aria-label="Reset mission"
              >
                <RotateCcw className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
