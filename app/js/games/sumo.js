// 紙相撲（トントン相撲）。2〜4人が1つの土俵で同時に戦う。「トン」を連打すると力士が揺れながら前へ出る。
// 手の一覧で進むほかのゲームと違い、毎フレーム動くので main.js の「live」の形で動かす（エアホッケーと同じ。index.js の先頭のコメント）。
// 2026-11-05 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 2〜4人が1つの土俵で同時に戦い、最後まで残った人が勝ち。足りない分は CPU（弱め）。オンラインのみ（main.js の onlineOnly）。
//   - 速く叩きすぎるとぐらつきがたまって自分も倒れやすくなる（ただの連打勝負にしないため）。土俵の外へ出るか倒れたら負け。
//   - 3回戦って、勝った回数で決める。
//   - オンラインはエアホッケーと同じく、ホストの端末が力士の動きを計算してみんなに配る（ゲストの画面は少し遅れて動く。遊んで確かめてもらう）。
// Claude の判断:
//   - 土俵は半径1の円。力士は半径0.14の円で、はじめは土俵の中心から0.5の所に等しい間をあけて並び、中心を向く。
//   - 「トン」1回で、力士は向いている方へ 0.35（土俵の半径 / 秒）押し出される（速さの上限 0.9）。動きは床とのこすれで毎秒およそ 1/20 に落ちる。
//     向きは、いちばん近い相手の方へ毎秒 2.2ラジアンずつ回り、トンのたびに ±0.35ラジアンまでふらつく（揺れながら前へ出る）。
//   - ぐらつき（0〜1。1 で倒れる）: トン1回で 0.08、前のトンから0.2秒より短ければ (0.2 − 間) × 1.6 を足す。毎秒 0.35 ずつ戻る。
//     ぶつかったときは、押された方にぶつかった速さ × 0.08、押した方（相手へ向かって速く動いていた方）にその6割を足す（向かう速さが同じならどちらも8割）。
//     試算（2026-11-05。間を ±25% ばらつかせて、相手の居ない所へ押し出す・1対1・4人）: 0.25秒に1回なら自分では倒れず、動かない相手を4秒ほどで押し出す。
//     0.15秒に1回だと1.5秒ほど・0.12秒に1回だと0.9秒ほどで自分が倒れる。0.25秒どうしは7〜8秒、4人は6〜18秒で決まり、押し出しと倒れるの両方で決まる。
//   - ぶつかると、向かい合う向きの速さを分け合う（はね返り 0.2）。押している方が押し勝つ。
//   - 1回戦は最大30秒。時間が来たら残っている人のうちぐらつきのいちばん少ない人の勝ち（並んだら引き分け）。最後の2人が同時に落ちたら引き分け。
//   - 回の始めに2秒数え、回の終わりは2.5秒見せる。3回戦のあと、勝った回数の多い人が勝ち（並んだら同じ順位）。終わったらホストが「もう一回」を押せる。
//   - 詳細設定「何回戦」（2026-11-06 の36回目の案。鍵は rounds）: 1回・3回（最初）・5回。数えるのは勝った回数のまま（5回戦で3勝しても5回まで戦う）。
//     おまかせでは抽選しない（main.js の KEEP_KEYS の rounds）。
//   - CPU は 0.2〜0.34秒に1回トンをし、ぐらつきが 0.55 を超えたら7割の見込みで0.6秒休む（休まないこともあるので、ときどき自分で倒れる）。
//   - 音: 自分のトンは place（小さめ）、だれかが倒れた・落ちたら punch、回の勝ちが自分なら goal・ほかの人なら pop、3回戦の終わりに win / lose。
//   - 通信: ゲストはトンを押すたびにホストへ送る（届いたか確かめない。抜けたトンは押さなかったことになる）。前のトンからの間はゲストの端末で測って一緒に送り、
//     ホストはそれでぐらつきを決める（ほかの早押しと同じく、通信の揺れで不利にならないように）。ホストは0.05秒ごとに全員の位置・向き・ぐらつきを送り、
//     回の終わり・勝ち負けは必ず届く送り方でも送る。ゲストは届いた位置へなめらかに寄せて描く。だれがトンを押したかは、送ってきた人の席で決める（名乗った席は見ない）。

import { play } from '../sound.js';

const PLAYERS = ['赤', '青', '緑', '黄'];
const COLORS = ['#d9643a', '#2f6fb3', '#2e9a52', '#d4a20c'];
export const RING = 1;
export const BODY = 0.14;
export const ROUNDS = 3;
const ROUND_CHOICES = [[3, '3回戦'], [1, '1回勝負'], [5, '5回戦']];
export const roundsOf = (rules) => (ROUND_CHOICES.some(([v]) => v === Number(rules?.rounds)) ? Number(rules.rounds) : ROUNDS);
export const PUSH = 0.35;
const MAX_V = 0.9;
const FRICTION = 3;
const TURN = 2.2;
const SWAY = 0.35;
export const WOB_TAP = 0.08;
export const WOB_FAST = 0.2;
export const WOB_FAST_MUL = 1.6;
export const WOB_BACK = 0.35;
const WOB_HIT = 0.08;
const BOUNCE = 0.2;
export const ROUND_SEC = 30;
const COUNT_SEC = 2;
const SHOW_SEC = 2.5;
const SEND_MS = 50;
const STEP = 1 / 120;

/* ---------- 動き（ホストの端末と自動確認が使う。画面に依存しない） ---------- */

// 始めの局面。n 人を中心から0.5の所に等しい間をあけて並べ、中心を向ける
export function startRound(n) {
  return {
    t: 0,
    w: Array.from({ length: n }, (_, p) => {
      const a = Math.PI / 2 + (2 * Math.PI * p) / n; // 席0 は下
      return { x: Math.cos(a) * 0.5, y: Math.sin(a) * 0.5, vx: 0, vy: 0, dir: a + Math.PI, wob: 0, last: -9, alive: true, why: '' };
    }),
  };
}
// トン。rnd はふらつきに使う（ホストだけが動かすので Math.random でよい）。
// gap = 前のトンからの秒数。人のトンは押した人の端末で測った値を渡す（届く間隔は通信の揺れで詰まり、ゲストだけ倒れやすくなるため）。省くと局面の時計で数える（CPU）
export function tap(r, p, rnd = Math.random, gap) {
  const w = r.w[p];
  if (!w || !w.alive) return;
  if (!(gap >= 0)) gap = r.t - w.last;
  w.last = r.t;
  w.wob += WOB_TAP + (gap < WOB_FAST ? (WOB_FAST - gap) * WOB_FAST_MUL : 0);
  w.dir += (rnd() * 2 - 1) * SWAY;
  w.vx += Math.cos(w.dir) * PUSH;
  w.vy += Math.sin(w.dir) * PUSH;
  const sp = Math.hypot(w.vx, w.vy);
  if (sp > MAX_V) { w.vx *= MAX_V / sp; w.vy *= MAX_V / sp; }
  if (w.wob >= 1) { w.alive = false; w.why = 'fall'; }
}
// dt 秒進める。この間に負けた席の一覧を返す
export function stepRound(r, dt) {
  const out = [];
  let left = dt;
  while (left > 1e-9) {
    const h = Math.min(STEP, left);
    left -= h;
    r.t += h;
    const ws = r.w;
    for (const w of ws) {
      if (!w.alive) continue;
      // いちばん近い相手の方へ向きを回す
      let best = null;
      for (const o of ws) if (o !== w && o.alive && (!best || (o.x - w.x) ** 2 + (o.y - w.y) ** 2 < (best.x - w.x) ** 2 + (best.y - w.y) ** 2)) best = o;
      if (best) {
        const want = Math.atan2(best.y - w.y, best.x - w.x);
        let d = want - w.dir;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        w.dir += Math.max(-TURN * h, Math.min(TURN * h, d));
      }
      const f = Math.exp(-FRICTION * h);
      w.vx *= f;
      w.vy *= f;
      w.x += w.vx * h;
      w.y += w.vy * h;
      w.wob = Math.max(0, w.wob - WOB_BACK * h);
    }
    // ぶつかり
    for (let i = 0; i < ws.length; i++) {
      for (let j = i + 1; j < ws.length; j++) {
        const a = ws[i], b = ws[j];
        if (!a.alive || !b.alive) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        if (d >= 2 * BODY || d === 0) continue;
        const nx = dx / d, ny = dy / d;
        const over = 2 * BODY - d;
        a.x -= nx * over / 2; a.y -= ny * over / 2;
        b.x += nx * over / 2; b.y += ny * over / 2;
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny; // a が b へ近づく速さ
        if (rel <= 0) continue;
        const jv = ((1 + BOUNCE) * rel) / 2;
        a.vx -= jv * nx; a.vy -= jv * ny;
        b.vx += jv * nx; b.vy += jv * ny;
        // 押した方（相手へ向かって速く動いていた方）は6割、押された方は全部ぐらつく。席の番号で決めない（2026-11-05 の Codex の点検。
        // 前は番号の小さい方がいつも6割だった）。向かう速さがちょうど同じなら、どちらも押した方でも押された方でもあるので、間を取って8割
        const va = a.vx * nx + a.vy * ny, vb = -(b.vx * nx + b.vy * ny);
        const [ka, kb] = va > vb ? [0.6, 1] : vb > va ? [1, 0.6] : [0.8, 0.8];
        a.wob += rel * WOB_HIT * ka;
        b.wob += rel * WOB_HIT * kb;
        for (const [w, k] of [[a, i], [b, j]]) if (w.alive && w.wob >= 1) { w.alive = false; w.why = 'fall'; out.push(k); }
      }
    }
    for (let p = 0; p < ws.length; p++) {
      const w = ws[p];
      if (w.alive && Math.hypot(w.x, w.y) > RING) { w.alive = false; w.why = 'out'; out.push(p); }
    }
  }
  return out;
}
// 回の勝ち負け。null = まだ続く、-1 = 引き分け、ほか = 勝った席
export function roundWinner(r, timeUp = false) {
  const alive = r.w.map((w, p) => (w.alive ? p : -1)).filter((p) => p >= 0);
  if (alive.length === 1) return alive[0];
  if (!alive.length) return -1;
  if (!timeUp) return null;
  const least = Math.min(...alive.map((p) => r.w[p].wob));
  const best = alive.filter((p) => r.w[p].wob === least);
  return best.length === 1 ? best[0] : -1;
}
// 勝った回数から順位（同じ数は同じ順位）
export const ranksOf = (wins) => wins.map((v) => 1 + wins.filter((x) => x > v).length);

/* ---------- 画面とオンライン ---------- */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// opts = { mode: 'online', status, me（席の番号、観戦は -1）, names, rules, send, isHost, cpuSeats() }（エアホッケーと同じ形）
function mount(root, opts) {
  root.className = 'board sm';
  root.innerHTML = '';
  const n = Math.max(2, Math.min(4, Number(opts.rules?.players) || 2));
  const rounds = roundsOf(opts.rules);
  const me = opts.me >= 0 && opts.me < n ? opts.me : -1;
  const host = !!opts.isHost;
  const names = (opts.names ?? []).slice(0, n);
  const seatName = (p) => (p === me ? 'あなた' : names[p] ?? PLAYERS[p]);
  const canvas = el('canvas', 'sm-canvas');
  const ctx = canvas.getContext('2d');
  const btn = el('button', 'btn primary sm-tap', '👊 トン！');
  btn.type = 'button';
  const meter = el('div', 'sm-meter');
  const panel = el('div', 'sm-panel');
  root.append(canvas, meter, btn, panel);
  if (me < 0) { btn.hidden = true; meter.hidden = true; }
  let alive = true;
  let raf = 0;
  const SIZE = 340;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = SIZE * dpr;
  canvas.height = SIZE * dpr;
  ctx.scale(dpr, dpr);
  // 自分の力士が下に来るように回す
  const rot = me >= 0 ? -(2 * Math.PI * me) / n : 0;
  const toScreen = (x, y) => {
    const rx = x * Math.cos(rot) - y * Math.sin(rot);
    const ry = x * Math.sin(rot) + y * Math.cos(rot);
    return [SIZE / 2 + rx * SIZE * 0.42, SIZE / 2 + ry * SIZE * 0.42];
  };

  // 試合の状態（ホストが持ち、ゲストは届いたものを写す）
  let ep = 0; // 「もう一回」の回数
  let game = { ep, round: 0, wins: Array(n).fill(0), phase: 'count', phaseT: 0, last: null, over: false };
  let ring = startRound(n);
  let shown = startRound(n); // ゲストが描く位置（届いた位置へなめらかに寄せる）
  let lastSend = 0;
  let lastFrame = performance.now();
  // ホストが読み込み直したら、ゲストが覚えている試合の続きを引き継ぐ（2026-11-05 の Codex の点検）。
  // 前は読み込み直したホストが1回戦から始め直し、「もう一回」のあとだとゲストが回数の小さい知らせを捨てて画面が止まったままになった。
  // ゲストは、ホストから届いた状態が自分の覚えているものより前へ戻っていたら受け入れず、覚えている続き（have）を送る。ホストは自分より先の続きだけ引き継ぐ。
  // 状態はホストからしか出ないので、ゲストがホストより先にいるのはホストが始め直したときだけ。開いた直後の need は早く引き継ぐための近道
  // （読み込み直した直後はまだ中継サーバーにつながっておらず届かないことがあるので、これだけに頼らない）
  let heard = false; // ゲスト: ホストから状態が届いたことがあるか（無ければ続きを答えない）
  let lastHave = -1e9; // ゲスト: 最後に続きを送った時刻（状態は0.05秒ごとに届くので、0.5秒に1回まで）
  const cpuState = new Map();
  let seenAlive = ring.w.map(() => true);

  function showStatus() {
    const tally = Array.from({ length: n }, (_, p) => `<span style="color:${COLORS[p]}">${PLAYERS[p]}</span> ${esc(seatName(p))} ${'★'.repeat(game.wins[p])}`).join(' ／ ');
    let main;
    if (game.over) {
      const rk = ranksOf(game.wins);
      if (me < 0) main = `${rk.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0).map((p) => esc(seatName(p))).join('と')}の勝ち！`;
      else main = rk[me] === 1 ? (rk.filter((v) => v === 1).length > 1 ? '同じ数で1位！🎉' : 'あなたの勝ち！🎉') : `あなたは${rk[me]}位`;
    } else if (game.phase === 'count') main = rounds === 1 ? `1回勝負　はっけよい…` : `${game.round + 1}回戦（全${rounds}回）　はっけよい…`;
    else if (game.phase === 'show') main = game.last === -1 ? '引き分け！' : `${esc(seatName(game.last))}の勝ち！`;
    else main = rounds === 1 ? `1回勝負` : `${game.round + 1}回戦（全${rounds}回）`;
    opts.status.innerHTML = `<div class="status-main">${main}</div><div class="status-sub">${tally}<br>オンラインは試作です（ホストの端末が動きを計算しています）。</div>`;
  }

  function hostAdvance(dt) {
    game.phaseT += dt;
    if (game.over) return;
    if (game.phase === 'count') {
      if (game.phaseT >= COUNT_SEC) { game.phase = 'fight'; game.phaseT = 0; sendState(true); showStatus(); }
      return;
    }
    if (game.phase === 'show') {
      if (game.phaseT >= SHOW_SEC) {
        if (game.round + 1 >= rounds) { game.over = true; finish(); }
        else { game.round += 1; game.phase = 'count'; game.phaseT = 0; ring = startRound(n); cpuState.clear(); }
        sendState(true);
        showStatus();
      }
      return;
    }
    // 取り組み中: CPU のトン → 動かす → 勝ち負け
    for (const p of cpuSeatsNow()) {
      const w = ring.w[p];
      if (!w?.alive) continue;
      let c = cpuState.get(p);
      if (!c) { c = { next: ring.t + 0.3 + Math.random() * 0.4 }; cpuState.set(p, c); }
      if (ring.t < c.next) continue;
      if (w.wob > 0.55 && Math.random() < 0.7) { c.next = ring.t + 0.6; continue; }
      tap(ring, p);
      c.next = ring.t + 0.2 + Math.random() * 0.14;
    }
    stepRound(ring, dt);
    const win = roundWinner(ring, ring.t >= ROUND_SEC);
    if (win !== null) {
      game.last = win;
      if (win >= 0) game.wins[win] += 1;
      game.phase = 'show';
      game.phaseT = 0;
      play(win === me ? 'goal' : 'pop');
      sendState(true);
      showStatus();
    }
  }
  // CPU が動かす席（部屋を出た人の席も。自分の席は除く）
  const cpuSeatsNow = () => (opts.cpuSeats?.() ?? []).filter((p) => p >= 0 && p < n && p !== me);

  const pack = () => ring.w.map((w) => [r3(w.x), r3(w.y), r3(w.dir), r3(w.wob), w.alive ? 1 : 0, w.why]);
  function sendState(important = false) {
    if (!host) return;
    opts.send({ k: 'st', ep, g: { round: game.round, wins: game.wins, phase: game.phase, phaseT: r3(game.phaseT), last: game.last, over: game.over }, t: r3(ring.t), w: pack() }, important);
  }
  function finish() {
    const rk = ranksOf(game.wins);
    if (me >= 0) play(rk[me] === 1 ? 'win' : 'lose');
    showOver();
  }
  function showOver() {
    panel.innerHTML = '';
    if (!game.over) return;
    if (host) {
      const again = el('button', 'btn primary', 'もう一回');
      again.type = 'button';
      again.onclick = () => {
        ep += 1;
        game = { ep, round: 0, wins: Array(n).fill(0), phase: 'count', phaseT: 0, last: null, over: false };
        ring = startRound(n);
        cpuState.clear();
        panel.innerHTML = '';
        sendState(true);
        showStatus();
      };
      panel.append(again);
    } else panel.append(el('p', 'sm-note', 'もう一回はホストが始めます'));
  }

  function receive(d, from) {
    if (!d || typeof d !== 'object') return;
    if (host) {
      // トン（だれが押したかは送ってきた人の席で決める）
      if (d.k === 'tap' && d.ep === ep && Number.isInteger(from) && from >= 0 && from < n && game.phase === 'fight' && !game.over) tap(ring, from, Math.random, Number.isFinite(d.g) ? Math.max(0, Math.min(9, d.g)) : undefined);
      if (d.k === 'hi') sendState(true); // あとから開いた人に今の状態を送る
      if (d.k === 'have' && d.g && (d.ep > ep || (d.ep === ep && progOf(d.g) > progOf(game)))) adopt(d);
      return;
    }
    // 読み込み直したホストに、覚えている試合の続きを答える
    const sendHave = () => {
      const now = performance.now();
      if (!heard || now - lastHave < 500) return;
      lastHave = now;
      opts.send({ k: 'have', ep, g: { round: game.round, wins: game.wins, phase: game.phase, phaseT: r3(game.phaseT), last: game.last, over: game.over }, t: r3(ring.t), w: pack() }, true);
    };
    if (d.k === 'need') { sendHave(); return; }
    if (d.k !== 'st' || !d.g || !Array.isArray(d.w) || d.w.length !== n) return;
    if (d.ep < ep || (d.ep === ep && heard && progOf(d.g) < progOf(game))) { sendHave(); return; } // ホストが始め直した
    heard = true;
    const wasOver = game.over;
    const wasPhase = game.phase;
    const wasLast = game.last;
    const wasRound = game.round;
    ep = d.ep;
    game = { ep, round: d.g.round, wins: d.g.wins, phase: d.g.phase, phaseT: d.g.phaseT, last: d.g.last, over: !!d.g.over };
    ring.t = d.t;
    d.w.forEach(([x, y, dir, wob, al, why], p) => {
      const w = ring.w[p];
      Object.assign(w, { x, y, dir, wob, alive: !!al, why });
    });
    if (game.round !== wasRound || (wasPhase === 'show' && game.phase === 'count')) shown = startRound(n);
    if (game.phase === 'show' && (wasPhase !== 'show' || wasLast !== game.last)) play(game.last === me ? 'goal' : 'pop');
    if (game.over && !wasOver) finish();
    if (!game.over && wasOver) panel.innerHTML = '';
    showStatus();
  }

  // トンを押す
  let lastTapAt = -1e9; // 前に自分がトンを押した時刻（この端末の時計）
  const doTap = (e) => {
    if (me < 0 || game.phase !== 'fight' || game.over || !ring.w[me]?.alive) return;
    e?.preventDefault?.();
    play('place', 0.35);
    const now = performance.now();
    const gap = Math.min(9, (now - lastTapAt) / 1000);
    lastTapAt = now;
    if (host) tap(ring, me, Math.random, gap);
    else opts.send({ k: 'tap', ep, g: Math.round(gap * 1000) / 1000 }, false);
    btn.classList.remove('hit');
    void btn.offsetWidth; // 押した動きをやり直す（描き直しの途中ではない）
    btn.classList.add('hit');
  };
  btn.onpointerdown = doTap;
  btn.onclick = (e) => { if (e.detail === 0) doTap(e); };
  canvas.onpointerdown = doTap;
  const onKey = (e) => {
    if (e.code !== 'Space' || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) return;
    e.preventDefault();
    doTap(e);
  };
  document.addEventListener('keydown', onKey);

  function draw() {
    const g = ctx;
    g.clearRect(0, 0, SIZE, SIZE);
    // 土俵
    g.fillStyle = '#e8d3a8';
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.48, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f3e4c2';
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#8a6a3a'; g.lineWidth = 5;
    g.beginPath(); g.arc(SIZE / 2, SIZE / 2, SIZE * 0.42, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 3;
    for (const sd of [-1, 1]) { g.beginPath(); g.moveTo(SIZE / 2 + sd * 14, SIZE / 2 - 10); g.lineTo(SIZE / 2 + sd * 14, SIZE / 2 + 10); g.stroke(); }
    const ws = host ? ring.w : shown.w;
    ws.forEach((w, p) => {
      const [x, y] = toScreen(w.x, w.y);
      const r = BODY * SIZE * 0.42;
      const sway = w.alive ? Math.sin(performance.now() / 70 + p) * w.wob * 0.35 : 0;
      g.save();
      g.translate(x, y);
      g.rotate(sway);
      g.globalAlpha = w.alive ? 1 : 0.4;
      // 体（紙の力士を上から見た形）
      g.fillStyle = COLORS[p];
      g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#3a2a1a'; g.lineWidth = 2; g.stroke();
      // 向き（顔の向き）
      const dv = w.dir + rot;
      g.fillStyle = '#ffe9d6';
      g.beginPath(); g.arc(Math.cos(dv) * r * 0.55, Math.sin(dv) * r * 0.55, r * 0.42, 0, Math.PI * 2); g.fill(); g.stroke();
      if (!w.alive) {
        g.strokeStyle = '#c0392b'; g.lineWidth = 4;
        g.beginPath(); g.moveTo(-r * 0.7, -r * 0.7); g.lineTo(r * 0.7, r * 0.7); g.moveTo(r * 0.7, -r * 0.7); g.lineTo(-r * 0.7, r * 0.7); g.stroke();
      }
      g.restore();
      g.fillStyle = '#333';
      g.font = 'bold 12px sans-serif';
      g.textAlign = 'center';
      const nm = seatName(p);
      g.fillText(nm.length > 6 ? nm.slice(0, 6) + '…' : nm, x, y + r + 14);
    });
    // 回の始めの数え・結果
    g.textAlign = 'center';
    if (game.phase === 'count' && !game.over) {
      g.fillStyle = 'rgba(0,0,0,.55)';
      g.font = 'bold 34px sans-serif';
      g.fillText(game.phaseT < COUNT_SEC / 2 ? 'はっけよい…' : 'のこった！', SIZE / 2, SIZE / 2 - 30);
    } else if (game.phase === 'show' || game.over) {
      g.fillStyle = 'rgba(0,0,0,.6)';
      g.font = 'bold 28px sans-serif';
      const txt = game.over ? 'おしまい' : game.last === -1 ? '引き分け' : `${seatName(game.last)} の勝ち！`;
      g.fillText(txt, SIZE / 2, SIZE / 2 - 30);
    }
    // 自分のぐらつき
    if (me >= 0) {
      const w = ring.w[me];
      const v = Math.min(1, w?.wob ?? 0);
      meter.innerHTML = `<span>ぐらつき</span><i style="--v:${(v * 100).toFixed(0)}%" class="${v > 0.7 ? 'hi' : ''}"></i>`;
      btn.disabled = game.phase !== 'fight' || game.over || !w?.alive;
    }
  }

  // ゲストが答えた続きを、読み込み直したホストが引き継ぐ（いちばん先に届いた1つだけ）
  function adopt(d) {
    const g = d.g;
    if (!g || !Number.isInteger(d.ep) || d.ep < 0 || !Array.isArray(d.w) || d.w.length !== n || !Array.isArray(g.wins) || g.wins.length !== n) return;
    if (!['count', 'fight', 'show'].includes(g.phase) || !Number.isInteger(g.round) || g.round < 0 || g.round >= rounds) return;
    ep = d.ep;
    game = { ep, round: g.round, wins: g.wins.map((v) => Math.max(0, Math.trunc(Number(v) || 0))), phase: g.phase, phaseT: Number(g.phaseT) || 0, last: Number.isInteger(g.last) ? g.last : null, over: !!g.over };
    ring = startRound(n);
    ring.t = Number(d.t) || 0;
    d.w.forEach((e, p) => {
      if (!Array.isArray(e)) return;
      const [x, y, dir, wob, al, why] = e;
      Object.assign(ring.w[p], { x: Number(x) || 0, y: Number(y) || 0, dir: Number(dir) || 0, wob: Number(wob) || 0, alive: !!al, why: String(why ?? '') });
    });
    seenAlive = ring.w.map((w) => w.alive);
    cpuState.clear();
    sendState(true);
    showStatus();
    if (game.over) showOver();
  }

  // ホストの1歩。描き替え（requestAnimationFrame）と、画面が隠れて描き替えが止まったときの予備の時計の両方から呼ぶ。
  // 予備の時計は隠れたタブでは1秒に1回ほどに間引かれるので、1秒までの間を 0.05秒ずつに分けて進める（前は描き替えでしか進まず、
  // ホストが別のタブやアプリへ切り替えると全員の試合が止まった。2026-11-05 の Codex の点検。エアホッケーの backup と同じわけ）
  function hostTick(now) {
    let rem = Math.min(1, Math.max(0, now - lastFrame) / 1000);
    lastFrame = now;
    while (rem > 1e-6) {
      const dt = Math.min(0.05, rem);
      hostAdvance(dt);
      rem -= dt;
    }
    if (now - lastSend >= SEND_MS) { lastSend = now; sendState(false); }
  }
  const backup = host ? setInterval(() => {
    const now = performance.now();
    if (alive && now - lastFrame > 120) hostTick(now);
  }, 50) : 0;

  function frame(now) {
    if (!alive) return;
    if (host) hostTick(now);
    else {
      const dt = Math.min(0.05, Math.max(0, now - lastFrame) / 1000);
      lastFrame = now;
      // 届いた位置へなめらかに寄せる
      const k = 1 - Math.exp(-dt * 18);
      shown.w.forEach((w, p) => {
        const t = ring.w[p];
        w.x += (t.x - w.x) * k;
        w.y += (t.y - w.y) * k;
        let d = t.dir - w.dir;
        d = Math.atan2(Math.sin(d), Math.cos(d));
        w.dir += d * k;
        w.wob = t.wob;
        w.alive = t.alive;
      });
      game.phaseT += dt;
    }
    // だれかが倒れた・落ちたら鳴らす（ホストは動かした局面、ゲストは届いた局面で見る。トンの中で倒れた分も入る）
    const ws = host ? ring.w : shown.w;
    if (ws.some((w, p) => seenAlive[p] && !w.alive)) play('punch', 0.7);
    seenAlive = ws.map((w) => w.alive);
    draw();
    raf = requestAnimationFrame(frame);
  }
  showStatus();
  if (!host) opts.send({ k: 'hi' }, true);
  else { sendState(true); opts.send({ k: 'need' }, true); } // 続きを覚えているゲストがいれば答えてもらう
  raf = requestAnimationFrame(frame);

  return {
    receive,
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      clearInterval(backup);
      document.removeEventListener('keydown', onKey);
    },
  };
}

const r3 = (v) => Math.round(v * 1000) / 1000;
// 試合がどこまで進んだか（同じ「もう一回」の回数の中で比べる）。回 → 数え・取り組み・結果 → おしまい の順に大きくなる
export const progOf = (g) => (Number(g?.round) || 0) * 4 + (g?.over ? 3 : ({ count: 0, fight: 1, show: 2 })[g?.phase] ?? 0);

export default {
  id: 'sumo',
  name: '紙相撲',
  icon: '🤼',
  desc: '「トン」を連打して紙の力士を前へ。叩きすぎると自分も倒れる。2〜4人で土俵に残った人の勝ち',
  ready: true,
  live: true,
  onlineOnly: true, // ホームに「CPU と対戦」「この画面で2人で」を出さない（2026-11-05 本人の決定「オンラインのみ」）
  players: PLAYERS,
  seatCount(rules) { return Math.max(2, Math.min(4, Number(rules?.players) || 2)); },
  liveCpu() { return true; },
  settings: [
    { key: 'players', label: '人数', desc: '1つの土俵で同時に戦う人数。人が足りなければ CPU を選べる', def: 2, choices: [[2, '2人'], [3, '3人'], [4, '4人']] },
    { key: 'rounds', label: '何回戦', desc: '勝った回数で決める。1回なら一発勝負', def: 3, choices: ROUND_CHOICES },
  ],
  mount,
};
