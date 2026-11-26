// かぶったら0点。全員がこっそり数字を1つ選び、そろって見せる。ほかの人とかぶらなかった数字だけが、その数の点になる。3〜10人・足りない分は CPU。
// 2026-11-02 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 使う数字は人数で自動で決める: 5人までは1〜5、6人以上は1〜人数（10人で1〜5だとほとんどかぶるため）。
//   - 決まった回数を遊んで合計点で勝負（最初は8回。詳細設定で5・8・12回）。
//   - 1回15秒。選ばなかった人はその回0点。
// Claude の判断:
//   - 数字を押すと選んだだけ（何度でも選び直せる）で、「これで決める」を押すと決まる（決めたら変えられない）。読み合いのゲームなので押し間違いで決まらないように。
//     決めた数字は全員の端末が知っている（手札と同じ簡易の隠し方）。画面には「✔ 決めた」だけを出す。
//   - 全員が決めたら0.8秒で見せる。見せる間は3.5秒（だれが何を出したかを読む時間）。
//   - 同じ点の人は同じ順位（成績表は合計点で並べる）。
//   - CPU は 1.5〜7秒で決める。大きい数ほど少し選びやすい（大きい数は点が多いがかぶりやすい、を人がやりがちなまね）。読み合いはしない。
// 2026-11-02 の32回目の案（本人がおすすめどおり選んだ。分かれ目は Claude の判断）: 詳細設定「前と同じ数字」（出せる（最初）・出せない。鍵は norepeat）。
//   出せないでは、前の回に自分が決めた数字をその回は選べない（ボタンを押せなくして 🚫 を付ける。前の回に決めなかった人は全部選べる）。CPU もよける。
//   前の回の数字は局面の log から取るので、局面の形は「出せる」のときと同じ。
// 2026-11-24 の46回目の案（本人が選んだ。分かれ目は Claude の判断）: 詳細設定「点をもらう人」（かぶらなかった全員（最初）・いちばん大きい人だけ。鍵は top）。
//   いちばん大きい人だけでは、かぶらなかった数字のうちいちばん大きい数字を出した1人だけがその数の点をもらい、ほかは0点。かぶらなかった人がいなければだれも点なし。
//   局面の形は「全員」のときと同じ（点の数え方だけが変わる）。見せる場面では、かぶらなかったが小さかった数字に「届かず 0点」と出す。CPU の選び方は変えない。
// 2026-11-26 の48回目の案（本人が選んだ。案の名前は「持ち越し」。分かれ目は Claude の判断）: 詳細設定「かぶった点」（消える（最初）・持ち越す。鍵は carry）。
//   持ち越すでは、かぶった数字ごとに、その数（かぶった人数によらず1つ分。5がかぶったら5点）を場に残す（局面の pot。数字の番号で引く）。
//   あとの回でその数字をかぶらずに出して点をもらった人が、その数の点に場の点を足してまとめてもらい、場は0に戻る。だれももらわなければ残り続け、
//   またかぶれば積み上がる。最後の回のあとに残った点はなくなる。「いちばん大きい人だけ」と一緒のときは、点をもらう1人を今までどおり数字の大きさで決め、
//   その1人だけが場の点ももらう（届かなかった人の数字の場は残る）。数字のボタンに場の点（+5 など）を出す。CPU は場の点も足した大きさで少し選びやすくする。
//   消えるのときは局面に pot を持たない（前と全く同じ形。tools/test-logic.mjs が見ている）。
// 進行（ホストが時間を計って p = -1 の手を足す）: ready → next → open → close → shown → next … → end
// 手: { p: -1, t: 'next' | 'close' } / { p, t: 'pick', r: 何回目（0 から）, v: 数字 }
//   r が今の回と同じで、その人がまだ決めていないときだけ受け付けるので、同じ手が2回届いても2回目は反則になる。

import { flipTimes, flipCard, FLIP_AFTER, since, scoreChips, leaders, winnersText, timeBar } from './party.js';

const ROUNDS = [[5, '5回'], [8, '8回'], [12, '12回']];
const roundsOf = (r) => (ROUNDS.some(([v]) => v === r.rounds) ? r.rounds : 8);
export const maxOf = (n) => Math.max(5, n);
const LIMIT = 15000;
const READY_MS = 3000;
const SHOWN_MS = 3500;
const GRACE_MS = 800;

// 1回ぶんの点: かぶらなかった数字だけがその数の点。決めなかった人（null）は0点。top のときは、かぶらなかった中でいちばん大きい数字の人だけ
export function scoreRound(picks, top = false) {
  const pts = picks.map((v) => (v !== null && picks.filter((w) => w === v).length === 1 ? v : 0));
  if (!top) return pts;
  const best = Math.max(0, ...pts);
  return pts.map((v) => (v === best ? v : 0));
}

// 持ち越すのとき: 1回ぶんの点 pts に場の点を足し、場を進める。返り値は { pts: 場の点を足した点, bonus: もらった場の点, pot: 次の場 }
export function carryRound(picks, pts, pot) {
  const next = pot.slice();
  const bonus = pts.map((v, p) => (v > 0 ? next[picks[p]] : 0));
  pts.forEach((v, p) => { if (v > 0) next[picks[p]] = 0; });
  for (const v of new Set(picks)) if (v !== null && picks.filter((w) => w === v).length > 1) next[v] += v;
  return { pts: pts.map((v, p) => v + bonus[p]), bonus, pot: next };
}

// その回に選べない数字（「前と同じ数字」が出せないのときの、前の回に自分が決めた数字）。無ければ null
export function banOf(s, p) {
  if (!s.rules.norepeat || s.r < 1) return null;
  return s.log[s.r - 1]?.picks[p] ?? null;
}

const rKey = (s, r = s.r) => `kaburi:${s.seed}:${r}`;
const clone = (s) => ({ ...s, scores: s.scores.slice(), picks: s.picks.slice(), ...(s.pot ? { pot: s.pot.slice() } : {}) });
const potOf = (s, v) => s.pot?.[v] ?? 0; // 数字 v の場に残っている点
const cpuPlan = new Map();
const chosen = new Map(); // この端末で選んだ（まだ決めていない）数字。描き直しても消えないように回ごとに覚える

export default {
  id: 'kaburi',
  name: 'かぶったら0点',
  icon: '🙅',
  desc: 'こっそり数字を選ぶ。ほかの人とかぶらなければ、その数が点になる',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'rounds', label: '回数', desc: '1回の対局で数字を出す回数', def: 8, choices: ROUNDS },
    { key: 'norepeat', label: '前と同じ数字', desc: '出せないにすると、前の回に自分が出した数字はその回に選べない', def: false, choices: [[false, '出せる'], [true, '出せない']] },
    { key: 'top', label: '点をもらう人', desc: 'いちばん大きい人だけにすると、かぶらなかった数字のうちいちばん大きい数字を出した1人だけが点をもらう', def: false, choices: [[false, 'かぶらなかった全員'], [true, 'いちばん大きい人だけ']] },
    { key: 'carry', label: 'かぶった点', desc: '持ち越すにすると、かぶった数字の点が場に残り、あとの回でその数字で点をもらった人がまとめてもらう', def: false, choices: [[false, '消える'], [true, '持ち越す']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { rounds: 8, ...rules };
    const s = {
      n, seed, rules: r, total: roundsOf(r), max: maxOf(n), r: -1, phase: 'ready',
      picks: Array(n).fill(null), scores: Array(n).fill(0), last: null, log: [], step: 0,
    };
    if (r.carry === true) s.pot = Array(s.max + 1).fill(0); // 消えるのときは持たない（前と全く同じ形）
    return s;
  },

  turn() { return null; },
  canAct(s, p) { return s.phase === 'open' && s.picks[p] === null; },
  result(s) {
    if (s.phase !== 'end') return null;
    return { winners: leaders(s.scores), scores: s.scores };
  },
  sound(a, b, m, me) {
    if (m.p === -1) return m.t === 'next' ? 'question' : m.t === 'close' ? 'card' : null;
    return m.p === me ? 'chip' : null;
  },
  resultText(res, me, pn) { return winnersText(res.winners, me, pn); },
  phaseText(s) {
    if (s.phase === 'ready') return 'まもなく始まります…';
    return `${s.r + 1}回目 / ${s.total}`;
  },

  referee(s) {
    if (s.phase === 'ready') return { key: 'ready', ms: READY_MS, move: { t: 'next' } };
    if (s.phase === 'open') {
      if (s.picks.every((v) => v !== null)) return { key: 'all' + s.r, ms: GRACE_MS, move: { t: 'close' } };
      return { key: 'open' + s.r, ms: LIMIT + 1000, move: { t: 'close' } };
    }
    if (s.phase === 'shown') return { key: 'shown' + s.r, ms: SHOWN_MS, move: { t: 'next' } };
    return null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t === 'next' && (s0.phase === 'ready' || s0.phase === 'shown')) {
        const s = clone(s0);
        s.step += 1;
        if (s.r + 1 >= s.total) { s.phase = 'end'; return s; }
        s.r += 1;
        s.phase = 'open';
        s.picks = Array(s.n).fill(null);
        return s;
      }
      if (m.t === 'close' && s0.phase === 'open') {
        const s = clone(s0);
        s.step += 1;
        s.phase = 'shown';
        let pts = scoreRound(s.picks, !!s.rules.top);
        let bonus = null;
        if (s.pot) ({ pts, bonus, pot: s.pot } = carryRound(s.picks, pts, s.pot));
        pts.forEach((v, p) => { s.scores[p] += v; });
        s.last = bonus ? { pts, bonus } : { pts };
        s.log = [...s0.log, bonus ? { picks: s.picks.slice(), pts, bonus } : { picks: s.picks.slice(), pts }];
        return s;
      }
      return null;
    }
    if (m.t !== 'pick' || s0.phase !== 'open' || m.r !== s0.r || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n || s0.picks[m.p] !== null) return null;
    if (!Number.isInteger(m.v) || m.v < 1 || m.v > s0.max || m.v === banOf(s0, m.p)) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.v;
    return s;
  },

  cpuDelay(s) { return s.phase === 'open' ? 200 : 500; },
  cpu(s, p) {
    if (s.phase !== 'open' || s.picks[p] !== null) return null;
    const key = rKey(s) + ':' + p;
    let plan = cpuPlan.get(key);
    if (!plan) {
      const ban = banOf(s, p);
      const w = [...Array(s.max)].map((_, i) => (i + 1 === ban ? 0 : Math.sqrt(i + 1 + potOf(s, i + 1)))); // 大きい数ほど少し選びやすい（場の点も足す）
      let x = Math.random() * w.reduce((a, b) => a + b, 0);
      let v = 1;
      while (v < s.max && (x > w[v - 1] || w[v - 1] === 0)) { x -= w[v - 1]; v += 1; }
      plan = { at: 1500 + Math.random() * 5500, v };
      cpuPlan.set(key, plan);
      if (cpuPlan.size > 300) cpuPlan.delete(cpuPlan.keys().next().value);
    }
    return since(rKey(s)) >= plan.at ? { t: 'pick', r: s.r, v: plan.v } : null;
  },

  render(root, s, o) {
    const me = o.me >= 0 && !o.watching ? o.me : null;
    const won = s.phase === 'end' ? leaders(s.scores) : [];
    const extra = (p) => {
      if (s.phase === 'open') return s.picks[p] !== null ? '<span class="pt-ok">✔ 決めた</span>' : '';
      if (s.phase !== 'shown' || !s.last) return '';
      const v = s.picks[p];
      if (v === null) return '<span class="pt-ng flip-after">―</span>';
      if (s.last.pts[p]) return `<span class="pt-ok flip-after">${v} → +${s.last.pts[p]}</span>`;
      return `<span class="pt-ng flip-after">${v} ${s.picks.filter((x) => x === v).length > 1 ? 'かぶり' : '届かず'}</span>`; // 札が返ってから出す（一斉に裏返す。2026-11-16）
    };
    root.innerHTML = '';
    root.className = 'board kj kb';
    const wrap = document.createElement('div');
    wrap.className = 'kj-wrap';
    wrap.append(scoreChips(o, s.scores, { won, extra, steady: true, gainDelay: s.phase === 'shown' ? FLIP_AFTER : 0 }));
    root.append(wrap);
    if (s.phase === 'end') { wrap.append(this.review(s, me, o)); return; }
    const card = document.createElement('div');
    card.className = 'kj-card';
    wrap.append(card);
    if (s.phase === 'ready') {
      card.innerHTML = `<div class="kj-word small">よーい…</div><div class="kj-sub">1〜${s.max} から1つ選ぼう。${s.rules.top ? 'かぶらなかった中でいちばん大きい人だけ、その数が点' : 'ほかの人とかぶらなければ、その数が点'}・全${s.total}回${s.rules.norepeat ? '・前の回と同じ数字は出せない' : ''}${s.pot ? '・かぶった点は場に残り、あとでその数字で点をもらった人のもの' : ''}</div>`;
      return;
    }
    const key = rKey(s);
    if (s.phase === 'shown') {
      // 一斉に裏返して見せる（2026-11-16 の UI・UX の7回目。本人の選択）: 全員の札を同時に返し、かぶった札は揺らす。数字ごとのまとめはそのあとに出す
      flipTimes(root, key + ':shown', o.fresh);
      const row = document.createElement('div');
      row.className = 'flip-row';
      s.picks.forEach((v, p) => row.append(flipCard(v === null ? '―' : String(v), p === me ? 'あなた' : o.names[p], v !== null && s.picks.filter((x) => x === v).length > 1)));
      card.append(row);
      const list = this.reveal(s, me, o);
      list.classList.add('flip-after');
      card.append(list);
      return;
    }
    since(key);
    card.append(timeBar(key, LIMIT, { secs: true }));
    const mine = me !== null ? s.picks[me] : null;
    const can = me !== null && o.canMove && mine === null && since(key) < LIMIT;
    const ck = key + ':' + me;
    const ban = me !== null ? banOf(s, me) : null;
    const sel = mine ?? (chosen.get(ck) === ban ? null : chosen.get(ck)) ?? null;
    const pad = document.createElement('div');
    pad.className = 'kb-pad' + (s.max > 5 ? ' many' : '');
    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'btn primary kb-go';
    const paint = (v) => {
      pad.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', Number(b.dataset.v) === v));
      go.disabled = !can || v === null;
      go.textContent = mine !== null ? `「${mine}」で決めた` : v === null ? '数字を選んでね' : `「${v}」で決める`;
    };
    for (let v = 1; v <= s.max; v++) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'kb-num';
      b.dataset.v = String(v);
      b.textContent = v === ban ? `🚫${v}` : String(v);
      if (v === ban) b.title = '前の回に出した数字';
      if (potOf(s, v) > 0) { // 持ち越すのとき: 場に残っている点
        const pot = document.createElement('small');
        pot.className = 'kb-pot';
        pot.textContent = `+${potOf(s, v)}`;
        // 「いちばん大きい人だけ」と一緒のときは、1人だけで出しても点をもらえるとは限らないので言い方を変える（2026-11-26 の Codex の点検のあと本人が推奨を承認）
        b.title = `場に${potOf(s, v)}点。${s.rules.top ? 'この数字で点をもらえれば' : '1人だけで出すと'} ${v + potOf(s, v)}点`;
        b.append(pot);
      }
      b.disabled = !can || v === ban;
      // 指が触れた瞬間に選ぶ（click を待つと、ほかの人や CPU の手で作り直されたときに押したのが消える。ビンゴと同じ）
      b.onpointerdown = b.onclick = (e) => {
        if (!can || v === ban) return;
        e.preventDefault();
        chosen.set(ck, v);
        if (chosen.size > 100) chosen.delete(chosen.keys().next().value);
        paint(v);
      };
      pad.append(b);
    }
    go.onpointerdown = go.onclick = (e) => {
      const v = chosen.get(ck);
      if (!can || !v || go.dataset.sent || since(key) >= LIMIT) return;
      e.preventDefault();
      go.dataset.sent = '1';
      go.disabled = true;
      o.onMove({ t: 'pick', r: s.r, v });
    };
    paint(sel);
    wrap.append(pad, go);
    const note = document.createElement('p');
    note.className = 'cc-log';
    if (me === null) note.textContent = '観戦中';
    else if (mine !== null) note.textContent = 'ほかの人が決めるのを待っています…';
    wrap.append(note);
  },

  // 見せる場面: 数字ごとに出した人を並べ、かぶった数字は打ち消す
  reveal(s, me, o) {
    const box = document.createElement('div');
    box.className = 'kb-reveal';
    for (let v = s.max; v >= 1; v--) {
      const who = s.picks.map((x, p) => (x === v ? p : -1)).filter((p) => p >= 0);
      if (!who.length) continue;
      const row = document.createElement('div');
      const got = s.last?.pts[who[0]] > 0;
      row.className = 'kb-row' + (who.length > 1 ? ' hit' : got ? ' ok' : ' low');
      const num = document.createElement('span');
      num.className = 'kb-v';
      num.textContent = String(v);
      const names = document.createElement('span');
      names.className = 'kb-who';
      names.textContent = who.map((p) => (p === me ? 'あなた' : o.names[p])).join('・');
      const tag = document.createElement('span');
      tag.className = 'kb-tag';
      const bonus = s.last?.bonus?.[who[0]] ?? 0;
      tag.textContent = who.length > 1 ? (s.pot ? `かぶり 0点（場に +${v}）` : 'かぶり 0点') : got ? (bonus ? `+${v}点 ＋場の${bonus}点` : `+${v}点`) : '届かず 0点';
      row.append(num, names, tag);
      box.append(row);
    }
    const none = s.picks.map((x, p) => (x === null ? p : -1)).filter((p) => p >= 0);
    if (none.length) {
      const t = document.createElement('div');
      t.className = 'kj-sub';
      t.textContent = `決めなかった人: ${none.map((p) => (p === me ? 'あなた' : o.names[p])).join('・')}（0点）`;
      box.append(t);
    }
    return box;
  },

  review(s, me, o) {
    const box = document.createElement('details');
    box.className = 'kj-review mk-review';
    box.open = true;
    const sum = document.createElement('summary');
    sum.textContent = `📝 ふりかえり（全${s.log.length}回）`;
    const list = document.createElement('ol');
    s.log.forEach((x, r) => {
      const li = document.createElement('li');
      const n = document.createElement('span');
      n.className = 'mk-rv-n';
      n.textContent = String(r + 1);
      const body = document.createElement('span');
      body.className = 'kb-rv';
      body.textContent = x.picks.map((v, p) => `${p === me ? 'あなた' : o.names?.[p] ?? ''} ${v ?? '―'}${x.pts[p] ? '⭕' : ''}`).join('　');
      li.append(n, body);
      list.append(li);
    });
    box.append(sum, list);
    return box;
  },
};
