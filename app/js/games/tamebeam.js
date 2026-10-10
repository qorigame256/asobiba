// ためてビーム（手遊びの CCレモン・バトルじゃんけん・せんだめ・チャージ などと同じ遊び）。2〜6人。
// 毎回、全員が同時に技を1つ選ぶ。全員が選び終わったら一斉に開く（通信の遅れで「いっせーので」は画面同士で合わせられないため。指スマと同じ）。
// 技: ため（ためが1増える）/ ガード（ビームを防ぐ）/ ビーム（ため1を使う）/ 大ビーム（ため3を使う。ガードを破り、ビームに勝つ）。
// ビームと大ビームは相手を1人選ぶ（2人のときは相手が決まっている）。
// 当たり方（A が T を撃ったとき）:
//   T も A を撃っていた … 同じ強さなら相殺（どちらにも当たらない）。強いほうだけが当たる
//   T がガード … ビームは防がれ、大ビームは破って当たる
//   それ以外（ため・ほかの人を撃っていた） … 当たる
// 当たった人はライフが1減る（何人に当てられても、1回に減るのは1つ。Claude の判断）。ライフが0になった人は抜ける。
// 最後の1人が残ったらその人の勝ち。残っていた人が同じ回に全員抜けたら引き分け。LIMIT 回を超えたら引き分け（ガードだけで終わらないとき）。
// 手: { p, t: 'act', r: 何回目か, a: 'charge'|'guard'|'beam'|'big', to: 撃つ相手（ビーム・大ビームのときだけ） }
//   r と「この回はもう選んだか」で、同じ手が2回来ても2回目は反則になる。

const COST = { charge: 0, guard: 0, beam: 1, big: 3 };
const POWER = { beam: 1, big: 2 };
const LABEL = { charge: 'ため', guard: 'ガード', beam: 'ビーム', big: '大ビーム' };
const ICON = { charge: '🔋', guard: '🛡️', beam: '⚡', big: '💥' };
const LIMIT = 100;

const clone = (s) => ({ ...s, life: s.life.slice(), charge: s.charge.slice(), picks: s.picks.slice(), outAt: s.outAt.slice() });
const active = (s, p) => s.life[p] > 0;
const activeList = (s) => Array.from({ length: s.n }, (_, p) => p).filter((p) => active(s, p));
const isAttack = (a) => a === 'beam' || a === 'big';
const ended = (s) => s.draw || activeList(s).length <= 1;

// 一斉に開いたときの当たり方。picks[p] = { a, to } → { hit: [当たった人], ev: [{ from, to, kind: 'hit'|'block'|'cancel'|'lose' }] }
function resolve(s, picks) {
  const hit = new Set();
  const ev = [];
  for (const a of activeList(s)) {
    const pa = picks[a];
    if (!isAttack(pa.a)) continue;
    const t = pa.to;
    const pt = picks[t];
    if (isAttack(pt.a) && pt.to === a) {
      if (POWER[pa.a] > POWER[pt.a]) { hit.add(t); ev.push({ from: a, to: t, kind: 'hit' }); }
      else if (POWER[pa.a] === POWER[pt.a]) { if (a < t) ev.push({ from: a, to: t, kind: 'cancel' }); }
      else ev.push({ from: a, to: t, kind: 'lose' });
    } else if (pt.a === 'guard' && pa.a === 'beam') ev.push({ from: a, to: t, kind: 'block' });
    else { hit.add(t); ev.push({ from: a, to: t, kind: 'hit' }); }
  }
  return { hit: [...hit], ev };
}

/* ---------- 画面 ---------- */

let sel = { key: null, a: null }; // 撃つ相手を選んでいる途中の技（通信で描き直されても消えないように外に持つ）

export default {
  id: 'tamebeam',
  name: 'ためてビーム',
  icon: '🔋',
  desc: 'みんなで同時に「ため・ガード・ビーム」を出し合う手遊び。CCレモン・せんだめ などとも呼ばれる',
  ready: true,
  multi: true,
  realtime: true, // 全員が同時に選ぶ
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'lives', label: 'ライフ', desc: '何回当たったら抜けるか', def: 1, choices: [[1, '1（当たったら負け）'], [3, '3']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const lives = rules.lives === 3 ? 3 : 1;
    return { n, rules: { lives }, life: Array(n).fill(lives), charge: Array(n).fill(0), round: 1, picks: Array(n).fill(null), outAt: Array(n).fill(0), draw: false, last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !ended(s) && active(s, p) && s.picks[p] === null; },
  // 効果音: 一斉に開いた回に当たりがあれば punch、撃ち合い・防いだだけなら hit、ほかは pop
  sound(a, b) {
    if (b.round === a.round) return 'pop';
    if (b.last.hit.length) return 'punch';
    return b.last.ev.length ? 'hit' : 'pop';
  },
  result(s) {
    if (!ended(s)) return null;
    const alive = activeList(s);
    // 順位: 残った人 → 抜けたのが遅い人から（同じ回に抜けた人は同じ順位）
    const out = Array.from({ length: s.n }, (_, p) => p).filter((p) => !active(s, p)).sort((x, y) => s.outAt[y] - s.outAt[x]);
    const ranking = [...alive, ...out];
    if (alive.length === 1 && !s.draw) return { winner: alive[0], draw: false, ranking };
    return { winner: null, draw: true, ranking };
  },
  cpuDelay() { return 900; },

  resultText(res, me, pn) {
    if (res.draw) return '決着が付かず引き分け！';
    return res.winner === me ? 'あなたの勝ち！🎉' : `${pn(res.winner)}の勝ち！`;
  },
  phaseText(s, me, pn) {
    const n = activeList(s).length;
    const done = s.picks.filter((x) => x !== null).length;
    if (me >= 0 && active(s, me) && s.picks[me] !== null) return `${s.round}回目。ほかの人を待っています…（${done}/${n}人）`;
    return `${s.round}回目。技を選んでください（${done}/${n}人が選んだ）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'act' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    const p = m.p;
    if (!this.canAct(s0, p) || m.r !== s0.round || !(m.a in COST)) return null;
    if (s0.charge[p] < COST[m.a]) return null;
    if (isAttack(m.a)) {
      if (!Number.isInteger(m.to) || m.to === p || m.to < 0 || m.to >= s0.n || !active(s0, m.to)) return null;
    } else if (m.to !== undefined) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[p] = isAttack(m.a) ? { a: m.a, to: m.to } : { a: m.a };
    if (activeList(s).every((q) => s.picks[q] !== null)) {
      const picks = s.picks;
      const { hit, ev } = resolve(s, picks);
      for (const q of activeList(s)) s.charge[q] += picks[q].a === 'charge' ? 1 : -COST[picks[q].a];
      s.last = { round: s.round, picks, charge: s0.charge.slice(), hit, ev, out: [] };
      for (const q of hit) {
        s.life[q] -= 1;
        if (!s.life[q]) { s.outAt[q] = s.round; s.last.out.push(q); }
      }
      if (activeList(s).length === 0) s.draw = true; // 残っていた人が同じ回に全員抜けた
      else if (s.round >= LIMIT && activeList(s).length > 1) s.draw = true;
      s.round += 1;
      s.picks = Array(s.n).fill(null);
    }
    return s;
  },

  // CPU: 弱め。ためが3あれば半分ほど大ビーム、ためが無ければ ため（撃たれそうならときどきガード）、ほかはため・ビーム・ガードを適当に
  cpu(s, p) {
    const r = s.round;
    const foes = activeList(s).filter((q) => q !== p);
    if (!foes.length) return null;
    const anyFoe = () => foes[Math.floor(Math.random() * foes.length)];
    // 撃つ相手: ためが0の人（撃ち返してこない）を少しだけ選びやすく
    const target = () => {
      const empty = foes.filter((q) => s.charge[q] === 0);
      return empty.length && Math.random() < 0.5 ? empty[Math.floor(Math.random() * empty.length)] : anyFoe();
    };
    const c = s.charge[p];
    const threat = foes.some((q) => s.charge[q] >= 1);
    const big = foes.some((q) => s.charge[q] >= 3);
    const x = Math.random();
    if (c >= 3 && x < 0.5) return { t: 'act', r, a: 'big', to: target() };
    if (c === 0) return { t: 'act', r, a: threat && x < 0.35 ? 'guard' : 'charge' };
    const g = threat ? (big ? 0.2 : 0.3) : 0.05;
    if (x < g) return { t: 'act', r, a: 'guard' };
    if (x < g + 0.4) return { t: 'act', r, a: 'charge' };
    return { t: 'act', r, a: 'beam', to: target() };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const draw = () => this.render(root, s, o);
    const key = `${s.n}:${s.round}`;
    if (sel.key !== key) sel = { key, a: null };
    const res = this.result(s);
    const L = s.last;
    const lives = s.rules.lives;

    root.innerHTML = '';
    root.className = 'board tb';

    // 前の回に起きたこと
    if (L) {
      const banner = document.createElement('div');
      banner.className = 'tb-last' + (L.hit.length ? ' hit' : '') + (o.fresh ? ' pop' : '');
      const head = document.createElement('div');
      head.className = 'tb-last-head';
      head.textContent = `${L.round}回目`;
      banner.append(head);
      const lines = L.ev.map((e) => {
        const a = `${nameP(e.from)}の${LABEL[L.picks[e.from].a]}`;
        if (e.kind === 'hit') return `${a} → ${nameP(e.to)}に当たった！${L.picks[e.to].a === 'guard' ? '（ガードを破った）' : ''}`;
        if (e.kind === 'block') return `${a} → ${nameP(e.to)}がガードで防いだ`;
        if (e.kind === 'cancel') return `${nameP(e.from)}と${nameP(e.to)}のビームがぶつかって相殺`;
        return `${a} → ${nameP(e.to)}の大ビームに負けた`;
      });
      if (!lines.length) lines.push('だれも撃たなかった');
      for (const q of L.out) lines.push(`${nameP(q)}は抜けた`);
      for (const t of lines) {
        const d = document.createElement('div');
        d.textContent = t;
        banner.append(d);
      }
      root.append(banner);
    }

    // 全員
    const grid = document.createElement('div');
    grid.className = 'tb-players';
    const seats = me === null ? Array.from({ length: s.n }, (_, p) => p) : Array.from({ length: s.n }, (_, k) => (me + k) % s.n);
    // 順位: 自分より上（残っている・自分より後の回に抜けた）人の数 + 1。同じ回に抜けた人は同じ順位
    const later = (q, p) => (active(s, q) ? !active(s, p) : !active(s, p) && s.outAt[q] > s.outAt[p]);
    const rankOf = (p) => s.life.filter((_, q) => later(q, p)).length + 1;
    for (const p of seats) {
      const box = document.createElement('div');
      const out = !active(s, p);
      box.className = 'tb-player' + (p === me ? ' mine' : '') + (out ? ' out' : '') + (L && L.hit.includes(p) && o.fresh ? ' shake' : '');
      const head = document.createElement('div');
      head.className = 'tb-name';
      head.textContent = nameP(p);
      const tags = [];
      if (res && !res.draw) tags.push(['rank', `${rankOf(p)}位`]);
      else if (out) tags.push(['rank', '抜けた']);
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
      // 前の回に出した技
      const act = document.createElement('div');
      act.className = 'tb-act' + (o.fresh ? ' pop' : '');
      const pk = L && L.picks[p];
      act.textContent = pk ? `${ICON[pk.a]} ${LABEL[pk.a]}${isAttack(pk.a) ? ` → ${nameP(pk.to)}` : ''}` : '　';
      box.append(act);
      const st = document.createElement('div');
      st.className = 'tb-stat';
      st.textContent = `ため ${s.charge[p]}` + (lives > 1 ? `　❤️ ${s.life[p]}` : '');
      box.append(st);
      grid.append(box);
    }
    root.append(grid);

    if (me === null || res) return;
    if (!active(s, me)) {
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = '抜けました。ほかの人が終わるまで見ていてください';
      root.append(p);
      return;
    }
    if (!o.canMove) {
      const mine = s.picks[me];
      const p = document.createElement('p');
      p.className = 'cc-log';
      p.textContent = mine ? `${ICON[mine.a]} ${LABEL[mine.a]}${isAttack(mine.a) ? ` → ${nameP(mine.to)}` : ''} に決めました。ほかの人を待っています…` : '';
      root.append(p);
      return;
    }

    const foes = activeList(s).filter((q) => q !== me);
    const send = (a, to) => { sel = { key, a: null }; o.onMove(isAttack(a) ? { t: 'act', r: s.round, a, to } : { t: 'act', r: s.round, a }); };
    const pickBox = document.createElement('div');
    pickBox.className = 'tb-pick';
    const h = document.createElement('div');
    h.className = 'cc-hand-head';
    if (sel.a) h.textContent = `${LABEL[sel.a]}をだれに撃つ？`;
    else h.textContent = `技を選んでください（あなたのため: ${s.charge[me]}）`;
    pickBox.append(h);
    const row = document.createElement('div');
    row.className = 'tb-choices';
    const btn = (text, on, onclick, disabled = false, sub = '') => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tb-choice' + (on ? ' on' : '');
      b.disabled = disabled;
      b.textContent = text;
      if (sub) {
        const sm = document.createElement('small');
        sm.textContent = sub;
        b.append(sm);
      }
      b.onclick = onclick;
      row.append(b);
    };
    if (sel.a) {
      for (const q of foes) btn(nameP(q), false, () => send(sel.a, q), false, `ため ${s.charge[q]}`);
      btn('やめる', false, () => { sel.a = null; draw(); });
    } else {
      const pick = (a) => () => {
        if (!isAttack(a)) send(a);
        else if (foes.length === 1) send(a, foes[0]);
        else { sel.a = a; draw(); }
      };
      for (const a of ['charge', 'guard', 'beam', 'big']) {
        btn(`${ICON[a]} ${LABEL[a]}`, false, pick(a), s.charge[me] < COST[a], COST[a] ? `ため ${COST[a]}` : a === 'charge' ? 'ため +1' : 'ビームを防ぐ');
      }
    }
    pickBox.append(row);
    root.append(pickBox);
  },
};
