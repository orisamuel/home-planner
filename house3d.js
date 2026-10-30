// house3d.js: the 3D house for the home screen (three.js, ES module).
// Everything about the house itself (walls, openings, rooms, fixtures, lights, outline, site)
// arrives as data from the server after the house code. Nothing house-specific lives here.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sky } from 'three/addons/objects/Sky.js';

export function createHouse({ canvas, labelsEl, house: H, onRoomTap }) {
  const CEIL_CM = H.ceiling || 270, CEIL = CEIL_CM / 100;
  const FOOT = H.footprint || [];
  const fb = FOOT.reduce((b, q) => [Math.min(b[0], q[0]), Math.min(b[1], q[1]), Math.max(b[2], q[0] + q[2]), Math.max(b[3], q[1] + q[3])], [1e9, 1e9, -1e9, -1e9]);
  const CX = (fb[0] + fb[2]) / 200, CZ = (fb[1] + fb[3]) / 200;                 // footprint centre, metres
  const SPAN = Math.max(fb[2] - fb[0], fb[3] - fb[1]) / 100;
  const W = (x) => x / 100 - CX, Z = (y) => y / 100 - CZ;
  const mobile = innerWidth < 700;

  // ---------- renderer, scene, camera ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? 1.5 : 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .92;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#d9dde0', 220, 1300);
  const sky = new Sky(); sky.scale.setScalar(1500); scene.add(sky);
  const SU = sky.material.uniforms;
  SU.turbidity.value = 2.4; SU.rayleigh.value = 1.9; SU.mieCoefficient.value = .004; SU.mieDirectionalG.value = .86;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(), envSky = new Sky(); envSky.material = sky.material; envSky.scale.setScalar(1500); envScene.add(envSky);
  let envRT = null;
  const updateEnv = () => { const rt = pmrem.fromScene(envScene, 0, .1, 2000); if (envRT) envRT.dispose(); envRT = rt; scene.environment = rt.texture; };

  const camera = new THREE.PerspectiveCamera(50, 1, .1, 1800);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * .47;
  controls.minDistance = 2.5; controls.maxDistance = 48;
  const HOME = { pos: new THREE.Vector3(), target: new THREE.Vector3(0, 0, .6) };

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const gtao = new GTAOPass(scene, camera, 300, 300);
  gtao.updateGtaoMaterial({ radius: .55, distanceExponent: 1.4, thickness: 1.2, scale: 1.1, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 16 });
  composer.addPass(gtao);
  composer.addPass(new OutputPass());
  let useAO = true;

  // ---------- procedural textures ----------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const shade = (hex, v) => {
    const n = parseInt(hex.slice(1), 16), f = (c) => Math.max(0, Math.min(255, Math.round(c * (1 + v))));
    return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
  };
  function tex(size, draw, world) {
    const c = document.createElement('canvas'); c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    t.userData.world = world;
    return t;
  }
  const tiles = (base, grout, cols, rows, jitter, speck = .025) => (g, s) => {
    const kx = s / cols, ky = s / rows;
    g.fillStyle = grout; g.fillRect(0, 0, s, s);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      g.fillStyle = shade(base, rnd(-jitter, jitter)); g.fillRect(i * kx + 1, j * ky + 1, kx - 2, ky - 2);
      for (let m = 0; m < 30; m++) { g.fillStyle = `rgba(0,0,0,${rnd(0, speck)})`; g.fillRect(i * kx + rnd(0, kx), j * ky + rnd(0, ky), rnd(2, 9), rnd(2, 9)); }
    }
  };
  function parquet(g, s) {
    const rows = 8, h = s / rows;
    for (let r = 0; r < rows; r++) {
      let x = -rnd(0, s * .6);
      while (x < s) {
        const len = rnd(s * .45, s * .75);
        g.fillStyle = shade('#b48d63', rnd(-.06, .05)); g.fillRect(x, r * h, len, h);
        for (let k = 0; k < 14; k++) { g.strokeStyle = `rgba(70,40,15,${rnd(.04, .12)})`; g.lineWidth = rnd(.5, 1.5); g.beginPath(); const y = r * h + rnd(2, h - 2); g.moveTo(x, y); g.bezierCurveTo(x + len * .3, y + rnd(-3, 3), x + len * .6, y + rnd(-3, 3), x + len, y + rnd(-2, 2)); g.stroke(); }
        g.fillStyle = 'rgba(60,35,15,.35)'; g.fillRect(x, r * h, 1.5, h);
        x += len;
      }
      g.fillStyle = 'rgba(60,35,15,.3)'; g.fillRect(0, r * h, s, 1.2);
    }
  }
  function grass(g, s) {
    g.fillStyle = '#7f9a5a'; g.fillRect(0, 0, s, s);
    for (let i = 0; i < 9000; i++) { g.fillStyle = shade('#7f9a5a', rnd(-.25, .2)); g.fillRect(rnd(0, s), rnd(0, s), rnd(1, 3), rnd(2, 6)); }
  }
  function stone(g, s) {
    const rows = 8, h = s / rows;
    g.fillStyle = '#d9cdb6'; g.fillRect(0, 0, s, s);
    for (let r = 0; r < rows; r++) {
      let x = -rnd(0, s * .2);
      while (x < s) {
        const len = rnd(s * .14, s * .3);
        g.fillStyle = shade(['#e3d6bd', '#dccdb0', '#e8dcc6', '#d6c6a8'][Math.floor(rnd(0, 4))], rnd(-.05, .04));
        g.fillRect(x + 1.5, r * h + 1.5, len - 3, h - 3);
        for (let k = 0; k < 220; k++) { g.fillStyle = `rgba(${rnd(0, 1) < .5 ? '90,70,40' : '255,250,240'},${rnd(.03, .09)})`; g.fillRect(x + rnd(0, len), r * h + rnd(0, h), rnd(1, 3), rnd(1, 3)); }
        x += len;
      }
    }
  }
  function plasterNormal(size = 256) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    for (let i = 0; i < 2600; i++) { g.fillStyle = `rgba(${rnd(0, 1) < .5 ? 0 : 255},0,0,${rnd(.05, .18)})`; g.beginPath(); g.arc(rnd(0, size), rnd(0, size), rnd(1, 5), 0, 7); g.fill(); }
    const hgt = g.getImageData(0, 0, size, size).data, out = g.createImageData(size, size);
    const at = (x, y) => hgt[(((y + size) % size) * size + ((x + size) % size)) * 4] / 255;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const n = new THREE.Vector3(-(at(x + 1, y) - at(x - 1, y)) * 1.2, -(at(x, y + 1) - at(x, y - 1)) * 1.2, 1).normalize(), i = (y * size + x) * 4;
      out.data[i] = (n.x * .5 + .5) * 255; out.data[i + 1] = (n.y * .5 + .5) * 255; out.data[i + 2] = (n.z * .5 + .5) * 255; out.data[i + 3] = 255;
    }
    g.putImageData(out, 0, 0);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.world = .6; return t;
  }
  const TEX = {
    porcelain80: tex(512, tiles('#dcd6cd', '#c9c2b7', 4, 4, .025), 3.2),
    porcelain60: tex(512, tiles('#d6d0c6', '#c2bbb0', 4, 4, .03), 2.4),
    tile30: tex(512, tiles('#e2e3e1', '#bfc2c2', 8, 8, .03), 2.4),
    parquet: tex(1024, parquet, 1.6),
    outdoor: tex(512, tiles('#c4b8a6', '#a99d8b', 4, 4, .05), 2.4),
    grass: tex(512, grass, 4),
    wallTile: tex(512, tiles('#f1f0ed', '#d2d1cc', 2, 4, .012, .01), 1.2),
    splash: tex(512, tiles('#ebe6dd', '#cdc6ba', 4, 8, .02, .012), 1.2),
    stone: tex(1024, stone, 2.4),
    plasterN: plasterNormal(),
  };
  const std = (color, roughness = .6, metalness = 0, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const floorMat = {};
  for (const k of ['porcelain80', 'porcelain60', 'tile30', 'parquet', 'outdoor', 'grass'])
    floorMat[k] = std(k === 'grass' ? '#d8dccb' : '#ffffff', k === 'parquet' ? .55 : k === 'grass' ? 1 : .5, 0, { map: TEX[k], envMapIntensity: k === 'grass' ? 1 : .22 });   // less sky in the floors
  const M = {
    wall: std('#f3f0eb', .9, 0, { normalMap: TEX.plasterN, normalScale: new THREE.Vector2(.08, .08) }), cap: std('#4a433d', .8),
    stone: std('#ffffff', .85, 0, { map: TEX.stone }),
    bulb: std('#fff8ee', .3, 0, { emissive: '#ffd59e', emissiveIntensity: 0 }), canopy: std('#f4f2ee', .5),
    glass: std('#c6dbe3', .04, .1, { transparent: true, opacity: .25, depthWrite: false }),
    frame: std('#3b3d40', .45, .5), sill: std('#e7e2d9', .28),
    doorWhite: std('#f3f1ed', .35), steel: std('#71767b', .42, .55), chrome: std('#e2e6e9', .1, 1),
    ceramic: std('#fbfbf9', .1), basin: std('#c9cdd0', .22, .85), basinIn: std('#eef0ef', .15),
    cabinet: std('#eeebe5', .5), counter: std('#d9d5cd', .25), groove: std('#a9a296', .8),
    vanity: std('#c8a983', .55), wood: std('#7a5a3e', .7), soil: std('#b8a58a', 1),
    skirtLight: std('#cbc5bb', .35), skirtWhite: std('#f5f3ef', .45), drain: std('#55595d', .35, .8),
    wallTile: std('#ffffff', .18, 0, { map: TEX.wallTile }), splash: std('#ffffff', .22, 0, { map: TEX.splash }),
    ceiling: std('#f7f5f1', 1, 0, { side: THREE.BackSide, emissive: '#cfcac3', emissiveIntensity: .5 }),
    done: std('#9fd0a8', 1, 0, { transparent: true, opacity: .32, depthWrite: false }),
    part: std('#f3c48f', 1, 0, { transparent: true, opacity: .2, depthWrite: false }),
  };
  const wallMats = [M.wall, M.wall, M.cap, M.wall, M.wall, M.wall];

  // ---------- geometry helpers ----------
  const group = new THREE.Group(); scene.add(group);
  function worldUV(g, w, h, d) {
    const uv = g.attributes.uv, dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0], uv.getY(k) * dims[f][1]); }
  }
  function box(x, y, w, d, y0, h, mat, { cast = true, uvWorld = 0 } = {}) {
    const g = new THREE.BoxGeometry(w / 100, h, d / 100);
    if (uvWorld) worldUV(g, w / 100 / uvWorld, h / uvWorld, d / 100 / uvWorld);
    const m = new THREE.Mesh(g, mat);
    m.position.set(W(x + w / 2), y0 + h / 2, Z(y + d / 2));
    m.castShadow = cast; m.receiveShadow = true; group.add(m); return m;
  }
  function ellip(x, y, w, d, y0, h, mat) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(.5, .5, 1, 32), mat);
    m.scale.set(w / 100, h, d / 100); m.position.set(W(x + w / 2), y0 + h / 2, Z(y + d / 2));
    m.castShadow = true; m.receiveShadow = true; group.add(m); return m;
  }
  function plane(x, y, w, d, mat, yy) {
    const g = new THREE.PlaneGeometry(w / 100, d / 100), t = mat.map;
    if (t) { const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w / 100) / t.userData.world + x / 100 / t.userData.world, uv.getY(i) * (d / 100) / t.userData.world - y / 100 / t.userData.world); }
    const m = new THREE.Mesh(g, mat); m.rotation.x = -Math.PI / 2;
    m.position.set(W(x + w / 2), yy, Z(y + d / 2)); m.receiveShadow = true; group.add(m); return m;
  }
  function rod(x1, y1, h1, x2, y2, h2, r, mat) {
    const a = new THREE.Vector3(W(x1), h1, Z(y1)), b = new THREE.Vector3(W(x2), h2, Z(y2));
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r / 100, r / 100, a.distanceTo(b), 16), mat);
    m.position.copy(a).add(b).multiplyScalar(.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; group.add(m); return m;
  }
  const inRect = (px, py, q) => px >= q[0] && px <= q[0] + q[2] && py >= q[1] && py <= q[1] + q[3];
  const roomAt = (px, py) => H.rooms.find(r => r.rects.some(q => inRect(px, py, q))) || null;
  const isExterior = (px, py) => !FOOT.some(q => inRect(px, py, q)) || H.outdoor.some(o => !o.approx && o.rects.some(q => inRect(px, py, q)));
  const STONE_T = 2.5;
  function stoneSkin(along, a0, a1, f, dir, y0, h) {
    const p = dir < 0 ? f - STONE_T : f;
    box(...(along ? [a0, p, a1 - a0, STONE_T] : [p, a0, STONE_T, a1 - a0]), y0, h, M.stone, { cast: false, uvWorld: TEX.stone.userData.world });
  }
  const PW = TEX.plasterN.userData.world;

  // ---------- walls and openings ----------
  for (const w of H.walls) box(w[0], w[1], w[2], w[3], 0, (w[4] || CEIL_CM) / 100, wallMats, { uvWorld: PW });
  for (const o of H.openings) {
    const [x, y, w, d] = o.rect, sill = o.sill / 100, head = o.head / 100;
    const along = w > d, L = along ? w : d, T = along ? d : w;
    if (sill > 0) box(x, y, w, d, 0, sill, wallMats, { uvWorld: PW });
    if (head < CEIL) box(x, y, w, d, head, CEIL - head, wallMats, { uvWorld: PW });
    for (const dir of [-1, 1]) {
      const f = along ? (dir < 0 ? y : y + d) : (dir < 0 ? x : x + w);
      if (!isExterior(along ? x + w / 2 : f + dir * 6, along ? f + dir * 6 : y + d / 2)) continue;
      if (head < CEIL) stoneSkin(along, along ? x : y, along ? x + w : y + d, f, dir, head, CEIL - head);
      if (sill > 0) stoneSkin(along, along ? x : y, along ? x + w : y + d, f, dir, 0, sill);
    }
    const t = 4, cx = along ? x : x + w / 2 - t / 2, cy = along ? y + d / 2 - t / 2 : y;
    if (o.type === 'window' || o.type === 'slider') {
      box(cx, cy, along ? w : t, along ? t : d, sill, head - sill, M.glass, { cast: false });
      const f = 5;
      if (along) { box(x, cy - 1, f, t + 2, sill, head - sill, M.frame); box(x + w - f, cy - 1, f, t + 2, sill, head - sill, M.frame); }
      else { box(cx - 1, y, t + 2, f, sill, head - sill, M.frame); box(cx - 1, y + d - f, t + 2, f, sill, head - sill, M.frame); }
      box(along ? x : cx - 1, along ? cy - 1 : y, along ? w : t + 2, along ? t + 2 : d, head - .05, .05, M.frame);
      if (o.type === 'slider') box(along ? x + w / 2 - 2 : cx - 1, along ? cy - 1 : y + d / 2 - 2, along ? 4 : t + 2, along ? t + 2 : 4, 0, head, M.frame);
      if (sill > 0) box(along ? x - 2 : x - 3, along ? y - 3 : y - 2, along ? w + 4 : w + 6, along ? d + 6 : d + 4, sill - .03, .03, M.sill);
    }
    if (o.type === 'door' && o.leaf) {
      const mat = o.leaf === 'steel' ? M.steel : o.leaf === 'alu' ? M.frame : M.doorWhite, fw = 5, lw = L - 2 * fw;
      if (along) { box(x, y - 1.5, fw, T + 3, 0, head, mat); box(x + w - fw, y - 1.5, fw, T + 3, 0, head, mat); box(x, y - 1.5, w, T + 3, head - .05, .05, mat); }
      else { box(x - 1.5, y, T + 3, fw, 0, head, mat); box(x - 1.5, y + d - fw, T + 3, fw, 0, head, mat); box(x - 1.5, y, T + 3, d, head - .05, .05, mat); }
      const lh = head - .06;
      if (o.closed) box(along ? x + fw : x + T / 2 - 2, along ? y + T / 2 - 2 : y + fw, along ? lw : 4, along ? 4 : lw, 0, lh, mat);
      else {
        const side = (s) => roomAt(along ? x + w / 2 : x + w / 2 + s * (T / 2 + 30), along ? y + d / 2 + s * (T / 2 + 30) : y + d / 2);
        const a = side(-1), b = side(1), s = o.swing || ((b && b.id !== 'entry') ? 1 : (a && a.id !== 'entry') ? -1 : 1);   // swing/hinge from the plan when the rule guesses wrong
        const R = s > 0 ? b : a, q = R ? R.rects.reduce((m, r) => r[2] * r[3] > m[2] * m[3] ? r : m) : null;
        const st = along ? x : y, en = along ? x + w : y + d, lo = q ? (along ? q[0] : q[1]) : st, hi = q ? (along ? q[0] + q[2] : q[1] + q[3]) : en;
        const hp = o.hinge ? (o.hinge === 'end' ? en - fw - 4 : st + fw) : (hi - en) < (st - lo) ? en - fw - 4 : st + fw, hEnd = hp !== st + fw;
        if (along) { const by = s < 0 ? y - lw : y + d; box(hp, by, 4, lw, 0, lh, mat); box(hEnd ? hp - 2 : hp + 4, s < 0 ? y - lw + 4 : y + d + lw - 10, 2, 6, 1, .03, M.chrome); }
        else { const bx = s < 0 ? x - lw : x + w; box(bx, hp, lw, 4, 0, lh, mat); box(s < 0 ? x - lw + 4 : x + w + lw - 10, hEnd ? hp - 2 : hp + 4, 6, 2, 1, .03, M.chrome); }
      }
    }
  }

  // ---------- skirting, wall tiles and outside stone, sampled along every wall face ----------
  const TILE = H.tileHeight || {};
  for (const w of H.walls) {
    const [x, y, ww, dd] = w; if ((w[4] || CEIL_CM) < 200) continue;
    const along = ww >= dd, faces = along ? [[y, -1], [y + dd, 1]] : [[x, -1], [x + ww, 1]];
    for (const [f, dir] of faces) {
      const a0 = along ? x : y, a1 = along ? x + ww : y + dd;
      let run = null;
      const flush = () => {
        if (run && run.r === 'ext' && run.b - run.a >= 4) stoneSkin(along, run.a, run.b, f, dir, 0, (w[4] || CEIL_CM) / 100);
        else if (run && run.b - run.a >= 6) {
          const th = 1.2, p = dir < 0 ? f - th : f, len = run.b - run.a;
          const r = along ? [run.a, p, len, th] : [p, run.a, th, len], tH = TILE[run.r.id];
          if (tH) box(...r, 0, tH / 100, M.wallTile, { cast: false, uvWorld: TEX.wallTile.userData.world });
          else box(...r, 0, .08, run.r.floor === 'parquet' ? M.skirtWhite : M.skirtLight, { cast: false });
        }
        run = null;
      };
      for (let s = a0 + 2.5; s < a1; s += 5) {
        const px = along ? s : f + dir * 4, py = along ? f + dir * 4 : s;
        const r = isExterior(px, py) ? 'ext' : roomAt(px, py);
        if (run && r === run.r) run.b = Math.min(a1, s + 2.5);
        else { flush(); if (r) run = { r, a: Math.max(a0, s - 2.5), b: Math.min(a1, s + 2.5) }; }
      }
      flush();
    }
  }

  // ---------- fixtures the contractor supplies ----------
  const isNS = (f) => f.wall === 'n' || f.wall === 's';
  function sub(f, a0, a1, d0, d1) {
    const [x, y, w, d] = f.rect;
    switch (f.wall) {
      case 'n': return [x + a0, y + d0, a1 - a0, d1 - d0];
      case 's': return [x + a0, y + d - d1, a1 - a0, d1 - d0];
      case 'w': return [x + d0, y + a0, d1 - d0, a1 - a0];
      default:  return [x + w - d1, y + a0, d1 - d0, a1 - a0];
    }
  }
  const B = (f, a0, a1, d0, d1, y0, h, mat, o) => box(...sub(f, a0, a1, d0, d1), y0, h, mat, o);
  const E = (f, a0, a1, d0, d1, y0, h, mat) => ellip(...sub(f, a0, a1, d0, d1), y0, h, mat);
  const pt = (f, a, d) => { const r = sub(f, a, a, d, d); return [r[0], r[1]]; };
  function faucet(f, a, d0, y0, reach) {
    const [bx, by] = pt(f, a, d0 + 2.5), [sx, sy] = pt(f, a, d0 + reach);
    rod(bx, by, y0, bx, by, y0 + .24, 1.8, M.chrome);
    rod(bx, by, y0 + .23, sx, sy, y0 + .2, 1.1, M.chrome);
    rod(bx, by, y0 + .14, ...pt(f, a + 7, d0 + 2.5), y0 + .16, .6, M.chrome);
  }
  for (const f of H.fixtures || []) {
    const L = isNS(f) ? f.rect[2] : f.rect[3], D = isNS(f) ? f.rect[3] : f.rect[2];
    switch (f.type) {
      case 'counter':
        B(f, 0, L, 0, D - 6, 0, .1, M.groove); B(f, 0, L, 0, D - 2, .1, .78, M.cabinet);
        for (let k = 60; k < L - 5; k += 60) B(f, k - .3, k + .3, D - 2, D - 1.6, .13, .72, M.groove, { cast: false });
        B(f, 0, L, 0, D + 1, .88, .025, M.counter);
        B(f, 0, L, 0, 1.2, .905, .55, M.splash, { cast: false, uvWorld: TEX.splash.userData.world });
        break;
      case 'upper':
        B(f, 0, L, 0, D, 1.45, .7, M.cabinet);
        for (let k = 50; k < L - 5; k += 50) B(f, k - .3, k + .3, D, D + .4, 1.47, .66, M.groove, { cast: false });
        break;
      case 'tall': B(f, 0, L, 0, D, 0, 2.15, M.cabinet); B(f, 0, L, D, D + .4, .9, .006, M.groove, { cast: false }); break;
      case 'ksink': B(f, 0, L, 0, D, .905, .006, M.basin, { cast: false }); B(f, 4, L - 4, 5, D - 4, .911, .002, M.groove, { cast: false }); faucet(f, L / 2, 0, .91, 20); break;
      case 'tub': {
        const r = 6;
        B(f, 0, L, 0, r, 0, .56, M.ceramic); B(f, 0, L, D - r, D, 0, .56, M.ceramic);
        B(f, 0, r, r, D - r, 0, .56, M.ceramic); B(f, L - r, L, r, D - r, 0, .56, M.ceramic);
        B(f, r, L - r, r, D - r, 0, .14, M.basinIn); faucet(f, L - 25, -1, .62, 14);
        break;
      }
      case 'vanity': B(f, 0, L, 0, D, .36, .46, M.vanity); B(f, 0, L, 0, D + 1, .82, .07, M.ceramic); E(f, 9, L - 9, 9, D - 6, .885, .006, M.basinIn); faucet(f, L / 2, 1, .89, 12); break;
      case 'toilet':
        B(f, 4, L - 4, 0, 20, .3, .12, M.ceramic); E(f, 1, L - 1, 4, D, .3, .12, M.ceramic); E(f, 0, L, 3, D + 1, .42, .025, M.ceramic);
        B(f, L / 2 - 11, L / 2 + 11, -.4, .8, .98, .16, M.chrome, { cast: false });
        break;
      case 'smallsink': E(f, 0, L, 0, D, .74, .1, M.ceramic); E(f, 4, L - 4, 3, D - 5, .841, .004, M.basinIn); faucet(f, L / 2, 0, .84, 9); break;
      case 'shower':
        B(f, L / 2 - 1, L / 2 + 1, 0, 2.5, 1, 1, M.chrome); B(f, L / 2 - 6, L / 2 + 6, 0, 5, 1.04, .1, M.chrome);
        E(f, L / 2 - 6, L / 2 + 6, 2, 10, 1.8, .03, M.chrome); B(f, 4, L - 4, D - 8, D - 4, .003, .006, M.drain, { cast: false });
        break;
    }
  }

  // ---------- floors, ground, outdoor ----------
  const roomInfo = {}, tints = {};
  for (const r of [...H.rooms, ...H.outdoor]) {
    const out = H.outdoor.includes(r), mat = floorMat[r.floor] || floorMat.porcelain80;
    for (const q of r.rects) plane(q[0], q[1], q[2], q[3], mat, r.floor === 'grass' ? -.028 : out ? -.02 : .004);
    const big = r.rects.reduce((m, q) => q[2] * q[3] > m[2] * m[3] ? q : m);
    roomInfo[r.id] = { r, out, big, area: r.rects.reduce((s, q) => s + q[2] * q[3], 0) / 1e4 };
    if (!r.approx) tints[r.id] = r.rects.map(q => { const m = plane(q[0], q[1], q[2], q[3], M.part, out ? -.012 : .012); m.visible = false; m.receiveShadow = false; return m; });
  }
  plane(-900, -200, 3200, 2900, floorMat.grass, -.03);
  for (const q of FOOT) plane(q[0], q[1], q[2], q[3], floorMat.porcelain80, -.025);
  const slope = (H.site && H.site.slopeBehind || 0) / 100;
  if (slope > 0) { box(-900, -900, 3200, 865, 0, slope, M.soil); plane(-900, -900, 3200, 865, floorMat.grass, slope + .005); }
  {
    const land = new THREE.Mesh(new THREE.CircleGeometry(950, 64), std('#cbb995', 1));
    land.rotation.x = -Math.PI / 2; land.position.y = -.06; land.receiveShadow = true; scene.add(land);
    const seg = 160, rings = 6, pos = [], col = [], idx = [];
    const noise = (a, k) => Math.sin(a * 3 + k) * .5 + Math.sin(a * 7.3 + k * 1.7) * .3 + Math.sin(a * 17.1 + k * .3) * .2;
    for (let j = 0; j <= rings; j++) for (let i = 0; i <= seg; i++) {
      const a = i / seg * Math.PI * 2, r = 330 + j * 75, ridge = Math.max(0, noise(a, j) + .55) * (j === 0 || j === rings ? 0 : 1);
      pos.push(Math.cos(a) * r, ridge * (9 + j * 8), Math.sin(a) * r);
      const c = new THREE.Color('#c9b089').offsetHSL(0, -.05 * j / rings, .04 * Math.sin(a * 5 + j) - .03 * j / rings); col.push(c.r, c.g, c.b);
    }
    for (let j = 0; j < rings; j++) for (let i = 0; i < seg; i++) { const a = j * (seg + 1) + i, b = a + seg + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(idx); g.computeVertexNormals();
    scene.add(new THREE.Mesh(g, std('#ffffff', 1, 0, { vertexColors: true })));
  }
  const pg = H.outdoor.find(o => o.pergola);
  if (pg) {
    const [px, py, pw, pd] = pg.pergola, top = 2.6;
    for (const [x, y] of [[px, py + pd - 12], [px + pw - 12, py + pd - 12]]) box(x, y, 12, 12, 0, top, M.wood);
    box(px, py + pd - 14, pw, 14, top - .2, .2, M.wood);
    for (let x = px; x <= px + pw - 6; x += 55) box(x, py, 6, pd, top, .16, M.wood);
  }
  const ceil = new THREE.Mesh(new THREE.BoxGeometry((fb[2] - fb[0]) / 100, .02, (fb[3] - fb[1]) / 100), M.ceiling);
  ceil.position.set(W((fb[0] + fb[2]) / 2), CEIL + .01, Z((fb[1] + fb[3]) / 2)); ceil.visible = false; group.add(ceil);

  // ---------- light points: bare bulb holders ----------
  const bulbs = [];
  for (const l of H.lights || []) {
    const h = l.h / 100, top = l.h >= CEIL_CM;
    if (top) {
      const cp = new THREE.Mesh(new THREE.CylinderGeometry(.045, .045, .015, 20), M.canopy); cp.position.set(W(l.x), h - .008, Z(l.y)); group.add(cp);
      rod(l.x, l.y, h - .015, l.x, l.y, h - .14, .35, M.canopy);
    } else rod(l.x, l.y, h + .02, l.x, l.y, h - .06, 1.6, M.canopy);
    const b = new THREE.Mesh(new THREE.SphereGeometry(.032, 16, 12), M.bulb);
    b.position.set(W(l.x), top ? h - .17 : h - .09, Z(l.y)); group.add(b);
    bulbs.push({ ...l, top, pos: b.position.clone() });
  }
  const POOL = Array.from({ length: 6 }, () => { const p = new THREE.PointLight('#ffcf96', 0, 0, 2); scene.add(p); return p; });

  // ---------- sun and sky ----------
  const hemi = new THREE.HemisphereLight('#f1efe9', '#c9b79d', .4); scene.add(hemi);   // warm, neutral fill: indoor shade is not blue
  const sun = new THREE.DirectionalLight('#fff3e0', 2.4);
  sun.castShadow = true; sun.shadow.mapSize.set(mobile ? 1024 : 2048, mobile ? 1024 : 2048);
  const sh = SPAN * .75 + 2;
  Object.assign(sun.shadow.camera, { left: -sh, right: sh, top: sh, bottom: -sh, near: 1, far: 70 });
  sun.shadow.bias = -.0004; sun.shadow.normalBias = .02;
  scene.add(sun, sun.target);
  const fill = new THREE.PointLight('#ffe6c8', 0, 7, 1.4); scene.add(fill);
  const LAT = (H.site && H.site.lat || 30) * Math.PI / 180, NORTH = (H.northDeg || 0) * Math.PI / 180;
  let day = 355, hour = 10, night = false, current = null, eye = false;

  function placeLamps() {
    POOL.forEach(p => p.intensity = 0);
    if (!night) return;
    let pick;
    if (eye && current) {
      const c = roomInfo[current].big, cc = new THREE.Vector3(W(c[0] + c[2] / 2), 1.5, Z(c[1] + c[3] / 2));
      pick = bulbs.filter(b => b.top || b.room === current).sort((a, b) => (a.room === current ? 0 : 1) - (b.room === current ? 0 : 1) || a.pos.distanceTo(cc) - b.pos.distanceTo(cc));
    } else {
      const big = Object.values(roomInfo).filter(i => !i.out).sort((a, b) => b.area - a.area).map(i => i.r.id);
      const seen = new Set(); pick = big.map(id => bulbs.find(b => b.top && b.room === id && !seen.has(id) && seen.add(id))).filter(Boolean);
    }
    pick.slice(0, POOL.length).forEach((b, i) => { POOL[i].position.copy(b.pos); POOL[i].intensity = eye ? 3.2 : 7; });
  }
  function placeSun() {
    const dec = 23.44 * Math.PI / 180 * Math.sin(2 * Math.PI * (284 + day) / 365), ha = (hour - 12) * 15 * Math.PI / 180;
    const el = Math.asin(Math.sin(LAT) * Math.sin(dec) + Math.cos(LAT) * Math.cos(dec) * Math.cos(ha));
    const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(LAT) - Math.tan(dec) * Math.cos(LAT)) + Math.PI;
    const v = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)).applyAxisAngle(new THREE.Vector3(0, 1, 0), -NORTH);
    SU.sunPosition.value.copy(v);
    const up = Math.max(el, .02), dayK = THREE.MathUtils.smoothstep(el, -.1, .12);
    sun.position.copy(v.clone().multiplyScalar(30)); sun.position.y = Math.max(sun.position.y, .6);
    sun.intensity = (.3 + 2.1 * Math.min(1, Math.sin(up) * 2.2)) * THREE.MathUtils.smoothstep(el, -.02, .06);
    sun.color.setHSL(.08, .6 + .35 * (1 - Math.sin(up)), .8 + .12 * Math.sin(up));
    hemi.intensity = .06 + .38 * dayK;
    scene.environmentIntensity = .05 + .2 * dayK;
    scene.fog.color.lerpColors(new THREE.Color('#151b26'), new THREE.Color('#d9dde0'), dayK);
    M.ceiling.emissiveIntensity = .05 + .45 * dayK;
    renderer.toneMappingExposure = .92 + .08 * (1 - dayK);
    night = el < .06;
    M.bulb.emissiveIntensity = night ? 6 : 0;
    updateEnv(); placeLamps();
  }

  // ---------- labels ----------
  const labelEls = [];
  for (const id in roomInfo) {
    const info = roomInfo[id], q = info.big, b = document.createElement('button');
    b.className = 'lab' + (info.out ? ' out' : ''); b.type = 'button';
    b.innerHTML = `<span class="dot"></span><span class="nm"></span><span class="ct"></span>`;
    b.querySelector('.nm').textContent = info.r.name;
    b.onclick = () => onRoomTap && onRoomTap(id);
    labelsEl.appendChild(b);
    const lp = info.r.approx ? [W(q[0] + q[2] * .5), .9, Z(q[1] + Math.min(q[3], 320))] : [W(q[0] + q[2] / 2), .9, Z(q[1] + q[3] / 2)];
    labelEls.push({ el: b, id, p: new THREE.Vector3(...lp), prio: info.out ? info.area * .25 : info.area });
  }
  let labelOrder = labelEls.slice().sort((a, b) => b.prio - a.prio);
  const reorder = () => { labelOrder = labelEls.slice().sort((a, b) => (b.id === current) - (a.id === current) || b.prio - a.prio); };

  // ---------- camera moves ----------
  let fly = null, first = true;
  const flyTo = (pos, target, ms = 900) => { fly = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: target, s: performance.now(), ms: first ? 1700 : ms }; first = false; };
  const VP = { w: 1, h: 1, top: 0, bottom: 0 };
  function homeFor() {                     // fit the house (and patio) into the area the sheet leaves free
    const vh = Math.max(200, VP.h - VP.top - VP.bottom), fov = camera.fov * Math.PI / 180;
    const hfov = 2 * Math.atan(Math.tan(fov / 2) * VP.w / VP.h);
    const need = Math.max((SPAN + 5) / (2 * Math.tan(hfov / 2)), (SPAN + 3) / (2 * Math.tan(fov / 2)) * (VP.h / vh));
    return new THREE.Vector3(-.32, .86, .4).normalize().multiplyScalar(need * .95);
  }
  function applyView() {
    camera.aspect = VP.w / VP.h;
    camera.setViewOffset(VP.w, VP.h, 0, (VP.bottom - VP.top) / 2, VP.w, VP.h);    // keep the subject in the visible area
    camera.updateProjectionMatrix();
  }
  function enterRoom(id) {
    const info = roomInfo[id]; if (!info) return;
    current = id; setEye(false);
    const q = info.big, c = new THREE.Vector3(W(q[0] + q[2] / 2), 0, Z(q[1] + q[3] / 2)), span = Math.max(q[2], q[3]) / 100;
    const dir = new THREE.Vector3(-c.x, 0, -c.z); if (dir.length() < 1) dir.set(-.3, 0, 1); dir.normalize();
    // fit the room into the free area: on a portrait phone the width is the tight side
    const fov = camera.fov * Math.PI / 180, vh = Math.max(200, VP.h - VP.top - VP.bottom), hfov = 2 * Math.atan(Math.tan(fov / 2) * VP.w / VP.h);
    const fit = (span + 1.4) * (info.r.approx ? .6 : 1);
    const need = Math.max(fit / (2 * Math.tan(hfov / 2)), fit / (2 * Math.tan(fov / 2)) * (VP.h / vh));
    flyTo(c.clone().add(dir.multiplyScalar(.5).add(new THREE.Vector3(0, 1, 0)).normalize().multiplyScalar(need)), c);
    labelEls.forEach(l => l.el.classList.toggle('sel', l.id === id)); reorder();
  }
  function goHome() {
    current = null; setEye(false); flyTo(homeFor(), HOME.target.clone());
    labelEls.forEach(l => l.el.classList.remove('sel')); reorder();
  }
  function setEye(on) {
    if (on && (!current || roomInfo[current].out)) return false;
    eye = on; ceil.visible = on;
    controls.enableZoom = !on; controls.enablePan = !on;
    controls.maxPolarAngle = on ? Math.PI * .62 : Math.PI * .47; controls.minDistance = on ? .01 : 2.5;
    camera.fov = on ? (mobile ? 72 : 62) : (mobile ? 50 : 40); applyView();
    labelsEl.classList.toggle('hide', on);
    fill.intensity = 0;
    if (on) {
      const r = roomInfo[current].r, q = roomInfo[current].big;
      fill.position.set(W(q[0] + q[2] / 2), 2.3, Z(q[1] + q[3] / 2)); fill.intensity = night ? .3 : 2.2;
      const inRoom = (px, py) => r.rects.some(rr => inRect(px, py, rr));
      let p, t;
      if (r.view) { p = new THREE.Vector3(W(r.view.from[0]), 1.55, Z(r.view.from[1])); t = new THREE.Vector3(W(r.view.to[0]), 1.15, Z(r.view.to[1])); }
      for (const o of p ? [] : H.openings) {                       // stand in the doorway, look in
        if (o.type !== 'door' || o.closed) continue;
        const [x, y, w, d] = o.rect, along = w > d, cx = x + w / 2, cy = y + d / 2, T = along ? d : w;
        for (const s of [-1, 1]) {
          if (!inRoom(along ? cx : cx + s * (T / 2 + 30), along ? cy + s * (T / 2 + 30) : cy)) continue;
          const ox = along ? cx : cx - s * (T / 2 + 12), oy = along ? cy - s * (T / 2 + 12) : cy, rc = [q[0] + q[2] / 2, q[1] + q[3] / 2];
          p = new THREE.Vector3(W(ox), 1.55, Z(oy)); t = new THREE.Vector3(W(rc[0] + (rc[0] - ox) * .4), 1.2, Z(rc[1] + (rc[1] - oy) * .4));
        }
        if (p) break;
      }
      if (!p) {                                                     // open plan: face the widest window
        const near = (o) => { const [x, y, w, d] = o.rect; return x < q[0] + q[2] + 40 && x + w > q[0] - 40 && y < q[1] + q[3] + 40 && y + d > q[1] - 40; };
        const win = H.openings.filter(o => (o.type === 'window' || o.type === 'slider') && near(o)).sort((a, b) => Math.max(b.rect[2], b.rect[3]) - Math.max(a.rect[2], a.rect[3]))[0];
        if (win) {
          const wc = [win.rect[0] + win.rect[2] / 2, win.rect[1] + win.rect[3] / 2], ins = 30;
          const corners = [[q[0] + ins, q[1] + ins], [q[0] + q[2] - ins, q[1] + ins], [q[0] + ins, q[1] + q[3] - ins], [q[0] + q[2] - ins, q[1] + q[3] - ins]];
          const far = corners.sort((a, b) => Math.hypot(b[0] - wc[0], b[1] - wc[1]) - Math.hypot(a[0] - wc[0], a[1] - wc[1]))[0];
          p = new THREE.Vector3(W(far[0]), 1.55, Z(far[1])); t = new THREE.Vector3(W(wc[0]), 1.15, Z(wc[1]));
        }
      }
      if (!p) { p = new THREE.Vector3(W(q[0] + 30), 1.55, Z(q[1] + q[3] - 30)); t = new THREE.Vector3(W(q[0] + q[2] * .85), 1.15, Z(q[1] + q[3] * .15)); }
      flyTo(p, p.clone().add(t.sub(p).normalize().multiplyScalar(.05)), 1100);
    } else if (current) {
      // back to the room's overview
    }
    placeLamps(); setLayer(layer);
    return true;
  }

  // ---------- progress: rooms fill with colour as things get bought ----------
  function setProgress(map) {
    for (const l of labelEls) {
      const p = map[l.id] || { total: 0, bought: 0 };
      l.el.querySelector('.ct').textContent = p.total ? `${p.bought}/${p.total}` : ''; l.w = 0;
      l.el.dataset.state = !p.total ? 'empty' : p.bought === p.total ? 'done' : p.bought ? 'part' : 'todo';
      const t = tints[l.id]; if (!t) continue;
      const k = p.total ? p.bought / p.total : 0;
      t.forEach(m => { m.visible = k > 0; m.material = k >= 1 ? M.done : M.part; });
    }
  }

  // ---------- layers: plan sheets laid on the floor, and the light points ----------
  const overlays = {};
  const ringMat = new THREE.MeshBasicMaterial({ color: '#f2a33a', transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
  const rings = new THREE.Group(); rings.visible = false; group.add(rings);
  for (const b of bulbs) {
    const r = new THREE.Mesh(new THREE.RingGeometry(.16, .24, 32), ringMat);
    r.rotation.x = -Math.PI / 2; r.position.set(b.pos.x, .035, b.pos.z); rings.add(r);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(.08, 24), ringMat);
    dot.rotation.x = -Math.PI / 2; dot.position.set(b.pos.x, .036, b.pos.z); rings.add(dot);
    const ln = new THREE.Mesh(new THREE.CylinderGeometry(.006, .006, b.pos.y, 6), ringMat);      // floor to bulb
    ln.position.set(b.pos.x, b.pos.y / 2, b.pos.z); rings.add(ln);
  }
  let layer = 'none';
  function addOverlay(name, png, meta) {
    if (overlays[name]) return;
    const [x0, y0, x1, y1] = meta.box;
    const tex = new THREE.TextureLoader().load('data:image/png;base64,' + png);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    const m = new THREE.Mesh(new THREE.PlaneGeometry((x1 - x0) / 100, (y1 - y0) / 100),
      new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));   // drawn over cabinets and wall bases: sockets and taps sit there
    m.rotation.x = -Math.PI / 2; m.position.set(W((x0 + x1) / 2), .04, Z((y0 + y1) / 2)); m.renderOrder = 50; m.visible = false;
    group.add(m); overlays[name] = m;
  }
  function setLayer(name, png, meta) {
    layer = name;
    if (png) addOverlay(name, png, meta);
    for (const k in overlays) overlays[k].visible = k === name && !eye;        // sheets lie on the floor: not at eye level
    rings.visible = name === 'lights';
  }

  // ---------- size, loop ----------
  function resize(w, h) {
    VP.w = w; VP.h = h;
    renderer.setSize(w, h, false); composer.setSize(w, h);
    applyView();
  }
  function setInsets(top, bottom) { VP.top = top; VP.bottom = bottom; applyView(); }
  const v = new THREE.Vector3();
  let frames = 0, slow = 0, last = performance.now();
  function frame(now) {
    const dt = now - last; last = now;
    if (++frames > 30 && frames < 120 && dt > 45) slow++;
    if (frames === 120 && slow > 45) useAO = false;               // weak phone: drop the AO pass
    if (fly) {
      const k = Math.min(1, (now - fly.s) / fly.ms), e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e);
      if (k === 1) fly = null;
    }
    controls.update();
    if (useAO) composer.render(); else renderer.render(scene, camera);
    if (!eye) {                                                    // labels: bigger rooms win where they collide
      const placed = [];
      for (const l of labelOrder) {
        v.copy(l.p).project(camera);
        const x = (v.x * .5 + .5) * VP.w, y = (-v.y * .5 + .5) * VP.h;
        let vis = v.z < 1 && x > 20 && x < VP.w - 20 && y > VP.top + 10 && y < VP.h - VP.bottom - 10;
        if (vis) {
          const w = l.w || (l.w = l.el.offsetWidth), h = l.h || (l.h = l.el.offsetHeight);
          const r = [x - w / 2 - 3, y - h / 2 - 2, x + w / 2 + 3, y + h / 2 + 2];
          if (l.id !== current && placed.some(p => r[0] < p[2] && r[2] > p[0] && r[1] < p[3] && r[3] > p[1])) vis = false; else placed.push(r);
        }
        l.el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        l.el.style.opacity = vis ? (current && current !== l.id ? .55 : 1) : 0;
        l.el.style.pointerEvents = vis ? 'auto' : 'none';
      }
    }
  }
  renderer.setAnimationLoop(frame);

  resize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight);
  camera.fov = mobile ? 50 : 40; applyView();
  camera.position.copy(homeFor()).multiplyScalar(2.1).add(new THREE.Vector3(0, 6, 0)); controls.target.copy(HOME.target);   // arrive from afar: the first move flies in
  placeSun();

  return {
    enterRoom, goHome, setEye, isEye: () => eye, resize, setInsets, setProgress, setLayer,
    setTime(h) { hour = h; placeSun(); }, setSeason(d) { day = d; placeSun(); },
    get hour() { return hour; },
    debug() { return { pos: camera.position.toArray().map(v => +v.toFixed(2)), target: controls.target.toArray().map(v => +v.toFixed(2)), fov: camera.fov, view: camera.view && { ...camera.view }, VP: { ...VP } }; },
    look(from, to) { fly = null; camera.position.set(W(from[0]), from[2] / 100, Z(from[1])); controls.target.set(W(to[0]), to[2] / 100, Z(to[1])); },   // testing: [x, y, height] in cm
    roomMeta(id) { const i = roomInfo[id]; return i && { name: i.r.name, area: i.area, w: i.r.rects.length === 1 ? i.big[2] : null, d: i.r.rects.length === 1 ? i.big[3] : null, floor: i.r.floor, out: i.out }; },
    settle() { if (fly) { camera.position.copy(fly.p1); controls.target.copy(fly.t1); fly = null; } controls.enableDamping = false; frame(performance.now()); frame(performance.now()); controls.enableDamping = true; },
  };
}
