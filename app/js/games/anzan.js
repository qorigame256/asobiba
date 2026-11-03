// フラッシュ暗算。数字が次々に一瞬だけ出るので、足した合計を答える。2〜10人・足りない分は CPU。
// 2026-11-02 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 足し算だけ。全員が答えられ、正解なら1点。いちばん早く正解した人にはさらに1点。
//   - 詳細設定「難しさ」: やさしい（1桁を5個・1秒ごと）・ふつう（最初。1桁を8個・0.7秒ごと）・むずかしい（2桁を8個・0.7秒ごと）。「問題の数」: 5問・10問。
// Claude の判断:
//   - 打った答えは、数字が出ていた大きな枠の所に出す（スマホで数字のボタンまで1画面に収まるように）。
//   - 問題の数の最初は10問。1つの数字は間の 75% だけ出し、残りは消す（同じ数字が続いても分かるように。さらに同じ数字は2つ続けない）。
//   - 答えるのは数字がすべて出終わってから。答えは1問に1回だけ（まちがえたらその問題は終わり。点は減らない）。
//     答える時間は出終わってから10秒。速さは各自の画面で出終わってから答えるまで。全員が答えたら0.8秒で締め切り、答えを見せる間は3秒。
//   - 答えは画面の数字のボタンで打つ（スマホのキーボードを出さないため）。PC は数字のキー・Backspace・Enter でも打てる。
//   - いちばん早い正解が同じ速さで2人以上なら、その全員に +1。
//   - CPU は出終わってから 1.5〜5秒で答え、やさしい 85%・ふつう 70%・むずかしい 50%・おに 35% 当てる（外すときは正しい答えから少しずれた数）。
// 2026-11-02 の32回目の案（本人がおすすめどおり選んだ。中身は Claude の判断）: 難しさに「おに」（1桁を15個・0.4秒ごと）を足した。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open（数字を出す → 答える）→ close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'ans', q: 何問目（0 から）, v: 答え, ms: 出終わってから答えるまで }
//   q が今の問題と同じで、その人がまだ答えていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { mulberry32 } from './util.js';
import { since, scoreChips, leaders, winnersText, timeBar, secText } from './party.js';

export const LEVELS = {
  easy: { label: 'やさしい', lo: 1, hi: 9, k: 5, gap: 1000, cpu: 0.85 },
  normal: { label: 'ふつう', lo: 1, hi: 9, k: 8, gap: 700, cpu: 0.7 },
  hard: { label: 'むずかしい', lo: 10, hi: 99, k: 8, gap: 700, cpu: 0.5 },
  oni: { label: 'おに', lo: 1, hi: 9, k: 15, gap: 400, cpu: 0.35 },
};
const ROUNDS = [[5, '5問'], [10, '10問']];
const levelOf = (r) => LEVELS[r.level] ?? LEVELS.normal;
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 10);
const ANSWER = 10000;
const READY_MS = 3000;
const SHOWN_MS = 3000;
const GRACE_MS = 800;
const ON = 0.75; // 1つの数字を出しておく割合
const MAXLEN = 4; // 打てる桁の数

// 問題を作る: 難しさごとの幅から、同じ数字が2つ続かないように選ぶ
export function makeProblems(seed, level, rounds) {
  const L = LEVELS[level] ?? LEVELS.normal;
  const rnd = mulberry32(seed);
  const qs = [];
  for (let i = 0; i < rounds; i++) {
    const nums = [];
    while (nums.length < L.k) {
      const v = L.lo + Math.floor(rnd() * (L.hi - L.lo + 1));
      if (v !== nums[nums.length - 1]) nums.push(v);
    }
    qs.push(nums);
  }
  return qs;
}
const sum = (a) => a.reduce((x, y) => x + y, 0);
export const flashMs = (s) => levelOf(s.rules).k * levelOf(s.rules).gap;

// 1問ぶんの点: 正解で1点、いちばん早い正解（同じ速さなら全員）にさらに1点
export function pointsOf(ans, right) {
  const ok = ans.map((a) => a !== null && a.v === right);
  const best = Math.min(...ans.filter((a, p) => ok[p]).map((a) => a.ms));
  return ans.map((a, p) => (ok[p] ? 1 + (a.ms === best ? 1 : 0) : 0));
}

const qKey = (s, q = s.q) => `anzan:${s.seed}:${s.rules.level}:${q}`; // 難しさも入れる（同じ種で難しさだけ変えると問題が変わるので、CPU の予定を別にする）
const clone = (s) => ({ ...s, scores: s.scores.slice(), ans: s.ans.slice() });
const cpuPlan = new Map();
const typed = new Map(); // この端末で打ちかけの答え（描き直しても消えないように問題ごとに覚える）
let keyHandler = null; // PC のキーで打つときの受け口（いま出ている問題の分だけ）
let keysHooked = false;

export default {
  id: 'anzan',
  name: 'フラッシュ暗算',
  icon: '🧮',
  desc: '次々に一瞬だけ出る数字を足して、合計を早く答える',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'level', label: '難しさ', desc: 'やさしい: 1桁を5個・1秒ごと／ふつう: 1桁を8個・0.7秒ごと／むずかしい: 2桁を8個・0.7秒ごと／おに: 1桁を15個・0.4秒ごと', def: 'normal', choices: Object.entries(LEVELS).map(([k, v]) => [k, v.label]) },
    { key: 'rounds', label: '問題の数', desc: '1回の対局で出る問題の数', def: 10, choices: ROUNDS },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { level: 'normal', rounds: 10, ...rules };
    if (!LEVELS[r.level]) r.level = 'normal';
    return {
      n, seed, rules: r, qs: makeProblems(seed, r.level, roundsOf(r)), q: -1, phase: 'ready',
      ans: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.ans[p] === null; },
  result(s) { return s.phase === 'end' ? { winners: leaders(s.scores), scores: s.scores } : null; },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : null;
    if (m.p !== me) return null; // ほかの人が答えた音は鳴らさない
    return b.ans[me]?.v === sum(b.qs[b.q]) ? 'correct' : 'wrong';
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `第${s.q + 1}問 / ${s.qs.length}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.ans.every((a) => a !== null)) return { key: 'all' + s.q, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.q, ms: flashMs(s) + ANSWER + 1000, move: { t: 'close' } };
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
        s.ans = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        const pts = pointsOf(s.ans, sum(s.qs[s.q]));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = { pts };
        s.log = [...s0.log, { ans: s.ans.slice(), pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'ans' || s0.phase !== 'open' || m.q !== s0.q || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.ans[m.p] !== null) return null;
    if (!Number.isInteger(m.v) || m.v < 0 || m.v >= 10 ** MAXLEN) return null;
    if (typeof m.ms !== 'number' || !(m.ms >= 0) || m.ms > ANSWER + 300) return null;
    const s = clone(s0);
    s.step += 1;
    s.ans[m.p] = { v: m.v, ms: Math.round(m.ms) };
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 150 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.ans[p] !== null) return null;
    const key = qKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const L = levelOf(s.rules);
      const right = sum(s.qs[s.q]);
      let v = right;
      if (Math.random() >= L.cpu) {
        const off = (1 + Math.floor(Math.random() * (L.hi > 9 ? 12 : 3))) * (Math.random() < 0.5 ? -1 : 1);
        v = Math.max(0, right + off);
      }
      plan = { at: 1500 + Math.random() * 3500, v };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    const t = since(qKey(s)) - flashMs(s);
    return t >= plan.at ? { t: 'ans', q: s.q, v: plan.v, ms: Math.round(t) } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const right = s.q >= 0 && s.q < s.qs.length ? sum(s.qs[s.q]) : null;
    const extra = (p) => {
      if (s.phase === 'open') return s.ans[p] !== null ? '<span class="pt-ok">✔</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const a = s.ans[p];
      if (!a) return '<span class="pt-ng">―</span>';
      return a.v === right ? `<span class="pt-ok">○ ${secText(a.ms)} +${s.last.pts[p]}</span>` : `<span class="pt-ng">× ${a.v}</span>`;
    };
    keyHandler = null;
    root.innerHTML = '';
    root.className = 'board kj az';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    const L = levelOf(s.rules);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">${L.label}: ${L.hi > 9 ? '2桁' : '1桁'}の数字が${L.k}個出ます。全部足した答えを打とう・全${s.qs.length}問</div>`;
      return;
    }
    const key = qKey(s);
    const F = flashMs(s);
    card.insertAdjacentHTML('beforeend', `<div class="kj-num">第${s.q + 1}問 / ${s.qs.length}</div>`);
    const big = document.createElement('div');
    big.className = 'az-big';
    card.append(big);
    if (s.phase === 'shown') {
      big.textContent = String(right);
      big.classList.add('ans');
      const t = document.createElement('div');
      t.className = 'kj-sub az-nums';
      t.textContent = s.qs[s.q].join(' + ') + ' = ' + right;
      card.append(t);
      return;
    }
    since(key);
    const mine = me !== null ? s.ans[me] : null;
    const tk = key + ':' + me;
    const pad = document.createElement('div');
    pad.className = 'az-pad';
    const barBox = document.createElement('div');
    barBox.className = 'az-bar';
    card.append(barBox);
    const after = () => since(key) - F; // 出終わってからの時間
    const canNow = () => me !== null && o.canMove && mine === null && after() >= 0 && after() < ANSWER;
    // 打った答えは大きな数字の所に出す（スマホで数字のボタンまで画面に収まるように、別の欄を作らない）
    const show = () => {
      if (after() >= 0) {
        const v = mine ? String(mine.v) : typed.get(tk) || '';
        big.textContent = v || '？';
        big.classList.toggle('ask', !v);
      }
      pad.querySelectorAll('button').forEach((b) => { b.disabled = !canNow(); });
    };
    const send = () => {
      const t = typed.get(tk);
      if (!canNow() || !t || pad.dataset.sent) return;
      pad.dataset.sent = '1';
      pad.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      o.onMove({ t: 'ans', q: s.q, v: Number(t), ms: Math.round(after()) });
    };
    const press = (k) => {
      if (!canNow() || pad.dataset.sent) return;
      const t = typed.get(tk) || '';
      if (k === 'del') typed.set(tk, t.slice(0, -1));
      else if (k === 'ok') { send(); return; }
      else if (t.length < MAXLEN) typed.set(tk, t === '0' ? k : t + k);
      if (typed.size > 100) typed.delete(typed.keys().next().value);
      show();
    };
    for (const k of ['7', '8', '9', '4', '5', '6', '1', '2', '3', 'del', '0', 'ok']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'az-key' + (k === 'ok' ? ' ok' : k === 'del' ? ' del' : '');
      b.textContent = k === 'ok' ? '答える' : k === 'del' ? '⌫' : k;
      // 指が触れた瞬間に押したことにする（ほかの人の手で作り直されても押したのが消えないように）。
      // click は押したあとにも来るので、キーボードで押したとき（detail が 0）だけ使う（前は両方で押していて、1回で2つ入った。2026-11-03 本人の報告）
      b.onpointerdown = (e) => { if (e.button !== 0) return; e.preventDefault(); press(k); };
      b.onclick = (e) => { e.preventDefault(); if (e.detail === 0) press(k); };
      pad.append(b);
    }
    if (me !== null && mine === null) {
      keyHandler = (e) => {
        if (!pad.isConnected) return; // ほかの画面へ移ったあとは打たない
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
    // 数字を出す（画面の描き替えに合わせて、出てからの時間で決める）。出終わったら答える時間の帯を出してボタンを押せるようにする
    let started = false;
    const tick = () => {
      if (!big.isConnected && started) return;
      started = true;
      const t = since(key);
      if (t < F) {
        const i = Math.floor(t / L.gap);
        big.textContent = (t - i * L.gap) < L.gap * ON ? String(s.qs[s.q][i]) : ' ';
        requestAnimationFrame(tick);
        return;
      }
      if (!barBox.firstChild) { since(key + ':a'); barBox.append(timeBar(key + ':a', ANSWER, { secs: true })); }
      show();
    };
    tick();
    show();
    wrap.append(pad);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (mine) note.textContent = mine.v === right ? `⭕ 正解！（${secText(mine.ms)}）` : '❌ ざんねん。次の問題を待とう';
    wrap.append(note);
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const smy = document.createElement('summary');
    smy.textContent = `📝 ふりかえり（全${s.log.length}問）`;
    const list = document.createElement('ol');
    s.log.forEach((x, q) => {
      const right = sum(s.qs[q]);
      const li = document.createElement('li');
      const best = Math.min(...x.ans.filter((a) => a && a.v === right).map((a) => a.ms));
      const fast = x.ans.map((a, p) => (a && a.v === right && a.ms === best ? (p === me ? 'あなた' : o.names?.[p] ?? '') : null)).filter((v) => v !== null);
      const mine = me === null ? '' : x.ans[me]?.v === right ? `⭕ ${secText(x.ans[me].ms)}` : x.ans[me] ? `❌ ${x.ans[me].v}` : '―';
      li.innerHTML = `<span class="mk-rv-n">${q + 1}</span><span class="az-rv">${s.qs[q].join('+')} = <b>${right}</b></span><span>${mine}</span>`;
      const who = document.createElement('span');
      who.className = 'mk-rv-who';
      who.textContent = fast.length ? '⚡' + fast.join('・') : '―';
      li.append(who);
      list.append(li);
    });
    box.append(smy, list);
    return box;
  },
};
