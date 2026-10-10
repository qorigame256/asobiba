// ワードウルフ。3〜10人。全員に言葉（お題）が配られるが、1人（ウルフ）だけ似ているけれど違う言葉をもらう。自分がどちらかは分からない。
// 話し合いは通話などで声でする（2026-10-05 本人の決定。画面はお題を配る・残り時間を出す・投票するだけ）。
// 時間が来るか誰かが「投票へ」を押したら、全員が「ウルフだと思う人」に投票する。
//   いちばん票の多い人がウルフでなければウルフの勝ち。ウルフなら、ウルフが多数派の言葉を当てれば逆転でウルフの勝ち（2026-10-05 本人の決定）、
//   外せばほかの全員の勝ち。言葉の答え合わせは、ひらがなにそろえて同じなら自動で正解、違えば多数派の人が「正解／ちがう」を押す。
// 決まりごと（Claude の判断）: ウルフは1人。同じ票数で並んだら、並んだ人だけで1回やり直し、それでも並んだらウルフの勝ち。
// CPU は入れられない（話せないため）。部屋を出た人の票は適当に入れ、出たウルフは言葉を当てずに負け。
// 詳細設定「ウルフの数」で2人にもできる（2026-10-05 本人の決定。決まりは Claude の推奨を本人が承認）:
//   2人になるのは7人以上のときだけ（6人以下では1人）。2人のウルフは同じお題で、お互いがウルフだとは知らない。
//   いちばん票の多い人がどちらかのウルフなら、そのウルフがみんなのお題を当てれば逆転（当てられなければウルフ以外の勝ち）。
//   ウルフ側が勝てば2人とも勝ち。答え合わせはウルフ以外の人がする。
// 詳細設定「ウルフのお題」でお題なしにもできる（2026-10-06 本人の決定。決まりは Claude の推奨を本人が承認）: ウルフ（2人なら2人とも）に白紙を配る。
//   ウルフ本人は自分がウルフだと分かる（本人に説明済み）。勝ち負けの決まりは同じ（選ばれてもみんなのお題を当てれば逆転）。words[1] は 'お題なし' にする。
// 詳細設定「ウルフがいない回」（2026-10-08 の22回目の案。最初はなし。細かい所は Claude の判断）: ありのとき、4回に1回ほど（種から決める）
//   ウルフがいない回になり、全員が同じお題をもらう（だれにも知らせない。お題なしの遊び方でも、全員にお題が書かれている）。
//   投票に「ウルフはいない」（手の to = -1）を足す。いちばん票が多いのが「ウルフはいない」なら、本当にいなければ全員の勝ち、いればウルフの勝ち（逃げ切り）。
//   ウルフがいない回に、だれかがいちばん票を集めたら（ウルフではないので）全員の負け。並んだときのやり直しは今までどおりで（「ウルフはいない」も並べば候補に入る）、
//   やり直しでも並んだら、いない回は全員の負け・いる回はウルフの勝ち。局面の peace（なしのときは持たない）。ウルフの数が2人でも、いない回は0人。
const WOLF2_MIN = 7; // ウルフ2人になる最少の人数
const PEACE_ODDS = 0.25; // ウルフがいない回になる見込み
const NONE = -1; // 投票の「ウルフはいない」
// 手: { p, t: 'tovote' }（p = -1 はホストの時間切れ）/ { p, t: 'vote', to（-1 は「ウルフはいない」）, v: 何回目の投票か } / { p, t: 'guess', text } / { p, t: 'giveup' } / { p, t: 'judge', ok }

import { mulberry32, esc } from './util.js';
import { kana, timeBar, since } from './party.js';
import { PAIRS } from './wordwolf-data.js';

const MAX_TEXT = 30;
const clone = (s) => ({ ...s, votes: { ...s.votes }, history: s.history.slice() });
const isWolf = (s, p) => s.wolves.includes(p);
// 画面で言うウルフの数（ウルフがいない回でも、いない回だと分からないように設定どおりの数）
const wolfN = (s) => (s.peace ? s.wolfCount : s.wolves.length);

export default {
  // 自分のお題の下に出す説明。似た言葉では、ウルフかどうかで文を変えない（変えると自分の役が分かる。2026-10-10 の Codex の点検で見つかった）
  tipText(s, me) {
    const many = wolfN(s) > 1 ? '2人' : '1人';
    return (!s.blank ? `みんなと同じお題か、${many}だけ違うお題（ウルフ）かは分かりません`
      : isWolf(s, me) ? 'あなたがウルフです。みんなの話からお題を探り、話を合わせて隠れましょう' : `お題が書かれていない人（ウルフ）が${many}まぎれています`)
      + (s.peace && !(s.blank && isWolf(s, me)) ? '（ウルフがいない回もあります）' : '');
  },
  id: 'wordwolf',
  name: 'ワードウルフ',
  icon: '🐺',
  desc: '1人だけ違うお題をもらった「ウルフ」を、通話で話し合って探す。3人から',
  ready: true,
  multi: true,
  realtime: true,
  noCpu: true,
  minPlayers: 3,
  maxPlayers: 10,
  settings: [
    { key: 'wolves', label: 'ウルフの数', desc: '2人は7人以上のときだけ（6人以下では1人）。2人のウルフは同じお題で、お互いがウルフだとは知らない', def: 1, choices: [[1, '1人'], [2, '2人（7人以上）']] },
    { key: 'wolfWord', label: 'ウルフのお題', desc: 'お題なしでは、ウルフには何も書かれていない（ウルフ本人は自分がウルフだと分かる）。話を合わせて隠れる', def: 'similar', choices: [['similar', '似た言葉'], ['blank', 'お題なし']] },
    { key: 'peace', label: 'ウルフがいない回', desc: '4回に1回ほど、ウルフがいない回（全員が同じお題）になる。投票に「ウルフはいない」が増え、いない回にそれを当てれば全員の勝ち（外せば全員の負け）', def: false, choices: [[false, 'なし'], [true, 'あり']] },
    { key: 'time', label: '話し合いの時間', desc: '時間が来たら投票に進む（その前に「投票へ」を押してもよい）', def: 3, choices: [[2, '2分'], [3, '3分'], [5, '5分']] },
  ],

  init(n, seed, { rules = {} } = {}) {
    const rng = mulberry32(seed);
    const pair = PAIRS[Math.floor(rng() * PAIRS.length)];
    const flip = rng() < 0.5;
    const wolves = [Math.floor(rng() * n)];
    if (rules.wolves === 2 && n >= WOLF2_MIN) {
      const k = Math.floor(rng() * (n - 1));
      wolves.push(k >= wolves[0] ? k + 1 : k);
    }
    const blank = rules.wolfWord === 'blank';
    const words = flip ? [pair[1], pair[0]] : [pair[0], pair[1]];
    if (blank) words[1] = 'お題なし';
    const peace = rules.peace === true;
    const wolfCount = wolves.length; // 設定どおりのウルフの数（いない回でも画面の言い方を変えないように）
    if (peace && rng() < PEACE_ODDS) wolves.length = 0; // ウルフがいない回（なしのときは乱数の使い方も前と同じ）
    const cands = Array.from({ length: n }, (_, p) => p);
    if (peace) cands.push(NONE);
    return {
      n, seed, words, wolves, blank, // words[0] = 多数派、words[1] = ウルフ
      phase: 'talk', minutes: [2, 3, 5].includes(rules.time) ? rules.time : 3,
      vote: 1, cands, votes: {}, history: [],
      accused: null, guess: null, winSide: null, step: 0,
      ...(peace ? { peace: true, wolfCount } : {}),
    };
  },

  wordOf(s, p) { return s.words[isWolf(s, p) ? 1 : 0]; },
  turn() { return null; },
  canAct(s, p) {
    if (p < 0 || p >= s.n) return false;
    if (s.phase === 'talk') return true;
    if (s.phase === 'vote') return !(p in s.votes);
    if (s.phase === 'guess') return p === s.accused;
    if (s.phase === 'judge') return !isWolf(s, p);
    return false;
  },
  phaseText(s, me) {
    if (s.phase === 'talk') return '話し合いの時間です';
    if (s.phase === 'vote') return me in s.votes || me < 0 ? 'みんなの投票を待っています…' : 'ウルフだと思う人に投票してください';
    if (s.phase === 'guess') return me === s.accused ? 'ばれました！ みんなのお題を当てれば逆転です' : 'ウルフがみんなのお題を考えています…';
    if (s.phase === 'judge') return isWolf(s, me) ? '答え合わせを待っています…' : 'ウルフの答えは合っていますか？';
    return '';
  },
  referee(s) {
    if (s.phase !== 'talk') return null;
    return { key: 'talk', ms: s.minutes * 60000, move: { t: 'tovote' } };
  },
  sound(a, b, m) {
    if (b.phase !== a.phase) return b.phase === 'vote' ? 'turn' : 'question';
    return m.t === 'vote' ? 'pop' : null;
  },

  result(s) {
    if (s.phase !== 'end') return null;
    const all = Array.from({ length: s.n }, (_, p) => p);
    // none = ウルフがいない回に当てられず全員の負け
    const winners = s.winSide === 'wolf' ? s.wolves.slice() : s.winSide === 'none' ? [] : all.filter((p) => !isWolf(s, p));
    return { winner: winners[0], winners, side: s.winSide, ...(s.wolves.length ? {} : { nowolf: true }) };
  },
  resultText(res, me) {
    if (res.side === 'none') return 'ウルフはいなかったのに… みんなの負け';
    if (res.nowolf) return 'ウルフはいませんでした！ みんなの勝ち！🎉';
    if (me < 0) return res.side === 'wolf' ? 'ウルフの勝ち！' : 'ウルフ以外のみんなの勝ち！';
    return res.winners.includes(me) ? 'あなたの勝ち！🎉' : 'あなたの負け…';
  },

  apply(s0, m) {
    if (!m) return null;
    if (m.t === 'tovote') {
      if (s0.phase !== 'talk' || !(m.p === -1 || this.canAct(s0, m.p))) return null;
      const s = clone(s0);
      s.phase = 'vote';
      s.step += 1;
      return s;
    }
    if (!this.canAct(s0, m.p)) return null;
    const s = clone(s0);
    s.step += 1;
    switch (m.t) {
      case 'vote': {
        if (s.phase !== 'vote' || m.v !== s.vote || !Number.isInteger(m.to) || !s.cands.includes(m.to) || m.to === m.p) return null;
        s.votes[m.p] = m.to;
        if (Object.keys(s.votes).length < s.n) return s;
        return tally(s);
      }
      case 'guess': {
        if (s.phase !== 'guess' || typeof m.text !== 'string' || !m.text.trim() || m.text.length > MAX_TEXT) return null;
        s.guess = m.text.trim();
        if (kana(s.guess) === kana(s.words[0])) { s.phase = 'end'; s.winSide = 'wolf'; s.auto = true; } else s.phase = 'judge';
        return s;
      }
      case 'giveup':
        if (s.phase !== 'guess') return null;
        s.phase = 'end';
        s.winSide = 'village';
        return s;
      case 'judge':
        if (s.phase !== 'judge' || typeof m.ok !== 'boolean') return null;
        s.phase = 'end';
        s.winSide = m.ok ? 'wolf' : 'village';
        s.judgedBy = m.p;
        return s;
      default:
        return null;
    }
  },

  // CPU は入らないので、ここに来るのは部屋を出た人の席だけ。話し合いと答え合わせは、残っている人に任せる
  cpuDelay() { return 1500; },
  cpu(s, p) {
    if (s.phase === 'vote') {
      const c = s.cands.filter((q) => q !== p);
      return { t: 'vote', to: c[Math.floor(Math.random() * c.length)], v: s.vote };
    }
    if (s.phase === 'guess') return { t: 'giveup' };
    return null;
  },

  render(root, s, o) {
    const me = o.me >= 0 ? o.me : null;
    const nameP = (p) => (p === me ? 'あなた' : o.names[p]);
    const b = (p) => `<b>${esc(nameP(p))}</b>`;
    const keepInput = s.phase === 'guess' && me === s.accused && root.querySelector('.ww-guess input');
    if (keepInput && ui.key === `${s.seed}:guess`) return; // 打っている途中の入力欄を作り直さない（スマホのキーボードが閉じるため）
    ui.key = `${s.seed}:${s.phase}`;
    root.innerHTML = '';
    root.className = 'board ww';

    // 参加者
    const chips = document.createElement('div');
    chips.className = 'cc-opps';
    for (let p = 0; p < s.n; p++) {
      const chip = document.createElement('div');
      chip.className = 'cc-opp' + (p === me ? ' me' : '') + (s.phase === 'end' && this.result(s).winners.includes(p) ? ' won' : '');
      const name = document.createElement('div');
      name.className = 'cc-opp-name';
      name.textContent = nameP(p);
      chip.append(name);
      const extra = document.createElement('div');
      extra.className = 'pt-extra';
      if (s.phase === 'vote') extra.textContent = p in s.votes ? '投票ずみ' : '考え中';
      else if (s.phase === 'end') extra.textContent = isWolf(s, p) ? `ウルフ（${s.words[1]}）` : s.words[0];
      if (extra.textContent) chip.append(extra);
      if (o.away[p] || (o.sub?.[p])) {
        const t = document.createElement('span');
        t.className = 'cc-tag away';
        t.textContent = o.away[p] ? '応答なし' : '部屋を出ました';
        chip.append(t);
      }
      chips.append(chip);
    }
    root.append(chips);

    // 自分のお題
    if (me !== null && s.phase !== 'end') {
      const card = document.createElement('div');
      card.className = 'ww-card';
      const tip = this.tipText(s, me);
      card.innerHTML = `<div class="um-label">あなたのお題</div><div class="ww-word">${esc(this.wordOf(s, me))}</div><small>${tip}</small>`;
      root.append(card);
    }

    const note = (html) => { const p = document.createElement('p'); p.className = 'cc-log'; p.innerHTML = html; root.append(p); };
    const row = (...els) => { const d = document.createElement('div'); d.className = 'cc-actions um-buttons'; d.append(...els); root.append(d); };

    if (s.phase === 'talk') {
      const key = `ww:${s.seed}:talk`;
      const limit = s.minutes * 60000;
      const left = document.createElement('div');
      left.className = 'ww-left';
      const tick = () => {
        const ms = Math.max(0, limit - since(key));
        left.textContent = `残り ${Math.floor(ms / 60000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`;
      };
      tick();
      const timer = setInterval(() => { if (!left.isConnected) clearInterval(timer); else tick(); }, 500);
      root.append(left, timeBar(key, limit));
      note('通話などで、お題について話し合ってください。お題の言葉そのものは言わないように');
      if (me !== null) row(button('話し合いを終えて投票へ', 'secondary', () => { if (confirm('投票に進みますか？（全員の画面が投票に変わります）')) o.onMove({ t: 'tovote' }); }));
    } else if (s.phase === 'vote') {
      const cand = (c) => (c === NONE ? '<b>ウルフはいない</b>' : b(c));
      if (s.vote === 2) note(`票が並んだので、${s.cands.map(cand).join('・')}の中からもう一度投票します`);
      if (me !== null && o.canMove) {
        note((wolfN(s) > 1 ? 'ウルフ（2人だけ違うお題の人）のどちらかだと思う人は？' : 'ウルフ（1人だけ違うお題の人）だと思う人は？')
          + (s.peace ? '　いないと思ったら「ウルフはいない」' : ''));
        row(...s.cands.filter((p) => p !== me).map((p) => (p === NONE
          ? button('🕊 ウルフはいない', 'secondary', () => o.onMove({ t: 'vote', to: NONE, v: s.vote }))
          : button(nameP(p), 'primary', () => o.onMove({ t: 'vote', to: p, v: s.vote })))));
      } else if (me !== null) {
        note(`${cand(s.votes[me])}に投票しました。みんなを待っています…`);
      }
    } else if (s.phase === 'guess' || s.phase === 'judge') {
      note(`いちばん票が多かったのは ${b(s.accused)}… ウルフでした！`);
      if (s.phase === 'guess') {
        if (me === s.accused) {
          note(`${s.blank ? '' : `あなたのお題は「${esc(s.words[1])}」でした。`}みんなのお題は何だと思いますか？ 当てれば逆転勝ち`);
          const wrap = document.createElement('div');
          wrap.className = 'ww-guess';
          const input = document.createElement('input');
          input.type = 'text';
          input.maxLength = MAX_TEXT;
          input.placeholder = 'みんなのお題';
          input.className = 'um-input';
          wrap.append(input);
          root.append(wrap);
          row(button('あきらめる', 'ghost', () => { if (confirm('あきらめますか？')) o.onMove({ t: 'giveup' }); }),
            button('答える', 'primary', () => { if (input.value.trim()) o.onMove({ t: 'guess', text: input.value }); }));
        } else {
          note('ウルフがみんなのお題を当てれば、ウルフの逆転勝ちです');
        }
      } else {
        note(`ウルフの答え: 「<b>${esc(s.guess)}</b>」（みんなのお題は「${esc(s.words[0])}」）`);
        if (me !== null && !isWolf(s, me)) {
          note('意味が同じなら「正解」にしてください（先に押した人の判定になります）');
          row(button('ちがう', 'secondary', () => o.onMove({ t: 'judge', ok: false })), button('正解', 'primary', () => o.onMove({ t: 'judge', ok: true })));
        }
      }
    } else if (s.phase === 'end') {
      const box = document.createElement('div');
      box.className = 'ww-card';
      box.innerHTML = s.wolves.length
        ? `<div class="um-label">お題</div><div>みんな: <b>${esc(s.words[0])}</b>　ウルフ（${s.wolves.map(b).join('・')}）: <b>${esc(s.words[1])}</b></div>`
        : `<div class="um-label">お題</div><div>みんな: <b>${esc(s.words[0])}</b>　🕊 この回はウルフがいませんでした</div>`;
      root.append(box);
      if (s.saidNone) note(s.wolves.length ? '「ウルフはいない」がいちばん多く、ウルフが逃げ切りました' : '「ウルフはいない」を当てました！');
      else if (s.accused === null) note(s.history.length ? (s.wolves.length ? '票が並んで決まらず、ウルフが逃げ切りました' : '票が並んで決まりませんでした') : '');
      else if (!isWolf(s, s.accused)) note(`いちばん票が多かったのは ${b(s.accused)}… ウルフではありませんでした`);
      else if (s.guess === null) note(`${b(s.accused)}がウルフでした！ みんなのお題は当てられませんでした`);
      else note(`ウルフの答え「${esc(s.guess)}」は${s.winSide === 'wolf' ? '<span class="pt-ok">正解</span>。逆転です！' : '<span class="pt-ng">はずれ</span>でした'}`);
      for (const h of s.history) {
        const counts = {};
        for (const to of Object.values(h.votes)) counts[to] = (counts[to] ?? 0) + 1;
        note(`${h.round === 2 ? 'やり直しの投票' : '投票'}: ${Object.entries(counts).sort((x, y) => y[1] - x[1]).map(([p, c]) => `${Number(p) === NONE ? '<b>ウルフはいない</b>' : b(Number(p))} ${c}票`).join('、')}`);
      }
    }
  },
};

// 全員が投票したら数える
function tally(s) {
  const counts = new Map(s.cands.map((c) => [c, 0])); // 候補（ウルフがいない回の遊び方では「ウルフはいない」= -1 も）ごとの票
  for (const to of Object.values(s.votes)) counts.set(to, counts.get(to) + 1);
  s.history.push({ round: s.vote, votes: s.votes });
  const top = Math.max(...counts.values());
  const tied = s.cands.filter((c) => counts.get(c) === top);
  // 決まらなかったとき・ウルフでない人を選んだとき: ウルフがいればウルフの勝ち、いなければ全員の負け
  const miss = () => { s.phase = 'end'; s.winSide = s.wolves.length ? 'wolf' : 'none'; return s; };
  if (tied.length > 1) {
    if (s.vote === 1) { s.vote = 2; s.cands = tied; s.votes = {}; return s; }
    return miss();
  }
  if (tied[0] === NONE) { // 「ウルフはいない」がいちばん多い
    s.phase = 'end';
    s.winSide = s.wolves.length ? 'wolf' : 'village';
    s.saidNone = true;
    return s;
  }
  s.accused = tied[0];
  if (isWolf(s, s.accused)) s.phase = 'guess';
  else miss();
  return s;
}

const ui = { key: '' };

function button(text, cls, onClick) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn ' + cls;
  b.textContent = text;
  b.onclick = onClick;
  return b;
}
