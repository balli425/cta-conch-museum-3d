// 海螺館 3D 瀏覽：動態物件（人物立牌、船舶、植栽）
// 各項素材缺檔時只略過該項，不影響主場景
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function init(ctx) {
  const r = await Promise.allSettled([people(ctx), ships(ctx), plants(ctx)]);
  r.forEach((x, i) => { if (x.status === 'rejected') console.warn(['人物', '船舶', '植栽'][i] + '未載入：', x.reason); });
}

// ───────── 人物：永遠面向鏡頭的去背立牌 ─────────
async function people({ THREE, scene, camera, B, QUAY, updaters, rng, canvasTex }) {
  const info = await (await fetch('./assets/people/people_atlas.json')).json();
  const tex = await new THREE.TextureLoader().loadAsync('./assets/people/' + info.image);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, roughness: 1, metalness: 0, side: THREE.DoubleSide });
  const AW = info.atlasWidth, AH = info.atlasHeight, CW = info.cellWidth, CH = info.cellHeight;
  const geos = info.people.map((p) => {
    const h = p.heightM / p.fillH, w = h * CW / CH;
    const g = new THREE.PlaneGeometry(w, h); g.translate(0, h / 2, 0);
    const u0 = p.col * CW / AW, u1 = (p.col + 1) * CW / AW, v1 = 1 - p.row * CH / AH, v0 = 1 - (p.row + 1) * CH / AH;
    g.attributes.uv.array.set([u0, v1, u1, v1, u0, v0, u1, v0]);
    g.attributes.normal.array.set([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);       // 法線朝上：受光不隨鏡頭轉動而變
    return g;
  });
  const side = info.people.filter((p) => p.facing === 'left' || p.facing === 'right');
  const still = info.people.filter((p) => p.facing === 'front' || p.facing === 'back');
  const R = rng(4242);

  // 行走路線（Blender 平面座標，來回走）
  const PATHS = [
    [[-205, -161], [205, -161]], [[205, -170], [-205, -170]],
    [[-10.4, -142], [-1.35, -50], [-7, -31]], [[-63.7, -142], [-27.4, -50], [-15, -36]],
    [[-42, -46], [-25, -40], [-6, -43], [6, -50], [-4, -54], [-31, -53], [-42, -46]],
    [[190, -120], [190, 262]], [[196, 250], [196, -110]],
    [[-104, 104], [104, 104]], [[124, 30], [170, 30]], [[-120, -44], [-60, -50]],
  ];
  const paths = PATHS.map((pts) => {
    const v = pts.map(([x, y]) => B(x, y, QUAY)), seg = [0];
    for (let i = 1; i < v.length; i++) seg.push(seg[i - 1] + v[i].distanceTo(v[i - 1]));
    return { v, seg, L: seg[seg.length - 1] };
  });
  const at = (P, s, out) => {
    let i = 1; while (i < P.seg.length - 1 && P.seg[i] < s) i++;
    const t = (s - P.seg[i - 1]) / (P.seg[i] - P.seg[i - 1]);
    out.pos.lerpVectors(P.v[i - 1], P.v[i], t); out.dir.subVectors(P.v[i], P.v[i - 1]).normalize();
  };
  const walkers = [];
  const COUNT = [5, 5, 4, 4, 4, 3, 3, 3, 2, 2];
  paths.forEach((P, k) => {
    for (let i = 0; i < COUNT[k]; i++) {
      const p = side[Math.floor(R() * side.length)];
      const m = new THREE.Mesh(geos[p.id], mat); scene.add(m);
      walkers.push({ m, p, P, s: R() * P.L * 2, sp: 0.45 + R() * 0.45, lat: (R() - 0.5) * 3.2, ph: R() * 6.28 });
    }
  });
  // 停留的人（正面、背面立牌）：三三兩兩站著
  const SPOTS = [[-17, -57.5], [-12, -58], [-5, -44], [-30, -44], [-36, -50], [-2, -36], [-20, -34], [40, -150], [-100, -150], [120, -150],
    [-150, -150], [182, 20], [182, 120], [-60, 106], [50, 106], [128, 36], [-118, -50], [-80, -150], [10, -150], [-190, -165]];
  const standers = [];
  SPOTS.forEach(([x, y]) => {
    const n = 1 + Math.floor(R() * 3);
    for (let i = 0; i < n; i++) {
      const p = still[Math.floor(R() * still.length)];
      const m = new THREE.Mesh(geos[p.id], mat); m.position.copy(B(x + (R() - 0.5) * 2.4, y + (R() - 0.5) * 2.4, QUAY)); scene.add(m);
      standers.push({ m, ph: R() * 6.28 });
    }
  });
  // 腳下的柔和陰影
  const blobTex = canvasTex(64, 64, (g) => { const q = g.createRadialGradient(32, 32, 0, 32, 32, 32); q.addColorStop(0, 'rgba(0,0,0,.42)'); q.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = q; g.fillRect(0, 0, 64, 64); }, { repeat: false });
  const bg = new THREE.PlaneGeometry(1.1, 0.7); bg.rotateX(-Math.PI / 2);
  const all = walkers.length + standers.length;
  const blobs = new THREE.InstancedMesh(bg, new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }), all);
  blobs.renderOrder = 1; blobs.frustumCulled = false; scene.add(blobs);
  const M4 = new THREE.Matrix4(), tmp = { pos: new THREE.Vector3(), dir: new THREE.Vector3() }, rightV = new THREE.Vector3(), nrm = new THREE.Vector3();
  standers.forEach((s, i) => { M4.makeTranslation(s.m.position.x, s.m.position.y + 0.04, s.m.position.z); blobs.setMatrixAt(walkers.length + i, M4); });
  updaters.push((dt, t) => {
    rightV.setFromMatrixColumn(camera.matrixWorld, 0);
    walkers.forEach((w, i) => {
      w.s = (w.s + w.sp * dt) % (w.P.L * 2);
      const back = w.s > w.P.L, s = back ? w.P.L * 2 - w.s : w.s;
      at(w.P, s, tmp); if (back) tmp.dir.negate();
      nrm.set(-tmp.dir.z, 0, tmp.dir.x);
      w.m.position.copy(tmp.pos).addScaledVector(nrm, w.lat);
      w.m.position.y += Math.abs(Math.sin(t * 5.2 * w.sp / 0.7 + w.ph)) * 0.03;
      w.m.rotation.y = Math.atan2(camera.position.x - w.m.position.x, camera.position.z - w.m.position.z);
      const sx = tmp.dir.dot(rightV);                                           // 依畫面上的行進方向左右翻轉
      w.m.scale.x = ((sx >= 0) === (w.p.facing === 'right')) ? 1 : -1;
      M4.makeTranslation(w.m.position.x, tmp.pos.y + 0.04, w.m.position.z); blobs.setMatrixAt(i, M4);
    });
    standers.forEach((s) => { s.m.rotation.y = Math.atan2(camera.position.x - s.m.position.x, camera.position.z - s.m.position.z); });
    blobs.instanceMatrix.needsUpdate = true;
  });
}

// ───────── 船舶：兩艘停泊、一艘貨櫃船遠處慢行、拖船在港內慢速巡航 ─────────
async function ships({ THREE, scene, B, updaters, glowReg, timeHooks }) {
  const g = await new GLTFLoader().loadAsync('./assets/ships/ships.glb');
  const winMats = new Set();
  g.scene.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true; o.receiveShadow = true;
    for (const m of (Array.isArray(o.material) ? o.material : [o.material])) if (m.name === 'ship_window') winMats.add(m);
  });
  winMats.forEach((m) => glowReg(m, 0xffd9a0, 1.6));
  const get = (name) => g.scene.getObjectByName(name);
  const place = (src, x, y, headDeg) => {                   // headDeg：船首方位，0＝朝東、90＝朝北
    const grp = new THREE.Group(); grp.add(src.clone()); grp.children[0].position.set(0, 0, 0);
    grp.position.copy(B(x, y, 0)); grp.rotation.y = THREE.MathUtils.degToRad(headDeg); scene.add(grp); return grp;
  };
  const cont = get('ship_container'), bulk = get('ship_bulk'), tug = get('ship_tug');
  const list = [];
  if (bulk) list.push({ g: place(bulk, -143, 30, 90), ph: 0.5 });           // 靠泊主碼頭西側
  if (cont) list.push({ g: place(cont, -440, 213, 0), ph: 1.7 });           // 靠泊西北貨運碼頭
  let far = null, tg = null;
  if (cont) far = { g: place(cont, -900, -700, 62), ph: 3.1, s: 0 };        // 遠處慢行
  if (tug) tg = { g: place(tug, -330, -40, 0), ph: 2.2, a: 0 };
  updaters.push((dt, t) => {
    for (const s of list) { s.g.position.y = Math.sin(t * 0.5 + s.ph) * 0.06; s.g.rotation.z = Math.sin(t * 0.37 + s.ph) * 0.004; }
    if (far) {                                              // 每秒 3 公尺，沿西側外海由南往北，走完回到起點
      far.s = (far.s + dt * 3) % 2600;
      const d = B(Math.cos(62 * Math.PI / 180), Math.sin(62 * Math.PI / 180), 0);
      far.g.position.copy(B(-1500, -1500, 0)).addScaledVector(d, far.s); far.g.position.y = Math.sin(t * 0.4) * 0.08;
    }
    if (tg) {                                               // 拖船繞港內橢圓航線，約每秒 2.2 公尺
      tg.a += dt * 2.2 / 110;
      const x = -335 + Math.cos(tg.a) * 130, y = -30 + Math.sin(tg.a) * 78;
      const tx = -Math.sin(tg.a) * 130, ty = Math.cos(tg.a) * 78;
      tg.g.position.copy(B(x, y, 0)); tg.g.position.y = Math.sin(t * 0.9) * 0.07;
      tg.g.rotation.y = Math.atan2(ty, tx); tg.g.rotation.z = Math.sin(t * 0.8) * 0.012;
    }
  });
}

// ───────── 植栽：喬木與灌木（實例化） ─────────
async function plants({ THREE, scene, B, QUAY, rng }) {
  const loader = new GLTFLoader();
  const load = async (file) => { try { return (await loader.loadAsync('./assets/plants/' + file)).scene; } catch (_) { return null; } };
  const [ta, tb, sa, sb] = await Promise.all([load('tree_a.glb'), load('tree_b.glb'), load('shrub_a.glb'), load('shrub_b.glb')]);
  const R = rng(777);
  const scatter = (src, pts, smin, smax) => {
    if (!src || !pts.length) return;
    src.updateMatrixWorld(true);
    const T = pts.map((p) => new THREE.Matrix4().compose(p, new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), R() * 6.283), new THREE.Vector3().setScalar(smin + R() * (smax - smin))));
    src.traverse((o) => {
      if (!o.isMesh) return;
      const m = o.material; let depth = null;
      if (m.transparent || m.alphaTest > 0 || m.alphaMap) {                    // 葉片：改用鏤空（不排序、可投影）
        m.transparent = false; m.alphaTest = 0.14; m.alphaToCoverage = true; m.side = THREE.DoubleSide; m.depthWrite = true;   // 門檻低＋覆蓋率抗鋸齒：遠看葉子才不會消失
        depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map: m.map, alphaTest: 0.14, side: THREE.DoubleSide });
      }
      m.envMapIntensity = 0.7;
      const im = new THREE.InstancedMesh(o.geometry, m, T.length), mm = new THREE.Matrix4();
      T.forEach((t, i) => { mm.multiplyMatrices(t, o.matrixWorld); im.setMatrixAt(i, mm); });
      im.castShadow = true; im.receiveShadow = true; if (depth) im.customDepthMaterial = depth;
      im.frustumCulled = false; scene.add(im);
    });
  };
  const nearBridge = (x) => Math.abs(x + 63.7) < 9 || Math.abs(x + 10.4) < 8;
  const A = [], Bq = [], S = [];
  for (let x = -214; x <= 214; x += 15) if (!nearBridge(x)) A.push(B(x, -147, QUAY));
  for (let x = -206; x <= 206; x += 17) Bq.push(B(x, -181, QUAY));
  for (let y = -118; y <= 276; y += 17) Bq.push(B(186, y, QUAY));
  for (let y = -110; y <= 270; y += 19) A.push(B(214, y, QUAY));
  for (let x = -112; x <= 108; x += 20) if (x < -12 || x > 40) A.push(B(x, 108, QUAY));
  [[-47, -51], [-55, -47], [13, -52], [150, 24], [150, 40]].forEach(([x, y]) => Bq.push(B(x, y, QUAY)));
  for (let x = -21; x <= -7; x += 1.6) S.push(B(x, -48.6, QUAY + 0.35));
  for (let x = -200; x <= 200; x += 7.5) if (!nearBridge(x)) S.push(B(x + 3.7, -134.5, QUAY));
  for (let y = -100; y <= 260; y += 8) S.push(B(174.5, y, QUAY));
  scatter(ta, A, 0.85, 1.15); scatter(tb || ta, Bq, 0.85, 1.2);
  scatter(sa, S.filter((_, i) => i % 2 === 0 || !sb), 0.8, 1.25); scatter(sb, S.filter((_, i) => i % 2 === 1), 0.8, 1.25);
}
