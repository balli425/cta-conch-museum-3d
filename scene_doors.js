// 築匠海洋館 3D 瀏覽：門框與門扇
// 建築師審閱意見（2026-11-16）：門的地方要看起來有門扇，只有開口很怪。
// 大廳四處門：門框、上方橫玻璃、兩側固定玻璃、中央雙開玻璃門（向室內打開約 62 度，中間仍可通行）。
// 各層展廳的門：門框＋雙開玻璃門。位置與方向都由 layout.json 的門位換算。
export function init({ THREE, scene, B, QUAY, addSolid, layout: L }) {
  const frame = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.4, metalness: 0.75 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xa9d4e4, roughness: 0.03, metalness: 0.85, transparent: true, opacity: 0.26, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.7 });
  const leafGlass = new THREE.MeshStandardMaterial({ color: 0x8fc3d6, roughness: 0.04, metalness: 0.85, transparent: true, opacity: 0.45, side: THREE.DoubleSide, depthWrite: false, envMapIntensity: 1.8 });   // 門扇的玻璃稍微不透明一點，才看得出門
  const OPEN = THREE.MathUtils.degToRad(62);
  const leafGeo = (w, h, sg) => { const g = new THREE.BoxGeometry(w, h, 0.05); g.translate(sg * w / 2, h / 2, 0); return g; };
  const barGeo = (w, sg) => { const g = new THREE.BoxGeometry(0.05, 1.0, 0.09); g.translate(sg * (w - 0.12), 1.15, 0); return g; };
  // 由門位與「室內方向」求門的朝向：local x 沿牆、local z 的 s 側朝室內
  const pose = (door, inside) => {
    const ix = inside[0] - door[0], iy = inside[1] - door[1], n = Math.hypot(ix, iy) || 1, tx = -iy / n, ty = ix / n, th = Math.atan2(ty, tx);
    return { th, s: Math.sign((ix / n) * Math.sin(th) + (iy / n) * -Math.cos(th)) || 1 };
  };

  // ── 大廳的四處門 ──
  const nearC = (name, d) => L.halls[name].reduce((a, b) => (Math.hypot(b.c[0] - d[0], b.c[1] - d[1]) < Math.hypot(a.c[0] - d[0], a.c[1] - d[1]) ? b : a)).c;
  for (const [key, hall, hw] of [['C_south', 'C', 4.5], ['C_north', 'C', 3.5], ['N_south', 'N', 3.5], ['N_north', 'N', 3.5]]) {
    const d = L.doors[key]; if (!d) continue;
    const { th, s } = pose(d, nearC(hall, d)), g = new THREE.Group();
    g.position.copy(B(d[0], d[1], QUAY + 0.04)); g.rotation.y = th;
    const add = (geo, m, x, y, z = 0, solid = false) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = m === frame; o.receiveShadow = true; o.userData.solid = solid; if (m === glass) o.renderOrder = 3; g.add(o); return o; };
    const HD = 2.75, HT = 4.36, DW = 1.25;                    // 門楣高、開口高、單扇門寬
    for (const sg of [-1, 1]) {
      add(new THREE.BoxGeometry(0.2, HT, 0.26), frame, sg * hw, HT / 2);                             // 邊框
      add(new THREE.BoxGeometry(0.12, HD, 0.2), frame, sg * DW, HD / 2);                             // 門旁立框
      add(new THREE.BoxGeometry(hw - DW - 0.16, HD - 0.1, 0.05), glass, sg * (hw + DW) / 2, (HD - 0.1) / 2, 0, true);   // 固定玻璃（不能穿過）
      const LW = DW - 0.04, LH = HD - 0.12, leaf = add(leafGeo(LW, LH, -sg), leafGlass, sg * DW, 0.02); leaf.rotation.y = sg * s * OPEN;        // 門扇，向室內打開
      for (const [w, h, x, y] of [[LW, 0.09, -sg * LW / 2, LH - 0.045], [LW, 0.12, -sg * LW / 2, 0.06], [0.08, LH, -sg * (LW - 0.04), LH / 2], [0.08, LH, -sg * 0.04, LH / 2]]) {   // 門扇的上下橫料與兩側直料
        const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.07), frame); o.position.set(x, y, 0); o.castShadow = true; leaf.add(o);
      }
      const bar = add(barGeo(DW - 0.04, -sg), frame, sg * DW, 0.02); bar.rotation.y = sg * s * OPEN;                      // 門把
    }
    add(new THREE.BoxGeometry(hw * 2, 0.16, 0.24), frame, 0, HD);                                    // 門楣
    add(new THREE.BoxGeometry(hw * 2 - 0.2, HT - HD - 0.12, 0.05), glass, 0, (HT + HD) / 2 + 0.02, 0, true);            // 上方橫玻璃
    scene.add(g); g.updateMatrixWorld(true);
    g.traverse((o) => { if (o.isMesh && o.userData.solid) addSolid(o); });
  }

  // ── 各層展廳的門（實例化） ──
  const seen = new Set(), doors = [];
  const byFloor = {};
  for (const gal of L.galleries) (byFloor[gal.shell + '_' + gal.floor] ||= []).push(gal);
  for (const key in byFloor) {
    const gs = byFloor[key], pts = gs.flatMap((gal) => [...gal.left, ...gal.right]);
    for (const d of gs[0].doors || []) {
      const k = key + '_' + d[0] + '_' + d[1]; if (seen.has(k)) continue; seen.add(k);
      let best = null, bd = 1e9; for (const p of pts) { const q = Math.hypot(p[0] - d[0], p[1] - d[1]); if (q < bd) { bd = q; best = p; } }
      if (!best || bd > 12) continue;                                                                // 找不到對應的展廳中線就不裝
      doors.push({ d, z: gs[0].z, ...pose(d, best) });
    }
  }
  const GW = 1.4, GH = 2.56, mats = { post: [], head: [], leafL: [], leafR: [], barL: [], barR: [] };
  const m = new THREE.Matrix4(), root = new THREE.Matrix4(), part = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), v = new THREE.Vector3(), ONE = new THREE.Vector3(1, 1, 1);
  const put = (list, x, y, ry) => { part.compose(v.set(x, y, 0), q.setFromEuler(e.set(0, ry, 0)), ONE); list.push(m.multiplyMatrices(root, part).clone()); };
  for (const dr of doors) {
    root.compose(B(dr.d[0], dr.d[1], dr.z), q.setFromEuler(e.set(0, dr.th, 0)), ONE);
    put(mats.post, -GW, GH / 2, 0); put(mats.post, GW, GH / 2, 0); put(mats.head, 0, GH, 0);
    put(mats.leafL, -GW, 0.02, -dr.s * OPEN); put(mats.barL, -GW, 0.02, -dr.s * OPEN);
    put(mats.leafR, GW, 0.02, dr.s * OPEN); put(mats.barR, GW, 0.02, dr.s * OPEN);
  }
  const inst = (geo, mat, list) => { if (!list.length) return; const im = new THREE.InstancedMesh(geo, mat, list.length); list.forEach((x, i) => im.setMatrixAt(i, x)); im.frustumCulled = false; if (mat === glass || mat === leafGlass) im.renderOrder = 3; scene.add(im); };
  inst(new THREE.BoxGeometry(0.12, GH, 0.2), frame, mats.post);
  inst(new THREE.BoxGeometry(GW * 2 + 0.12, 0.12, 0.2), frame, mats.head);
  inst(leafGeo(GW - 0.03, GH - 0.1, 1), leafGlass, mats.leafL); inst(leafGeo(GW - 0.03, GH - 0.1, -1), leafGlass, mats.leafR);
  inst(barGeo(GW - 0.03, 1), frame, mats.barL); inst(barGeo(GW - 0.03, -1), frame, mats.barR);
  console.info(`門：大廳 4 處、展廳 ${doors.length} 處`);
  return { hall: 4, gallery: doors.length };
}
