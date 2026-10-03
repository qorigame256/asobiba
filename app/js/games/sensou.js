// 戦争（両手の指で遊ぶもの。「割り箸」とも呼ばれる）。2〜6人。
// 全員、両手とも指1本から始める。順番に、自分の手（指が1本以上）で、ほかの人の手（指が1本以上）をタッチする。
// タッチされた手は、タッチした手の本数だけ指が増える。ちょうど5本になった手は消える（0本）。
//   5本を超えたら、超えた分の本数になる（例: 4本に3本でタッチ → 2本）。
//   （本人の決定・2026-10-03。前は詳細設定で「5本以上で消える」と選べたが、この形に固定した）
// 「分ける」（詳細設定でオン・オフ）: 自分の番に、両手の合計を変えずに左右へ配り直す。消えた手にも配れる。
//   左右を入れ替えただけの形や、今と同じ形にはできない。1本の手は4本まで。分けて手を0本にはできない（自分で消すのは不可。Claude の判断）。
// 両手とも消えた人は負けて抜ける。最後に残った1人の勝ち。順位は抜けた順の逆。
// 決着が付かずに続くことがあるので、手数が 人数×40 に達したら引き分けにする（Claude の判断。変えるなら本人に確認）。
// 手: { p, t: 'atk', from: 自分の手 0左|1右, to: 相手の番号, hand: 相手の手 0|1 } / { p, t: 'split', h: [左, 右] }

const MAX_FINGERS = 4;
const LIMIT_PER_PLAYER = 40;
const HAND_NAME = ['左手', '右手'];

const aliveP = (s, p) => s.hands[p][0] + s.hands[p][1] > 0;
const clone = (s) => ({ ...s, hands: s.hands.map((h) => h.slice()), out: s.out.slice() });

const hitValue = (v) => (v < 5 ? v : v - 5);

// p が選べる「分ける」の形
function splitsOf(s, p) {
  if (!s.rules.split) return [];
  const [a, b] = s.hands[p];
  const sum = a + b;
  const list = [];
  for (let l = 1; l <= MAX_FINGERS; l++) {
    const r = sum - l;
    if (r < 1 || r > MAX_FINGERS) continue;
    if ((l === a && r === b) || (l === b && r === a)) continue;
    list.push([l, r]);
  }
  return list;
}

function movesOf(s, p) {
  const list = [];
  for (const from of [0, 1]) {
    if (!s.hands[p][from]) continue;
    for (let q = 0; q < s.n; q++) {
      if (q === p || !aliveP(s, q)) continue;
      for (const hand of [0, 1]) if (s.hands[q][hand]) list.push({ t: 'atk', from, to: q, hand });
    }
  }
  for (const h of splitsOf(s, p)) list.push({ t: 'split', h });
  return list;
}

function nextAlive(s, p) {
  for (let k = 1; k <= s.n; k++) {
    const q = (p + k) % s.n;
    if (aliveP(s, q)) return q;
  }
  return p;
}

/* ---------- 画面 ---------- */

let chosen = null; // 選んだ自分の手 { step, from } / 分ける形を選び中 { step, split: true }

export default {
  id: 'sensou',
  name: '戦争',
  icon: '✌️',
  desc: '両手の指の本数で戦う。相手の手をタッチして指を増やし、ちょうど5本になった手は消える',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'split', label: '分ける', desc: '自分の番に、両手の指の合計を変えずに左右へ配り直せる（消えた手にも配れる。分けて0本にはできない）', def: true },
  ],

  init(n, seed, { rules = {} } = {}) {
    return {
      n, rules: { split: true, ...rules }, hands: Array.from({ length: n }, () => [1, 1]),
      turn: 0, out: [], count: 0, winner: null, draw: false, step: 0, last: null,
    };
  },

  turn(s) { return s.winner === null && !s.draw ? s.turn : null; },
  canAct(s, p) { return s.winner === null && !s.draw && s.turn === p; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b, m) { return m.t === 'atk' ? 'punch' : 'pop'; },
  result(s) {
    if (s.winner === null && !s.draw) return null;
    const alive = Array.from({ length: s.n }, (_, p) => p).filter((p) => aliveP(s, p));
    return { winner: s.winner, draw: s.draw, ranking: [...alive, ...s.out.slice().reverse()] };
  },
  cpuDelay() { return 700; },
  info(s) { return `手数 ${s.count} / ${s.n * LIMIT_PER_PLAYER}（ここまでで決着しなければ引き分け）`; },

  resultText(res, me, pn) {
    if (res.draw) return '決着が付かず引き分け！';
    if (res.winner === me) return 'あなたの勝ち！🎉';
    return `${pn(res.winner)}の勝ち！`;
  },

  apply(s0, m) {
    if (!m || !this.canAct(s0, m.p)) return null;
    const p = m.p;
    const s = clone(s0);
    if (m.t === 'atk') {
      const { from, to, hand } = m;
      if (![0, 1].includes(from) || ![0, 1].includes(hand) || !Number.isInteger(to) || to < 0 || to >= s.n || to === p) return null;
      if (!s.hands[p][from] || !s.hands[to][hand]) return null;
      const before = s.hands[to][hand];
      s.hands[to][hand] = hitValue(before + s.hands[p][from]);
      s.last = { p, t: 'atk', from, to, hand, before, after: s.hands[to][hand], add: s.hands[p][from] };
      if (!aliveP(s, to)) { s.out.push(to); s.last.out = true; }
    } else if (m.t === 'split') {
      const h = m.h;
      if (!Array.isArray(h) || !splitsOf(s, p).some(([l, r]) => l === h[0] && r === h[1])) return null;
      s.last = { p, t: 'split', before: s.hands[p].slice(), h: h.slice() };
      s.hands[p] = [h[0], h[1]];
    } else {
      return null;
    }
    s.step += 1;
    s.count += 1;
    const alive = Array.from({ length: s.n }, (_, q) => q).filter((q) => aliveP(s, q));
    if (alive.length === 1) s.winner = alive[0];
    else if (s.count >= s.n * LIMIT_PER_PLAYER) s.draw = true;
    else s.turn = nextAlive(s, p);
    return s;
  },

  // CPU: 相手を倒す・手を消す手を好み、次に消されやすい形を避ける。ただし 3割は適当に選んで弱める
  cpu(s, p) {
    const list = movesOf(s, p);
    if (!list.length) return null;
    if (Math.random() < 0.3) return list[Math.floor(Math.random() * list.length)];
    let best = [];
    let bestScore = -Infinity;
    for (const m of list) {
      const t = this.apply(s, { ...m, p });
      if (!t) continue;
      let sc = Math.random(); // 同点ならばらばらに
      if (m.t === 'atk') {
        if (t.hands[m.to][m.hand] === 0) sc += 10;
        if (!aliveP(t, m.to)) sc += 30;
      }
      // 次に誰かにタッチされて消える自分の手の数
      for (const mine of [0, 1]) {
        const v = t.hands[p][mine];
        if (!v) continue;
        let danger = false;
        for (let q = 0; q < t.n; q++) {
          if (q === p || !aliveP(t, q)) continue;
          if (t.hands[q].some((x) => x && hitValue(v + x) === 0)) danger = true;
        }
        if (danger) sc -= 4;
      }
      if (sc > bestScore) { bestScore = sc; best = [m]; }
    }
    return best[0] ?? list[0];
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const can = o.canMove;
    if (!can || chosen?.step !== s.step) chosen = null;
    const draw = () => this.render(root, s, o);
    const res = this.result(s);

    root.innerHTML = '';
    root.className = 'board ss';

    const rankOf = (p) => (res ? res.ranking.indexOf(p) + 1 : 0);
    const panel = (p) => {
      const box = document.createElement('div');
      const dead = !aliveP(s, p);
      box.className = 'ss-player' + (p === me ? ' mine' : '') + (!res && s.turn === p ? ' turn' : '') + (dead ? ' dead' : '') + (s.winner === p ? ' won' : '');
      const head = document.createElement('div');
      head.className = 'ss-name';
      head.textContent = nameP(p);
      const tags = [];
      if (res && !res.draw) tags.push(['rank', `${rankOf(p)}位`]);
      else if (dead) tags.push(['away', '負け']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.cpu[p] && !o.names[p].startsWith('CPU')) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        head.append(t);
      }
      box.append(head);
      const hands = document.createElement('div');
      hands.className = 'ss-hands';
      for (const h of [0, 1]) {
        const v = s.hands[p][h];
        let click = null;
        if (can && p === me && v > 0 && !chosen?.split) click = () => { chosen = chosen?.from === h ? null : { step: s.step, from: h }; draw(); };
        else if (can && chosen && !chosen.split && p !== me && v > 0) click = () => { const from = chosen.from; chosen = null; o.onMove({ t: 'atk', from, to: p, hand: h }); };
        const e = handEl(v, h, click ? 'button' : 'div');
        if (click) { e.onclick = click; e.classList.add(p === me ? 'usable' : 'target'); }
        if (p === me && chosen?.from === h) e.classList.add('selected');
        if (o.fresh && s.last?.t === 'atk' && s.last.to === p && s.last.hand === h) e.classList.add('pop');
        if (o.fresh && s.last?.t === 'split' && s.last.p === p) e.classList.add('pop');
        hands.append(e);
      }
      box.append(hands);
      return box;
    };

    const others = document.createElement('div');
    others.className = 'ss-others';
    for (let k = me === null ? 0 : 1; k < s.n; k++) others.append(panel(((me ?? 0) + k) % s.n));
    root.append(others);

    const log = document.createElement('p');
    log.className = 'cc-log';
    log.textContent = logText(s, nameP);
    root.append(log);

    if (me === null) return;
    root.append(panel(me));

    if (!can) return;
    const hint = document.createElement('p');
    hint.className = 'ss-hint';
    if (chosen?.split) hint.textContent = '分け方を選んでください';
    else if (chosen) hint.textContent = `${HAND_NAME[chosen.from]}（${s.hands[me][chosen.from]}本）でタッチする相手の手を選んでください`;
    else hint.textContent = 'タッチに使う自分の手を選んでください';
    root.append(hint);

    const actions = document.createElement('div');
    actions.className = 'cc-actions ss-actions';
    const splits = splitsOf(s, me);
    if (chosen?.split) {
      for (const h of splits) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn secondary';
        b.textContent = `左${h[0]}・右${h[1]}`;
        b.onclick = () => { chosen = null; o.onMove({ t: 'split', h }); };
        actions.append(b);
      }
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.className = 'btn ghost';
      cancel.textContent = 'やめる';
      cancel.onclick = () => { chosen = null; draw(); };
      actions.append(cancel);
    } else if (splits.length) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn secondary';
      b.textContent = '分ける';
      b.onclick = () => { chosen = { step: s.step, split: true }; draw(); };
      actions.append(b);
    }
    if (actions.childElementCount) root.append(actions);
  },
};

function handEl(v, side, tag) {
  const e = document.createElement(tag);
  if (tag === 'button') e.type = 'button';
  e.className = 'ss-hand' + (v ? '' : ' gone');
  e.setAttribute('aria-label', `${HAND_NAME[side]} ${v}本`);
  const fingers = document.createElement('div');
  fingers.className = 'ss-fingers' + (side === 0 ? ' left' : '');
  for (let i = 0; i < 5; i++) {
    const f = document.createElement('span');
    f.className = 'ss-finger' + (i < v ? ' up' : '');
    fingers.append(f);
  }
  const label = document.createElement('span');
  label.className = 'ss-count';
  label.textContent = v ? `${HAND_NAME[side][0]} ${v}` : `${HAND_NAME[side][0]} ×`;
  e.append(fingers, label);
  return e;
}

function logText(s, nameP) {
  const l = s.last;
  if (!l) return '最初は全員、両手とも指1本。手番の人から順にタッチします';
  if (l.t === 'split') return `${nameP(l.p)}が分けた（左${l.before[0]}・右${l.before[1]} → 左${l.h[0]}・右${l.h[1]}）`;
  const what = `${nameP(l.p)}が${nameP(l.to)}の${HAND_NAME[l.hand]}をタッチ（${l.before}＋${l.add}）`;
  if (l.out) return `${what} → ${nameP(l.to)}は両手とも消えた！`;
  if (l.after === 0) return `${what} → 消えた！`;
  return `${what} → ${l.after}本`;
}
