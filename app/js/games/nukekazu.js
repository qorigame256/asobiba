// 抜けた数さがし。1〜30 などの数字が画面にばらばらに散らばっている。1つだけ足りない数を見つけて、数字のボタンで打って答える。2〜10人・足りない分は CPU（弱め）。
// 2026-11-19 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認「推奨どおりで」）:
//   - 数字のボタンで打って答える（1問に1回だけ）。4つから選ぶ形にしない（その4つを探すだけで当たってしまうため）。
//   - 数字は格子に並べず画面にばらばらに散らし、大きさも少しずつ変える（数字タッチと見た目を分けるため）。
//   - 範囲は詳細設定「むずかしさ」で やさしい（1〜20）・ふつう（1〜30。最初）・むずかしい（1〜50）。
//   - 点は速い順に 3・2・1点。5問（詳細設定で 3・10問）。
// Claude の判断:
//   - 数字は少し傾け（±18度）、色を6色からくじで付ける。置き場所と大きさ・傾き・色は種から決める（全員同じ）。数字どうしは重ならない
//     （置けない数字が出たら、種から決めた別の乱数で全部を置き直す）。図は横 100・縦 90 の横長（スマホで答えのボタンまでスクロールせずに届くように）。
//   - 1問の制限時間は やさしい25秒・ふつう35秒・むずかしい50秒。だれかが正解したら8秒で締め切る（数のきまり当ての5秒より長め。探すのに時間がかかるため）。
//     全員が答えたら1.5秒。答えを見せる間は3.5秒。
//   - CPU は 6秒〜制限時間の7割で答え、6割当てる（まちがえるときは、抜けた数のとなりの数）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next …（数のきまり当てと同じ）
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q, c: 打った数, ms }

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, afterBar, afterMs, secText, speedLine } from './party.js';
import { pointsOf } from './make10.js';

const ROUNDS = [[3, '3問'], [5, '5問'], [10, '10問']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === Number(r.rounds)) ? Number(r.rounds) : 5);
const LEVELS = [['easy', 'やさしい（1〜20）'], ['normal', 'ふつう（1〜30）'], ['hard', 'むずかしい（1〜50）']];
export const levelOf = (r) => (LEVELS.some(([v]) => v === r.level) ? r.level : 'normal');
export const MAX = { easy: 20, normal: 30, hard: 50 };
export const LIMITS = { easy: 25000, normal: 35000, hard: 50000 };
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 1500;
const AFTER_MS = 8000;
const MAXLEN = 2;
export const W = 100;
export const H = 90;
const COLORS = ['#d9643a', '#2f6fb3', '#2e9a52', '#8a4fc0', '#c08a0c', '#d24a8c'];
const SIZE = { easy: 9.5, normal: 8, hard: 6.1 }; // 字の高さのもと（図の幅 100 に対して）

// 1問を作る。nums = [{ v, x, y, h: 字の高さ, r: 傾き, c: 色 }]、miss = 抜けた数
export function makeQuestion(seed, q, level) {
  const rnd = mulberry32((seed * 157 + q * 37 + 3) >>> 0);
  const max = MAX[level] ?? MAX.normal;
  const miss = 1 + Math.floor(rnd() * max);
  const base = SIZE[level] ?? SIZE.normal;
  // 置き場所が見つからない数字が出たら、別の乱数で全部を置き直す（何回やり直したかも種から決まるので全員同じ）
  for (let attempt = 0; attempt < 12; attempt++) {
    const r2 = attempt ? mulberry32((seed * 157 + q * 37 + 3 + attempt * 7919) >>> 0) : rnd;
    const nums = layout(r2, max, miss, base, attempt === 11);
    if (nums) return { miss, max, nums };
  }
  return { miss, max, nums: [] }; // ここへは来ない（最後のやり直しは重なってでも置く）
}

// 1から max まで（miss を除く）を重ならないように置く。置けない数字があれば null（force なら重ねて置く）
function layout(rnd, max, miss, base, force) {
  const boxes = [];
  const nums = [];
  for (let v = 1; v <= max; v++) {
    if (v === miss) continue;
    const digits = String(v).length;
    const r = Math.round((rnd() * 2 - 1) * 18);
    const c = Math.floor(rnd() * COLORS.length);
    const cs = Math.abs(Math.cos((r * Math.PI) / 180));
    const sn = Math.abs(Math.sin((r * Math.PI) / 180));
    let put = null;
    for (let t = 0; t < 600 && !put; t++) {
      const h = base * (0.8 + rnd() * 0.6) * (t < 300 ? 1 : 0.85); // 置けないときは少し小さくする
      const w0 = h * (0.62 * digits + 0.25);
      const w = w0 * cs + h * 0.8 * sn; // 傾けたあとの外枠
      const hh = w0 * sn + h * 0.8 * cs;
      const x = w / 2 + 1 + rnd() * (W - w - 2);
      const y = hh / 2 + 1 + rnd() * (H - hh - 2);
      const b = { l: x - w / 2 - 0.8, r: x + w / 2 + 0.8, t: y - hh / 2 - 0.8, b: y + hh / 2 + 0.8 };
      if (boxes.every((o) => b.r <= o.l || b.l >= o.r || b.b <= o.t || b.t >= o.b)) put = { x, y, h, b };
    }
    if (!put) {
      if (!force) return null;
      const h = base * 0.8;
      put = { x: 5 + rnd() * (W - 10), y: 5 + rnd() * (H - 10), h, b: { l: 0, r: 0, t: 0, b: 0 } };
    }
    boxes.push(put.b);
    nums.push({ v, x: Math.round(put.x * 10) / 10, y: Math.round(put.y * 10) / 10, h: Math.round(put.h * 10) / 10, r, c });
  }
  return nums;
}

const typed = new Map(); // 打ちかけ（qKey + 席 → 文字）。送らない
let keyHandler = null;
let keysHooked = false;
const qKey = (s, q = s.q) => `nukekazu:${s.seed}:${levelOf(s.rules)}:${q}`; // むずかしさも入れる（数のきまり当てと同じ理由）
const clone = (s) => ({ ...s, scores: s.scores.slice(), solved: s.solved.slice(), miss: s.miss.slice(), said: s.said.slice() });
const doneOf = (s, p) => s.solved[p] !== null || s.miss[p];
const limitOf = (s) => LIMITS[levelOf(s.rules)];
const cpuPlan = new Map();

function figSvg(x, shown) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'nk-fig' + (shown ? ' shown' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `1から${x.max}までの数字`);
  svg.innerHTML = x.nums.map((n) => `<text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="central" font-size="${n.h}" fill="${COLORS[n.c]}" transform="rotate(${n.r} ${n.x} ${n.y})">${n.v}</text>`).join('');
  return svg;
}

export default {
  id: 'nukekazu',
  name: '抜けた数さがし',
  icon: '🕳️',
  desc: 'ばらばらに散らばった数字から、1つだけ足りない数を早く見つける',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: 'むずかしさ', desc: '散らばる数字の範囲', def: 'normal', choices: LEVELS },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 5, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 5, level: 'normal', ...rules };
    const qs = Array.from({ length: roundsOf(r) }, (_, q) => makeQuestion(seed, q, levelOf(r)));
    return {
      n, seed, rules: r, qs, q: -1, phase: 'ready',
      solved: Array(n).fill(null), miss: Array(n).fill(false), said: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s) { return s.phase === 'open'; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が答えた音は鳴らさない（色ちがい早押しと同じ）
    return b.solved[me] !== null ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      const limit = limitOf(s);
      if ([...Array(s.n).keys()].every((p) => doneOf(s, p))) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      if (s.solved.some((v) => v !== null)) return { key: 'solved' + s.q, ms: afterMs(qKey(s), limit, AFTER_MS, GRACE_MS), move: { t: 'close' } };
      return { key: 'open' + s.q, ms: limit + GRACE_MS, move: { t: 'close' } };
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
        if (s.q + 1 >= s.qs.length) { s.phase = 'end'; return s; }
        s.q += 1;
        s.phase = 'open';
        s.solved = Array(s.n).fill(null);
        s.miss = Array(s.n).fill(false);
        s.said = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.solved);
        pts.forEach((v, p) => { s.scores[p] += v; });
        const times = s.solved.filter((v) => v !== null);
        const best = times.length ? Math.min(...times) : null;
        const winners = best === null ? [] : s.solved.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0);
        s.last = { pts, winners };
        s.log = [...s0.log, { solved: s.solved.slice(), said: s.said.slice(), winners }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || doneOf(s0, m.p)) return null;
    if (!Number.isInteger(m.c) || m.c < 0 || m.c >= 10 ** MAXLEN || typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > limitOf(s0) + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.said[m.p] = m.c;
    if (m.c === s.qs[s.q].miss) s.solved[m.p] = Math.round(m.ms);
    else s.miss[m.p] = true;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || doneOf(s, p)) return null;
    const x = s.qs[s.q];
    const limit = limitOf(s);
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const near = [x.miss - 1, x.miss + 1].filter((v) => v >= 1 && v <= x.max);
      plan = { at: 6000 + Math.random() * (limit * 0.7 - 6000), c: Math.random() < 0.6 ? x.miss : near[Math.floor(Math.random() * near.length)] };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s));
    return t >= plan.at && t < limit ? { t: 'ans', q: s.q, c: plan.c, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return doneOf(s, p) ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      if (s.solved[p] !== null) return `<span class="pt-ok">○ ${secText(s.solved[p])} +${s.last.pts[p]}</span>`;
      return s.miss[p] ? `<span class="pt-ng">× ${s.said[p]}</span>` : '<span class="pt-ng">―</span>';
    };
    keyHandler = null;
    root.innerHTML = '';
    root.className = 'board kj nk';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true, log: s.log }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const max = MAX[levelOf(s.rules)];
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">1〜${max} のうち、1つだけ足りない数を打とう・全${s.qs.length}問</div>`;
      return;
    }
    const x = s.qs[s.q];
    const key = qKey(s);
    const limit = limitOf(s);
    const shown = s.phase !== 'open';
    const mine = me !== null ? s.said[me] : null;
    const tk = key + ':' + me;
    const head = document.createElement('div');
    head.className = 'nk-head';
    const ansBox = document.createElement('span');
    ansBox.className = 'sq-n q nk-ans' + (shown ? ' ans' : '');
    head.append(Object.assign(document.createElement('span'), { textContent: `1〜${max} で抜けている数は` }), ansBox);
    card.append(head);
    card.append(figSvg(x, shown));
    if (!shown) {
      since(key);
      const anySolved = s.solved.some((v) => v !== null);
      card.insertAdjacentHTML('beforeend', `<div class="kj-sub"${anySolved ? '' : ' style="visibility:hidden"'}>だれかが正解！ もうすぐ締め切り</div>`); // 行の場所はいつも空けておく（数のきまり当てと同じ）
      card.append(anySolved ? afterBar(key, limit, AFTER_MS) : timeBar(key, limit, { secs: true }));
    } else {
      ansBox.textContent = x.miss;
      const t = document.createElement('div');
      t.className = 'kj-sub';
      const fast = s.last.winners.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      t.textContent = fast ? `いちばん速かったのは ${fast}` : 'だれも正解できませんでした';
      card.append(t);
    }
    const can0 = s.phase === 'open' && me !== null && o.canMove && !doneOf(s, me) && since(key) < limit;
    const pad = document.createElement('div');
    pad.className = 'az-pad nk-pad';
    const canNow = () => can0 && !pad.dataset.sent && since(key) < limit;
    const show = () => {
      if (!shown) {
        const v = mine !== null ? String(mine) : typed.get(tk) || '';
        ansBox.textContent = v || '？';
        ansBox.classList.toggle('typed', !!v);
        if (mine !== null) ansBox.classList.add(s.solved[me] !== null ? 'ok' : 'ng');
      }
      pad.querySelectorAll('button').forEach((b) => { b.disabled = !canNow(); });
    };
    const send = () => {
      const t = typed.get(tk);
      if (!canNow() || !t) return;
      const ms = Math.round(since(key));
      if (ms >= limit) return;
      pad.dataset.sent = '1';
      show();
      o.onMove({ t: 'ans', q: s.q, c: Number(t), ms });
    };
    const press = (k) => {
      if (!canNow()) return;
      const t = typed.get(tk) || '';
      if (k === 'del') typed.set(tk, t.slice(0, -1));
      else if (k === 'ok') { send(); return; }
      else if (t.length < MAXLEN) typed.set(tk, t === '0' ? k : t + k);
      if (typed.size > 100) typed.delete(typed.keys().next().value);
      show();
    };
    if (!shown) {
      for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'del', '0', 'ok']) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'az-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : '');
        b.textContent = k === 'ok' ? '答える' : k === 'del' ? '⌫' : k;
        // 指が触れた瞬間に押したことにし、click はキーボードで押したとき（detail が 0）だけ使う（フラッシュ暗算と同じ。両方で数えると1回で2つ入る）
        b.onpointerdown = (e) => { if (e.button !== 0) return; e.preventDefault(); press(k); };
        b.onclick = (e) => { e.preventDefault(); if (e.detail === 0) press(k); };
        pad.append(b);
      }
      if (can0) {
        keyHandler = (e) => {
          if (!pad.isConnected) return;
          if (e.key >= '0' && e.key <= '9') press(e.key);
          else if (e.key === 'Backspace') press('del');
          else if (e.key === 'Enter') press('ok');
          else return;
          e.preventDefault();
        };
        // 読み込んだときでなく最初に描くときに1回だけ付ける（tools/test-logic.mjs は Node で読むので window が無い）
        if (!keysHooked) {
          keysHooked = true;
          window.addEventListener('keydown', (e) => {
            if (!keyHandler || e.ctrlKey || e.metaKey || e.altKey) return;
            if (e.target instanceof HTMLElement && e.target.closest('input, textarea, select')) return;
            keyHandler(e);
          });
        }
      }
      show();
      wrap.append(pad);
    }
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (shown) note.textContent = mine !== null ? `あなたの答え ${mine}${s.solved[me] !== null ? ' ⭕' : ' ❌'}` : '';
    else if (s.solved[me] !== null) note.textContent = `⭕ 正解！（${secText(s.solved[me])}）`;
    else if (s.miss[me]) note.textContent = '❌ ざんねん。次の問題を待とう';
    else note.textContent = '数を打って「答える」（答えられるのは1回だけ）';
    wrap.append(note);
    if (shown) wrap.append(speedLine(o, s.solved, key)); // 早押しの速さの線（2026-11-17。party.js の speedLine）
    if (canNow()) {
      setTimeout(() => {
        if (!pad.isConnected || pad.dataset.sent) return;
        pad.querySelectorAll('button').forEach((b) => { b.disabled = true; });
        note.textContent = '時間切れ！';
      }, Math.max(0, limit - since(key)));
    }
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const g = s.qs[q];
      const li = document.createElement('li');
      const fast = x.winners.map((p) => (p === me ? 'あなた' : o.names?.[p] ?? ''));
      const mine = me === null ? '' : x.solved[me] !== null ? `⭕ ${secText(x.solved[me])}` : x.said[me] !== null ? `❌ ${x.said[me]}` : '―';
      const sp = (t, c = '') => { const e = document.createElement('span'); e.textContent = t; if (c) e.className = c; return e; };
      li.append(sp(String(q + 1), 'mk-rv-n'), sp(`1〜${g.max} で抜けていたのは ${g.miss}`), sp(mine), sp(fast.length ? '⚡' + fast.join('・') : '―', 'mk-rv-who'));
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
