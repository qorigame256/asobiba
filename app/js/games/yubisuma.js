// 指スマ。2〜8人。全員、両手（親指2本）から始める。
// 毎回、親が1人決まっていて、全員が「上げる親指の本数」（0〜残っている手の数）を選ぶ。親はそれに加えて数を1つ言う。
// 全員が選び終わったら一斉に開く（通信の遅れで「いっせーので」は画面同士で合わせられないため）。
// 上がった親指の合計が親の言った数と同じなら当たりで、親は片手を下ろす。両手とも下ろした人は抜ける（勝ち抜け）。
// 当たっても外れても、親は次の人（抜けていない人）へ回る。
// 終わり方（詳細設定）: 'last' … 最後の1人が残るまで（その人の負け）。最初はこれ / 'first' … 最初に抜けた人が出たら終わり
// 詳細設定「片手で始める」（2026-10-06 本人の決定。最初はなし）: 全員が片手（親指1本）から始める。1回当てたら抜けるので早く終わる。
// 手: { p, t: 'pick', r: 何回目か, up: 上げる本数, call: 言う数（親のときだけ） }
//   r と「この回はもう選んだか」で、同じ手が2回来ても2回目は反則になる。

const clone = (s) => ({ ...s, hands: s.hands.slice(), picks: s.picks.slice(), out: s.out.slice() });
const active = (s, p) => s.hands[p] > 0;
const activeList = (s) => Array.from({ length: s.n }, (_, p) => p).filter((p) => active(s, p));
const totalHands = (s) => s.hands.reduce((a, b) => a + b, 0);

function nextActive(s, p) {
  for (let k = 1; k <= s.n; k++) {
    const q = (p + k) % s.n;
    if (active(s, q)) return q;
  }
  return p;
}

function ended(s) {
  if (s.rules.end === 'first') return s.out.length > 0;
  return activeList(s).length <= 1;
}

/* ---------- 画面 ---------- */

let sel = { key: null, up: null, call: null }; // 選び中の内容（通信で描き直されても消えないように外に持つ）

export default {
  id: 'yubisuma',
  name: '指スマ',
  icon: '👍',
  desc: '親が数を言い、みんなで親指を上げる。上がった数が当たったら片手を下ろせる',
  ready: true,
  multi: true,
  realtime: true, // 全員が同時に選ぶ
  minPlayers: 2,
  maxPlayers: 8,
  settings: [
    { key: 'end', label: '終わり方', desc: '人数が多いと「最後の1人まで」は長くなる', def: 'last', choices: [['last', '最後の1人まで（残った人の負け）'], ['first', '最初に抜けた人の勝ちで終わり']] },
    { key: 'one', label: '片手で始める', desc: '全員が片手から始める。1回当てたら抜けるので早く終わる（人数が多いとき向け）', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    return { n, rules: { end: 'last', ...rules }, hands: Array(n).fill(rules.one === true ? 1 : 2), parent: 0, round: 1, picks: Array(n).fill(null), out: [], last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !ended(s) && active(s, p) && s.picks[p] === null; },
  // 効果音（sound.js の名前）。a = 前の局面、b = 今の局面、m = 打たれた手、me = 自分の番号
  sound(a, b) { return b.round > a.round ? (b.last.hit ? 'correct' : 'question') : 'pop'; }, // 全員がそろって開いたら、親が当てたか
  result(s) {
    if (!ended(s)) return null;
    const rest = activeList(s);
    return { winner: s.out[0], ranking: [...s.out, ...rest], loser: s.rules.end === 'last' ? rest[0] ?? null : null };
  },
  cpuDelay() { return 1000; },

  resultText(res, me, pn) {
    const who = (p) => (p === me ? 'あなた' : pn(p));
    let t = res.winner === me ? 'あなたが一番に抜けた！🎉' : `${pn(res.winner)}が一番に抜けた！`;
    if (res.loser !== null) t += `<br>最後に残った${who(res.loser)}の負け`;
    return t;
  },
  phaseText(s, me, pn) {
    const n = activeList(s).length;
    const done = s.picks.filter((x) => x !== null).length;
    const parent = s.parent === me ? 'あなた' : pn(s.parent);
    if (me >= 0 && active(s, me) && s.picks[me] !== null) return `親は${parent}。ほかの人を待っています…（${done}/${n}人）`;
    return `親は<b>${parent}</b>。親指の本数を選んでください（${done}/${n}人が選んだ）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'pick' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    const p = m.p;
    if (!this.canAct(s0, p) || m.r !== s0.round) return null;
    if (!Number.isInteger(m.up) || m.up < 0 || m.up > s0.hands[p]) return null;
    const isParent = p === s0.parent;
    if (isParent ? !Number.isInteger(m.call) || m.call < 0 || m.call > totalHands(s0) : m.call !== undefined) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[p] = isParent ? { up: m.up, call: m.call } : { up: m.up };
    if (activeList(s).every((q) => s.picks[q] !== null)) {
      const ups = s.picks.map((x) => (x ? x.up : null));
      const total = ups.reduce((a, b) => a + (b ?? 0), 0);
      const call = s.picks[s.parent].call;
      const hit = total === call;
      s.last = { round: s.round, parent: s.parent, call, ups, hands: s.hands.slice(), total, hit, out: false };
      if (hit) {
        s.hands[s.parent] -= 1;
        if (!s.hands[s.parent]) { s.out.push(s.parent); s.last.out = true; }
      }
      s.round += 1;
      s.picks = Array(s.n).fill(null);
      if (!ended(s)) s.parent = nextActive(s, s.parent);
    }
    return s;
  },

  // CPU: 本数は適当。親のときは「自分の本数＋ほかの人の手の半分くらい」に少しぶれを足して言う
  cpu(s, p) {
    const up = Math.floor(Math.random() * (s.hands[p] + 1));
    if (p !== s.parent) return { t: 'pick', r: s.round, up };
    const others = totalHands(s) - s.hands[p];
    const guess = up + Math.round(others / 2 + (Math.random() * 2 - 1) * Math.max(1, others / 4));
    return { t: 'pick', r: s.round, up, call: Math.max(up, Math.min(totalHands(s), guess)) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const draw = () => this.render(root, s, o);
    const can = o.canMove;
    const key = `${s.n}:${s.round}:${s.hands.join()}`;
    if (sel.key !== key) sel = { key, up: null, call: null };
    const res = this.result(s);
    const L = s.last;

    root.innerHTML = '';
    root.className = 'board ys';

    // 前の回の結果
    if (L) {
      const banner = document.createElement('div');
      banner.className = 'ys-last' + (L.hit ? ' hit' : '') + (o.fresh ? ' pop' : '');
      const parent = nameP(L.parent);
      let text = `${L.round}回目: 親の${parent}が「${L.call}」→ 上がった親指は ${L.total}本。`;
      if (!L.hit) text += 'はずれ';
      else if (L.out) text += `当たり！ ${parent}は両手とも下ろして抜けた！`;
      else text += `当たり！ ${parent}は片手を下ろした`;
      banner.textContent = text;
      root.append(banner);
    }

    // 全員
    const grid = document.createElement('div');
    grid.className = 'ys-players';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    for (const p of seats) {
      const box = document.createElement('div');
      const out = !active(s, p);
      box.className = 'ys-player' + (p === me ? ' mine' : '') + (out ? ' out' : '') + (!res && p === s.parent ? ' parent' : '');
      const head = document.createElement('div');
      head.className = 'ys-name';
      head.textContent = nameP(p);
      const tags = [];
      if (res) tags.push(['rank', `${res.ranking.indexOf(p) + 1}位`]);
      else if (out) tags.push(['rank', `${s.out.indexOf(p) + 1}番に抜けた`]);
      else if (p === s.parent) tags.push(['last', '親']);
      if (!res && !out) tags.push(s.picks[p] !== null ? ['ok', '選んだ✓'] : ['away', '考え中…']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        head.append(t);
      }
      box.append(head);
      // 前の回に上げた親指（👍）と下げた手（✊）。抜けた人は何も出さない
      const thumbs = document.createElement('div');
      thumbs.className = 'ys-thumbs' + (o.fresh ? ' pop' : '');
      const hands = L && L.ups[p] !== null ? L.hands[p] : s.hands[p];
      const up = L && L.ups[p] !== null ? L.ups[p] : 0;
      thumbs.textContent = hands ? '👍'.repeat(up) + '✊'.repeat(hands - up) : '🙌';
      thumbs.title = L ? '前の回に上げた親指' : '';
      box.append(thumbs);
      const left = document.createElement('div');
      left.className = 'ys-left';
      left.textContent = out ? '抜けた' : `残り ${s.hands[p]}手`;
      box.append(left);
      grid.append(box);
    }
    root.append(grid);

    if (me === null || res) return;
    if (!active(s, me)) {
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = '抜けました！ ほかの人が終わるまで見ていてください';
      root.append(p);
      return;
    }
    if (!can) {
      const mine = s.picks[me];
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = `親指 ${mine.up}本${mine.call !== undefined ? `・「${mine.call}」` : ''}で決めました。ほかの人を待っています…`;
      root.append(p);
      return;
    }

    const isParent = me === s.parent;
    const pickRow = (title, n, cur, set) => {
      const box = document.createElement('div');
      box.className = 'ys-pick';
      const h = document.createElement('div');
      h.className = 'cc-hand-head';
      h.textContent = title;
      box.append(h);
      const row = document.createElement('div');
      row.className = 'ys-choices';
      for (let i = 0; i <= n; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'ys-choice' + (cur === i ? ' on' : '');
        b.textContent = String(i);
        b.onclick = () => { set(i); draw(); };
        row.append(b);
      }
      box.append(row);
      return box;
    };
    root.append(pickRow(`上げる親指の本数（あなたの手は ${s.hands[me]}つ）`, s.hands[me], sel.up, (i) => { sel.up = i; }));
    if (isParent) root.append(pickRow(`あなたが親です。全員の上がる親指の合計を予想して言う数（0〜${totalHands(s)}）`, totalHands(s), sel.call, (i) => { sel.call = i; }));

    const actions = document.createElement('div');
    actions.className = 'cc-actions';
    const ok = document.createElement('button');
    ok.type = 'button';
    ok.className = 'btn primary';
    ok.textContent = isParent ? (sel.call === null ? 'いっせーの…' : `いっせーの「${sel.call}」！`) : '決める';
    ok.disabled = sel.up === null || (isParent && sel.call === null);
    ok.onclick = () => {
      const m = { t: 'pick', r: s.round, up: sel.up };
      if (isParent) m.call = sel.call;
      o.onMove(m);
    };
    actions.append(ok);
    root.append(actions);
  },
};
