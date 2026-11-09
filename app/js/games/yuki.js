// 雪合戦。赤と白の2チームが、上から見た雪原の半分ずつに分かれて雪玉を投げ合う。2〜10人・足りない分は CPU。
// 2026-11-09 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 自分の陣地を押すとそこへ歩き、相手の陣地を押すとそこへ向けて雪玉がまっすぐ飛ぶ（指1本・マウスだけで遊べる）。
//   - 雪玉を作るのに約1秒かかる（連打できない）。陣地には壊れない雪の壁があり、裏に隠れると雪玉を防げる。
//   - 当たるとライフが1減り、0で脱落。相手チームを全員倒したら勝ち。90秒で決まらなければ、残りのライフの合計が多いチームの勝ち（同じなら引き分け）。
//   - 人数は玉入れと同じく、待合室で全員の数を偶数にそろえ、足りない分は CPU（evenTeams）。
// Claude の判断:
//   - チームは席の番号で決める（偶数の席が赤、奇数の席が白。玉入れと同じ）。自分のチームがいつも画面の下に来るよう、白の人の画面は上下左右を回して描く。
//   - 詳細設定「ライフ」1・3（最初）・5、「時間」60・90（最初）・120秒（どちらも大縄とび・玉入れと同じ形。おまかせで抽選しない（KEEP_KEYS の lives・time））。
//   - 当たったあと1.5秒は当たらない（点滅する）。味方の雪玉には当たらない。雪玉は壁に当たると消える（自分の陣地の壁にも当たる）。
//   - CPU は弱め: 1.6〜3秒に1回（自分の陣地の壁でふさがれているときは投げずに場所を変える）、生きている相手を1人選んで横に ±0.13・縦に ±0.08 ずらして投げ、近づく雪玉を35%だけ横へよける。半分は壁の裏へ歩く。
//   - 歩く速さ・雪玉の速さ・壁の置き場所は下の数のとおり。雪玉が自分の陣地の端から相手の陣地の端まで行くのに約1.4秒かかるので、見てからよけられる。
// 作り（通信。弾幕回避・2色爆弾と同じ考え方で、ホストが有利にならないようにした）:
//   - 自分の位置と投げた雪玉は見た目だけの中身として送りっぱなしにする（o.stream / onStream。位置は0.1秒ごと、雪玉は投げた瞬間）。
//   - 当たったかは「当てられた人の端末」が自分の画面で決め、手 { t: 'hit', k, by, b } で送る（自分の画面でよけたら当たらない）。
//     k は何回目の当たりか（局面の hits[p] と違う手は弾く。同じ当たりが2回届いても1回だけ数える）、by は投げた人、b は雪玉の印（ほかの画面でその雪玉を消す）。
//     局面の当たりの数が端末の数より少ないあいだは0.5秒ごとに送り直す（2色爆弾・金魚すくいと同じわけ。ゲストの手がすれ違って消えることがある）。
//   - 雪玉の通り道と壁は全員同じなので、壁で消えるのはどの画面でも同じ。投げた人の画面と当てられた人の画面で、人の位置は通信の分だけずれる。
//   - CPU（と部屋を出た人の席）はホストの端末が動かし、当たりもホストの画面で決める（cpu() が当たりを手にする）。CPU の位置と雪玉はホストが送る。
// 2026-11-09 の37回目の案（本人が選んだ。分かれ目は Claude の判断）:
//   - 詳細設定「壁の数」（鍵は walls）: なし・3つ（最初。前と同じ置き場所）・5つ（3つに、真ん中の壁と同じ段の左右の端寄りに1つずつ足す）。
//     遊び方の違いなのでおまかせで抽選してよい。壁なしでは CPU は壁の裏へ歩かず、いつも空いた所へ歩く。
//   - 壁はモジュールの walls に持ち、render と cpu が対局の詳細設定に合わせる（useWalls）。歩く・雪玉・描く・CPU は全部これを見る。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(時間＋待ち)→ end。片方のチームが全員脱落したら、その手で end。
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'hit', k, by, b }

import { since, scoreChips } from './party.js';
import { fitCanvas, toBoard, clamp } from './action.js';

export const H = 1.3;
export const MID = H / 2;
export const PR = 0.035; // 人の半径
export const BR = 0.02; // 雪玉の半径
export const WALK = 0.32; // 歩く速さ（盤の横幅 / 秒）
export const BALL_V = 0.8; // 雪玉の速さ
export const RELOAD_MS = 1000;
export const SAFE_MS = 1500;
const READY_MS = 3000;
const GRACE_MS = 1500;
const SEND_MS = 100;
const RESEND_MS = 500;
export const TEAM = ['赤', '白'];
const TEAM_COLOR = ['#e04b3c', '#f4f4f4'];
const TEAM_EDGE = ['#8f2318', '#555'];
export const teamOf = (p) => p % 2;

// 壁（赤の陣地の分。白の陣地は真ん中を中心に回した形）。詳細設定「壁の数」で なし・3つ（最初。前と同じ）・5つ
const WALLS3 = [
  { x: 0.12, y: 0.8, w: 0.2, h: 0.045 },
  { x: 0.68, y: 0.8, w: 0.2, h: 0.045 },
  { x: 0.4, y: 1.0, w: 0.2, h: 0.045 },
];
const WALLS5 = [...WALLS3, { x: 0.04, y: 1.0, w: 0.16, h: 0.045 }, { x: 0.8, y: 1.0, w: 0.16, h: 0.045 }];
const both = (ws) => [...ws, ...ws.map((r) => ({ x: 1 - r.x - r.w, y: H - r.y - r.h, w: r.w, h: r.h }))]; // 前の半分が赤・後ろの半分が白
export const wallCountOf = (rules) => ([0, 3, 5].includes(Number(rules?.walls)) ? Number(rules.walls) : 3);
export const wallsOf = (rules) => both([[], [], [], WALLS3, [], WALLS5][wallCountOf(rules)]);
export const WALLS = wallsOf({}); // 最初の3つ（自動確認の目安）
// いま遊んでいる対局の壁。全員同じ詳細設定なので、どの端末でも同じ壁になる（render と cpu が対局の詳細設定に合わせる）
let walls = WALLS;
export const useWalls = (rules) => { walls = wallsOf(rules); return walls; };

const livesOf = (s) => ([1, 3, 5].includes(Number(s.rules.lives)) ? Number(s.rules.lives) : 3);
const durOf = (s) => ([60, 90, 120].includes(Number(s.rules.time)) ? Number(s.rules.time) : 90);
const goKey = (s) => `yuki:${s.seed}:go`;
const clone = (s) => ({ ...s, hits: s.hits.slice(), got: s.got.slice(), dead: s.dead.slice(), hitB: s.hitB.slice() });
export const aliveOf = (s, t) => s.dead.map((d, p) => (!d && teamOf(p) === t ? p : -1)).filter((p) => p >= 0);
// チームごとの残りのライフの合計
export const lifeSums = (s) => [0, 1].map((t) => s.hits.reduce((a, h, p) => a + (teamOf(p) === t ? Math.max(0, livesOf(s) - h) : 0), 0));

// 始めの立ち位置（チームの中の並び順で横に散らす）
export function spawnOf(p, n) {
  const t = teamOf(p);
  const m = Math.ceil((n - t) / 2);
  const i = Math.floor(p / 2);
  const x = (i + 1) / (m + 1);
  return t === 0 ? { x, y: H - 0.13 } : { x: 1 - x, y: 0.13 };
}

// 円と四角の重なり。重なっていれば押し出す向きと深さを返す
function circleRect(x, y, r, w) {
  const cx = clamp(x, w.x, w.x + w.w);
  const cy = clamp(y, w.y, w.y + w.h);
  const dx = x - cx; const dy = y - cy;
  const d = Math.hypot(dx, dy);
  if (d >= r) return null;
  if (d > 1e-6) return { nx: dx / d, ny: dy / d, depth: r - d };
  // 中心が四角の中: いちばん近い辺から出す
  const opts = [[-1, 0, x - w.x], [1, 0, w.x + w.w - x], [0, -1, y - w.y], [0, 1, w.y + w.h - y]].sort((a, b) => a[2] - b[2]);
  return { nx: opts[0][0], ny: opts[0][1], depth: opts[0][2] + r };
}

// 人を目的地へ dt 秒歩かせ、自分の陣地の中・壁の外に収める
export function walk(pl, team, dt) {
  if (pl.tx !== undefined) {
    const dx = pl.tx - pl.x; const dy = pl.ty - pl.y;
    const d = Math.hypot(dx, dy);
    const st = WALK * dt;
    if (d <= st) { pl.x = pl.tx; pl.y = pl.ty; pl.tx = undefined; pl.ty = undefined; }
    else { pl.x += (dx / d) * st; pl.y += (dy / d) * st; }
  }
  pl.x = clamp(pl.x, PR, 1 - PR);
  pl.y = team === 0 ? clamp(pl.y, MID + PR, H - PR) : clamp(pl.y, PR, MID - PR);
  for (const w of walls) {
    const c = circleRect(pl.x, pl.y, PR, w);
    if (c) { pl.x += c.nx * c.depth; pl.y += c.ny * c.depth; }
  }
}

// 雪玉を dt 秒進める。壁に当たるか雪原の外へ出たら false
export function stepBall(b, dt) {
  b.x += b.vx * dt;
  b.y += b.vy * dt;
  if (b.x < -BR || b.x > 1 + BR || b.y < -BR || b.y > H + BR) return false;
  return !walls.some((w) => circleRect(b.x, b.y, BR, w));
}
// 雪玉が自分の陣地の壁に当たらずに真ん中の線を越えるか（CPU が壁の裏から自分の壁へ投げないように）
export function crossesMid(ball) {
  const b = { ...ball };
  const down = b.vy > 0;
  for (let i = 0; i < 300; i++) {
    if (!stepBall(b, 0.01)) return false;
    if (down ? b.y > MID : b.y < MID) return true;
  }
  return false;
}
export const touches = (b, pl) => Math.hypot(b.x - pl.x, b.y - pl.y) < PR + BR;

// (x, y) から (tx, ty) へ向けて投げる雪玉（人のふちから出す）
export function throwBall(x, y, tx, ty) {
  const dx = tx - x; const dy = ty - y;
  const d = Math.hypot(dx, dy) || 1;
  const ux = dx / d; const uy = dy / d;
  return { x: x + ux * (PR + BR), y: y + uy * (PR + BR), vx: ux * BALL_V, vy: uy * BALL_V };
}

/* ---------- 画面 ---------- */

let ui = null;
export const sims = new Map(); // CPU の動き（ホストの端末だけ。鍵は `${seed}:${席}`）

const simKey = (s, p) => `${s.seed}:${p}`;
// CPU が動かさなくなった席（観戦の人が入った・出た人が戻った）の CPU の動きを捨てる（ホストの step が毎回呼ぶ）。
// 残すと、その席の人から届く位置を捨てて止まって見え、またその席を CPU が代わると古い当たりの数を使い続けて当たりが手にならない（2026-11-09 Codex の点検）。
// 最後の位置は見た目の位置（ghosts）へ移し、また CPU が代わるときは cpu() が今の当たりの数と位置から作り直す。
export function releaseSims(s, o, ghosts) {
  for (let p = 0; p < s.n; p++) {
    const c = o.cpu?.[p] ? null : sims.get(simKey(s, p));
    if (!c) continue;
    ghosts?.set(p, { x: c.x, y: c.y });
    sims.delete(simKey(s, p));
  }
}
const playing = (s) => s.phase === 'play' && since(goKey(s)) / 1000 < durOf(s);

// 盤の座標 ↔ 画面の座標（白の人は上下左右を回す）
const view = (x, y) => (ui.flip ? [1 - x, H - y] : [x, y]);

function posOf(p) {
  if (p === ui.me) return ui.self;
  const c = sims.get(simKey(ui.cur.s, p));
  if (c) return c;
  return ui.ghosts.get(p) ?? null;
}

function draw() {
  const { s, o } = ui.cur;
  const ctx = ui.ctx;
  const k = ui.scale;
  const now = performance.now();
  // 雪原
  ctx.fillStyle = '#eef6fb';
  ctx.fillRect(0, 0, k, k * H);
  // 自分の側を少し色づける
  ctx.fillStyle = 'rgba(120, 170, 220, .10)';
  ctx.fillRect(0, MID * k, k, MID * k);
  ctx.strokeStyle = '#9fb8cc';
  ctx.setLineDash([k * 0.02, k * 0.015]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, MID * k);
  ctx.lineTo(k, MID * k);
  ctx.stroke();
  ctx.setLineDash([]);
  // 壁
  for (const w of walls) {
    const [ax, ay] = view(w.x, w.y);
    const [bx, by] = view(w.x + w.w, w.y + w.h);
    const x0 = Math.min(ax, bx) * k; const y0 = Math.min(ay, by) * k;
    const ww = Math.abs(bx - ax) * k; const hh = Math.abs(by - ay) * k;
    ctx.fillStyle = 'rgba(80, 110, 140, .18)';
    ctx.fillRect(x0 + 2, y0 + 4, ww, hh);
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#a9c2d6';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x0, y0, ww, hh, hh / 2);
    else ctx.rect(x0, y0, ww, hh);
    ctx.fill();
    ctx.stroke();
  }
  // 歩いていく先の印
  if (ui.self && ui.self.tx !== undefined) {
    const [x, y] = view(ui.self.tx, ui.self.ty);
    ctx.strokeStyle = 'rgba(47, 111, 179, .6)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x * k, y * k, PR * 0.6 * k, 0, Math.PI * 2);
    ctx.stroke();
  }
  // 人
  const lives = livesOf(s);
  for (let p = 0; p < s.n; p++) {
    if (s.dead[p] || (p === ui.me && ui.out)) continue;
    const pl = posOf(p);
    if (!pl) continue;
    const g = pl.dx !== undefined ? [pl.dx, pl.dy] : [pl.x, pl.y];
    const [x, y] = view(g[0], g[1]);
    const t = teamOf(p);
    const safe = (p === ui.me ? ui.safeUntil : (ui.blink.get(p) ?? 0)) > now;
    if (safe && !ui.calm && Math.floor(now / 120) % 2) ctx.globalAlpha = 0.35;
    ctx.beginPath();
    ctx.arc(x * k, y * k, PR * k, 0, Math.PI * 2);
    ctx.fillStyle = TEAM_COLOR[t];
    ctx.fill();
    ctx.lineWidth = p === ui.me ? 3 : 1.5;
    ctx.strokeStyle = p === ui.me ? '#2f6fb3' : TEAM_EDGE[t];
    ctx.stroke();
    ctx.globalAlpha = 1;
    // 残りのライフ（頭の上の小さな点）
    const left = Math.max(0, lives - s.hits[p]);
    for (let i = 0; i < left; i++) {
      ctx.beginPath();
      ctx.arc((x + (i - (left - 1) / 2) * 0.018) * k, (y - PR - 0.014) * k, 0.006 * k, 0, Math.PI * 2);
      ctx.fillStyle = '#e04b3c';
      ctx.fill();
    }
    // 名前（自分は「あなた」）
    ctx.font = `${Math.max(10, k * 0.03)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = '#334';
    const nm = p === ui.me ? 'あなた' : String(o.names?.[p] ?? '').slice(0, 6);
    ctx.fillText(nm, x * k, (y + PR + 0.032) * k);
    // 雪玉の用意（自分だけ。輪が一周したら投げられる）
    if (p === ui.me && playing(s)) {
      const r = clamp((now - ui.lastThrow) / RELOAD_MS, 0, 1);
      ctx.strokeStyle = r >= 1 ? '#3a9d55' : '#9fb8cc';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(x * k, y * k, (PR + 0.008) * k, -Math.PI / 2, -Math.PI / 2 + r * Math.PI * 2);
      ctx.stroke();
    }
  }
  // 雪玉
  for (const b of ui.balls) {
    const [x, y] = view(b.x, b.y);
    ctx.beginPath();
    ctx.arc(x * k, y * k, BR * k, 0, Math.PI * 2);
    ctx.fillStyle = '#ffffff';
    ctx.fill();
    ctx.strokeStyle = teamOf(b.from) === 0 ? '#e04b3c' : '#6b7c8c';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  // 当たったときの雪しぶき
  ui.puffs = ui.puffs.filter((q) => now - q.at < 500);
  for (const q of ui.puffs) {
    const [x, y] = view(q.x, q.y);
    const a = (now - q.at) / 500;
    ctx.globalAlpha = 1 - a;
    ctx.fillStyle = q.hit ? '#ffd43b' : '#ffffff';
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc((x + Math.cos(ang) * a * 0.05) * k, (y + Math.sin(ang) * a * 0.05) * k, 0.008 * k, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // 上の文字: 残りのライフの合計と時間
  const sums = lifeSums(s);
  const mine = ui.flip ? 1 : 0;
  // チームのライフは左の隅（真ん中の下は自分の始めの立ち位置と重なるため）
  ctx.font = `bold ${Math.max(13, k * 0.045)}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#334';
  ctx.fillText(`${TEAM[1 - mine]} ❤${sums[1 - mine]}`, k * 0.025, k * 0.055);
  ctx.fillText(`${TEAM[mine]} ❤${sums[mine]}`, k * 0.025, (H - 0.018) * k);
  ctx.textAlign = 'center';
  ctx.font = `${Math.max(12, k * 0.038)}px sans-serif`;
  let text = '';
  if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`yuki:${s.seed}:ready`)) / 1000);
    ctx.font = `bold ${k * 0.16}px sans-serif`;
    ctx.fillStyle = '#2f6fb3';
    ctx.fillText(left > 0 ? String(left) : 'スタート！', k / 2, (MID + 0.06) * k);
  } else if (s.phase === 'end') text = 'おしまい！';
  else {
    const t = since(goKey(s)) / 1000;
    text = t < durOf(s) ? `残り ${Math.ceil(durOf(s) - t)}秒` : 'そこまで！';
  }
  if (text) { ctx.fillStyle = '#556'; ctx.fillText(text, k / 2, (MID - 0.015) * k); }
  if (ui.me !== null && ui.out && s.phase !== 'end') {
    ctx.font = `bold ${Math.max(13, k * 0.045)}px sans-serif`;
    ctx.fillStyle = '#c0392b';
    ctx.fillText('やられた！ 仲間を応援しよう', k / 2, (MID + 0.12) * k);
  }
}

// CPU を1人分 dt 秒動かす（ホストの端末だけ）
function stepCpu(c, p, s, dt, now) {
  const t = teamOf(p);
  if (now >= c.nextMove) {
    c.nextMove = now + 1200 + Math.random() * 1400;
    const per = walls.length / 2; // 1チームの壁の数
    if (per > 0 && Math.random() < 0.5) {
      // 自分の陣地の壁の裏（真ん中から遠い側）へ
      const w = walls[t * per + Math.floor(Math.random() * per)];
      c.tx = w.x + Math.random() * w.w;
      c.ty = t === 0 ? w.y + w.h + PR + 0.01 : w.y - PR - 0.01;
    } else {
      c.tx = 0.1 + Math.random() * 0.8;
      c.ty = t === 0 ? MID + 0.1 + Math.random() * (MID - 0.18) : 0.08 + Math.random() * (MID - 0.18);
    }
  }
  // 近づいてくる雪玉を、ときどき横へよける
  for (const b of ui.balls) {
    if (teamOf(b.from) === t || c.seen.has(b.id)) continue;
    const rx = c.x - b.x; const ry = c.y - b.y;
    const along = (rx * b.vx + ry * b.vy) / BALL_V; // 雪玉の進む向きに、あとどれだけ先にいるか
    if (along < 0 || along > 0.25) continue;
    const side = (rx * b.vy - ry * b.vx) / BALL_V; // 通り道からの横のずれ
    if (Math.abs(side) > PR + BR + 0.02) continue;
    c.seen.add(b.id);
    if (Math.random() < 0.35) {
      const sgn = side >= 0 ? 1 : -1;
      c.tx = c.x + (b.vy / BALL_V) * 0.15 * sgn;
      c.ty = c.y - (b.vx / BALL_V) * 0.15 * sgn;
      c.nextMove = now + 800;
    }
  }
  if (c.seen.size > 200) c.seen.clear();
  // 同じチームの CPU と重ならないように少し離す（同じ壁の裏へ集まって重なって見えたため）
  for (const [q, o2] of sims) {
    if (o2 === c || o2.hits >= livesOf(s) || !q.startsWith(`${s.seed}:`) || teamOf(Number(q.split(":")[1])) !== t) continue;
    const dx = c.x - o2.x; const dy = c.y - o2.y;
    const d = Math.hypot(dx, dy);
    if (d < PR * 2 && d > 1e-6) { c.x += (dx / d) * (PR * 2 - d) * 0.5; c.y += (dy / d) * (PR * 2 - d) * 0.5; }
  }
  walk(c, t, dt);
  // 投げる: 生きている相手を1人選び、少しずらして狙う
  if (now >= c.nextThrow) {
    c.nextThrow = now + 1600 + Math.random() * 1400;
    const foes = aliveOf(s, 1 - t).map((q) => posOf(q)).filter(Boolean);
    if (foes.length) {
      const f = foes[Math.floor(Math.random() * foes.length)];
      const ball = throwBall(c.x, c.y, f.x + (Math.random() - 0.5) * 0.26, f.y + (Math.random() - 0.5) * 0.16);
      if (crossesMid(ball)) addBall({ ...ball, id: `${p}:${c.tag}${c.thrown++}`, from: p }, true);
      else { c.nextMove = now; c.nextThrow = now + 500; } // 自分の陣地の壁でふさがれている: 投げずに場所を変える
    }
  }
}

function addBall(b, send) {
  if (ui.ids.has(b.id)) return;
  ui.ids.add(b.id);
  if (ui.ids.size > 600) ui.ids = new Set([...ui.ids].slice(-300));
  ui.balls.push(b);
  if (send) ui.cur.o.stream({ t: [[b.from, b.id, +b.x.toFixed(3), +b.y.toFixed(3), +b.vx.toFixed(3), +b.vy.toFixed(3)]] });
}

function step() {
  const { s, o } = ui.cur;
  const now = performance.now();
  const dt = Math.min(0.05, (now - ui.last) / 1000);
  ui.last = now;
  const live = playing(s);
  releaseSims(s, o, ui.ghosts);
  const n = Math.max(1, Math.ceil(dt / 0.01));
  const cpus = live ? [...Array(s.n).keys()].filter((p) => !s.dead[p] && sims.has(simKey(s, p)) && o.cpu?.[p]) : [];
  for (let i = 0; i < n; i++) {
    const h = dt / n;
    if (ui.self && !ui.out && live) walk(ui.self, ui.team, h);
    for (const p of cpus) {
      const c = sims.get(simKey(s, p));
      if (c.hits < livesOf(s)) stepCpu(c, p, s, h, now);
    }
    ui.balls = ui.balls.filter((b) => {
      if (!stepBall(b, h)) { ui.puffs.push({ x: b.x, y: b.y, at: now }); return false; }
      // 自分に当たったか（自分の画面で決める）
      if (ui.self && !ui.out && live && teamOf(b.from) !== ui.team && now >= ui.safeUntil && touches(b, ui.self)) {
        ui.hits.push({ by: b.from, b: b.id });
        ui.safeUntil = now + SAFE_MS;
        ui.puffs.push({ x: b.x, y: b.y, at: now, hit: true });
        if (ui.hits.length >= livesOf(s)) ui.out = true;
        sendHit(true);
        return false;
      }
      // CPU に当たったか（ホストの画面で決める）
      for (const p of cpus) {
        const c = sims.get(simKey(s, p));
        if (c.hits >= livesOf(s) || teamOf(b.from) === teamOf(p) || now < c.safeUntil || !touches(b, c)) continue;
        c.hits += 1;
        c.hitList.push({ by: b.from, b: b.id });
        c.safeUntil = now + SAFE_MS;
        ui.blink.set(p, c.safeUntil);
        ui.puffs.push({ x: b.x, y: b.y, at: now, hit: true });
        return false;
      }
      return true;
    });
  }
  // ほかの人の位置はなめらかに追いかける
  for (const g of ui.ghosts.values()) {
    if (g.dx === undefined) { g.dx = g.x; g.dy = g.y; }
    g.dx += (g.x - g.dx) * 0.25;
    g.dy += (g.y - g.dy) * 0.25;
  }
  // 位置を送る（自分と、ホストなら CPU の分も）
  if (live && now - ui.lastSend > SEND_MS) {
    ui.lastSend = now;
    const a = [];
    if (ui.self && !ui.out) a.push([ui.me, +ui.self.x.toFixed(3), +ui.self.y.toFixed(3)]);
    for (const p of cpus) { const c = sims.get(simKey(s, p)); a.push([p, +c.x.toFixed(3), +c.y.toFixed(3)]); }
    if (a.length) o.stream({ a });
  }
  if (now - ui.lastHitSend > RESEND_MS) sendHit(false);
}

// まだ局面に入っていない自分の当たりを送る（1回に1つずつ。届かなかったら0.5秒ごとに送り直す）
function sendHit(force) {
  const { s, o } = ui.cur;
  if (ui.me === null || s.phase !== 'play' || !o.canMove) return;
  const k = s.hits[ui.me];
  const h = ui.hits[k];
  if (!h) return;
  if (!force && performance.now() - ui.lastHitSend < RESEND_MS) return;
  ui.lastHitSend = performance.now();
  o.onMove({ t: 'hit', k, by: h.by, b: h.b });
}

function loop(token) {
  if (ui !== token || !ui.canvas.isConnected) return;
  if (ui.wrap.clientWidth !== ui.boxW) resize();
  step();
  draw();
  requestAnimationFrame(() => loop(token));
}

function resize() {
  if (!ui?.canvas.isConnected) return;
  ui.scale = fitCanvas(ui.canvas, ui.ctx, H, { below: 24 });
  ui.boxW = ui.wrap.clientWidth;
}
if (typeof window !== 'undefined') window.addEventListener('resize', resize);

const okSeat = (q, n) => Number.isInteger(q) && q >= 0 && q < n;

export default {
  id: 'yuki',
  name: '雪合戦',
  icon: '☃️',
  desc: '赤と白に分かれて雪玉を投げ合う。壁に隠れてよけ、相手チームを全員倒そう',
  ready: true,
  multi: true,
  realtime: true,
  evenTeams: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'lives', label: 'ライフ', desc: '何回当たったら脱落するか', def: '3', choices: [['1', '1'], ['3', '3'], ['5', '5']] },
    { key: 'time', label: '時間', desc: '1回の勝負の長さ。決まらなければ残りのライフの合計で決める', def: '90', choices: [['60', '60秒'], ['90', '90秒'], ['120', '120秒']] },
    { key: 'walls', label: '壁の数', desc: '自分の陣地にある雪の壁の数。なしは打ち合い、5つは隠れ合いになる', def: '3', choices: [['0', 'なし'], ['3', '3つ'], ['5', '5つ']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { lives: '3', time: '90', walls: '3', ...rules };
    return { n, seed, rules: r, phase: 'ready', hits: Array(n).fill(0), got: Array(n).fill(0), dead: Array(n).fill(false), hitB: Array(n).fill(null), step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'play' && !s.dead[p]; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'go' ? 'question' : null;
    if (m.p === me) return 'punch';
    if (m.by === me) return 'hit';
    return null; // ほかの人どうしの当たりは鳴らさない（にぎやかすぎるため）
  },
  result(s) {
    if (s.phase !== 'end') return null;
    const sums = lifeSums(s);
    if (sums[0] === sums[1]) return { draw: true, winner: null, team: null, teams: sums, scores: s.got.slice() };
    const t = sums[0] > sums[1] ? 0 : 1;
    const winners = s.hits.map((_, p) => (teamOf(p) === t ? p : -1)).filter((p) => p >= 0);
    return { winners, team: t, teams: sums, scores: s.got.slice() };
  },
  resultText(res, me) {
    const sc = `（残りのライフ 赤 ${res.teams[0]} − ${res.teams[1]} 白）`;
    if (res.team === null) return `引き分け！${sc}`;
    const mine = me >= 0 && teamOf(me) === res.team;
    return `${TEAM[res.team]}チームの勝ち！${mine ? '🎉' : ''}${sc}`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : '雪玉を投げ合おう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'play') return { key: 'play', ms: durOf(s) * 1000 + GRACE_MS, move: { t: 'end' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if ((m.t === 'go' && s0.phase === 'ready') || (m.t === 'end' && s0.phase === 'play')) {
        const s = clone(s0);
        s.step += 1;
        s.phase = m.t === 'go' ? 'play' : 'end';
        return s;
      }
      return null;
    }
    if (s0.phase !== 'play' || m.t !== 'hit' || !okSeat(m.p, s0.n) || s0.dead[m.p]) return null;
    if (m.k !== s0.hits[m.p] || !okSeat(m.by, s0.n) || teamOf(m.by) === teamOf(m.p)) return null;
    if (typeof m.b !== 'string' || m.b.length > 24) return null;
    const s = clone(s0);
    s.step += 1;
    s.hits[m.p] += 1;
    s.got[m.by] += 1;
    s.hitB[m.p] = m.b;
    if (s.hits[m.p] >= livesOf(s)) s.dead[m.p] = true;
    if (!aliveOf(s, 0).length || !aliveOf(s, 1).length) s.phase = 'end';
    return s;
  },

  // CPU（と部屋を出た人の席）: 動きはホストの画面（step）が進め、ここでは当たりを手にするだけ
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || s.dead[p]) return null;
    useWalls(s.rules);
    const key = simKey(s, p);
    let c = sims.get(key);
    if (!c) {
      const sp = ui?.ghosts.get(p) ?? spawnOf(p, s.n); // 部屋を出た人の席は、最後に見えた所から続ける
      const now = performance.now();
      // 当たったあとの当たらない時間も、人だったときの続きから（ホストの画面の点滅の終わり。当たった直後に代わると続けて当たっていた。2026-11-09 Codex の点検）
      const safe = ui?.blink.get(p) ?? 0;
      c = { x: sp.x, y: sp.y, nextMove: now + 300, nextThrow: now + 900 + Math.random() * 800, hits: s.hits[p], hitList: Array(s.hits[p]).fill(null), safeUntil: safe, thrown: 0, tag: Math.random().toString(36).slice(2, 6), seen: new Set() };
      sims.set(key, c);
      if (sims.size > 40) sims.delete(sims.keys().next().value);
    }
    const k = s.hits[p];
    const h = c.hitList[k];
    return h ? { t: 'hit', k, by: h.by, b: h.b } : null;
  },

  onStream(d, from) {
    if (!ui) return;
    const { s, o } = ui.cur;
    const ok = (q) => okSeat(q, s.n) && q !== ui.me && (q === from || o.cpu?.[q]);
    if (Array.isArray(d?.a)) {
      for (const e of d.a) {
        if (!Array.isArray(e) || !ok(e[0]) || sims.has(simKey(s, e[0]))) continue;
        const [x, y] = [Number(e[1]), Number(e[2])];
        if (![x, y].every(Number.isFinite)) continue;
        const g = ui.ghosts.get(e[0]) ?? {};
        g.x = clamp(x, 0, 1);
        g.y = clamp(y, 0, H);
        ui.ghosts.set(e[0], g);
      }
    }
    if (Array.isArray(d?.t)) {
      for (const e of d.t) {
        if (!Array.isArray(e) || !ok(e[0]) || typeof e[1] !== 'string' || e[1].length > 24 || ui.balls.length > 120) continue;
        const [x, y, vx, vy] = e.slice(2, 6).map(Number);
        if (![x, y, vx, vy].every(Number.isFinite)) continue;
        const sp = Math.hypot(vx, vy) || 1;
        addBall({ id: e[1], from: e[0], x: clamp(x, 0, 1), y: clamp(y, 0, H), vx: (vx / sp) * BALL_V, vy: (vy / sp) * BALL_V }, false);
      }
    }
  },

  render(root, s, o) {
    useWalls(s.rules);
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const lives = livesOf(s);
    const chips = scoreChips(o, s.got, {
      gain: false,
      extra: (p) => `<span style="color:${teamOf(p) ? '#777' : 'var(--red-ink, #c0392b)'}">${TEAM[teamOf(p)]}</span> ${s.dead[p] ? '💀' : '❤'.repeat(Math.max(0, lives - s.hits[p]))}`,
    });
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.canvas)) {
      // 新しく届いた当たり: ほかの画面で当たった雪玉を消して、しぶきを出す
      const now = performance.now();
      s.hits.forEach((h, p) => {
        if (h <= ui.cur.s.hits[p] || p === me) return;
        const b = ui.balls.find((x) => x.id === s.hitB[p]);
        ui.balls = ui.balls.filter((x) => x.id !== s.hitB[p]);
        const pl = posOf(p);
        if (b || pl) ui.puffs.push({ x: (b ?? pl).x, y: (b ?? pl).y, at: now, hit: true });
        if (!sims.has(simKey(s, p))) ui.blink.set(p, now + SAFE_MS);
      });
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      if (me !== null && s.dead[me]) ui.out = true;
      if (s.phase !== 'ready') since(goKey(s));
      return;
    }
    root.innerHTML = '';
    root.className = 'board ac';
    const wrap = document.createElement('div');
    wrap.className = 'ac-field';
    const canvas = document.createElement('canvas');
    canvas.className = 'ac-canvas';
    const note = document.createElement('p');
    note.className = 'ac-note';
    note.textContent = me === null ? '観戦中' : '自分の陣地（下の半分）を押すとそこへ歩き、相手の陣地を押すとそこへ雪玉を投げます。輪が緑になったら投げられます。';
    wrap.append(canvas);
    root.append(chips, wrap, note);
    if (s.phase !== 'end') window.scrollTo(0, 0);
    since(`yuki:${s.seed}:ready`);
    if (s.phase !== 'ready') since(goKey(s));
    const team = me === null ? 0 : teamOf(me);
    ui = {
      key, canvas, ctx: canvas.getContext('2d'), chips, wrap, me, cur: { s, o }, scale: 300, team, flip: team === 1,
      self: me === null ? null : { ...spawnOf(me, s.n) }, out: me !== null && s.dead[me],
      hits: me === null ? [] : Array(s.hits[me]).fill(null), safeUntil: 0, lastThrow: 0, thrown: 0, tag: Math.random().toString(36).slice(2, 6), // 雪玉の印の頭（読み込み直しても前の印と重ならないように）
      balls: [], ids: new Set(), puffs: [], ghosts: new Map(), blink: new Map(),
      last: performance.now(), lastSend: 0, lastHitSend: 0,
      calm: !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    };
    for (let p = 0; p < s.n; p++) if (p !== me) ui.ghosts.set(p, { ...spawnOf(p, s.n) });
    resize();
    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      const { s: cur, o: co } = ui.cur;
      if (ui.me === null || ui.out || !playing(cur) || !co.canMove) return;
      const b = toBoard(canvas, e);
      const [x, y] = ui.flip ? [1 - b.x, H - b.y] : [b.x, b.y];
      const mySide = ui.team === 0 ? y >= MID : y <= MID;
      if (mySide) { ui.self.tx = clamp(x, PR, 1 - PR); ui.self.ty = y; return; }
      const now = performance.now();
      if (now - ui.lastThrow < RELOAD_MS) return;
      ui.lastThrow = now;
      const ball = throwBall(ui.self.x, ui.self.y, x, y);
      addBall({ ...ball, id: `${ui.me}:${ui.tag}${ui.thrown++}`, from: ui.me }, true);
    });
    loop(ui);
  },
};
