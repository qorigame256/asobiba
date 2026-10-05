// マンカラ（カラハ）。2人。自分の側に穴が6つと、右はしにゴールが1つ。最初は穴1つに石4個（詳細設定で3〜6個）。
// 自分の番に、自分の側の穴を1つ選び、その石を全部取って、反時計回りに1個ずつ配る（相手のゴールは飛ばす）。
// 最後の1個が自分のゴールに入ったら、もう1回。最後の1個が自分の側の空いた穴に入り、向かいの相手の穴に石があれば、
// その両方をとって自分のゴールへ入れる（2026-10-05 本人承認）。
// どちらかの側の穴が全部空になったら終わり。残った石はその側の持ち主のゴールへ入れ、ゴールの石が多いほうの勝ち。
// 穴の番号: 0〜5 = 先手の穴（左から右）、6 = 先手のゴール、7〜12 = 後手の穴（先手から見て右から左）、13 = 後手のゴール。
// 手 = 自分の側の穴の何番目か（0〜5。左から。先手は 0〜5、後手は 7〜12 にあたる）。

import { CPU_SETTING, boardCpu } from './util.js';

const STORE = [6, 13];
const pitOf = (p, k) => p * 7 + k;
const side = (s, p) => s.pits.slice(p * 7, p * 7 + 6);
const legal = (s) => [0, 1, 2, 3, 4, 5].filter((k) => s.pits[pitOf(s.turn, k)] > 0);

const game = {
  id: 'mancala',
  name: 'マンカラ',
  icon: '🫘',
  desc: '穴の石を1個ずつ配っていき、自分のゴールに多く集めた方の勝ち',
  ready: true,
  players: ['先手', '後手'],
  settings: [
    { key: 'stones', label: '最初の石の数', desc: '穴1つあたり。多いほど長くなる', def: 4, choices: [[3, '3個'], [4, '4個'], [5, '5個'], [6, '6個']] },
    CPU_SETTING,
  ],

  init({ rules = {} } = {}) {
    const n = [3, 4, 5, 6].includes(rules.stones) ? rules.stones : 4;
    const pits = Array(14).fill(n);
    pits[6] = 0;
    pits[13] = 0;
    return { pits, turn: 0, last: null, over: false, count: 0 };
  },

  turn(s) { return s.turn; },

  apply(s, k) {
    if (s.over || !Number.isInteger(k) || k < 0 || k > 5) return null;
    const p = s.turn;
    const from = pitOf(p, k);
    if (!s.pits[from]) return null;
    const pits = s.pits.slice();
    let hand = pits[from];
    pits[from] = 0;
    let i = from;
    const sown = [];
    while (hand > 0) {
      i = (i + 1) % 14;
      if (i === STORE[1 - p]) continue;
      pits[i] += 1;
      hand -= 1;
      sown.push(i);
    }
    const last = { p, from, sown, extra: false, capture: null };
    let turn = 1 - p;
    if (i === STORE[p]) {
      last.extra = true;
      turn = p;
    } else if (i >= p * 7 && i < p * 7 + 6 && pits[i] === 1 && pits[12 - i] > 0) {
      const got = pits[12 - i] + 1;
      last.capture = { at: i, opp: 12 - i, got };
      pits[STORE[p]] += got;
      pits[i] = 0;
      pits[12 - i] = 0;
    }
    const t = { pits, turn, last, over: false, count: s.count + 1 };
    // どちらかの側が空になったら、残りをそれぞれのゴールへ
    if (side(t, 0).every((x) => !x) || side(t, 1).every((x) => !x)) {
      for (const q of [0, 1]) {
        for (let j = 0; j < 6; j++) {
          pits[STORE[q]] += pits[pitOf(q, j)];
          pits[pitOf(q, j)] = 0;
        }
      }
      t.over = true;
    }
    return t;
  },

  result(s) {
    if (!s.over) return null;
    const [a, b] = [s.pits[6], s.pits[13]];
    return { winner: a === b ? null : a > b ? 0 : 1, cells: [] };
  },

  // CPU: 何手か先まで読む（ゴールの石の差で点を付ける）。よわいは浅く、ときどき適当に打つ
  cpu(s, p, rules) {
    const score = (t, who) => t.pits[STORE[who]] - t.pits[STORE[1 - who]];
    return boardCpu(game, s, rules, legal, score, {
      depth: { weak: 1, normal: 3, strong: 6 },
      mistake: { weak: 0.3, normal: 0.12, strong: 0 },
    });
  },

  info(s) {
    const l = s.last;
    if (!l || s.over) return '';
    const name = game.players[l.p];
    if (l.extra) return `<b class="pl p${l.p}">${name}</b>はゴールで止まったので、もう1回！`;
    if (l.capture) return `<b class="pl p${l.p}">${name}</b>が向かいの石をとった（${l.capture.got}個）`;
    return '';
  },

  render(root, s, o) {
    const res = this.result(s);
    const bottom = o.me === 1 ? 1 : 0; // 自分の側を下に
    const top = 1 - bottom;
    root.innerHTML = '';
    root.className = 'board mc';
    const sown = new Set(o.fresh && s.last ? s.last.sown : []);

    const pitEl = (i, owner) => {
      const store = i === STORE[owner];
      const k = i - owner * 7;
      const can = !store && !res && o.canMove && owner === s.turn && s.pits[i] > 0;
      const e = document.createElement(can ? 'button' : 'div');
      if (can) {
        e.type = 'button';
        e.onclick = () => o.onMove(k);
        e.setAttribute('aria-label', `${k + 1}番目の穴（石${s.pits[i]}個）`);
      }
      e.className = 'mc-pit p' + owner + (store ? ' store' : '') + (can ? ' playable' : '') + (sown.has(i) ? ' sown' : '')
        + (s.last?.from === i ? ' from' : '') + (s.last?.capture && (s.last.capture.at === i || s.last.capture.opp === i) ? ' cap' : '');
      const stones = document.createElement('div');
      stones.className = 'mc-stones';
      const shown = Math.min(s.pits[i], store ? 0 : 12);
      for (let j = 0; j < shown; j++) {
        const d = document.createElement('i');
        d.style.setProperty('--h', ((i * 7 + j * 53) % 360) + 'deg');
        stones.append(d);
      }
      const num = document.createElement('div');
      num.className = 'mc-num';
      num.textContent = s.pits[i];
      e.append(stones, num);
      if (store) {
        const who = document.createElement('div');
        who.className = 'mc-who';
        who.textContent = game.players[owner];
        e.append(who);
      }
      return e;
    };

    const wrap = document.createElement('div');
    wrap.className = 'mc-wrap';
    wrap.append(pitEl(STORE[top], top)); // 左はし = 上の人のゴール
    const mid = document.createElement('div');
    mid.className = 'mc-mid';
    const rowTop = document.createElement('div');
    rowTop.className = 'mc-row';
    for (let k = 5; k >= 0; k--) rowTop.append(pitEl(pitOf(top, k), top)); // 上の人の穴は右から左へ進む
    const rowBottom = document.createElement('div');
    rowBottom.className = 'mc-row';
    for (let k = 0; k < 6; k++) rowBottom.append(pitEl(pitOf(bottom, k), bottom));
    mid.append(rowTop, rowBottom);
    wrap.append(mid, pitEl(STORE[bottom], bottom)); // 右はし = 下の人のゴール
    root.append(wrap);

    const note = document.createElement('p');
    note.className = 'cc-log';
    note.textContent = res ? `ゴールの石: ${game.players[0]} ${s.pits[6]}個 ／ ${game.players[1]} ${s.pits[13]}個`
      : '下の列が' + (Number.isInteger(o.me) && o.me >= 0 ? 'あなた' : game.players[bottom]) + 'の穴、右はしがゴール。石は反時計回りに配ります';
    root.append(note);
  },
};

export default game;
