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
//   - 重りのくじは種と何個目かから決める（全員の端末で同じ）。次の人の重りは見せない。
//   - CPU は落ちない場所から、半分は傾きがいちばん小さくなる所、半分はでたらめに選ぶ（落ちない場所が無ければでたらめ）。
// 手: { p, t: 'put', x: 支点からの位置（-5〜-1・1〜5） }

import { mulberry32 } from './util.js';
import { SEAT_COLORS } from './party.js';

export const SPOTS = [-5, -4, -3, -2, -1, 1, 2, 3, 4, 5];
export const weightOf = (seed, k) => 1 + Math.floor(mulberry32((seed ^ Math.imul(k + 11, 0x9e3779b1)) >>> 0)() * 3);
// k 個のっているときに次の1つをのせたあとの限界
export const limitOf = (k) => 2 * (SPOTS.length - k - 1);
export const MAX_LIMIT = limitOf(0);
const DEG = 0.9; // 傾き1あたりの角度（度）
const angleOf = (T) => Math.max(-18, Math.min(18, T * DEG));
const clone = (s) => ({ ...s, placed: s.placed.slice() });
const free = (s) => SPOTS.filter((x) => !s.placed.some((v) => v.x === x));

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

  init(n, seed) {
    return { n, seed, rules: {}, turn: 0, placed: [], T: 0, phase: 'play', last: null, step: 0 };
  },

  turn(s) { return s.phase === 'play' ? s.turn : null; },
  canAct(s, p) { return s.phase === 'play' && s.turn === p; },
  result(s) {
    if (s.phase !== 'end') return null;
    const all = [...Array(s.n).keys()];
    if (!s.last.fell) return { winners: all, draw: true };
    return { winners: all.filter((p) => p !== s.last.p), loser: s.last.p };
  },
  resultText(res, me, pn) {
    if (res.draw) return '⚖️ 全部のせて、ぴったり釣り合った！ 全員の勝ち🎉';
    if (res.loser === me) return '💥 シーソーが落ちた！あなたの負け…';
    return `💥 ${pn(res.loser)}がシーソーを落とした！${me !== null && me >= 0 ? 'セーフ！あなたの勝ち🎉' : ''}`;
  },
  sound() { return 'wall'; },

  apply(s0, m) {
    if (!m || m.t !== 'put' || !this.canAct(s0, m.p) || !SPOTS.includes(m.x) || !free(s0).includes(m.x)) return null;
    const s = clone(s0);
    s.step += 1;
    const k = s0.placed.length;
    const w = weightOf(s.seed, k);
    s.placed.push({ x: m.x, w, p: m.p });
    s.T = s0.T + w * m.x;
    const fell = Math.abs(s.T) > limitOf(k);
    s.last = { p: m.p, x: m.x, w, fell, from: s0.T };
    if (fell || s.placed.length === SPOTS.length) s.phase = 'end';
    else s.turn = (s.turn + 1) % s.n;
    return s;
  },

  cpuDelay() { return 900; },
  cpu(s) {
    const w = weightOf(s.seed, s.placed.length);
    const L = limitOf(s.placed.length);
    const open = free(s);
    const safe = open.filter((x) => Math.abs(s.T + w * x) <= L);
    if (!safe.length) return { t: 'put', x: open[Math.floor(Math.random() * open.length)] };
    if (Math.random() < 0.5) return { t: 'put', x: safe[Math.floor(Math.random() * safe.length)] };
    return { t: 'put', x: safe.reduce((a, b) => (Math.abs(s.T + w * a) <= Math.abs(s.T + w * b) ? a : b)) };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me && !o.watching ? 'あなた' : o.names[p]);
    const res = this.result(s);
    const k = s.placed.length;
    const key = `${s.seed}:${k}`;
    const can = o.canMove && s.phase === 'play';
    if (picked?.key !== key || !can) picked = null;
    const draw = () => this.render(root, s, o);
    const w = s.phase === 'play' ? weightOf(s.seed, k) : null;
    const L = s.phase === 'play' ? limitOf(k) : null;
    const preview = picked ? s.T + w * picked.x : null;
    const willFall = preview !== null && Math.abs(preview) > L;
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
      if (res?.loser === p) st.innerHTML = '<span class="pt-ng">💥 落とした</span>';
      chip.append(st);
      if (o.away[p] || o.sub?.[p]) chip.append(Object.assign(document.createElement('span'), { className: 'cc-tag away', textContent: o.away[p] ? '応答なし' : 'CPU が代わりに' }));
      chips.append(chip);
    }
    root.append(chips);

    // 次の重り
    const head = document.createElement('div');
    head.className = 'ss-head';
    if (s.phase === 'play') {
      head.innerHTML = `<span class="ss-next" style="--w:${w}">${w}</span>`;
      const t = document.createElement('span');
      t.textContent = `${nameP(s.turn)}の重り（重さ${w}）`;
      head.append(t);
    } else head.textContent = res.draw ? '⚖️ 10個ぜんぶのった！' : '💥 落ちた！';
    root.append(head);

    // シーソー（SVG）。横400、支点は (200, 150)
    const ns = 'http://www.w3.org/2000/svg';
    const mk = (tag, attrs) => {
      const e = document.createElementNS(ns, tag);
      for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, v);
      return e;
    };
    // 上は傾いて上がった端に一番大きい重りがのっても入る高さ（18度で端が約58上がる＋重り32）だけ取る
    const svg = mk('svg', { viewBox: '0 52 400 140', class: 'ss-svg' + (res && !res.draw ? ' fall' : '') });
    svg.append(mk('polygon', { points: '200,152 178,186 222,186', class: 'ss-pivot' }));
    svg.append(mk('rect', { x: 10, y: 185, width: 380, height: 4, rx: 2, class: 'ss-ground' }));
    const plank = mk('g', { class: 'ss-plank' });
    const shownT = preview ?? s.T;
    const end = res && !res.draw ? Math.sign(s.T) * 26 : null; // 落ちたら大きく傾ける
    const to = end ?? angleOf(shownT);
    plank.style.setProperty('--to', `${to}deg`);
    if (o.fresh && s.last && !picked) {
      plank.style.setProperty('--from', `${angleOf(s.last.from)}deg`);
      plank.classList.add('move');
    }
    plank.style.transform = `rotate(${to}deg)`;
    plank.append(mk('rect', { x: 12, y: 144, width: 376, height: 10, rx: 4, class: 'ss-board' }));
    const X = (x) => 200 + x * 36;
    for (const x of SPOTS) {
      const v = s.placed.find((e) => e.x === x);
      const g = mk('g', { class: 'ss-spot' + (v ? ' full' : '') + (picked?.x === x ? ' sel' : '') });
      g.append(mk('text', { x: X(x), y: 152, class: 'ss-dist' })); // 板の上に支点からの距離
      g.lastChild.textContent = Math.abs(x);
      const show = v ?? (picked?.x === x ? { w, p: s.turn, ghost: true } : null);
      if (show) {
        const size = 14 + show.w * 6;
        const blk = mk('g', { class: 'ss-wt' + (show.ghost ? ' ghost' : '') + (o.fresh && s.last?.x === x && !show.ghost ? ' drop' : '') });
        blk.append(mk('rect', { x: X(x) - size / 2, y: 144 - size, width: size, height: size, rx: 4, fill: SEAT_COLORS[show.p % SEAT_COLORS.length] }));
        const t = mk('text', { x: X(x), y: 144 - size / 2 + 5, class: 'ss-wt-n' });
        t.textContent = show.w;
        blk.append(t);
        g.append(blk);
      } else g.append(mk('circle', { cx: X(x), cy: 139, r: 4, class: 'ss-dot' }));
      if (can && !v) {
        const hit = mk('rect', { x: X(x) - 18, y: 70, width: 36, height: 105, class: 'ss-hit' });
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
    const pct = (T) => 50 + (Math.max(-MAX_LIMIT - 4, Math.min(MAX_LIMIT + 4, T)) / (MAX_LIMIT + 4)) * 50;
    const zoneL = L ?? 0;
    meter.innerHTML = `<div class="ss-zone" style="left:${pct(-zoneL)}%;right:${100 - pct(zoneL)}%"></div>`
      + `<div class="ss-mark now" style="left:${pct(s.T)}%"></div>`
      + (preview !== null ? `<div class="ss-mark pre${willFall ? ' bad' : ''}" style="left:${pct(preview)}%"></div>` : '');
    root.append(meter);

    const msg = document.createElement('p');
    msg.className = 'cc-log';
    if (res) {
      msg.textContent = res.draw ? 'ぴったり釣り合いました！' : `${nameP(s.last.p)}が重さ${s.last.w}を${s.last.x < 0 ? '左' : '右'}の${Math.abs(s.last.x)}にのせて落ちた！`;
    } else if (picked) {
      msg.textContent = willFall ? `💥 ここにのせると落ちる！（傾き ${Math.abs(preview)}・限界 ${L}）` : `ここなら大丈夫（傾き ${Math.abs(preview)}・限界 ${L}）。もう一度押すとのせる`;
    } else {
      // 限界は「次にのせたあと」の値なので、いまの傾きが限界より大きいこともある（緑の外。のせて戻せば落ちない）
      const last = s.last ? `${nameP(s.last.p)}が重さ${s.last.w}を${s.last.x < 0 ? '左' : '右'}の${Math.abs(s.last.x)}にのせた。` : '';
      msg.textContent = `${last}いまの傾き ${Math.abs(s.T)}。のせたあと ${L} を超えたら落ちる`;
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
      root.append(act);
    }
  },
};
