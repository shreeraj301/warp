import * as THREE from "three";
import type { WarpAudio } from "@/game/audio";
import { createBodies, type InspectBody } from "@/game/bodies";

export type WarpSim = {
  cruise: number;
  density: number;
  sensitivity: number;
  streak: number;
  sound: boolean;
  boostLatched: boolean;
  engaged: boolean;
  reduced: boolean;
};

export type WarpHooks = {
  canvas: HTMLCanvasElement;
  root: HTMLElement;
  reticle: HTMLElement;
  fpsNode: HTMLElement;
  velocityNode: HTMLElement;
  cruiseInput: HTMLInputElement | null;
  onBoostVisual: (active: boolean) => void;
  onFail: (message: string) => void;
  onInspect: (body: InspectBody | null) => void;
  registerDeselect: (fn: () => void) => void;
  getSim: () => WarpSim;
  audio: WarpAudio;
};

const STAR_VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aBright;
attribute vec3 aColor;
uniform mat4 uProjection;
uniform mat4 uView;
uniform mat4 uViewPrev;
uniform vec3 uCam;
uniform vec3 uCamPrev;
uniform vec2 uResolution;
uniform float uBox;
uniform float uBoost;
uniform float uSize;
uniform float uTime;
varying float vAcross;
varying float vAlong;
varying float vPoint;
varying float vBright;
varying vec3 vColor;
varying float vFade;

vec3 wrapBox(vec3 p, float box) {
  float h = box * 0.5;
  return mod(p + h, box) - h;
}

void main() {
  vec3 world = aSeed * uBox;
  vec3 rel = wrapBox(world - uCam, uBox);
  float edge = max(abs(rel.x), max(abs(rel.y), abs(rel.z))) / (uBox * 0.5);
  float fade = 1.0 - smoothstep(0.8, 1.0, edge);

  vec3 relPrev = rel + (uCam - uCamPrev);
  vec3 viewNow = (uView * vec4(rel, 0.0)).xyz;
  vec3 viewPrev = (uViewPrev * vec4(relPrev, 0.0)).xyz;

  const float NEAR = 0.45;
  bool drop = fade < 0.01 || (viewNow.z > -NEAR && viewPrev.z > -NEAR);
  if (viewPrev.z > -NEAR && viewNow.z < -NEAR) {
    float t = (-NEAR - viewNow.z) / (viewPrev.z - viewNow.z);
    viewPrev = mix(viewNow, viewPrev, clamp(t, 0.0, 1.0));
  }
  if (viewNow.z > -NEAR && viewPrev.z < -NEAR) {
    float t = (-NEAR - viewPrev.z) / (viewNow.z - viewPrev.z);
    viewNow = mix(viewPrev, viewNow, clamp(t, 0.0, 1.0));
  }

  vec4 c0 = uProjection * vec4(viewPrev, 1.0);
  vec4 c1 = uProjection * vec4(viewNow, 1.0);
  vec2 n0 = c0.xy / max(c0.w, 0.0001);
  vec2 n1 = c1.xy / max(c1.w, 0.0001);
  vec2 dir = n1 - n0;
  float len = length(dir);
  float maxLen = mix(0.22, 0.62, uBoost);
  if (len > maxLen) {
    n0 = n1 - dir / len * maxLen;
    len = maxLen;
    dir = n1 - n0;
  }
  vec2 perp = len > 0.00008 ? vec2(-dir.y, dir.x) / len : vec2(0.0, 1.0);

  float dist = max(-viewNow.z, 0.45);
  float px = mix(1.15, 2.7, clamp(aBright, 0.0, 1.0)) * uSize * (30.0 / dist);
  px = min(px, mix(14.0, 22.0, uBoost));
  float widthNdc = px * 2.0 / max(uResolution.y, 1.0);

  vec2 corner = position.xy;
  float along = corner.x * 0.5 + 0.5;
  float side = corner.y;
  bool point = len < widthNdc * 0.75;
  vec2 ndc;
  vec4 c;
  if (point) {
    ndc = n1 + corner * widthNdc * 0.55;
    c = c1;
    vAcross = length(corner);
    vAlong = 1.0;
    vPoint = 1.0;
  } else {
    ndc = mix(n0, n1, along) + perp * side * widthNdc * 0.5;
    c = mix(c0, c1, along);
    vAcross = side;
    vAlong = along;
    vPoint = 0.0;
  }

  float tw = 0.9 + 0.1 * sin(uTime * 1.6 + aSeed.x * 18.0);
  tw = mix(tw, 1.0, smoothstep(0.4, 2.5, length(uCam - uCamPrev)));

  vBright = aBright * tw;
  vColor = aColor;
  vFade = fade;

  if (drop || abs(n1.x) > 1.35 || abs(n1.y) > 1.35) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  gl_Position = vec4(ndc * c.w, c.z, c.w);
}
`;

const STAR_FRAG = /* glsl */ `
uniform float uBoost;
varying float vAcross;
varying float vAlong;
varying float vPoint;
varying float vBright;
varying vec3 vColor;
varying float vFade;

void main() {
  float shape;
  if (vPoint > 0.5) {
    float r = vAcross;
    float core = exp(-r * r * 5.5);
    float glow = exp(-r * r * 1.6) * 0.35;
    shape = core + glow;
  } else {
    float core = exp(-vAcross * vAcross * 7.5);
    float glow = exp(-vAcross * vAcross * 1.35) * 0.4;
    float along = smoothstep(0.0, 0.12, vAlong) * (0.28 + 0.72 * vAlong);
    shape = (core + glow) * along;
  }
  shape *= vFade;
  if (shape < 0.015 || vBright < 0.01) discard;

  vec3 col = vColor;
  col = mix(col, vec3(0.72, 0.88, 1.0), 0.18 + uBoost * vAlong * 0.45);
  float exposure = (0.9 + uBoost * 0.45) * vBright;
  vec3 rgb = col * shape * exposure;
  gl_FragColor = vec4(rgb, 1.0);
}
`;

const NEBULA_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const NEBULA_FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColorA;
uniform vec3 uColorB;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(1.0 - smoothstep(0.0, 1.0, d), 1.7);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.15, 0.85, vUv.x));
  gl_FragColor = vec4(col * a * 0.22, 1.0);
}
`;

function damp(current: number, target: number, lambda: number, dt: number) {
  return THREE.MathUtils.damp(current, target, lambda, dt);
}

function deadzone(v: number, zone = 0.07) {
  const a = Math.abs(v);
  if (a < zone) return 0;
  return Math.sign(v) * ((a - zone) / (1 - zone));
}

function makeStarMaterial(size: number) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uProjection: { value: new THREE.Matrix4() },
      uView: { value: new THREE.Matrix4() },
      uViewPrev: { value: new THREE.Matrix4() },
      uCam: { value: new THREE.Vector3() },
      uCamPrev: { value: new THREE.Vector3() },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uBox: { value: 80 },
      uBoost: { value: 0 },
      uSize: { value: size },
      uTime: { value: 0 },
    },
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
    side: THREE.DoubleSide,
  });
}

function hash01(n: number) {
  let x = Math.imul(n >>> 0, 747796405) + 2891336453;
  x >>>= 0;
  let word = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737);
  word >>>= 0;
  return (((word >>> 22) ^ word) >>> 0) / 4294967296;
}

function starColor(tint: number) {
  if (tint > 0.94) return [0.45, 0.8, 1];
  if (tint > 0.9) return [0.92, 0.65, 0.97];
  if (tint > 0.86) return [1, 0.74, 0.62];
  if (tint > 0.82) return [0.71, 0.65, 0.98];
  return [1, 1, 1];
}

function makeStarGeometry(count: number, salt: number) {
  const geo = new THREE.InstancedBufferGeometry();
  const pos = new Float32Array([
    -1, -1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, 1, 1, 0, -1, 1, 0,
  ]);
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));

  const seeds = new Float32Array(count * 3);
  const bright = new Float32Array(count);
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const id = i + 1 + salt;
    seeds[i * 3] = hash01(id) - 0.5;
    seeds[i * 3 + 1] = hash01(id + 17) - 0.5;
    seeds[i * 3 + 2] = hash01(id + 43) - 0.5;
    const n = hash01(id + 91);
    let b = 0.22 + n * n * 0.78;
    if (hash01(id + 7) > 0.94) b = 1.55;
    bright[i] = b;
    const col = starColor(hash01(id + 13));
    colors[i * 3] = col[0];
    colors[i * 3 + 1] = col[1];
    colors[i * 3 + 2] = col[2];
  }
  geo.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 3));
  geo.setAttribute("aBright", new THREE.InstancedBufferAttribute(bright, 1));
  geo.setAttribute("aColor", new THREE.InstancedBufferAttribute(colors, 3));
  geo.instanceCount = 1;
  return geo;
}

type Probe = {
  getYaw: () => number;
  getSpeed: () => number;
  getPitch: () => number;
  setKeys: (codes: string[]) => void;
  setSteer: (v: number) => void;
};

declare global {
  interface Window {
    __controlsTest?: Probe;
  }
}

export function mountWarp(hooks: WarpHooks): () => void {
  const { canvas, root, reticle, fpsNode, velocityNode, getSim, audio, onBoostVisual, onFail, onInspect, registerDeselect } =
    hooks;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: "high-performance",
      stencil: false,
      depth: true,
      failIfMajorPerformanceCaveat: false,
    });
  } catch (err) {
    onFail(err instanceof Error ? err.message : "WebGL is unavailable.");
    return () => {};
  }

  renderer.setClearColor(0x090909, 1);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setAnimationLoop(null);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 2000);
  camera.rotation.order = "YXZ";

  const narrow = window.matchMedia("(max-width: 800px)").matches;
  const cap = narrow ? 8000 : 18000;
  const dustCap = narrow ? 280 : 520;

  const starGeo = makeStarGeometry(cap, 0);
  const dustGeo = makeStarGeometry(dustCap, 90000);
  const starMat = makeStarMaterial(1);
  const dustMat = makeStarMaterial(2.15);
  starMat.uniforms.uBox.value = 86;
  dustMat.uniforms.uBox.value = 28;

  const stars = new THREE.Mesh(starGeo, starMat);
  const dust = new THREE.Mesh(dustGeo, dustMat);
  stars.frustumCulled = false;
  dust.frustumCulled = false;
  stars.renderOrder = 2;
  dust.renderOrder = 3;
  scene.add(stars);
  scene.add(dust);

  const nebula = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.ShaderMaterial({
      uniforms: {
        uColorA: { value: new THREE.Color("#6a4cf5") },
        uColorB: { value: new THREE.Color("#d44df0") },
      },
      vertexShader: NEBULA_VERT,
      fragmentShader: NEBULA_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
      side: THREE.DoubleSide,
    }),
  );
  nebula.scale.setScalar(96);
  nebula.position.set(28, 14, -210);
  nebula.renderOrder = 1;
  scene.add(nebula);

  const bodies = createBodies({
    scene,
    canvas,
    narrow,
    onInspect,
  });
  registerDeselect(() => bodies.deselect());

  const keys = new Set<string>();
  let probeKeys: Set<string> | null = null;
  let probeSteer: number | null = null;

  const pointer = {
    nx: 0,
    ny: 0,
    active: false,
    touching: false,
    id: -1,
    downX: 0,
    downY: 0,
  };

  let yaw = 0;
  let pitch = 0;
  let roll = 0;
  let yawVel = 0;
  let pitchVel = 0;
  let rollVel = 0;
  let boostMix = 0;
  let speed = 12;
  let fov = 72;
  let resScale = Math.min(window.devicePixelRatio || 1, narrow ? 1.15 : 1.35);
  const resCap = resScale;
  let starQuality = 1;
  let lastBoost = false;
  let fpsAccum = 0;
  let fpsFrames = 0;
  let smoothedFps = 0;
  let readoutAccum = 0;
  let audioAccum = 0;
  let running = true;
  let elapsed = 0;

  const camPos = new THREE.Vector3();
  const camPrev = new THREE.Vector3();
  const forward = new THREE.Vector3(0, 0, -1);
  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const viewNow = new THREE.Matrix4();
  const viewPrev = new THREE.Matrix4();
  const dummy = new THREE.Object3D();
  dummy.rotation.order = "YXZ";

  function held(code: string) {
    if (probeKeys) return probeKeys.has(code);
    return keys.has(code);
  }

  function captureView(target: THREE.Matrix4, y: number, p: number, r: number) {
    dummy.rotation.set(p, y, r);
    dummy.position.set(0, 0, 0);
    dummy.updateMatrix();
    target.copy(dummy.matrix).invert();
  }

  function resize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setPixelRatio(resScale);
    renderer.setSize(w, h, false);
    camera.aspect = Math.max(w, 1) / Math.max(h, 1);
    camera.updateProjectionMatrix();
    starMat.uniforms.uResolution.value.set(w * resScale, h * resScale);
    dustMat.uniforms.uResolution.value.set(w * resScale, h * resScale);
  }

  function placeNebula(distance: number) {
    nebula.position.copy(camPos).addScaledVector(forward, distance);
    nebula.position.addScaledVector(right, (Math.random() - 0.35) * 70);
    nebula.position.addScaledVector(up, (Math.random() - 0.45) * 36);
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (e.repeat) return;
    keys.add(e.code);
    if (
      e.code === "Space" ||
      e.code === "ArrowUp" ||
      e.code === "ArrowDown" ||
      e.code === "ArrowLeft" ||
      e.code === "ArrowRight"
    ) {
      e.preventDefault();
    }
  };
  const onKeyUp = (e: KeyboardEvent) => {
    keys.delete(e.code);
  };
  const clearKeys = () => keys.clear();
  const onVisibility = () => {
    if (document.hidden) {
      clearKeys();
      audio.suspend();
    } else if (getSim().engaged && getSim().sound) {
      audio.resume();
    }
  };

  const setFromEvent = (e: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const w = rect.width || 1;
    const h = rect.height || 1;
    pointer.nx = Math.max(-1, Math.min(1, ((e.clientX - rect.left) / w) * 2 - 1));
    pointer.ny = Math.max(-1, Math.min(1, ((e.clientY - rect.top) / h) * 2 - 1));
  };

  const onPointerMove = (e: PointerEvent) => {
    if (pointer.touching) {
      if (e.pointerId !== pointer.id) return;
      setFromEvent(e);
      pointer.active = true;
      return;
    }
    if (e.pointerType === "mouse") {
      setFromEvent(e);
      pointer.active = true;
      if (getSim().engaged) {
        bodies.hover(camera, pointer.nx, -pointer.ny);
      }
    }
  };
  const onPointerDown = (e: PointerEvent) => {
    pointer.downX = e.clientX;
    pointer.downY = e.clientY;
    if (e.pointerType === "mouse") {
      setFromEvent(e);
      pointer.active = true;
      return;
    }
    pointer.touching = true;
    pointer.id = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    setFromEvent(e);
    pointer.active = true;
  };
  const endTouch = (e: PointerEvent) => {
    if (!pointer.touching || e.pointerId !== pointer.id) return;
    pointer.touching = false;
    pointer.active = false;
    pointer.nx = 0;
    pointer.ny = 0;
  };
  const onPointerUp = (e: PointerEvent) => {
    const dx = e.clientX - pointer.downX;
    const dy = e.clientY - pointer.downY;
    if (getSim().engaged && dx * dx + dy * dy < 81) {
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / (rect.width || 1)) * 2 - 1;
      const y = -(((e.clientY - rect.top) / (rect.height || 1)) * 2 - 1);
      bodies.pick(camera, x, y);
    }
    endTouch(e);
  };
  const onLeave = () => {
    if (pointer.touching) return;
    pointer.active = false;
    pointer.nx = 0;
    pointer.ny = 0;
    bodies.clearHover();
  };

  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", clearKeys);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", endTouch);
  canvas.addEventListener("pointerleave", onLeave);

  const resizeObserver = new ResizeObserver(() => resize());
  resizeObserver.observe(canvas.parentElement ?? canvas);
  resize();

  const qa = import.meta.env.DEV || new URLSearchParams(location.search).has("qa");
  if (qa) {
    window.__controlsTest = {
      getYaw: () => yaw,
      getSpeed: () => speed,
      getPitch: () => pitch,
      setKeys: (codes) => {
        probeKeys = new Set(codes);
      },
      setSteer: (v) => {
        probeSteer = v;
      },
    };
  }

  let workMs = 0;
  let last = performance.now();

  function frame(now: number) {
    if (!running) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    elapsed += dt;
    const sim = getSim();

    if (sim.engaged) {
      if (held("KeyW")) sim.cruise = Math.min(1, sim.cruise + 0.42 * dt);
      if (held("KeyS")) sim.cruise = Math.max(0.08, sim.cruise - 0.42 * dt);
      const cruiseEl = hooks.cruiseInput;
      if (cruiseEl && document.activeElement !== cruiseEl) {
        const next = sim.cruise.toFixed(3);
        if (cruiseEl.value !== next) cruiseEl.value = next;
      }
    }

    const cruise = sim.engaged ? sim.cruise : sim.reduced ? 0.12 : 0.34;
    const base = 7 + cruise * 40;
    const wantBoost =
      sim.engaged &&
      (sim.boostLatched || held("Space") || held("ShiftLeft") || held("ShiftRight"));
    boostMix = damp(boostMix, wantBoost ? 1 : 0, wantBoost ? 5 : 2.4, dt);
    if (wantBoost !== lastBoost) {
      lastBoost = wantBoost;
      onBoostVisual(wantBoost);
      root.classList.toggle("is-boosting", wantBoost);
    }
    speed = base * (1 + boostMix * (sim.reduced ? 1.4 : 4.6));

    let keyYaw = 0;
    if (held("KeyA") || held("ArrowLeft")) keyYaw += 1;
    if (held("KeyD") || held("ArrowRight")) keyYaw -= 1;
    let keyPitch = 0;
    if (held("ArrowUp")) keyPitch -= 1;
    if (held("ArrowDown")) keyPitch += 1;

    const sens = 0.45 + sim.sensitivity * 1.15;
    const turn = (sim.reduced ? 0.55 : 1.05) * sens;
    const steerOverride = probeSteer;
    const sx = sim.engaged && steerOverride === null && pointer.active ? deadzone(pointer.nx) : 0;
    const sy = sim.engaged && pointer.active ? -deadzone(pointer.ny) : 0;
    const yawInput = sim.engaged ? (steerOverride !== null ? steerOverride : keyYaw - sx) : 0;
    const pitchInput = sim.engaged ? keyPitch + sy : 0;

    yawVel = yawInput * turn;
    pitchVel = pitchInput * turn * 0.82;
    yaw += yawVel * dt;
    pitch += pitchVel * dt;
    pitch = Math.max(-1.02, Math.min(1.02, pitch));

    const bankTarget = sim.engaged ? THREE.MathUtils.clamp(-yawVel * 0.38, -0.5, 0.5) : 0;
    const prevRoll = roll;
    roll = damp(roll, bankTarget, 5.5, dt);
    rollVel = dt > 0 ? (roll - prevRoll) / dt : 0;

    const shake = sim.reduced ? 0 : boostMix * 0.0035;
    const renderYaw = yaw + Math.sin(elapsed * 47) * shake;
    const renderPitch = pitch + Math.sin(elapsed * 53) * shake * 0.65;

    camera.rotation.set(pitch, yaw, roll);
    camera.position.copy(camPos);
    camera.updateMatrixWorld();
    forward.set(0, 0, -1).applyQuaternion(camera.quaternion);
    right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    camPos.addScaledVector(forward, speed * dt);

    const streakDist = Math.min(
      speed * (0.028 + sim.streak * 0.055) * (1 + boostMix * 1.35),
      7 + boostMix * 12,
    );
    const rotLag = 0.045 + boostMix * 0.04;
    camPrev.copy(camPos).addScaledVector(forward, -streakDist);
    captureView(viewNow, renderYaw, renderPitch, roll);
    captureView(
      viewPrev,
      renderYaw - yawVel * rotLag,
      renderPitch - pitchVel * rotLag,
      roll - rollVel * rotLag,
    );

    fov = damp(fov, 70 + boostMix * 16 + Math.min(speed / 80, 1) * 4, 4, dt);
    if (Math.abs(camera.fov - fov) > 0.05) {
      camera.fov = fov;
      camera.updateProjectionMatrix();
    }

    const visible = Math.max(
      400,
      Math.floor((900 + sim.density * (cap - 900)) * starQuality),
    );
    const dustVisible = Math.max(80, Math.floor(dustCap * (0.35 + sim.density * 0.65)));
    starGeo.instanceCount = visible;
    dustGeo.instanceCount = dustVisible;

    starMat.uniforms.uProjection.value.copy(camera.projectionMatrix);
    starMat.uniforms.uView.value.copy(viewNow);
    starMat.uniforms.uViewPrev.value.copy(viewPrev);
    starMat.uniforms.uCam.value.copy(camPos);
    starMat.uniforms.uCamPrev.value.copy(camPrev);
    starMat.uniforms.uBoost.value = boostMix;
    starMat.uniforms.uTime.value = elapsed;

    dustMat.uniforms.uProjection.value.copy(camera.projectionMatrix);
    dustMat.uniforms.uView.value.copy(viewNow);
    dustMat.uniforms.uViewPrev.value.copy(viewPrev);
    dustMat.uniforms.uCam.value.copy(camPos);
    dustMat.uniforms.uCamPrev.value.copy(camPrev);
    dustMat.uniforms.uBoost.value = boostMix;
    dustMat.uniforms.uTime.value = elapsed;

    camera.position.copy(camPos);
    camera.rotation.set(renderPitch, renderYaw, roll);
    camera.updateMatrixWorld();

    if (camPos.distanceTo(nebula.position) < 28 || camPos.distanceTo(nebula.position) > 460) {
      placeNebula(220 + Math.random() * 80);
    }
    nebula.lookAt(camPos);

    bodies.update(dt, elapsed, camPos, forward, right, up, sim.reduced);

    renderer.render(scene, camera);

    reticle.style.transform = `rotate(${-roll}rad)`;

    fpsAccum += dt;
    fpsFrames += 1;
    readoutAccum += dt;
    if (fpsAccum >= 0.25) {
      const instant = fpsFrames / fpsAccum;
      smoothedFps = smoothedFps === 0 ? instant : smoothedFps * 0.65 + instant * 0.35;
      fpsNode.textContent = `${Math.round(smoothedFps)} fps`;
      if (smoothedFps < 78 && starQuality > 0.34) {
        starQuality = Math.max(0.34, starQuality * 0.8);
      } else if (smoothedFps > 104 && starQuality < 1) {
        starQuality = Math.min(1, starQuality + 0.04);
      }
      if (smoothedFps < 72 && resScale > 0.75) {
        resScale = Math.max(0.75, resScale - 0.1);
        resize();
      } else if (smoothedFps > 100 && resScale < resCap - 0.02) {
        resScale = Math.min(resCap, resScale + 0.05);
        resize();
      }
      fpsAccum = 0;
      fpsFrames = 0;
    }
    if (readoutAccum >= 0.08) {
      velocityNode.textContent = String(Math.round(speed * 6));
      readoutAccum = 0;
    }

    if (sim.engaged) {
      audioAccum += dt;
      if (audioAccum >= 0.12) {
        audioAccum = 0;
        audio.update(Math.min(1, speed / 180), boostMix, sim.sound);
      }
    }

    const work = performance.now() - now;
    workMs = workMs === 0 ? work : workMs * 0.85 + work * 0.15;
    if (qa) (window as unknown as { __workMs?: number }).__workMs = workMs;

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return () => {
    running = false;
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", clearKeys);
    document.removeEventListener("visibilitychange", onVisibility);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", endTouch);
    canvas.removeEventListener("pointerleave", onLeave);
    resizeObserver.disconnect();
    starGeo.dispose();
    dustGeo.dispose();
    starMat.dispose();
    dustMat.dispose();
    nebula.geometry.dispose();
    (nebula.material as THREE.Material).dispose();
    bodies.dispose();
    renderer.dispose();
    if (qa) delete window.__controlsTest;
  };
}
