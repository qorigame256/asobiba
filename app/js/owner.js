// 持ち主（サイトを作った本人）の端末かどうか。部屋を作る・同じ画面で遊ぶのは持ち主の端末だけにして、
// 友だちがサイトの URL を他の人に広めても、持ち主が部屋を開いていない限り遊べないようにする（本人の希望）。
//
// 合言葉そのものはコードに書かず、元に戻せない形に変えた「鍵の要約」だけを置く（リポジトリが公開のため）。
// 要約は tools/make-key.mjs で作る。作り方（SALT・回数・文字の整え方）はそちらと必ず同じにすること。
// 限界: 判定は各自の端末の中で行うので、開発用の道具を使える人なら外せる。ふつうの人が気軽に広める
// のを止めるためのもの（本人に説明済み）。

const OWNER_KEY = '976afcdef0290cb0a858ff9e785bf9e61611b32af33e6f1fe463664bb774e56e';
const SALT = 'asobiba-q7m/owner/v2';
const ITERATIONS = 300000;
const STORE_KEY = 'bg-owner';

// 全角／半角・大文字／小文字・空白の違いは同じものとして扱う（iPhone は文頭を勝手に大文字にするため）
const normalize = (text) => String(text).normalize('NFKC').toLowerCase().replace(/\s+/g, '');

async function makeKey(text) {
  const enc = new TextEncoder();
  const base = await crypto.subtle.importKey('raw', enc.encode(normalize(text)), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(SALT), iterations: ITERATIONS, hash: 'SHA-256' }, base, 256);
  return Array.from(new Uint8Array(bits), (b) => b.toString(16).padStart(2, '0')).join('');
}

let unlocked = false; // localStorage が使えない端末でも、この画面の間は持ち主として扱う

export function isOwner() {
  if (unlocked) return true;
  try { return localStorage.getItem(STORE_KEY) === OWNER_KEY; } catch { return false; }
}

// 合言葉が合っていればこの端末を持ち主として覚えて true
export async function unlockOwner(text) {
  if ((await makeKey(text)) !== OWNER_KEY) return false;
  unlocked = true;
  try { localStorage.setItem(STORE_KEY, OWNER_KEY); } catch { /* 覚えられなくても、この画面の間は使える */ }
  return true;
}

export function forgetOwner() {
  unlocked = false;
  try { localStorage.removeItem(STORE_KEY); } catch { /* 無視 */ }
}
