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
