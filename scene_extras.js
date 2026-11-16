// 海螺館 3D 瀏覽：景觀、植栽、室內大廳、人物（橘色透明 3D 量體）、船舶
// 位置一律寫 Blender 平面座標（x 東、y 北），用 B() 換成 three 座標。
// 人與植栽放置前都會檢查：腳下有可走的地面、上方有足夠淨高、沒有撞到東西——不合格的不放。
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function init(ctx) {
  const L = landscape(ctx);                       // 先建花台（會成為障礙物），再放植栽與人
  lobby(ctx);
  const r = await Promise.allSettled([plants(ctx, L), ships(ctx)]);
  r.forEach((x, i) => { if (x.status === 'rejected') console.warn(['植栽', '船舶'][i] + '未載入：', x.reason); });
  people(ctx);
}

// ───────── 共用檢查 ─────────
function makeProbe({ THREE, solids, walkables }) {
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3(), d = new THREE.Vector3();
  return {
    ground(x, z, yTop) { ray.set(o.set(x, yTop, z), DOWN); ray.far = 6; const h = ray.intersectObjects(walkables, false)[0]; return h ? h.point.y : null; },
    clearUp(p, from, h) { ray.set(o.set(p.x, p.y + from, p.z), UP); ray.far = h; return ray.intersectObjects(solids, false).length === 0; },
    clearBetween(a, b, hgt) { d.subVectors(b, a); d.y = 0; const len = d.length(); if (len < 1e-4) return true; d.divideScalar(len); ray.set(o.set(a.x, a.y + hgt, a.z), d); ray.far = len; return ray.intersectObjects(solids, false).length === 0; },
  };
}

// ───────── 景觀：花台（收邊兼座椅）、草地、植床、樹穴格柵 ─────────
// 設計：南側與東側步道各一條帶狀花台（每段約 34 公尺、段與段之間留通道，人行橋落點留空），臨建築側收邊加木座面；
// 入口廣場兩座葉形花台呼應殼片造型；標誌後方一道矮植床；平台北緣兩片草地；鋪面上的行道樹用圓形樹穴格柵。
function landscape({ THREE, scene, B, QUAY, addSolid, MAXA, rng }) {
  const tl = new THREE.TextureLoader();
  const tex = (name, rep, srgb) => { const t = tl.load(`./assets/tex/${name}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = MAXA; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const pbr = (n, rep, extra = {}) => new THREE.MeshStandardMaterial({ map: tex(n + '_diff', rep, true), normalMap: tex(n + '_nor_gl', rep), roughnessMap: tex(n + '_rough', rep), roughness: 1, ...extra });
  const mat = {
    lawn: pbr('lawn', 1 / 2.0, { color: 0xc9d6b4 }), mulch: pbr('mulch', 1 / 1.3), gravel: pbr('gravel', 1 / 2.0), wood: pbr('wood', 1 / 1.5, { color: 0xd9c4a3 }),
    curb: new THREE.MeshStandardMaterial({ color: 0xdedbd3, roughness: 0.72 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.45, metalness: 0.7 }),
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
  };
  const R = rng(2025), H = 0.45, CW = 0.5;
  const out = { treesA: [], treesB: [], shrubs: [], grates: [] };
  const rrect = (x0, y0, x1, y1, r, n = 6) => {
    const p = [], c = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]];
    for (const [cx, cy, a0] of c) for (let i = 0; i <= n; i++) { const a = (a0 + 90 * i / n) * Math.PI / 180; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); }
    return p;
  };
  const leaf = (cx, cy, L, W, deg, n = 56) => {
    const p = [], ca = Math.cos(deg * Math.PI / 180), sa = Math.sin(deg * Math.PI / 180);
    for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2, x = L / 2 * Math.cos(t), s = Math.sin(t), y = W / 2 * Math.sign(s) * Math.pow(Math.abs(s), 1.25); p.push([cx + x * ca - y * sa, cy + x * sa + y * ca]); }
    return p;
  };
  const shape = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const extr = (sh, h, m, z, shadow = true) => {
    const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 4 }); g.rotateX(-Math.PI / 2);
    const o = new THREE.Mesh(g, m); o.position.y = z; o.castShadow = shadow; o.receiveShadow = true; scene.add(o); o.updateMatrixWorld(true); return o;
  };
  function bed(outer, inner, z, fill, trees = [], kind = 'A', nShrub = 0) {
    const ring = shape(outer); ring.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
    extr(ring, H, mat.curb, z);
    extr(shape(inner), H - 0.08, mat[fill], z, false);
    addSolid(extr(shape(outer), 2.6, mat.hidden, z, false));          // 看不見的障礙物：人與鏡頭不會穿過花台
    for (const [x, y] of trees) (kind === 'A' ? out.treesA : out.treesB).push(B(x, y, z + H - 0.1));
    let k = 0, guard = 0;
    const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    while (k < nShrub && guard++ < nShrub * 30) {
      const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0);
      if (!inPoly(inner, x, y) || trees.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1.6)) continue;
      out.shrubs.push(B(x, y, z + H - 0.08)); k++;
    }
  }
  const rectBed = (x0, y0, x1, y1, z, fill, trees, kind, nShrub, seat) => {
    bed(rrect(x0, y0, x1, y1, 1.1), rrect(x0 + CW, y0 + CW, x1 - CW, y1 - CW, 0.6), z, fill, trees, kind, nShrub);
    if (seat) {
      const q = seat === 'N' ? [x0 + 1.4, y1 - CW + 0.02, x1 - 1.4, y1 - 0.03] : seat === 'S' ? [x0 + 1.4, y0 + 0.03, x1 - 1.4, y0 + CW - 0.02] : [x0 + 0.03, y0 + 1.4, x0 + CW - 0.02, y1 - 1.4];
      extr(shape([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]), 0.06, mat.wood, z + H);
    }
  };
  for (const [a, b] of [[-214, -180], [-172, -138], [-130, -96], [-50, -22], [1, 35], [43, 77], [85, 119], [127, 161], [169, 214]]) {
    const tr = []; for (let x = a + 5; x <= b - 5; x += 12) tr.push([x, -148]);
    rectBed(a, -151, b, -145, QUAY, 'lawn', tr, 'A', Math.round((b - a) / 3.2), 'N');
  }
  for (let x = -204; x <= 204; x += 24) { out.treesB.push(B(x, -181, QUAY)); out.grates.push(B(x, -181, QUAY)); }
  for (const [a, b] of [[-118, -84], [-76, -42], [-34, 0], [56, 90], [98, 132], [140, 174], [182, 216], [224, 268]]) {
    const tr = []; for (let y = a + 5; y <= b - 5; y += 12) tr.push([186, y]);
    rectBed(183, a, 189, b, QUAY, 'lawn', tr, 'B', Math.round((b - a) / 3.4), 'W');
  }
  for (const [x, y] of [[150, 24], [150, 40]]) { out.treesB.push(B(x, y, QUAY)); out.grates.push(B(x, y, QUAY)); }
  rectBed(-116, 104, -16, 110, QUAY, 'lawn', [[-108, 107], [-90, 107], [-72, 107], [-54, 107], [-36, 107], [-22, 107]], 'A', 26, 'S');
  rectBed(44, 104, 112, 110, QUAY, 'lawn', [[52, 107], [70, 107], [88, 107], [104, 107]], 'A', 18, 'S');
  bed(leaf(-49, -49.2, 19, 6.6, -4), leaf(-49, -49.2, 17.6, 5.5, -4), QUAY, 'lawn', [[-54.5, -48.8], [-45.5, -49.6]], 'B', 9);
  bed(leaf(-86, -50, 21, 6.4, 3), leaf(-86, -50, 19.6, 5.3, 3), QUAY, 'lawn', [[-92, -50.3], [-80.5, -49.7]], 'B', 10);
  bed(rrect(-21.5, -49.15, -6.3, -47.5, 0.4, 3), rrect(-21.2, -48.9, -6.6, -47.75, 0.25, 3), QUAY, 'mulch', [], 'A', 12);
  const gd = new THREE.CircleGeometry(1.05, 28); gd.rotateX(-Math.PI / 2);
  const gr = new THREE.RingGeometry(1.05, 1.25, 28); gr.rotateX(-Math.PI / 2);
  out.grateMeshes = { gd, gr, gravel: mat.gravel, steel: mat.steel };
  return out;
}

// ───────── 植栽：種在花台、草地與樹穴內；上方淨高不足（會頂到殼片）的不種 ─────────
async function plants(ctx, L) {
  const { THREE, scene, rng } = ctx, probe = makeProbe(ctx);
  const loader = new GLTFLoader();
  const load = async (file) => { try { return (await loader.loadAsync('./assets/plants/' + file)).scene; } catch (_) { return null; } };
  const [ta, tb, sa, sb] = await Promise.all([load('tree_a.glb'), load('tree_b.glb'), load('shrub_a.glb'), load('shrub_b.glb')]);
  const R = rng(777);
  const okTree = (p) => probe.clearUp(p, 0.6, 11), okShrub = (p) => probe.clearUp(p, 0.3, 2.4);
  const treesA = L.treesA.filter(okTree), treesB = L.treesB.filter(okTree), shrubs = L.shrubs.filter(okShrub);
  const grates = L.grates.filter(okTree);
  console.info(`植栽：喬木 ${treesA.length + treesB.length}（淨高不足剔除 ${L.treesA.length + L.treesB.length - treesA.length - treesB.length}）、灌木 ${shrubs.length}`);
  if (grates.length) {
    const { gd, gr, gravel, steel } = L.grateMeshes;
    const a = new THREE.InstancedMesh(gd, gravel, grates.length), b = new THREE.InstancedMesh(gr, steel, grates.length), m = new THREE.Matrix4();
    grates.forEach((p, i) => { m.makeTranslation(p.x, p.y + 0.012, p.z); a.setMatrixAt(i, m); m.makeTranslation(p.x, p.y + 0.02, p.z); b.setMatrixAt(i, m); });
    a.receiveShadow = b.receiveShadow = true; scene.add(a, b);
  }
  const scatter = (src, pts, smin, smax, { skip = null, sink = 0 } = {}) => {
    if (!src || !pts.length) return;
    src.updateMatrixWorld(true);
    const T = pts.map((p) => { const s = smin + R() * (smax - smin); return new THREE.Matrix4().compose(p.clone().setY(p.y - sink * s), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.283), new THREE.Vector3(s, s, s)); });
    src.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material; let depth = null;
      if (skip && skip.test(m.name)) return;                     // 盆栽的花盆不用，植物直接種在植床
      if (m.transparent || m.alphaTest > 0 || m.alphaMap) {     // 葉片：門檻低＋覆蓋率抗鋸齒，遠看葉子才不會消失
        m.transparent = false; m.alphaTest = 0.14; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true;
        depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.14, side: THREE.DoubleSide });
      }
      m.envMapIntensity = 0.7;
      const im = new THREE.InstancedMesh(o.geometry, m, T.length), mm = new THREE.Matrix4();
      T.forEach((t, i) => { mm.multiplyMatrices(t, o.matrixWorld); im.setMatrixAt(i, mm); });
      im.castShadow = true; im.receiveShadow = true; if (depth) im.customDepthMaterial = depth;
      im.frustumCulled = false; scene.add(im);
    });
  };
  scatter(ta, treesA, 0.8, 1.05); scatter(tb || ta, treesB, 0.85, 1.15);
  scatter(sa, shrubs.filter((_, i) => i % 2 === 0 || !sb), 1.2, 1.9, { skip: /pot/i, sink: 0.26 });
  scatter(sb, shrubs.filter((_, i) => i % 2 === 1), 0.9, 1.3, { skip: /pot/i, sink: 0.05 });
}

// ───────── 室內大廳（拱殼 C 下方）與北廳（拱殼 K 下方） ─────────
// 配置：主入口進來正上方是各殼片收攏的中心；西翼是圓柱水族缸與環繞坡道、夾層；東翼懸吊鯨魚；入口旁是弧形服務台。
// 北廳沿北側設水母缸與座椅。
function lobby({ THREE, scene, B, QUAY, addSolid, updaters, glowReg, rng }) {
  const R = rng(31), F = QUAY + 0.04;
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.45, side: THREE.DoubleSide });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const waterM = glowReg(new THREE.MeshStandardMaterial({ color: 0x0c5a8c, roughness: 0.2, transparent: true, opacity: 0.8, emissive: 0x0b5f9a }), 0x0b6fb4, 0.9);
  waterM.userData.base = 0.45;                                          // 白天也有一點自發光（缸內照明）
  const add = (g, m, p, solid = false, shadow = true) => { const o = new THREE.Mesh(g, m); o.position.copy(p); o.castShadow = shadow; o.receiveShadow = true; scene.add(o); o.updateMatrixWorld(true); if (solid) addSolid(o); return o; };

  // 室內補光：暖白點光源（不投影），讓大廳不會只剩天窗光斑以外一片暗
  for (const [x, y, h, k] of [[-36, -1, 22, 1], [-14, -8, 16, 0.8], [8, -8, 14, 0.8], [30, -12, 16, 0.8], [46, -15, 18, 0.9], [-20, 36, 16, 0.8], [4, 36, 18, 0.9], [28, 34, 16, 0.8]]) {
    const pl = new THREE.PointLight(0xfff0d8, 1500 * k, 75, 2); pl.position.copy(B(x, y, F + h)); scene.add(pl);
  }
  // 圓柱水族缸
  const AQ = B(-36, -1, F), AR = 4.6, AH = 17;
  add(new THREE.CylinderGeometry(AR + 0.5, AR + 0.7, 0.9, 48), white, AQ.clone().setY(F + 0.45), true);
  add(new THREE.CylinderGeometry(AR, AR, AH, 48, 1, true), glass, AQ.clone().setY(F + 0.9 + AH / 2), true, false).renderOrder = 3;
  add(new THREE.CylinderGeometry(AR - 0.12, AR - 0.12, AH - 0.3, 48), waterM, AQ.clone().setY(F + 0.9 + AH / 2), false, false).renderOrder = 2;
  add(new THREE.CylinderGeometry(AR + 0.6, AR + 0.4, 0.7, 48), white, AQ.clone().setY(F + 0.9 + AH + 0.35));
  // 魚群
  const NF = 170, fg = new THREE.SphereGeometry(1, 10, 6); fg.scale(0.42, 0.15, 0.07);
  const fish = new THREE.InstancedMesh(fg, new THREE.MeshStandardMaterial({ color: 0xcfd9e2, roughness: 0.25, metalness: 0.7, emissive: 0x33506a, emissiveIntensity: 0.5 }), NF);
  const fd = []; for (let i = 0; i < NF; i++) fd.push({ r: 0.9 + R() * (AR - 1.5), h: F + 1.6 + R() * (AH - 1.6), a: R() * 6.283, w: (0.16 + R() * 0.2) * (R() < 0.85 ? 1 : -1), s: 0.6 + R() * 0.9, b: R() * 6.283 });
  fish.frustumCulled = false; fish.renderOrder = 1; scene.add(fish);
  // 環繞坡道（1.5 圈升到 9 公尺）與護欄
  const RI = 5.4, RO = 7.6, TURN = 1.5, RISE = 9, N = 120, pos = [], idx = [], wall = [], widx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = t * TURN * Math.PI * 2 + Math.PI * 0.5, y = F + t * RISE, c = Math.cos(a), s = Math.sin(a);
    pos.push(AQ.x + RI * c, y, AQ.z + RI * s, AQ.x + RO * c, y, AQ.z + RO * s, AQ.x + RI * c, y - 0.35, AQ.z + RI * s, AQ.x + RO * c, y - 0.35, AQ.z + RO * s);
    wall.push(AQ.x + RO * c, y, AQ.z + RO * s, AQ.x + RO * c, y + 1.1, AQ.z + RO * s, AQ.x + RI * c, y, AQ.z + RI * s, AQ.x + RI * c, y + 1.1, AQ.z + RI * s);
    if (i < N) { const k = i * 4; idx.push(k, k + 1, k + 5, k, k + 5, k + 4, k + 2, k + 7, k + 3, k + 2, k + 6, k + 7, k + 1, k + 3, k + 7, k + 1, k + 7, k + 5, k, k + 6, k + 2, k, k + 4, k + 6); widx.push(k, k + 1, k + 5, k, k + 5, k + 4, k + 2, k + 3, k + 7, k + 2, k + 7, k + 6); }
  }
  const mk = (p, ix) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals(); return g; };
  add(mk(pos, idx), white, new THREE.Vector3(), true);
  add(mk(wall, widx), glass, new THREE.Vector3(), true, false).renderOrder = 3;
  // 夾層（環形平台）與細柱
  const ring = new THREE.Shape(); ring.absarc(0, 0, 11, Math.PI * 0.15, Math.PI * 1.55, false); ring.absarc(0, 0, RO, Math.PI * 1.55, Math.PI * 0.15, true);
  const mg = new THREE.ExtrudeGeometry(ring, { depth: 0.45, bevelEnabled: false, curveSegments: 40 }); mg.rotateX(-Math.PI / 2);
  add(mg, white, new THREE.Vector3(AQ.x, F + RISE - 0.45, AQ.z), true);
  for (let k = 0; k < 6; k++) { const a = Math.PI * (0.2 + k * 0.26); add(new THREE.CylinderGeometry(0.22, 0.22, RISE - 0.45, 12), white, new THREE.Vector3(AQ.x + 10.3 * Math.cos(a), F + (RISE - 0.45) / 2, AQ.z - 10.3 * Math.sin(a)), true); }

  // 懸吊鯨魚（東翼）
  const whale = new THREE.Group(), wm = new THREE.MeshStandardMaterial({ color: 0x41607a, roughness: 0.5 }), wb = new THREE.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.55 });
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new THREE.Vector2(Math.max(0.02, 1.75 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85) * (1 - 0.35 * t)), t * 17)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), wm); body.rotation.z = Math.PI / 2; body.position.x = 8.5; body.scale.set(1, 1, 0.92); whale.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), wb); belly.scale.set(5.2, 1.0, 1.45); belly.position.set(2.2, -0.75, 0); whale.add(belly);
  for (const sg of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), wm); fl.scale.set(1.5, 0.12, 2.1); fl.position.set(-8.2, 0.1, sg * 1.7); fl.rotation.y = sg * 0.5; whale.add(fl);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), wm); fin.scale.set(1.0, 0.12, 2.3); fin.position.set(4.6, -1.0, sg * 2.4); fin.rotation.set(sg * 0.45, sg * -0.35, 0); whale.add(fin);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 14, 6), new THREE.MeshStandardMaterial({ color: 0x555a5e, metalness: 0.8, roughness: 0.4 })); cab.position.set(sg * 4, 8, 0); whale.add(cab);
  }
  whale.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  whale.position.copy(B(40, -14, F + 12)); whale.rotation.y = THREE.MathUtils.degToRad(18); scene.add(whale);

  // 弧形服務台（入口西側）
  const dk = new THREE.Shape(); dk.absarc(0, 0, 6.2, Math.PI * 0.1, Math.PI * 0.75, false); dk.absarc(0, 0, 5.0, Math.PI * 0.75, Math.PI * 0.1, true);
  const dg = new THREE.ExtrudeGeometry(dk, { depth: 1.1, bevelEnabled: false, curveSegments: 30 }); dg.rotateX(-Math.PI / 2);
  add(dg, white, B(-17, -15, F), true);

  // 北廳：水母缸（發光水體＋半透明水母）與長椅
  const JT = B(4, 46, F), tank = glowReg(new THREE.MeshStandardMaterial({ color: 0x0b3f8f, roughness: 0.15, transparent: true, opacity: 0.86, emissive: 0x0b4fc0 }), 0x1466e0, 1.0);
  tank.userData.base = 0.5;
  add(new THREE.BoxGeometry(34, 0.8, 2.4), white, JT.clone().setY(F + 0.4), true);
  add(new THREE.BoxGeometry(34, 6, 2.0), tank, JT.clone().setY(F + 3.8), true, false);
  add(new THREE.BoxGeometry(34.6, 0.6, 2.6), white, JT.clone().setY(F + 7.1));
  const NJ = 70, jg = new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55);
  const jelly = new THREE.InstancedMesh(jg, new THREE.MeshStandardMaterial({ color: 0xdff1ff, emissive: 0x9fd4ff, emissiveIntensity: 1.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), NJ);
  const jd = []; for (let i = 0; i < NJ; i++) jd.push({ x: (R() - 0.5) * 32, y: 1.2 + R() * 5, p: R() * 6.283, s: 0.6 + R() * 1.1, w: 0.25 + R() * 0.3 });
  jelly.frustumCulled = false; jelly.renderOrder = 4; scene.add(jelly);
  for (const x of [-12, 0, 12]) add(new THREE.BoxGeometry(6, 0.45, 1.1), white, B(4 + x, 39.5, F + 0.225), true);

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  updaters.push((dt, t) => {
    for (let i = 0; i < NF; i++) { const f = fd[i], a = f.a + t * f.w; p.set(AQ.x + f.r * Math.cos(a), f.h + Math.sin(t * 0.6 + f.b) * 0.4, AQ.z + f.r * Math.sin(a)); e.set(0, -a + (f.w > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.sin(t * 6 + f.b) * 0.12, 0); m4.compose(p, q.setFromEuler(e), s.setScalar(f.s)); fish.setMatrixAt(i, m4); }
    fish.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < NJ; i++) { const j = jd[i], pulse = 1 + Math.sin(t * 1.6 * j.w * 4 + j.p) * 0.14; p.set(JT.x + j.x, F + 0.9 + ((j.y + t * j.w * 0.35) % 5.6) + 0.2, JT.z - 0.9 + (i % 5) * 0.15); m4.compose(p, q.identity(), s.set(j.s / pulse, j.s * pulse, j.s / pulse)); jelly.setMatrixAt(i, m4); }
    jelly.instanceMatrix.needsUpdate = true;
    whale.position.y = F + 12 + Math.sin(t * 0.35) * 0.12;
  });
}

// ───────── 人物：橘色透明的 3D 量體，手腳擺動行走 ─────────
function people(ctx) {
  const { THREE, scene, B, QUAY, updaters, rng } = ctx, probe = makeProbe(ctx);
  const R = rng(4242);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.6, emissive: 0xff5a00, emissiveIntensity: 0.22, depthWrite: false });
  const cap = (r, l, ty) => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.translate(0, ty, 0); return g; };
  const G = { torso: cap(0.165, 0.36, 1.2), head: new THREE.SphereGeometry(0.118, 14, 10).translate(0, 1.63, 0), leg: cap(0.078, 0.74, -0.44), arm: cap(0.055, 0.5, -0.3) };
  // 行走路線（Blender 平面座標，來回走）；建立時逐點檢查，只留合格的區段
  const PATHS = [
    [[-205, -161], [205, -161]], [[205, -170], [-205, -170]], [[-205, -139.5], [-74, -139.5]], [[10, -139.5], [205, -139.5]],
    [[-10.4, -140], [-1.35, -54], [-3.4, -27], [-3.4, -17], [-18, -8], [-36, -13.5], [-49.5, -1], [-36, 11], [-22, 5]],
    [[-63.7, -140], [-27.4, -54], [-14, -40], [-4, -34]],
    [[-36, -42], [-25, -40], [-6, -42], [3, -50], [-4, -54.5], [-30, -54.5], [-36, -42]],
    [[-3.4, -17], [10, -12], [27, -13], [42, -6], [52, -14]],
    [[177, -120], [177, 262]], [[196, 250], [196, -110]], [[-104, 101], [104, 101]], [[124, 30], [170, 30]], [[-120, -54], [-66, -54.5]],
    [[-40, 34], [0, 37], [44, 36]],
  ];
  const COUNT = [6, 6, 4, 5, 9, 5, 5, 5, 4, 4, 4, 2, 3, 4];
  const paths = [];
  PATHS.forEach((pts, k) => {
    const raw = pts.map(([x, y]) => B(x, y, QUAY)), samp = [];
    for (let i = 1; i < raw.length; i++) { const n = Math.max(1, Math.ceil(raw[i].distanceTo(raw[i - 1]) / 1.5)); for (let j = (i === 1 ? 0 : 1); j <= n; j++) samp.push(raw[i - 1].clone().lerp(raw[i], j / n)); }
    const ok = samp.map((p) => { const g = probe.ground(p.x, p.z, QUAY + 2.5); if (g === null) return false; p.y = g; return probe.clearUp(p, 0.3, 2.2); });
    for (let i = 1; i < samp.length; i++) if (ok[i] && ok[i - 1] && !probe.clearBetween(samp[i - 1], samp[i], 1.0)) ok[i] = false;
    let best = [0, -1], s0 = -1;                               // 取最長的連續合格區段
    for (let i = 0; i <= samp.length; i++) { if (i < samp.length && ok[i]) { if (s0 < 0) s0 = i; } else if (s0 >= 0) { if (i - 1 - s0 > best[1] - best[0]) best = [s0, i - 1]; s0 = -1; } }
    const v = samp.slice(best[0], best[1] + 1);
    if (v.length < 4) { console.warn('人行路線', k, '沒有足夠的合格區段，不放人'); return; }
    if (v.length < samp.length) console.info('人行路線', k, `合格 ${v.length}／${samp.length} 點`);
    const seg = [0]; for (let i = 1; i < v.length; i++) seg.push(seg[i - 1] + v[i].distanceTo(v[i - 1]));
    paths.push({ v, seg, L: seg[seg.length - 1], n: COUNT[k] });
  });
  const W = [];
  for (const P of paths) for (let i = 0; i < P.n; i++) { const child = R() < 0.14; W.push({ P, s: R() * P.L * 2, sp: (child ? 0.55 : 0.7) + R() * 0.45, lat: (R() - 0.5) * 2.0, h: child ? 0.68 + R() * 0.1 : 0.92 + R() * 0.16, ph: R() * 6.28 }); }
  const mk = (g, n) => { const im = new THREE.InstancedMesh(g, mat, n); im.castShadow = true; im.frustumCulled = false; im.renderOrder = 5; scene.add(im); return im; };
  const n = W.length, I = { torso: mk(G.torso, n), head: mk(G.head, n), legL: mk(G.leg, n), legR: mk(G.leg, n), armL: mk(G.arm, n), armR: mk(G.arm, n) };
  const root = new THREE.Matrix4(), part = new THREE.Matrix4(), tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), dir = new THREE.Vector3(), nrm = new THREE.Vector3(), sc = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const limb = (im, i, x, y, ang) => { part.compose(pos.set(x, y, 0), q.setFromEuler(e.set(ang, 0, 0)), ONE); tmp.multiplyMatrices(root, part); im.setMatrixAt(i, tmp); };
  updaters.push((dt) => {
    for (let i = 0; i < n; i++) {
      const w = W[i], P = w.P;
      w.s = (w.s + w.sp * dt) % (P.L * 2);
      const back = w.s > P.L, s = back ? P.L * 2 - w.s : w.s;
      let k = 1; while (k < P.seg.length - 1 && P.seg[k] < s) k++;
      const t = (s - P.seg[k - 1]) / Math.max(1e-6, P.seg[k] - P.seg[k - 1]);
      pos.lerpVectors(P.v[k - 1], P.v[k], t); dir.subVectors(P.v[k], P.v[k - 1]); dir.y = 0; dir.normalize(); if (back) dir.negate();
      nrm.set(-dir.z, 0, dir.x);
      const cyc = w.s * (Math.PI / 0.72) / w.h + w.ph, sw = Math.sin(cyc);                 // 步幅約 1.44 公尺 × 身高比例
      pos.addScaledVector(nrm, w.lat * Math.min(1, s / 3, (P.L - s) / 3)); pos.y += Math.abs(Math.cos(cyc)) * 0.035 * w.h;
      root.compose(pos, q.setFromEuler(e.set(0, Math.atan2(dir.x, dir.z), 0)), sc.setScalar(w.h));
      I.torso.setMatrixAt(i, root); I.head.setMatrixAt(i, root);
      limb(I.legL, i, 0.095, 0.92, sw * 0.52); limb(I.legR, i, -0.095, 0.92, -sw * 0.52);
      limb(I.armL, i, 0.235, 1.44, -sw * 0.42); limb(I.armR, i, -0.235, 1.44, sw * 0.42);
    }
    for (const k in I) I[k].instanceMatrix.needsUpdate = true;
  });
  console.info(`人物：${n} 位，路線 ${paths.length} 條`);
}

// ───────── 船舶：兩艘停泊、一艘貨櫃船遠處慢行、拖船在港內慢速巡航 ─────────
async function ships({ THREE, scene, B, updaters, glowReg }) {
  const g = await new GLTFLoader().loadAsync('./assets/ships/ships.glb');
  const winMats = new Set();
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.name === 'ship_window') winMats.add(m);
  });
  winMats.forEach((m) => glowReg(m, 0xffd9a0, 1.6));
  const get = (name) => g.scene.getObjectByName(name);
  const place = (src, x, y, headDeg) => { const grp = new THREE.Group(); grp.add(src.clone()); grp.children[0].position.set(0, 0, 0); grp.position.copy(B(x, y, 0)); grp.rotation.y = THREE.MathUtils.degToRad(headDeg); scene.add(grp); return grp; };
  const cont = get('ship_container'), bulk = get('ship_bulk'), tug = get('ship_tug'), list = [];
  if (bulk) list.push({ g: place(bulk, -143, 30, 90), ph: 0.5 });           // 靠泊主碼頭西側
  if (cont) list.push({ g: place(cont, -440, 213, 0), ph: 1.7 });           // 靠泊西北貨運碼頭
  const far = cont ? { g: place(cont, -900, -700, 62), s: 0 } : null;
  const tg = tug ? { g: place(tug, -330, -40, 0), a: 0 } : null;
  updaters.push((dt, t) => {
    for (const s of list) { s.g.position.y = Math.sin(t * 0.5 + s.ph) * 0.06; s.g.rotation.z = Math.sin(t * 0.37 + s.ph) * 0.004; }
    if (far) { far.s = (far.s + dt * 3) % 2600; const d = B(Math.cos(62 * Math.PI / 180), Math.sin(62 * Math.PI / 180), 0); far.g.position.copy(B(-1500, -1500, 0)).addScaledVector(d, far.s); far.g.position.y = Math.sin(t * 0.4) * 0.08; }
    if (tg) { tg.a += dt * 2.2 / 110; const x = -335 + Math.cos(tg.a) * 130, y = -30 + Math.sin(tg.a) * 78, tx = -Math.sin(tg.a) * 130, ty = Math.cos(tg.a) * 78; tg.g.position.copy(B(x, y, 0)); tg.g.position.y = Math.sin(t * 0.9) * 0.07; tg.g.rotation.y = Math.atan2(ty, tx); tg.g.rotation.z = Math.sin(t * 0.8) * 0.012; }
  });
}
