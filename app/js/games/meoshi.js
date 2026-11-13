// 目押しそろえ。回っている3つの絵の帯（リール）を1つずつ止めて、まん中の絵をそろえる。2〜10人・足りない分は CPU（弱め）。
// 2026-11-13 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ）:
//   - 全員が同時に自分のスロットを回し、5回勝負（推奨を承認）。
//   - 点はそろった絵の種類で違う（本人の選択。7 は高く、さくらんぼは低い）。
// Claude の判断:
//   - 帯は3本とも8こまで、7 が1つ・🔔 が2つ・🍉 が2つ・🍒 が3つ（並びは帯ごとに決まっていて、毎回同じ。覚えて狙える）。
//     3つそろったら 7 = 10点・🔔 = 5点・🍉 = 3点・🍒 = 2点（帯の中に少ない絵ほど高い）。2つだけそろったら1点。そろわなければ0点。
//   - 帯の速さは回が進むほど上がる（1こまの長さ 180・150・130・110・95ms）。回ごとの帯の始まりの位置は種からくじで決める（全員同じ）。
//   - 止める順は自由（帯を押すか、帯の下のボタン。PC は 1・2・3 キーか、スペースキーで左から）。1回10秒。時間が来たら、止めていない帯はその時刻で止まる。
//   - 止めた時刻は各自の端末で回が始まってから測って手に入れ、どの絵で止まったかは時刻から計算する（全員の端末で同じ。通信の遅れで不利にならない）。
//     画面の帯も同じ式で動かしているので、見えている絵と計算の絵は同じ。
//   - ほかの人の帯は、その回の結果まで見せない（札に ✔ だけ）。
//   - CPU は 7・🔔・🍒 のどれかを狙い、帯ごとに 1回目7割〜5回目4割の確かさで狙った絵に止める（外すと別の絵）。
// 詳細設定（2026-11-13 の41回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - 帯の並び（mix）: いつも同じ（最初。前と全く同じ）・毎回まぜる。まぜるでは回ごと・帯ごとに8こまの並びを種からくじで並べ替える（全員同じ。絵の数は変えない）。
//     並べ替えは全部の回の帯の始まりの位置を決めたあとに、別の乱数で行う（いつも同じのときの帯と、まぜるときの帯の速さ・始まりの位置を前と同じにするため）。並びは回の `reels` に持ち、無ければ REELS。
//   - 回数（rounds）: 3回・5回（最初）・10回。帯の速さの並び（5つ）を回数に合わせて引き伸ばす・間引く（q 回目は並びの floor(q × 5 ÷ 回数) 番目）。
//   最初の値のときの帯は前と全く同じ（tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open →（全員止めた / 10秒）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'stop', q: 何回目, ms: [左, まん中, 右の帯を止めた時刻]（0〜LIMIT の整数） }

import { mulberry32, shuffle } from './util.js';
import { since, leaders, winnersText, scoreChips } from './party.js';
import { play } from '../sound.js';

export const REELS = [
  ['7', '🍒', '🍉', '🍒', '🔔', '🍒', '🍉', '🔔'],
  ['🍒', '🔔', '🍒', '7', '🍉', '🍒', '🔔', '🍉'],
  ['🍉', '🍒', '🔔', '🍒', '🍉', '7', '🍒', '🔔'],
];
const LEN = 8;
export const PTS = { '7': 10, '🔔': 5, '🍉': 3, '🍒': 2 };
const PAIR = 1;
const STEPS = [180, 150, 130, 110, 95];
export const LIMIT = 10000;
const READY_MS = 3000;
const SHOWN_MS = 4000;
const GRACE_MS = 1500;

const MIX_CHOICES = [[false, 'いつも同じ（覚えて狙える）'], [true, '毎回まぜる']];
const ROUND_CHOICES = [[3, '3回'], [5, '5回'], [10, '10回']];

// 全部の回の帯の始まりの位置（ms の整数）と、まぜるときの並び
export function makeRounds(seed, rules = {}) {
  const rnd = mulberry32(seed);
  const N = ROUND_CHOICES.some(([v]) => v === rules.rounds) ? rules.rounds : 5;
  const rs = Array.from({ length: N }, (_, q) => {
    const step = STEPS[Math.floor((q * STEPS.length) / N)];
    return { step, off: REELS.map(() => Math.floor(rnd() * LEN * step)) };
  });
  if (rules.mix) {
    const mix = mulberry32((seed ^ 0x5bd1e995) >>> 0);
    rs.forEach((x) => { x.reels = REELS.map((reel) => shuffle(reel, mix)); });
  }
  return rs;
}
// 回 x の帯 r の並び
export const reelOf = (x, r) => (x.reels ?? REELS)[r];
// 時刻 ms に帯 r のまん中にある絵の番号
export const cellAt = (x, r, ms) => Math.floor((ms + x.off[r]) / x.step) % LEN;
// 3つの絵の点
export function pointsOf(syms) {
  const [a, b, c] = syms;
  if (a === b && b === c) return PTS[a];
  return a === b || b === c || a === c ? PAIR : 0;
}
const symsOf = (x, ms) => ms.map((v, r) => reelOf(x, r)[cellAt(x, r, v)]);

const qKey = (s, q = s.q) => `meoshi:${s.seed}:${q}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), stops: s.stops.slice(), syms: s.syms.slice() });
const cpuPlan = new Map();
let ui = null; // { mount, chips }

// CPU: 狙った絵が帯 r のまん中に来る、t0 より後の時刻
export function timeFor(x, r, cell, t0) {
  let k = Math.ceil((t0 + x.off[r]) / x.step);
  for (let i = 0; i < LEN && k % LEN !== cell; i++) k += 1; // cell が 0〜LEN-1 でなくても終わるように回数を区切る
  let t = k * x.step - x.off[r] + Math.floor(x.step / 2);
  while (t > LIMIT) t -= LEN * x.step;
  return Math.max(0, t);
}

export default {
  id: 'meoshi',
  name: '目押しそろえ',
  icon: '🎰',
  desc: '回る3つの絵を1つずつ止めてそろえる。7 は高い点',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,

  settings: [
    { key: 'mix', label: '帯の並び', desc: '毎回まぜるでは、回ごとに帯の絵の並びが変わる（覚えて狙えない）', def: false, choices: MIX_CHOICES },
    { key: 'rounds', label: '回数', desc: '1回の対局で回す回数（回が進むほど帯が速くなる）', def: 5, choices: ROUND_CHOICES },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { mix: false, rounds: 5, ...rules };
    return { n, seed, rules: r, rs: makeRounds(seed, r), q: -1, phase: 'ready', stops: Array(n).fill(null), syms: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && (p === undefined || s.stops[p] === null); },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) {
      if (m.t === 'next') return 'question';
      if (m.t === 'close' && me !== null && me >= 0 && me < b.n) {
        const pt = b.last?.pts[me] ?? 0;
        return pt >= 10 ? 'goal' : pt > PAIR ? 'correct' : pt ? 'pop' : null;
      }
      return null;
    }
    return null; // 自分の止めた音は止めたときに鳴らしている
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.q + 1}回目 / ${s.rs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.stops.every((v) => v !== null)) return { key: 'all' + s.q, ms: 600, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: LIMIT + GRACE_MS, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.q, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.q + 1 >= s.rs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.stops = Array(s.n).fill(null);
        s.syms = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = s.syms.map((v) => (v ? pointsOf(v) : 0));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { syms: s.syms.slice(), pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'stop' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.stops[m.p] !== null) return null;
    if (!Array.isArray(m.ms) || m.ms.length !== 3 || !m.ms.every((v) => Number.isInteger(v) && v >= 0 && v <= LIMIT)) return null;
    const s = clone(s0);
    s.step += 1;
    s.stops[m.p] = m.ms.slice();
    s.syms[m.p] = symsOf(s.rs[s.q], m.ms);
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.stops[p] !== null) return null;
    const x = s.rs[s.q];
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const r0 = Math.random();
      const want = r0 < 0.3 ? '7' : r0 < 0.6 ? '🔔' : '🍒';
      const sure = 0.7 - (0.3 * s.q) / (s.rs.length - 1 || 1);
      let t = 1200 + Math.random() * 1500;
      const ms = REELS.map((_, r) => {
        const reel = reelOf(x, r);
        // 狙いどおりに止めるかを帯ごとに1回だけくじで決める（こまごとに引くと候補が0になることがあり、timeFor が終わらなかった。2026-11-13 Codex の点検）
        const hit = Math.random() < sure;
        let cells = [...reel.keys()].filter((c) => (hit ? reel[c] === want : reel[c] !== want));
        if (!cells.length) cells = [...reel.keys()];
        const cell = cells[Math.floor(Math.random() * cells.length)];
        const v = timeFor(x, r, cell, t);
        t = v + 600 + Math.random() * 900;
        return Math.min(LIMIT, v);
      });
      plan = { at: Math.max(...ms) + 100, ms };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 200) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(qKey(s)) >= plan.at ? { t: 'stop', q: s.q, ms: plan.ms } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.stops[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (!s.syms[p]) return '<span class="pt-ng">―</span>';
      const pt = s.last.pts[p];
      return `<span class="${pt ? 'pt-ok' : 'pt-ng'}">${s.syms[p].join('')}${pt ? ' +' + pt : ''}</span>`;
    };
    const chips = scoreChips(o, s.scores, { won, extra, steady: true });
    // 同じ場面のうちは札だけ差し替える（ほかの人の手が届くたびに作り直すと、描きかけ・押しかけが消えるため）
    const mount = `${s.seed}:${s.q}:${s.phase}:${me}:${me !== null && s.stops[me] !== null}`;
    if (ui?.mount === mount && root.contains(ui.chips)) {
      ui.chips.replaceWith(chips);
      ui.chips = chips;
      return;
    }
    ui = { mount, chips };
    root.innerHTML = '';
    root.className = 'board ms';
    root.append(chips);
    if (s.phase === 'end') { root.append(this.review(s, me)); return; }
    const table = document.createElement('p');
    table.className = 'ms-table';
    table.innerHTML = Object.entries(PTS).map(([k, v]) => `<span><b class="${k === '7' ? 'ms-7' : ''}">${k}${k}${k}</b> ${v}点</span>`).join('') + `<span>2つ ${PAIR}点</span>`;
    root.append(table);
    if (s.phase === 'ready') {
      const head = document.createElement('p');
      head.className = 'cp-head';
      head.textContent = `よーい… 3つの絵を1つずつ止めて、まん中の絵をそろえよう（全${s.rs.length}回）`;
      root.append(head);
      return;
    }
    const x = s.rs[s.q];
    const key = qKey(s);
    since(key);
    const mine = me !== null ? s.stops[me] : null;
    const stopped = mine ? mine.slice() : [null, null, null];

    const box = document.createElement('div');
    box.className = 'ms-box';
    const reels = REELS.map((_, r) => {
      const reel = reelOf(x, r);
      const w = document.createElement('div');
      w.className = 'ms-reel';
      const strip = document.createElement('div');
      strip.className = 'ms-strip';
      // 上から下へ「番号の大きい順」に3周ぶん並べる（下へ流れると番号の小さい絵から上がってくる見た目になる。式は place の中）
      for (let j = 0; j < LEN * 3; j++) {
        const c = document.createElement('span');
        const sym = reel[(LEN * 3 - 1 - j) % LEN];
        c.textContent = sym;
        if (sym === '7') c.className = 'ms-7';
        strip.append(c);
      }
      w.append(strip);
      box.append(w);
      return { w, strip };
    });
    root.append(box);
    // 帯の位置: pos = (時刻 + 始まり) ÷ 1こまの長さ。まん中の絵は floor(pos)。止めた帯はその絵をまん中にそろえる
    const place = (r, t) => {
      const v = stopped[r] !== null ? stopped[r] : t;
      let pos = (v + x.off[r]) / x.step;
      if (stopped[r] !== null) pos = Math.floor(pos) + 0.5;
      const u = (pos % LEN) + LEN;
      reels[r].strip.style.transform = `translateY(${((u - 22.5) / (LEN * 3)) * 100}%)`;
      reels[r].w.classList.toggle('done', stopped[r] !== null);
    };
    const note = document.createElement('p');
    note.className = 'cc-log';

    if (s.phase === 'shown') {
      if (mine) mine.forEach((_, r) => place(r, 0));
      else reels.forEach((_, r) => { stopped[r] = 0; place(r, 0); });
      const pt = mine ? s.last.pts[me] : 0;
      if (mine && pt >= PAIR) box.classList.add(pt > PAIR ? 'win' : 'pair');
      note.textContent = me === null ? '' : !mine ? '止められませんでした…' : pt > PAIR ? `🎉 そろった！ +${pt}点` : pt ? `2つそろった +${pt}点` : 'そろわなかった…';
      root.append(note);
      return;
    }
    if (mine || me === null) {
      if (mine) mine.forEach((_, r) => place(r, 0));
      else {
        const spin = () => { if (!box.isConnected) return; reels.forEach((_, r) => place(r, since(key))); requestAnimationFrame(spin); };
        spin();
      }
      note.textContent = mine ? '止めた！ ほかの人を待っています' : '観戦中（ほかの人の帯は結果で見られます）';
      root.append(note);
      return;
    }
    const btns = document.createElement('div');
    btns.className = 'ms-btns';
    let sent = false;
    const send = () => {
      if (sent) return;
      sent = true;
      o.onMove({ t: 'stop', q: s.q, ms: stopped.map((v) => Math.min(LIMIT, v ?? LIMIT)) });
    };
    const stop = (r, e) => {
      e?.preventDefault?.();
      if (sent || stopped[r] !== null || !o.canMove) return;
      const t = Math.round(since(key));
      stopped[r] = Math.min(LIMIT, t);
      play('chip');
      place(r, t);
      b[r].disabled = true;
      if (stopped.every((v) => v !== null)) send();
    };
    const b = REELS.map((_, r) => {
      const btn = document.createElement('button');
      btn.className = 'btn ms-stop';
      btn.textContent = 'とめる';
      btn.onpointerdown = (e) => stop(r, e);
      btn.onclick = (e) => { if (e.detail === 0) stop(r, e); };
      reels[r].w.onpointerdown = (e) => stop(r, e);
      btns.append(btn);
      return btn;
    });
    root.append(btns, note);
    note.textContent = '帯を押すか「とめる」で止めよう（PC は 1・2・3 かスペース）';
    const spin = () => {
      if (!box.isConnected || sent) return;
      const t = since(key);
      if (t >= LIMIT) {
        // 時間切れ: 止めていない帯はその時刻で止まる
        REELS.forEach((_, r) => { if (stopped[r] === null) { stopped[r] = LIMIT; place(r, LIMIT); b[r].disabled = true; } });
        note.textContent = '時間切れ！';
        send();
        return;
      }
      reels.forEach((_, r) => place(r, t));
      requestAnimationFrame(spin);
    };
    spin();
    // 画面が隠れて requestAnimationFrame が止まっても、時間切れの帯を止めて送る
    setTimeout(() => { if (box.isConnected && !sent) spin(); }, Math.max(0, LIMIT - since(key) + 30));
  },

  review(s, me) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const li = document.createElement('li');
      const best = Math.max(0, ...x.pts);
      const mine = me === null ? '' : x.syms[me] ? `${x.syms[me].join('')} ${x.pts[me]}点` : '―';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span>${s.rs[q].step}ms</span><span>${mine}</span><span class="mk-rv-who">いちばん ${best}点</span>`;
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};

// PC のキー: 1・2・3 でその帯、スペースで左から止める（対局の画面に帯が出ているときだけ）
if (typeof document !== 'undefined') {
  document.addEventListener('keydown', (e) => {
    if (e.repeat || e.target?.closest?.('input, textarea, select')) return;
    const btns = [...document.querySelectorAll('.board.ms .ms-stop')];
    if (!btns.length) return;
    const b = /^[123]$/.test(e.key) ? btns[Number(e.key) - 1] : e.key === ' ' ? btns.find((x) => !x.disabled) : null;
    if (!b || b.disabled) return;
    e.preventDefault();
    b.onpointerdown?.(e);
  });
}
