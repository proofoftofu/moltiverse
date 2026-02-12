const CONFIG_URL = "../.openclaw/skills/art-director/art-config.json";
const REFRESH_MS = 2000;

let liveState = {
  last_update: "",
  style: "data-sea",
  global_energy: 0,
  active_tokens: [],
};

let lastReload = 0;
let lastFrameAt = 0;
let flowTime = 0;

function setup() {
  const container = document.getElementById("canvas-container");
  const w = Math.min(window.innerWidth * 0.96, 1000);
  const h = Math.max(520, Math.min(window.innerHeight * 0.78, 720));
  const c = createCanvas(w, h);
  c.parent(container);
  pixelDensity(1);
  noStroke();
  background(6, 10, 20);
  loadConfig();
}

function windowResized() {
  const w = Math.min(window.innerWidth * 0.96, 1000);
  const h = Math.max(520, Math.min(window.innerHeight * 0.78, 720));
  resizeCanvas(w, h);
  background(6, 10, 20);
}

async function loadConfig() {
  try {
    const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    if (json && Array.isArray(json.active_tokens)) {
      liveState = json;
      renderMeta();
    }
  } catch (_) {
    // Keep previous state if config fetch fails.
  }
}

function renderMeta() {
  const el = document.getElementById("meta");
  if (!el) return;
  el.textContent = `style=${liveState.style || "data-sea"} | energy=${Number(liveState.global_energy || 0).toFixed(2)} | ${liveState.last_update || "n/a"}`;
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hash01(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function tokenAnchorPx(token) {
  const a = token.noise_anchor || { u: 0.5, v: 0.5 };
  return { x: a.u * width, y: a.v * height };
}

function tokenGradient(token) {
  if (Array.isArray(token.gradient_map) && token.gradient_map.length > 0) {
    return token.gradient_map;
  }
  return token.palette || ["#334455", "#8899AA", "#E6EEF8"];
}

function colorFromGradient(gradient, t) {
  const idx = clamp(Math.floor(t * (gradient.length - 1)), 0, gradient.length - 1);
  return color(gradient[idx]);
}

function flowVectorAt(px, py, t) {
  let vx = 0;
  let vy = 0;
  let totalW = 0;
  const tokens = liveState.active_tokens || [];
  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dx = px - anchor.x;
    const dy = py - anchor.y;
    const dist = Math.max(12, Math.hypot(dx, dy));
    const falloff = 1 / (1 + Math.pow(dist / Math.min(width, height), 1.35) * 10);
    const energy = clamp(Number(token.energy || 0), 0, 1);
    const freq = Number(token.frequency || 0.4);
    const phase = Number(token.phase || 0);
    const seed = Number(token.noise_seed || 1);

    const swirl = Math.atan2(dy, dx) + phase + t * freq;
    const noiseAngle = noise(
      (px * 0.0035) + hash01(seed) * 6.0,
      (py * 0.0035) + hash01(seed + 17) * 6.0,
      t * 0.14
    ) * TWO_PI;
    const ang = swirl * 0.55 + noiseAngle * 0.45;
    const mag = (0.35 + energy * 1.25) * falloff;

    vx += Math.cos(ang) * mag;
    vy += Math.sin(ang) * mag;
    totalW += falloff;
  }
  if (totalW <= 0) return { x: 0, y: 0 };
  return { x: vx / totalW, y: vy / totalW };
}

function mixedSeaColor(px, py, t) {
  const tokens = liveState.active_tokens || [];
  if (tokens.length === 0) return color(10, 16, 30);

  let r = 0;
  let g = 0;
  let b = 0;
  let wSum = 0;

  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dx = px - anchor.x;
    const dy = py - anchor.y;
    const dist = Math.max(8, Math.hypot(dx, dy));
    const energy = clamp(Number(token.energy || 0), 0, 1);
    const freq = Number(token.frequency || 0.4);
    const phase = Number(token.phase || 0);
    const grad = tokenGradient(token);
    const seed = Number(token.noise_seed || 1);

    const flow = noise(
      px * 0.004 + hash01(seed + 9) * 4.0,
      py * 0.004 + hash01(seed + 31) * 4.0,
      t * (0.1 + freq * 0.15)
    );

    const angleTerm = 0.5 + 0.5 * Math.sin(phase + t * freq + dist * 0.01);
    const indexT = clamp((flow * 0.6 + angleTerm * 0.4), 0, 1);
    const c = colorFromGradient(grad, indexT);

    const w = (1 / (1 + Math.pow(dist / Math.min(width, height), 1.6) * 8)) * (0.2 + energy);
    r += red(c) * w;
    g += green(c) * w;
    b += blue(c) * w;
    wSum += w;
  }

  if (wSum <= 0) return color(10, 16, 30);
  return color(r / wSum, g / wSum, b / wSum);
}

function drawDataSea(dt) {
  const energy = clamp(Number(liveState.global_energy || 0), 0, 1);
  const fadeAlpha = 18 + Math.floor(18 * (1 - energy));
  fill(6, 10, 20, fadeAlpha);
  rect(0, 0, width, height);

  const step = 7;
  const t = flowTime;
  strokeWeight(1.2);
  noFill();

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const v = flowVectorAt(x, y, t);
      const x2 = x + v.x * 36;
      const y2 = y + v.y * 36;
      const c = mixedSeaColor(x, y, t);
      stroke(red(c), green(c), blue(c), 95);
      line(x, y, x2, y2);
    }
  }

  if (Math.random() < 0.18 + energy * 0.45) {
    applyGlitchSnap(energy);
  }
}

function applyGlitchSnap(energy) {
  loadPixels();
  const rowStep = Math.floor(random(8, 24));
  const maxShift = Math.floor(8 + energy * 40);
  const chance = 0.1 + energy * 0.3;
  for (let y = 0; y < height; y += rowStep) {
    if (Math.random() > chance) continue;
    const shift = Math.floor(random(-maxShift, maxShift));
    const start = (y * width) * 4;
    const row = pixels.slice(start, start + width * 4);
    for (let x = 0; x < width; x++) {
      const srcX = (x + shift + width) % width;
      const dst = start + x * 4;
      const src = srcX * 4;
      pixels[dst] = row[src];
      pixels[dst + 1] = row[src + 1];
      pixels[dst + 2] = row[src + 2];
    }
  }
  updatePixels();
}

function draw() {
  if (millis() - lastReload > REFRESH_MS) {
    lastReload = millis();
    loadConfig();
  }

  const nowMs = millis();
  const dt = lastFrameAt === 0 ? 0.016 : (nowMs - lastFrameAt) / 1000;
  lastFrameAt = nowMs;
  flowTime += dt;

  drawDataSea(dt);
}

