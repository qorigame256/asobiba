// 海賊のたる（「黒ひげ危機一発」風。元の名前は使わない）。たるの穴に順番に剣を刺し、当たりの穴に刺した人の負け。2〜10人・足りない分は CPU。
// 2026-10-29 本人の決定（Claude が出した案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 穴は24個、当たりは1つ。当たりを刺した人の負け。
//   - 詳細設定「刺す本数」: 1本だけ（最初）・1〜3本から選べる（選べると駆け引きが生まれる）。
//   - 詳細設定「勝負の回数」: 1回（最初）・3回勝負（負けた回数の少ない人が上）。
//   - 当たりの場所は全員の端末が知っている（手札と同じ簡易の隠し方）。
// Claude の判断:
//   - 当たりの穴は種と何回目かから決める。2本・3本を刺すときは、選んだ順に刺し、当たりを刺したらそこで止まる。
//   - 3回勝負の次の回は、負けた人から刺す。回の終わりに3秒、当たりを見せる。
//   - CPU は運まかせ（当たりを知っていても避けない）。選べるときは 1本5割・2本3割・3本2割。
// 手: { p, t: 'stab', holes: [穴の番号…] } / { p: -1, t: 'next' }（ホストの進行。3回勝負の次の回へ）

import { mulberry32, shuffle } from './util.js';
import { SEAT_COLORS } from './party.js';

export const HOLES = 24;
const SHOWN_MS = 3000;

export const hitOf = (seed, round) => Math.floor(mulberry32((seed ^ Math.imul(round + 7, 0x85ebca6b)) >>> 0)() * HOLES);
const roundsOf = (s) => (Number(s.rules.rounds) === 3 ? 3 : 1);
const maxPick = (s) => (s.rules.pick === 'choose' ? 3 : 1);
const clone = (s) => ({ ...s, stabbed: s.stabbed.slice(), losses: s.losses.slice() });

let picked = null; // 選びかけの穴 { key, holes }

export default {
  id: 'taru',
  name: '海賊のたる',
  icon: '🏴‍☠️',
  desc: '順番にたるの穴へ剣を刺す。海賊が飛び出す穴を刺した人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'pick', label: '刺す本数', desc: '選べると、1回に1〜3本刺せる', def: 'one', choices: [['one', '1本だけ'], ['choose', '1〜3本から選ぶ']] },
    { key: 'rounds', label: '勝負の回数', desc: '3回勝負は負けた回数の少ない人が上', def: 1, choices: [[1, '1回'], [3, '3回勝負']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { pick: 'one', rounds: 1, ...rules };
    return { n, seed, rules: r, round: 0, hit: hitOf(seed, 0), stabbed: Array(HOLES).fill(-1), turn: 0, losses: Array(n).fill(0), phase: 'play', last: null, step: 0 };
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) { return s.phase === 'play' && s.turn === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    if (roundsOf(s) === 1) {
      const loser = s.last.p;
      // 3人以上でも、海賊を飛び出させた人以外は全員の勝ち（画面の「セーフ！あなたの勝ち」と、連勝・成績表の勝ちの数をそろえる）
      return { winners: [...Array(s.n).keys()].filter((p) => p !== loser), loser };
    }
    const best = Math.min(...s.losses);
    const place = s.losses.map((v) => 1 + s.losses.filter((x) => x < v).length);
    return { winners: s.losses.map((v, p) => (v === best ? p : -1)).filter((p) => p >= 0), place, losses: s.losses.slice() };
  },
  resultText(res, me, pn) {
    if (res.losses) {
      const w = res.winners;
      if (w.includes(me)) return `負けが${res.losses[me]}回で、あなたの勝ち！🎉${w.length > 1 ? `（${w.filter((p) => p !== me).map(pn).join('・')}と同点）` : ''}`;
      return `${w.map(pn).join('・')}${w.length > 1 ? 'が同点で' : 'が'}勝ち！`;
    }
    if (res.loser === me) return '🏴‍☠️ 海賊が飛び出した！あなたの負け…';
    return `🏴‍☠️ ${pn(res.loser)}が海賊を飛び出させた！${me !== null && me >= 0 ? 'セーフ！あなたの勝ち🎉' : ''}`;
  },
  phaseText(s, me, pn) {
    if (s.phase === 'shown') return `🏴‍☠️ ${pn(s.last.p)}が当たりを刺した！ まもなく${s.round + 2}回目`;
    return '';
  },
  sound(a, b, m) {
    if (m.p === -1) return 'question';
    return b.last?.out ? 'punch' : 'stab';
  },

  referee(s) {
    return s.phase === 'shown' ? { key: 'next' + s.round, ms: SHOWN_MS, move: { t: 'next' } } : null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t !== 'next' || s0.phase !== 'shown') return null;
      const s = clone(s0);
      s.step += 1;
      s.round += 1;
      s.hit = hitOf(s.seed, s.round);
      s.stabbed = Array(HOLES).fill(-1);
      s.turn = s0.last.p; // 負けた人から
      s.phase = 'play';
      s.last = null;
      return s;
    }
    if (m.t !== 'stab' || !this.canAct(s0, m.p) || !Array.isArray(m.holes)) return null;
    const hs = m.holes;
    if (hs.length < 1 || hs.length > maxPick(s0) || new Set(hs).size !== hs.length) return null;
    if (!hs.every((h) => Number.isInteger(h) && h >= 0 && h < HOLES && s0.stabbed[h] === -1)) return null;
    const s = clone(s0);
    s.step += 1;
    const done = [];
    let out = false;
    for (const h of hs) {
      s.stabbed[h] = m.p;
      done.push(h);
      if (h === s.hit) { out = true; break; }
    }
    s.last = { p: m.p, holes: done, out };
    if (out) {
      s.losses[m.p] += 1;
      s.phase = s.round + 1 >= roundsOf(s) ? 'end' : 'shown';
    } else s.turn = (s.turn + 1) % s.n;
    return s;
  },

  cpuDelay() { return 900; },
  cpu(s) {
    const open = [...Array(HOLES).keys()].filter((h) => s.stabbed[h] === -1);
    const r = Math.random();
    const k = Math.min(open.length, maxPick(s) === 1 ? 1 : r < 0.5 ? 1 : r < 0.8 ? 2 : 3);
    return { t: 'stab', holes: shuffle(open, Math.random).slice(0, k) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const key = `${s.seed}:${s.round}:${s.step}`;
    if (picked?.key !== key || !o.canMove) picked = null;
    const draw = () => this.render(root, s, o);
    root.innerHTML = '';
    root.className = 'board tr';

    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      const lost = s.last?.out && s.last.p === p;
      chip.className = 'cc-opp' + (s.phase === 'play' && s.turn === p ? ' turn' : '') + (res?.winners?.includes(p) || res?.winner === p ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      const st = document.createElement('div');
      st.className = 'pt-extra';
      st.textContent = roundsOf(s) === 3 ? `負け ${s.losses[p]}回` : '';
      if (lost) st.innerHTML = '<span class="pt-ng">🏴‍☠️ 当たり！</span>' + (roundsOf(s) === 3 ? ` 負け ${s.losses[p]}回` : '');
      chip.append(st);
      if (o.away[p] || o.sub?.[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag away', textContent: o.away[p] ? '応答なし' : 'CPU が代わりに' }));
      chips.append(chip);
    }
    root.append(chips);

    const out = s.last?.out;
    const barrel = document.createElement('div');
    barrel.className = 'tr-barrel';
    barrel.innerHTML = `<div class="tr-pirate${out ? ' jump' : ''}">🏴‍☠️</div>`;
    const holes = document.createElement('div');
    holes.className = 'tr-holes';
    const can = o.canMove && s.phase === 'play';
    for (let h = 0; h < HOLES; h++) {
      const by = s.stabbed[h];
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tr-hole' + (by >= 0 ? ' done' : '') + (picked?.holes.includes(h) ? ' sel' : '') + (out && h === s.hit ? ' hit' : '')
        + (o.fresh && s.last?.holes.includes(h) ? ' pop' : '');
      if (by >= 0) { b.textContent = '🗡️'; b.style.borderColor = SEAT_COLORS[by % SEAT_COLORS.length]; }
      b.disabled = !can || by >= 0;
      b.setAttribute('aria-label', `${h + 1}番の穴`);
      b.onclick = () => {
        if (maxPick(s) === 1) { o.onMove({ t: 'stab', holes: [h] }); return; }
        if (!picked) picked = { key, holes: [] };
        const i = picked.holes.indexOf(h);
        if (i >= 0) picked.holes.splice(i, 1);
        else if (picked.holes.length < 3) picked.holes.push(h);
        draw();
      };
      holes.append(b);
    }
    barrel.append(holes);
    root.append(barrel);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    const left = s.stabbed.filter((v) => v === -1).length;
    if (out) msg.textContent = `🏴‍☠️ ${nameP(s.last.p)}が当たりの穴を刺した！`;
    else if (s.last) msg.textContent = `${nameP(s.last.p)}が${s.last.holes.length}本刺した。セーフ！（残りの穴 ${left}）`;
    else msg.textContent = `${roundsOf(s) === 3 ? `${s.round + 1}回目 / 3・` : ''}穴を選んで剣を刺そう（残りの穴 ${left}）`;
    root.append(msg);

    if (can && maxPick(s) > 1) {
      const act = document.createElement('div');
      act.className = 'cc-actions';
      const n = picked?.holes.length ?? 0;
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary';
      go.textContent = n ? `${n}本刺す` : '穴を1〜3つ選ぶ';
      go.disabled = !n;
      go.onclick = () => { const hs = picked.holes.slice(); picked = null; o.onMove({ t: 'stab', holes: hs }); };
      act.append(go);
      root.append(act);
    }
  },
};
