// 築匠海洋館 3D 瀏覽：透視圖對照
// 建築師需求（2026-11-16）：有透視角度的圖，在模型裡同一個角度的位置可以點擊觀看；畫面上有透視選單，
// 一點就看到透視圖，畫面同時移到那張圖的角度。
// 做法：每張圖記一個鏡頭（位置、看向、視角）。點選單或場景裡的標記 → 鏡頭移過去、透視圖疊在畫面上；
// 下方滑桿可在「透視圖」與「模型」之間漸變，同一個角度直接對照。
export function init(ctx) {
  const { THREE, camera, QUAY, updaters, layout: L, lookFrom, setMode, setTime, getTime } = ctx;
  const $ = (id) => document.getElementById(id);
  // 大廳座標 → three 座標。u 沿脊線（西→東）、v 負＝南牆正＝北牆（±0.8 是玻璃帷幕）、h 離地高度
  const hall = (name, u, v, h) => {
    const a = L.halls[name]; let i = 0; while (i < a.length - 2 && a[i + 1].u < u) i++;
    const s0 = a[i], s1 = a[i + 1], k = Math.min(1, Math.max(0, (u - s0.u) / (s1.u - s0.u || 1))), mix = (p, q) => [p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k];
    const c = mix(s0.c, s1.c), w = v >= 0 ? mix(s0.p, s1.p) : mix(s0.m, s1.m), t = Math.abs(v) / 0.8;
    return [c[0] + (w[0] - c[0]) * t, QUAY + h, -(c[1] + (w[1] - c[1]) * t)];
  };
  const AER = { p: [60, 172, 208], t: [5.3, 5.4, 16], fov: 56.8 };       // 與原圖同角度：依疊圖的縮放與位移換算成視角與方向（09f）
  const SHOTS = [
    { id: 'day', name: '白天鳥瞰', ...AER, time: 'day', menu: true, mark: true },
    { id: 'dusk', name: '黃昏鳥瞰', ...AER, time: 'dusk', menu: true },
    { id: 'lobby', name: '入口大廳', p: hall('C', 0.45, 0.34, 4.6), t: hall('C', 0.24, -0.14, 6.2), fov: 72, time: 'day', menu: true, mark: true },
    { id: 'cafe', name: '水母咖啡廳', p: hall('N', 0.84, 0.22, 1.55), t: hall('N', 0.62, 0.36, 2.2), fov: 68, time: 'day', menu: true, mark: true },
    { id: 'tunnel', name: '海底隧道', p: hall('N', 0.15, 0.0, 2.2), t: hall('N', 0.30, 0.0, 3.3), fov: 80, time: 'day', menu: true, mark: true },
    { id: 'line1', name: '鳥瞰線稿', ...AER, time: 'day' },
    { id: 'line2', name: '配置線稿', ...AER, time: 'day' },
  ];
  const byId = Object.fromEntries(SHOTS.map((s) => [s.id, s]));
  const src = (s, thumb) => `./assets/persp/${s.id}${thumb ? '_t' : ''}.jpg`;

  // ── 畫面元件 ──
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html) e.innerHTML = html; return e; };
  const shade = el('div'); shade.id = 'pShade';
  const img = el('img'); img.id = 'pImg'; img.alt = '透視圖';
  const tool = el('div'); tool.id = 'pTool';
  tool.innerHTML = '<div class="pHead"><b id="pTitle"></b><span class="pNote">與模型同一個角度</span></div>'
    + '<div class="pThumbs" id="pThumbs"></div>'
    + '<div class="pMix"><span>模型</span><input id="pSlide" type="range" min="0" max="100" value="100" aria-label="透視圖與模型的比例"><span>透視圖</span></div>'
    + '<div class="pBtns"><button id="pBack">回到這個角度</button><button id="pClose">關閉透視圖</button></div>';
  document.body.append(shade, img, tool);
  const thumbs = $('pThumbs'), slide = $('pSlide'), help = $('help');
  for (const s of SHOTS) { const b = el('button', 'pTh'); b.title = s.name; b.dataset.id = s.id; b.innerHTML = `<img src="${src(s, true)}" alt=""><i>${s.name}</i>`; b.onclick = () => { b.blur(); go(s.id); }; thumbs.append(b); }
  const row = $('perspRow');
  for (const s of SHOTS.filter((q) => q.menu)) { const b = el('button'); b.textContent = s.name; b.dataset.persp = s.id; b.onclick = () => { b.blur(); go(s.id); }; row.append(b); }

  // ── 場景裡的標記：在各張透視圖的鏡頭位置，隔著牆也看得到；離得很近時不顯示 ──
  const ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="currentColor" d="M9 4l-1.6 2H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-3.4L15 4H9zm3 4.5A4.5 4.5 0 1 1 12 17.5 4.5 4.5 0 0 1 12 8.5zm0 2A2.5 2.5 0 1 0 12 15.5 2.5 2.5 0 0 0 12 10.5z"/></svg>';
  const marks = SHOTS.filter((s) => s.mark).map((s) => {
    const b = el('button', 'pMark', ICON + `<span>${s.id === 'day' ? '鳥瞰透視' : s.name}</span>`); b.title = '看這個角度的透視圖'; b.onclick = () => { b.blur(); go(s.id); };
    document.body.append(b); return { b, s, v: new THREE.Vector3(...s.p) };
  });
  const pv = new THREE.Vector3();
  let cur = null, anim = null;
  const fromQ = new THREE.Quaternion(), toQ = new THREE.Quaternion(), fromP = new THREE.Vector3(), toP = new THREE.Vector3(), probe = new THREE.PerspectiveCamera();
  updaters.push(() => {
    if (anim) {                                             // 鏡頭移動：0.9 秒，依實際時間計算
      const k = Math.min(1, (performance.now() - anim.t0) / 900), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(fromP, toP, e); camera.quaternion.slerpQuaternions(fromQ, toQ, e);
      camera.fov = anim.f0 + (anim.s.fov - anim.f0) * e; camera.updateProjectionMatrix();
      if (k >= 1) { lookFrom(anim.s.p, anim.s.t); anim = null; }
    }
    for (const m of marks) {
      pv.copy(m.v).project(camera);
      const near = camera.position.distanceTo(m.v) < 9, show = pv.z < 1 && pv.z > -1 && Math.abs(pv.x) < 1.05 && Math.abs(pv.y) < 1.05 && !near;
      m.b.style.display = show ? 'flex' : 'none';
      if (show) m.b.style.transform = `translate(-50%,-50%) translate(${((pv.x + 1) / 2 * innerWidth).toFixed(1)}px,${((1 - pv.y) / 2 * innerHeight).toFixed(1)}px)`;
    }
  });

  function fade() { const o = slide.value / 100; img.style.opacity = o; shade.style.opacity = o * 0.55; }
  slide.oninput = fade;
  function go(id, instant = false) {
    const s = byId[id]; if (!s) return;
    cur = s; setMode('fly'); $('walkTip').style.display = 'none';
    if (s.time && getTime() !== s.time) setTime(s.time);
    if (instant) { lookFrom(s.p, s.t); camera.fov = s.fov; camera.updateProjectionMatrix(); anim = null; }
    else {
      fromP.copy(camera.position); fromQ.copy(camera.quaternion); toP.set(...s.p);
      probe.position.copy(toP); probe.lookAt(...s.t); toQ.copy(probe.quaternion);
      anim = { s, t0: performance.now(), f0: camera.fov };
    }
    img.src = src(s); $('pTitle').textContent = '透視圖：' + s.name;
    slide.value = 100; fade();
    for (const b of thumbs.children) b.classList.toggle('on', b.dataset.id === id);
    document.querySelectorAll('[data-persp]').forEach((b) => b.classList.toggle('on', b.dataset.persp === id));
    document.body.classList.add('persp'); help.style.display = 'none';
  }
  function close() {
    cur = null; anim = null; document.body.classList.remove('persp'); help.style.display = '';
    camera.fov = 55; camera.updateProjectionMatrix();              // 回到一般飛行的視角
    document.querySelectorAll('[data-persp]').forEach((b) => b.classList.remove('on'));
  }
  $('pClose').onclick = (e) => { e.currentTarget.blur(); close(); };
  $('pBack').onclick = (e) => { e.currentTarget.blur(); if (cur) go(cur.id); };
  addEventListener('keydown', (e) => { if (e.code === 'Escape' && cur) close(); });
  console.info(`透視圖：${SHOTS.length} 張、選單 ${SHOTS.filter((s) => s.menu).length} 個、場景標記 ${marks.length} 個`);
  return { go, close, shots: SHOTS, current: () => cur && cur.id };
}
