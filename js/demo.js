// Seven demo days. Photos come from Unsplash (free licence, no recognisable people, credits in
// demo/photos/CREDITS.md); if a file is missing or the app runs offline, a procedurally painted
// placeholder of the same scene is used instead. For the real demo, use your own favourite day.
import { rng, canvasBlob } from './util.js';

const W = 960, H = 1200;

function canvas(w = W, h = H) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function vgrad(x, y0, y1, stops) { const g = x.createLinearGradient(0, y0, 0, y1); stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s)); return g; }
function blobs(x, r, n, X, Y, w, h, colors, rmin, rmax, alpha = 0.85) {
  for (let i = 0; i < n; i++) {
    x.globalAlpha = alpha * (0.6 + r() * 0.4); x.fillStyle = colors[Math.floor(r() * colors.length)];
    x.beginPath(); x.ellipse(X + r() * w, Y + r() * h, rmin + r() * (rmax - rmin), (rmin + r() * (rmax - rmin)) * (0.7 + r() * 0.5), r() * 3, 0, Math.PI * 2); x.fill();
  }
  x.globalAlpha = 1;
}
function glow(x, cx, cy, rad, color) { const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad); g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2); }
function grain(x, r, amt = 10, w = W, h = H) { const id = x.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (r() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } x.putImageData(id, 0, 0); }
function mug(x, cx, cy, w, h, body, drink) {
  x.fillStyle = body; x.beginPath(); x.roundRect(cx - w / 2, cy - h / 2, w, h, 18); x.fill();
  x.strokeStyle = body; x.lineWidth = 16; x.beginPath(); x.arc(cx + w / 2, cy, h * 0.22, -1.2, 1.2); x.stroke();
  x.fillStyle = drink; x.beginPath(); x.ellipse(cx, cy - h / 2 + 6, w / 2 - 6, 14, 0, 0, Math.PI * 2); x.fill();
}
function steam(x, r, cx, cy) {
  x.strokeStyle = 'rgba(255,255,255,0.45)'; x.lineWidth = 6; x.lineCap = 'round';
  for (let k = 0; k < 3; k++) { x.beginPath(); let px = cx - 20 + k * 20, py = cy; x.moveTo(px, py); for (let s = 0; s < 6; s++) { py -= 28; x.quadraticCurveTo(px + (s % 2 ? 18 : -18), py + 14, px + (r() - 0.5) * 6, py); } x.stroke(); }
}

const PAINT = {
  autumnAlley(x, r) {
    x.fillStyle = vgrad(x, 0, 650, ['#bcc8cc', '#e8d9bb']); x.fillRect(0, 0, W, 700);
    x.fillStyle = vgrad(x, 640, H, ['#b98a3c', '#7c5223']); x.fillRect(0, 640, W, H);
    x.fillStyle = 'rgba(214,190,140,0.75)'; x.beginPath(); x.moveTo(330, H); x.lineTo(630, H); x.lineTo(500, 650); x.lineTo(470, 650); x.closePath(); x.fill();
    glow(x, 760, 160, 380, 'rgba(255,226,160,0.55)');
    for (let i = 0; i < 10; i++) {
      const side = i % 2 ? 1 : -1, depth = Math.floor(i / 2) / 5, cx = 480 + side * (90 + (1 - depth) * 360), s = 1 - depth * 0.75;
      x.fillStyle = '#3b2a1e'; x.fillRect(cx - 16 * s, 420 + depth * 200, 32 * s, 700 * s);
      blobs(x, r, 70, cx - 220 * s, 120 + depth * 260, 440 * s, 420 * s, ['#e8b923', '#f0a01e', '#d9731a', '#f4cf4a', '#c8541a'], 16 * s, 64 * s);
    }
    blobs(x, r, 500, 0, 700, W, 500, ['#e8b923', '#d9731a', '#f4cf4a', '#a8461a'], 4, 14, 0.9);
  },
  autumnCocoa(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#d8b36a', '#a8743a']); x.fillRect(0, 0, W, H);
    x.filter = 'blur(22px)'; blobs(x, r, 60, 0, 0, W, 650, ['#f2c94c', '#e39b2d', '#f6dd8a', '#c0661f'], 40, 120, 0.9); x.filter = 'none';
    x.fillStyle = '#6b4426'; for (let i = 0; i < 3; i++) x.fillRect(0, 760 + i * 70, W, 52);
    x.fillStyle = '#4a2e19'; x.fillRect(120, 970, 40, 230); x.fillRect(800, 970, 40, 230);
    mug(x, 360, 680, 170, 190, '#efe6d6', '#5a2e1a'); mug(x, 600, 690, 160, 175, '#b5452f', '#5a2e1a');
    steam(x, r, 360, 560); steam(x, r, 600, 580);
    blobs(x, r, 40, 0, 900, W, 300, ['#e8b923', '#d9731a', '#a8461a'], 6, 18, 0.9);
  },
  autumnPond(x, r) {
    x.fillStyle = vgrad(x, 0, 520, ['#c4cdd0', '#efe2c4']); x.fillRect(0, 0, W, 560);
    blobs(x, r, 260, -40, 260, W + 80, 280, ['#e8b923', '#f0a01e', '#d9731a', '#c8541a', '#6f7f3a'], 20, 60);
    x.fillStyle = vgrad(x, 560, H, ['#8a9a96', '#4f615f']); x.fillRect(0, 560, W, H);
    x.save(); x.translate(0, 1120); x.scale(1, -1); x.globalAlpha = 0.45; x.filter = 'blur(8px)';
    blobs(x, r, 160, -40, 260, W + 80, 280, ['#e8b923', '#f0a01e', '#d9731a'], 20, 60); x.restore(); x.filter = 'none';
    x.strokeStyle = 'rgba(255,255,255,0.25)'; x.lineWidth = 3; for (let i = 0; i < 40; i++) { const y = 600 + r() * 580, xx = r() * W; x.beginPath(); x.moveTo(xx, y); x.lineTo(xx + 40 + r() * 120, y); x.stroke(); }
    blobs(x, r, 30, 0, 580, W, 600, ['#f0a01e', '#e8b923'], 5, 10, 0.9);
  },
  officeMonitor(x, r) {
    x.fillStyle = '#0b1020'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 120; i++) { x.fillStyle = r() < 0.6 ? '#f6d36588' : '#9ad0ff77'; x.fillRect(560 + r() * 380, 60 + r() * 420, 6, 9); }
    x.fillStyle = '#0d1426'; x.fillRect(540, 40, 12, 460); x.fillRect(540, 480, 420, 12);
    glow(x, 400, 560, 520, 'rgba(70,130,220,0.45)');
    x.fillStyle = '#111827'; x.fillRect(120, 330, 560, 380); x.fillStyle = '#1d3557'; x.fillRect(140, 350, 520, 340);
    const cols = ['#7ec8e3', '#f7b267', '#c3f584', '#e5e5e5', '#ff6b6b'];
    for (let l = 0; l < 17; l++) { let cx = 160 + (l % 4) * 24; const y = 368 + l * 19; for (let k = 0; k < 2 + r() * 4; k++) { const w = 30 + r() * 110; x.fillStyle = cols[Math.floor(r() * cols.length)]; x.fillRect(cx, y, w, 9); cx += w + 12; if (cx > 620) break; } }
    x.fillStyle = '#1b1f2a'; x.fillRect(370, 710, 60, 90); x.fillRect(260, 790, 280, 20);
    x.fillStyle = '#141824'; x.fillRect(0, 820, W, H);
    x.fillStyle = '#2a3142'; x.fillRect(200, 880, 420, 70);
    for (let i = 0; i < 40; i++) { x.fillStyle = '#3d4659'; x.fillRect(212 + (i % 13) * 31, 890 + Math.floor(i / 13) * 18, 26, 13); }
    x.fillStyle = '#39ff88'; x.beginPath(); x.roundRect(720, 760, 70, 150, 12); x.fill(); x.fillStyle = '#0b1020'; x.fillRect(730, 800, 50, 40);
  },
  officeWindow(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#070b18', '#1b2440']); x.fillRect(0, 0, W, H);
    for (let b = 0; b < 7; b++) {
      const bx = b * 150 - 40 + r() * 30, bw = 110 + r() * 60, by = 200 + r() * 420;
      x.fillStyle = '#0d1324'; x.fillRect(bx, by, bw, H);
      for (let yy = by + 16; yy < H; yy += 26) for (let xx = bx + 10; xx < bx + bw - 12; xx += 18) if (r() < 0.42) { x.fillStyle = r() < 0.7 ? '#f6d365' : '#9ad0ff'; x.fillRect(xx, yy, 9, 13); }
      if (r() < 0.6) { x.fillStyle = '#ff3b3b'; x.beginPath(); x.arc(bx + bw / 2, by - 6, 4, 0, 7); x.fill(); }
    }
    x.fillStyle = 'rgba(160,190,255,0.06)'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#05070f'; x.lineWidth = 26; x.strokeRect(13, 13, W - 26, H - 26); x.beginPath(); x.moveTo(W / 2, 0); x.lineTo(W / 2, H); x.stroke();
  },
  officeDesk(x, r) {
    x.fillStyle = '#10172a'; x.fillRect(0, 0, W, H);
    glow(x, 640, 520, 560, 'rgba(255,200,120,0.5)');
    x.fillStyle = '#2b2118'; x.fillRect(0, 640, W, H);
    x.fillStyle = '#e9e1cf'; x.beginPath(); x.moveTo(560, 120); x.lineTo(720, 120); x.lineTo(760, 240); x.lineTo(520, 240); x.closePath(); x.fill();
    x.fillStyle = 'rgba(255,220,150,0.18)'; x.beginPath(); x.moveTo(520, 240); x.lineTo(760, 240); x.lineTo(940, 760); x.lineTo(340, 760); x.closePath(); x.fill();
    x.fillStyle = '#3a3f4d'; x.beginPath(); x.moveTo(120, 760); x.lineTo(520, 760); x.lineTo(560, 860); x.lineTo(80, 860); x.closePath(); x.fill();
    x.fillStyle = '#6aa3ff'; x.fillRect(150, 520, 340, 230);
    const notes = ['#ffe066', '#ff8fab', '#8ce99a', '#ffe066'];
    for (let i = 0; i < 6; i++) { x.save(); x.translate(560 + (i % 3) * 110, 820 + Math.floor(i / 3) * 110); x.rotate((r() - 0.5) * 0.3); x.fillStyle = notes[i % 4]; x.fillRect(-45, -45, 90, 90); x.restore(); }
    mug(x, 820, 690, 110, 120, '#d9d2c3', '#3b2416');
  },
  partyRoof(x, r) {
    x.fillStyle = vgrad(x, 0, 820, ['#7fb8de', '#ffd08a', '#ff8d5a']); x.fillRect(0, 0, W, 820);
    glow(x, 480, 760, 360, 'rgba(255,240,170,0.8)');
    x.fillStyle = '#5a2c45'; for (let b = 0; b < 12; b++) { const bw = 60 + r() * 70, bh = 60 + r() * 180; x.fillRect(b * 85 - 20, 820 - bh, bw, bh); }
    x.fillStyle = '#3a1f3d'; x.fillRect(0, 820, W, H);
    x.strokeStyle = '#2a1830'; x.lineWidth = 3; x.beginPath(); x.moveTo(-20, 180); x.quadraticCurveTo(480, 420, 980, 160); x.stroke();
    for (let i = 0; i <= 16; i++) { const t = i / 16, bx = -20 + 1000 * t, by = (1 - t) * (1 - t) * 180 + 2 * (1 - t) * t * 420 + t * t * 160; glow(x, bx, by + 14, 34, 'rgba(255,220,120,0.9)'); x.fillStyle = '#fff1b8'; x.beginPath(); x.arc(bx, by + 14, 7, 0, 7); x.fill(); }
    for (let p = 0; p < 6; p++) {
      const px = 110 + p * 150 + (r() - 0.5) * 30, py = 980 + (r() - 0.5) * 40, s = 0.9 + r() * 0.3;
      x.fillStyle = '#2a1430'; x.beginPath(); x.arc(px, py - 170 * s, 34 * s, 0, 7); x.fill();
      x.beginPath(); x.roundRect(px - 42 * s, py - 130 * s, 84 * s, 200 * s, 30 * s); x.fill();
      x.lineWidth = 20 * s; x.lineCap = 'round'; x.strokeStyle = '#2a1430';
      const up = r() < 0.6; x.beginPath(); x.moveTo(px - 36 * s, py - 110 * s); x.lineTo(px - 80 * s, py - (up ? 230 : 40) * s); x.moveTo(px + 36 * s, py - 110 * s); x.lineTo(px + 80 * s, py - (up ? 240 : 30) * s); x.stroke();
    }
  },
  partyCake(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#ffd6e0', '#ffb4a2']); x.fillRect(0, 0, W, H);
    [['#ff5d73', 160, 220], ['#ffd23f', 780, 200], ['#3bceac', 840, 420], ['#4d96ff', 110, 460]].forEach(([c, bx, by]) => { x.fillStyle = c; x.beginPath(); x.ellipse(bx, by, 80, 100, 0, 0, 7); x.fill(); x.strokeStyle = '#00000033'; x.lineWidth = 2; x.beginPath(); x.moveTo(bx, by + 100); x.lineTo(bx + 20, by + 300); x.stroke(); });
    x.fillStyle = '#fff6ea'; x.fillRect(0, 800, W, H);
    x.fillStyle = '#f7d6e0'; x.beginPath(); x.roundRect(250, 600, 460, 260, 30); x.fill();
    x.fillStyle = '#ffffff'; x.beginPath(); x.roundRect(290, 470, 380, 160, 30); x.fill();
    x.fillStyle = '#ff5d73'; for (let i = 0; i < 9; i++) { x.beginPath(); x.arc(300 + i * 45, 640, 16, 0, 7); x.fill(); }
    for (let i = 0; i < 5; i++) { const cx = 340 + i * 70; x.fillStyle = ['#4d96ff', '#ffd23f', '#3bceac', '#ff5d73', '#9b5de5'][i]; x.fillRect(cx - 8, 380, 16, 90); glow(x, cx, 360, 60, 'rgba(255,200,80,0.9)'); x.fillStyle = '#fff3b0'; x.beginPath(); x.ellipse(cx, 362, 9, 18, 0, 0, 7); x.fill(); }
    blobs(x, r, 160, 0, 0, W, H, ['#ff5d73', '#ffd23f', '#3bceac', '#4d96ff', '#9b5de5'], 5, 10, 0.9);
  },
  partyMelon(x, r) {
    x.fillStyle = '#f4e3c3'; x.fillRect(0, 0, W, H);
    glow(x, 860, 80, 520, 'rgba(255,240,180,0.9)');
    for (let i = 0; i < 6; i++) {
      x.save(); x.translate(180 + (i % 3) * 300, 330 + Math.floor(i / 3) * 420); x.rotate((r() - 0.5) * 0.9);
      x.fillStyle = '#2f8a57'; x.beginPath(); x.moveTo(-130, 60); x.lineTo(130, 60); x.lineTo(0, -150); x.closePath(); x.fill();
      x.fillStyle = '#e63946'; x.beginPath(); x.moveTo(-108, 44); x.lineTo(108, 44); x.lineTo(0, -128); x.closePath(); x.fill();
      x.fillStyle = '#1b1b1b'; for (let k = 0; k < 6; k++) { x.beginPath(); x.ellipse((r() - 0.5) * 100, -20 + (r() - 0.3) * 70, 5, 9, r(), 0, 7); x.fill(); }
      x.restore();
    }
    blobs(x, r, 120, 0, 0, W, H, ['#ff5d73', '#ffd23f', '#3bceac', '#4d96ff'], 4, 9, 0.9);
  },
  rainWindow(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#1d2633', '#2e3a48']); x.fillRect(0, 0, W, H);
    x.filter = 'blur(26px)'; blobs(x, r, 40, 0, 300, W, 700, ['#f2a65a', '#e76f51', '#76c7c0', '#f6d365'], 20, 60, 0.75); x.filter = 'none';
    x.fillStyle = 'rgba(160,190,210,0.12)'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 380; i++) { const dx = r() * W, dy = r() * H, s = 2 + r() * 7; x.fillStyle = 'rgba(220,235,255,0.35)'; x.beginPath(); x.ellipse(dx, dy, s * 0.7, s, 0, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.5)'; x.beginPath(); x.arc(dx - s * 0.2, dy - s * 0.3, s * 0.25, 0, 7); x.fill(); }
    x.strokeStyle = 'rgba(210,225,240,0.25)'; x.lineWidth = 2; for (let i = 0; i < 60; i++) { const sx = r() * W, sy = r() * H; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + (r() - 0.5) * 10, sy + 60 + r() * 140); x.stroke(); }
    x.strokeStyle = '#141a22'; x.lineWidth = 30; x.strokeRect(15, 15, W - 30, H - 30); x.beginPath(); x.moveTo(0, H * 0.55); x.lineTo(W, H * 0.55); x.stroke();
  },
  rainTea(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#3a4553', '#28303b']); x.fillRect(0, 0, W, H);
    x.fillStyle = 'rgba(150,175,200,0.18)'; x.fillRect(80, 80, 800, 620);
    x.strokeStyle = 'rgba(200,215,230,0.3)'; x.lineWidth = 2; for (let i = 0; i < 90; i++) { const sx = 90 + r() * 780, sy = 90 + r() * 600; x.beginPath(); x.moveTo(sx, sy); x.lineTo(sx + 2, sy + 30 + r() * 70); x.stroke(); }
    glow(x, 830, 560, 420, 'rgba(255,190,110,0.55)');
    x.fillStyle = '#d7c8b0'; x.fillRect(0, 700, W, 60);
    x.fillStyle = '#4b3b5c'; x.fillRect(0, 760, W, H);
    x.strokeStyle = 'rgba(200,120,90,0.55)'; x.lineWidth = 14; for (let i = 0; i < 12; i++) { x.beginPath(); x.moveTo(i * 90, 760); x.lineTo(i * 90, H); x.stroke(); x.beginPath(); x.moveTo(0, 790 + i * 40); x.lineTo(W, 790 + i * 40); x.stroke(); }
    mug(x, 420, 610, 160, 170, '#efe6d6', '#8a5a2b'); steam(x, r, 420, 500);
  },
  seaHorizon(x, r) {
    x.fillStyle = vgrad(x, 0, 620, ['#c9dbe6', '#f4e4d0']); x.fillRect(0, 0, W, 640);
    glow(x, 600, 600, 300, 'rgba(255,236,200,0.95)');
    x.fillStyle = '#fff4dc'; x.beginPath(); x.arc(600, 610, 46, 0, 7); x.fill();
    x.fillStyle = vgrad(x, 630, H, ['#a8c0cc', '#5f8396']); x.fillRect(0, 630, W, H);
    x.strokeStyle = 'rgba(255,240,215,0.7)'; x.lineWidth = 3;
    for (let i = 0; i < 70; i++) { const y = 640 + Math.pow(r(), 1.6) * 560, sp = 20 + (y - 640) * 0.3; const cx = 600 + (r() - 0.5) * sp * 2; x.beginPath(); x.moveTo(cx - 20, y); x.lineTo(cx + 20 + r() * 30, y); x.stroke(); }
    x.fillStyle = '#4b5a63'; x.beginPath(); x.moveTo(60, 640); x.quadraticCurveTo(160, 590, 260, 640); x.closePath(); x.fill();
  },
  seaShore(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#7fa6b4', '#e7dccb']); x.fillRect(0, 0, W, H);
    x.fillStyle = '#e9ddc8'; x.beginPath(); x.moveTo(0, 620); for (let i = 0; i <= 10; i++) x.lineTo(i * 96, 600 + Math.sin(i * 1.3) * 40); x.lineTo(W, H); x.lineTo(0, H); x.closePath(); x.fill();
    x.strokeStyle = 'rgba(255,255,255,0.85)'; x.lineWidth = 7; for (let k = 0; k < 3; k++) { x.beginPath(); for (let i = 0; i <= 20; i++) { const px = i * 48, py = 600 + k * 26 + Math.sin(i * 1.3 / 2 + k) * 34; i ? x.lineTo(px, py) : x.moveTo(px, py); } x.stroke(); }
    blobs(x, r, 40, 0, 700, W, 500, ['#b9ad98', '#8f877a', '#cfc4b0'], 6, 20, 0.9);
    x.strokeStyle = '#3e4a50'; x.lineWidth = 4; for (let i = 0; i < 4; i++) { const gx = 200 + r() * 600, gy = 150 + r() * 250; x.beginPath(); x.moveTo(gx - 22, gy); x.quadraticCurveTo(gx - 10, gy - 12, gx, gy); x.quadraticCurveTo(gx + 10, gy - 12, gx + 22, gy); x.stroke(); }
  },
  movingBoxes(x, r) {
    x.fillStyle = vgrad(x, 0, 760, ['#d9d3c7', '#c9c1b2']); x.fillRect(0, 0, W, 760);
    x.fillStyle = vgrad(x, 760, H, ['#9a7a55', '#6e5236']); x.fillRect(0, 760, W, H);
    x.strokeStyle = 'rgba(60,40,20,0.25)'; x.lineWidth = 3; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(0, 790 + i * 50); x.lineTo(W, 790 + i * 50); x.stroke(); }
    x.fillStyle = '#e9e0c9'; x.fillRect(560, 120, 300, 380); glow(x, 710, 310, 380, 'rgba(255,200,130,0.45)');
    x.strokeStyle = '#8f877a'; x.lineWidth = 12; x.strokeRect(560, 120, 300, 380); x.beginPath(); x.moveTo(710, 120); x.lineTo(710, 500); x.stroke();
    x.fillStyle = 'rgba(255,215,150,0.22)'; x.beginPath(); x.moveTo(560, 500); x.lineTo(860, 500); x.lineTo(960, 1000); x.lineTo(380, 1000); x.closePath(); x.fill();
    const boxes = [[90, 820, 300, 240], [130, 600, 240, 220], [420, 860, 260, 200], [170, 420, 180, 180], [700, 900, 220, 160]];
    for (const [bx, by, bw, bh] of boxes) {
      x.fillStyle = ['#b98a55', '#c79a62', '#a97a48'][Math.floor(r() * 3)]; x.fillRect(bx, by, bw, bh);
      x.fillStyle = 'rgba(0,0,0,0.12)'; x.fillRect(bx, by, bw, 16);
      x.fillStyle = 'rgba(230,220,190,0.7)'; x.fillRect(bx + bw / 2 - 18, by, 36, bh);
      x.strokeStyle = '#2a2420'; x.lineWidth = 5; x.beginPath(); x.moveTo(bx + 24, by + bh - 50); for (let k = 0; k < 5; k++) x.lineTo(bx + 34 + k * 18, by + bh - 50 + (k % 2 ? -12 : 8)); x.stroke();
    }
  },
  movingLamp(x, r) {
    x.fillStyle = vgrad(x, 0, H, ['#2c2a33', '#4a3a36']); x.fillRect(0, 0, W, H);
    glow(x, 480, 720, 560, 'rgba(255,190,110,0.6)');
    x.strokeStyle = '#1f1b1d'; x.lineWidth = 3; x.beginPath(); x.moveTo(-20, 140); x.quadraticCurveTo(480, 360, 980, 120); x.stroke();
    for (let i = 0; i <= 14; i++) { const t = i / 14, bx = -20 + 1000 * t, by = (1 - t) * (1 - t) * 140 + 2 * (1 - t) * t * 360 + t * t * 120 + 12; glow(x, bx, by, 30, 'rgba(255,214,120,0.9)'); x.fillStyle = '#fff1b8'; x.beginPath(); x.arc(bx, by, 6, 0, 7); x.fill(); }
    x.fillStyle = '#7a5a3a'; x.fillRect(0, 900, W, H);
    [[60, 640, 260, 260], [700, 600, 230, 300], [300, 760, 200, 140]].forEach(([bx, by, bw, bh]) => { x.fillStyle = '#8c6740'; x.fillRect(bx, by, bw, bh); x.fillStyle = 'rgba(0,0,0,0.25)'; x.fillRect(bx, by, bw, 14); });
    x.fillStyle = '#f3e3c3'; x.beginPath(); x.moveTo(430, 520); x.lineTo(530, 520); x.lineTo(570, 620); x.lineTo(390, 620); x.closePath(); x.fill();
    x.fillStyle = '#2a2420'; x.fillRect(474, 620, 12, 280); x.fillRect(420, 890, 120, 14);
    for (let p = 0; p < 2; p++) {
      const px = 380 + p * 220, py = 880, s = 1.05;
      x.fillStyle = '#1d1719'; x.beginPath(); x.arc(px, py - 300 * s, 36 * s, 0, 7); x.fill();
      x.beginPath(); x.roundRect(px - 44 * s, py - 260 * s, 88 * s, 220 * s, 32 * s); x.fill();
      x.lineWidth = 22; x.lineCap = 'round'; x.strokeStyle = '#1d1719';
      x.beginPath(); x.moveTo(px - 38, py - 240); x.lineTo(px - (p ? 60 : 110), py - (p ? 360 : 300)); x.moveTo(px + 38, py - 240); x.lineTo(px + (p ? 110 : 70), py - (p ? 300 : 380)); x.stroke();
      x.beginPath(); x.moveTo(px - 20, py - 50); x.lineTo(px - 40, py + 40); x.moveTo(px + 20, py - 50); x.lineTo(px + 50, py + 30); x.stroke();
    }
  },
  villageHouse(x, r) {
    x.fillStyle = vgrad(x, 0, 700, ['#f2c48a', '#f7e2b6']); x.fillRect(0, 0, W, 720);
    glow(x, 160, 300, 380, 'rgba(255,214,140,0.8)');
    x.fillStyle = '#6f8f4a'; x.fillRect(0, 700, W, H);
    x.fillStyle = '#8b5a33'; x.fillRect(300, 420, 420, 360);
    x.strokeStyle = '#6a4224'; x.lineWidth = 3; for (let y = 440; y < 780; y += 24) { x.beginPath(); x.moveTo(300, y); x.lineTo(720, y); x.stroke(); }
    x.fillStyle = '#8c2f24'; x.beginPath(); x.moveTo(270, 430); x.lineTo(510, 260); x.lineTo(750, 430); x.closePath(); x.fill();
    x.fillStyle = '#ffe7a8'; x.fillRect(430, 520, 160, 140); x.strokeStyle = '#f4efe6'; x.lineWidth = 10; x.strokeRect(430, 520, 160, 140); x.beginPath(); x.moveTo(510, 520); x.lineTo(510, 660); x.moveTo(430, 590); x.lineTo(590, 590); x.stroke();
    blobs(x, r, 120, 0, 650, 300, 300, ['#4f7a3a', '#6a9a45', '#3c5f2c'], 20, 50);
    blobs(x, r, 30, 30, 680, 240, 220, ['#c0392b', '#e74c3c'], 7, 11, 1);
    x.fillStyle = '#d9c7a3'; for (let i = 0; i < 18; i++) x.fillRect(i * 56, 880, 14, 140); x.fillRect(0, 920, W, 12); x.fillRect(0, 980, W, 12);
  },
  villageApples(x, r) {
    x.fillStyle = '#c99a62'; x.fillRect(0, 0, W, H);
    x.strokeStyle = 'rgba(110,70,30,0.35)'; x.lineWidth = 2; for (let i = 0; i < 80; i++) { x.beginPath(); x.moveTo(0, i * 15 + r() * 5); x.bezierCurveTo(300, i * 15 + r() * 20, 600, i * 15 - r() * 20, W, i * 15 + r() * 5); x.stroke(); }
    x.fillStyle = '#eef1f6'; x.fillRect(80, 200, 800, 820); x.strokeStyle = '#6a8fc7'; x.lineWidth = 8; for (let i = 0; i < 9; i++) { x.beginPath(); x.moveTo(80 + i * 100, 200); x.lineTo(80 + i * 100, 1020); x.stroke(); x.beginPath(); x.moveTo(80, 200 + i * 103); x.lineTo(880, 200 + i * 103); x.stroke(); }
    x.fillStyle = '#d4a04c'; x.beginPath(); x.arc(330, 640, 210, 0, 7); x.fill(); x.strokeStyle = '#b07a2a'; x.lineWidth = 14; for (let i = -3; i <= 3; i++) { x.beginPath(); x.moveTo(330 + i * 55, 450); x.lineTo(330 + i * 55, 830); x.stroke(); x.beginPath(); x.moveTo(130, 640 + i * 55); x.lineTo(530, 640 + i * 55); x.stroke(); }
    for (let i = 0; i < 9; i++) { const ax = 640 + (i % 3) * 80 + r() * 20, ay = 420 + Math.floor(i / 3) * 80 + r() * 20; x.fillStyle = i % 3 ? '#c0392b' : '#e9c46a'; x.beginPath(); x.arc(ax, ay, 40, 0, 7); x.fill(); x.fillStyle = 'rgba(255,255,255,0.4)'; x.beginPath(); x.arc(ax - 13, ay - 13, 10, 0, 7); x.fill(); }
    x.fillStyle = 'rgba(255,240,200,0.25)'; x.beginPath(); x.moveTo(0, 0); x.lineTo(380, 0); x.lineTo(W, H); x.lineTo(500, H); x.closePath(); x.fill();
  },
  villagePhotos(x, r) {
    x.fillStyle = '#8a6a48'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 6; i++) {
      x.save(); x.translate(180 + (i % 2) * 380 + r() * 60, 230 + Math.floor(i / 2) * 330 + r() * 40); x.rotate((r() - 0.5) * 0.5);
      x.fillStyle = '#f3ead8'; x.fillRect(-160, -120, 320, 240);
      x.fillStyle = vgrad(x, -100, 100, ['#c9b38c', '#8f7553']); x.fillRect(-140, -100, 280, 170);
      x.fillStyle = '#6e5a3e'; x.beginPath(); x.moveTo(-140, 40); x.quadraticCurveTo(0, -20 - r() * 40, 140, 30); x.lineTo(140, 70); x.lineTo(-140, 70); x.closePath(); x.fill();
      x.restore();
    }
    x.strokeStyle = 'rgba(40,30,20,0.5)'; x.lineWidth = 3; for (let l = 0; l < 6; l++) { x.beginPath(); x.moveTo(560, 960 + l * 34); for (let k = 0; k < 12; k++) x.lineTo(560 + k * 28, 960 + l * 34 + (r() - 0.5) * 8); x.stroke(); }
  },
};

const PAINT_FALLBACK = { villagePie: 'villagePhotos' };

export async function paintPhoto(name, seed) {
  const [c, x] = canvas();
  const r = rng(seed);
  (PAINT[name] || PAINT[PAINT_FALLBACK[name]] || PAINT.autumnAlley)(x, r);
  grain(x, r, 9);
  const blob = await canvasBlob(c, 'image/jpeg', 0.9);
  return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
}

export async function loadDemoPhoto(name, seed) {
  try {
    const res = await fetch(`demo/photos/${name}.jpg`);
    if (res.ok) {
      const blob = await res.blob();
      if (blob.size > 1000 && blob.type.startsWith('image/')) return new File([blob], `${name}.jpg`, { type: 'image/jpeg' });
    }
  } catch { /* offline: fall back to the painted scene */ }
  return paintPhoto(name, seed);
}

export const DEMO_DAYS = [
  {
    date: '2026-10-18', photos: ['autumnAlley', 'autumnCocoa', 'autumnPond'], song: 'Frank Sinatra Autumn Leaves',
    text: 'Гуляли с Аней по парку, всё было в жёлтых листьях. Холодно, пальцы мёрзли, но мы взяли какао в термосе и долго сидели на скамейке у пруда, разговаривали обо всём. Пахло мокрой листвой, где-то играл уличный саксофон.',
  },
  {
    date: '2026-11-12', photos: ['officeMonitor', 'officeWindow', 'officeDesk'], song: 'Daft Punk Derezzed',
    text: 'Срочная сдача проекта. Всю ночь сидел в офисе, в наушниках электроника на повторе, третий энергетик. Код падал, тимлид писал каждые полчаса, нервы на пределе. В 3:40 всё собралось и заработало, и город за окном был весь в огнях.',
  },
  {
    date: '2026-07-25', photos: ['partyRoof', 'partyCake', 'partyMelon'], song: 'Earth, Wind & Fire September',
    text: 'День рождения Марата на крыше! Солнце, жара, мы с друзьями танцевали до заката, ели арбуз и торт, кто-то принёс гирлянду. Смеялись так, что болели щёки.',
  },
  {
    date: '2026-11-05', photos: ['rainWindow', 'rainTea'], song: "Billie Eilish when the party's over",
    text: 'Весь вечер одна дома. За окном дождь, фонари размыты. Сделала чай, завернулась в плед и слушала одну и ту же песню. Немного грустно, немного спокойно — как будто весь мир на паузе.',
  },
  {
    date: '2026-08-14', photos: ['seaHorizon', 'seaShore'], song: 'Ryuichi Sakamoto Merry Christmas Mr. Lawrence',
    text: 'Проснулся в пять утра и пошёл к морю, пока все спали. Тихо, только волны и чайки. Вода холодная и прозрачная, солнце только поднималось. Сидел на камне и ни о чём не думал.',
  },
  {
    date: '2026-09-06', photos: ['villageHouse', 'villageApples', 'villagePie'], song: 'Fleetwood Mac Dreams',
    text: 'Приехали к бабушке в деревню. Пахло яблоками и печкой, она испекла пирог, как в детстве. Вечером разбирали старые фотографии, бабушка рассказывала про свою молодость. Тепло и чуть-чуть грустно.',
  },
  {
    // signals disagree on purpose: a sad entry with a joyful song
    date: '2026-10-30', photos: ['movingBoxes', 'movingLamp'], song: 'ABBA Dancing Queen',
    text: 'Последний вечер перед переездом. Разбирали коробки, в квартире стало пусто и немного грустно, стены голые, эхо. Но потом включили старую пластинку и танцевали прямо среди вещей, под одной лампой.',
  },
];
