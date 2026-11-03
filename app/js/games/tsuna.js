// 綱引き連打。赤と白の2チームに分かれ、ボタンをひたすら連打して綱を引き合う。2〜10人・足りない分は CPU。
// 2026-10-30 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 赤と白の2チーム。全員の数を偶数にそろえ、足りない分は CPU で埋める（玉入れと同じ。evenTeams）。
//   - ひたすら連打する（PC はスペースキーでも）。
//   - 綱の真ん中の印が自分の側の端まで来たら勝ち。30秒で決まらなければ、自分の側に寄っている方の勝ち。
// Claude の判断:
//   - チームは席の番号で決める（偶数の席が赤＝左、奇数の席が白＝右。玉入れと同じ）。
//   - 綱の位置 ＝（赤の連打の合計 − 白の連打の合計）÷（1チームの人数 × 20）。1 で赤の勝ち、−1 で白の勝ち。
//     1人が1秒に7回押す人と5回の人の1対1なら、10秒ほどで決まる見込み。
//   - 連打の数は各自の端末で数え、0.4秒ごとにその人のこれまでの合計を手として送る（1回ずつ送ると手の一覧が長くなりすぎるため。玉入れと同じ考え）。
//     1つの手で増やせるのは40回まで（作りかえた端末からの細工を少し防ぐ）。時間は各自の端末で「始まりの合図が届いてから」を測る。
//   - 30秒たったら押せなくなり、ホストは30秒の1.5秒あとに締め切る（遅れて届く手を待つ）。綱が真ん中ちょうどなら引き分け。
//   - CPU は1秒に4〜6回ほど押す（人が本気で押すより少し遅い）。
//   - 詳細設定「綱の重さ」（2026-10-30 の31回目の案。本人が選んだ。分かれ目は Claude の判断）: 軽い・ふつう（最初）・重い。上の「×20」を 12・20・32 に変える
//     （1秒に7回と5回の1対1で、およそ6秒・10秒・16秒で決まる見込み）。30秒の制限はどれも同じ。
// 2026-11-03 本人の依頼「3人で三つ巴の対決をできるように」（形は Claude の問いに本人が答えた。数と見た目は Claude の判断）:
//   - 詳細設定「チーム」（鍵は teams）: 2チーム（最初。赤・白。前と全く同じ）・3チーム（赤・白・青の三つ巴）。チームは席の番号を3で割った余り。
//     全員の数を3の倍数にそろえ、足りない分は CPU（main.js の lineup が game.teamCount を見る。10人までなので3チームは9人まで）。
//   - 3チームの綱は Y の字で、真ん中の結び目を3方向から引く。チーム t の向きを u_t（120°ずつ）として、結び目の位置 d ＝ Σ（チーム t の連打の合計 × u_t）÷（1チームの人数 × 重さ）。
//     d を u_t の向きに測った長さ（＝ t の連打 −（ほかの2チームの連打の和）÷ 2）が 1 になったら t の勝ち。2チームの「差が 1」と同じ重さになる。
//     30秒で決まらなければ、その長さがいちばん長いチームの勝ち（同じならだれも勝たない引き分け）。盤は三角形で、各辺がそのチームの勝ちの線。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready →(3秒)→ go → play →(30秒＋待ち)→ end（途中で端まで来たらそこで end）
// 手: { p: -1, t: 'go' | 'end' } / { p, t: 'tap', n: その人がこれまでに押した合計 }（n が前より大きいときだけ受け付ける）

import { since, scoreChips } from './party.js';

const READY_MS = 3000;
const PLAY_MS = 30000;
const GRACE_MS = 1500;
const SEND_MS = 400;
const WEIGHTS = { light: 12, normal: 20, heavy: 32 }; // 1チームの1人あたり、端まで引くのに要る連打の差
const perOf = (s) => WEIGHTS[s.rules?.weight] ?? WEIGHTS.normal;
const MAX_STEP = 40;
export const TEAM = ['赤', '白', '青'];
export const teamsOf = (s) => (Number(s.rules?.teams) === 3 ? 3 : 2);
const teamOf = (p, k = 2) => p % k;
const ANG = [210, 330, 90].map((a) => (a * Math.PI) / 180); // 3チームの引く向き（赤 左下・白 右下・青 上）
const UNIT = ANG.map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
const goKey = (s) => `tsuna:${s.seed}:go`;
const clone = (s) => ({ ...s, taps: s.taps.slice() });
const headOf = (n) => Math.max(1, Math.floor(n / 2));
// 綱の位置（−1〜1。正が赤の側）。taps を差し替えて画面の見込みにも使う
export function ropeOf(n, taps, per = WEIGHTS.normal) {
  let d = 0;
  taps.forEach((v, p) => { d += teamOf(p) === 0 ? v : -v; });
  return Math.max(-1, Math.min(1, d / (headOf(n) * per)));
}
export const teamTaps = (taps, k = 2) => Array.from({ length: k }, (_, t) => taps.reduce((a, v, p) => a + (teamOf(p, k) === t ? v : 0), 0));
// 3チームの結び目（x・y は上が正。pull = チームごとの向きに測った長さ。1 でそのチームの勝ち）
export function knotOf(n, taps, per = WEIGHTS.normal) {
  const T = teamTaps(taps, 3);
  const head = Math.max(1, Math.floor(n / 3));
  const x = T.reduce((a, v, t) => a + v * UNIT[t].x, 0) / (head * per);
  const y = T.reduce((a, v, t) => a + v * UNIT[t].y, 0) / (head * per);
  const pull = T.map((v, t) => (v - (T[(t + 1) % 3] + T[(t + 2) % 3]) / 2) / (head * per));
  return { x, y, pull };
}
// 3チームでいまいちばん引いているチーム（同じならいない＝ null）
const leadOf = (pull) => {
  const top = Math.max(...pull);
  return pull.filter((v) => v === top).length === 1 ? pull.indexOf(top) : null;
};

/* ---------- 画面 ---------- */

let ui = null; // { key, me, count, sent, lastSend, rope, flag, btn, info, cur: { s, o } }

function hit() {
  if (!ui || !ui.btn.isConnected) return;
  const { s, o } = ui.cur;
  if (ui.me === null || s.phase !== 'play' || !o.canMove || since(goKey(s)) >= PLAY_MS) return;
  ui.count += 1;
  ui.btn.classList.remove('kick');
  void ui.btn.offsetWidth; // 押した印の動きをやり直す
  ui.btn.classList.add('kick');
  draw();
}
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', (ev) => {
    if (ev.repeat || ev.key !== ' ') return;
    if (!ui?.btn.isConnected || ui.cur.s.phase !== 'play') return;
    if (ev.target instanceof HTMLElement && ev.target.closest('input, textarea, select')) return;
    ev.preventDefault();
    hit();
  });
}

// 綱と文字を、いまの手（と自分のまだ届いていない連打）で描く
function draw() {
  const { s } = ui.cur;
  const taps = s.taps.slice();
  if (ui.me !== null && s.phase === 'play') taps[ui.me] = Math.max(taps[ui.me], ui.count);
  if (ui.tri) drawKnot(s.phase === 'end' && s.knot ? s.knot : knotOf(s.n, taps, perOf(s)));
  else {
    const x = s.phase === 'end' ? s.pos : ropeOf(s.n, taps, perOf(s));
    // 綱の印は x = 1 で左の端（赤の側）へ
    ui.flag.style.left = `${50 - x * 45}%`;
    ui.rope.style.transform = `translateX(${-x * 45}%)`;
  }
  let text = '';
  if (s.phase === 'ready') {
    const left = Math.ceil((READY_MS - since(`tsuna:${s.seed}:ready`)) / 1000);
    text = left > 0 ? `${left}…` : 'よーい…';
  } else if (s.phase === 'play') {
    const t = since(goKey(s));
    text = t < PLAY_MS ? `残り ${Math.ceil((PLAY_MS - t) / 1000)}秒` : 'そこまで！';
  } else text = 'おしまい！';
  if (ui.info.textContent !== text) ui.info.textContent = text;
  const live = ui.me !== null && s.phase === 'play' && ui.cur.o.canMove && since(goKey(s)) < PLAY_MS;
  ui.btn.disabled = !live;
}

// 3チームの盤: 結び目を d に動かし、3本の綱を結び目から各チームへ引く。d は三角形（どの向きの長さも 1 まで）の中に収める
function drawKnot(k) {
  let { x, y } = k;
  const over = Math.max(...k.pull);
  if (over > 1) { x /= over; y /= over; } // 勝ちの線より外へは描かない（だいたい）
  const kx = x * 50, ky = -y * 50;
  ui.knot.setAttribute('transform', `translate(${kx.toFixed(1)} ${ky.toFixed(1)})`);
  ui.ropes.forEach((r, t) => { r.setAttribute('x1', kx.toFixed(1)); r.setAttribute('y1', ky.toFixed(1)); void t; });
}

function loop(token) {
  if (ui !== token || !ui.btn.isConnected) return;
  const { s, o } = ui.cur;
  const now = performance.now();
  // 押した合計をまとめて送る
  if (ui.me !== null && s.phase === 'play' && o.canMove && ui.count > Math.max(s.taps[ui.me], ui.sent) && now - ui.lastSend > SEND_MS) {
    ui.lastSend = now;
    ui.sent = Math.min(ui.count, Math.max(s.taps[ui.me], ui.sent) + MAX_STEP);
    o.onMove({ t: 'tap', n: ui.sent });
  }
  draw();
  if (s.phase !== 'end') requestAnimationFrame(() => loop(token));
}

const cpuNext = new Map();

export default {
  id: 'tsuna',
  name: '綱引き連打',
  icon: '🪢',
  desc: '赤と白に分かれて、ボタンをひたすら連打。綱を自分の側の端まで引いたら勝ち（3チームの三つ巴も）',
  ready: true,
  multi: true,
  realtime: true,
  evenTeams: true,
  minPlayers: 2,
  maxPlayers: 10,
  teamCount: (rules) => (Number(rules?.teams) === 3 ? 3 : 2), // main.js の lineup が人数をこの倍数にそろえる
  settings: [
    { key: 'teams', label: 'チーム', desc: '3チームは赤・白・青の三つ巴（人数は3の倍数にそろえ、足りない分は CPU）', def: 2, choices: [[2, '2チーム（赤・白）'], [3, '3チーム（三つ巴）']] },
    { key: 'weight', label: '綱の重さ', desc: '重いほど、端まで引くのにたくさん連打が要る（長い勝負になる）', def: 'normal',
      choices: [['light', '軽い'], ['normal', 'ふつう'], ['heavy', '重い']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    return { n, seed, rules: { weight: 'normal', ...rules }, phase: 'ready', taps: Array(n).fill(0), pos: 0, step: 0 };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'play'; },
  sound(a, b, m) {
    if (m.p === -1) return m.t === 'go' ? 'question' : null;
    return null; // 連打の手は鳴らさない（にぎやかすぎるため）
  },
  result(s) {
    if (s.phase !== 'end') return null;
    if (teamsOf(s) === 3) {
      const teams = teamTaps(s.taps, 3);
      if (s.win === null || s.win === undefined) return { draw: true, winner: null, team: null, teams, scores: s.taps.slice() };
      const winners = s.taps.map((_, p) => (teamOf(p, 3) === s.win ? p : -1)).filter((p) => p >= 0);
      return { winners, team: s.win, teams, scores: s.taps.slice() };
    }
    const teams = teamTaps(s.taps);
    if (s.pos === 0) return { draw: true, winner: null, team: null, teams, scores: s.taps.slice() };
    const t = s.pos > 0 ? 0 : 1;
    const winners = s.taps.map((_, p) => (teamOf(p) === t ? p : -1)).filter((p) => p >= 0);
    return { winners, team: t, teams, scores: s.taps.slice() };
  },
  resultText(res, me) {
    const k = res.teams.length;
    const sc = k === 3 ? `（連打 赤 ${res.teams[0]}・白 ${res.teams[1]}・青 ${res.teams[2]}）` : `（連打 赤 ${res.teams[0]} − ${res.teams[1]} 白）`;
    if (res.team === null) return `引き分け！${sc}`;
    const mine = me >= 0 && teamOf(me, k) === res.team;
    return `${TEAM[res.team]}チームの勝ち！${mine ? '🎉' : ''}${sc}`;
  },
  phaseText(s) { return s.phase === 'ready' ? 'まもなく始まります…' : 'ボタンを連打して綱を引こう！'; },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'go' } };
    if (s.phase === 'play') return { key: 'play', ms: PLAY_MS + GRACE_MS, move: { t: 'end' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if ((m.t === 'go' && s0.phase === 'ready') || (m.t === 'end' && s0.phase === 'play')) {
        const s = clone(s0);
        s.step += 1;
        s.phase = m.t === 'go' ? 'play' : 'end';
        if (s.phase === 'end' && teamsOf(s) === 3) { s.knot = knotOf(s.n, s.taps, perOf(s)); s.win = leadOf(s.knot.pull); }
        else if (s.phase === 'end') s.pos = ropeOf(s.n, s.taps, perOf(s));
        return s;
      }
      return null;
    }
    if (s0.phase !== 'play' || m.t !== 'tap' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!Number.isInteger(m.n) || m.n <= s0.taps[m.p] || m.n > s0.taps[m.p] + MAX_STEP) return null;
    const s = clone(s0);
    s.step += 1;
    s.taps[m.p] = m.n;
    if (teamsOf(s) === 3) {
      const kn = knotOf(s.n, s.taps, perOf(s));
      if (Math.max(...kn.pull) >= 1) { s.phase = 'end'; s.knot = kn; s.win = leadOf(kn.pull); }
      return s;
    }
    const x = ropeOf(s.n, s.taps, perOf(s));
    if (Math.abs(x) >= 1) { s.phase = 'end'; s.pos = x; }
    return s;
  },

  // CPU: 0.4秒ごとに1〜3回ぶん（1秒に4〜6回ほど）足す
  cpuDelay(s) { return s.phase === 'play' ? 120 : 500; },
  cpu(s, p) {
    if (s.phase !== 'play' || since(goKey(s)) >= PLAY_MS) return null;
    const key = `${s.seed}:${p}`;
    const now = performance.now();
    if (!cpuNext.has(key)) cpuNext.set(key, { at: now + 400, rate: 4 + Math.random() * 2, carry: 0 });
    const c = cpuNext.get(key);
    if (now < c.at) return null;
    c.carry += c.rate * 0.4;
    c.at = now + 400;
    if (cpuNext.size > 40) cpuNext.delete(cpuNext.keys().next().value);
    const k = Math.floor(c.carry);
    if (k < 1) return null;
    c.carry -= k;
    return { t: 'tap', n: s.taps[p] + k };
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const K = teamsOf(s);
    const tm = (p) => teamOf(p, K);
    const chips = scoreChips(o, s.taps, {
      extra: (p) => `<span style="color:${['var(--red-ink, #c0392b)', '#777', '#2f6fb3'][tm(p)]}">${TEAM[tm(p)]}</span>`,
    });
    for (const v of chips.querySelectorAll('.pt-score small')) v.textContent = '回';
    const key = `${s.seed}:${me}`;
    if (ui?.key === key && root.contains(ui.btn)) {
      chips.scrollLeft = ui.chips.scrollLeft;
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      ui.cur = { s, o };
      if (s.phase !== 'ready') since(goKey(s));
      if (s.phase === 'end') draw();
      return;
    }
    root.innerHTML = '';
    root.className = 'board ts';
    const field = document.createElement('div');
    field.className = 'ts-field';
    const info = document.createElement('div');
    info.className = 'ts-info';
    let rope = null, flag = null, tri = null, knot = null, ropes = [];
    if (K === 3) { // 三つ巴: 三角形の盤（各辺がそのチームの勝ちの線）と Y の字の綱
      const pt = (t, r) => `${(UNIT[t].x * r * 50).toFixed(1)} ${(-UNIT[t].y * r * 50).toFixed(1)}`;
      const corner = (t) => pt(t, -2); // 三角形の角は、各チームの向きの反対で長さ 2
      const COL = ['#e04b3c', '#9a9a9a', '#3b7ddd'];
      const edges = [0, 1, 2].map((t) => `<line x1="${corner((t + 1) % 3).split(' ')[0]}" y1="${corner((t + 1) % 3).split(' ')[1]}" x2="${corner((t + 2) % 3).split(' ')[0]}" y2="${corner((t + 2) % 3).split(' ')[1]}" stroke="${COL[t]}" stroke-width="6" stroke-linecap="round"/>`).join('');
      const people = [0, 1, 2].map((t) => `<text x="${pt(t, 1.55).split(' ')[0]}" y="${pt(t, 1.55).split(' ')[1]}" font-size="18" text-anchor="middle" dominant-baseline="middle">🙋</text><text x="${pt(t, 1.55).split(' ')[0]}" y="${(Number(pt(t, 1.55).split(' ')[1]) + 17).toFixed(1)}" font-size="11" font-weight="800" fill="${COL[t]}" text-anchor="middle">${TEAM[t]}</text>`).join('');
      const lines = [0, 1, 2].map((t) => `<line class="ts-y" x1="0" y1="0" x2="${pt(t, 1.4).split(' ')[0]}" y2="${pt(t, 1.4).split(' ')[1]}" stroke="#a87b3c" stroke-width="5" stroke-linecap="round"/>`).join('');
      const box = document.createElement('div');
      box.className = 'ts-tri';
      box.innerHTML = `<svg viewBox="-110 -110 220 220" role="img" aria-label="三つ巴の綱">${edges}${lines}${people}<g class="ts-knot"><circle r="7" fill="#fff" stroke="#5a3d1a" stroke-width="2"/><text y="-8" font-size="18" text-anchor="middle">🚩</text></g></svg>`;
      tri = box;
      knot = box.querySelector('.ts-knot');
      ropes = [...box.querySelectorAll('.ts-y')];
      field.append(info, box);
    } else {
      const lane = document.createElement('div');
      lane.className = 'ts-lane';
      lane.innerHTML = '<span class="ts-end red">赤</span><span class="ts-end white">白</span><span class="ts-mid"></span>';
      rope = document.createElement('div');
      rope.className = 'ts-rope';
      rope.innerHTML = '<span class="ts-team red">🙋🙋</span><span class="ts-team white">🙋🙋</span>';
      flag = document.createElement('span');
      flag.className = 'ts-flag';
      flag.textContent = '🚩';
      lane.append(rope, flag);
      field.append(info, lane);
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ts-btn' + (me !== null ? ' t' + tm(me) : '');
    btn.textContent = me === null ? '観戦中' : `${TEAM[tm(me)]}チーム　連打！`;
    btn.onpointerdown = (e) => { e.preventDefault(); hit(); };
    btn.onclick = (e) => { if (e.detail === 0) hit(); }; // キーボードで押したとき（指・マウスは pointerdown で数えた）
    const note = document.createElement('p');
    note.className = 'ac-note';
    note.textContent = K === 3
      ? (me === null
        ? '真ん中の🚩が三角形のどれかの辺まで来たら、その色のチームの勝ち'
        : `あなたは${TEAM[tm(me)]}チーム（${['左下', '右下', '上'][tm(me)]}）。ボタンを連打（PC はスペースキーでも）。🚩を自分の色の辺まで引いたら勝ち。30秒で決まらなければ、いちばん引いているチームの勝ち`)
      : me === null
        ? '綱の🚩が赤か白の端まで来たら、そのチームの勝ち'
        : `あなたは${TEAM[tm(me)]}チーム（${tm(me) ? '右' : '左'}側）。ボタンを連打（PC はスペースキーでも）。🚩を自分の側の端まで引いたら勝ち。30秒で決まらなければ寄っている方の勝ち`;
    root.append(chips, field, btn, note);
    since(`tsuna:${s.seed}:ready`);
    if (s.phase !== 'ready') since(goKey(s));
    ui = { key, me, count: me === null ? 0 : s.taps[me], sent: 0, lastSend: 0, rope, flag, tri, knot, ropes, btn, info, chips, cur: { s, o } };
    loop(ui);
  },
};
