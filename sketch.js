const CONFIG_URL = "./art-config.json";
const REFRESH_MS = 2000;

let liveState = {
  last_update: "",
  title: "Autonomous Atelier",
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
let showOverlay = true;
let showGuides = true;
let activeBuyContext = null;
let activeBuySimulation = null;
let artCanvasEl = null;

function canvasDimensions() {
  const container = document.getElementById("canvas-container");
  if (!container) return { w: window.innerWidth, h: window.innerHeight };
  const w = Math.max(240, Math.floor(container.clientWidth || window.innerWidth));
  const h = Math.max(240, Math.floor(container.clientHeight || window.innerHeight));
  return { w, h };
}

function setup() {
  const container = document.getElementById("canvas-container");
  const dims = canvasDimensions();
  const c = createCanvas(dims.w, dims.h);
  c.parent(container);
  artCanvasEl = c && c.elt ? c.elt : null;
  pixelDensity(Math.min(window.devicePixelRatio || 1, 2));
  textFont("Helvetica");
  noStroke();
  background(6, 10, 20);
  loadConfig();
}

function windowResized() {
  const dims = canvasDimensions();
  resizeCanvas(dims.w, dims.h);
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
    title: json.title || "Autonomous Atelier",
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
  if (typeof document !== "undefined") {
    document.title = liveState.title || "Autonomous Atelier";
  }
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

function fitTextOneLine(raw, maxWidth) {
  const src = String(raw || "").replace(/\s+/g, " ").trim();
  if (!src) return "";
  if (textWidth(src) <= maxWidth) return src;
  const ellipsis = "...";
  let lo = 0;
  let hi = src.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const attempt = src.slice(0, mid).trimEnd() + ellipsis;
    if (textWidth(attempt) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return src.slice(0, lo).trimEnd() + ellipsis;
}

function wrapAndClampText(raw, maxWidth, maxLines) {
  const src = String(raw || "").replace(/\s+/g, " ").trim();
  if (!src) return "";
  const words = src.split(" ");
  const lines = [];
  let line = "";

  for (let i = 0; i < words.length; i++) {
    const candidate = line ? `${line} ${words[i]}` : words[i];
    if (textWidth(candidate) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    line = words[i];
    if (lines.length === maxLines - 1) {
      const rest = [line, ...words.slice(i + 1)].join(" ");
      lines.push(fitTextOneLine(rest, maxWidth));
      return lines.join("\n");
    }
  }

  if (line) lines.push(line);
  return lines.slice(0, maxLines).join("\n");
}

function drawCuratorialText() {
  const pad = 14;
  const maxW = Math.min(width - 2 * pad, Math.max(320, width * 0.56));
  const rawTitle = liveState.title || "Autonomous Atelier";
  const rawDesc = liveState.description || "";

  textAlign(LEFT, TOP);
  textStyle(BOLD);
  textSize(22);
  const title = fitTextOneLine(rawTitle, maxW - 20);
  const titleH = Math.ceil(textAscent() + textDescent()) + 2;

  textStyle(NORMAL);
  textSize(13);
  textLeading(18);
  const description = wrapAndClampText(rawDesc, maxW - 20, 3);
  const descLineCount = Math.max(1, description.split("\n").length);
  const descH = descLineCount * 18;

  const boxH = 16 + titleH + 8 + descH + 12;

  const y = height - boxH - pad;
  noStroke();
  fill(7, 11, 20, 144);
  rect(pad, y, maxW, boxH, 8);

  fill(240, 246, 255, 235);
  textStyle(BOLD);
  textSize(22);
  text(title, pad + 10, y + 8, maxW - 20, titleH + 6);

  fill(210, 222, 242, 220);
  textStyle(NORMAL);
  textSize(13);
  textLeading(18);
  text(description, pad + 10, y + 8 + titleH + 8, maxW - 20, descH + 4);
}

function pointInCanvas(x, y) {
  return x >= 0 && x <= width && y >= 0 && y <= height;
}

function tokenHitRadius(token) {
  return 12 + token.activity * 22 + token.energy * 8;
}

function tokenAtPoint(px, py) {
  const tokens = liveState._tokens || [];
  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    if (Math.hypot(px - anchor.x, py - anchor.y) <= tokenHitRadius(token)) {
      return token;
    }
  }
  return null;
}

function nearestTokenAtPoint(px, py) {
  const tokens = liveState._tokens || [];
  if (tokens.length === 0) return null;
  let nearest = null;
  let bestDist = Infinity;
  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dist = Math.hypot(px - anchor.x, py - anchor.y);
    if (dist < bestDist) {
      bestDist = dist;
      nearest = token;
    }
  }
  return nearest;
}

function snapshotTokensForSimulation() {
  const tokens = liveState._tokens || [];
  return tokens.map((token) => ({
    token_id: token.token_id,
    symbol: token.symbol || "?",
    energy: clamp(Number(token.energy || 0), 0, 1),
    activity: clamp(Number(token.activity || 0), 0, 1),
    momentum: clamp(Number(token.momentum || 0), -1, 1),
    anchor_u: clamp(Number(token.anchor_u || 0.5), 0, 1),
    anchor_v: clamp(Number(token.anchor_v || 0.5), 0, 1),
  }));
}

function computeBuySimulation(context, buyAmountRaw) {
  if (!context || !Array.isArray(context.tokens) || context.tokens.length === 0) return null;
  const buyAmount = Math.max(1, Number(buyAmountRaw || 1));
  const amountScale = clamp(Math.log10(1 + buyAmount) / 3, 0, 1.6);
  const px = context.click_u * width;
  const py = context.click_v * height;
  const canvasScale = Math.max(1, Math.min(width, height));

  const selected = context.tokens.find((t) => String(t.token_id) === String(context.selected_token_id));
  if (!selected) return null;

  const influenced = context.tokens.map((token) => {
    const anchor = { x: token.anchor_u * width, y: token.anchor_v * height };
    const dist = Math.hypot(px - anchor.x, py - anchor.y);
    const nearFactor = clamp(1 - dist / (canvasScale * 0.9), 0, 1);
    const selectedBoost = String(token.token_id) === String(context.selected_token_id) ? 1.45 : 0.55;
    const spreadLift = 0.08 + context.energy_spread * 0.42;
    const base = amountScale * (nearFactor * selectedBoost + spreadLift);

    const deltaEnergy = clamp(base * 0.11, 0, 0.45);
    const deltaActivity = clamp(base * 0.09, 0, 0.4);
    const deltaMomentum = clamp(base * 0.22, 0, 0.8);

    return {
      token_id: token.token_id,
      symbol: token.symbol,
      delta_energy: deltaEnergy,
      delta_activity: deltaActivity,
      delta_momentum: deltaMomentum,
      before: {
        energy: token.energy,
        activity: token.activity,
        momentum: token.momentum,
      },
      after: {
        energy: clamp(token.energy + deltaEnergy, 0, 1),
        activity: clamp(token.activity + deltaActivity, 0, 1),
        momentum: clamp(token.momentum + deltaMomentum, -1, 1),
      },
    };
  });

  const selectedRow = influenced.find((row) => String(row.token_id) === String(context.selected_token_id));
  if (!selectedRow) return null;

  const impactRows = influenced
    .slice()
    .sort((a, b) => (b.delta_energy + b.delta_activity) - (a.delta_energy + a.delta_activity))
    .slice(0, 4)
    .map((row) => ({
      token_id: row.token_id,
      symbol: row.symbol,
      delta_energy: row.delta_energy,
      delta_activity: row.delta_activity,
      delta_momentum: row.delta_momentum,
    }));

  return {
    buy_amount: buyAmount,
    click_u: context.click_u,
    click_v: context.click_v,
    selected_token_id: context.selected_token_id,
    selected_symbol: context.selected_symbol,
    selected_before: selectedRow.before,
    selected_after: selectedRow.after,
    impact_rows: impactRows,
  };
}

function drawBuySimulationPreview(t) {
  if (!activeBuySimulation) return;

  const cx = activeBuySimulation.click_u * width;
  const cy = activeBuySimulation.click_v * height;
  const amountScale = clamp(Math.log10(1 + Math.max(1, Number(activeBuySimulation.buy_amount || 1))) / 3, 0, 1.6);
  const pulse = 0.5 + 0.5 * Math.sin(t * 2.4);
  const radius = 70 + amountScale * 220 + pulse * 16;

  const tokens = liveState._tokens || [];
  const selected = tokens.find((tk) => String(tk.token_id) === String(activeBuySimulation.selected_token_id));
  const baseColor = selected ? sampleGradientRGB(selected, 0.6) : [120, 180, 255];

  drawingContext.save();
  drawingContext.globalCompositeOperation = "screen";
  const glow = drawingContext.createRadialGradient(cx, cy, radius * 0.08, cx, cy, radius);
  glow.addColorStop(0, `rgba(${Math.floor(baseColor[0])}, ${Math.floor(baseColor[1])}, ${Math.floor(baseColor[2])}, 0.34)`);
  glow.addColorStop(0.5, `rgba(${Math.floor(baseColor[0])}, ${Math.floor(baseColor[1])}, ${Math.floor(baseColor[2])}, 0.14)`);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  drawingContext.fillStyle = glow;
  drawingContext.fillRect(0, 0, width, height);
  drawingContext.restore();

  for (const impact of activeBuySimulation.impact_rows || []) {
    const token = tokens.find((tk) => String(tk.token_id) === String(impact.token_id));
    if (!token) continue;
    const anchor = tokenAnchorPx(token);
    const tokenColor = sampleGradientRGB(token, 0.58);
    const tokenForce = clamp((impact.delta_energy + impact.delta_activity + impact.delta_momentum * 0.5) * 2.8, 0, 1.4);
    const alpha = 30 + tokenForce * 120;

    stroke(tokenColor[0], tokenColor[1], tokenColor[2], alpha);
    strokeWeight(1 + tokenForce * 2.1);
    line(cx, cy, anchor.x, anchor.y);

    noFill();
    stroke(tokenColor[0], tokenColor[1], tokenColor[2], 46 + tokenForce * 110);
    circle(anchor.x, anchor.y, 18 + tokenForce * 42 + pulse * 6);
  }

  noFill();
  stroke(baseColor[0], baseColor[1], baseColor[2], 180);
  strokeWeight(2.2);
  circle(cx, cy, radius * 0.55);
  stroke(baseColor[0], baseColor[1], baseColor[2], 120);
  strokeWeight(1.2);
  circle(cx, cy, radius * 0.92);
}

if (typeof window !== "undefined") {
  window.computeBuySimulationFromCanvas = function computeBuySimulationFromCanvas(buyAmount) {
    const sim = computeBuySimulation(activeBuyContext, buyAmount);
    if (sim) activeBuySimulation = sim;
    return sim;
  };
  window.setBuySimulationPreview = function setBuySimulationPreview(sim) {
    activeBuySimulation = sim || null;
  };
  window.clearBuySimulationPreview = function clearBuySimulationPreview() {
    activeBuySimulation = null;
  };
}

function tokenInfluenceWeights(px, py) {
  const tokens = liveState._tokens || [];
  const weights = [];
  let wSum = 0;

  for (const token of tokens) {
    const anchor = tokenAnchorPx(token);
    const dist = Math.max(8, Math.hypot(px - anchor.x, py - anchor.y));
    const normDist = dist / Math.min(width, height);
    const w = (1 / (1 + Math.pow(normDist, 1.65) * 9)) * (0.18 + token.energy * 0.7 + token.activity * 0.6);
    weights.push(w);
    wSum += w;
  }

  if (wSum <= 0) return tokens.map(() => 0);
  return weights.map((w) => w / wSum);
}

function drawInfluenceGuides(t) {
  const tokens = liveState._tokens || [];
  if (!showGuides || tokens.length === 0) return;

  const hover = pointInCanvas(mouseX, mouseY);
  const influences = hover ? tokenInfluenceWeights(mouseX, mouseY) : [];

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const anchor = tokenAnchorPx(token);
    const hue = sampleGradientRGB(token, 0.56 + 0.2 * Math.sin(t * 0.4 + token.phase));
    const radius = 10 + token.activity * 44 + token.energy * 18;

    noFill();
    stroke(hue[0], hue[1], hue[2], 88);
    strokeWeight(1);
    circle(anchor.x, anchor.y, radius);

    stroke(hue[0], hue[1], hue[2], 50);
    circle(anchor.x, anchor.y, radius * 1.6);

    if (hover) {
      const inf = influences[i] || 0;
      stroke(hue[0], hue[1], hue[2], 25 + inf * 180);
      line(anchor.x, anchor.y, mouseX, mouseY);
    }

    noStroke();
    fill(235, 240, 248, 180);
    textStyle(NORMAL);
    textSize(10);
    textAlign(CENTER, CENTER);
    text(token.symbol || "?", anchor.x, anchor.y);
  }
}

function drawMetricBar(x, y, w, h, value01, r, g, b) {
  noStroke();
  fill(255, 255, 255, 30);
  rect(x, y, w, h, 2);
  fill(r, g, b, 175);
  rect(x, y, w * clamp(value01, 0, 1), h, 2);
}

function drawDataOverlay() {
  if (!showOverlay) return;
  const tokens = liveState._tokens || [];

  const boxW = Math.min(width - 20, 265);
  const rows = Math.min(4, tokens.length);
  const boxH = 92 + rows * 16;
  const x = 10;
  const y = 10;

  noStroke();
  fill(8, 12, 20, 168);
  rect(x, y, boxW, boxH, 6);

  fill(236, 242, 250, 220);
  textStyle(BOLD);
  textSize(11);
  textAlign(LEFT, TOP);
  text(`Live Nad.fun feed  ${liveState.last_update || "n/a"}`, x + 8, y + 7);

  textStyle(NORMAL);
  textSize(10);
  fill(220, 228, 242, 200);
  text("Energy", x + 8, y + 24);
  drawMetricBar(x + 56, y + 25, 82, 6, liveState.global_energy, 128, 209, 255);
  text("Bias", x + 144, y + 24);
  drawMetricBar(x + 171, y + 25, 82, 6, liveState.momentum_bias * 0.5 + 0.5, 255, 176, 136);
  text("Spread", x + 8, y + 36);
  drawMetricBar(x + 56, y + 37, 82, 6, liveState.energy_spread, 255, 132, 180);

  let yy = y + 52;
  const ranked = tokens
    .map((t) => ({ t }))
    .sort((a, b) => b.t.activity - a.t.activity)
    .slice(0, rows);

  for (const row of ranked) {
    const token = row.t;
    const c = sampleGradientRGB(token, 0.58);
    const momentumArrow = token.momentum >= 0 ? "CW" : "CCW";
    const summary = `${token.symbol || "?"}  E:${token.energy.toFixed(2)}  M:${token.momentum.toFixed(2)} ${momentumArrow}  A:${token.activity.toFixed(2)}`;
    fill(c[0], c[1], c[2], 220);
    text(fitTextOneLine(summary, boxW - 16), x + 8, yy);
    yy += 16;
  }

  fill(170, 188, 214, 190);
  text("Toggle: O overlay, G guides", x + 8, y + boxH - 14);
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

  drawInfluenceGuides(t);
  drawBuySimulationPreview(t);
  drawDataOverlay();
  drawCuratorialText();
  cursor(pointInCanvas(mouseX, mouseY) ? HAND : ARROW);
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

function keyPressed() {
  if (key === "o" || key === "O") {
    showOverlay = !showOverlay;
  } else if (key === "g" || key === "G") {
    showGuides = !showGuides;
  }
}

function isAnyModalOpen() {
  if (typeof document === "undefined") return false;
  return Boolean(document.querySelector(".modal-backdrop.open"));
}

function mousePressed(event) {
  if (isAnyModalOpen()) return;
  if (event && event.target && artCanvasEl && event.target !== artCanvasEl) return;
  if (!pointInCanvas(mouseX, mouseY)) return;
  const token = nearestTokenAtPoint(mouseX, mouseY);
  if (!token || !token.token_id) return;

  activeBuyContext = {
    selected_token_id: token.token_id,
    selected_symbol: token.symbol || "?",
    click_u: clamp(mouseX / Math.max(1, width), 0, 1),
    click_v: clamp(mouseY / Math.max(1, height), 0, 1),
    global_energy: liveState.global_energy,
    momentum_bias: liveState.momentum_bias,
    energy_spread: liveState.energy_spread,
    tokens: snapshotTokensForSimulation(),
  };

  const simulation = computeBuySimulation(activeBuyContext, 100);
  activeBuySimulation = simulation;
  if (typeof window !== "undefined" && typeof window.openBuySimulation === "function") {
    window.openBuySimulation(simulation);
  }
}
