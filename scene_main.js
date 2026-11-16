// 築匠海洋館 3D 瀏覽：景觀、植栽、室內（入口大廳、海洋廳、各層展廳）、魚群、人物、船舶
// 所有位置都由 models/layout.json（模型產生時一併輸出）換算，不手寫座標；
// 人、樹、魚放置前都用射線檢查地面與淨高，不合格的不放。
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export async function init(ctx) {
  const L = ctx.layout, H = hallTools(ctx, L);
  const land = landscape(ctx, L);
  const kit = fishKit(ctx);
  const safe = (name, f) => { try { f(); } catch (e) { console.warn(name + '建置失敗：', e); } };
  safe('入口大廳', () => lobby(ctx, H, kit));
  safe('海洋廳', () => oceanHall(ctx, H, kit));
  safe('各層展廳', () => galleries(ctx, L));
  const r = await Promise.allSettled([plants(ctx, land), ships(ctx)]);
  r.forEach((x, i) => { if (x.status === 'rejected') console.warn(['植栽', '船舶'][i] + '未載入：', x.reason); });
  safe('人物', () => people(ctx, L, H));
  const d = L.doors.C_south, a = H.pt('C', 0.3, 0);
  ctx.VIEWS.lobby = { p: [d[0] + (a[0] - d[0]) * 0.12, ctx.QUAY + 2.4, -(d[1] + 6)], t: [a[0], ctx.QUAY + 9, -a[1]] };
  const n = H.pt('N', 0.5, -0.5), n2 = H.pt('N', 0.25, 0);
  ctx.VIEWS.ocean = { p: [n[0], ctx.QUAY + 2.6, -n[1]], t: [n2[0], ctx.QUAY + 5, -n2[1]] };
}

// ───────── 大廳座標工具：u＝沿脊線 0～1（西→東），v＝橫向 −1～1（負＝南側牆、正＝北側牆） ─────────
function hallTools({ B, QUAY }, L) {
  const at = (name, u) => {
    const a = L.halls[name]; let i = 1; while (i < a.length - 1 && a[i].u < u) i++;
    const p = a[i - 1], q = a[i], t = Math.min(1, Math.max(0, (u - p.u) / (q.u - p.u))), lp = (x, y) => x + (y - x) * t;
    return { c: [lp(p.c[0], q.c[0]), lp(p.c[1], q.c[1])], p: [lp(p.p[0], q.p[0]), lp(p.p[1], q.p[1])], m: [lp(p.m[0], q.m[0]), lp(p.m[1], q.m[1])], top: lp(p.top, q.top), tan: [q.c[0] - p.c[0], q.c[1] - p.c[1]] };
  };
  const pt = (name, u, v) => { const s = at(name, u), w = v >= 0 ? s.p : s.m, k = Math.abs(v); return [s.c[0] + (w[0] - s.c[0]) * k, s.c[1] + (w[1] - s.c[1]) * k]; };
  const ang = (name, u) => { const s = at(name, u); return Math.atan2(s.tan[1], s.tan[0]); };   // 脊線方向；直接當 three 的 rotation.y
  const half = (name, u) => { const s = at(name, u); return Math.min(Math.hypot(s.p[0] - s.c[0], s.p[1] - s.c[1]), Math.hypot(s.m[0] - s.c[0], s.m[1] - s.c[1])); };
  const V = (name, u, v, h = 0) => { const q = pt(name, u, v); return B(q[0], q[1], QUAY + 0.04 + h); };
  return { at, pt, ang, half, V };
}

function makeProbe({ THREE, solids, walkables }) {
  const ray = new THREE.Raycaster(); ray.firstHitOnly = true;
  const UP = new THREE.Vector3(0, 1, 0), DOWN = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3(), d = new THREE.Vector3();
  return {
    ground(x, z, yTop) { ray.set(o.set(x, yTop, z), DOWN); ray.far = 6; const h = ray.intersectObjects(walkables, false)[0]; return h ? h.point.y : null; },
    up(p, from, far) { ray.set(o.set(p.x, p.y + from, p.z), UP); ray.far = far; const h = ray.intersectObjects(solids, false)[0]; return h ? h.distance + from : far + from; },
    clearUp(p, from, h) { ray.set(o.set(p.x, p.y + from, p.z), UP); ray.far = h; return ray.intersectObjects(solids, false).length === 0; },
    clearBetween(a, b, hgt) { d.subVectors(b, a); d.y = 0; const len = d.length(); if (len < 1e-4) return true; d.divideScalar(len); ray.set(o.set(a.x, a.y + hgt, a.z), d); ray.far = len; return ray.intersectObjects(solids, false).length === 0; },
  };
}

// ───────── 景觀：花台（收邊兼座椅）、草地、植床、樹穴格柵 ─────────
// 西南岸邊：臨水帶狀花台（三條坡道起點留空）＋靠城市側行道樹；東側步道：帶狀花台；平台北緣：兩片草地（海洋廳北門前留空）；
// 入口廣場西側：兩座葉形花台；標誌後方：矮植床。
function landscape({ THREE, scene, B, QUAY, addSolid, MAXA, rng }, L) {
  const tl = new THREE.TextureLoader();
  const tex = (name, rep, srgb) => { const t = tl.load(`./assets/tex/${name}.jpg`); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); t.anisotropy = MAXA; if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t; };
  const pbr = (n, rep, extra = {}) => new THREE.MeshStandardMaterial({ map: tex(n + '_diff', rep, true), normalMap: tex(n + '_nor_gl', rep), roughnessMap: tex(n + '_rough', rep), roughness: 1, ...extra });
  const mat = {
    lawn: pbr('lawn', 1 / 2.0, { color: 0xc9d6b4 }), mulch: pbr('mulch', 1 / 1.3), gravel: pbr('gravel', 1 / 2.0), wood: pbr('wood', 1 / 1.5, { color: 0xd9c4a3 }),
    curb: new THREE.MeshStandardMaterial({ color: 0xdedbd3, roughness: 0.72 }), steel: new THREE.MeshStandardMaterial({ color: 0x33363a, roughness: 0.45, metalness: 0.7 }),
    hidden: new THREE.MeshBasicMaterial({ visible: false }),
  };
  const R = rng(2025), H = 0.45, CW = 0.5;
  const out = { treesA: [], treesB: [], shrubs: [], grates: [] };
  const rrect = (x0, y0, x1, y1, r, n = 6) => { const p = [], c = [[x1 - r, y0 + r, -90], [x1 - r, y1 - r, 0], [x0 + r, y1 - r, 90], [x0 + r, y0 + r, 180]]; for (const [cx, cy, a0] of c) for (let i = 0; i <= n; i++) { const a = (a0 + 90 * i / n) * Math.PI / 180; p.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]); } return p; };
  const leaf = (cx, cy, Ln, W, deg, n = 56) => { const p = [], ca = Math.cos(deg * Math.PI / 180), sa = Math.sin(deg * Math.PI / 180); for (let i = 0; i < n; i++) { const t = i / n * Math.PI * 2, x = Ln / 2 * Math.cos(t), s = Math.sin(t), y = W / 2 * Math.sign(s) * Math.pow(Math.abs(s), 1.25); p.push([cx + x * ca - y * sa, cy + x * sa + y * ca]); } return p; };
  const shape = (pts) => new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const inPoly = (pts, x, y) => { let c = false; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) { const [xi, yi] = pts[i], [xj, yj] = pts[j]; if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c; } return c; };
  const extr = (sh, h, m, z, shadow = true) => { const g = new THREE.ExtrudeGeometry(sh, { depth: h, bevelEnabled: false, curveSegments: 4 }); g.rotateX(-Math.PI / 2); const o = new THREE.Mesh(g, m); o.position.y = z; o.castShadow = shadow; o.receiveShadow = true; scene.add(o); o.updateMatrixWorld(true); return o; };
  function bed(outer, inner, z, fill, trees = [], kind = 'A', nShrub = 0) {
    const ring = shape(outer); ring.holes.push(new THREE.Path(inner.map(([x, y]) => new THREE.Vector2(x, y))));
    extr(ring, H, mat.curb, z); extr(shape(inner), H - 0.08, mat[fill], z, false);
    addSolid(extr(shape(outer), 2.6, mat.hidden, z, false));
    for (const [x, y] of trees) (kind === 'A' ? out.treesA : out.treesB).push(B(x, y, z + H - 0.1));
    let k = 0, guard = 0; const xs = inner.map((p) => p[0]), ys = inner.map((p) => p[1]), x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    while (k < nShrub && guard++ < nShrub * 30) { const x = x0 + R() * (x1 - x0), y = y0 + R() * (y1 - y0); if (!inPoly(inner, x, y) || trees.some(([tx, ty]) => Math.hypot(tx - x, ty - y) < 1.6)) continue; out.shrubs.push(B(x, y, z + H - 0.08)); k++; }
  }
  const rectBed = (x0, y0, x1, y1, z, fill, trees, kind, nShrub, seat) => {
    bed(rrect(x0, y0, x1, y1, 1.1), rrect(x0 + CW, y0 + CW, x1 - CW, y1 - CW, 0.6), z, fill, trees, kind, nShrub);
    if (seat) { const q = seat === 'N' ? [x0 + 1.4, y1 - CW + 0.02, x1 - 1.4, y1 - 0.03] : seat === 'S' ? [x0 + 1.4, y0 + 0.03, x1 - 1.4, y0 + CW - 0.02] : [x0 + 0.03, y0 + 1.4, x0 + CW - 0.02, y1 - 1.4]; extr(shape([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]), 0.06, mat.wood, z + H); }
  };
  const rampX = L.site.ramps.map((r) => r.c[0][0]);                              // 坡道起點的 x：花台要讓開
  for (const [a, b] of [[-214, -180], [-172, -138], [-130, -96], [-42, -24], [-4, 30], [38, 72], [80, 114], [122, 156], [164, 214]]) {
    if (rampX.some((x) => x > a - 5 && x < b + 5)) continue;
    const tr = []; for (let x = a + 5; x <= b - 5; x += 12) tr.push([x, -157]);
    rectBed(a, -160, b, -154, QUAY, 'lawn', tr, 'A', Math.round((b - a) / 3.2), 'N');
  }
  for (let x = -204; x <= 204; x += 24) { out.treesB.push(B(x, -187, QUAY)); out.grates.push(B(x, -187, QUAY)); }
  for (const [a, b] of [[-130, -96], [-88, -54], [-46, -12], [-4, 30], [38, 72], [80, 114], [122, 156], [164, 198], [206, 240], [248, 290]]) {
    const tr = []; for (let y = a + 5; y <= b - 5; y += 12) tr.push([160, y]);
    rectBed(157, a, 163, b, QUAY, 'lawn', tr, 'B', Math.round((b - a) / 3.4), 'W');
  }
  const nd = L.doors.N_north[0];
  rectBed(-132, 142.5, nd - 14, 147.5, QUAY, 'lawn', Array.from({ length: 8 }, (_, i) => [-124 + i * ((nd - 14 + 124) / 8), 145]), 'A', 30, 'S');
  rectBed(nd + 14, 142.5, 120, 147.5, QUAY, 'lawn', Array.from({ length: 5 }, (_, i) => [nd + 22 + i * ((120 - nd - 22) / 5), 145]), 'A', 18, 'S');
  bed(leaf(-64, -57.4, 17, 5.6, 0), leaf(-64, -57.4, 15.6, 4.5, 0), QUAY, 'lawn', [[-68, -57.4], [-60, -57.4]], 'B', 8);
  bed(leaf(-100, -57.2, 21, 6.2, 2), leaf(-100, -57.2, 19.6, 5.1, 2), QUAY, 'lawn', [[-106, -57.3], [-95, -57.1]], 'B', 10);
  bed(rrect(2.2, -55.2, 17.2, -53.6, 0.4, 3), rrect(2.5, -54.95, 16.9, -53.85, 0.25, 3), QUAY, 'mulch', [], 'A', 12);
  const gd = new THREE.CircleGeometry(1.05, 28); gd.rotateX(-Math.PI / 2);
  const gr = new THREE.RingGeometry(1.05, 1.25, 28); gr.rotateX(-Math.PI / 2);
  out.grateMeshes = { gd, gr, gravel: mat.gravel, steel: mat.steel };
  return out;
}

async function plants(ctx, L) {
  const { THREE, scene, rng } = ctx, probe = makeProbe(ctx);
  const loader = new GLTFLoader();
  const load = async (file) => { try { return (await loader.loadAsync('./assets/plants/' + file)).scene; } catch (_) { return null; } };
  const [ta, tb, sa, sb] = await Promise.all([load('tree_a.glb'), load('tree_b.glb'), load('shrub_a.glb'), load('shrub_b.glb')]);
  const R = rng(777);
  const okTree = (p) => probe.clearUp(p, 0.6, 11), okShrub = (p) => probe.clearUp(p, 0.3, 2.4);
  const treesA = L.treesA.filter(okTree), treesB = L.treesB.filter(okTree), shrubs = L.shrubs.filter(okShrub), grates = L.grates.filter(okTree);
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
      if (skip && skip.test(m.name)) return;
      if (m.transparent || m.alphaTest > 0 || m.alphaMap) {     // 葉片：門檻低＋覆蓋率抗鋸齒，遠看葉子才不會消失
        m.transparent = false; m.alphaTest = 0.14; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true;
        depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.14, side: THREE.DoubleSide });
      }
      m.envMapIntensity = 0.7;
      const im = new THREE.InstancedMesh(o.geometry, m, T.length), mm = new THREE.Matrix4();
      T.forEach((t, i) => { mm.multiplyMatrices(t, o.matrixWorld); im.setMatrixAt(i, mm); });
      im.castShadow = true; im.receiveShadow = true; if (depth) im.customDepthMaterial = depth; im.frustumCulled = false; scene.add(im);
    });
  };
  scatter(ta, treesA, 0.8, 1.05); scatter(tb || ta, treesB, 0.85, 1.15);
  scatter(sa, shrubs.filter((_, i) => i % 2 === 0 || !sb), 1.2, 1.9, { skip: /pot/i, sink: 0.26 });
  scatter(sb, shrubs.filter((_, i) => i % 2 === 1), 0.9, 1.3, { skip: /pot/i, sink: 0.05 });
  console.info(`植栽：喬木 ${treesA.length + treesB.length}、灌木 ${shrubs.length}`);
}

// ───────── 魚：有魚形（身體、尾鰭、背鰭、胸鰭）的 3D 量體，分魚種分顏色，成群繞圈游 ─────────
function fishKit({ THREE, scene, updaters, solids, rng }) {
  const tri = (pts) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pts.flat(), 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(pts.map(() => [0, 0, 1]).flat(), 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(pts.map(() => [0, 0]).flat(), 2)); return g; };
  const bodyGeo = (len, hgt, wid) => { const g = new THREE.SphereGeometry(1, 14, 8).toNonIndexed(), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), k = x < 0 ? 1 + x * 0.72 : 1 - x * x * 0.25; p.setXYZ(i, x * len, p.getY(i) * hgt * k, p.getZ(i) * wid * k); } g.computeVertexNormals(); return g; };
  // 一般的魚：身體＋叉形尾鰭＋背鰭＋腹鰭（頭朝 +X）
  const fish = mergeGeometries([bodyGeo(0.5, 0.2, 0.09), tri([[-0.42, 0, 0], [-0.8, 0.24, 0], [-0.66, 0, 0], [-0.42, 0, 0], [-0.66, 0, 0], [-0.8, -0.24, 0]]), tri([[0.16, 0.17, 0], [-0.2, 0.15, 0], [-0.12, 0.36, 0]]), tri([[0.05, -0.17, 0], [-0.16, -0.15, 0], [-0.1, -0.3, 0]])]);
  // 扁高的魚（蝶魚、神仙魚那一類）
  const tall = mergeGeometries([bodyGeo(0.36, 0.32, 0.06), tri([[-0.3, 0, 0], [-0.56, 0.2, 0], [-0.56, -0.2, 0]]), tri([[0.1, 0.28, 0], [-0.22, 0.26, 0], [-0.3, 0.52, 0]]), tri([[0.1, -0.28, 0], [-0.22, -0.26, 0], [-0.3, -0.5, 0]])]);
  // 鯊魚：長身體＋高背鰭＋上長下短的尾鰭＋胸鰭
  const shark = mergeGeometries([bodyGeo(1.6, 0.3, 0.26), tri([[0.25, 0.26, 0], [-0.3, 0.22, 0], [-0.2, 0.78, 0]]), tri([[-1.35, 0, 0], [-2.05, 0.62, 0], [-1.7, 0, 0], [-1.35, 0, 0], [-1.7, 0, 0], [-1.95, -0.34, 0]]), tri([[0.45, -0.1, 0.2], [-0.05, -0.12, 0.2], [-0.2, -0.3, 0.9]]), tri([[0.45, -0.1, -0.2], [-0.2, -0.3, -0.9], [-0.05, -0.12, -0.2]])]);
  // 魟魚：菱形翼＋細尾
  const ray = mergeGeometries([(() => { const g = new THREE.SphereGeometry(1, 16, 8).toNonIndexed(), p = g.attributes.position; for (let i = 0; i < p.count; i++) { const x = p.getX(i), z = p.getZ(i), k = Math.max(0, 1 - Math.abs(z) * 0.85); p.setXYZ(i, x * 0.9 * (0.35 + 0.65 * k), p.getY(i) * 0.12 * (0.4 + 0.6 * k), z * 1.5); } g.computeVertexNormals(); return g; })(), tri([[-0.5, 0, 0.03], [-2.0, 0, 0], [-0.5, 0, -0.03]])]);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.12, side: THREE.DoubleSide, envMapIntensity: 1.1 });
  const SPECIES = [                                         // 顏色、大小、形狀
    { c: 0xf2c12e, s: 0.9, g: 'tall' }, { c: 0x2f7fd1, s: 1.0, g: 'fish' }, { c: 0xf07a2a, s: 0.8, g: 'fish' }, { c: 0xd9485a, s: 1.3, g: 'fish' },
    { c: 0x3fb7a6, s: 1.0, g: 'fish' }, { c: 0xc7d3dd, s: 1.5, g: 'fish' }, { c: 0x7b5fc2, s: 0.9, g: 'tall' }, { c: 0xf2a7b8, s: 0.8, g: 'fish' },
    { c: 0x1f3f7a, s: 1.1, g: 'tall' }, { c: 0x9bd14a, s: 0.7, g: 'fish' },
  ];
  const GEO = { fish, tall, shark, ray };
  // 量一塊地坪上方各處的淨高
  function spotsOver(floor, y0, step = 3) {
    const out = []; if (!floor) return out;
    const bb = new THREE.Box3().setFromObject(floor), rc = new THREE.Raycaster(); rc.firstHitOnly = true;
    const UPV = new THREE.Vector3(0, 1, 0), DNV = new THREE.Vector3(0, -1, 0), o = new THREE.Vector3();
    for (let x = bb.min.x + 3; x < bb.max.x - 3; x += step) for (let z = bb.min.z + 3; z < bb.max.z - 3; z += step) {
      rc.set(o.set(x, y0 + 1.5, z), DNV); rc.far = 3; if (!rc.intersectObject(floor, false).length) continue;
      rc.set(o.set(x, y0 + 2.6, z), UPV); rc.far = 80; const h = rc.intersectObjects(solids, false)[0];
      out.push({ x, z, c: h ? h.distance + 2.6 : 80 });
    }
    return out;
  }
  // 在一組「淨高點」上方放魚群：nSchool 群小魚、nBig 隻鯊魚與魟魚
  function schools(spots, y0, nSchool, perSchool, nBig, seed) {
    const R = rng(seed), high = spots.filter((s) => s.c > 9);
    if (!high.length) return;
    const minC = (x, z, r) => { let m = 1e9; for (const s of spots) if (Math.hypot(s.x - x, s.z - z) < r + 2.2) m = Math.min(m, s.c); return m; };
    const groups = { fish: [], tall: [], shark: [], ray: [] };
    for (let k = 0; k < nSchool; k++) {
      const sp = SPECIES[k % SPECIES.length], ctr = high[Math.floor(R() * high.length)], rad = 3 + R() * 6, c = Math.min(ctr.c, minC(ctr.x, ctr.z, rad));
      if (c < 8) continue;
      const y = y0 + 5 + R() * (c - 7.5), w = (0.09 + R() * 0.1) * (k % 2 ? 1 : -1), a0 = R() * 6.283;
      for (let i = 0; i < perSchool; i++) groups[sp.g].push({ x: ctr.x, z: ctr.z, r: rad + (R() - 0.5) * 2.2, y: Math.min(y0 + c - 1.3, y + (R() - 0.5) * 1.8), a: a0 + (R() - 0.5) * 0.9, w, s: sp.s * (0.8 + R() * 0.4), col: sp.c, b: R() * 6.283 });
    }
    for (let k = 0; k < nBig; k++) {
      const ctr = high[Math.floor(R() * high.length)], rad = 6 + R() * 7, c = Math.min(ctr.c, minC(ctr.x, ctr.z, rad)); if (c < 10) continue;
      groups[k % 3 ? 'ray' : 'shark'].push({ x: ctr.x, z: ctr.z, r: rad, y: y0 + 6.5 + R() * (c - 10), a: R() * 6.283, w: (0.045 + R() * 0.04) * (k % 2 ? 1 : -1), s: k % 3 ? 1.1 + R() * 0.7 : 1.0 + R() * 0.5, col: k % 3 ? 0x4b6078 : 0x7d8b98, b: R() * 6.283 });
    }
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3(), col = new THREE.Color();
    for (const key in groups) {
      const d = groups[key]; if (!d.length) continue;
      const im = new THREE.InstancedMesh(GEO[key], mat, d.length);
      d.forEach((f, i) => im.setColorAt(i, col.set(f.col)));
      im.frustumCulled = false; im.castShadow = true; scene.add(im);
      updaters.push((dt, t) => {
        for (let i = 0; i < d.length; i++) {
          const f = d[i], a = f.a + t * f.w;
          p.set(f.x + f.r * Math.cos(a), f.y + Math.sin(t * 0.5 + f.b) * 0.3, f.z + f.r * Math.sin(a));
          e.set(0, -a + (f.w > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.sin(t * 6 + f.b) * 0.09, 0);                    // 頭朝切線方向，尾巴小幅擺動
          m.compose(p, q.setFromEuler(e), s.setScalar(f.s)); im.setMatrixAt(i, m);
        }
        im.instanceMatrix.needsUpdate = true;
      });
    }
  }
  // 在一個長方水槽內來回游的魚（海底隧道、圓柱缸用）
  function tankFish(parent, count, place, seed) {
    const R = rng(seed), byGeo = { fish: [], tall: [], shark: [], ray: [] };
    for (let i = 0; i < count; i++) { const big = i < count * 0.06, sp = SPECIES[Math.floor(R() * SPECIES.length)], key = big ? (i % 2 ? 'ray' : 'shark') : sp.g; byGeo[key].push({ ...place(R), s: big ? 0.9 + R() * 0.4 : sp.s * (0.7 + R() * 0.5), col: big ? 0x6f7d88 : sp.c, p: R() * 6.283 }); }
    const col = new THREE.Color(), out = [];
    for (const key in byGeo) { const d = byGeo[key]; if (!d.length) continue; const im = new THREE.InstancedMesh(GEO[key], mat, d.length); d.forEach((f, i) => im.setColorAt(i, col.set(f.col))); im.frustumCulled = false; im.renderOrder = 1; parent.add(im); out.push({ im, d }); }
    return out;
  }
  return { spotsOver, schools, tankFish };
}

// ───────── 入口大廳（拱殼 C 下方） ─────────
// 西翼：圓柱水族缸＋環繞坡道＋環形夾層；主入口兩側：服務台（西）、售票處（東）；東翼：禮品店、展示櫃；
// 上方：懸吊鯨魚（放在量到淨高最高處）與十六群彩色魚、鯊魚、魟魚。
function lobby(ctx, H, kit) {
  const { THREE, scene, B, QUAY, addSolid, updaters, glowReg, rng, timeHooks, canvasTex } = ctx, probe = makeProbe(ctx);
  const R = rng(31), F = QUAY + 0.04, lights = [];
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.45, side: THREE.DoubleSide });
  const navy = new THREE.MeshStandardMaterial({ color: 0x16324a, roughness: 0.5 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb68b5a, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const waterM = glowReg(new THREE.MeshStandardMaterial({ color: 0x0c5a8c, roughness: 0.2, transparent: true, opacity: 0.55, emissive: 0x0b5f9a, depthWrite: false }), 0x0b6fb4, 0.25); waterM.userData.base = 0.4;
  const warm = glowReg(new THREE.MeshStandardMaterial({ color: 0xf3dfbd, roughness: 0.7, emissive: 0xffc98a }), 0xffc98a, 0.5); warm.userData.base = 0.35;
  const add = (g, m, p, solid = false, shadow = true, parent = scene) => { const o = new THREE.Mesh(g, m); o.position.copy(p); o.castShadow = shadow; o.receiveShadow = true; parent.add(o); if (parent === scene) { o.updateMatrixWorld(true); if (solid) addSolid(o); } else o.userData.solid = solid; return o; };
  const finish = (grp) => { scene.add(grp); grp.updateMatrixWorld(true); grp.traverse((o) => { if (o.isMesh && o.userData.solid) addSolid(o); }); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // 室內補光（暖白、不投影），亮度跟著時段調
  for (const [nm, u, v] of [['C', 0.18, 0], ['C', 0.32, 0], ['C', 0.46, 0], ['C', 0.6, 0], ['C', 0.74, 0], ['C', 0.86, 0], ['N', 0.2, 0], ['N', 0.38, 0], ['N', 0.56, 0], ['N', 0.74, 0]]) {
    const p = H.V(nm, u, v), c = probe.up(p, 2.5, 60), pl = new THREE.PointLight(0xfff0d8, 1500, 80, 2);
    pl.position.set(p.x, p.y + Math.max(5, Math.min(18, c * 0.6)), p.z); pl.userData.base = 1500; scene.add(pl); lights.push(pl);
  }
  timeHooks.push((name) => { const f = { day: 1, dusk: 0.3, night: 0.085 }[name] ?? 1; for (const l of lights) l.intensity = l.userData.base * f; });

  // 圓柱水族缸（高度依該處淨高）
  const AQ = H.V('C', 0.27, 0), aqClear = probe.up(AQ, 2.5, 60), AR = Math.min(4.6, H.half('C', 0.27) * 0.3), AH = Math.max(8, Math.min(17, aqClear - 4));
  add(new THREE.CylinderGeometry(AR + 0.5, AR + 0.7, 0.9, 48), white, AQ.clone().setY(F + 0.45), true);
  add(new THREE.CylinderGeometry(AR, AR, AH, 48, 1, true), glass, AQ.clone().setY(F + 0.9 + AH / 2), true, false).renderOrder = 3;
  add(new THREE.CylinderGeometry(AR - 0.12, AR - 0.12, AH - 0.3, 48), waterM, AQ.clone().setY(F + 0.9 + AH / 2), false, false).renderOrder = 2;
  add(new THREE.CylinderGeometry(AR + 0.6, AR + 0.4, 0.7, 48), white, AQ.clone().setY(F + 0.9 + AH + 0.35));
  const aqGrp = new THREE.Group(); aqGrp.position.set(AQ.x, F + 0.9, AQ.z); scene.add(aqGrp);
  const aqFish = kit.tankFish(aqGrp, 150, (Rr) => ({ r: 0.8 + Rr() * (AR - 1.5), h: 0.8 + Rr() * (AH - 1.6), a: Rr() * 6.283, w: (0.16 + Rr() * 0.2) * (Rr() < 0.85 ? 1 : -1) }), 61);
  // 環繞坡道（1.5 圈升 9 公尺）、玻璃護欄、環形夾層與細柱、夾層玻璃欄杆
  const RISE = Math.min(9, AH - 3), RI = AR + 0.8, RO = AR + 3.0, MZ = Math.min(11, H.half('C', 0.27) - 3), N = 120, pos = [], idx = [], wall = [], widx = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = t * 1.5 * Math.PI * 2 + Math.PI * 0.5, y = F + t * RISE, c = Math.cos(a), s = Math.sin(a);
    pos.push(AQ.x + RI * c, y, AQ.z + RI * s, AQ.x + RO * c, y, AQ.z + RO * s, AQ.x + RI * c, y - 0.35, AQ.z + RI * s, AQ.x + RO * c, y - 0.35, AQ.z + RO * s);
    wall.push(AQ.x + RO * c, y, AQ.z + RO * s, AQ.x + RO * c, y + 1.1, AQ.z + RO * s, AQ.x + RI * c, y, AQ.z + RI * s, AQ.x + RI * c, y + 1.1, AQ.z + RI * s);
    if (i < N) { const k = i * 4; idx.push(k, k + 1, k + 5, k, k + 5, k + 4, k + 2, k + 7, k + 3, k + 2, k + 6, k + 7, k + 1, k + 3, k + 7, k + 1, k + 7, k + 5, k, k + 6, k + 2, k, k + 4, k + 6); widx.push(k, k + 1, k + 5, k, k + 5, k + 4, k + 2, k + 3, k + 7, k + 2, k + 7, k + 6); }
  }
  const mk = (p, ix) => { const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(ix); g.computeVertexNormals(); return g; };
  const rampMesh = add(mk(pos, idx), white, V(0, 0, 0), true); ctx.walkables.push(rampMesh);                 // 坡道可以步行上去
  add(mk(wall, widx), glass, V(0, 0, 0), true, false).renderOrder = 3;
  if (MZ > RO + 1.5) {
    const ring = new THREE.Shape(); ring.absarc(0, 0, MZ, Math.PI * 0.15, Math.PI * 1.55, false); ring.absarc(0, 0, RO, Math.PI * 1.55, Math.PI * 0.15, true);
    const mg = new THREE.ExtrudeGeometry(ring, { depth: 0.45, bevelEnabled: false, curveSegments: 40 }); mg.rotateX(-Math.PI / 2);
    ctx.walkables.push(add(mg, white, V(AQ.x, F + RISE - 0.45, AQ.z), true));
    for (let k = 0; k < 6; k++) { const a = Math.PI * (0.2 + k * 0.26); add(new THREE.CylinderGeometry(0.22, 0.22, RISE - 0.45, 12), white, V(AQ.x + (MZ - 0.7) * Math.cos(a), F + (RISE - 0.45) / 2, AQ.z - (MZ - 0.7) * Math.sin(a)), true); }
    add(new THREE.CylinderGeometry(MZ - 0.05, MZ - 0.05, 1.1, 64, 1, true, Math.PI * 0.65, Math.PI * 1.4), glass, V(AQ.x, F + RISE + 0.55, AQ.z), true, false).renderOrder = 3;
  }
  // 服務台（主入口西側）
  const dk = new THREE.Shape(); dk.absarc(0, 0, 6.2, Math.PI * 0.1, Math.PI * 0.75, false); dk.absarc(0, 0, 5.0, Math.PI * 0.75, Math.PI * 0.1, true);
  const dg = new THREE.ExtrudeGeometry(dk, { depth: 1.1, bevelEnabled: false, curveSegments: 30 }); dg.rotateX(-Math.PI / 2);
  const desk = add(dg, white, H.V('C', 0.37, -0.42), true); desk.rotation.y = H.ang('C', 0.37); desk.updateMatrixWorld(true);
  // 售票處（主入口東側）：櫃台＋資訊螢幕牆
  const tk = new THREE.Group(); tk.position.copy(H.V('C', 0.55, -0.5)); tk.rotation.y = H.ang('C', 0.55);
  add(new THREE.BoxGeometry(9, 1.1, 1.1), white, V(0, 0.55, 0), true, true, tk);
  add(new THREE.BoxGeometry(9.6, 3.0, 0.3), white, V(0, 1.5, 1.9), true, true, tk);
  const scr = canvasTex(1024, 256, (g, w, h) => { g.fillStyle = '#0e2a40'; g.fillRect(0, 0, w, h); g.fillStyle = '#eaf6fd'; g.font = '700 84px "Microsoft JhengHei","PingFang TC",sans-serif'; g.textBaseline = 'middle'; g.fillText('售票處　Ticketing', 40, 86); g.font = '500 44px "Microsoft JhengHei","PingFang TC",sans-serif'; g.fillStyle = '#9fd0e6'; g.fillText('全票　學生票　親子票　團體票', 44, 190); }, { repeat: false });
  const scrM = glowReg(new THREE.MeshStandardMaterial({ map: scr, emissiveMap: scr, roughness: 0.4, emissive: 0xffffff }), 0xffffff, 0.25); scrM.userData.base = 0.55;
  add(new THREE.PlaneGeometry(8.4, 2.1), scrM, V(0, 1.75, 1.73), false, false, tk).rotation.y = Math.PI;
  finish(tk);
  // 禮品店（東翼南側）：拱門開口、暖光、貨架
  const shop = new THREE.Group(); shop.position.copy(H.V('C', 0.7, -0.42)); shop.rotation.y = H.ang('C', 0.7);
  const SW = 13, SH = 4.6, fr = new THREE.Shape(); fr.moveTo(-SW / 2, 0); fr.lineTo(SW / 2, 0); fr.lineTo(SW / 2, SH); fr.lineTo(-SW / 2, SH); fr.lineTo(-SW / 2, 0);
  const ah = new THREE.Path(); ah.moveTo(-3.6, 0); ah.lineTo(-3.6, 0.01); ah.absellipse(0, 0, 3.6, 3.9, Math.PI, 0, true); ah.lineTo(3.6, 0); ah.lineTo(-3.6, 0); fr.holes.push(ah);
  add(new THREE.ExtrudeGeometry(fr, { depth: 0.6, bevelEnabled: false, curveSegments: 28 }), white, V(0, 0, -0.6), true, true, shop);
  add(new THREE.BoxGeometry(SW, SH, 0.3), warm, V(0, SH / 2, 4.6), true, true, shop);
  for (const sg of [-1, 1]) add(new THREE.BoxGeometry(0.3, SH, 5.2), white, V(sg * SW / 2, SH / 2, 2), true, true, shop);
  add(new THREE.BoxGeometry(SW + 0.3, 0.3, 5.5), white, V(0, SH + 0.15, 2), false, true, shop);
  for (let k = 0; k < 3; k++) for (const x of [-4.2, 0, 4.2]) add(new THREE.BoxGeometry(3.2, 0.06, 0.5), wood, V(x, 0.9 + k * 0.75, 4.1), false, true, shop);
  const items = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 0.3, 0.22), new THREE.MeshStandardMaterial({ roughness: 0.6 }), 90), m4 = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < 90; i++) { const sh = i % 9, k = Math.floor(sh / 3), x = [-4.2, 0, 4.2][sh % 3] + (Math.floor(i / 9) - 4.5) * 0.32; m4.makeTranslation(x, 1.08 + k * 0.75, 4.1); items.setMatrixAt(i, m4); items.setColorAt(i, col.setHSL(0.52 + R() * 0.12, 0.35, 0.45 + R() * 0.3)); }
  shop.add(items);
  const sgn = canvasTex(1024, 160, (g, w, h) => { g.clearRect(0, 0, w, h); g.fillStyle = '#16324a'; let fs = 100; const tx = '禮品店　Museum Shop'; do { g.font = `700 ${fs}px "Microsoft JhengHei","PingFang TC",sans-serif`; fs -= 4; } while (g.measureText(tx).width > w - 60 && fs > 30); g.textBaseline = 'middle'; g.textAlign = 'center'; g.fillText(tx, w / 2, 84); }, { repeat: false });
  add(new THREE.PlaneGeometry(6.4, 1.0), new THREE.MeshStandardMaterial({ map: sgn, transparent: true, roughness: 0.5 }), V(0, 4.0, -0.62), false, false, shop).rotation.y = Math.PI;
  const sl = new THREE.PointLight(0xffd9a8, 260, 16, 2); sl.position.set(0, 3.6, 2.2); sl.userData.base = 260; shop.add(sl);
  timeHooks.push((name) => { sl.intensity = 260 * ({ day: 1, dusk: 0.5, night: 0.22 }[name] ?? 1); });
  finish(shop);
  // 展示櫃（東翼圍成一圈）
  const C0 = H.V('C', 0.8, 0.1), spec = new THREE.MeshStandardMaterial({ color: 0xe8c9a8, roughness: 0.35 }), er = Math.min(8.5, H.half('C', 0.8) - 4);
  for (let k = 0; k < 7; k++) {
    const a = k / 7 * Math.PI * 2 + 0.3, p = V(C0.x + Math.cos(a) * er, F, C0.z + Math.sin(a) * er * 0.72);
    add(new THREE.BoxGeometry(1.2, 0.95, 1.2), white, p.clone().setY(F + 0.475), true);
    add(new THREE.BoxGeometry(1.1, 1.0, 1.1), glass, p.clone().setY(F + 1.45), false, false).renderOrder = 3;
    const sp = add(new THREE.ConeGeometry(0.22, 0.5, 14), spec, p.clone().setY(F + 1.22)); sp.rotation.z = 1.2 + k; sp.scale.set(1, 1, 0.7);
  }
  // 指標牌
  const SIGNS = [['C', 0.49, -0.5, '售票處 →', 'Ticketing'], ['C', 0.41, -0.62, '← 服務台', 'Information'], ['C', 0.36, 0.05, '← 圓柱水族缸', 'Cylinder Aquarium'], ['C', 0.62, 0.0, '禮品店．展示區 →', 'Shop · Exhibits'], ['C', 0.53, 0.55, '海洋廳．海底隧道．水母咖啡 ↑', 'Ocean Hall · Tunnel · Café']];
  for (const [nm, u, v, zh, en] of SIGNS) {
    const t = canvasTex(512, 1024, (g, w, h) => { g.fillStyle = '#16324a'; g.fillRect(0, 0, w, h); g.fillStyle = '#00A1E9'; g.fillRect(0, 0, w, 26); g.fillStyle = '#f2f6f8'; g.textAlign = 'center'; g.textBaseline = 'middle'; let fs = 92; do { g.font = `700 ${fs}px "Microsoft JhengHei","PingFang TC",sans-serif`; fs -= 4; } while (g.measureText(zh).width > w - 50 && fs > 26); g.fillText(zh, w / 2, 250); g.fillStyle = '#b9d6e4'; fs = 44; do { g.font = `500 ${fs}px "Segoe UI",Arial,sans-serif`; fs -= 2; } while (g.measureText(en).width > w - 50 && fs > 18); g.fillText(en, w / 2, 350); }, { repeat: false });
    const face = new THREE.MeshStandardMaterial({ map: t, roughness: 0.5 });
    const s = add(new THREE.BoxGeometry(1.15, 2.5, 0.16), [navy, navy, navy, navy, face, face], H.V(nm, u, v, 1.25)); s.rotation.y = H.ang(nm, u); s.updateMatrixWorld(true); addSolid(s);
  }
  // 懸吊鯨魚：放在量到淨高最高的地方
  const floorC = scene.getObjectByName('lobby_floor_C'), spots = kit.spotsOver(floorC, F);
  const whale = new THREE.Group(), wm = new THREE.MeshStandardMaterial({ color: 0x41607a, roughness: 0.5 }), wb = new THREE.MeshStandardMaterial({ color: 0xcfd6da, roughness: 0.55 });
  const prof = []; for (let i = 0; i <= 24; i++) { const t = i / 24; prof.push(new THREE.Vector2(Math.max(0.02, 1.75 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.85) * (1 - 0.35 * t)), t * 17)); }
  const body = new THREE.Mesh(new THREE.LatheGeometry(prof, 28), wm); body.rotation.z = Math.PI / 2; body.position.x = 8.5; body.scale.set(1, 1, 0.92); whale.add(body);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), wb); belly.scale.set(5.2, 1.0, 1.45); belly.position.set(2.2, -0.75, 0); whale.add(belly);
  for (const sg of [-1, 1]) {
    const fl = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), wm); fl.scale.set(1.5, 0.12, 2.1); fl.position.set(-8.2, 0.1, sg * 1.7); fl.rotation.y = sg * 0.5; whale.add(fl);
    const fin = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 8), wm); fin.scale.set(1.0, 0.12, 2.3); fin.position.set(4.6, -1.0, sg * 2.4); fin.rotation.set(sg * 0.45, sg * -0.35, 0); whale.add(fin);
  }
  whale.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  const clearAt = (x, z) => { let m = 1e9; for (const s of spots) if (Math.abs(s.x - x) < 9 && Math.abs(s.z - z) < 4.6) m = Math.min(m, s.c); return m; };
  let best = null; for (const s of spots) { if (Math.hypot(s.x - AQ.x, s.z - AQ.z) < 18) continue; const c = clearAt(s.x, s.z); if (!best || c > best.c) best = { x: s.x, z: s.z, c }; }
  const WY = best ? Math.max(6, Math.min(best.c * 0.6, best.c - 5)) : 12;
  if (best) { whale.position.set(best.x, F + WY, best.z); if (best.c < 13) whale.scale.setScalar(Math.max(0.45, best.c / 13)); whale.rotation.y = H.ang('C', 0.5) + 0.25; scene.add(whale); }
  kit.schools(spots, F, 16, 30, 9, 404);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  updaters.push((dt, t) => {
    for (const { im, d } of aqFish) { for (let i = 0; i < d.length; i++) { const f = d[i], a = f.a + t * f.w; p.set(f.r * Math.cos(a), f.h + Math.sin(t * 0.6 + f.p) * 0.4, f.r * Math.sin(a)); e.set(0, -a + (f.w > 0 ? -Math.PI / 2 : Math.PI / 2) + Math.sin(t * 6 + f.p) * 0.12, 0); m.compose(p, q.setFromEuler(e), s.setScalar(f.s * 0.8)); im.setMatrixAt(i, m); } im.instanceMatrix.needsUpdate = true; }
    whale.position.y = F + WY + Math.sin(t * 0.35) * 0.12;
  });
}

// ───────── 海洋廳（後方大穹頂 N 下方）：海底隧道（西翼）、水母缸與咖啡座（東翼）、上方魚群 ─────────
function oceanHall(ctx, H, kit) {
  const { THREE, scene, QUAY, addSolid, updaters, glowReg, rng, timeHooks } = ctx;
  const R = rng(77), F = QUAY + 0.04;
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.45, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb68b5a, roughness: 0.6 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.6 });
  const sea = glowReg(new THREE.MeshStandardMaterial({ color: 0x0a4f86, roughness: 0.3, side: THREE.DoubleSide, emissive: 0x0a5fa8 }), 0x0a5fa8, 0.2); sea.userData.base = 0.55;
  const add = (g, m, p, solid, parent) => { const o = new THREE.Mesh(g, m); o.position.copy(p); o.castShadow = true; o.receiveShadow = true; parent.add(o); o.userData.solid = !!solid; return o; };
  const finish = (grp) => { scene.add(grp); grp.updateMatrixWorld(true); grp.traverse((o) => { if (o.isMesh && o.userData.solid) addSolid(o); }); };
  const V = (x, y, z) => new THREE.Vector3(x, y, z);
  // 海底隧道：長 34、寬 13、高 8 公尺的水槽，中間半徑 3 公尺的玻璃隧道
  const TL = 34, TW = Math.min(13, H.half('N', 0.27) * 1.2), TH = 8, TR = 3.0, tun = new THREE.Group();
  tun.position.copy(H.V('N', 0.27, 0)); tun.rotation.y = H.ang('N', 0.27);
  for (const sg of [-1, 1]) add(new THREE.BoxGeometry(TL, TH, 0.3), sea, V(0, TH / 2, sg * TW / 2), true, tun);
  add(new THREE.BoxGeometry(TL + 0.6, 0.5, TW + 0.6), white, V(0, TH + 0.25, 0), true, tun);
  const endS = new THREE.Shape(); endS.moveTo(-TW / 2, 0); endS.lineTo(TW / 2, 0); endS.lineTo(TW / 2, TH); endS.lineTo(-TW / 2, TH); endS.lineTo(-TW / 2, 0);
  const hole = new THREE.Path(); hole.moveTo(-TR, 0); hole.lineTo(-TR, 0.01); hole.absarc(0, 0, TR, Math.PI, 0, true); hole.lineTo(TR, 0); hole.lineTo(-TR, 0); endS.holes.push(hole);
  for (const sg of [-1, 1]) { const g = new THREE.ExtrudeGeometry(endS, { depth: 0.5, bevelEnabled: false, curveSegments: 24 }); g.rotateY(Math.PI / 2); add(g, white, V(sg * TL / 2 - 0.25, 0, 0), true, tun); }
  const tg = new THREE.CylinderGeometry(TR, TR, TL, 40, 1, true); tg.rotateZ(Math.PI / 2);
  const tube = add(tg, glass, V(0, 0, 0), true, tun); tube.castShadow = false; tube.renderOrder = 3;
  for (let k = -3; k <= 3; k++) { const r = add(new THREE.TorusGeometry(TR + 0.06, 0.09, 8, 40, Math.PI), white, V(k * 5, 0, 0), false, tun); r.rotation.y = Math.PI / 2; }
  const tl = new THREE.PointLight(0x7fc4ff, 500, 30, 2); tl.position.set(0, 2.2, 0); tun.add(tl);
  timeHooks.push((name) => { tl.intensity = 500 * ({ day: 1, dusk: 0.5, night: 0.22 }[name] ?? 1); });
  finish(tun);
  const swim = kit.tankFish(tun, 130, (Rr) => { const al = (0.14 + Rr() * 0.72) * Math.PI, ro = TR + 0.8 + Rr() * 2.4; return { y: Math.min(TH - 0.7, ro * Math.sin(al)), z: THREE.MathUtils.clamp(ro * Math.cos(al), -TW / 2 + 0.8, TW / 2 - 0.8), x0: Rr() * TL, v: (0.4 + Rr() * 0.9) * (Rr() < 0.5 ? 1 : -1) }; }, 88);
  // 水母缸（東翼北側）
  const jt = new THREE.Group(); jt.position.copy(H.V('N', 0.72, 0.6)); jt.rotation.y = H.ang('N', 0.72);
  const tank = glowReg(new THREE.MeshStandardMaterial({ color: 0x0b3f8f, roughness: 0.15, transparent: true, opacity: 0.86, emissive: 0x0b4fc0 }), 0x1466e0, 0.25); tank.userData.base = 0.5;
  add(new THREE.BoxGeometry(30, 0.8, 2.4), white, V(0, 0.4, 0), true, jt); add(new THREE.BoxGeometry(30, 6, 2.0), tank, V(0, 3.8, 0), true, jt).castShadow = false; add(new THREE.BoxGeometry(30.6, 0.6, 2.6), white, V(0, 7.1, 0), false, jt);
  const NJ = 70, jelly = new THREE.InstancedMesh(new THREE.SphereGeometry(0.32, 12, 6, 0, Math.PI * 2, 0, Math.PI * 0.55), new THREE.MeshStandardMaterial({ color: 0xdff1ff, emissive: 0x9fd4ff, emissiveIntensity: 1.3, transparent: true, opacity: 0.85, side: THREE.DoubleSide }), NJ);
  const jd = []; for (let i = 0; i < NJ; i++) jd.push({ x: (R() - 0.5) * 28, y: R() * 5, p: R() * 6.283, s: 0.6 + R() * 1.1, w: 0.25 + R() * 0.3 });
  jelly.frustumCulled = false; jelly.renderOrder = 4; jt.add(jelly);
  finish(jt);
  // 咖啡座（東翼中央）
  const cafe = new THREE.Group(); cafe.position.copy(H.V('N', 0.72, -0.05)); cafe.rotation.y = H.ang('N', 0.72);
  const tabs = [], chs = [];
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) { const x = i * 3.6 + (j ? 0.9 : 0), z = j * 3.4; tabs.push([x, z]); for (let k = 0; k < 3; k++) { const a = k * 2.094 + i + j; chs.push([x + Math.cos(a) * 0.95, z + Math.sin(a) * 0.95, a]); } }
  const inst = (geo, mat, list, y, f) => { const im = new THREE.InstancedMesh(geo, mat, list.length), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(); list.forEach((t, i) => { m.compose(V(t[0], y, t[1]), q.setFromEuler(e.set(0, f ? -t[2] + Math.PI / 2 : 0, 0)), V(1, 1, 1)); im.setMatrixAt(i, m); }); im.castShadow = true; im.receiveShadow = true; cafe.add(im); };
  inst(new THREE.CylinderGeometry(0.48, 0.48, 0.05, 24), white, tabs, 0.74); inst(new THREE.CylinderGeometry(0.08, 0.26, 0.72, 16), white, tabs, 0.36);
  inst(new THREE.CylinderGeometry(0.21, 0.19, 0.04, 16), wood, chs, 0.46);
  inst(new THREE.CylinderGeometry(0.02, 0.02, 0.46, 6), wood, chs.flatMap(([x, z]) => [[x + 0.15, z + 0.15], [x - 0.15, z + 0.15], [x + 0.15, z - 0.15], [x - 0.15, z - 0.15]]), 0.23);
  const backG = new THREE.TorusGeometry(0.2, 0.014, 6, 16, Math.PI); backG.translate(0, 0, -0.18); inst(backG, wood, chs, 0.48, true);
  add(new THREE.BoxGeometry(7.5, 1.1, 0.9), white, V(-1, 0.55, 7.4), true, cafe); add(new THREE.BoxGeometry(7.7, 0.05, 1.05), wood, V(-1, 1.12, 7.4), false, cafe);
  finish(cafe);
  // 上方魚群
  kit.schools(kit.spotsOver(scene.getObjectByName('lobby_floor_N'), F), F, 12, 30, 7, 909);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), s = new THREE.Vector3();
  updaters.push((dt, t) => {
    for (const { im, d } of swim) { for (let i = 0; i < d.length; i++) { const f = d[i], x = ((((f.x0 + t * f.v) % TL) + TL) % TL) - TL / 2; p.set(x, f.y + Math.sin(t * 0.5 + f.p) * 0.25, f.z); e.set(0, (f.v > 0 ? 0 : Math.PI) + Math.sin(t * 5 + f.p) * 0.1, 0); m.compose(p, q.setFromEuler(e), s.setScalar(f.s * 0.85)); im.setMatrixAt(i, m); } im.instanceMatrix.needsUpdate = true; }
    for (let i = 0; i < NJ; i++) { const j = jd[i], pulse = 1 + Math.sin(t * 6.4 * j.w + j.p) * 0.14; p.set(j.x, 1.0 + ((j.y + t * j.w * 0.35) % 5.4), -0.9 + (i % 5) * 0.15); m.compose(p, q.identity(), s.set(j.s / pulse, j.s * pulse, j.s / pulse)); jelly.setMatrixAt(i, m); }
    jelly.instanceMatrix.needsUpdate = true;
  });
}

// ───────── 各層展廳：沿每層玻璃與室內牆之間的中線，擺展示櫃、展板與長椅 ─────────
function galleries({ THREE, scene, B, glowReg, rng, canvasTex, timeHooks }, L) {
  const R = rng(1234), cases = [], panels = [[], [], [], []], benches = [];
  for (const g of L.galleries) for (const side of [g.left, g.right]) for (let i = 1; i < side.length - 1; i++) {
    const a = side[i - 1], b = side[i + 1], p = side[i], ang = Math.atan2(b[1] - a[1], b[0] - a[0]), k = (i + g.floor) % 3;
    const item = { p: B(p[0], p[1], g.z), ang };
    if (k === 0) cases.push(item); else if (k === 1) panels[Math.floor(R() * 4)].push(item); else if (i % 2) benches.push(item);
  }
  const white = new THREE.MeshStandardMaterial({ color: 0xf0eee9, roughness: 0.5 }), glass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.03, metalness: 0.9, transparent: true, opacity: 0.2, depthWrite: false, envMapIntensity: 1.6 });
  const wood = new THREE.MeshStandardMaterial({ color: 0xb68b5a, roughness: 0.6 }), obj = new THREE.MeshStandardMaterial({ roughness: 0.4 });
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), col = new THREE.Color();
  const inst = (geo, mat, list, dy, f) => { if (!list.length) return null; const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((t, i) => { m.compose(v.copy(t.p).setY(t.p.y + dy), q.setFromEuler(e.set(0, t.ang, 0)), s); im.setMatrixAt(i, m); if (f) im.setColorAt(i, f(i)); }); im.receiveShadow = true; im.frustumCulled = false; scene.add(im); return im; };
  inst(new THREE.BoxGeometry(1.2, 0.95, 1.2), white, cases, 0.475);
  const gb = inst(new THREE.BoxGeometry(1.1, 1.0, 1.1), glass, cases, 1.45); if (gb) gb.renderOrder = 3;
  inst(new THREE.DodecahedronGeometry(0.28, 0), obj, cases, 1.3, () => col.setHSL(0.08 + R() * 0.5, 0.45, 0.55));
  inst(new THREE.BoxGeometry(2.6, 0.45, 0.6), wood, benches, 0.225);
  const TITLES = [['珊瑚礁生態', '#0e5a7a', '#f2c12e'], ['深海探索', '#12233f', '#3fb7a6'], ['洄游的魚', '#1c4a6a', '#f07a2a'], ['港灣與船', '#2a3d52', '#c7d3dd']];
  TITLES.forEach(([title, bg, fg], k) => {
    const t = canvasTex(512, 320, (g, w, h) => { g.fillStyle = bg; g.fillRect(0, 0, w, h); g.fillStyle = fg; for (let i = 0; i < 26; i++) { g.globalAlpha = 0.25 + R() * 0.5; g.beginPath(); g.ellipse(R() * w, 90 + R() * (h - 110), 14 + R() * 40, 6 + R() * 16, R() * 3, 0, 6.283); g.fill(); } g.globalAlpha = 1; g.fillStyle = '#f4f7f9'; g.font = '700 54px "Microsoft JhengHei","PingFang TC",sans-serif'; g.textBaseline = 'middle'; g.fillText(title, 26, 48); }, { repeat: false });
    const pm = glowReg(new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, roughness: 0.6 }), 0xffffff, 0.2); pm.userData.base = 0.25;
    inst(new THREE.BoxGeometry(2.4, 1.5, 0.08), [white, white, white, white, pm, pm], panels[k], 1.55);
    inst(new THREE.BoxGeometry(0.1, 0.8, 0.5), white, panels[k], 0.4);
  });
  // 各棟展廳的室內燈：每片殼下的量體放一到兩盞暖白燈（不投影），亮度跟著時段調
  const byShell = {}; for (const g of L.galleries) (byShell[g.shell] ||= []).push(g);
  const lamps = [];
  for (const name in byShell) {
    const gs = byShell[name], top = Math.max(...gs.map((g) => g.floor));
    for (const fl of [Math.min(1, top)]) {
      const pts = gs.filter((g) => g.floor === fl).flatMap((g) => [...g.left, ...g.right]); if (!pts.length) continue;
      const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length, z = gs.find((g) => g.floor === fl).z;
      const pl = new THREE.PointLight(0xfff0d8, 1000, 70, 2); pl.position.copy(B(cx, cy, z + 2.6)); scene.add(pl); lamps.push(pl);
    }
  }
  timeHooks.push((name) => { const f = { day: 1, dusk: 0.35, night: 0.12 }[name] ?? 1; for (const l of lamps) l.intensity = 1000 * f; });
  console.info(`各層展廳：展示櫃 ${cases.length}、展板 ${panels.reduce((a, b) => a + b.length, 0)}、長椅 ${benches.length}、室內燈 ${lamps.length}`);
}

// ───────── 人物：橘色透明的 3D 量體，手腳擺動行走；路線逐點檢查後只留合格區段 ─────────
function people(ctx, L, H) {
  const { THREE, scene, B, QUAY, updaters, rng } = ctx, probe = makeProbe(ctx);
  const R = rng(4242);
  const mat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, roughness: 0.35, metalness: 0.0, transparent: true, opacity: 0.6, emissive: 0xff5a00, emissiveIntensity: 0.22, depthWrite: false });
  const cap = (r, l, ty) => { const g = new THREE.CapsuleGeometry(r, l, 4, 10); g.translate(0, ty, 0); return g; };
  const G = { torso: cap(0.165, 0.36, 1.2), head: new THREE.SphereGeometry(0.118, 14, 10).translate(0, 1.63, 0), leg: cap(0.078, 0.74, -0.44), arm: cap(0.055, 0.5, -0.3) };
  const D = L.doors, rp = L.site.ramps.map((r) => r.c), hp = (n, u, v) => H.pt(n, u, v);
  const inward = (d, n, u, k) => { const c = hp(n, u, 0); return [d[0] + (c[0] - d[0]) * k, d[1] + (c[1] - d[1]) * k]; };
  const tc = hp('N', 0.27, 0), ta = H.ang('N', 0.27), tdir = [Math.cos(ta), Math.sin(ta)];
  const PATHS = [                                              // [路線點, 人數]
    [[[-205, -170], [205, -170]], 6], [[[205, -178], [-205, -178]], 6], [[[-205, -147], [-100, -147]], 3], [[[10, -147], [205, -147]], 4],
    [[...rp[1], inward(D.C_south, 'C', 0.43, -0.5), D.C_south, inward(D.C_south, 'C', 0.43, 0.35), hp('C', 0.36, -0.1), hp('C', 0.3, -0.6), hp('C', 0.18, 0), hp('C', 0.3, 0.6), hp('C', 0.42, 0.35)], 9],
    [[...rp[0], [-34, -52], inward(D.C_south, 'C', 0.43, -0.9)], 5], [[...rp[2], [-8, -50], inward(D.C_south, 'C', 0.43, -0.8)], 5],
    [[inward(D.C_south, 'C', 0.43, 0.4), hp('C', 0.52, -0.1), hp('C', 0.62, 0.2), hp('C', 0.74, -0.1), hp('C', 0.86, 0.1)], 6],
    [[hp('C', 0.5, 0.2), inward(D.C_north, 'C', 0.55, 0.3), D.C_north, D.N_south, inward(D.N_south, 'N', 0.5, 0.4), hp('N', 0.6, -0.2), hp('N', 0.72, -0.5), hp('N', 0.86, 0)], 8],
    [[hp('N', 0.5, -0.2), [tc[0] + tdir[0] * 20, tc[1] + tdir[1] * 20], [tc[0] - tdir[0] * 20, tc[1] - tdir[1] * 20], hp('N', 0.1, 0)], 6],
    [[hp('N', 0.5, 0.1), inward(D.N_north, 'N', 0.5, 0.3), D.N_north, [D.N_north[0], 140]], 4],
    [[[141, -130], [141, 280]], 5], [[[151, 270], [151, -120]], 5], [[[-134, 140], [118, 140]], 5], [[[-135, -52], [-135, 130]], 4], [[[126, 80], [150, 80]], 2],
  ];
  const paths = [];
  PATHS.forEach(([pts, cnt], k) => {
    const raw = pts.map(([x, y]) => B(x, y, QUAY)), samp = [];
    for (let i = 1; i < raw.length; i++) { const n = Math.max(1, Math.ceil(raw[i].distanceTo(raw[i - 1]) / 1.5)); for (let j = (i === 1 ? 0 : 1); j <= n; j++) samp.push(raw[i - 1].clone().lerp(raw[i], j / n)); }
    const ok = samp.map((p) => { const g = probe.ground(p.x, p.z, QUAY + 2.5); if (g === null) return false; p.y = g; return probe.clearUp(p, 0.3, 2.2); });
    for (let i = 1; i < samp.length; i++) if (ok[i] && ok[i - 1] && !probe.clearBetween(samp[i - 1], samp[i], 1.0)) ok[i] = false;
    let best = [0, -1], s0 = -1;
    for (let i = 0; i <= samp.length; i++) { if (i < samp.length && ok[i]) { if (s0 < 0) s0 = i; } else if (s0 >= 0) { if (i - 1 - s0 > best[1] - best[0]) best = [s0, i - 1]; s0 = -1; } }
    const v = samp.slice(best[0], best[1] + 1);
    if (v.length < 6) { console.warn('人行路線', k, '合格區段太短，不放人'); return; }
    if (v.length < samp.length) console.info('人行路線', k, `合格 ${v.length}／${samp.length} 點`);
    const seg = [0]; for (let i = 1; i < v.length; i++) seg.push(seg[i - 1] + v[i].distanceTo(v[i - 1]));
    paths.push({ v, seg, L: seg[seg.length - 1], n: cnt });
  });
  const W = [];
  for (const P of paths) for (let i = 0; i < P.n; i++) { const child = R() < 0.14; W.push({ P, s: R() * P.L * 2, sp: (child ? 0.55 : 0.7) + R() * 0.45, lat: (R() - 0.5) * 1.8, h: child ? 0.68 + R() * 0.1 : 0.92 + R() * 0.16, ph: R() * 6.28 }); }
  const n = W.length; if (!n) return;
  const mk = (g) => { const im = new THREE.InstancedMesh(g, mat, n); im.castShadow = true; im.frustumCulled = false; im.renderOrder = 5; scene.add(im); return im; };
  const I = { torso: mk(G.torso), head: mk(G.head), legL: mk(G.leg), legR: mk(G.leg), armL: mk(G.arm), armR: mk(G.arm) };
  const root = new THREE.Matrix4(), part = new THREE.Matrix4(), tmp = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), pos = new THREE.Vector3(), lp = new THREE.Vector3(), dir = new THREE.Vector3(), nrm = new THREE.Vector3(), sc = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const limb = (im, i, x, y, ang) => { part.compose(lp.set(x, y, 0), q.setFromEuler(e.set(ang, 0, 0)), ONE); tmp.multiplyMatrices(root, part); im.setMatrixAt(i, tmp); };
  updaters.push((dt) => {
    for (let i = 0; i < n; i++) {
      const w = W[i], P = w.P;
      w.s = (w.s + w.sp * dt) % (P.L * 2);
      const back = w.s > P.L, s = back ? P.L * 2 - w.s : w.s;
      let k = 1; while (k < P.seg.length - 1 && P.seg[k] < s) k++;
      const t = (s - P.seg[k - 1]) / Math.max(1e-6, P.seg[k] - P.seg[k - 1]);
      pos.lerpVectors(P.v[k - 1], P.v[k], t); dir.subVectors(P.v[k], P.v[k - 1]); dir.y = 0; dir.normalize(); if (back) dir.negate();
      nrm.set(-dir.z, 0, dir.x);
      const cyc = w.s * (Math.PI / 0.72) / w.h + w.ph, sw = Math.sin(cyc);
      pos.addScaledVector(nrm, w.lat * Math.min(1, s / 3, (P.L - s) / 3)); pos.y += Math.abs(Math.cos(cyc)) * 0.035 * w.h;
      root.compose(pos, q.setFromEuler(e.set(0, Math.atan2(dir.x, dir.z), 0)), sc.setScalar(w.h));
      I.torso.setMatrixAt(i, root); I.head.setMatrixAt(i, root);
      limb(I.legL, i, 0.095, 0.92, sw * 0.52); limb(I.legR, i, -0.095, 0.92, -sw * 0.52);
      limb(I.armL, i, 0.235, 1.44, -sw * 0.42); limb(I.armR, i, -0.235, 1.44, sw * 0.42);
    }
    for (const k in I) I[k].instanceMatrix.needsUpdate = true;
  });
  console.info(`人物：${n} 位，路線 ${paths.length}／${PATHS.length} 條`);
}

// ───────── 船舶：兩艘停泊、一艘貨櫃船遠處慢行、拖船在港內慢速巡航 ─────────
async function ships({ THREE, scene, B, updaters, glowReg }) {
  const g = await new GLTFLoader().loadAsync('./assets/ships/ships.glb');
  const winMats = new Set();
  g.scene.traverse((o) => { if (!o.isMesh) return; o.castShadow = true; o.receiveShadow = true; for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.name === 'ship_window') winMats.add(m); });
  winMats.forEach((m) => glowReg(m, 0xffd9a0, 1.6));
  const get = (name) => g.scene.getObjectByName(name);
  const place = (src, x, y, headDeg) => { const grp = new THREE.Group(); grp.add(src.clone()); grp.children[0].position.set(0, 0, 0); grp.position.copy(B(x, y, 0)); grp.rotation.y = THREE.MathUtils.degToRad(headDeg); scene.add(grp); return grp; };
  const cont = get('ship_container'), bulk = get('ship_bulk'), tug = get('ship_tug'), list = [];
  if (bulk) list.push({ g: place(bulk, -153, 40, 90), ph: 0.5 });           // 靠泊主碼頭西側（對照原圖左側的船）
  if (cont) list.push({ g: place(cont, -440, 213, 0), ph: 1.7 });           // 靠泊西北貨運碼頭
  const far = cont ? { g: place(cont, -900, -700, 62), s: 0 } : null;
  const tg = tug ? { g: place(tug, -330, -40, 0), a: 0 } : null;
  updaters.push((dt, t) => {
    for (const s of list) { s.g.position.y = Math.sin(t * 0.5 + s.ph) * 0.06; s.g.rotation.z = Math.sin(t * 0.37 + s.ph) * 0.004; }
    if (far) { far.s = (far.s + dt * 3) % 2600; const d = B(Math.cos(62 * Math.PI / 180), Math.sin(62 * Math.PI / 180), 0); far.g.position.copy(B(-1500, -1500, 0)).addScaledVector(d, far.s); far.g.position.y = Math.sin(t * 0.4) * 0.08; }
    if (tg) { tg.a += dt * 2.2 / 110; const x = -345 + Math.cos(tg.a) * 120, y = -30 + Math.sin(tg.a) * 78, tx = -Math.sin(tg.a) * 120, ty = Math.cos(tg.a) * 78; tg.g.position.copy(B(x, y, 0)); tg.g.position.y = Math.sin(t * 0.9) * 0.07; tg.g.rotation.y = Math.atan2(ty, tx); tg.g.rotation.z = Math.sin(t * 0.8) * 0.012; }
  });
}
