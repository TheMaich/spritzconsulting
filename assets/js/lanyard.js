/*!
 * lanyard.js: the hero card as a 3D lanyard badge on spritzconsulting.com.
 * three.js draws it, Rapier simulates it. The rig follows the Vercel
 * "interactive 3D badge" recipe (rope joints into a spherical joint, kinematic
 * drag), which is also how samfcheng.com builds its badge.
 *
 * The HTML card (.hero-card.is-active) stays in the page. It sets the badge's
 * size and resting place, it is the fallback when anything below fails, and
 * keyboard users get it back on focus. Links drawn on the badge click the real
 * anchors inside it, so Zaraz tracking and Lenis anchor scrolling still run.
 *
 * Needs: /assets/img/lanyard/cards.json and card-{lang}-{theme}.webp, made from
 * the live card (one per language and theme). Regenerate them whenever the card
 * text changes.
 * Off when: no WebGL, ?badge=off, or the modules fail to load.
 * Reduced motion: no drop-in, no idle sway, no tilt input. Drag still works.
 */
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduce = matchMedia('(prefers-reduced-motion: reduce)');
const touchOnly = matchMedia('(hover: none) and (pointer: coarse)');
const phone = matchMedia('(max-width: 900px)');     // phones keep the HTML card

const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.min.js';
const RAPIER_URL = 'https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.14.0/rapier.es.js';
const ASSETS = '/assets/img/lanyard/';

// Values tuned in the lanyard lab.
// size: share of the HTML card's height. topGap and bottomGap (px, desktop) keep the whole badge inside the first screen.
const C = { g: 40, damp: 4.8, yaw: 0.8, size: 0.94, topGap: 60, bottomGap: 40, holeW: 52, strapW: 34, sway: 0.18, tiltRest: -2.5, idle: 0.8, idleT: 5.5 };

const CHIP = { en: 'Tap to let the badge sway', it: 'Tocca per far oscillare il badge' };

function webglOK() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } }

const cardEl = document.querySelector('.hero-card.is-active');
const hero = cardEl && cardEl.closest('.hero');
if (cardEl && hero && !phone.matches && webglOK() && params.get('badge') !== 'off') {
  const go = () => {
    const idle = window.requestIdleCallback || ((f) => setTimeout(f, 300));
    idle(() => {
      Promise.all([
        import(THREE_URL), import(RAPIER_URL),
        fetch(ASSETS + 'cards.json').then((r) => { if (!r.ok) throw new Error('cards.json ' + r.status); return r.json(); }),
        document.fonts.load('64px "Bebas Neue"'), document.fonts.load('400 64px "Bricolage Grotesque"'),
      ]).then(start).catch((e) => { console.warn('[lanyard] staying on the HTML card:', e); });
    }, { timeout: 2500 });
  };
  if (document.readyState === 'complete') go(); else addEventListener('load', go, { once: true });
}

async function start([THREE, RAPIERmod, CARDS]) {
  const RAPIER = RAPIERmod.default || RAPIERmod;
  await RAPIER.init();

  const css = (n) => getComputedStyle(root).getPropertyValue(n).trim();
  const theme = () => (root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  const lang = () => (CARDS[root.lang] ? root.lang : 'en');

  /* ---------- Canvas ---------- */
  const cvs = document.createElement('canvas');
  cvs.className = 'lanyard-canvas';
  cvs.setAttribute('aria-hidden', 'true');
  hero.prepend(cvs);
  const renderer = new THREE.WebGLRenderer({ canvas: cvs, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NoToneMapping;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(18, 1, 0.1, 200);
  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  cvs.addEventListener('webglcontextlost', (e) => { e.preventDefault(); teardown(); });

  /* ---------- Textures ---------- */
  const imgCache = {};
  const loadImg = (key) => imgCache[key] || (imgCache[key] = new Promise((res, rej) => { const i = new Image(); i.decoding = 'async'; i.onload = () => res(i); i.onerror = rej; i.src = ASSETS + 'card-' + key + '.webp'; }));
  function texFrom(src) { const t = new THREE.Texture(src); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso; t.needsUpdate = true; return t; }

  // The slot is punched through the card's top margin, above the portrait. Sizes are in card CSS px (card is 447 wide).
  const HOLE = { cy: 15, h: 11 };
  function punch(x, W) {
    const k = W / 447, hw = C.holeW * k, hh = HOLE.h * k, cy = HOLE.cy * k;
    x.save(); x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.roundRect(W / 2 - hw / 2, cy - hh / 2, hw, hh, hh / 2); x.fill();
    x.restore();
  }
  const frontCv = document.createElement('canvas'), backCv = document.createElement('canvas');
  const frontTex = texFrom(frontCv), backTex = texFrom(backCv);
  let AR = 0.5323;
  function drawFront(img) {
    frontCv.width = img.width; frontCv.height = img.height;
    const x = frontCv.getContext('2d'); x.drawImage(img, 0, 0); punch(x, img.width);
    frontTex.dispose(); frontTex.image = frontCv; frontTex.needsUpdate = true;
  }
  function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }
  // Back of the badge, drawn from the tokens so it follows the theme.
  function drawBack() {
    backCv.width = frontCv.width; backCv.height = frontCv.height;
    const W = backCv.width, H = backCv.height, k = W / 447, x = backCv.getContext('2d');
    x.clearRect(0, 0, W, H);
    rr(x, k, k, W - 2 * k, H - 2 * k, 18 * k); x.fillStyle = css('--paper-3'); x.fill();
    x.save(); x.clip();
    const g = x.createRadialGradient(W * 0.9, 0, 0, W * 0.9, 0, W * 1.2);
    g.addColorStop(0, css('--clay')); g.addColorStop(1, 'transparent');
    x.globalAlpha = 0.12; x.fillStyle = g; x.fillRect(0, 0, W, H); x.globalAlpha = 1; x.restore();
    x.lineWidth = 2 * k; x.strokeStyle = css('--rule'); rr(x, k, k, W - 2 * k, H - 2 * k, 18 * k); x.stroke();
    x.textAlign = 'center'; x.textBaseline = 'alphabetic';
    x.fillStyle = css('--ink'); x.font = `400 ${56 * k}px "Bricolage Grotesque"`;
    const word = 'spritz consulting', ww = x.measureText(word).width;
    x.fillText(word, W / 2 - 8 * k, H * 0.47);
    x.fillStyle = css('--clay'); x.beginPath(); x.arc(W / 2 + ww / 2 + 2 * k, H * 0.47 - 6 * k, 9 * k, 0, Math.PI * 2); x.fill();
    x.fillStyle = css('--ink-2'); x.font = `400 ${22 * k}px "Bebas Neue"`;
    x.fillText('PRODUCTION  &  PUBLISHING  CONSULTANCY', W / 2, H * 0.47 + 46 * k);
    x.fillStyle = css('--clay'); x.font = `400 ${20 * k}px "Bebas Neue"`;
    x.fillText('SPRITZCONSULTING.COM', W / 2, H - 48 * k);
    punch(x, W);
    backTex.dispose(); backTex.image = backCv; backTex.needsUpdate = true;
  }
  // Strap: woven mustard band with the name printed along it. Clay in dark, clay-deep in light.
  const strapCv = document.createElement('canvas'); strapCv.width = 128; strapCv.height = 1024;
  const strapTex = texFrom(strapCv);
  strapTex.wrapT = THREE.RepeatWrapping; strapTex.wrapS = THREE.ClampToEdgeWrapping;
  function drawStrap() {
    const W = 128, H = 1024, x = strapCv.getContext('2d'), light = theme() === 'light';
    const band = css(light ? '--clay-deep' : '--clay'), ink = css(light ? '--paper-3' : '--paper');
    x.globalAlpha = 1; x.fillStyle = band; x.fillRect(0, 0, W, H);
    x.globalAlpha = 0.10; x.fillStyle = css('--paper');
    for (let y = 0; y < H; y += 4) x.fillRect(0, y, W, 1.4);
    x.globalAlpha = 0.28; x.fillRect(0, 0, 6, H); x.fillRect(W - 6, 0, 6, H);
    x.globalAlpha = 0.35; x.setLineDash([10, 7]); x.lineWidth = 2; x.strokeStyle = ink;
    x.beginPath(); x.moveTo(13, 0); x.lineTo(13, H); x.moveTo(W - 13, 0); x.lineTo(W - 13, H); x.stroke(); x.setLineDash([]);
    x.globalAlpha = 1; x.fillStyle = ink;
    x.save(); x.translate(W / 2, H / 2); x.rotate(-Math.PI / 2);
    x.font = '400 66px "Bebas Neue"'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('SPRITZ CONSULTING  ·  ', 0, 4);
    x.restore();
    strapTex.needsUpdate = true;
  }

  /* ---------- Meshes ---------- */
  const badge = new THREE.Group(); scene.add(badge);
  const cardFrontMat = new THREE.MeshBasicMaterial({ map: frontTex, transparent: true, alphaTest: 0.02, toneMapped: false });
  const cardBackMat = new THREE.MeshBasicMaterial({ map: backTex, transparent: true, alphaTest: 0.02, toneMapped: false });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cardFrontMat);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), cardBackMat);
  back.rotation.y = Math.PI;
  badge.add(front, back);
  // Card stock: a thin extruded edge with the same slot, so the card keeps a body when it turns side on.
  const edgeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(), toneMapped: false });
  let edge = null;
  const strapMat = new THREE.MeshBasicMaterial({ map: strapTex, side: THREE.DoubleSide, vertexColors: true, transparent: true, toneMapped: false });
  const N = 72;
  function strapGeo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array((N + 1) * 6), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((N + 1) * 4), 2));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array((N + 1) * 8), 4));
    const idx = []; for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx); return g;
  }
  const strapA = new THREE.Mesh(strapGeo(), strapMat), strapB = new THREE.Mesh(strapGeo(), strapMat);
  strapA.frustumCulled = strapB.frustumCulled = false;
  strapA.renderOrder = 1; strapB.renderOrder = 0;
  scene.add(strapA, strapB);

  /* ---------- Layout: pixels to world units ---------- */
  // The card is always 2.5 units tall, so the physics feel the same at every size.
  const CARD_H = 2.5;
  let L = {};
  // The page scale, read from the zoom on <main> itself, so it is right whichever script ran first.
  function pageK() { const z = parseFloat(getComputedStyle(hero.closest('main') || hero).zoom); return z > 0 ? z : 1; }
  function measure() {
    // frame-fit.js may zoom header and main by K. Rects are on-screen px; styles set inside main are x K.
    const K = pageK();
    const headerEl = document.querySelector('.site-header');
    const headerVis = headerEl ? headerEl.getBoundingClientRect().height : 0;
    const heroR = hero.getBoundingClientRect(), vw = root.clientWidth;
    // Full-width canvas from the page top (under the sticky header) to 260px below the hero.
    Object.assign(cvs.style, { left: -heroR.left / K + 'px', width: vw / K + 'px', top: -headerVis / K + 'px', height: (heroR.height + headerVis) / K + 260 + 'px' });
    const cR = cvs.getBoundingClientRect(), W = cR.width, H = cR.height;
    // The HTML card is rotated by CSS; its rect centre is still right. Its size comes from the deck,
    // which is not rotated and already includes the page zoom and any short-window card scaling.
    const r = cardEl.getBoundingClientRect(), cx = r.left + r.width / 2;
    const dR = (cardEl.closest('.hero-deck') || cardEl).getBoundingClientRect();
    const slotH = dR.height, slotBottom = dR.bottom;
    const mobile = matchMedia('(max-width: 900px)').matches;
    let cardPxH, cardTop;
    if (mobile) {
      // Phones: the card sits where the HTML card ends, below the copy.
      cardPxH = slotH * C.size;
      cardTop = slotBottom - cardPxH;
    } else {
      // Desktop: hang from just under the header, and shrink if needed so the bottom edge stays on screen.
      const fit = innerHeight - headerVis - (C.topGap + C.bottomGap) * K;
      cardPxH = Math.max(slotH * 0.55, Math.min(slotH * C.size, fit));
      cardTop = heroR.top + C.topGap * K;
      // When the hero is framed to the window, the badge centres with the hero copy.
      if (root.classList.contains('frame-fit')) cardTop = Math.max(cardTop, heroR.top + (heroR.height - cardPxH) / 2 + 20 * K);
    }
    const S = cardPxH / CARD_H;
    const toW = (px, py) => ({ x: (px - cR.left - W / 2) / S, y: -(py - cR.top - H / 2) / S });
    const center = toW(cx, cardTop + cardPxH / 2);
    // Desktop: the strap comes from above the page top. Phone: it starts under the buttons and fades in.
    const cta = hero.querySelector('.cta-row');
    const anchorPy = mobile && cta ? Math.min(cta.getBoundingClientRect().bottom + 12, cardTop - 60) : cR.top - 40;
    const anchor = toW(cx, anchorPy);
    // Rest tilt: gravity leans by this angle, so the anchor moves sideways to keep the card's centre in place.
    const rest = THREE.MathUtils.degToRad(-C.tiltRest);
    anchor.x = center.x - (anchor.y - center.y) * Math.tan(rest);
    L = { W, H, S, w: CARD_H * AR, h: CARD_H, center, anchor, mobile, rest, top: toW(0, cR.top).y };
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.set(0, 0, (H / S) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2))));
    camera.updateProjectionMatrix();
  }

  function buildCard() {
    if (edge) { badge.remove(edge); edge.geometry.dispose(); }
    const { w, h } = L, k = w / 447, r = 18 * k, x0 = -w / 2, x1 = w / 2, y0 = -h / 2, y1 = h / 2;
    const s = new THREE.Shape();
    s.moveTo(x0 + r, y0); s.lineTo(x1 - r, y0); s.absarc(x1 - r, y0 + r, r, -Math.PI / 2, 0, false); s.lineTo(x1, y1 - r); s.absarc(x1 - r, y1 - r, r, 0, Math.PI / 2, false);
    s.lineTo(x0 + r, y1); s.absarc(x0 + r, y1 - r, r, Math.PI / 2, Math.PI, false); s.lineTo(x0, y0 + r); s.absarc(x0 + r, y0 + r, r, Math.PI, Math.PI * 1.5, false);
    const hw = C.holeW * k, hh = HOLE.h * k, sy = y1 - HOLE.cy * k, hole = new THREE.Path();
    hole.absarc(-hw / 2 + hh / 2, sy, hh / 2, Math.PI / 2, Math.PI * 1.5, false);
    hole.absarc(hw / 2 - hh / 2, sy, hh / 2, Math.PI * 1.5, Math.PI / 2, false);
    s.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(s, { depth: 0.007, bevelEnabled: false, curveSegments: 12 });
    geo.translate(0, 0, -0.0035);
    edge = new THREE.Mesh(geo, [new THREE.MeshBasicMaterial({ visible: false }), edgeMat]);
    badge.add(edge);
    front.scale.set(w, h, 1); front.position.z = 0.004;
    back.scale.set(w, h, 1); back.position.z = -0.004;
    L.attach = sy + hh * 0.15;                       // card-local point where the strap passes through the slot
  }

  /* ---------- Physics ---------- */
  let world, fixed, j = [], card, lerped = [];
  const NOHIT = 0x00010000;                          // nothing collides; the colliders only give the bodies mass
  function buildWorld(drop) {
    if (world) world.free();
    world = new RAPIER.World({ x: 0, y: -C.g, z: 0 });
    world.timestep = 1 / 60;
    world.numSolverIterations = 8;                   // a firmer rope, so the badge hangs where it is placed
    const { anchor, center, h } = L;
    const attachY = center.y + L.attach;
    // A hanging rope is always taut, so the three segments add up to exactly the anchor-to-slot distance.
    const segLen = Math.max(0.08, (anchor.y - attachY) / 3);
    fixed = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(anchor.x, anchor.y, 0));
    const lift = drop ? (L.mobile ? h * 0.8 : (anchor.y - L.top) + h * 1.6 + 1) : 0;
    const dx = drop ? 0.6 : 0;
    // Start on the tilted line, so a rebuild does not set the badge swinging.
    const ax = center.x - Math.sin(L.rest) * L.attach, ay = center.y + Math.cos(L.rest) * L.attach;
    const seg = (f) => {
      const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(anchor.x + (ax - anchor.x) * f + dx, anchor.y + (ay - anchor.y) * f + lift, 0).setLinearDamping(C.damp).setAngularDamping(C.damp).setCanSleep(true));
      world.createCollider(RAPIER.ColliderDesc.ball(0.1).setCollisionGroups(NOHIT).setSolverGroups(NOHIT), b); return b;
    };
    j = [seg(1 / 3), seg(2 / 3), seg(1)];
    card = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(center.x + dx * 1.4, center.y + lift, 0)
      .setRotation({ x: 0, y: 0, z: Math.sin(L.rest / 2), w: Math.cos(L.rest / 2) })
      .setLinearDamping(C.damp).setAngularDamping(C.damp).setCanSleep(true));
    world.createCollider(RAPIER.ColliderDesc.cuboid(L.w / 2, h / 2, 0.02).setCollisionGroups(NOHIT).setSolverGroups(NOHIT).setDensity(1.4), card);
    const v0 = { x: 0, y: 0, z: 0 };
    world.createImpulseJoint(RAPIER.JointData.rope(segLen, v0, v0), fixed, j[0], true);
    world.createImpulseJoint(RAPIER.JointData.rope(segLen, v0, v0), j[0], j[1], true);
    world.createImpulseJoint(RAPIER.JointData.rope(segLen, v0, v0), j[1], j[2], true);
    world.createImpulseJoint(RAPIER.JointData.spherical(v0, { x: 0, y: L.attach, z: 0 }), j[2], card, true);
    if (drop) card.setAngvel({ x: 0.4, y: 2.2, z: -0.6 }, true);
    lerped = j.map((b) => new THREE.Vector3().copy(b.translation()));
  }
  const wakeAll = () => { card.wakeUp(); j.forEach((b) => b.wakeUp()); };

  /* ---------- Input ---------- */
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0), hitP = new THREE.Vector3();
  let drag = null, press = null, hoverCursor = '';
  function cast(e) {
    const r = cvs.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return r;
  }
  function hitCard(e) {
    if (!active || e.clientY < 0) return null;
    const r = cast(e);
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return null;
    const hits = ray.intersectObjects([front, back, edge], false);
    if (!hits.length) return null;
    return hits.find((x) => x.object === front || x.object === back) || hits[0];
  }
  function linkAt(hit) {
    if (!hit || hit.object !== front || !hit.uv) return null;
    const u = hit.uv.x, v = 1 - hit.uv.y, pad = 0.006;
    return CARDS[lang()].links.find((l) => u >= l.x - pad && u <= l.x + l.w + pad && v >= l.y - pad * 1.6 && v <= l.y + l.h + pad * 1.6) || null;
  }
  // Clicking the real anchor keeps target, rel, Zaraz booking_click and Lenis anchor scrolling.
  function follow(l) { const a = cardEl.querySelectorAll('a')[l.i]; if (a) a.click(); }
  function setCursor(c) { if (c !== hoverCursor) { hoverCursor = c; document.body.style.cursor = c; } }
  function pointerWorld(e, z) { cast(e); plane.constant = -z; return ray.ray.intersectPlane(plane, hitP) ? hitP.clone() : null; }

  function beginDrag(e) {
    const p = pointerWorld(e, card.translation().z);
    if (!p) { press = null; return; }
    const ct = card.translation();
    drag = { z: ct.z, offset: new THREE.Vector3(p.x - ct.x, p.y - ct.y, 0), target: new THREE.Vector3(ct.x, ct.y, ct.z), last: p.clone(), lastT: performance.now(), vel: new THREE.Vector3() };
    press = null;
    wakeAll();
    card.setBodyType(RAPIER.RigidBodyType.KinematicPositionBased, true);
    root.classList.add('lanyard-grabbing');
  }
  function endDrag() {
    if (!drag) return;
    card.setBodyType(RAPIER.RigidBodyType.Dynamic, true);
    const v = drag.vel.clampLength(0, 28);
    card.setLinvel({ x: v.x, y: v.y, z: 0 }, true);
    drag = null;
    root.classList.remove('lanyard-grabbing');
  }
  const letGo = () => { press = null; endDrag(); };

  addEventListener('pointermove', (e) => {
    // A missed pointerup (button released outside the window) shows up as a move with no button held.
    if (drag && e.pointerType === 'mouse' && e.buttons === 0) { endDrag(); return; }
    if (drag) {
      const p = pointerWorld(e, drag.z);
      if (p) { const t = performance.now(); drag.vel.set(p.x - drag.last.x, p.y - drag.last.y, 0).divideScalar(Math.max(1, t - drag.lastT) / 1000); drag.last.copy(p); drag.lastT = t; drag.target.copy(p).sub(drag.offset); }
      return;
    }
    if (press) { if (press.type === 'mouse' && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 5) beginDrag(e); return; }
    if (e.pointerType !== 'mouse') return;
    const h = hitCard(e);
    setCursor(h ? (linkAt(h) ? 'pointer' : 'grab') : '');
  }, { passive: true });
  addEventListener('pointerdown', (e) => {
    if (!active || e.button > 0) return;
    if (e.target.closest && e.target.closest('a, button, input, textarea, select, label, .site-header, .lanyard-chip')) return;
    const h = hitCard(e);
    if (!h) return;
    if (e.pointerType === 'mouse') e.preventDefault();
    press = { x: e.clientX, y: e.clientY, t: performance.now(), hit: h, type: e.pointerType };
  });
  addEventListener('pointerup', (e) => {
    if (drag) { endDrag(); return; }
    if (!press) return;
    const p = press; press = null;
    if (performance.now() - p.t > 600 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 10) return;
    const l = linkAt(p.hit);
    if (l) { follow(l); return; }
    // A tap or click elsewhere on the badge gives it a small push.
    const side = p.hit.point.x - card.translation().x >= 0 ? 1 : -1;
    card.applyImpulseAtPoint({ x: 0, y: 0, z: -0.05 * C.g / 40 }, { x: p.hit.point.x, y: p.hit.point.y, z: p.hit.point.z }, true);
    card.applyImpulse({ x: side * 0.03, y: 0, z: 0 }, true);
  });
  addEventListener('pointercancel', letGo);
  // Leaving the window lets go of the badge.
  root.addEventListener('pointerleave', letGo);
  addEventListener('mouseout', (e) => { if (!e.relatedTarget) letGo(); });
  addEventListener('blur', letGo);
  document.addEventListener('visibilitychange', () => { if (document.hidden) letGo(); });

  // Keyboard users get the HTML card back while focus is inside it.
  cardEl.addEventListener('focusin', () => root.classList.add('lanyard-focus'));
  cardEl.addEventListener('focusout', (e) => { if (!cardEl.contains(e.relatedTarget)) root.classList.remove('lanyard-focus'); });

  /* ---------- Phone sway ---------- */
  let tiltDeg = 0, tiltTarget = 0;
  function onOrient(e) {
    if (e.gamma == null) return;
    const a = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    tiltTarget = a === 90 ? e.beta : (a === -90 || a === 270) ? -e.beta : e.gamma;
  }
  let chip = null;
  if (touchOnly.matches && !reduce.matches) {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS asks for permission, and only after a tap.
      chip = document.createElement('button');
      chip.type = 'button'; chip.className = 'lanyard-chip';
      chip.textContent = CHIP[root.lang] || CHIP.en;
      cardEl.parentElement.appendChild(chip);
      chip.addEventListener('click', () => {
        DeviceOrientationEvent.requestPermission().then((s) => { if (s === 'granted') addEventListener('deviceorientation', onOrient); }).catch(() => {}).finally(() => chip.remove());
      });
    } else { addEventListener('deviceorientation', onOrient); }
  }

  /* ---------- Theme and language ---------- */
  let shownKey = '';
  async function applySkin(rebuildIfNeeded) {
    const key = lang() + '-' + theme();
    if (key !== shownKey) {
      const img = await loadImg(key);
      shownKey = key;
      const newAR = img.width / img.height, changed = Math.abs(newAR - AR) > 0.001;
      AR = newAR;
      drawFront(img);
      if (changed && rebuildIfNeeded) rebuild(false);
    }
    drawBack(); drawStrap();
    edgeMat.color.setStyle(css('--rule'), THREE.SRGBColorSpace);
    if (chip) chip.textContent = CHIP[root.lang] || CHIP.en;
    dirty = true;
  }
  new MutationObserver(() => applySkin(true).catch(() => {})).observe(root, { attributes: true, attributeFilter: ['data-theme', 'lang'] });

  /* ---------- Strap geometry ---------- */
  const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()], false, 'chordal');
  const pts = [], tmp = new THREE.Vector3(), side = new THREE.Vector3(), tan = new THREE.Vector3(), viewZ = new THREE.Vector3(0, 0, 1), up = new THREE.Vector3(), slotPos = new THREE.Vector3();
  for (let i = 0; i <= N; i++) pts.push(new THREE.Vector3());
  function writeStrap(mesh, dir, zOff) {
    const pos = mesh.geometry.attributes.position, uv = mesh.geometry.attributes.uv, colr = mesh.geometry.attributes.color;
    const halfW = (C.strapW * pageK() / 2) / L.S, spread = L.mobile ? 0.22 : 0.42;
    const fadeLen = L.mobile ? 0.45 : 0.08;          // share of the strap that fades in at the top
    let len = 0;
    for (let i = 0; i <= N; i++) {
      const t = i / N;                                // 0 at the slot, 1 at the anchor
      const p = pts[i];
      if (i > 0) len += p.distanceTo(pts[i - 1]);
      curve.getTangent(t, tan);
      side.crossVectors(tan, viewZ).normalize();
      if (side.lengthSq() < 0.5) side.set(1, 0, 0);
      // V: the two strands meet in the slot and open up towards the top. One runs in front of the card, one behind.
      const off = dir * spread * Math.pow(t, 1.15) + dir * halfW * 0.55 * Math.min(1, t * 8);
      const cx = p.x + off + up.x * zOff, cy = p.y + up.y * zOff, cz = p.z + up.z * zOff;
      const k = i * 2;
      pos.setXYZ(k, cx - side.x * halfW, cy - side.y * halfW, cz);
      pos.setXYZ(k + 1, cx + side.x * halfW, cy + side.y * halfW, cz);
      const v = len / (halfW * 16);                   // one print repeat every 8 strap widths
      uv.setXY(k, 0, v); uv.setXY(k + 1, 1, v);
      const a = t > 1 - fadeLen ? Math.max(0, (1 - t) / fadeLen) : 1;
      const shade = dir < 0 ? 0.86 : 1;
      colr.setXYZW(k, shade, shade, shade, a); colr.setXYZW(k + 1, shade, shade, shade, a);
    }
    pos.needsUpdate = uv.needsUpdate = colr.needsUpdate = true;
  }

  /* ---------- Loop ---------- */
  let active = false, dirty = true, visible = true, acc = 0, lastT = performance.now(), idleClock = 0, raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    if (!visible || document.hidden || root.classList.contains('lanyard-focus')) return;

    // Gravity sets the pose: a fixed lean, a slow idle sway, and the phone tilt on top.
    tiltDeg += (tiltTarget - tiltDeg) * Math.min(1, dt * 6);
    const tilt = THREE.MathUtils.clamp(tiltDeg, -45, 45) / 45;
    const idleOn = C.idle > 0 && !reduce.matches && !drag;
    if (idleOn) idleClock += dt;
    const w = (Math.PI * 2) / C.idleT, amp = THREE.MathUtils.degToRad(C.idle);
    const idleA = idleOn ? amp * Math.sin(idleClock * w) : 0;
    const idleZ = idleOn ? amp * 0.6 * Math.sin(idleClock * w * 0.73 + 1.1) : 0;
    const ang = L.rest + idleA + (reduce.matches ? 0 : tilt * C.sway);
    world.gravity = { x: Math.sin(ang) * C.g, y: -Math.cos(ang) * C.g, z: idleZ * C.g };
    if (idleOn || drag || Math.abs(tiltTarget - tiltDeg) > 0.2) wakeAll();
    if (drag) card.setNextKinematicTranslation({ x: drag.target.x, y: drag.target.y, z: drag.target.z });

    if (!drag && !dirty && card.isSleeping() && j.every((b) => b.isSleeping())) return;
    dirty = false;

    acc += dt;
    let n = 0;
    while (acc >= world.timestep && n < 4) {
      // Turn the badge back towards the viewer, as the Vercel badge does.
      const av = card.angvel(), rot = card.rotation();
      if (!drag) card.setAngvel({ x: av.x, y: av.y - rot.y * C.yaw, z: av.z }, false);
      world.step(); acc -= world.timestep; n++;
    }
    if (n === 4) acc = 0;

    const ct = card.translation(), cr = card.rotation();
    badge.position.set(ct.x, ct.y, ct.z);
    badge.quaternion.set(cr.x, cr.y, cr.z, cr.w);
    // A little darker as it turns away, so it reads as an object.
    up.set(0, 0, 1).applyQuaternion(badge.quaternion);
    const f = 0.8 + 0.2 * Math.abs(up.z);
    cardFrontMat.color.setScalar(f); cardBackMat.color.setScalar(f);

    // Smooth the two upper joints for drawing only, which hides solver jitter.
    for (let i = 0; i < 2; i++) {
      const tr = j[i].translation(); tmp.set(tr.x, tr.y, tr.z);
      const d = Math.max(0.1, Math.min(1, lerped[i].distanceTo(tmp)));
      lerped[i].lerp(tmp, Math.min(1, dt * (10 + d * 40)));
    }
    slotPos.set(0, L.attach, 0).applyQuaternion(badge.quaternion).add(badge.position);
    const fa = fixed.translation();
    curve.points[0].copy(slotPos);
    curve.points[1].copy(lerped[1]);
    curve.points[2].copy(lerped[0]);
    curve.points[3].set(fa.x, fa.y, fa.z);
    curve.getPoints(N).forEach((p, i) => pts[i].copy(p));
    writeStrap(strapB, -1, -0.012);
    writeStrap(strapA, 1, 0.012);
    renderer.render(scene, camera);
  }

  function rebuild(drop) { measure(); buildCard(); buildWorld(drop && !reduce.matches); dirty = true; }

  let rz;
  const ro = new ResizeObserver(() => { clearTimeout(rz); rz = setTimeout(() => { if (!drag) rebuild(false); }, 120); });
  const io = new IntersectionObserver((es) => { visible = es[0].isIntersecting; lastT = performance.now(); dirty = true; }, { rootMargin: '0px 0px 260px 0px' });

  function teardown() {
    active = false; cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    root.classList.remove('has-lanyard', 'lanyard-grabbing', 'lanyard-focus');
    if (chip) chip.remove();
    setCursor(''); cvs.remove();
  }

  await applySkin(false);
  // Wait for the hero reveal to finish, so the HTML card is in its final place before it is measured.
  await new Promise((r) => setTimeout(r, 400));
  root.classList.add('has-lanyard');                 // CSS hides the HTML card and adds the phone strap room
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  rebuild(true);
  ro.observe(hero); io.observe(hero);
  // frame-fit.js changes the page scale and the hero frame: measure again.
  addEventListener('framefit', () => { if (active && !drag) rebuild(false); });
  // A desktop window narrowed to phone width goes back to the HTML card.
  phone.addEventListener('change', (e) => { if (e.matches) teardown(); });
  // The desktop size also depends on the window height, which can change without the hero changing.
  let lastH = innerHeight;
  addEventListener('resize', () => { if (!active || L.mobile || Math.abs(innerHeight - lastH) < 2) return; lastH = innerHeight; clearTimeout(rz); rz = setTimeout(() => { if (!drag) rebuild(false); }, 120); });
  active = true;
  window.__lanyard = { get card() { return card; }, get L() { return L; }, camera, front, linkAt, hitCard, teardown };
  raf = requestAnimationFrame((t) => { lastT = t; frame(t); });
}
