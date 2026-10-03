// ヒット＆ブロー（数当て）。全員で同じ「答えの数」を同時に当て合う早当て競争。2〜10人。
// 答えは 0〜9 の数字を重ならないように並べたもの（桁数は詳細設定で 3 / 4）。対局の種（seed）から作る。
// 毎回、全員が予想を1つずつ出し、そろったら一斉に結果が出る。
//   ヒット = 数字も場所も合っている / ブロー = 数字は合っているが場所が違う
// 全部ヒットした人が出た回で終わり。同じ回に当てた人が複数いれば全員の勝ち（同着）。
// 自分の画面には自分の予想だけを出す。ほかの人はヒット・ブローの数だけ見える（数字は終わってから見える）。
// 手: { p, t: 'guess', g: '0123', r: 何回目の予想か }。r と「この回はもう出したか」で、同じ手が2回来ても2回目は反則になる。

import { mulberry32, shuffle } from './util.js';

const ALL_DIGITS = '0123456789'.split('');

function score(g, ans) {
  let hit = 0;
  let blow = 0;
  for (let i = 0; i < g.length; i++) {
    if (g[i] === ans[i]) hit++;
    else if (ans.includes(g[i])) blow++;
  }
  return { hit, blow };
}

const validGuess = (g, digits) => typeof g === 'string' && g.length === digits && /^\d+$/.test(g) && new Set(g).size === digits;

// 桁数ごとの「ありうる答え」の一覧（CPU が使う）
const ALL_CODES = {};
function allCodes(digits) {
  if (ALL_CODES[digits]) return ALL_CODES[digits];
  const out = [];
  const walk = (cur) => {
    if (cur.length === digits) { out.push(cur); return; }
    for (const d of ALL_DIGITS) if (!cur.includes(d)) walk(cur + d);
  };
  walk('');
  ALL_CODES[digits] = out;
  return out;
}

const clone = (s) => ({ ...s, hist: s.hist.map((h) => h.slice()), pending: s.pending.slice() });

/* ---------- 画面 ---------- */

let entry = { key: null, text: '' }; // 入力中の数字（通信で描き直されても消えないように外に持つ）
let keyHandler = null;
let keyListening = false;

export default {
  id: 'hitblow',
  name: 'ヒット＆ブロー',
  icon: '🔢',
  desc: '隠された数字を、ヒットとブローの手がかりで当てる。みんなで同時に早当て競争',
  ready: true,
  multi: true,
  realtime: true, // 全員が同時に予想を出す
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'digits', label: '桁数', desc: '当てる数字の長さ。4桁のほうが難しい', def: 4, choices: [[3, '3桁'], [4, '4桁']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const digits = rules.digits === 3 ? 3 : 4;
    const answer = shuffle(ALL_DIGITS, mulberry32(seed)).slice(0, digits).join('');
    return { n, digits, answer, round: 1, hist: Array.from({ length: n }, () => []), pending: Array(n).fill(null), winners: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return s.winners === null && s.pending[p] === null; },
  result(s) { return s.winners ? { winner: s.winners[0], winners: s.winners, answer: s.answer, rounds: s.round } : null; },
  cpuDelay() { return 1800; },

  resultText(res, me, pn) {
    const ans = `答えは <b>${res.answer}</b>（${res.rounds}回目）`;
    if (res.winners.includes(me)) {
      const others = res.winners.filter((p) => p !== me);
      return `あなたの勝ち！🎉${others.length ? `（${others.map(pn).join('・')}と同着）` : ''}<br>${ans}`;
    }
    return `${res.winners.map(pn).join('・')}の勝ち！<br>${ans}`;
  },
  phaseText(s, me) {
    const done = s.pending.filter((g) => g !== null).length;
    if (me >= 0 && s.pending[me] !== null) return `${s.round}回目: ほかの人の予想を待っています…（${done}/${s.n}人）`;
    return `${s.round}回目の予想を出してください（${done}/${s.n}人が出した）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'guess' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!this.canAct(s0, m.p) || m.r !== s0.round || !validGuess(m.g, s0.digits)) return null;
    const s = clone(s0);
    s.step += 1;
    s.pending[m.p] = m.g;
    if (s.pending.every((g) => g !== null)) {
      s.pending.forEach((g, p) => s.hist[p].push({ g, ...score(g, s.answer) }));
      const winners = s.pending.map((g, p) => (g === s.answer ? p : -1)).filter((p) => p >= 0);
      if (winners.length) s.winners = winners;
      else {
        s.round += 1;
        s.pending = Array(s.n).fill(null);
      }
    }
    return s;
  },

  // CPU: 自分の結果と食い違わない数から選ぶ（ちゃんと考える）。ただし 4割は、まだ言っていない数から適当に選んで弱める
  cpu(s, p) {
    const codes = allCodes(s.digits);
    const mine = s.hist[p];
    const said = new Set(mine.map((h) => h.g));
    let pool;
    if (Math.random() < 0.4) pool = codes.filter((c) => !said.has(c));
    else pool = codes.filter((c) => mine.every((h) => { const x = score(h.g, c); return x.hit === h.hit && x.blow === h.blow; }));
    if (!pool.length) pool = codes;
    return { t: 'guess', g: pool[Math.floor(Math.random() * pool.length)], r: s.round };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const draw = () => this.render(root, s, o);
    const can = o.canMove;
    const key = `${s.answer}:${s.n}:${s.round}`;
    if (entry.key !== key) entry = { key, text: '' };
    const done = s.winners !== null;

    root.innerHTML = '';
    root.className = 'board hb';

    // ほかの人（ヒット・ブローの数だけ。終わったら予想も見える）
    const opps = document.createElement('div');
    opps.className = 'cc-opps';
    for (let k = me === null ? 0 : 1; k < s.n; k++) {
      const p = ((me ?? 0) + k) % s.n;
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (done && s.winners.includes(p) ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = o.names[p];
      chip.append(name);
      const last = s.hist[p][s.hist[p].length - 1];
      const line = document.createElement('div');
      line.className = 'hb-opp-last';
      line.textContent = last ? `${s.hist[p].length}回: ${done ? last.g + ' ' : ''}${last.hit}H ${last.blow}B` : 'まだ予想なし';
      chip.append(line);
      const tags = [];
      if (!done) tags.push(s.pending[p] !== null ? ['ok', '出した✓'] : ['away', '考え中…']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        chip.append(t);
      }
      opps.append(chip);
    }
    root.append(opps);

    const help = document.createElement('p');
    help.className = 'hb-help';
    help.textContent = `${s.digits}桁・同じ数字は使わない。ヒット(H)＝数字も場所も合っている／ブロー(B)＝数字は合っているが場所が違う`;
    root.append(help);

    if (me === null) {
      if (done) root.append(table(s, s.winners[0], '当てた人の予想'));
      return;
    }

    root.append(table(s, me, 'あなたの予想'));

    if (!can) {
      if (!done) {
        const wait = document.createElement('p');
        wait.className = 'cc-log';
        wait.textContent = `「${s.pending[me]}」を出しました。ほかの人を待っています…`;
        root.append(wait);
      }
      keyHandler = null;
      return;
    }

    // 入力欄とテンキー
    const send = () => {
      if (entry.text.length !== s.digits) return;
      const g = entry.text;
      entry.text = '';
      o.onMove({ t: 'guess', g, r: s.round });
    };
    const type = (d) => { if (entry.text.length < s.digits && !entry.text.includes(d)) { entry.text += d; draw(); } };
    const back = () => { if (entry.text) { entry.text = entry.text.slice(0, -1); draw(); } };

    const slots = document.createElement('div');
    slots.className = 'hb-slots';
    for (let i = 0; i < s.digits; i++) {
      const b = document.createElement('span');
      b.className = 'hb-slot' + (i === entry.text.length ? ' cur' : '');
      b.textContent = entry.text[i] ?? '';
      slots.append(b);
    }
    root.append(slots);

    const pad = document.createElement('div');
    pad.className = 'hb-pad';
    for (const d of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0']) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb-key';
      b.textContent = d;
      b.disabled = entry.text.includes(d) || entry.text.length >= s.digits;
      b.onclick = () => type(d);
      pad.append(b);
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'hb-key del';
    del.textContent = '消す';
    del.disabled = !entry.text;
    del.onclick = back;
    pad.append(del);
    root.append(pad);

    const actions = document.createElement('div');
    actions.className = 'cc-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = 'この数で予想する';
    ok.disabled = entry.text.length !== s.digits;
    ok.onclick = send;
    actions.append(ok);
    root.append(actions);

    // PC ではキーボードでも打てる
    keyHandler = (e) => {
      if (!root.isConnected || !root.classList.contains('hb') || e.target?.tagName === 'INPUT') return;
      if (/^\d$/.test(e.key)) type(e.key);
      else if (e.key === 'Backspace') back();
      else if (e.key === 'Enter') send();
      else return;
      e.preventDefault();
    };
    if (!keyListening) {
      keyListening = true;
      document.addEventListener('keydown', (e) => keyHandler?.(e));
    }
  },
};

function table(s, p, title) {
  const box = document.createElement('div');
  box.className = 'hb-hist';
  const head = document.createElement('div');
  head.className = 'cc-hand-head';
  head.textContent = title;
  box.append(head);
  if (!s.hist[p].length) {
    const none = document.createElement('p');
    none.className = 'hb-none';
    none.textContent = 'まだ予想していません';
    box.append(none);
    return box;
  }
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>回</th><th>予想</th><th>ヒット</th><th>ブロー</th></tr></thead>';
  const body = document.createElement('tbody');
  s.hist[p].forEach((h, i) => {
    const tr = document.createElement('tr');
    if (h.hit === s.digits) tr.className = 'hit-all';
    tr.innerHTML = `<td>${i + 1}</td><td class="hb-g">${h.g}</td><td>${h.hit}</td><td>${h.blow}</td>`;
    body.prepend(tr); // 新しい予想を上に
  });
  t.append(body);
  box.append(t);
  return box;
}
