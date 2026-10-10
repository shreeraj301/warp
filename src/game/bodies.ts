import * as THREE from "three";

export type InspectBody = {
  id: string;
  kind: "Planet" | "Asteroid field";
  name: string;
  detail: string;
};

type BodySystem = {
  update: (
    dt: number,
    time: number,
    cam: THREE.Vector3,
    forward: THREE.Vector3,
    right: THREE.Vector3,
    up: THREE.Vector3,
    reduced: boolean,
  ) => void;
  hover: (camera: THREE.Camera, x: number, y: number) => void;
  pick: (camera: THREE.Camera, x: number, y: number) => void;
  clearHover: () => void;
  deselect: () => void;
  dispose: () => void;
};

const PLANET_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vLocal = position;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const PLANET_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec3 uLight;
uniform float uHover;
uniform float uCities;
uniform float uTime;
varying vec3 vNormalW;
varying vec3 vWorld;
varying vec3 vLocal;

void main() {
  vec3 n = normalize(vNormalW);
  vec3 eye = normalize(cameraPosition - vWorld);
  float ndl = clamp(dot(n, uLight), 0.0, 1.0);
  float shade = 0.22 + 0.78 * ndl;
  float bands = 0.5 + 0.5 * sin(vLocal.y * 16.0 + uTime * 0.12);
  float mottling = 0.5 + 0.5 * sin(vLocal.x * 9.0 + vLocal.z * 7.0);
  vec3 col = uColor * shade;
  col = mix(col, uAccent, bands * mottling * 0.28 * shade);
  float fres = pow(1.0 - clamp(dot(n, eye), 0.0, 1.0), 2.6);
  col += uAccent * fres * (0.35 + uHover * 0.85);
  float speckle = step(0.985, fract(sin(dot(vLocal.xz, vec2(127.1, 311.7))) * 43758.5));
  col += vec3(1.0) * speckle * uCities * shade;
  col *= 1.0 + uHover * 0.18;
  gl_FragColor = vec4(col, 1.0);
}
`;

const ATMO_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec4 world = modelMatrix * vec4(position, 1.0);
  vWorld = world.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const ATMO_FRAG = /* glsl */ `
uniform vec3 uAccent;
uniform float uHover;
varying vec3 vNormalW;
varying vec3 vWorld;
void main() {
  vec3 n = normalize(vNormalW);
  vec3 eye = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - clamp(dot(n, eye), 0.0, 1.0), 2.15);
  float a = fres * (0.55 + uHover * 0.45);
  gl_FragColor = vec4(uAccent * a, a);
}
`;

const ROCK_VERT = /* glsl */ `
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vec4 local = instanceMatrix * vec4(position, 1.0);
  vec4 world = modelMatrix * local;
  vLocal = local.xyz;
  vNormalW = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const ROCK_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uAccent;
uniform vec3 uLight;
uniform float uHover;
varying vec3 vNormalW;
varying vec3 vLocal;
void main() {
  vec3 n = normalize(vNormalW);
  float ndl = clamp(dot(n, uLight), 0.0, 1.0);
  float tone = fract(sin(dot(vLocal, vec3(12.9, 78.2, 45.1))) * 43758.5);
  vec3 col = mix(uColor * 0.45, uColor * 1.2, tone);
  col *= 0.2 + 0.8 * ndl;
  col = mix(col, uAccent, uHover * 0.45);
  gl_FragColor = vec4(col, 1.0);
}
`;

type PlanetSpec = {
  name: string;
  detail: string;
  color: string;
  accent: string;
  radius: number;
  spin: number;
  cities: number;
  ring: boolean;
  at: [number, number, number];
};

const PLANETS: PlanetSpec[] = [
  {
    name: "Vesper",
    detail: "Pale ice. The limb is the only color it keeps.",
    color: "#d5dbe3",
    accent: "#8ec8ff",
    radius: 13,
    spin: 0.07,
    cities: 0,
    ring: false,
    at: [34, 6, -96],
  },
  {
    name: "Halcyon",
    detail: "Charcoal giant. One thin ring, and bands that barely move.",
    color: "#5c5c60",
    accent: "#c8c8cc",
    radius: 18,
    spin: 0.04,
    cities: 0,
    ring: true,
    at: [-48, -12, -168],
  },
  {
    name: "Cinder",
    detail: "Warm ash and a dull crust. Nothing in orbit.",
    color: "#6e5b4e",
    accent: "#c4a27a",
    radius: 9,
    spin: 0.11,
    cities: 0,
    ring: false,
    at: [18, 22, -230],
  },
  {
    name: "Sable",
    detail: "Nightside. A few lights, then nothing else.",
    color: "#2a2a2e",
    accent: "#9ecbff",
    radius: 11,
    spin: 0.06,
    cities: 1,
    ring: false,
    at: [-22, 8, -280],
  },
  {
    name: "Lumen",
    detail: "The blue is a signal, not an ocean.",
    color: "#163044",
    accent: "#0099ff",
    radius: 8,
    spin: 0.13,
    cities: 0,
    ring: false,
    at: [55, -18, -210],
  },
];

type FieldSpec = {
  name: string;
  detail: string;
  at: [number, number, number];
  spread: number;
  count: number;
};

const FIELDS: FieldSpec[] = [
  {
    name: "Quiet Shoal",
    detail: "Loose rock with no parent. Any stone answers a click.",
    at: [20, -14, -118],
    spread: 22,
    count: 110,
  },
  {
    name: "Ashmere Drift",
    detail: "Wider than it looks. The brighter stones are iron.",
    at: [52, 14, -200],
    spread: 30,
    count: 84,
  },
  {
    name: "Kite Debris",
    detail: "What was left of something that missed the lane.",
    at: [-30, -6, -130],
    spread: 16,
    count: 56,
  },
];

function hash01(n: number) {
  let x = Math.imul(n >>> 0, 747796405) + 2891336453;
  x >>>= 0;
  let word = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737);
  word >>>= 0;
  return (((word >>> 22) ^ word) >>> 0) / 4294967296;
}

function rockGeometry() {
  const geo = new THREE.IcosahedronGeometry(1, 1);
  const attr = geo.getAttribute("position");
  const v = new THREE.Vector3();
  for (let i = 0; i < attr.count; i++) {
    v.fromBufferAttribute(attr as THREE.BufferAttribute, i);
    const s = 0.7 + hash01(i + 3) * 0.55;
    v.x *= 0.82 + hash01(i + 11) * 0.46;
    v.y *= 0.74 + hash01(i + 19) * 0.5;
    v.z *= 0.82 + hash01(i + 29) * 0.42;
    v.normalize().multiplyScalar(s);
    (attr as THREE.BufferAttribute).setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  return geo;
}

const light = new THREE.Vector3(0.32, 0.86, 0.28).normalize();

export function createBodies(opts: {
  scene: THREE.Scene;
  canvas: HTMLCanvasElement;
  narrow: boolean;
  onInspect: (body: InspectBody | null) => void;
}): BodySystem {
  const { scene, canvas, narrow, onInspect } = opts;
  const planetCount = narrow ? 4 : PLANETS.length;
  const fieldCount = narrow ? 2 : FIELDS.length;
  const sphere = new THREE.SphereGeometry(1, narrow ? 28 : 40, narrow ? 20 : 28);
  const rockGeo = rockGeometry();
  const proxyGeo = new THREE.SphereGeometry(1, 10, 8);
  const proxyMat = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
    colorWrite: false,
    side: THREE.DoubleSide,
  });
  const disposables: Array<THREE.BufferGeometry | THREE.Material> = [sphere, rockGeo, proxyGeo, proxyMat];

  const raycaster = new THREE.Raycaster();
  raycaster.far = 520;
  raycaster.layers.enable(1);
  const ndc = new THREE.Vector2();
  const dummy = new THREE.Object3D();

  type Planet = {
    id: string;
    info: InspectBody;
    group: THREE.Group;
    spin: number;
    radius: number;
    hover: { value: number };
  };
  type Rock = {
    ox: number;
    oy: number;
    oz: number;
    sx: number;
    sy: number;
    sz: number;
    rx: number;
    ry: number;
    rz: number;
    rate: number;
  };
  type Field = {
    id: string;
    info: InspectBody;
    mesh: THREE.InstancedMesh;
    rocks: Rock[];
    spread: number;
    hover: { value: number };
  };

  const planets: Planet[] = [];
  const fields: Field[] = [];
  const targets: THREE.Object3D[] = [];
  let hoverId: string | null = null;
  let selected: string | null = null;

  function makePlanetMaterial(spec: PlanetSpec, hover: { value: number }) {
    const time = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(spec.color) },
        uAccent: { value: new THREE.Color(spec.accent) },
        uLight: { value: light },
        uHover: hover,
        uCities: { value: spec.cities },
        uTime: time,
      },
      vertexShader: PLANET_VERT,
      fragmentShader: PLANET_FRAG,
      toneMapped: false,
    });
    disposables.push(mat);
    return { mat, time };
  }

  const sharedTimes: Array<{ value: number }> = [];

  for (let i = 0; i < planetCount; i++) {
    const spec = PLANETS[i];
    const hover = { value: 0 };
    const { mat, time } = makePlanetMaterial(spec, hover);
    sharedTimes.push(time);
    const group = new THREE.Group();
    const mesh = new THREE.Mesh(sphere, mat);
    mesh.scale.setScalar(spec.radius);
    mesh.renderOrder = 4;
    group.add(mesh);

    const atmo = new THREE.Mesh(
      sphere,
      new THREE.ShaderMaterial({
        uniforms: {
          uAccent: { value: new THREE.Color(spec.accent) },
          uHover: hover,
        },
        vertexShader: ATMO_VERT,
        fragmentShader: ATMO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
        side: THREE.FrontSide,
      }),
    );
    atmo.scale.setScalar(spec.radius * 1.08);
    atmo.raycast = () => {};
    atmo.renderOrder = 5;
    group.add(atmo);
    disposables.push(atmo.material);

    if (spec.ring) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(1.62, 0.02, 6, 72),
        new THREE.MeshBasicMaterial({
          color: 0xcfcfd2,
          transparent: true,
          opacity: 0.72,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        }),
      );
      ring.rotation.x = 1.15;
      ring.scale.setScalar(spec.radius);
      ring.renderOrder = 5;
      group.add(ring);
      disposables.push(ring.geometry, ring.material);
    }

    const info: InspectBody = {
      id: `planet-${spec.name}`,
      kind: "Planet",
      name: spec.name,
      detail: spec.detail,
    };
    group.userData.body = info;
    group.position.set(spec.at[0], spec.at[1], spec.at[2]);
    group.renderOrder = 4;
    scene.add(group);
    targets.push(group);
    planets.push({ id: info.id, info, group, spin: spec.spin, radius: spec.radius, hover });
  }

  for (let i = 0; i < fieldCount; i++) {
    const spec = FIELDS[i];
    const count = narrow ? Math.round(spec.count * 0.55) : spec.count;
    const hover = { value: 0 };
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color("#8a8682") },
        uAccent: { value: new THREE.Color("#0099ff") },
        uLight: { value: light },
        uHover: hover,
      },
      vertexShader: ROCK_VERT,
      fragmentShader: ROCK_FRAG,
      toneMapped: false,
    });
    disposables.push(mat);
    const mesh = new THREE.InstancedMesh(rockGeo, mat, count);
    mesh.frustumCulled = false;
    mesh.renderOrder = 4;
    const rocks: Rock[] = [];
    for (let r = 0; r < count; r++) {
      const id = i * 1000 + r + 1;
      const ang = hash01(id) * Math.PI * 2;
      const rad = 3.5 + hash01(id + 5) * spec.spread;
      const rock: Rock = {
        ox: Math.cos(ang) * rad,
        oz: Math.sin(ang) * rad * 0.82,
        oy: (hash01(id + 9) - 0.5) * spec.spread * 0.38,
        sx: 0.8 + hash01(id + 13) * 1.8,
        sy: 0.65 + hash01(id + 17) * 1.5,
        sz: 0.75 + hash01(id + 21) * 1.7,
        rx: hash01(id + 2) * Math.PI,
        ry: hash01(id + 4) * Math.PI,
        rz: hash01(id + 6) * Math.PI,
        rate: 0.15 + hash01(id + 8) * 0.55,
      };
      rocks.push(rock);
      dummy.position.set(rock.ox, rock.oy, rock.oz);
      dummy.rotation.set(rock.rx, rock.ry, rock.rz);
      dummy.scale.set(rock.sx, rock.sy, rock.sz);
      dummy.updateMatrix();
      mesh.setMatrixAt(r, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.position.set(spec.at[0], spec.at[1], spec.at[2]);
    const info: InspectBody = {
      id: `field-${spec.name}`,
      kind: "Asteroid field",
      name: spec.name,
      detail: spec.detail,
    };
    mesh.userData.body = info;
    const proxy = new THREE.Mesh(proxyGeo, proxyMat);
    proxy.userData.proxy = true;
    proxy.layers.set(1);
    proxy.scale.setScalar(spec.spread * 0.92);
    mesh.add(proxy);
    scene.add(mesh);
    targets.push(mesh);
    fields.push({ id: info.id, info, mesh, rocks, spread: spec.spread, hover });
  }

  function centers() {
    const list: THREE.Vector3[] = [];
    for (const planet of planets) list.push(planet.group.position);
    for (const field of fields) list.push(field.mesh.position);
    return list;
  }

  function park(pos: THREE.Vector3, minAhead: number, maxAhead: number, spread: number) {
    const others = centers();
    for (let attempt = 0; attempt < 6; attempt++) {
      const dist = minAhead + Math.random() * (maxAhead - minAhead);
      const side = (Math.random() - 0.5) * spread;
      const lift = (Math.random() - 0.45) * spread * 0.6;
      pos.copy(camHold);
      pos.addScaledVector(forwardHold, dist);
      pos.addScaledVector(rightHold, side);
      pos.addScaledVector(upHold, lift);
      let clear = true;
      for (const other of others) {
        if (other === pos) continue;
        if (other.distanceTo(pos) < 46) clear = false;
      }
      if (clear) return;
    }
  }

  const forwardHold = new THREE.Vector3(0, 0, -1);
  const rightHold = new THREE.Vector3(1, 0, 0);
  const upHold = new THREE.Vector3(0, 1, 0);
  const camHold = new THREE.Vector3();

  function recycle(pos: THREE.Vector3, minAhead: number, maxAhead: number, spread: number) {
    const relx = pos.x - camHold.x;
    const rely = pos.y - camHold.y;
    const relz = pos.z - camHold.z;
    const along = relx * forwardHold.x + rely * forwardHold.y + relz * forwardHold.z;
    const dist2 = relx * relx + rely * rely + relz * relz;
    if (along > -40 && dist2 < 460 * 460) return false;
    park(pos, minAhead, maxAhead, spread);
    return true;
  }

  function readHit(object: THREE.Object3D): InspectBody | null {
    let cur: THREE.Object3D | null = object;
    while (cur) {
      const body = cur.userData.body as InspectBody | undefined;
      if (body) return body;
      cur = cur.parent;
    }
    return null;
  }

  function query(camera: THREE.Camera, x: number, y: number) {
    ndc.set(x, y);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(targets, true);
    let field: InspectBody | null = null;
    for (const hit of hits) {
      if (hit.distance > 480) continue;
      const body = readHit(hit.object);
      if (!body) continue;
      if (hit.object.userData.proxy) {
        if (!field) field = body;
        continue;
      }
      return body;
    }
    return field;
  }

  return {
    update(dt, time, cam, forward, right, up, reduced) {
      camHold.copy(cam);
      forwardHold.copy(forward);
      rightHold.copy(right);
      upHold.copy(up);
      for (const clock of sharedTimes) clock.value = time;
      for (const planet of planets) {
        if (!reduced) planet.group.rotation.y += planet.spin * dt;
        const on = planet.id === hoverId || planet.id === selected ? 1 : 0;
        planet.hover.value = THREE.MathUtils.damp(planet.hover.value, on, 8, dt);
        if (recycle(planet.group.position, 150, 340, 150) && planet.id === selected) {
          selected = null;
          onInspect(null);
        }
      }
      for (const field of fields) {
        const on = field.id === hoverId || field.id === selected ? 1 : 0;
        field.hover.value = THREE.MathUtils.damp(field.hover.value, on, 8, dt);
        if (!reduced) field.mesh.rotation.y += dt * 0.04;
        if (recycle(field.mesh.position, 90, 260, 120) && field.id === selected) {
          selected = null;
          onInspect(null);
        }
      }
    },
    hover(camera, x, y) {
      const hit = query(camera, x, y);
      hoverId = hit?.id ?? null;
      canvas.style.cursor = hoverId ? "pointer" : "";
    },
    pick(camera, x, y) {
      const hit = query(camera, x, y);
      if (!hit || hit.id === selected) {
        selected = null;
        hoverId = null;
        canvas.style.cursor = "";
        onInspect(null);
        return;
      }
      selected = hit.id;
      onInspect(hit);
    },
    clearHover() {
      hoverId = null;
      canvas.style.cursor = "";
    },
    deselect() {
      selected = null;
    },
    dispose() {
      for (const planet of planets) scene.remove(planet.group);
      for (const field of fields) {
        scene.remove(field.mesh);
        field.mesh.dispose();
      }
      for (const item of disposables) item.dispose();
      canvas.style.cursor = "";
    },
  };
}
