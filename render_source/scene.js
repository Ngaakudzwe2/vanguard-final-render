// Vanguard Digital — deterministic WebGL2 / Three.js fly-over.
// Everything time-dependent is a pure function of t, driven by cutlist.json + layers.json.
// No timers, no requestAnimationFrame loop, no CSS transitions: render = seek(t).
import * as THREE from 'three';

THREE.ColorManagement.enabled = false;
const CL = await (await fetch('cutlist.json')).json();
const LY = await (await fetch('layers.json')).json();
const [W, H] = CL.resolution;
const [PAGE_W, PAGE_H] = LY.capture.page_css;
const FONT = CL.global.font;

// ---------- allowed-text guard: nothing is drawn unless the cut list allows it ----------
const ALLOWED = new Set(CL.beats.flatMap(b => b.allowed_text));
const drawnText = [];
function allow(str) {
  if (!ALLOWED.has(str)) throw new Error('Text not in cutlist allowed_text: ' + str);
  drawnText.push(str); return str;
}

// ---------- renderer ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H);
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
document.body.appendChild(renderer.domElement);
const ANISO = renderer.capabilities.getMaxAnisotropy();
const gl = renderer.getContext();

// ---------- helpers ----------
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const sstep = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a, b, t) => a + (b - a) * t;
const hash = i => { const s = Math.sin(i * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
const hex = h => new THREE.Color(h);
const wx = px => px - PAGE_W / 2;
const wy = py => PAGE_H / 2 - py;

function setupTex(tex) {
  tex.colorSpace = THREE.NoColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = ANISO;
  tex.premultiplyAlpha = true;
  tex.needsUpdate = true;
  return tex;
}
async function loadImage(src) { const im = new Image(); im.src = src; await im.decode(); return im; }
async function texFromSrc(src) { const im = await loadImage(src); return { tex: setupTex(new THREE.Texture(im)), img: im }; }
function texFromCanvas(c) { return setupTex(new THREE.CanvasTexture(c)); }
function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w); c.height = Math.ceil(h); return c; }
function rrect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); }

// ---------- shaders ----------
const SDF = `
float sdRoundBox(vec2 p, vec2 b, float r){ vec2 q = abs(p) - b + r; return length(max(q,0.0)) + min(max(q.x,q.y),0.0) - r; }
`;
const NRECT = 6;
const pageMat = new THREE.ShaderMaterial({
  transparent: true, depthTest: false, depthWrite: false,
  blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
  uniforms: {
    tSharp: { value: null }, tBlurA: { value: null }, tBlurB: { value: null },
    uPage: { value: new THREE.Vector2(PAGE_W, PAGE_H) }, uRadius: { value: CL.global.page_corner_radius_px },
    uRects: { value: Array.from({ length: NRECT }, () => new THREE.Vector4()) },
    uW: { value: new Array(NRECT).fill(0) },
    uBlurMax: { value: 0 }, uRectPresence: { value: 0 }, uTilt: { value: new THREE.Vector3(0, 220, 700) },
    uHaze: { value: 0 }, uFloor: { value: hex(CL.global.floor[0]) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `
    precision highp float;
    varying vec2 vUv;
    uniform sampler2D tSharp, tBlurA, tBlurB;
    uniform vec2 uPage; uniform float uRadius;
    uniform vec4 uRects[${NRECT}]; uniform float uW[${NRECT}];
    uniform float uBlurMax, uRectPresence, uHaze; uniform vec3 uTilt; uniform vec3 uFloor;
    ${SDF}
    float insideSoft(vec2 p, vec4 r, float f){
      vec2 c = r.xy + r.zw*0.5; float d = sdRoundBox(p - c, r.zw*0.5, 0.0);
      return 1.0 - smoothstep(0.0, f, d);
    }
    void main(){
      vec2 px = vec2(vUv.x*uPage.x, (1.0-vUv.y)*uPage.y);
      float d = sdRoundBox(px - uPage*0.5, uPage*0.5, uRadius);
      float aa = max(fwidth(d), 0.5);
      float a = 1.0 - smoothstep(-aa, aa, d);
      float sharp = 0.0;
      for (int i=0;i<${NRECT};i++) sharp = max(sharp, uW[i]*insideSoft(px, uRects[i], 90.0));
      float tilt = smoothstep(uTilt.y, uTilt.z, abs(px.y - uTilt.x));
      float blur = uBlurMax * mix(tilt, 1.0 - sharp, uRectPresence);
      vec4 s = texture2D(tSharp, vUv);
      vec4 ba = texture2D(tBlurA, vUv);
      vec4 bb = texture2D(tBlurB, vUv);
      vec3 col = blur < 0.5 ? mix(s.rgb, ba.rgb, blur*2.0) : mix(ba.rgb, bb.rgb, blur*2.0-1.0);
      // premultiplied textures on an opaque page: divide out alpha safely
      float alpha = a * (1.0 - uHaze);
      col = mix(col, uFloor, uHaze*0.6);
      gl_FragColor = vec4(col*alpha, alpha);
    }`,
});

function layerMaterial(tex, w, h, radius = 0) {
  return new THREE.ShaderMaterial({
    transparent: true, depthTest: false, depthWrite: false,
    blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      map: { value: tex }, uSize: { value: new THREE.Vector2(w, h) }, uRadius: { value: radius },
      uAlpha: { value: 1 }, uBias: { value: 0 }, uClip: { value: new THREE.Vector3(-1e5, 1e5, 1) },
      uTint: { value: 0 }, uFloor: { value: hex(CL.global.floor[0]) },
    },
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `
      precision highp float;
      varying vec2 vUv; varying vec3 vW;
      uniform sampler2D map; uniform vec2 uSize; uniform float uRadius, uAlpha, uBias, uTint; uniform vec3 uClip; uniform vec3 uFloor;
      ${SDF}
      void main(){
        vec4 c = texture2D(map, vUv, uBias);
        float a = uAlpha;
        if (uRadius > 0.0) { vec2 p = (vUv-0.5)*uSize; float d = sdRoundBox(p, uSize*0.5, uRadius); float aa = max(fwidth(d),0.5); a *= 1.0 - smoothstep(-aa, aa, d); }
        float px = vW.x + ${PAGE_W / 2}.0;
        a *= smoothstep(uClip.x, uClip.x + uClip.z, px) * (1.0 - smoothstep(uClip.y - uClip.z, uClip.y, px));
        gl_FragColor = c * a;
      }`,
  });
}

// soft shadow texture (generic blurred rounded rect, stretched per layer)
function shadowCanvas() {
  const c = canvas(256, 256), x = c.getContext('2d');
  x.filter = 'blur(26px)'; x.fillStyle = 'rgba(16,24,40,1)'; rrect(x, 64, 64, 128, 128, 22); x.fill();
  return c;
}
const SHADOW_TEX = texFromCanvas(shadowCanvas());

// ---------- scene graph ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(CL.global.fov_deg, W / H, 10, 20000);

// floor: screen-space radial studio gradient
const bgScene = new THREE.Scene(); const bgCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const bgMat = new THREE.ShaderMaterial({
  depthTest: false, depthWrite: false,
  uniforms: { c0: { value: hex(CL.global.floor[0]) }, c1: { value: hex(CL.global.floor[1]) }, aspect: { value: W / H } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }`,
  fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 c0, c1; uniform float aspect;
    void main(){ vec2 p = (vUv-0.5)*vec2(aspect,1.0); float r = length(p)/length(vec2(aspect,1.0)*0.5);
      gl_FragColor = vec4(mix(c0, c1, smoothstep(0.15, 1.0, r)), 1.0); }`,
});
bgScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bgMat));

// --- page plate (sharp + 2 pre-blurred levels for focus pulls / DOF)
const basePageImg = await loadImage('base_page.png');
function blurredCanvas(img, px) { const c = canvas(img.width, img.height), x = c.getContext('2d'); x.filter = `blur(${px}px)`; x.drawImage(img, 0, 0); return c; }
pageMat.uniforms.tSharp.value = setupTex(new THREE.Texture(basePageImg));
pageMat.uniforms.tBlurA.value = texFromCanvas(blurredCanvas(basePageImg, 5));
pageMat.uniforms.tBlurB.value = texFromCanvas(blurredCanvas(basePageImg, 14));
const page = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W, PAGE_H), pageMat);
page.renderOrder = 10; scene.add(page);

// page shadow: soft wide
const pageShadowC = (() => { const pad = 260, c = canvas((PAGE_W + pad * 2) / 2, (PAGE_H + pad * 2) / 2), x = c.getContext('2d');
  x.filter = 'blur(55px)'; x.fillStyle = 'rgba(20,30,52,0.20)'; rrect(x, pad / 2, pad / 2 + 18, PAGE_W / 2, PAGE_H / 2, 12); x.fill(); return c; })();
const pageShadowMat = layerMaterial(texFromCanvas(pageShadowC), PAGE_W + 520, PAGE_H + 520, 0);
const pageShadow = new THREE.Mesh(new THREE.PlaneGeometry(PAGE_W + 520, PAGE_H + 520), pageShadowMat);
pageShadow.position.set(0, 0, -2); pageShadow.renderOrder = 5; scene.add(pageShadow);

// --- generic floating layer
const layers = [];
let orderSeq = 100;
function addLayer({ id, tex, w, h, cx, cy, radius = 0, shadow = true, shadowRadius }) {
  const mat = layerMaterial(tex, w, h, radius);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  scene.add(mesh);
  let sh = null;
  if (shadow) { sh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), layerMaterial(SHADOW_TEX, 1, 1, 0)); scene.add(sh); }
  const L = { id, mesh, mat, sh, w, h, cx, cy, z: 0, alpha: 1, bias: 0, scale: 1, base: orderSeq, clip: null, visible: true };
  orderSeq += 4; layers.push(L); return L;
}
function placeLayer(L) {
  const vis = L.visible && L.alpha > 0.001;
  L.mesh.visible = vis;
  L.mesh.position.set(wx(L.cx), wy(L.cy), L.z + 0.5);
  L.mesh.scale.setScalar(L.scale);
  L.mesh.rotation.x = L.face || 0; // floating marks turn toward the lens as they rise (keeps marks square to camera)
  L.mat.uniforms.uAlpha.value = L.alpha; L.mat.uniforms.uBias.value = L.bias;
  if (L.clip) L.mat.uniforms.uClip.value.set(...L.clip); else L.mat.uniforms.uClip.value.set(-1e5, 1e5, 1);
  L.mesh.renderOrder = L.base + 2 + Math.round(L.z * 0);
  if (L.sh) {
    const lift = L.z, f = clamp(lift / 40);
    const sa = L.alpha * (0.10 + 0.22 * f) * (L.shadowBoost || 1);
    L.sh.visible = vis && sa > 0.003;
    const grow = 1 + 0.06 + 0.12 * f;
    // shadow texture: rect occupies the central half of the texture
    L.sh.scale.set(L.w * L.scale * 2 * grow, L.h * L.scale * 2 * grow, 1);
    L.sh.position.set(wx(L.cx), wy(L.cy + 6 + lift * 0.45), 0.2 + L.z * 0.02);
    L.sh.material.uniforms.uAlpha.value = sa;
    if (L.clip) L.sh.material.uniforms.uClip.value.set(...L.clip); else L.sh.material.uniforms.uClip.value.set(-1e5, 1e5, 1);
    L.sh.renderOrder = L.base;
  }
}

// --- page layers from layers.json
const LYR = LY.layers;
const pageLayer = async (id, file, box, radius, opts = {}) => {
  const { tex } = await texFromSrc(file);
  return addLayer({ id, tex, w: box.w, h: box.h, cx: box.x + box.w / 2, cy: box.y + box.h / 2, radius, ...opts });
};

// hero card (CTA) — hero imagery, text hidden
const heroBox = LYR.hero.box;
const heroCard = await pageLayer('hero_card', LYR.hero.file, heroBox, 0);
heroCard.shadowBoost = 2.2;

// official Vanguard logo in the header slot (aspect preserved)
const logoAsset = await loadImage(CL.floating_layers.vanguard_logo.asset);
const logoTex = setupTex(new THREE.Texture(logoAsset));
const ls = LYR.header_logo_slot.box; const lside = Math.min(ls.w, ls.h);
const headerLogo = addLayer({ id: 'header_logo', tex: logoTex, w: lside, h: lside, cx: ls.x + ls.w / 2, cy: ls.y + ls.h / 2, radius: 6, shadow: false });

// store tiles: two instances per unique tile to wrap the marquee loop seamlessly
const MQ = CL.marquee, MASK = LYR.store_marquee_mask.box;
const fadePx = MASK.w * LYR.store_marquee_mask.fade_edge_pct / 100;
const tiles = [];
for (const T of LYR.store_tiles) {
  const { tex } = await texFromSrc(T.file);
  const inst = [0, 1].map(k => addLayer({ id: T.id + '_' + k, tex, w: T.box.w, h: T.box.h, cx: 0, cy: T.box.y + T.box.h / 2, radius: T.name === 'HomeHaul' ? 12 : 6 }));
  inst.forEach(L => { L.clip = [MASK.x, MASK.x + MASK.w, fadePx]; });
  tiles.push({ T, inst });
}
const marqueeOffset = t => MQ.offset_at_t0_px + MQ.speed_px_s * t;
function tileX(T, t, k) { // page-x of tile centre for instance k
  const rel = (((T.track_offset_px - marqueeOffset(t)) % MQ.loop_px) + MQ.loop_px) % MQ.loop_px;
  return MASK.x + rel - (k ? MQ.loop_px : 0) + T.box.w / 2;
}
const inMask = (x, margin = 0) => x > MASK.x + fadePx + margin && x < MASK.x + MASK.w - fadePx - margin;

// trending product cards, trust cards, start shopping button
const cards = {}; for (const C of LYR.product_cards) cards[C.id] = await pageLayer(C.id, C.file, C.box, 12);
const trust = []; for (const C of LYR.trust_cards) trust.push(await pageLayer(C.id, C.file, C.box, 16));
const btn = await pageLayer('start_shopping_btn', LYR.start_shopping_btn.file, LYR.start_shopping_btn.box, 8);

// ---------- floating asset layers ----------
const FL = CL.floating_layers;
const S = 3; // canvas supersampling for crisp marks/text
async function chipLayer(id, asset, chipW, chipH, logoH, cx, cy, subText) {
  const img = await loadImage(asset);
  const c = canvas(chipW * S, chipH * S), x = c.getContext('2d');
  x.fillStyle = '#ffffff'; rrect(x, 0, 0, c.width, c.height, 18 * S); x.fill();
  const ar = img.naturalWidth / img.naturalHeight;
  let lh = logoH, lw = lh * ar; const maxW = chipW - 28; if (lw > maxW) { lw = maxW; lh = lw / ar; }
  const ly = subText ? (chipH - lh - 26) / 2 : (chipH - lh) / 2;
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, (chipW - lw) / 2 * S, ly * S, lw * S, lh * S); // uniform scale: aspect preserved
  if (subText) { x.fillStyle = '#5b6472'; x.font = `500 ${14 * S}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'alphabetic'; x.fillText(allow(subText), c.width / 2, (ly + lh + 24) * S); }
  return addLayer({ id, tex: texFromCanvas(c), w: chipW, h: chipH, cx, cy, radius: 18 });
}
const smile = await chipLayer('smile_and_pay_logo', FL.smile_and_pay_logo.asset, ...FL.smile_and_pay_logo.chip, FL.smile_and_pay_logo.logo_h, ...FL.smile_and_pay_logo.center, 'by ZB Bank');
const PL = FL.payment_logos; const payChips = [];
for (let i = 0; i < PL.items.length; i++) {
  const it = PL.items[i]; const cx = lerp(PL.row_x[0], PL.row_x[1], i / (PL.items.length - 1));
  const L = await chipLayer('pay_' + it.name, it.asset, ...PL.chip, it.logo_h || PL.logo_h, cx, PL.row_y);
  L.name = it.name; payChips.push(L);
}
async function imageCard(id, spec) { const { tex } = await texFromSrc(spec.asset); return addLayer({ id, tex, w: spec.size[0], h: spec.size[1], cx: spec.center[0], cy: spec.center[1], radius: spec.radius }); }
const trackUI = await imageCard('track_order_ui', FL.track_order_ui);
const waUI = await imageCard('whatsapp_phone_mockup', FL.whatsapp_phone_mockup);
const dashUI = await imageCard('runner_network_dashboard', FL.runner_network_dashboard);
[trackUI, waUI, dashUI].forEach(L => L.shadowBoost = 1.6);

// captions for Tech sourcing / HomeHaul (small, on the tile)
function wrap(x, text, maxW) { const words = text.split(' '); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? cur + ' ' + w : w; if (x.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; } if (cur) lines.push(cur); return lines; }
function captionLayer(id, spec) {
  const cw = 292, pad = 14, fs = 12.5, lh = 17.5;
  const meas = canvas(10, 10).getContext('2d'); meas.font = `500 ${fs}px ${FONT}`;
  const lines = spec.lines.flatMap(l => wrap(meas, allow(l), cw - pad * 2));
  const chipH = spec.chip ? 26 : 0, noteH = spec.note_line ? 20 : 0;
  const ch = pad + chipH + lines.length * lh + noteH + pad - 4;
  const c = canvas(cw * S, ch * S), x = c.getContext('2d'); x.scale(S, S);
  x.fillStyle = '#ffffff'; rrect(x, 0, 0, cw, ch, 12); x.fill();
  x.strokeStyle = 'rgba(15,23,42,0.08)'; x.lineWidth = 1; rrect(x, 0.5, 0.5, cw - 1, ch - 1, 12); x.stroke();
  let y = pad;
  if (spec.chip) { const t = allow(spec.chip); x.font = `600 11.5px ${FONT}`; const tw = x.measureText(t).width + 18;
    x.fillStyle = '#fff4d6'; rrect(x, pad, y, tw, 20, 10); x.fill(); x.strokeStyle = '#f2c55c'; rrect(x, pad + 0.5, y + 0.5, tw - 1, 19, 10); x.stroke();
    x.fillStyle = '#8a5a00'; x.textBaseline = 'middle'; x.fillText(t, pad + 9, y + 10.5); y += chipH; }
  x.fillStyle = '#1f2937'; x.font = `500 ${fs}px ${FONT}`; x.textBaseline = 'top';
  for (const l of lines) { x.fillText(l, pad, y); y += lh; }
  if (spec.note_line) { x.fillStyle = '#6b7280'; x.font = `italic 500 11.5px ${FONT}`; x.fillText(allow(spec.note_line), pad, y + 3); }
  const L = addLayer({ id, tex: texFromCanvas(c), w: cw, h: ch, cx: 0, cy: 0, radius: 12 });
  return L;
}
const beat = id => CL.beats.find(b => b.id === id);
const TH = beat('use_tech_homehaul');
const capTech = captionLayer('tech_caption', TH.overlay_text.find(o => o.id === 'tech_caption'));
const capHome = captionLayer('homehaul_caption', TH.overlay_text.find(o => o.id === 'homehaul_caption'));

// CTA text + badge pill
const CTA = beat('cta_card');
function textLayer(id, text, size, weight, color, cx, cy, maxW = 1200) {
  const meas = canvas(10, 10).getContext('2d'); meas.font = `${weight} ${size}px ${FONT}`;
  const tw = Math.min(maxW, Math.ceil(meas.measureText(allow(text)).width) + 8), th = Math.ceil(size * 1.35);
  const c = canvas(tw * S, th * S), x = c.getContext('2d'); x.scale(S, S);
  x.font = `${weight} ${size}px ${FONT}`; x.fillStyle = color; x.textBaseline = 'middle'; x.fillText(text, 2, th / 2);
  return addLayer({ id, tex: texFromCanvas(c), w: tw, h: th, cx: cx + tw / 2, cy, shadow: false });
}
const hx = LYR.start_shopping_btn.box.x; // align with the real hero text column
const pillW = 176, pillH = 104;
const pill = (() => { const c = canvas(pillW * S, pillH * S), x = c.getContext('2d'); x.fillStyle = '#fff'; rrect(x, 0, 0, c.width, c.height, pillH / 2 * S); x.fill();
  const s = 96; x.imageSmoothingQuality = 'high'; x.drawImage(logoAsset, (pillW - s) / 2 * S, (pillH - s) / 2 * S, s * S, s * S);
  return addLayer({ id: 'logo_badge_pill', tex: texFromCanvas(c), w: pillW, h: pillH, cx: hx + pillW / 2, cy: heroBox.y + 128, radius: pillH / 2 }); })();
const ctaHead = textLayer('cta_headline', CTA.overlay_text.find(o => o.id === 'cta_headline').text, 70, 700, '#ffffff', hx, heroBox.y + 268);
const ctaSup = textLayer('cta_support', CTA.overlay_text.find(o => o.id === 'cta_support').text, 27, 500, 'rgba(255,255,255,0.92)', hx, heroBox.y + 340);
const ctaUrl = textLayer('cta_url', CTA.overlay_text.find(o => o.id === 'cta_url').text, 23, 600, '#8fdcff', hx, heroBox.y + 560);
allow('Start shopping'); // the real captured button (pixels from the live page)

// ---------- render order (bottom → top) ----------
const ORDER = [heroCard, headerLogo, ...tiles.flatMap(t => t.inst), ...Object.values(cards), ...trust, btn,
  capTech, capHome, smile, ...payChips, dashUI, trackUI, waUI, pill, ctaHead, ctaSup, ctaUrl];
ORDER.forEach((L, i) => { L.base = 100 + i * 4; });

// ---------- timing utilities ----------
function pchip(xs, ys) { // Fritsch–Carlson monotone cubic, zero end slopes (ease in/out)
  const n = xs.length, h = [], d = [], m = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) { h[i] = xs[i + 1] - xs[i]; d[i] = (ys[i + 1] - ys[i]) / h[i]; }
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else { const w1 = 2 * h[i] + h[i - 1], w2 = h[i] + 2 * h[i - 1]; m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]); }
  }
  return t => {
    if (t <= xs[0]) return ys[0]; if (t >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (t > xs[i + 1]) i++;
    const s = (t - xs[i]) / h[i], s2 = s * s, s3 = s2 * s;
    return (2 * s3 - 3 * s2 + 1) * ys[i] + (s3 - 2 * s2 + s) * h[i] * m[i] + (-2 * s3 + 3 * s2) * ys[i + 1] + (s3 - s2) * h[i] * m[i + 1];
  };
}
const K = CL.camera.keys, KT = K.map(k => k.t);
const camY = pchip(KT, K.map(k => k.target_y)), camD = pchip(KT, K.map(k => k.dist)), camP = pchip(KT, K.map(k => k.pitch_deg));

// envelope: rise over [t0, t0+rise], hold, settle over [hold, hold+fall]
function liftEnv(t, t0, t1, holdUntil, riseFrac = 0.45) {
  const rise = Math.max(0.12, (t1 - t0) * riseFrac);
  const end = holdUntil ?? t1; const fall = holdUntil ? 0.35 : Math.max(0.12, (t1 - t0) * 0.3);
  const settleStart = holdUntil ? holdUntil : t1 - fall;
  return sstep(t0, t0 + rise, t) * (1 - sstep(settleStart, settleStart + fall, t));
}
const envBeat = (b, t) => sstep(b.t[0] - 0.22, b.t[0] + 0.22, t) * (1 - sstep(b.t[1] - 0.22, b.t[1] + 0.22, t));
const lift = (b, name) => b.lifts.find(l => l.layer === name);

// focus rect registry (names → page rects from layers.json)
const RECTS = { hero: heroBox, header_logo_slot: LYR.header_logo_slot.box, store_marquee_mask: MASK, landed_price_line: LYR.landed_price_line.box,
  trending_section: LYR.trending_section.box, trust_section: LYR.trust_section.box };
const RECT_NAMES = Object.keys(RECTS);
RECT_NAMES.forEach((n, i) => { const r = RECTS[n]; pageMat.uniforms.uRects.value[i].set(r.x, r.y, r.w, r.h); });
for (const b of CL.beats) for (const f of b.focus) if (!RECTS[f.rect]) throw new Error('focus rect missing from layers.json: ' + f.rect);

function focusState(t) {
  const w = new Array(NRECT).fill(0); let bm = 0, bsum = 0, presence = 0;
  const soft = CL.beats.find(b => b.soft_page_from !== undefined);
  for (const b of CL.beats) {
    let e = envBeat(b, t);
    if (soft && b !== soft && t > soft.soft_page_from - 0.3 && t < soft.t[1]) e *= 1 - sstep(soft.soft_page_from - 0.2, soft.soft_page_from + 0.1, t);
    bm += e * b.blur_max; bsum += e;
    let any = 0;
    for (const f of b.focus) {
      // a ramped focus pull owns its own timing (it starts sharpening before the beat envelope is fully up)
      const fe = f.ramp ? sstep(f.ramp[0], f.ramp[1], t) * (1 - sstep(b.t[1] - 0.22, b.t[1] + 0.22, t)) : e;
      const i = RECT_NAMES.indexOf(f.rect); w[i] = Math.max(w[i], fe * f.weight); any = 1;
    }
    presence = Math.max(presence, any ? e : (b.soft_page_from !== undefined ? e : 0));
  }
  return { w, blurMax: bsum > 0 ? bm / bsum : 0, presence };
}
function pageBlurAt(px, py, F, tiltY) { // CPU mirror of the page shader (used for page-layer mip bias)
  let sharp = 0;
  RECT_NAMES.forEach((n, i) => { const r = RECTS[n]; const dx = Math.max(r.x - px, 0, px - (r.x + r.w)), dy = Math.max(r.y - py, 0, py - (r.y + r.h));
    sharp = Math.max(sharp, F.w[i] * (1 - sstep(0, 90, Math.hypot(dx, dy)))); });
  const tilt = sstep(220, 700, Math.abs(py - tiltY));
  return F.blurMax * lerp(tilt, 1 - sharp, F.presence);
}

// pre-compute which live tiles lift in use_platforms (only those inside the mask, in cut-list order)
const UP = beat('use_platforms'), upL = UP.lifts[0];
const upTiles = upL.order.map(n => tiles.find(x => x.T.name === n)).filter(x => x && x.T.status === 'live')
  .filter(x => [0, 1].some(k => inMask(tileX(x.T, upL.t[0] + 0.3, k), 10) && inMask(tileX(x.T, upL.t[1] - 0.2, k), 0)));

// ---------- seek(t) ----------
function seek(t) {
  t = clamp(t, 0, CL.duration_s);
  // camera: target x locked, no roll / yaw — only glide, tilt and dolly
  const ty = camY(t), dist = camD(t), pitch = THREE.MathUtils.degToRad(camP(t));
  const target = new THREE.Vector3(wx(CL.camera.target_x_px), wy(ty), 0);
  camera.position.set(target.x, target.y - Math.sin(pitch) * dist, Math.cos(pitch) * dist);
  camera.up.set(0, 1, 0); camera.lookAt(target); camera.updateMatrixWorld();

  // focus / DOF
  const F = focusState(t);
  pageMat.uniforms.uW.value = F.w; pageMat.uniforms.uBlurMax.value = F.blurMax; pageMat.uniforms.uRectPresence.value = F.presence;
  pageMat.uniforms.uTilt.value.set(ty - 60, 220, 700);
  const bOf = (cx, cy) => pageBlurAt(cx, cy, F, ty - 60) * 2.6; // → mip bias

  // CTA haze + hero card
  const cb = beat('cta_card');
  const haze = sstep(cb.haze.t[0], cb.haze.t[1], t) * cb.haze.amount;
  pageMat.uniforms.uHaze.value = haze;
  pageShadowMat.uniforms.uAlpha.value = 1 - haze;
  const hc = sstep(cb.hero_card.t[0], cb.hero_card.t[0] + cb.hero_card.fade_s, t), hcLift = sstep(cb.hero_card.t[0], cb.hero_card.t[1], t);
  heroCard.alpha = hc; heroCard.z = cb.hero_card.dz_px * hcLift; heroCard.mat.uniforms.uRadius.value = cb.hero_card.radius_px * hcLift; heroCard.bias = 0;
  const outside = 1 - haze; // everything outside the hero fades into haze

  headerLogo.alpha = outside; headerLogo.z = 0; headerLogo.bias = bOf(headerLogo.cx, headerLogo.cy);

  // store tiles: marquee + lifts
  const p1 = beat('problem_1'), p3 = beat('problem_3');
  for (const { T, inst } of tiles) {
    inst.forEach((L, k) => {
      L.cx = tileX(T, t, k); L.alpha = outside;
      L.visible = L.cx > MASK.x - T.box.w && L.cx < MASK.x + MASK.w + T.box.w;
      let z = 0;
      const vis = inMask(L.cx, 4);
      const order = (L.cx - MASK.x) / MASK.w; // stagger left→right
      const tIdx = LY.layers.store_tiles.indexOf(T);
      if (vis) {
        const l1 = p1.lifts[0], dv = l1.depth_variation;
        const s1 = lerp(l1.t[0], l1.t[1] - 0.45, order);
        z = Math.max(z, l1.dz_px * lerp(dv[0], dv[1], hash(tIdx)) * liftEnv(t, s1, s1 + 0.45));
        const l3 = p3.lifts[0]; const s3 = lerp(l3.t[0], l3.t[1] - 0.4, order);
        z = Math.max(z, l3.dz_px * liftEnv(t, s3, s3 + 0.4));
      }
      const ui = upTiles.findIndex(x => x.T === T);
      if (ui >= 0 && inMask(L.cx, 0)) { const n = upTiles.length, span = (upL.t[1] - upL.t[0]) - 0.45; const s = upL.t[0] + (n > 1 ? span * ui / (n - 1) : 0);
        z = Math.max(z, upL.dz_px * liftEnv(t, s, s + 0.45)); }
      for (const l of TH.lifts) if (l.layer === T.id && inMask(L.cx, 0)) z = Math.max(z, l.dz_px * liftEnv(t, l.t[0], l.t[1], l.hold_until, 0.5));
      L.z = z; L.bias = bOf(L.cx, L.cy) * (1 - clamp(z / 20));
      L.clip = [MASK.x, MASK.x + MASK.w, fadePx];
    });
  }
  // captions follow their (visible) tile instance
  for (const [cap, spec, tid] of [[capTech, TH.overlay_text[0], 'tile_5'], [capHome, TH.overlay_text[1], 'tile_8']]) {
    const tt = tiles.find(x => x.T.id === tid); const L = tt.inst.find(I => inMask(I.cx, 0)) || tt.inst[0];
    const e = liftEnv(t, spec.t[0], spec.t[0] + 0.3, spec.t[1], 0.9);
    cap.cx = L.cx; cap.cy = L.cy + L.h / 2 + 12 + cap.h / 2; cap.z = L.z + 6; cap.alpha = e * outside; cap.bias = 0; cap.face = 0.5 * pitch * e;
  }

  // product cards (staggered, ≤3 simultaneous)
  const LP = lift(beat('use_landed_price'), 'product_cards_selected');
  const per = 0.36, step = (LP.t[1] - LP.t[0] - per) / (LP.order.length - 1);
  LP.order.forEach((id, i) => { const L = cards[id]; const s = LP.t[0] + i * step;
    L.z = LP.dz_px * liftEnv(t, s, s + per); L.alpha = outside; L.bias = bOf(L.cx, L.cy) * (1 - clamp(L.z / 14)); });
  // trust cards
  const TA = beat('use_trust_affiliate'), tl = lift(TA, 'trust_cards');
  trust.forEach((L, i) => { const s = tl.t[0] + i * 0.08; L.z = tl.dz_px * liftEnv(t, s, tl.t[1], tl.hold_until); L.alpha = outside; L.bias = bOf(L.cx, L.cy) * (1 - clamp(L.z / 10)); });
  // start shopping button (real) — revealed in the CTA
  const bl = lift(cb, 'start_shopping_btn');
  btn.z = heroCard.z + 1 + bl.dz_px * liftEnv(t, bl.t[0], bl.t[1], bl.hold_until); btn.alpha = 1; btn.bias = haze > 0.5 ? 0 : bOf(btn.cx, btn.cy) * (1 - hc);

  // payment marks
  const PB = beat('use_payment'), sl = lift(PB, 'smile_and_pay_logo'), pl = lift(PB, 'payment_logos');
  const FACE = 0.8 * pitch;
  { const e = liftEnv(t, sl.t[0], sl.t[1], sl.hold_until); smile.z = sl.dz_px * e; smile.alpha = sstep(0, 0.35, e); smile.bias = 0; smile.cy = FL.smile_and_pay_logo.center[1] + 30 * (1 - e); smile.face = FACE * e; }
  pl.order.forEach((name, i) => { const L = payChips.find(c => c.name === name); const s = pl.t[0] + i * pl.stagger_s;
    const e = liftEnv(t, s, s + pl.rise_s, pl.hold_until + i * 0.03, 0.99); L.z = pl.dz_px * e; L.alpha = sstep(0, 0.4, e); L.bias = 0; L.cy = PL.row_y + 24 * (1 - e); L.face = FACE * e; });

  // tracking + dashboard floating layers: rise from the floor, hold, settle
  const TR = beat('use_tracking');
  for (const [L, name, spec] of [[trackUI, 'track_order_ui', FL.track_order_ui], [waUI, 'whatsapp_phone_mockup', FL.whatsapp_phone_mockup]]) {
    const l = lift(TR, name), e = liftEnv(t, l.t[0], l.t[1], l.hold_until, 0.6);
    L.z = l.dz_px * e; L.alpha = sstep(0, 0.35, e); L.cy = spec.center[1] + 60 * (1 - e); L.bias = 0; L.face = FACE * e; }
  { const l = lift(TA, 'runner_network_dashboard'), e = liftEnv(t, l.t[0], l.t[1], l.hold_until, 0.6);
    dashUI.z = l.dz_px * e; dashUI.alpha = sstep(0, 0.35, e); dashUI.cy = FL.runner_network_dashboard.center[1] + 50 * (1 - e); dashUI.bias = 0; dashUI.face = FACE * e; }

  // CTA overlay text (rise in, then hold)
  const ot = id => cb.overlay_text.find(o => o.id === id);
  for (const [L, id, baseY] of [[pill, 'logo_badge_pill', pill.cy0 ??= pill.cy], [ctaHead, 'cta_headline', ctaHead.cy0 ??= ctaHead.cy], [ctaSup, 'cta_support', ctaSup.cy0 ??= ctaSup.cy], [ctaUrl, 'cta_url', ctaUrl.cy0 ??= ctaUrl.cy]]) {
    const e = sstep(ot(id).t_in, ot(id).t_in + 0.35, t);
    L.alpha = e; L.z = heroCard.z + 2; L.cy = baseY + 16 * (1 - e); L.bias = 0;
  }
  layers.forEach(placeLayer);

  renderer.autoClear = true; renderer.render(bgScene, bgCam);
  renderer.autoClear = false; renderer.render(scene, camera);
}

// ---------- capture API (used by the headless renderer) ----------
const pixels = new Uint8Array(W * H * 4);
window.seek = seek;
window.grab = async t => {
  seek(t);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  const blob = new Blob([pixels]);
  return await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result.split(',')[1]); fr.readAsDataURL(blob); });
};
window.__info = { renderer: (() => { const e = gl.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; })(), drawnText, upTiles: upTiles.map(x => x.T.name) };
seek(0);
window.__ready = true;
