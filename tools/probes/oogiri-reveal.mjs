// play-two.mjs 用: 大喜利を3人で1回進め、結果の発表（票の少ない答えから順に名前が出る・発表が終わるまで点を足さない）を確かめる。
// 使い方: node tools/play-two.mjs oogiri --guests 2 --script tools/probes/oogiri-reveal.mjs --out <フォルダ>
export default async function ({ host, guests, shot, sleep }) {
  const pages = [host, ...guests];
  await host.waitForSelector('.kj-form input', { timeout: 15000 });
  for (const [i, p] of pages.entries()) {
    await p.waitForSelector('.kj-form input');
    await p.fill('.kj-form input', ['すでに家にいる', '冷蔵庫に入らない', '3日で飽きる'][i]);
    await p.press('.kj-form input', 'Enter');
  }
  await host.waitForSelector('button.og-ans', { timeout: 10000 });
  // ホストとゲスト1は同じ答え（ゲスト2の答え）に入れ、ゲスト2はどれかに入れる → 2票・1票・0票
  const voteFor = async (p, word) => p.evaluate((w) => { const b = [...document.querySelectorAll('button.og-ans')].find((x) => x.textContent.includes(w)) ?? document.querySelector('button.og-ans'); b.click(); }, word);
  await voteFor(host, '3日で');
  await voteFor(guests[0], '3日で');
  await voteFor(guests[1], '家にいる');
  await host.waitForSelector('.og-list.reveal', { timeout: 10000 });
  const read = () => host.evaluate(() => ({
    who: [...document.querySelectorAll('.og-ans')].map((e) => `${e.querySelector('.og-who').textContent}(${Math.round(getComputedStyle(e.querySelector('.og-who')).opacity * 10) / 10}, d=${e.style.getPropertyValue('--d')})`),
    chips: document.querySelector('.kj-wrap > :first-child').innerText.replace(/\n/g, ' '),
  }));
  const early = await read();
  await shot(host, 'og-early');
  await sleep(1300);
  const mid = await read();
  await shot(host, 'og-mid');
  await sleep(2200);
  const late = await read();
  await shot(host, 'og-late');
  return { early, mid, late };
}
