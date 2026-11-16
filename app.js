// 築匠海洋館 3D 瀏覽：主程式
// 座標：three 的 x＝東、y＝上、z＝南；Blender 模型座標 (x, y, z) 對應 three (x, z, -y)
import * as THREE from 'three';
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from './vendor/three-mesh-bvh.module.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { Water } from 'three/addons/objects/Water.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;      // 碰撞偵測加速
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
const EYE = 1.7, QUAY = 2.0;
const B = (x, y, z = 0) => new THREE.Vector3(x, z, -y);
const $ = (id) => document.getElementById(id);
const veil = $('veil');

// ───────── 基本設定 ─────────
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const MAXA = renderer.capabilities.getMaxAnisotropy();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.3, 9000);

const rt = new THREE.WebGLRenderTarget(innerWidth, innerHeight, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.15, 0.7, 1.5);
composer.addPass(bloom);
composer.addPass(new OutputPass());

const sun = new THREE.DirectionalLight(0xffffff, 5);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -270, right: 270, top: 270, bottom: -270, near: 50, far: 1400 });
sun.shadow.camera.updateProjectionMatrix();
sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.35;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbcd8ff, 0x8f8576, 0.0);
scene.add(hemi);

// ───────── 程序貼圖 ─────────
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = MAXA;
  return t;
}
function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// 屋面板：一格＝一片板，四周有接縫與輕微積塵
function shellTextures() {
  const N = 512, R = rng(11);
  const map = canvasTex(N, N, (g) => {
    g.fillStyle = '#eeece6'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 260; i++) {                       // 細微色差
      const a = 0.012 + R() * 0.02; g.fillStyle = R() < 0.5 ? `rgba(255,255,255,${a})` : `rgba(120,112,98,${a})`;
      const s = 20 + R() * 120; g.fillRect(R() * N - s / 2, R() * N - s / 2, s, s * (0.3 + R()));
    }
    const gr = (x0, y0, x1, y1) => { const q = g.createLinearGradient(x0, y0, x1, y1); q.addColorStop(0, 'rgba(96,92,84,.34)'); q.addColorStop(1, 'rgba(96,92,84,0)'); return q; };
    const d = 34;                                          // 接縫旁的積塵
    g.fillStyle = gr(0, 0, d, 0); g.fillRect(0, 0, d, N);
    g.fillStyle = gr(N, 0, N - d, 0); g.fillRect(N - d, 0, d, N);
    g.fillStyle = gr(0, 0, 0, d); g.fillRect(0, 0, N, d);
    g.fillStyle = gr(0, N, 0, N - d); g.fillRect(0, N - d, N, d);
    g.fillStyle = '#5b5a57'; const s = 5;                  // 接縫
    g.fillRect(0, 0, N, s); g.fillRect(0, N - s, N, s); g.fillRect(0, 0, s, N); g.fillRect(N - s, 0, s, N);
  });
  const nrm = canvasTex(N, N, (g) => {
    g.fillStyle = 'rgb(128,128,255)'; g.fillRect(0, 0, N, N);
    const b = 12;                                          // 接縫倒角
    g.fillStyle = 'rgb(60,128,235)'; g.fillRect(N - b, 0, b, N);
    g.fillStyle = 'rgb(196,128,235)'; g.fillRect(0, 0, b, N);
    g.fillStyle = 'rgb(128,60,235)'; g.fillRect(0, 0, N, b);
    g.fillStyle = 'rgb(128,196,235)'; g.fillRect(0, N - b, N, b);
  }, { srgb: false });
  const rough = canvasTex(N, N, (g) => {
    g.fillStyle = 'rgb(0,118,0)'; g.fillRect(0, 0, N, N);
    for (let i = 0; i < 200; i++) { g.fillStyle = `rgba(0,${90 + R() * 80 | 0},0,.12)`; const s = 30 + R() * 100; g.fillRect(R() * N - s / 2, R() * N - s / 2, s, s); }
    g.fillStyle = 'rgb(0,215,0)'; g.fillRect(0, 0, N, 8); g.fillRect(0, N - 8, N, 8); g.fillRect(0, 0, 8, N); g.fillRect(N - 8, 0, 8, N);
  }, { srgb: false });
  return { map, nrm, rough };
}

// 玻璃帷幕：一格＝一個分割（直料＋橫料）
function glazingTextures() {
  const W = 256, H = 512;
  const map = canvasTex(W, H, (g) => {
    const q = g.createLinearGradient(0, 0, 0, H); q.addColorStop(0, '#2c4857'); q.addColorStop(1, '#16303c');
    g.fillStyle = q; g.fillRect(0, 0, W, H);
    g.fillStyle = '#d9d8d2'; g.fillRect(0, 0, 9, H); g.fillRect(W - 9, 0, 9, H); g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
  });
  const rm = canvasTex(W, H, (g) => {                      // G＝粗糙、B＝金屬
    g.fillStyle = 'rgb(0,14,150)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgb(0,130,40)'; g.fillRect(0, 0, 9, H); g.fillRect(W - 9, 0, 9, H); g.fillRect(0, 0, W, 10); g.fillRect(0, H - 10, W, 10);
  }, { srgb: false });
  const R = rng(5);
  const emi = canvasTex(W * 4, H, (g, w, h) => {           // 夜間室內透光（四格一循環，亮度略不同）
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4; i++) {
      const v = 0.55 + R() * 0.45; g.fillStyle = `rgb(${255 * v | 0},${205 * v | 0},${140 * v | 0})`;
      g.fillRect(i * W + 9, 10, W - 18, h - 20);
    }
  });
  const alpha = canvasTex(W, H, (g) => {                   // 帷幕用：玻璃半透明、框料不透明
    g.clearRect(0, 0, W, H); g.fillStyle = 'rgba(120,165,180,0.30)'; g.fillRect(0, 0, W, H);
    g.fillStyle = 'rgba(232,231,226,1)'; g.fillRect(0, 0, 8, H); g.fillRect(W - 8, 0, 8, H); g.fillRect(0, 0, W, 9); g.fillRect(0, H - 9, W, 9);
  });
  return { map, rm, emi, alpha };
}

// 城市立面：8 開間 × 8 層一循環
function facadeTextures(seed, wall, win) {
  const N = 512, C = 64, R = rng(seed);
  const cells = [];
  for (let i = 0; i < 64; i++) cells.push({ lit: R() < 0.34, v: 0.5 + R() * 0.5, warm: R() });
  const each = (g, f) => { for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) f(g, c * C, r * C, cells[r * 8 + c]); };
  const map = canvasTex(N, N, (g) => { g.fillStyle = wall; g.fillRect(0, 0, N, N); each(g, (g, x, y) => { g.fillStyle = win; g.fillRect(x + 7, y + 12, C - 14, C - 26); }); g.fillStyle = 'rgba(0,0,0,.07)'; for (let r = 0; r < 8; r++) g.fillRect(0, r * C, N, 3); });
  const rm = canvasTex(N, N, (g) => { g.fillStyle = 'rgb(0,205,0)'; g.fillRect(0, 0, N, N); each(g, (g, x, y) => { g.fillStyle = 'rgb(0,28,170)'; g.fillRect(x + 7, y + 12, C - 14, C - 26); }); }, { srgb: false });
  const emi = canvasTex(N, N, (g) => { g.fillStyle = '#000'; g.fillRect(0, 0, N, N); each(g, (g, x, y, k) => { if (!k.lit) return; const v = k.v; g.fillStyle = k.warm < 0.7 ? `rgb(${255 * v | 0},${214 * v | 0},${150 * v | 0})` : `rgb(${220 * v | 0},${235 * v | 0},${255 * v | 0})`; g.fillRect(x + 7, y + 12, C - 14, C - 26); }); });
  return { map, rm, emi };
}

function glowTexture() {
  return canvasTex(128, 128, (g) => {
    const q = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    q.addColorStop(0, 'rgba(255,236,200,1)'); q.addColorStop(0.25, 'rgba(255,214,150,.45)'); q.addColorStop(1, 'rgba(255,200,120,0)');
    g.fillStyle = q; g.fillRect(0, 0, 128, 128);
  }, { repeat: false });
}

// 大廳地坪：磨石子＋流動的波紋色帶（一張貼圖鋪 40 公尺）
function terrazzoTexture() {
  const N = 1024, R = rng(8);
  const t = canvasTex(N, N, (g) => {
    g.fillStyle = '#dcdad4'; g.fillRect(0, 0, N, N);
    const band = (y0, amp, w, col) => { g.beginPath(); for (let x = 0; x <= N; x += 8) g.lineTo(x, y0 + Math.sin(x / N * Math.PI * 2 * 2) * amp + Math.sin(x / N * Math.PI * 2 * 3 + 1) * amp * 0.4); for (let x = N; x >= 0; x -= 8) g.lineTo(x, y0 + w + Math.sin(x / N * Math.PI * 2 * 2 + 0.6) * amp + Math.sin(x / N * Math.PI * 2 * 3 + 1.7) * amp * 0.4); g.closePath(); g.fillStyle = col; g.fill(); };
    for (const off of [0, N]) { band(120 - off, 46, 90, '#a9b8c1'); band(300 - off, 60, 50, '#c3ccd1'); band(520 - off, 50, 120, '#98abb8'); band(760 - off, 64, 70, '#b9c4ca'); band(930 - off, 40, 60, '#a3b3bd'); band(120 + N - off, 46, 90, '#a9b8c1'); }
    for (let i = 0; i < 9000; i++) { const v = R(); g.fillStyle = v < 0.5 ? 'rgba(255,255,255,.55)' : (v < 0.8 ? 'rgba(90,96,102,.5)' : 'rgba(170,150,120,.5)'); g.fillRect(R() * N, R() * N, 1 + R() * 2.2, 1 + R() * 2.2); }
  });
  return t;
}

// ───────── 材質 ─────────
const st = shellTextures(), gt = glazingTextures();
const GLOW = [];        // 夜間要發光的材質：{ m, color, k }
const glowReg = (m, color, k) => { m.emissive = new THREE.Color(color); m.emissiveIntensity = 0; GLOW.push({ m, k }); return m; };

const M = {
  shell: new THREE.MeshStandardMaterial({ color: 0xffffff, map: st.map, normalMap: st.nrm, normalScale: new THREE.Vector2(0.9, 0.9), roughnessMap: st.rough, roughness: 1, metalness: 0.0 }),
  band: new THREE.MeshStandardMaterial({ color: 0xe9e7e1, roughness: 0.62 }),
  glass: new THREE.MeshStandardMaterial({ map: gt.alpha, transparent: true, depthWrite: false, roughness: 0.04, metalness: 0.6, envMapIntensity: 1.9, side: THREE.DoubleSide }),
  curtain: glowReg(new THREE.MeshStandardMaterial({ map: gt.alpha, transparent: true, depthWrite: false, roughness: 0.05, metalness: 0.45, envMapIntensity: 1.7, side: THREE.DoubleSide, emissiveMap: gt.emi }), 0xffffff, 0.2),
  core: glowReg(new THREE.MeshStandardMaterial({ color: 0xe9e2d2, roughness: 0.8 }), 0xffcf8f, 1.15),
  lobby: new THREE.MeshStandardMaterial({ map: terrazzoTexture(), roughness: 0.22, metalness: 0.0, envMapIntensity: 1.2 }),
  quay: new THREE.MeshStandardMaterial({ color: 0xb9b6ae, roughness: 0.85 }),
  road: new THREE.MeshStandardMaterial({ color: 0x55565a, roughness: 0.95 }),
  logo: glowReg(new THREE.MeshStandardMaterial({ color: 0x00A1E9, roughness: 0.28, metalness: 0.55 }), 0x00A1E9, 1.3),
  logoBase: new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.05, metalness: 0.0, envMapIntensity: 1.4 }),
  logoWall: new THREE.MeshStandardMaterial({ color: 0xe6e4de, roughness: 0.55 }),
  dome: glowReg(new THREE.MeshPhysicalMaterial({ color: 0x1a2c36, roughness: 0.04, metalness: 0.25, transparent: true, opacity: 0.62, envMapIntensity: 2.0, clearcoat: 1 }), 0xffc680, 1.5),
  collar: new THREE.MeshStandardMaterial({ color: 0xdcdad4, roughness: 0.45, metalness: 0.3 }),
  lampPole: new THREE.MeshStandardMaterial({ color: 0x3a3d40, roughness: 0.5, metalness: 0.6 }),
  lampHead: glowReg(new THREE.MeshStandardMaterial({ color: 0xf2efe6, roughness: 0.4 }), 0xffd9a0, 6),
};
{                                                         // 地面實拍材質（Poly Haven，CC0）
  const tl = new THREE.TextureLoader();
  const ld = (file, srgb) => { const t = tl.load(`./assets/tex/${file}`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = MAXA; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  Object.assign(M.quay, { color: new THREE.Color(0xffffff), map: ld('quay_diff.jpg', true), normalMap: ld('quay_nor_gl.jpg'), roughnessMap: ld('quay_rough.jpg'), roughness: 1 });
  Object.assign(M.road, { color: new THREE.Color(0xffffff), map: ld('asphalt_diff.jpg', true), normalMap: ld('asphalt_nor_gl.jpg'), roughnessMap: ld('asphalt_rough.jpg'), roughness: 1 });
}
gt.map.repeat.set(1 / 1.5, 1 / 4.5); gt.rm.repeat.copy(gt.map.repeat); gt.emi.repeat.set(1 / 6, 1 / 4.5); gt.alpha.repeat.set(1 / 1.6, 1 / 3.2);

// ───────── 海面 ─────────
function waterNormals(n = 256) {
  const data = new Uint8Array(n * n * 4);
  const waves = [[3, 1, .9, 0], [1, 4, .7, 1.3], [5, -3, .45, 2.1], [-2, 7, .35, .7], [9, 4, .22, 4.2], [-6, -11, .18, 5.5], [13, 2, .12, 1.1], [3, -17, .1, 3.3]];
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    let dx = 0, dy = 0;
    for (const [fx, fy, a, ph] of waves) { const c = Math.cos(2 * Math.PI * (fx * x + fy * y) / n + ph) * a; dx += c * fx; dy += c * fy; }
    const v = new THREE.Vector3(-dx * 0.09, -dy * 0.09, 1).normalize(), i = (y * n + x) * 4;
    data[i] = (v.x * .5 + .5) * 255; data[i + 1] = (v.y * .5 + .5) * 255; data[i + 2] = (v.z * .5 + .5) * 255; data[i + 3] = 255;
  }
  const t = new THREE.DataTexture(data, n, n); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; return t;
}
const water = new Water(new THREE.PlaneGeometry(9000, 9000), {
  textureWidth: 1024, textureHeight: 1024, waterNormals: waterNormals(),
  sunDirection: new THREE.Vector3(0, 1, 0), sunColor: 0xffffff, waterColor: 0x1f6f8c, distortionScale: 2.4, fog: false,
});
water.material.fragmentShader = water.material.fragmentShader.replace('float rf0 = 0.3;', 'float rf0 = 0.06;');
water.rotation.x = -Math.PI / 2; water.material.uniforms.size.value = 0.07;
scene.add(water);

// ───────── 時段 ─────────
const TIMES = {
  day: { az: [-0.62, 0.52], minEl: 30, exposure: 0.5, sun: 11, sunColor: 0xffebcf, env: 0.62, hemi: 0.0, glow: 0, water: 0x0f5f86, bloom: [0.1, 1.7], bg: 1.0 },
  dusk: { az: [-0.95, -0.15], minEl: 7, exposure: 0.75, sun: 2.6, sunColor: 0xffb27a, env: 0.42, hemi: 0.0, glow: 0.7, water: 0x1a4560, bloom: [0.3, 1.1], bg: 1.0 },
  night: { az: [0.5, 0.6], minEl: 38, exposure: 0.8, sun: 0.35, sunColor: 0x9fb6ff, env: 0.11, hemi: 0.05, glow: 1.0, water: 0x04101a, bloom: [0.35, 1.15], bg: 1.0 },
};
const skyData = {};       // 每個時段：{ env, bg, dir }
let skyInfo = null, curTime = 'day', glowLevel = 0;
const pmrem = new THREE.PMREMGenerator(renderer);
const fallbackSky = new Sky(); fallbackSky.scale.setScalar(8000);

function hdrDirToVec(info) {           // 讀 sky_info.json 內的方向（容許幾種欄位名稱）
  const d = info && (info.dir || info.sun_dir || info.direction || info.sun_direction);
  return Array.isArray(d) ? new THREE.Vector3(d[0], d[1], d[2]).normalize() : null;
}
async function loadSky(name) {
  if (skyData[name]) return skyData[name];
  const info = skyInfo && (skyInfo[name] || (skyInfo.skies && skyInfo.skies[name]));
  try {
    const hdr = await new RGBELoader().setDataType(THREE.FloatType).loadAsync(`./assets/sky/sky_${name}_1k.hdr`);
    const a = hdr.image.data;                              // 把太陽本體的極高亮度壓掉，日光改由方向光提供（才有陰影）
    const cap = name === 'day' ? 6 : 12;
    for (let i = 0; i < a.length; i++) if (a[i] > cap) a[i] = cap;
    hdr.mapping = THREE.EquirectangularReflectionMapping; hdr.needsUpdate = true;
    const env = pmrem.fromEquirectangular(hdr).texture; hdr.dispose();
    const bg = await new THREE.TextureLoader().loadAsync(`./assets/sky/sky_${name}_bg.jpg`);
    bg.mapping = THREE.EquirectangularReflectionMapping; bg.colorSpace = THREE.SRGBColorSpace;
    return (skyData[name] = { env, bg, dir: hdrDirToVec(info) });
  } catch (e) {
    console.warn('天空全景載入失敗，改用內建天空：', name, e);
    return (skyData[name] = { fallback: true });
  }
}
const tmpDir = new THREE.Vector3();
function applyTime(name) {
  const T = TIMES[name], S = skyData[name]; curTime = name;
  const want = new THREE.Vector2(T.az[0], T.az[1]).normalize();
  let el = T.minEl;
  if (S && !S.fallback) {
    let yaw = 0;
    if (S.dir) {
      const h = new THREE.Vector2(S.dir.x, S.dir.z);
      if (h.length() > 1e-3) yaw = Math.atan2(h.y, h.x) - Math.atan2(want.y, want.x);   // 繞 y 轉到想要的方位
      el = Math.max(T.minEl, THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(S.dir.y, -1, 1))));
      if (name === 'night') el = T.minEl;
    }
    scene.background = S.bg; scene.environment = S.env;
    scene.backgroundRotation.set(0, yaw, 0); scene.environmentRotation.set(0, yaw, 0);
    scene.remove(fallbackSky);
  } else {
    scene.background = null; scene.add(fallbackSky);
    const u = fallbackSky.material.uniforms;
    u.turbidity.value = name === 'day' ? 2.2 : 6; u.rayleigh.value = name === 'night' ? 0.2 : (name === 'dusk' ? 3 : 2); u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    const e2 = name === 'dusk' ? 3 : (name === 'night' ? -8 : el);
    tmpDir.set(want.x * Math.cos(e2 * Math.PI / 180), Math.sin(e2 * Math.PI / 180), want.y * Math.cos(e2 * Math.PI / 180));
    u.sunPosition.value.copy(tmpDir);
    const es = new THREE.Scene(); es.add(fallbackSky.clone());
    scene.environment = pmrem.fromScene(es, 0, 1, 9000).texture;
  }
  const er = el * Math.PI / 180;
  tmpDir.set(want.x * Math.cos(er), Math.sin(er), want.y * Math.cos(er)).normalize();
  sun.position.copy(tmpDir).multiplyScalar(650); sun.color.set(T.sunColor); sun.intensity = T.sun;
  hemi.intensity = T.hemi;
  scene.environmentIntensity = (S && S.fallback) ? (name === 'day' ? 0.09 : 0.25) : T.env;
  scene.backgroundIntensity = T.bg;
  if (S && S.fallback && name === 'day') hemi.intensity = 1.0;
  renderer.toneMappingExposure = (S && S.fallback && name === 'day') ? 0.42 : T.exposure;
  water.material.uniforms.sunDirection.value.copy(tmpDir);
  water.material.uniforms.sunColor.value.set(T.sunColor).multiplyScalar(name === 'night' ? 0.15 : 1);
  water.material.uniforms.waterColor.value.set(T.water);
  bloom.strength = T.bloom[0]; bloom.threshold = T.bloom[1];
  glowLevel = T.glow;
  for (const g of GLOW) g.m.emissiveIntensity = (g.m.userData.base || 0) + g.k * glowLevel;
  for (const f of timeHooks) f(name, T);
  document.querySelectorAll('[data-time]').forEach((b) => b.classList.toggle('on', b.dataset.time === name));
}
const timeHooks = [];
async function setTime(name) {
  const fade = $('fade'); fade.style.opacity = 1;
  await Promise.all([loadSky(name), new Promise((r) => setTimeout(r, 360))]);
  applyTime(name); fade.style.opacity = 0;
}
document.querySelectorAll('[data-time]').forEach((b) => b.onclick = () => { b.blur(); setTime(b.dataset.time); });

// ───────── 主模型 ─────────
const walkables = [], solids = [], colliders = solids, solidSet = new Set();
function addSolid(o) {                                     // 登記成不能穿過的實體，並建立碰撞加速結構
  if (solidSet.has(o)) return; solidSet.add(o);
  if (!o.geometry.boundsTree) {
    if (o.geometry.index) o.geometry.setIndex(o.geometry.index.clone());   // 模型檔裡形狀相同的構件共用同一份索引；加速結構會就地重排索引，不先複製會把別的構件的加速結構弄壞
    o.geometry.computeBoundsTree();
  }
  solids.push(o);
}
function planarUV(geo, s) {                               // 地面類：依世界座標平鋪
  const p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / s; uv[i * 2 + 1] = p.getZ(i) / s; }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
function wallUV(geo) {                                    // 直立面：沿水平方向與高度（公尺）
  const p = geo.attributes.position, n = geo.attributes.normal, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), az = Math.abs(n.getZ(i));
    uv[i * 2] = ax > az ? p.getZ(i) : p.getX(i); uv[i * 2 + 1] = p.getY(i);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
}
const cityMats = [];
function buildCity(src, group) {
  const variants = [['#d8d5cd', '#27343d'], ['#c3c7ca', '#1f2c36'], ['#ddd3c2', '#2c3338'], ['#b9c2c6', '#22313a']];
  if (!cityMats.length) variants.forEach(([w, g], i) => {
    const t = facadeTextures(21 + i * 7, w, g);
    const side = glowReg(new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rm, metalnessMap: t.rm, roughness: 1, metalness: 1, emissiveMap: t.emi }), 0xffffff, 1.0);
    cityMats.push([side, new THREE.MeshStandardMaterial({ color: 0x8d8f90, roughness: 0.9 })]);
  });
  const R = rng(99);
  for (const o of src) {
    const bb = new THREE.Box3().setFromObject(o), sz = bb.getSize(new THREE.Vector3()), ct = bb.getCenter(new THREE.Vector3());
    const g = new THREE.BoxGeometry(sz.x, sz.y, sz.z), uv = g.attributes.uv;
    const off = [Math.floor(R() * 8) / 8, Math.floor(R() * 8) / 8];
    for (let f = 0; f < 6; f++) {
      const wd = (f < 2) ? sz.z : sz.x;
      for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * Math.round(wd / 3.6) / 8 + off[0], uv.getY(i) * Math.round(sz.y / 3.4) / 8 + off[1]); }
    }
    const [side, roof] = cityMats[Math.floor(R() * cityMats.length)];
    const m = new THREE.Mesh(g, [side, side, roof, roof, side, side]);
    m.position.copy(ct); m.castShadow = true; m.receiveShadow = true; m.name = o.name;
    group.add(m); m.updateMatrixWorld(true); addSolid(m); o.visible = false;
  }
}
async function loadMain() {
  const g = await new GLTFLoader().loadAsync('./models/conch.glb?v=20261116-1558');
  const city = [];
  g.scene.updateMatrixWorld(true);
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    const n = o.name; o.castShadow = true; o.receiveShadow = true;
    if (n.startsWith('walk_') || n.endsWith('_band') || n.endsWith('_base') || n.startsWith('lobby_floor')) walkables.push(o);   // _base：蓋在水上的量體，一樓地板也要能站
    if (n.startsWith('core_')) o.material = M.core;
    else if (n.startsWith('lobby_floor')) { planarUV(o.geometry, 40); o.material = M.lobby; o.castShadow = false; }
    else if (n.startsWith('shell_')) o.material = M.shell;
    else if (n.includes('_glass')) { if (!o.geometry.attributes.uv) wallUV(o.geometry); o.material = M.glass; o.castShadow = false; o.renderOrder = 3; }
    else if (n.startsWith('body_') || n.startsWith('fin_') || n.startsWith('tip_') || n.startsWith('rail_') || n.startsWith('stairbody_')) o.material = M.band;
    else if (n.startsWith('curtain_')) { o.material = M.curtain; o.castShadow = false; o.renderOrder = 3; }
    else if (n.startsWith('walk_') || n.startsWith('pier_')) { planarUV(o.geometry, 3.65); o.material = M.quay; }
    else if (n.startsWith('road_')) { planarUV(o.geometry, 4.2); o.material = M.road; }
    else if (n.startsWith('city_')) city.push(o);
    else if (n === 'logo_frame') o.material = M.logo;
    else if (n === 'logo_base') o.material = M.logoBase;
    else if (n === 'logo_wall') o.material = M.logoWall;
  });
  scene.add(g.scene);
  g.scene.traverse((o) => { if (o.isMesh && !o.name.startsWith('city_')) addSolid(o); });
  const cg = new THREE.Group(); scene.add(cg); buildCity(city, cg);
}

// 圓天窗：玻璃罩＋收邊環（實例化）
async function loadSkylights() {
  const j = await (await fetch('./models/skylights.json?v=20261116-1558')).json();
  const all = Object.values(j.shells).flat();
  const cap = new THREE.SphereGeometry(1, 20, 6, 0, Math.PI * 2, 0, Math.PI * 0.44);
  cap.translate(0, -Math.cos(Math.PI * 0.44), 0); cap.scale(1 / Math.sin(Math.PI * 0.44), 1 / (1 - Math.cos(Math.PI * 0.44)), 1 / Math.sin(Math.PI * 0.44));   // 底圓半徑 1、高 1
  const ring = new THREE.CylinderGeometry(1.07, 1.12, 1, 24, 1, true);
  const domes = new THREE.InstancedMesh(cap, M.dome, all.length), rings = new THREE.InstancedMesh(ring, M.collar, all.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), n = new THREE.Vector3(), s = new THREE.Vector3();
  all.forEach((a, i) => {
    p.set(a[0], a[2], -a[1]); n.set(a[3], a[5], -a[4]).normalize(); q.setFromUnitVectors(Y, n); const r = a[6];
    m.compose(p.clone().addScaledVector(n, 0.16), q, s.set(r * 1.03, r * 0.5, r * 1.03)); domes.setMatrixAt(i, m);
    m.compose(p.clone().addScaledVector(n, 0.07), q, s.set(r, 0.26, r)); rings.setMatrixAt(i, m);
  });
  domes.castShadow = false; domes.receiveShadow = false; rings.castShadow = false; rings.receiveShadow = true;
  domes.renderOrder = 2;
  scene.add(domes, rings);
}

// 築匠標誌旁的字牆
function addLogoText() {
  const t = canvasTex(2048, 420, (g, w, h) => {
    g.clearRect(0, 0, w, h); g.textBaseline = 'middle';
    g.fillStyle = '#00A1E9'; g.font = '700 190px "Microsoft JhengHei","PingFang TC","Noto Sans TC",sans-serif';
    g.fillText('築匠建築師事務所', 40, 150);
    g.fillStyle = '#23323b'; g.font = '600 78px "Segoe UI",Arial,sans-serif';
    g.fillText('CTArch　Craft & Technology of Architecture', 46, 330);
  }, { repeat: false });
  const mat = glowReg(new THREE.MeshStandardMaterial({ map: t, transparent: true, roughness: 0.4, metalness: 0.2, emissiveMap: t }), 0xffffff, 0.9);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 1.31), mat);
  m.position.copy(B(layout.logo_text[0], layout.logo_text[1], QUAY + 0.35 + 0.72)); scene.add(m);
}

// 路燈與矮燈（夜間發光、地面光暈）
function addLamps() {
  const tall = [], low = [], S = layout.site, rampX = S.ramps.map((r) => r.c[0][0]);
  for (let x = -214; x <= S.prom_south[2] - 8; x += 28) if (!rampX.some((rx) => Math.abs(rx - x) < 11)) tall.push(B(x, -143, QUAY));   // 西南岸邊，坡道起點讓開
  for (let y = -196; y <= 290; y += 28) tall.push(B(137, y, QUAY));                                                    // 東側步道
  for (let x = -130; x <= 118; x += 27) tall.push(B(x, 140.5, QUAY));                                                 // 平台北緣
  for (let y = -40; y <= 130; y += 28) tall.push(B(-135.5, y, QUAY));                                                 // 平台西緣
  for (const r of S.ramps) for (let i = 2; i < r.c.length - 1; i += 3) {                                              // 三條坡道兩側的矮燈
    const p0 = r.c[i - 1], p1 = r.c[i + 1], d = new THREE.Vector2(p1[0] - p0[0], p1[1] - p0[1]).normalize();
    for (const sg of [-1, 1]) low.push(B(r.c[i][0] - d.y * sg * (r.w / 2 - 0.55), r.c[i][1] + d.x * sg * (r.w / 2 - 0.55), QUAY));
  }
  for (let x = 3; x <= 17; x += 3.5) low.push(B(x, -61.2, QUAY));                                                     // 標誌前
  const mk = (geo, mat, list, f) => { const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(); list.forEach((p, i) => { m.makeTranslation(p.x, p.y + f, p.z); im.setMatrixAt(i, m); }); im.castShadow = true; scene.add(im); return im; };
  mk(new THREE.CylinderGeometry(0.07, 0.11, 7, 8), M.lampPole, tall, 3.5);
  mk(new THREE.SphereGeometry(0.34, 12, 8), M.lampHead, tall, 7.15).castShadow = false;
  mk(new THREE.CylinderGeometry(0.09, 0.09, 0.9, 8), M.lampPole, low, 0.45);
  mk(new THREE.CylinderGeometry(0.11, 0.11, 0.16, 10), M.lampHead, low, 0.95).castShadow = false;
  // 光暈：加法混合的貼片
  const gtex = glowTexture(), pts = [];
  const pool = new THREE.MeshBasicMaterial({ map: gtex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, toneMapped: false, color: 0xffc98a });
  const halo = new THREE.SpriteMaterial({ map: gtex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0, color: 0xffd9a8 });
  const pg = new THREE.PlaneGeometry(1, 1); pg.rotateX(-Math.PI / 2);
  const pools = new THREE.InstancedMesh(pg, pool, tall.length + low.length), m = new THREE.Matrix4();
  tall.forEach((p, i) => { m.makeScale(20, 1, 20); m.setPosition(p.x, p.y + 0.06, p.z); pools.setMatrixAt(i, m); const s = new THREE.Sprite(halo); s.position.set(p.x, p.y + 7.15, p.z); s.scale.setScalar(4.5); scene.add(s); });
  low.forEach((p, i) => { m.makeScale(5.5, 1, 5.5); m.setPosition(p.x, p.y + 0.06, p.z); pools.setMatrixAt(tall.length + i, m); });
  pools.renderOrder = 1; scene.add(pools);
  timeHooks.push((name, T) => { pool.opacity = 0.5 * Math.min(1, T.glow); halo.opacity = 0.9 * Math.min(1, T.glow); });
}

// ───────── 瀏覽：自由飛行與步行（撞到東西不能穿過，會沿表面滑動；Shift 三倍速） ─────────
const VIEWS = {   // three 座標：x 東、y 上、z 南
  aerial: { p: [60, 172, 208], t: [10, 12, 8] },      // 與原圖同角度
  top: { p: [0, 470, -9], t: [0, 0, -10] },
  west: { p: [-270, 40, 80], t: [0, 20, 0] },
  north: { p: [60, 90, -280], t: [10, 20, -40] },
  entry: { p: [-66, 12, 128], t: [-12, 16, 30] },
  roof: { p: [70, 78, 120], t: [24, 40, 30] },
  lobby: { p: [-3.4, 4.2, 14], t: [-30, 9, 2] },
};
const RADIUS = 0.6, FLY = 14, WALK = 3.5, BOOST = 3;
const keys = {};
let mode = 'fly';
const WALK_START = { p: [-86, QUAY + EYE, 150], t: [-26, 8, 58] };   // 主坡道起點
const eul = new THREE.Euler(0, 0, 0, 'YXZ');
const help = $('help'), tip = $('walkTip');
const HELP = {
  fly: '飛行：W A S D 前後左右、Q／空白鍵上升、E 下降、按住滑鼠左鍵拖曳轉向、滾輪前進後退、Shift 三倍速；撞到東西會停下或沿著表面滑過去',
  walk: '步行：W A S D 或方向鍵移動、按住滑鼠左鍵拖曳轉頭、Shift 三倍速、R 回到起點、各棟展廳有樓梯可以走，也可以按 PageUp／PageDown 上下樓；先飛到想去的地方再按「步行」會就地落地',
};
const TIP = {
  fly: 'W A S D 飛行　Q／空白鍵上升　E 下降<br>按住滑鼠左鍵拖曳轉向　滾輪前進後退<br>Shift 三倍速',
  walk: 'W A S D（或方向鍵）移動　Shift 三倍速<br>按住滑鼠左鍵拖曳轉頭<br>PageUp／PageDown 上下樓　R 回到起點',
};
function lookFrom(p, t) {
  camera.position.set(...p); camera.lookAt(...t);
  eul.setFromQuaternion(camera.quaternion, 'YXZ'); eul.z = 0; camera.quaternion.setFromEuler(eul);
}
function setView(k) { if (!VIEWS[k]) return; if (mode !== 'fly') setMode('fly'); lookFrom(VIEWS[k].p, VIEWS[k].t); }
const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
const fwd = new THREE.Vector3(), right = new THREE.Vector3(), mv = new THREE.Vector3(), DOWN = new THREE.Vector3(0, -1, 0),
  dir = new THREE.Vector3(), nrm = new THREE.Vector3(), from = new THREE.Vector3(), prev = new THREE.Vector3(), cand = new THREE.Vector3(), yawOnly = new THREE.Euler();
function groundBelow(far) {
  from.copy(camera.position); from.y += 1; ray.set(from, DOWN); ray.far = far;
  const h = ray.intersectObjects(walkables, false)[0]; return h ? h.point.y : null;
}
function setMode(m) {
  mode = m;
  $('mFly').classList.toggle('on', m === 'fly'); $('mWalk').classList.toggle('on', m === 'walk');
  help.textContent = HELP[m]; tip.firstElementChild.innerHTML = TIP[m]; tip.style.display = 'flex';
  for (const k in keys) keys[k] = false;
  if (m === 'walk') {
    const g = groundBelow(900);                            // 就地落到腳下的地面；腳下沒有地面就回起點
    if (g !== null) { camera.position.y = g + EYE; eul.x = THREE.MathUtils.clamp(eul.x, -0.6, 0.6); camera.quaternion.setFromEuler(eul); }
    else lookFrom(WALK_START.p, WALK_START.t);
    camera.fov = 68;
  } else camera.fov = 55;
  camera.updateProjectionMatrix();
}
$('mFly').onclick = (e) => { e.currentTarget.blur(); setMode('fly'); };
$('mWalk').onclick = (e) => { e.currentTarget.blur(); setMode('walk'); };
// 上樓／下樓：像搭電梯，到正上方或正下方的樓層
const allRay = new THREE.Raycaster();
function floorJump(dirn) {
  if (mode !== 'walk') setMode('walk');
  allRay.set(from.set(camera.position.x, 400, camera.position.z), DOWN); allRay.far = 420;
  const ys = [...new Set(allRay.intersectObjects(walkables, false).map((h) => +h.point.y.toFixed(1)))].sort((a, b) => a - b);
  const cur = camera.position.y - EYE, list = dirn > 0 ? ys.filter((y) => y > cur + 1.5) : ys.filter((y) => y < cur - 1.5).reverse();
  for (const y of list) {                                   // 上方要有 2.2 公尺淨空才算一層樓
    ray.set(from.set(camera.position.x, y + 0.25, camera.position.z), dir.set(0, 1, 0)); ray.far = 2.2;
    if (!ray.intersectObjects(solids, false).length) { camera.position.y = y + EYE; tip.style.display = 'none'; help.textContent = HELP.walk; return; }
  }
  help.textContent = '這個位置的' + (dirn > 0 ? '上' : '下') + '方沒有可以站的樓層（請走到展廳裡再試）';
}
$('fUp').onclick = (e) => { e.currentTarget.blur(); floorJump(1); };
$('fDown').onclick = (e) => { e.currentTarget.blur(); floorJump(-1); };
document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => { b.blur(); setView(b.dataset.view); tip.style.display = 'none'; });

const cv = renderer.domElement;
let dragging = false, lastX = 0, lastY = 0;
function turn(dx, dy) {
  eul.y -= dx * 0.0026; eul.x = THREE.MathUtils.clamp(eul.x - dy * 0.0026, -1.5, 1.5);
  camera.quaternion.setFromEuler(eul);
}
cv.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY; tip.style.display = 'none';
  try { cv.setPointerCapture(e.pointerId); } catch (_) {}
});
cv.addEventListener('pointermove', (e) => {
  if (document.pointerLockElement === cv) { turn(e.movementX, e.movementY); return; }
  if (!dragging) return;
  turn(e.clientX - lastX, e.clientY - lastY); lastX = e.clientX; lastY = e.clientY;
});
addEventListener('pointerup', () => { dragging = false; });
cv.addEventListener('dblclick', () => {                    // 連點兩下：瀏覽器允許時鎖定滑鼠自由轉向（Esc 解除）
  if (!cv.requestPointerLock) return;
  try { const p = cv.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (_) {}
});
cv.addEventListener('wheel', (e) => {
  e.preventDefault(); if (mode !== 'fly') return;
  camera.getWorldDirection(fwd); moveWithCollision(mv.copy(fwd).multiplyScalar(-Math.sign(e.deltaY) * 7 * ((keys.ShiftLeft || keys.ShiftRight) ? BOOST : 1)));
}, { passive: false });
const MOVE_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyC', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'];
const fresh = {}, releaseLater = {};      // 快速點按（按下放開都在同一格內）也要至少動一步
addEventListener('keydown', (e) => {
  keys[e.code] = true; if (!e.repeat) fresh[e.code] = true;
  if (MOVE_KEYS.includes(e.code)) { e.preventDefault(); tip.style.display = 'none'; }
  if (e.code === 'KeyR' && mode === 'walk') lookFrom(WALK_START.p, WALK_START.t);
  if (e.code === 'PageUp') { e.preventDefault(); floorJump(1); }
  if (e.code === 'PageDown') { e.preventDefault(); floorJump(-1); }
});
addEventListener('keyup', (e) => { if (fresh[e.code]) releaseLater[e.code] = true; else keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

// 帶碰撞的移動：前方有實體就停在它前面，剩下的位移沿著表面滑動（最多三次）
function moveWithCollision(delta) {
  for (let it = 0; it < 3; it++) {
    const len = delta.length(); if (len < 1e-5) return;
    dir.copy(delta).divideScalar(len);
    ray.set(camera.position, dir); ray.far = len + RADIUS;
    const hit = ray.intersectObjects(solids, false)[0];
    if (!hit) { camera.position.add(delta); return; }
    nrm.copy(hit.face.normal).transformDirection(hit.object.matrixWorld); if (nrm.dot(dir) > 0) nrm.negate();
    const allow = Math.max(0, hit.distance - RADIUS);
    camera.position.addScaledVector(dir, allow);
    delta.addScaledVector(dir, -allow); delta.addScaledVector(nrm, -delta.dot(nrm));
  }
}
function navStep(dt) {
  const tk = (keys.ArrowLeft ? 1 : 0) - (keys.ArrowRight ? 1 : 0); if (tk) turn(-tk * dt * 420, 0);
  if (mode === 'fly') camera.getWorldDirection(fwd); else fwd.set(0, 0, -1).applyEuler(yawOnly.set(0, eul.y, 0));
  right.set(-fwd.z, 0, fwd.x); if (right.lengthSq() < 1e-6) right.set(1, 0, 0).applyEuler(yawOnly.set(0, eul.y, 0)); right.normalize();
  mv.set(0, 0, 0);
  if (keys.KeyW || keys.ArrowUp) mv.add(fwd);
  if (keys.KeyS || keys.ArrowDown) mv.sub(fwd);
  if (keys.KeyD) mv.add(right);
  if (keys.KeyA) mv.sub(right);
  if (mode === 'fly') { if (keys.KeyQ || keys.Space) mv.y += 1; if (keys.KeyE || keys.KeyC) mv.y -= 1; }
  if (mv.lengthSq() === 0) return;
  mv.normalize().multiplyScalar((mode === 'fly' ? FLY : WALK) * ((keys.ShiftLeft || keys.ShiftRight) ? BOOST : 1) * dt);
  if (mode === 'fly') {
    moveWithCollision(mv);
    camera.position.y = THREE.MathUtils.clamp(camera.position.y, 0.9, 800);       // 不潛入海面
    const r = Math.hypot(camera.position.x, camera.position.z); if (r > 1600) { camera.position.x *= 1600 / r; camera.position.z *= 1600 / r; }
    return;
  }
  for (const [dx, dz] of [[mv.x, mv.z], [mv.x, 0], [0, mv.z]]) {                   // 步行：腳下要有地面，走不過去就沿邊滑動
    prev.copy(camera.position); moveWithCollision(cand.set(dx, 0, dz));
    const g = groundBelow(8);
    if (g !== null) { camera.position.y = THREE.MathUtils.lerp(camera.position.y, g + EYE, 0.35); return; }
    camera.position.copy(prev);
  }
}
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

// ───────── 景觀、植栽、室內、人物、船舶由 scene_extras.js 掛進來 ─────────
const updaters = [];
let layout = null;
const ctx = { VIEWS, THREE, scene, camera, renderer, B, QUAY, M, GLOW, glowReg, timeHooks, updaters, solids, addSolid, colliders, walkables, rng, canvasTex, MAXA, getGlow: () => glowLevel, getTime: () => curTime };

// ───────── 啟動 ─────────
async function start() {
  try { skyInfo = await (await fetch('./assets/sky/sky_info.json')).json(); } catch (_) { skyInfo = null; }
  layout = ctx.layout = await (await fetch('./models/layout.json?v=20261116-1558')).json();
  await Promise.all([loadMain(), loadSkylights(), loadSky('day')]);
  addLogoText(); addLamps();
  try { const ex = await import('./scene_main.js?v=20261116-1558'); await ex.init(ctx); } catch (e) { console.warn('動態物件未載入：', e); }
  try { const dr = await import('./scene_doors.js?v=20261116-1558'); window.__doors = dr.init(ctx); } catch (e) { console.warn('門扇未載入：', e); }
  applyTime('day'); setMode('fly'); setView('aerial');
  veil.remove();
  loadSky('dusk'); loadSky('night');                       // 背景預載
}
start().catch((e) => { veil.textContent = '場景載入失敗：' + (e.message || e); console.error(e); });

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  water.material.uniforms.time.value += dt * 0.35;
  navStep(Math.max(dt, 0.016));
  for (const k in fresh) { delete fresh[k]; if (releaseLater[k]) { keys[k] = false; delete releaseLater[k]; } }
  for (const f of updaters) f(dt, t);
  composer.render();
});
window.__dbg = { scene, camera, renderer, walkables, solids, sun, water, setMode, setView, setTime, applyTime, lookFrom, keys, eul, M, TIMES, skyData, bloom, hemi, THREE, getMode: () => mode };
