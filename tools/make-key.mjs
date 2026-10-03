// 持ち主の合言葉から「鍵の要約」を作る道具（node tools/make-key.mjs）。
// 合言葉そのものはどこにも保存しない。出てきた英数字の列だけを app/js/owner.js の OWNER_KEY に貼る。
// 要約の作り方は app/js/owner.js の makeKey と必ず同じにすること（違うと合言葉が通らなくなる）。
import { pbkdf2Sync } from 'node:crypto';
import { createInterface } from 'node:readline';

const SALT = 'asobiba-q7m/owner/v2';
const ITERATIONS = 300000;

const rl = createInterface({ input: process.stdin });
const lines = rl[Symbol.asyncIterator]();
async function ask(text) {
  process.stdout.write(text);
  const { value = '' } = await lines.next();
  // 全角／半角・大文字／小文字・空白の違いは同じものとして扱う（iPhone は文頭を勝手に大文字にするため）
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, '');
}
const a = await ask('合言葉を入れて Enter: ');
const b = await ask('確認のため、もう一度: ');
rl.close();

if (a !== b) { console.log('2回の入力が違います。もう一度やり直してください。'); process.exit(1); }
if ([...a].length < 12) { console.log('短すぎます（12文字以上）。言葉を3〜4個つなげた長めの文にしてください。'); process.exit(1); }

const key = pbkdf2Sync(a, SALT, ITERATIONS, 32, 'sha256').toString('hex');
console.log('\n鍵の要約（これを Claude に貼ってください。合言葉は貼らないでください）:\n' + key);
