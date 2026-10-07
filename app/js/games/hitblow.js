// ヒット＆ブロー（数当て）。かくれた「答えの数」を当て合う。2〜10人。
// 答えは 0〜9 の数字を重ならないように並べたもの（桁数は詳細設定で 3 / 4 / 5。最初は4）。
//   5桁は 2026-10-07 本人の決定で足した。答えの作り方は桁数が違うだけで同じなので、3桁・4桁の答えは前と全く同じ。
//   ヒット = 数字も場所も合っている / ブロー = 数字は合っているが場所が違う
// 詳細設定「同じ数字」を「使ってよい」にすると、答えにも予想にも同じ数字が何回も出てよい（2026-10-06 本人の決定）。
//   ブローは、その数字が答えにある個数までしか数えない（マスターマインドと同じ数え方。答え 1123・予想 1111 なら 2ヒット 0ブロー）。
// 遊び方は詳細設定の mode で2つ:
//   turn（順番に当てる・最初）: 1人ずつ順番に予想を出し、予想と結果は全員に見える。最初に当てた人の勝ち。
//     ほかの人の予想もヒントになるので、自分の予想で手がかりを出しすぎない駆け引きになる。
//   race（同時に早当て）: 毎回、全員が予想を1つずつ出し、そろったら一斉に結果が出る。全部ヒットした人が出た回で終わり
//     （同じ回に当てた人が複数いれば同着）。出したばかりの予想は回がそろうまで隠し、結果が出たら全員の予想が見える。
// 手: { p, t: 'guess', g: '0123', r: 何回目か }（race は回、turn は通しの予想の番号）。r で、同じ手が2回来ても2回目は反則になる。
// 詳細設定「答え」（2026-10-06 本人の決定）で2つ:
//   same（みんな同じ・最初）: 全員で同じ答えを当てる。答えは対局の種（seed）から作る。
//   own（自分で決める）: 対局の始めに全員が同時に自分の答えを決め（手 { p, t: 'secret', g }。2回目は反則）、全員が決めたら当て始める。
//     各自は次の席の人（p+1、最後の人は 0）の答えを当てる。2人なら当て合い。CPU（部屋を出た人の代わりも）の答えは種から作った auto を使う。
//     勝ち負けは mode のとおり（最初に自分の相手の数を当てた人の勝ち／同じ回なら同着）。
//     画面には自分の答えだけ出し、決着したら全員の答えを見せる（全員の端末が知っている簡易の隠し方）。

import { mulberry32, shuffle } from './util.js';

const ALL_DIGITS = '0123456789'.split('');

// 同じ数字があるときも数えられるよう、ブローは「数字ごとに 予想と答えの少ないほうの個数」の合計からヒットを引く
// （CPU は5桁・同じ数字ありで10万通りの答えを何度も比べるので、数える箱は作り直さずに使い回す）
const cg = new Int8Array(10);
const ca = new Int8Array(10);
export function score(g, ans) {
  let hit = 0;
  cg.fill(0);
  ca.fill(0);
  for (let i = 0; i < g.length; i++) {
    const x = g.charCodeAt(i) - 48;
    const y = ans.charCodeAt(i) - 48;
    if (x === y) hit++;
    cg[x]++;
    ca[y]++;
  }
  let common = 0;
  for (let d = 0; d < 10; d++) common += Math.min(cg[d], ca[d]);
  return { hit, blow: common - hit };
}

const validGuess = (g, digits, dup) => typeof g === 'string' && g.length === digits && /^\d+$/.test(g) && (dup || new Set(g).size === digits);

// 桁数ごとの「ありうる答え」の一覧（CPU が使う）
const ALL_CODES = {};
function allCodes(digits, dup) {
  const k = `${digits}:${dup}`;
  if (ALL_CODES[k]) return ALL_CODES[k];
  const out = [];
  const walk = (cur) => {
    if (cur.length === digits) { out.push(cur); return; }
    for (const d of ALL_DIGITS) if (dup || !cur.includes(d)) walk(cur + d);
  };
  walk('');
  ALL_CODES[k] = out;
  return out;
}

const clone = (s) => ({ ...s, hist: s.hist.map((h) => h.slice()), pending: s.pending.slice(), ...(s.secrets ? { secrets: s.secrets.slice() } : {}) });

// 「答え: 自分で決める」のとき、p が当てる相手（次の席の人）と、p の予想を比べる答え
const own = (s) => s.secret === 'own';
const targetOf = (s, p) => (p + 1) % s.n;
const answerFor = (s, p) => (own(s) ? s.secrets[targetOf(s, p)] : s.answer);

/* ---------- 画面 ---------- */

let entry = { key: null, text: '' }; // 入力中の数字（通信で描き直されても消えないように外に持つ）
let keyHandler = null;
let keyListening = false;

export default {
  id: 'hitblow',
  name: 'ヒット＆ブロー',
  icon: '🔢',
  desc: '隠された数字を、ヒットとブローの手がかりで当てる。みんなの予想も見ながら先に当てた人の勝ち',
  ready: true,
  multi: true,
  realtime: true, // 「同時に早当て」では全員が同時に予想を出す
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'mode', label: '遊び方', desc: '順番に: 1人ずつ予想し、全員の予想が見える／同時に: 全員が一斉に予想する早当て', def: 'turn', choices: [['turn', '順番に当てる'], ['race', '同時に早当て']] },
    { key: 'digits', label: '桁数', desc: '当てる数字の長さ。長いほど難しい', def: 4, choices: [[3, '3桁'], [4, '4桁'], [5, '5桁']] },
    { key: 'dup', label: '同じ数字', desc: '使ってよい: 答えにも予想にも同じ数字が何回も出てくる（例 1123）。難しくなる', def: 'off', choices: [['off', '使わない'], ['on', '使ってよい']] },
    { key: 'secret', label: '答え', desc: '自分で決める: 始めに各自が答えの数を決め、次の席の人の数を当てる（2人なら当て合い）', def: 'same', choices: [['same', 'みんな同じ'], ['own', '自分で決める']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const digits = rules.digits === 3 || rules.digits === 5 ? rules.digits : 4;
    const mode = rules.mode === 'race' ? 'race' : 'turn';
    const dup = rules.dup === 'on';
    const rng = mulberry32(seed);
    const make = () => (dup
      ? Array.from({ length: digits }, () => ALL_DIGITS[Math.floor(rng() * 10)]).join('')
      : shuffle(ALL_DIGITS, rng).slice(0, digits).join(''));
    const answer = make();
    const s = {
      n, digits, mode, dup, answer, round: 1, turn: 0, log: [],
      hist: Array.from({ length: n }, () => []), pending: Array(n).fill(null), winners: null, step: 0,
    };
    if (rules.secret !== 'own') return s;
    // 自分で決める: 決めるまでは setting。auto は CPU（部屋を出た人の代わりも）が使う答え（全員の端末で同じになるよう種から作る）
    return { ...s, answer: null, secret: 'own', setting: true, secrets: Array(n).fill(null), auto: Array.from({ length: n }, make) };
  },

  turn(s) { return s.mode === 'turn' && s.winners === null && !s.setting ? s.turn : null; },
  canAct(s, p) {
    if (s.winners !== null) return false;
    if (s.setting) return s.secrets[p] === null;
    return s.mode === 'turn' ? s.turn === p : s.pending[p] === null;
  },
  result(s) {
    if (!s.winners) return null;
    return { winner: s.winners[0], winners: s.winners, answer: s.answer, rounds: s.round, ...(own(s) ? { secrets: s.secrets } : {}) };
  },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b) { return !a.setting && (b.mode === 'turn' || b.round > a.round) ? 'question' : 'pop'; }, // 結果が出たら question
  cpuDelay() { return 1200; },

  resultText(res, me, pn) {
    // 自分で決めたときは全員の答えを見せる
    const ans = res.secrets
      ? `答え: ${res.secrets.map((g, p) => `${pn(p)} <b>${g}</b>`).join('・')}（${res.rounds}回目）`
      : `答えは <b>${res.answer}</b>（${res.rounds}回目）`;
    if (res.winners.includes(me)) {
      const others = res.winners.filter((p) => p !== me);
      return `あなたの勝ち！🎉${others.length ? `（${others.map(pn).join('・')}と同着）` : ''}<br>${ans}`;
    }
    return `${res.winners.map(pn).join('・')}の勝ち！<br>${ans}`;
  },
  phaseText(s, me) {
    if (s.setting) {
      const set = s.secrets.filter((g) => g !== null).length;
      if (me < 0) return `みんなが答えの数を決めています…（${set}/${s.n}人が決めた）`;
      if (s.secrets[me] !== null) return `ほかの人が答えを決めるのを待っています…（${set}/${s.n}人）`;
      return `あなたの答えの数を決めてください（${set}/${s.n}人が決めた）`;
    }
    const done = s.pending.filter((g) => g !== null).length;
    if (me >= 0 && s.pending[me] !== null) return `${s.round}回目: ほかの人の予想を待っています…（${done}/${s.n}人）`;
    return `${s.round}回目の予想を出してください（${done}/${s.n}人が出した）`;
  },

  apply(s0, m) {
    if (!m || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    // 自分で決める: 答えを決める手。決めている間だけ・1人1回（同じ手が2回来たら、2回目は決め済みなので反則）
    if (m.t === 'secret') {
      if (!s0.setting || !this.canAct(s0, m.p) || !validGuess(m.g, s0.digits, s0.dup)) return null;
      const s = clone(s0);
      s.step += 1;
      s.secrets[m.p] = m.g;
      if (s.secrets.every((g) => g !== null)) s.setting = false;
      return s;
    }
    if (m.t !== 'guess' || s0.setting) return null;
    if (!this.canAct(s0, m.p) || m.r !== s0.round || !validGuess(m.g, s0.digits, s0.dup)) return null;
    const s = clone(s0);
    s.step += 1;
    if (s.mode === 'turn') {
      const ans = answerFor(s, m.p);
      const x = { g: m.g, ...score(m.g, ans) };
      s.hist[m.p].push(x);
      s.log = [...s.log, { p: m.p, ...x }];
      if (m.g === ans) s.winners = [m.p];
      else { s.round += 1; s.turn = (s.turn + 1) % s.n; }
      return s;
    }
    s.pending[m.p] = m.g;
    if (s.pending.every((g) => g !== null)) {
      s.pending.forEach((g, p) => s.hist[p].push({ g, ...score(g, answerFor(s, p)) }));
      const winners = s.pending.map((g, p) => (g === answerFor(s, p) ? p : -1)).filter((p) => p >= 0);
      if (winners.length) s.winners = winners;
      else {
        s.round += 1;
        s.pending = Array(s.n).fill(null);
      }
    }
    return s;
  },

  // CPU: 自分の結果と食い違わない数から選ぶ（ちゃんと考える）。ただし 4割は、まだ言っていない数から適当に選んで弱める。
  // 順番に当てる遊び方では、ほかの人の結果は1つずつ3割の見込みでしか使わず、5割は適当に選ぶ
  // （全員の結果を全部使うと、人が2〜3回予想するうちに当ててしまうため。試算でちゃんと考える人に3割ほど勝つ強さ）
  // 答えを自分で決めるときは、決める番では種から作った答え（auto）を出す。当てるときは考え方は同じだが、
  // ほかの人の結果は別の人の答えに対するものなので使わず、自分の結果と自分の言った数だけを見る
  cpu(s, p) {
    if (s.setting) return { t: 'secret', g: s.auto[p] };
    const codes = allCodes(s.digits, !!s.dup);
    const turn = s.mode === 'turn';
    const mine = own(s) ? s.hist[p] : turn ? s.log.filter((h) => h.p === p || Math.random() < 0.3) : s.hist[p];
    const said = new Set((turn && !own(s) ? s.log : mine).map((h) => h.g));
    let pool;
    if (Math.random() < (turn ? 0.5 : 0.4)) pool = codes.filter((c) => !said.has(c));
    else pool = codes.filter((c) => !said.has(c) && mine.every((h) => { const x = score(h.g, c); return x.hit === h.hit && x.blow === h.blow; }));
    if (!pool.length) pool = codes;
    return { t: 'guess', g: pool[Math.floor(Math.random() * pool.length)], r: s.round };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const draw = () => this.render(root, s, o);
    const can = o.canMove;
    // 答えを決める間と当て始めてからで、入力中の数字を分ける
    const key = `${s.answer ?? s.auto.join('')}:${s.n}:${s.round}:${s.setting ? 'set' : 'guess'}`;
    if (entry.key !== key) entry = { key, text: '' };
    const done = s.winners !== null;
    const nameOf = (p) => (p === me ? 'あなた' : o.names[p]);

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
      line.textContent = last ? `${s.hist[p].length}回: ${last.g} ${last.hit}H ${last.blow}B` : 'まだ予想なし';
      chip.append(line);
      if (own(s)) { // だれの数を当てているか。終わったらその人の答えも
        const target = document.createElement('div');
        target.className = 'hb-opp-last';
        target.textContent = done ? `答え ${s.secrets[p]}` : `→ ${nameOf(targetOf(s, p))}の数`;
        chip.append(target);
      }
      const tags = [];
      if (!done && s.setting) tags.push(s.secrets[p] !== null ? ['ok', '決めた✓'] : ['away', '答えを考え中…']);
      if (!done && !s.setting && s.mode === 'race') tags.push(s.pending[p] !== null ? ['ok', '出した✓'] : ['away', '考え中…']);
      if (!done && !s.setting && s.mode === 'turn' && s.turn === p) tags.push(['ok', '予想中…']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
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
    help.textContent = s.dup
      ? `${s.digits}桁・同じ数字も使える。ヒット(H)＝数字も場所も合っている／ブロー(B)＝数字は合っているが場所が違う（答えにある個数まで）`
      : `${s.digits}桁・同じ数字は使わない。ヒット(H)＝数字も場所も合っている／ブロー(B)＝数字は合っているが場所が違う`;
    root.append(help);
    if (own(s)) root.append(ownInfo(s, me, nameOf));

    // 予想の一覧（順番には全員の予想を1つの表に。同時には自分の表と、ほかの人の表）。答えを決めている間は出さない
    // 答えを自分で決めるときは、だれの数を当てているかも書く
    const aim = (p) => (own(s) ? `（${nameOf(targetOf(s, p))}の数）` : '');
    if (!s.setting && s.mode === 'turn') root.append(logTable(s, nameOf, me));
    else if (!s.setting) {
      if (me !== null) root.append(table(s, me, `あなたの予想${aim(me)}`));
      const others = document.createElement('div');
      others.className = 'hb-others';
      for (let k = me === null ? 0 : 1; k < s.n; k++) {
        const p = ((me ?? 0) + k) % s.n;
        others.append(table(s, p, `${o.names[p]}の予想${aim(p)}`, true));
      }
      root.append(others);
    }
    if (me === null) return;

    if (!can) {
      if (!done) {
        const wait = document.createElement('p');
        wait.className = 'cc-log';
        if (s.setting) wait.textContent = 'ほかの人が答えを決めるのを待っています…';
        else wait.textContent = s.mode === 'turn' ? `${o.names[s.turn]}が予想しています…` : `「${s.pending[me]}」を出しました。ほかの人を待っています…`;
        root.append(wait);
      }
      keyHandler = null;
      return;
    }

    // 入力欄とテンキー（答えを決めるときも同じものを使う）
    const send = () => {
      if (entry.text.length !== s.digits) return;
      const g = entry.text;
      entry.text = '';
      o.onMove(s.setting ? { t: 'secret', g } : { t: 'guess', g, r: s.round });
    };
    const type = (d) => { if (entry.text.length < s.digits && (s.dup || !entry.text.includes(d))) { entry.text += d; draw(); } };
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
    for (const d of ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']) { // 0〜4 を1段目、5〜9 を2段目。右端に縦長の「消す」
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hb-key';
      b.textContent = d;
      b.disabled = (!s.dup && entry.text.includes(d)) || entry.text.length >= s.digits;
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
    ok.textContent = s.setting ? 'この数を答えにする' : 'この数で予想する';
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

// 答えを自分で決めるときの、自分の答えと当てる相手（ほかの人の答えは出さない。観戦の人には組み合わせだけ）
function ownInfo(s, me, nameOf) {
  const box = document.createElement('div');
  if (me === null) {
    const p = document.createElement('p');
    p.className = 'hb-help';
    p.textContent = s.n === 2
      ? '2人で相手の答えの数を当て合います'
      : `それぞれ次の人の数を当てます: ${Array.from({ length: s.n }, (_, q) => `${nameOf(q)} → ${nameOf(targetOf(s, q))}`).join('、')}`;
    box.append(p);
    return box;
  }
  const guesser = nameOf((me + s.n - 1) % s.n); // 自分の数を当てる人
  if (s.secrets[me] === null) {
    const p = document.createElement('p');
    p.className = 'hb-help';
    p.textContent = `ここで決めた数を ${guesser}が当てます。あなたは ${nameOf(targetOf(s, me))}の数を当てます。`;
    box.append(p);
    return box;
  }
  box.className = 'hb-hist';
  const head = document.createElement('div');
  head.className = 'cc-hand-head';
  head.textContent = `あなたの答え（${guesser}が当てます）`;
  const g = document.createElement('span');
  g.className = 'hb-g';
  g.textContent = ` ${s.secrets[me]}`;
  head.append(g);
  box.append(head);
  if (!s.setting) {
    const p = document.createElement('p');
    p.className = 'hb-none';
    p.textContent = `あなたは ${nameOf(targetOf(s, me))}の数を当てます`;
    box.append(p);
  }
  return box;
}

// 順番に当てる遊び方の、全員の予想の表（1回目から下へ並べる）
function logTable(s, nameOf, me) {
  const box = document.createElement('div');
  box.className = 'hb-hist';
  const head = document.createElement('div');
  head.className = 'cc-hand-head';
  head.textContent = 'みんなの予想';
  box.append(head);
  if (!s.log.length) {
    const none = document.createElement('p');
    none.className = 'hb-none';
    none.textContent = 'まだだれも予想していません';
    box.append(none);
    return box;
  }
  const t = document.createElement('table');
  t.innerHTML = '<thead><tr><th>回</th><th>だれ</th><th>予想</th><th>ヒット</th><th>ブロー</th></tr></thead>';
  const body = document.createElement('tbody');
  s.log.forEach((h, i) => {
    const tr = document.createElement('tr');
    if (h.hit === s.digits) tr.className = 'hit-all';
    else if (h.p === me) tr.className = 'mine';
    tr.innerHTML = `<td>${i + 1}</td><td class="hb-who"></td><td class="hb-g">${h.g}</td><td>${h.hit}</td><td>${h.blow}</td>`;
    const who = tr.querySelector('.hb-who');
    if (own(s)) { // だれの数を当てたか（長くなるので折り返してよい）
      who.textContent = `${nameOf(h.p)}→${nameOf(targetOf(s, h.p))}`;
      who.style.whiteSpace = 'normal';
      who.style.maxWidth = '10em';
    } else who.textContent = nameOf(h.p);
    body.append(tr);
  });
  t.append(body);
  box.append(t);
  return box;
}

function table(s, p, title, small = false) {
  const box = document.createElement('div');
  box.className = 'hb-hist' + (small ? ' small' : '');
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
    // 5桁の小さい表は、字の間を詰めて「ヒット」「ブロー」の見出しが2行に割れないようにする（スマホ幅で2列に並ぶため）
    if (small && s.digits >= 5) tr.querySelector('.hb-g').style.letterSpacing = '.04em';
    body.append(tr); // 1回目から下へ並べる
  });
  t.append(body);
  box.append(t);
  return box;
}
