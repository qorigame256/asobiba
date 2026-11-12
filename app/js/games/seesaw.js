// シーソーにのせる。交代で重りを1つずつシーソーにのせ、傾いて落とした人の負け。2〜10人・足りない分は CPU。
// 2026-11-12 本人の決定（Claude が出した12の新しいゲームの案から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 重りは番が来るたびにくじで渡され（1・2・3 の3種類）、置く場所だけを選ぶ。
//   - 傾いて落ちたら、そこで終わり。落とした人が負けで、ほかの人は勝ち（1回で決着）。
// Claude の判断（置き方を試算して決めた。2026-11-12）:
//   - 置き場所は支点の左右に5か所ずつ（支点からの距離 1〜5）。1か所に置けるのは1つだけ。
//   - 傾き = 重り × 支点からの距離 の合計（右が＋）。**のせるほど許される傾き（限界）が小さくなる**: 限界 = 2 × のせたあとの空きの数（最初の1つは18、最後の1つは0）。
//     限界を超えたら落ちる。決まった限界のままだと、外側から上手に埋めれば8割以上が全部のって引き分けになったため
//     （試算: 限界が空きに比例すると、引き分けは上手に置いても1割未満・ふつうに置けば1%前後。平均8〜9手で落ちる）。
//   - 10か所が全部うまって落ちなかった（ぴったり釣り合った）ときは全員の勝ち（引き分け）。
//   - 場所は2回押して置く（1回目で「のせたらどう傾くか」を見せ、2回目か「ここにのせる」で置く）。落ちる場所にも置ける（置ける所が全部落ちる場所のこともあるため）。
//   - 重りのくじは種と何個目かから決める（全員の端末で同じ）。次の人の重りは見せない（詳細設定「次の重りが見える」で見せられる）。
//   - CPU は落ちない場所から、半分は傾きがいちばん小さくなる所、半分はでたらめに選ぶ（落ちない場所が無ければでたらめ）。
// 詳細設定（2026-11-12 の40回目の案。本人が選んだ。分かれ目は Claude の判断）:
//   - 「次の重りが見える」なし（最初）・あり（鍵は next）: いまの重りの次にくじで出る重りを全員に見せる（次の人が困る置き方を狙える）。
//   - 「パス」なし（最初）・あり（鍵は pass）: 1回戦ごとに1人1回、のせずに次の人へ回せる。重りはのせた数で決まるので、回された人は同じ重りをのせる。
//     CPU は落ちない場所が無いときだけパスする。
//   - 「何回戦」1回戦（最初）・3回戦・5回戦（鍵は games）: 落とした回数がいちばん少ない人の勝ち（同じ人は同じ順位。全員同じなら引き分け）。
//     落ちたら（全部のって釣り合っても）3秒見せて次の回戦へ（ホストが時間を計る手 { p: -1, t: 'next' }）。次の回戦は落とした人から始める
//     （釣り合ったときは最後にのせた人の次から）。回戦ごとに重りのくじを変える（1回戦目は前と同じ）。
//   - 「置き場所の数」左右3か所・5か所（最初）・7か所（鍵は size。盤の大きさなので、おまかせで抽選しない）: 限界の式は同じ（2 × のせたあとの空きの数）。
//     試算（2万局ずつ、CPU どうし）: 3か所は平均5手で引き分け2〜3%、7か所は平均11〜12手で引き分けはほぼ無い。
//   - 「重い重り」なし（最初）・あり（鍵は heavy）: くじの1割2分ほどが重さ5になる（重さ1〜3のくじを引いたあとに、同じ乱数の続きで決める。なしのときの重りは前と同じ）。
//   - 5つとも最初の値のときの重りのくじと置ける場所・限界は前と同じ（局面には回戦の数などの欄が増えた）。
// 手: { p, t: 'put', x: 支点からの位置（-5〜-1・1〜5。7か所なら -7〜7） } / { p, t: 'pass' } / { p: -1, t: 'next' }

import { mulberry32 } from './util.js';
import { SEAT_COLORS, winnersText } from './party.js';

export const spotsOf = (side = 5) => [...Array(side)].map((_, i) => i - side).concat([...Array(side)].map((_, i) => i + 1));
export const SPOTS = spotsOf(5);
const HEAVY = 0.12; // 重い重りが出る割合
export const weightOf = (seed, k, heavy = false) => {
  const rnd = mulberry32((seed ^ Math.imul(k + 11, 0x9e3779b1)) >>> 0);
  const w = 1 + Math.floor(rnd() * 3);
  return heavy && rnd() < HEAVY ? 5 : w;
};
// k 個のっているときに次の1つをのせたあとの限界（N = 置き場所の数）
export const limitOf = (k, N = SPOTS.length) => 2 * (N - k - 1);
const SIDES = [[5, '左右5か所'], [3, '左右3か所'], [7, '左右7か所']];
const GAMES_CHOICES = [[1, '1回戦'], [3, '3回戦'], [5, '5回戦']];
const GAP_MS = 3000; // 落ちたのを見せてから次の回戦まで
const DEG = 0.9; // 傾き1あたりの角度（度）
const angleOf = (T) => Math.max(-18, Math.min(18, T * DEG));
const clone = (s) => ({ ...s, placed: s.placed.slice(), falls: s.falls.slice(), passed: s.passed.slice() });
const spotsIn = (s) => spotsOf(s.rules.size);
const free = (s) => spotsIn(s).filter((x) => !s.placed.some((v) => v.x === x));
// 回戦ごとの種（1回戦目は対局の種のまま）
const gameSeed = (s) => (s.game === 0 ? s.seed : (s.seed ^ Math.imul(s.game + 3, 0x85ebca6b)) >>> 0);
const wOf = (s, k = s.placed.length) => weightOf(gameSeed(s), k, s.rules.heavy);
const limitIn = (s, k = s.placed.length) => limitOf(k, spotsIn(s).length);
const canPass = (s, p) => s.rules.pass && !s.passed[p];

let picked = null; // 選びかけの場所 { key, x }

export default {
  id: 'seesaw',
  name: 'シーソーにのせる',
  icon: '🪵',
  desc: '交代で重りをのせる。シーソーを傾けて落とした人の負け',
  ready: true,
  multi: true,
  minPlayers: 2,
  maxPlayers: 10,
  settings: [
    { key: 'next', label: '次の重りが見える', desc: 'いまの重りの次にくじで出る重りを全員に見せる', def: false },
    { key: 'pass', label: 'パス', desc: '1回戦ごとに1人1回、のせずに次の人へ回せる（回された人が同じ重りをのせる）', def: false },
    { key: 'games', label: '何回戦', desc: '落とした回数がいちばん少ない人の勝ち。1回戦なら一発勝負', def: 1, choices: GAMES_CHOICES },
    { key: 'size', label: '置き場所の数', desc: '支点の左右にいくつ置き場所があるか', def: 5, choices: SIDES },
    { key: 'heavy', label: '重い重り', desc: 'くじにときどき重さ5の重りがまざる', def: false },
  ],

  init(n, seed, { rules = {} } = {}) {
    const r = { next: false, pass: false, games: 1, size: 5, heavy: false, ...rules };
    if (![3, 5, 7].includes(r.size)) r.size = 5;
    if (![1, 3, 5].includes(r.games)) r.games = 1;
    return { n, seed, rules: r, turn: 0, placed: [], T: 0, phase: 'play', last: null, step: 0, game: 0, falls: Array(n).fill(0), passed: Array(n).fill(false) };
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) { return s.phase === 'play' && s.turn === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    const all = [...Array(s.n).keys()];
    if (s.rules.games === 1) {
      if (!s.last.fell) return { winners: all, draw: true };
      return { winners: all.filter((p) => p !== s.last.p), loser: s.last.p };
    }
    // 何回戦: 落とした回数がいちばん少ない人の勝ち
    const min = Math.min(...s.falls);
    const winners = all.filter((p) => s.falls[p] === min);
    if (winners.length === s.n) return { winners, draw: true, falls: s.falls };
    const place = all.map((p) => 1 + all.filter((x) => s.falls[x] < s.falls[p]).length);
    return { winners, falls: s.falls, place };
  },
  resultText(res, me, pn) {
    if (res.falls) {
      if (res.draw) return '⚖️ 落とした回数がみんな同じ。引き分け';
      return `${winnersText(res.winners, me, pn)}（落とした回数がいちばん少ない）`;
    }
    if (res.draw) return '⚖️ 全部のせて、ぴったり釣り合った！ 全員の勝ち🎉';
    if (res.loser === me) return '💥 シーソーが落ちた！あなたの負け…';
    return `💥 ${pn(res.loser)}がシーソーを落とした！${me !== null && me >= 0 ? 'セーフ！あなたの勝ち🎉' : ''}`;
  },
  phaseText(s) { return s.rules.games > 1 ? `${s.game + 1}回戦 / ${s.rules.games}` : ''; },
  sound(a, b, m) {
    if (m.t === 'pass') return 'chip';
    if (m.t === 'next') return 'card';
    return 'wall';
  },

  referee(s) {
    return s.phase === 'gap' ? { key: 'gap' + s.game, ms: GAP_MS, move: { t: 'next' } } : null;
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.p === -1) {
      if (m.t !== 'next' || s0.phase !== 'gap') return null;
      const s = clone(s0);
      s.step += 1;
      s.turn = s0.last.fell ? s0.last.p : (s0.last.p + 1) % s.n;
      s.game += 1;
      s.placed = [];
      s.T = 0;
      s.last = null;
      s.passed = Array(s.n).fill(false);
      s.phase = 'play';
      return s;
    }
    if (m.t === 'pass') {
      if (!this.canAct(s0, m.p) || !canPass(s0, m.p)) return null;
      const s = clone(s0);
      s.step += 1;
      s.passed[m.p] = true;
      s.last = { p: m.p, pass: true, from: s0.T };
      s.turn = (s.turn + 1) % s.n;
      return s;
    }
    if (m.t !== 'put' || !this.canAct(s0, m.p) || !free(s0).includes(m.x)) return null;
    const s = clone(s0);
    s.step += 1;
    const k = s0.placed.length;
    const w = wOf(s0, k);
    s.placed.push({ x: m.x, w, p: m.p });
    s.T = s0.T + w * m.x;
    const fell = Math.abs(s.T) > limitIn(s0, k);
    s.last = { p: m.p, x: m.x, w, fell, from: s0.T };
    if (fell) s.falls[m.p] += 1;
    if (fell || s.placed.length === spotsIn(s).length) s.phase = s.game + 1 >= s.rules.games ? 'end' : 'gap';
    else s.turn = (s.turn + 1) % s.n;
    return s;
  },

  cpuDelay() { return 900; },
  cpu(s) {
    const w = wOf(s);
    const L = limitIn(s);
    const open = free(s);
    const safe = open.filter((x) => Math.abs(s.T + w * x) <= L);
    if (!safe.length && canPass(s, s.turn)) return { t: 'pass' };
    if (!safe.length) return { t: 'put', x: open[Math.floor(Math.random() * open.length)] };
    if (Math.random() < 0.5) return { t: 'put', x: safe[Math.floor(Math.random() * safe.length)] };
    return { t: 'put', x: safe.reduce((a, b) => (Math.abs(s.T + w * a) <= Math.abs(s.T + w * b) ? a : b)) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const multi = s.rules.games > 1;
    const spots = spotsIn(s);
    const N = spots.length;
    const side = N / 2;
    const k = s.placed.length;
    const key = `${s.seed}:${s.game}:${k}:${s.passed.filter(Boolean).length}`;
    const can = o.canMove && s.phase === 'play';
    if (picked?.key !== key || !can) picked = null;
    const draw = () => this.render(root, s, o);
    const w = s.phase === 'play' ? wOf(s) : null;
    const L = s.phase === 'play' ? limitIn(s) : null;
    const preview = picked ? s.T + w * picked.x : null;
    const willFall = preview !== null && Math.abs(preview) > L;
    const over = s.phase !== 'play'; // この回戦は終わった（落ちたか、全部のった）
    const fallen = over && s.last?.fell;
    root.innerHTML = '';
    root.className = 'board ss';

    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (s.phase === 'play' && s.turn === p ? ' turn' : '') + (res?.winners?.includes(p) && !res.draw ? ' won' : '') + (p === me ? ' me' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      const st = document.createElement('div');
      st.className = 'pt-extra';
      const tags = [];
      if (fallen && s.last.p === p) tags.push('<span class="pt-ng">💥 落とした</span>');
      else if (multi && s.falls[p]) tags.push(`<span class="pt-ng">💥×${s.falls[p]}</span>`);
      if (s.rules.pass && s.phase === 'play') tags.push(s.passed[p] ? '<span class="pt-ng">パス済み</span>' : '');
      st.innerHTML = tags.join(' ');
      chip.append(st);
      if (o.away[p] || o.sub?.[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag away', textContent: o.away[p] ? '応答なし' : 'CPU が代わりに' }));
      chips.append(chip);
    }
    root.append(chips);

    // いまの重り（と、次の重りが見えるときは次の重り）
    const head = document.createElement('div');
    head.className = 'ss-head';
    if (s.phase === 'play') {
      head.innerHTML = `<span class="ss-next" style="--w:${w}">${w}</span>`;
      const t = document.createElement('span');
      t.textContent = `${multi ? `${s.game + 1}回戦・` : ''}${nameP(s.turn)}の重り（重さ${w}）`;
      head.append(t);
      if (s.rules.next && k + 1 < N) {
        const w2 = wOf(s, k + 1);
        const nx = document.createElement('span');
        nx.className = 'ss-after';
        nx.innerHTML = `つぎ <span class="ss-next small" style="--w:${w2}">${w2}</span>`;
        head.append(nx);
      }
    } else {
      const done = fallen ? '💥 落ちた！' : `⚖️ ${N}個ぜんぶのった！`;
      head.textContent = s.phase === 'gap' ? `${done} まもなく${s.game + 2}回戦…` : done;
    }
    root.append(head);

    // シーソー（SVG）。横400、支点は (200, 150)。置き場所の間は 180 / 左右の数
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
      return e;
    };
    // 上は傾いて上がった端に一番大きい重りがのっても入る高さ（18度で端が約58上がる＋重り32。重さ5があれば44）だけ取る
    const top = s.rules.heavy ? 40 : 52;
    const svg = mk('svg', { viewBox: `0 ${top} 400 ${192 - top}`, class: 'ss-svg' + (fallen ? ' fall' : '') });
    svg.append(mk('polygon', { points: '200,152 178,186 222,186', class: 'ss-pivot' }));
    svg.append(mk('rect', { x: 10, y: 185, width: 380, height: 4, rx: 2, class: 'ss-ground' }));
    const plank = mk('g', { class: 'ss-plank' });
    const shownT = preview ?? s.T;
    const end = fallen ? Math.sign(s.T) * 26 : null; // 落ちたら大きく傾ける
    const to = end ?? angleOf(shownT);
    plank.style.setProperty('--to', `${to}deg`);
    if (o.fresh && s.last && !s.last.pass && !picked) {
      plank.style.setProperty('--from', `${angleOf(s.last.from)}deg`);
      plank.classList.add('move');
    }
    plank.style.transform = `rotate(${to}deg)`;
    plank.append(mk('rect', { x: 12, y: 144, width: 376, height: 10, rx: 4, class: 'ss-board' }));
    const unit = 180 / side;
    const X = (x) => 200 + x * unit;
    for (const x of spots) {
      const v = s.placed.find((e) => e.x === x);
      const g = mk('g', { class: 'ss-spot' + (v ? ' full' : '') + (picked?.x === x ? ' sel' : '') });
      g.append(mk('text', { x: X(x), y: 152, class: 'ss-dist' })); // 板の上に支点からの距離
      g.lastChild.textContent = Math.abs(x);
      const show = v ?? (picked?.x === x ? { w, p: s.turn, ghost: true } : null);
      if (show) {
        const size = 14 + show.w * 6;
        const wd = Math.min(size, unit * 0.92); // 置き場所が狭いとき・重さ5は、幅をおさえて高さで重さを見せる
        const blk = mk('g', { class: 'ss-wt' + (show.ghost ? ' ghost' : '') + (o.fresh && s.last?.x === x && !show.ghost ? ' drop' : '') });
        blk.append(mk('rect', { x: X(x) - wd / 2, y: 144 - size, width: wd, height: size, rx: 4, fill: SEAT_COLORS[show.p % SEAT_COLORS.length] }));
        const t = mk('text', { x: X(x), y: 144 - size / 2 + 5, class: 'ss-wt-n' });
        t.textContent = show.w;
        blk.append(t);
        g.append(blk);
      } else g.append(mk('circle', { cx: X(x), cy: 139, r: 4, class: 'ss-dot' }));
      if (can && !v) {
        const hit = mk('rect', { x: X(x) - unit / 2, y: 70, width: unit, height: 105, class: 'ss-hit' });
        hit.setAttribute('role', 'button');
        hit.setAttribute('aria-label', `${x < 0 ? '左' : '右'}の${Math.abs(x)}番目`);
        hit.addEventListener('click', () => {
          if (picked?.x === x) { picked = null; o.onMove({ t: 'put', x }); return; }
          picked = { key, x };
          draw();
        });
        g.append(hit);
      }
      plank.append(g);
    }
    svg.append(plank);
    root.append(svg);

    // 傾きのメーター: 緑が落ちない範囲（のせるほど狭くなる）、▼ がいまの傾き
    const meter = document.createElement('div');
    meter.className = 'ss-meter';
    const maxL = limitOf(0, N);
    const pct = (T) => 50 + (Math.max(-maxL - 4, Math.min(maxL + 4, T)) / (maxL + 4)) * 50;
    const zoneL = L ?? 0;
    meter.innerHTML = `<div class="ss-zone" style="left:${pct(-zoneL)}%;right:${100 - pct(zoneL)}%"></div>`
      + `<div class="ss-mark now" style="left:${pct(s.T)}%"></div>`
      + (preview !== null ? `<div class="ss-mark pre${willFall ? ' bad' : ''}" style="left:${pct(preview)}%"></div>` : '');
    root.append(meter);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    const lastText = () => {
      if (!s.last) return '';
      if (s.last.pass) return `${nameP(s.last.p)}がパスした。`;
      return `${nameP(s.last.p)}が重さ${s.last.w}を${s.last.x < 0 ? '左' : '右'}の${Math.abs(s.last.x)}にのせた。`;
    };
    if (over) {
      msg.textContent = fallen ? `${nameP(s.last.p)}が重さ${s.last.w}を${s.last.x < 0 ? '左' : '右'}の${Math.abs(s.last.x)}にのせて落ちた！` : 'ぴったり釣り合いました！';
    } else if (picked) {
      msg.textContent = willFall ? `💥 ここにのせると落ちる！（傾き ${Math.abs(preview)}・限界 ${L}）` : `ここなら大丈夫（傾き ${Math.abs(preview)}・限界 ${L}）。もう一度押すとのせる`;
    } else {
      // 限界は「次にのせたあと」の値なので、いまの傾きが限界より大きいこともある（緑の外。のせて戻せば落ちない）
      msg.textContent = `${lastText()}いまの傾き ${Math.abs(s.T)}。のせたあと ${L} を超えたら落ちる`;
    }
    root.append(msg);

    if (can) {
      const act = document.createElement('div');
      act.className = 'cc-actions';
      const go = document.createElement('button');
      go.type = 'button';
      go.className = 'btn primary';
      go.textContent = picked ? (willFall ? 'ここにのせる（落ちる）' : 'ここにのせる') : '置く場所を選ぼう';
      go.disabled = !picked;
      go.onclick = () => { const x = picked.x; picked = null; o.onMove({ t: 'put', x }); };
      act.append(go);
      if (s.rules.pass && me !== null && s.turn === me) {
        const ps = document.createElement('button');
        ps.type = 'button';
        ps.className = 'btn secondary';
        ps.textContent = s.passed[me] ? 'パスは使った' : 'パス（この回戦で1回）';
        ps.disabled = s.passed[me];
        ps.onclick = () => { picked = null; o.onMove({ t: 'pass' }); };
        act.append(ps);
      }
      root.append(act);
    }
  },
};
