const CONFIG_URL = "../.openclaw/skills/art-director/art-config.json";
const REFRESH_MS = 2000;

let liveState = {
  last_update: "",
  style: "pixel-clusters",
  global_energy: 0,
  active_tokens: [],
};

let lastReload = 0;
let spin = 0;

function setup() {
  const container = document.getElementById("canvas-container");
  const width = Math.min(window.innerWidth * 0.96, 1000);
  const height = Math.max(520, Math.min(window.innerHeight * 0.78, 720));
  const c = createCanvas(width, height);
  c.parent(container);
  angleMode(DEGREES);
  noStroke();
  loadConfig();
}

function windowResized() {
  const width = Math.min(window.innerWidth * 0.96, 1000);
  const height = Math.max(520, Math.min(window.innerHeight * 0.78, 720));
  resizeCanvas(width, height);
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
    // Keep existing state if fetch fails.
  }
}

function renderMeta() {
  const el = document.getElementById("meta");
  if (!el) return;
  el.textContent = `style=${liveState.style} | energy=${Number(liveState.global_energy || 0).toFixed(2)} | ${liveState.last_update || "n/a"}`;
}

function drawBackground() {
  const e = constrain(Number(liveState.global_energy || 0), 0, 1);
  const c0 = color(9, 18, 30);
  const c1 = color(12 + 40 * e, 30 + 50 * e, 45 + 70 * e);
  for (let y = 0; y < height; y += 2) {
    const t = y / height;
    stroke(lerpColor(c0, c1, t));
    line(0, y, width, y);
  }
  noStroke();
}

function drawPixelClusters(token) {
  const [a, b, c] = token.palette.map((hex) => color(hex));
  const cell = Math.max(8, token.size / 6);
  const size = token.size * 2;
  for (let x = -size; x < size; x += cell) {
    for (let y = -size; y < size; y += cell) {
      const r = noise((token.coordinates.x + x) * 0.03, (token.coordinates.y + y) * 0.03, frameCount * 0.01);
      fill(r < 0.33 ? a : r < 0.66 ? b : c);
      rect(token.coordinates.x + x, token.coordinates.y + y, cell, cell);
    }
  }
}

function drawVoronoiLike(token) {
  const [a, b, c] = token.palette.map((hex) => color(hex));
  const energy = constrain(Number(token.energy || 0), 0, 1);
  for (let i = 0; i < 18; i++) {
    const ang = (360 / 18) * i + spin * (1 + energy * 3);
    const r = token.size + i * 2;
    fill(i % 3 === 0 ? a : i % 3 === 1 ? b : c);
    circle(token.coordinates.x + cos(ang) * r, token.coordinates.y + sin(ang) * r, token.size * 0.5);
  }
}

function drawMinimal(token) {
  const [a, b, c] = token.palette.map((hex) => color(hex));
  fill(a);
  circle(token.coordinates.x, token.coordinates.y, token.size * 2.2);
  fill(b);
  circle(token.coordinates.x, token.coordinates.y, token.size * 1.4);
  fill(c);
  circle(token.coordinates.x, token.coordinates.y, token.size * 0.7);
}

function drawLabels(token) {
  fill(255, 220);
  textSize(12);
  textAlign(CENTER);
  text(token.symbol, token.coordinates.x, token.coordinates.y + token.size + 16);
}

function draw() {
  if (millis() - lastReload > REFRESH_MS) {
    lastReload = millis();
    loadConfig();
  }

  drawBackground();
  spin += 0.3 + Number(liveState.global_energy || 0) * 1.5;

  const style = liveState.style || "pixel-clusters";
  for (const token of liveState.active_tokens || []) {
    if (!token.palette || token.palette.length < 3) continue;
    if (style === "voronoi") {
      drawVoronoiLike(token);
    } else if (style === "minimal") {
      drawMinimal(token);
    } else {
      drawPixelClusters(token);
    }
    drawLabels(token);
  }
}

