const CONFIG_URL = "../.openclaw/skills/art-director/art-config.json";
const REFRESH_MS = 2000;

let liveState = {
  last_update: "",
  title: "Atelier of the Agent",
  description: "A live pigment sea shaped by Nad.fun trade pressure.",
  global_energy: 0,
  momentum_bias: 0,
  energy_spread: 0,
  active_tokens: [],
  _tokens: [],
};

let lastReload = 0;
let lastFrameAt = 0;
let flowTime = 0;
let qualityStep = 8;

function canvasSide() {
  return Math.max(300, Math.min(window.innerWidth * 0.64, 460));
}

function setup() {
  const container = document.getElementById("canvas-container");
  const side = canvasSide();
  const c = createCanvas(side, side);
  c.parent(container);
  pixelDensity(1);
  noStroke();
  background(6, 10, 20);
  loadConfig();
}

function windowResized() {
  const side = canvasSide();
  resizeCanvas(side, side);
  background(6, 10, 20);
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function hash01(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453123;
  return x - Math.floor(x);
}

function hexToRgb(hex) {
  if (typeof hex !== "string") return [120, 130, 150];
  const h = hex.replace("#", "").trim();
  if (h.length !== 6) return [120, 130, 150];
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [120, 130, 150];
  return [r, g, b];
}

function lerpRGB(a, b, t) {
  const tt = clamp(t, 0, 1);
  return [
    a[0] + (b[0] - a[0]) * tt,
    a[1] + (b[1] - a[1]) * tt,
    a[2] + (b[2] - a[2]) * tt,
  ];
}

function normalizeState(json) {
  const srcTokens = Array.isArray(json.active_tokens) ? json.active_tokens : [];
  const cooked = srcTokens.map((token) => {
    const gradient = Array.isArray(token.gradient_map) && token.gradient_map.length > 1
      ? token.gradient_map
      : (Array.isArray(token.palette) ? token.palette : ["#334455", "#8899AA", "#E6EEF8"]);

    const gradientRgb = gradient.map((hex) => hexToRgb(hex));
    const anchor = token.noise_anchor || { u: 0.5, v: 0.5 };
    return {
      ...token,
      energy: clamp(Number(token.energy || 0), 0, 1),
      momentum: clamp(Number(token.momentum || 0), -1, 1),
      activity: clamp(Number(token.activity || 0), 0, 1),
      phase: Number(token.phase || 0),
      frequency: Number(token.frequency || 0.35),
      noise_seed: Number(token.noise_seed || 1),
      anchor_u: clamp(Number(anchor.u || 0.5), 0, 1),
      anchor_v: clamp(Number(anchor.v || 0.5), 0, 1),
      gradient_rgb: gradientRgb,
    };
  });

  return {
    ...json,
    title: json.title || "Atelier of the Agent",
    description:
      json.description ||
      "A live pigment sea shaped by Nad.fun trade pressure. Each token diffuses through a stable noise neighborhood.",
    global_energy: clamp(Number(json.global_energy || 0), 0, 1),
    momentum_bias: clamp(Number(json.momentum_bias || 0), -1, 1),
    energy_spread: clamp(Number(json.energy_spread || 0), 0, 1),
    active_tokens: srcTokens,
    _tokens: cooked,
  };
}

async function loadConfig() {
  try {
    const res = await fetch(`${CONFIG_URL}?t=${Date.now()}`, { cache: "no-store" });
    if (!res.ok) return;
    const json = await res.json();
    if (json && Array.isArray(json.active_tokens)) {
      liveState = normalizeState(json);
      renderMeta();
    }
  } catch (_) {
    // Keep previous state if config fetch fails.
  }
}

function renderMeta() {
  const el = document.getElementById("meta");
  const titleEl = document.getElementById("atelier-title");
  const descEl = document.getElementById("atelier-description");
  if (titleEl) titleEl.textContent = liveState.title;
  if (descEl) descEl.textContent = liveState.description;
  if (!el) return;
  el.textContent =
    `Updated ${liveState.last_update || "n/a"} · ` +
    `Energy ${liveState.global_energy.toFixed(2)} · ` +
    `Bias ${liveState.momentum_bias.toFixed(2)} · ` +
    `${liveState._tokens.length} tokens`;
}

function tokenAnchorPx(token) {
  return { x: token.anchor_u * width, y: token.anchor_v * height };
}

function sampleGradientRGB(token, t) {
  const g = token.gradient_rgb;
  if (!g || g.length === 0) return [16, 24, 40];
  if (g.length === 1) return g[0];
  const tt = clamp(t, 0, 1) * (g.length - 1);
  const i0 = Math.floor(tt);
  const i1 = Math.min(g.length - 1, i0 + 1);
  return lerpRGB(g[i0], g[i1], tt - i0);
}

function flowVectorAt(px, py, t) {
  let vx = 0;
  let vy = 0;
  let totalW = 0;
  const tokens = liveState._tokens || [];

  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dx = px - anchor.x;
    const dy = py - anchor.y;
    const dist = Math.max(12, Math.hypot(dx, dy));
    const normDist = dist / Math.min(width, height);

    const falloff = 1 / (1 + Math.pow(normDist, 1.35) * 10);
    const swirlSign = token.momentum >= 0 ? 1 : -1;
    const swirl = Math.atan2(dy, dx) + token.phase + t * token.frequency * swirlSign;
    const noiseAngle =
      noise(
        px * 0.003 + hash01(token.noise_seed) * 4.5,
        py * 0.003 + hash01(token.noise_seed + 17) * 4.5,
        t * 0.12
      ) *
      TWO_PI;

    const ang = swirl * (0.45 + token.activity * 0.25) + noiseAngle * 0.55;
    const mag = (0.25 + token.energy * 1.35) * (0.55 + token.activity * 0.65) * falloff;

    vx += Math.cos(ang) * mag;
    vy += Math.sin(ang) * mag;
    totalW += falloff;
  }

  if (totalW <= 0) return { x: 0, y: 0 };
  return { x: vx / totalW, y: vy / totalW };
}

function mixedSeaColor(px, py, t) {
  const tokens = liveState._tokens || [];
  if (tokens.length === 0) return [10, 16, 30];

  let r = 0;
  let g = 0;
  let b = 0;
  let wSum = 0;

  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dx = px - anchor.x;
    const dy = py - anchor.y;
    const dist = Math.max(8, Math.hypot(dx, dy));
    const normDist = dist / Math.min(width, height);

    const flow = noise(
      px * 0.0036 + hash01(token.noise_seed + 9) * 3.6,
      py * 0.0036 + hash01(token.noise_seed + 31) * 3.6,
      t * (0.09 + token.frequency * 0.16)
    );

    const pulse = 0.5 + 0.5 * Math.sin(token.phase + t * token.frequency + dist * 0.012);
    const indexT = clamp(flow * 0.68 + pulse * 0.32, 0, 1);
    const c = sampleGradientRGB(token, indexT);

    const w = (1 / (1 + Math.pow(normDist, 1.65) * 9)) * (0.18 + token.energy * 0.7 + token.activity * 0.6);
    r += c[0] * w;
    g += c[1] * w;
    b += c[2] * w;
    wSum += w;
  }

  if (wSum <= 0) return [10, 16, 30];
  return [r / wSum, g / wSum, b / wSum];
}

function drawBackdrop(t) {
  const tokens = liveState._tokens || [];
  const c1 = tokens[0] ? sampleGradientRGB(tokens[0], 0.35) : [12, 18, 32];
  const c2 = tokens[1] ? sampleGradientRGB(tokens[1], 0.65) : [28, 22, 40];
  const bgAlpha = 16 + Math.floor((1 - liveState.global_energy) * 18);

  noStroke();
  fill(6, 10, 18, bgAlpha);
  rect(0, 0, width, height);

  const grad = drawingContext.createLinearGradient(0, 0, width, height);
  grad.addColorStop(0, `rgba(${Math.floor(c1[0])}, ${Math.floor(c1[1])}, ${Math.floor(c1[2])}, 0.12)`);
  grad.addColorStop(1, `rgba(${Math.floor(c2[0])}, ${Math.floor(c2[1])}, ${Math.floor(c2[2])}, 0.12)`);
  drawingContext.fillStyle = grad;
  drawingContext.fillRect(0, 0, width, height);

  const vignetteA = 0.22 + liveState.energy_spread * 0.4;
  const rg = drawingContext.createRadialGradient(
    width * 0.5,
    height * 0.5,
    width * 0.12,
    width * 0.5,
    height * 0.5,
    width * 0.65
  );
  rg.addColorStop(0, "rgba(0,0,0,0)");
  rg.addColorStop(1, `rgba(0,0,0,${vignetteA.toFixed(3)})`);
  drawingContext.fillStyle = rg;
  drawingContext.fillRect(0, 0, width, height);

  if (tokens.length > 0) {
    const haze = 6 + liveState.global_energy * 18;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      const anchor = tokenAnchorPx(token);
      const halo = sampleGradientRGB(token, 0.4 + 0.35 * Math.sin(t * 0.28 + token.phase));
      fill(halo[0], halo[1], halo[2], 7 + token.activity * 12);
      circle(anchor.x, anchor.y, haze + 20 + token.activity * 64);
    }
  }
}

function drawDataSea(dt) {
  const energy = liveState.global_energy;
  const targetStep = 7 + Math.floor((1 - energy) * 2 + liveState.energy_spread * 4);
  const overload = dt > 0.028 ? 1 : 0;
  qualityStep = clamp(Math.floor(qualityStep * 0.82 + (targetStep + overload) * 0.18), 6, 12);

  drawBackdrop(flowTime);

  const step = qualityStep;
  const t = flowTime;
  strokeWeight(1.1 + energy * 0.5);
  noFill();

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const v = flowVectorAt(x, y, t);
      const jitterX = (noise(x * 0.03, y * 0.03, t * 0.7) - 0.5) * 2.0;
      const jitterY = (noise(x * 0.03 + 9.1, y * 0.03 + 2.7, t * 0.7) - 0.5) * 2.0;
      const x2 = x + v.x * (30 + energy * 24) + jitterX;
      const y2 = y + v.y * (30 + energy * 24) + jitterY;
      const c = mixedSeaColor(x, y, t);
      const alpha = 70 + energy * 42 + liveState.energy_spread * 30;
      stroke(c[0], c[1], c[2], alpha);
      line(x, y, x2, y2);
    }
  }

  if (Math.random() < 0.08 + energy * 0.36 + liveState.energy_spread * 0.25) {
    applyGlitchSnap(energy);
  }
}

function applyGlitchSnap(energy) {
  loadPixels();
  const rowStep = Math.floor(random(8, 22));
  const maxShift = Math.floor(8 + energy * 36 + liveState.energy_spread * 14);
  const chance = 0.07 + energy * 0.24;

  for (let y = 0; y < height; y += rowStep) {
    if (Math.random() > chance) continue;
    const shift = Math.floor(random(-maxShift, maxShift));
    const start = y * width * 4;
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
