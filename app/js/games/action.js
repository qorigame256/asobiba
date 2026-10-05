// アクションの4つ（弾幕回避・玉入れ・間違い探し・2色爆弾サバイバル）で共通に使う小道具。
// 遊んでいる間はページを動かさない（style.css の .ac-live）。絵は canvas に描き、画面の高さに収まる大きさにする。

// 席ごとの色（10人まで）
export const SEAT_COLORS = ['#e04b3c', '#2f6fb3', '#3a9d55', '#e8a913', '#8e44ad', '#16a3a3', '#d35400', '#c2185b', '#6d7f00', '#5d6d7e'];

// canvas を、横 1 : 縦 aspect の比で、幅いっぱいかつ画面の下にはみ出さない大きさにする。
// 返り値は 1（盤の横幅）あたりの画面上の点の数。below = canvas の下に残したい高さ（説明の行など）
export function fitCanvas(canvas, ctx, aspect, { maxW = 520, below = 20 } = {}) {
  const box = canvas.parentElement;
  const top = canvas.getBoundingClientRect().top;
  const room = Math.max(240, window.innerHeight - top - below);
  const width = Math.max(200, Math.min(box?.clientWidth || 340, maxW, room / aspect));
  const height = width * aspect;
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return width;
}

// ポインター（指・マウス）の位置を、盤の座標（横 0〜1）にする
export function toBoard(canvas, e) {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left) / r.width, y: ((e.clientY - r.top) / r.width) };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
