// Minimal point-cloud trajectory viewer (Three.js). Data format: see tools/rrd_to_pcd.py
import * as THREE from 'three';
import { OrbitControls } from './OrbitControls.js';

const STYLE = {
  gt:         { color: 0x7b4fa3, size: 0.012, label: 'Ground truth' },
  pointworld: { color: 0xE0913C, size: 0.012, label: 'PointWorld' },
  ours:       { color: 0x3E8489, size: 0.012, label: '3DPWM (ours)' },
  pred:       { color: 0x3E8489, size: 0.012, label: 'Prediction' },
  robot:      { color: 0x9aa8a9, size: 0.006, label: 'Robot' },
};

export async function mountPcdViewer(root, base, opts = {}) {
  const [meta, bin] = await Promise.all([
    fetch(base + '.json').then(r => r.json()),
    fetch(base + '.bin').then(r => r.arrayBuffer()),
  ]);
  const T = meta.frames;
  root.innerHTML = '';
  root.classList.add('pcd');
  let dead = false, raf = 0;
  const stage = document.createElement('div'); stage.className = 'pcd-stage'; root.appendChild(stage);
  const bar = document.createElement('div'); bar.className = 'pcd-bar'; root.appendChild(bar);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  stage.appendChild(renderer.domElement);
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xffffff);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 20);
  camera.up.set(0, 0, 1);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;

  const lo = meta.min, s = meta.scale;
  const clouds = {};
  for (const tr of meta.tracks) {
    const data = new Uint16Array(bin, tr.offset, T * tr.points * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(tr.points * 3), 3));
    const st = STYLE[tr.name] || { color: 0x555555, size: 0.005, label: tr.name };
    const mat = new THREE.PointsMaterial({ color: st.color, size: st.size, sizeAttenuation: true,
      transparent: tr.name !== 'robot', opacity: tr.name === 'gt' ? 0.6 : 0.9 });
    const pts = new THREE.Points(geo, mat); pts.frustumCulled = false; scene.add(pts);
    clouds[tr.name] = { tr, data, geo, pts, st };
  }
  function setFrame(f) {
    for (const c of Object.values(clouds)) {
      const p = c.geo.attributes.position, n = c.tr.points, base = f * n * 3;
      for (let i = 0; i < n * 3; i++) p.array[i] = lo[i % 3] + c.data[base + i] * s;
      p.needsUpdate = true;
    }
  }
  // frame camera on the objects (first frame of gt)
  setFrame(0);
  const g = clouds.gt.geo; g.computeBoundingSphere();
  const ctr = g.boundingSphere.center, r = Math.max(g.boundingSphere.radius, 0.2);
  controls.target.copy(ctr);
  camera.position.set(ctr.x + r * 2.2, ctr.y - r * 2.6, ctr.z + r * 1.9);
  controls.update();

  // UI
  const play = btn('⏸'); const slider = document.createElement('input');
  slider.type = 'range'; slider.min = 0; slider.max = T - 1; slider.value = 0;
  const lab = document.createElement('span'); lab.className = 'pcd-lab';
  bar.append(play, slider, lab);
  const tog = document.createElement('div'); tog.className = 'pcd-tog'; bar.appendChild(tog);
  for (const [k, c] of Object.entries(clouds)) {
    const l = document.createElement('label'); const cb = document.createElement('input');
    cb.type = 'checkbox'; cb.checked = true; cb.onchange = () => (c.pts.visible = cb.checked);
    const sw = document.createElement('i'); sw.style.background = '#' + c.st.color.toString(16).padStart(6, '0');
    l.append(cb, sw, c.st.label); tog.appendChild(l);
  }
  function btn(t) { const b = document.createElement('button'); b.textContent = t; return b; }

  let f = 0, playing = true, last = 0; const fps = opts.fps || 20;
  function show(n) { f = n; slider.value = n; lab.textContent = `${n + 1}/${T}`; setFrame(n); }
  play.onclick = () => { playing = !playing; play.textContent = playing ? '⏸' : '▶'; };
  slider.oninput = () => { playing = false; play.textContent = '▶'; show(+slider.value); };

  function resize() {
    const w = stage.clientWidth, h = stage.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  const ro = new ResizeObserver(resize); ro.observe(stage); resize();
  show(0);
  (function loop(t) {
    if (dead) return; raf = requestAnimationFrame(loop);
    if (playing && t - last > 1000 / fps) { last = t; show((f + 1) % T); }
    controls.update(); renderer.render(scene, camera);
  })(0);
  return () => { dead = true; cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); root.innerHTML = ''; };
}
