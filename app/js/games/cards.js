// トランプの共通の道具（大富豪・ポーカー・スピードで使う）。
// 札は「マーク1文字 + 数字」: マーク s♠ h♥ d♦ c♣、数字 1(A)〜13(K)。例: 's1' = ♠A、'h13' = ♥K。ジョーカーは 'JK'。
// 強さの順番はゲームごとに違うので、ここでは決めない。

export const SUITS = ['s', 'h', 'd', 'c'];
export const SUIT_MARK = { s: '♠', h: '♥', d: '♦', c: '♣' };
export const JOKER = 'JK';
const FACE = { 1: 'A', 11: 'J', 12: 'Q', 13: 'K' };

export const suitOf = (c) => (c === JOKER ? null : c[0]);
export const rankOf = (c) => (c === JOKER ? 0 : Number(c.slice(1)));
export const rankLabel = (r) => FACE[r] ?? String(r);

export function makeDeck(jokers = 0) {
  const d = [];
  for (const s of SUITS) for (let r = 1; r <= 13; r++) d.push(s + r);
  for (let i = 0; i < jokers; i++) d.push(JOKER);
  return d;
}

export const cardLabel = (c) => (c === JOKER ? 'ジョーカー' : SUIT_MARK[c[0]] + rankLabel(rankOf(c)));

// 札の見た目。tag を 'button' にすると押せる札になる。
// 絵は img/cards/<札>.webp（Byron Knoll の Vector Playing Cards。パブリックドメイン。PNG を幅240の WebP に縮めた。
// ♠A は飾りの無い版。飾りのある版は別の作者の絵で、自由に使えるとの表明が見つからなかったため使わない）。
// 小さく出すと絵の隅の数字が読めないので、左上に大きめの数字とマークを重ねる
export function cardEl(c, tag = 'div') {
  const e = document.createElement(tag);
  if (tag === 'button') e.type = 'button';
  if (c === JOKER) {
    e.className = 'pcard joker';
    e.innerHTML = '<span class="pc-idx">JO<br>KER</span>';
  } else {
    const s = suitOf(c);
    e.className = 'pcard' + (s === 'h' || s === 'd' ? ' red' : '');
    e.innerHTML = `<span class="pc-idx">${rankLabel(rankOf(c))}<br>${SUIT_MARK[s]}</span>`;
  }
  e.style.backgroundImage = `url(img/cards/${c === JOKER ? 'joker' : c}.webp)`;
  e.setAttribute('aria-label', cardLabel(c));
  return e;
}

export function backEl() {
  const e = document.createElement('div');
  e.className = 'pcard back';
  return e;
}

// 観戦の人は全員の手札を開いて見られる（2026-11-19 の UI・UX の10回目。本人が決めたことは room.md）。
// ゲームの peek(s, o) がこれで欄を作って返し、main.js が観戦の人の「みんなの手札を開く」のときだけ盤の下に足す。
// rows = [{ name, cards: [札の要素…], note: 名前の横の小さな字（任意） }]。札が無い人（上がった人など）は note だけ出す
export function peekBox(rows) {
  const box = document.createElement('div');
  box.className = 'peek-hands';
  for (const r of rows) {
    const row = document.createElement('div');
    row.className = 'peek-row';
    const nm = document.createElement('div');
    nm.className = 'peek-name';
    nm.textContent = r.name;
    if (r.note) { const sm = document.createElement('small'); sm.textContent = r.note; nm.append(sm); }
    const cs = document.createElement('div');
    cs.className = 'peek-cards';
    cs.append(...r.cards);
    row.append(nm, cs);
    box.append(row);
  }
  return box;
}

// 手札を扇形に持つ（2026-11-10 の UI・演出・アニメーションの案の3回目。本人が決めたことは card-games.md）。
// box（自分の手札を並べた入れ物。札を全部入れてから呼ぶ）の札をゆるい扇形にする。up = いま自分が札を選べる（手札を持ち上げ、光っている札をもう少し浮かせる）。
// でなければ少し沈めて暗くする。重なり具合は style.css の .fan-hand が入れ物の幅と札の数から決める（描き直しの途中で長さを測らないため）。
// 傾きは個別の rotate・translate で付け、transform は使わない（札が飛ぶ動き（main.js の flyPlay）・選んだ札を上げる transform とぶつからないように）。
// Claude の判断: 両端の傾きは合わせて26度まで・1枚ずつは4度まで、両端の下がりは9px
export function fanHand(box, up) {
  const items = [...box.children];
  const n = items.length;
  box.classList.add('fan-hand', up ? 'fan-up' : 'fan-down');
  box.style.setProperty('--n', String(Math.max(2, n)));
  const half = Math.max(1, (n - 1) / 2);
  const step = Math.min(4, 26 / Math.max(1, n - 1));
  items.forEach((e, i) => {
    const t = i - (n - 1) / 2;
    e.style.setProperty('--fr', (t * step).toFixed(2) + 'deg');
    e.style.setProperty('--fy', ((t / half) ** 2 * 9).toFixed(1) + 'px');
  });
}

// 札を裏返す動き（2026-11-06 の UI・演出・アニメーションの案。神経衰弱・ブラックジャックの親の伏せ札・ポーカーの見せ合い。本人が決めたことは card-games.md・extra-games.md）。
// 表で描いた札 e に、裏から表へくるっと返る動きを付ける（style.css の .pcard.turn-up。裏の模様は ::after で重ね、半分回ったところで消す）。
// 盤は描き直しのたびに作り直されるので、返し始めた時刻を key ごとに覚え、返している間に描き直したら続きから返す。
// fresh = 新しく届いた手で表になった（読み込み直し・あとから見た人には表のまま出す）。同じ key は2回目の fresh でも始め直さないので、
// key には対局ごとに変わるもの（種・配った札の並び）を入れる。delay = 何 ms 遅れて返すか（何枚かを順に返すとき）。動きを減らす設定の端末では style.css が止める
const TURN_MS = 420;
const turned = new Map();
export function turnUp(e, key, fresh, delay = 0) {
  const now = Date.now();
  if (fresh && !turned.has(key)) {
    turned.set(key, now);
    if (turned.size > 200) turned.delete(turned.keys().next().value);
  }
  const t = now - (turned.get(key) ?? -Infinity);
  if (t >= delay + TURN_MS) return;
  e.classList.add('turn-up');
  e.style.setProperty('--ago', `${delay - t}ms`);
}

// 手札を指でずらして並べ替える（2026-11-16 の UI・UX の7回目。本人の選択。card-games.md の「演出」）。
// dragSort(box, onDone): box（手札を並べた入れ物）の札を、指（PC はマウス）でつまんで横にずらすと、指の下の札の前か後ろに入れる。
// 離したら onDone(新しい並び。前の並びの何枚目かの一覧) を呼ぶ。札を押して選ぶゲームでも、10px より動かさなければいつもどおり押したことになる。
// 指で縦になでたときはつままない（ページを動かせるように。CSS の touch-action: pan-y でブラウザに任せる）。手札は折り返して何段にもなるので、指にいちばん近い札の所へ入れる。
// ownOrder / setOwnOrder: 自分の画面だけの並び（ババ抜きのほかのゲーム）。鍵（対局と配り）ごとに覚え、まだ並べ替えていなければゲームの並びのまま。
// 並べ替えたあとに来た札（引き取った札・渡された札など）は後ろに足す。覚えるのはこの端末のこのタブの間だけ（Claude の判断）
const orders = new Map();
export function ownOrder(key, cards) {
  const saved = orders.get(key);
  if (!saved) return cards.slice();
  const rest = cards.slice();
  const out = [];
  for (const c of saved) {
    const i = rest.indexOf(c);
    if (i >= 0) { out.push(c); rest.splice(i, 1); }
  }
  return [...out, ...rest];
}
export function setOwnOrder(key, cards) {
  orders.delete(key);
  if (cards) orders.set(key, cards.slice());
  if (orders.size > 30) orders.delete(orders.keys().next().value);
}
let sortSwallow = 0; // つまんで動かしたあとのクリックを捨てる（札を選んだことにしない）
export function dragSort(box, onDone) {
  box.classList.add('drag-sort');
  box.addEventListener('click', (e) => { if (Date.now() < sortSwallow) { e.preventDefault(); e.stopPropagation(); } }, true);
  box.addEventListener('pointerdown', (e) => {
    if (e.button > 0 || !e.isPrimary) return;
    const items = [...box.children];
    const card = items.find((x) => x.contains(e.target));
    if (!card || items.length < 2) return;
    const from = items.indexOf(card);
    const mids = items.map((x) => { const r = x.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; });
    const x0 = e.clientX, y0 = e.clientY;
    let on = false, to = from, mark = null;
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
    };
    const clear = () => {
      card.classList.remove('sorting');
      card.style.transform = '';
      mark?.classList.remove('sort-before', 'sort-after');
    };
    const move = (ev) => {
      const dx = ev.clientX - x0, dy = ev.clientY - y0;
      if (!on) {
        if (Math.hypot(dx, dy) < 10) return; // 指で縦になでたときは、ブラウザがページを動かして pointercancel が来る（touch-action: pan-y）
        on = true;
        card.classList.add('sorting');
      }
      ev.preventDefault();
      card.style.transform = `translate(${dx}px, ${dy - 12}px)`;
      let best = from, bd = Infinity;
      mids.forEach(([mx, my], i) => { const d = Math.hypot(mx - ev.clientX, (my - ev.clientY) * 1.5); if (d < bd) { bd = d; best = i; } });
      to = best;
      mark?.classList.remove('sort-before', 'sort-after');
      mark = to === from ? null : items[to];
      mark?.classList.add(to > from ? 'sort-after' : 'sort-before');
    };
    const up = () => {
      stop();
      if (!on) return;
      sortSwallow = Date.now() + 350;
      mark?.classList.remove('sort-before', 'sort-after');
      // つまんでいる間に手札が描き直された（ほかの人の手・時間切れ）: 何もしない。onDone は古い局面で描き直すので、呼ぶと古い場やボタンが戻っていた（2026-11-16 の Codex の点検）
      if (to === from || !box.isConnected) { clear(); return; }
      const order = items.map((_, i) => i);
      order.splice(from, 1);
      order.splice(to, 0, from);
      onDone(order); // 描き直すまで、つまんだ札は離した所に置いたまま（札が飛ぶ動きが、そこから新しい場所へ寄せる）
    };
    const cancel = () => { stop(); if (on) clear(); };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  });
}
