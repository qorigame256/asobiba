// じゃんけん階段（昔の遊びの「グリコ」）。全員でじゃんけんし、勝った手の人が全員、手に合った段数だけ階段を上る。2〜6人・足りない分は CPU。
// 2026-10-30 本人の決定（Claude が出した案「グリコ」から本人が選んだ。分かれ目はすべて Claude の推奨を本人が承認）:
//   - 画面の名前は「じゃんけん階段」（「グリコ」は会社の名前のため）。掛け声は昔ながらの「グリコ」「チヨコレイト」「パイナツプル」のまま。
//   - グーは3段、チョキとパーは6段。全員で一度にじゃんけんし、勝った手の人が全員進む。あいこはやり直す。
//   - 階段は30段（詳細設定で20段・50段も）。ゴールはちょうどでなくてよい。
// Claude の判断:
//   - 全員が選び終わったら一斉に開く（あっち向いてホイ・指スマと同じ。通信の遅れで「じゃんけんぽん」の瞬間は画面どうしで合わせられないため）。
//   - 同じ回に2人以上がゴールしたら、その人たちは同じ1位。ほかの人は上った段の多い順に順位（同じ段なら同じ順位）。
//   - 300回（あいこを含む）で決着が付かなければ、そのときの段で順位を付けて終わる（あいこばかり続いたとき）。
//   - CPU はどの手も適当に選ぶ。
// 手: { p, t: 'pick', r: 何回目か, v: 'g' | 'c' | 'p' }
//   r と「この回はもう選んだか」で、同じ手が2回来ても2回目は反則になる。

import { jankenWinner } from './acchi.js';
import { SEAT_COLORS, replaySteps, restartReplay, seen } from './party.js';
import { reachTag } from './util.js';

const HANDS = { g: '✊', c: '✌️', p: '✋' };
const HAND_NAME = { g: 'グー', c: 'チョキ', p: 'パー' };
export const STEPS = { g: 'グリコ', c: 'チヨコレイト', p: 'パイナツプル' }; // 1文字で1段
const GOALS = [[20, '20段'], [30, '30段'], [50, '50段']];
const MAX_ROUNDS = 300;

const goalOf = (s) => (GOALS.some(([v]) => v === s.rules.goal) ? s.rules.goal : 30);
const clone = (s) => ({ ...s, pos: s.pos.slice(), picks: s.picks.slice() });
const ended = (s) => s.pos.some((v) => v >= goalOf(s)) || s.r > MAX_ROUNDS;
// 席ごとの順位（1 から。上った段の多い順、同じ段は同じ順位。ゴールした人はみな goal 段として数える）
const placesOf = (s) => {
  const v = s.pos.map((x) => Math.min(x, goalOf(s)));
  return v.map((x) => 1 + v.filter((y) => y > x).length);
};

let sel = { key: null, v: null };

export default {
  id: 'kaidan',
  name: 'じゃんけん階段',
  icon: '🪜',
  desc: 'じゃんけんで勝ったら グリコで3段・チヨコレイトとパイナツプルで6段',
  ready: true,
  multi: true,
  realtime: true,
  minPlayers: 2,
  maxPlayers: 6,
  settings: [
    { key: 'goal', label: '階段の数', desc: '先にこの段まで上った人の勝ち', def: 30, choices: GOALS },
  ],

  init(n, seed, { rules = {} } = {}) {
    return { n, rules: { goal: 30, ...rules }, r: 1, picks: Array(n).fill(null), pos: Array(n).fill(0), last: null, step: 0 };
  },

  turn() { return null; },
  canAct(s, p) { return !ended(s) && s.picks[p] === null; },
  result(s) {
    if (!ended(s)) return null;
    const place = placesOf(s);
    return { winners: place.map((v, p) => (v === 1 ? p : -1)).filter((p) => p >= 0), place, pos: s.pos.slice() };
  },
  sound(a, b, m, me) {
    if (b.r === a.r) return 'pop';
    const L = b.last;
    if (L.win === null) return 'pop';
    return L.picks[me] === L.win ? 'correct' : 'card';
  },
  cpuDelay() { return 900; },
  resultText(res, me, pn) {
    if (res.winners.length === 1) return res.winners[0] === me ? 'あなたの勝ち！🎉' : `${pn(res.winners[0])}の勝ち！`;
    return `${res.winners.map((p) => (p === me ? 'あなた' : pn(p))).join('・')}が同時にゴール！`;
  },
  phaseText(s, me) {
    const done = s.picks.filter((x) => x !== null).length;
    if (me >= 0 && s.picks[me] !== null) return `じゃんけん… ほかの人を待っています（${done}/${s.n}人）`;
    return `<b>じゃんけん…</b> 選んでください（${done}/${s.n}人が選んだ）`;
  },

  apply(s0, m) {
    if (!m || m.t !== 'pick' || !Number.isInteger(m.p) || m.p < 0 || m.p >= s0.n) return null;
    if (!this.canAct(s0, m.p) || m.r !== s0.r || !Object.hasOwn(HANDS, m.v)) return null;
    const s = clone(s0);
    s.step += 1;
    s.picks[m.p] = m.v;
    if (!s.picks.every((x) => x !== null)) return s;
    // 全員そろったので開く
    const picks = s.picks.slice();
    const win = jankenWinner(picks);
    const from = s.pos.slice();
    if (win !== null) picks.forEach((h, p) => { if (h === win) s.pos[p] += STEPS[win].length; });
    s.last = { r: s.r, picks, win, from };
    s.r += 1;
    s.picks = Array(s.n).fill(null);
    return s;
  },

  // CPU: どれも適当に選ぶ
  cpu(s) {
    const list = Object.keys(HANDS);
    return { t: 'pick', r: s.r, v: list[Math.floor(Math.random() * list.length)] };
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const key = `${s.n}:${s.r}`;
    if (sel.key !== key) sel = { key, v: null };
    const res = this.result(s);
    const L = s.last;
    const goal = goalOf(s);
    const anim = o.fresh && s.picks.every((x) => x === null);
    root.innerHTML = '';
    root.className = 'board ys ac kd';

    if (L) {
      const banner = document.createElement('div');
      banner.className = 'ys-last' + (L.win !== null ? ' hit' : '') + (anim ? ' pop' : '');
      if (L.win === null) banner.textContent = 'あいこ！ もう一度じゃんけん';
      else {
        const who = L.picks.map((h, p) => (h === L.win ? nameP(p) : null)).filter(Boolean).join('・');
        banner.textContent = `${HAND_NAME[L.win]}の勝ち！ 「${[...STEPS[L.win]].join('・')}」で${who}が${STEPS[L.win].length}段`;
      }
      root.append(banner);
    }

    // 階段（2026-11-26 の UI・UX の13回目。本人が全部採用。extra-games.md）: 全員のコマを1つの階段に並べ、勝った人のコマが1段ずつ跳ねて上る。
    // 跳ねるたびに掛け声の字（パ・イ・ナ・ツ・プ・ル）が1文字ずつ出る（前は名前の横の棒が伸びるだけ）。同じ段のコマは上へ積む。
    // 1段0.26秒・0.25秒おいてから（party.js の replaySteps。描き直しても続きから。その回の結果を開いた瞬間に見た画面だけ動かし、あとから開いた画面は上ったあとの形）
    const stairs = document.createElement('div');
    stairs.className = 'kd-stairs';
    const hill = document.createElement('div');
    hill.className = 'kd-hill';
    const N = goal + 1;
    const stepH = (i) => 8 + (i / goal) * 112;
    for (let i = 0; i <= goal; i++) {
      const st = document.createElement('div');
      st.className = 'kd-step' + (i === goal ? ' goal' : '');
      st.style.left = `${(i / N) * 100}%`;
      st.style.width = `calc(${100 / N}% + 1px)`;
      st.style.height = `${stepH(i)}px`;
      hill.append(st);
    }
    const flag = document.createElement('span');
    flag.className = 'kd-flag';
    flag.textContent = '🏁';
    flag.style.left = `${((goal + 0.5) / N) * 100}%`;
    flag.style.bottom = `${stepH(goal) + 2}px`;
    const chantEl = document.createElement('div');
    chantEl.className = 'kd-chant';
    hill.append(flag, chantEl);
    const pieces = [...Array(s.n).keys()].map((p) => {
      const pc = document.createElement('div');
      pc.className = 'kd-piece' + (p === me ? ' mine' : '');
      pc.style.background = SEAT_COLORS[p % SEAT_COLORS.length];
      pc.textContent = [...nameP(p)][0] ?? '';
      pc.title = nameP(p);
      hill.append(pc);
      return pc;
    });
    const place = (at) => {
      const stack = new Map();
      at.forEach((x, p) => {
        const v = Math.min(x, goal);
        const k = stack.get(v) ?? 0;
        stack.set(v, k + 1);
        pieces[p].style.left = `${((v + 0.5) / N) * 100}%`;
        pieces[p].style.bottom = `${stepH(v) + 2 + k * 14}px`;
      });
    };
    stairs.append(hill);
    for (let p = 0; p < s.n; p++) {
      const row = document.createElement('div');
      row.className = 'kd-row' + (p === me ? ' mine' : '');
      const dot = document.createElement('span');
      dot.className = 'kd-dot';
      dot.style.background = SEAT_COLORS[p % SEAT_COLORS.length];
      const name = document.createElement('div');
      name.className = 'kd-name';
      name.textContent = nameP(p);
      const v = Math.min(s.pos[p], goal);
      const num = document.createElement('div');
      num.className = 'kd-num';
      num.textContent = `${v}/${goal}段`;
      // あと一歩の人に印（2026-11-13。room.md「UI・UX の6回目」）: 次に1回勝てばどの手でも（いちばん短いグリコの3段でも）ゴールに届く人
      if (!res && v < goal && goal - v <= 3) name.append(reachTag('あと1勝'));
      row.append(dot, name, num);
      stairs.append(row);
    }
    root.append(stairs);
    const chant = L && L.win !== null ? [...STEPS[L.win]] : [];
    const climbers = chant.length ? [...Array(s.n).keys()].filter((p) => L.picks[p] === L.win) : [];
    const akey = L ? `kaidan:${L.r}:${L.from.join()}:${s.pos.join()}` : '';
    if (chant.length && anim) restartReplay(akey); // 開いた瞬間の画面は今から動かす（party.js の restartReplay）
    if (chant.length && (anim || seen('replay:' + akey))) {
      let was = 0;
      replaySteps(akey, hill, chant.length, chant.length * 260, (k) => {
        place(s.pos.map((x, p) => (climbers.includes(p) ? Math.min(L.from[p] + k, x) : x)));
        if (k === was + 1) {
          const ch = document.createElement('span');
          ch.textContent = chant[k - 1];
          chantEl.append(ch);
          for (const p of climbers) {
            if (L.from[p] + k > Math.min(s.pos[p], goal)) continue; // ゴールに着いたコマは止まる
            pieces[p].classList.remove('hop');
            void pieces[p].offsetWidth;
            pieces[p].classList.add('hop');
          }
        } else chantEl.textContent = chant.slice(0, k).join('');
        was = k;
      }, 250);
    } else {
      place(s.pos);
      chantEl.textContent = chant.join('');
    }

    // 全員が出した手（前の回）
    const grid = document.createElement('div');
    grid.className = 'ys-players';
    const seats = me === null ? [...Array(s.n).keys()] : [...Array(s.n).keys()].map((k) => (me + k) % s.n);
    for (const p of seats) {
      const box = document.createElement('div');
      box.className = 'ys-player' + (p === me ? ' mine' : '') + (L && L.win !== null && L.picks[p] === L.win ? ' parent' : '');
      const head = document.createElement('div');
      head.className = 'ys-name';
      head.textContent = nameP(p);
      const tags = [];
      if (res) { tags.push(res.place[p] === 1 ? ['rank', '1位'] : ['last', `${res.place[p]}位`]); }
      else tags.push(s.picks[p] !== null ? ['ok', '選んだ✓'] : ['away', '考え中…']);
      if (o.away[p]) tags.push(['away', '応答なし']);
      else if (o.sub?.[p]) tags.push(['away', 'CPU が代わりに']);
      for (const [cls, text] of tags) {
        const t = document.createElement('span');
        t.className = 'cc-tag ' + cls;
        t.textContent = text;
        head.append(t);
      }
      const show = document.createElement('div');
      show.className = 'ys-thumbs' + (anim ? ' pop' : '');
      show.textContent = L ? HANDS[L.picks[p]] : '❔';
      box.append(head, show);
      grid.append(box);
    }
    root.append(grid);

    const note = (t) => { const x = document.createElement('p'); x.className = 'cc-log'; x.textContent = t; root.append(x); };
    if (res) return;
    if (me === null) { note(`観戦中（${goal}段でゴール）`); return; }
    if (!o.canMove) { note(`${HAND_NAME[s.picks[me]]}で決めました。ほかの人を待っています…`); return; }

    const box = document.createElement('div');
    box.className = 'ys-pick';
    const h = document.createElement('div');
    h.className = 'cc-hand-head';
    h.textContent = `じゃんけん…（${goal}段でゴール）`;
    const row = document.createElement('div');
    row.className = 'ys-choices ac-choices';
    for (const v of Object.keys(HANDS)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'ys-choice ac-choice kd-choice' + (sel.v === v ? ' on' : '');
      b.innerHTML = `<span>${HANDS[v]}</span><small>${STEPS[v].length}段</small>`;
      b.title = `${HAND_NAME[v]}（${STEPS[v]}）`;
      b.setAttribute('aria-label', b.title);
      b.onclick = () => { sel.v = v; o.onMove({ t: 'pick', r: s.r, v }); };
      row.append(b);
    }
    box.append(h, row);
    root.append(box);
  },
};
