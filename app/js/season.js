// 季節を日付で決める（流しそうめんの見た目が使う。games/somen.js）。
// 季節の飾り（2026-11-09。ホームと待合室に桜・花火・紅葉・雪などを舞わせていた）は、2026-11-14 本人の依頼（鬱陶しい）でやめた。季節を決める関数だけ残している。
// 季節: 春 3〜5月・夏 6〜8月・秋 9〜11月・冬 12〜2月。1月1〜7日は正月。端末の時計で決める。
export function seasonOf(d = new Date()) {
  const m = d.getMonth() + 1;
  if (m === 1 && d.getDate() <= 7) return 'newyear';
  if (m >= 3 && m <= 5) return 'spring';
  if (m >= 6 && m <= 8) return 'summer';
  if (m >= 9 && m <= 11) return 'autumn';
  return 'winter';
}
