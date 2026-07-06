// 家計簿アプリのインラインJSをDOMスタブ上で実行して主要動線を検証する
// 実行: node test\smoke.test.js （全項目PASSしてからpushすること）
const fs = require('fs');
const assert = require('assert');

const html = fs.readFileSync(require('path').join(__dirname, '..', 'index.html'), 'utf8');
const appJs = /<script>([\s\S]*)<\/script>/.exec(html)[1];

// ---- スタブ ----
const lsData = {};
global.localStorage = {
  getItem: k => (k in lsData ? lsData[k] : null),
  setItem: (k, v) => { lsData[k] = String(v); },
  removeItem: k => { delete lsData[k]; },
};
const elements = {};
function makeEl(id) {
  return {
    id, innerHTML: '', value: '', style: {}, files: [],
    addEventListener() {}, setAttribute() {},
    appendChild() {}, click() {}, remove() {},
  };
}
global.document = {
  getElementById: id => elements[id] || (elements[id] = makeEl(id)),
  createElement: tag => makeEl(tag),
  body: { appendChild() {} },
  addEventListener() {},
  hidden: false,
};
global.window = { scrollTo() {}, addEventListener() {} };
global.navigator = {};
global.location = { protocol: 'file:', hostname: '' };
global.confirm = () => true;
global.alert = msg => { global.__lastAlert = msg; };
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL() {} };
global.Blob = class { constructor(parts) { this.content = parts.join(''); } };
global.FileReader = class { readAsText() {} };

const bootstrap = `(function(){ 'use strict';\n` + appJs + `
;globalThis.__api = {
  get store() { return store; },
  state, go, render, setDate, setKind, selectCat, pad, padBack, saveEntry, openEntry, deleteEntry, cancelEdit,
  calSelect, chCalYm, chListYm, chRep, setRepMode, setRepKind, setSetKind,
  renameCat, setBudget, toggleCat, moveCat, addCat, addRec, toggleRec, delRec,
  applyRecurring, buildCsv, catsOf, sumBy, entriesOfYm, shiftYm, clampDateInYm, todayIso, cloudBackup,
};})()`;
eval(bootstrap);
const A = globalThis.__api;
const today = A.todayIso();
const ym = today.slice(0, 7);

// 1) 初期状態
assert.strictEqual(A.store.entries.length, 0, 'エントリ0件');
assert.strictEqual(A.catsOf('exp').length, 13, '支出カテゴリ13件');
assert.strictEqual(A.catsOf('inc').length, 8, '収入カテゴリ8件');
assert(A.catsOf('exp').some(c => c.name === 'ふるさと納税'), 'ふるさと納税あり');
assert(A.catsOf('inc').some(c => c.name === 'メルカリ'), 'メルカリあり');
console.log('OK 初期カテゴリ（支出13・収入8）');

// 2) 支出入力: 食費 ¥1,200
const food = A.catsOf('exp').find(c => c.name === '食費');
A.setKind('exp'); A.selectCat(food.id);
A.pad('1'); A.pad('2'); A.pad('0'); A.pad('0');
A.state.memo = 'スーパー';
A.saveEntry();
assert.strictEqual(A.store.entries.length, 1);
assert.deepStrictEqual(
  { catId: A.store.entries[0].catId, amount: A.store.entries[0].amount, memo: A.store.entries[0].memo, date: A.store.entries[0].date },
  { catId: food.id, amount: 1200, memo: 'スーパー', date: today });
assert.strictEqual(A.state.amount, '', '保存後クリア');
console.log('OK 支出入力（食費 ¥1,200 メモ付き）');

// 3) 収入入力: 給料 ¥280,000
const salary = A.catsOf('inc').find(c => c.name === '給料');
A.setKind('inc'); A.selectCat(salary.id);
'280000'.split('').forEach(d => A.pad(d));
A.saveEntry();
const msum = A.sumBy(A.entriesOfYm(ym));
assert.deepStrictEqual(msum, { exp: 1200, inc: 280000, net: 278800 }, '月間収支');
console.log('OK 収入入力と月間収支 (+278,800)');

// 4) 各タブ描画
for (const t of ['input', 'cal', 'list', 'report', 'settings']) {
  A.go(t);
  assert(elements.main.innerHTML.length > 100, t + ' 画面描画');
}
console.log('OK 全タブ描画');

// 5) カレンダー: 今日のセルに支出・収入合計
A.go('cal');
assert(elements.main.innerHTML.includes('-1,200'), 'カレンダーに支出');
assert(elements.main.innerHTML.includes('+280,000'), 'カレンダーに収入');
console.log('OK カレンダーの日別合計表示');

// 6) 一覧
A.go('list');
assert(elements.main.innerHTML.includes('食費'), '一覧にカテゴリ名');
assert(elements.main.innerHTML.includes('スーパー'), '一覧にメモ');
assert(elements.main.innerHTML.includes('¥280,000'), '一覧に金額');
console.log('OK 一覧表示');

// 7) レポート: ドーナツ+割合
A.go('report');
assert(elements.main.innerHTML.includes('<svg'), 'ドーナツSVG');
assert(elements.main.innerHTML.includes('100.0%'), '食費100%');
A.setRepKind('inc');
assert(elements.main.innerHTML.includes('給料'), '収入レポート');
A.setRepKind('exp');
console.log('OK レポート（支出/収入切替・割合）');

// 8) 予算: 食費 40,000
A.setBudget(food.id, '40000');
assert.strictEqual(A.store.budgets[food.id], 40000);
A.go('report');
assert(elements.main.innerHTML.includes('¥1,200 / ¥40,000'), '予算バー表示');
// 超過ケース
A.setBudget(food.id, '1000');
A.go('report');
assert(elements.main.innerHTML.includes('超過'), '予算超過表示');
A.setBudget(food.id, '40000');
console.log('OK カテゴリ別予算（通常・超過）');

// 9) 固定記帳: 住居費 ¥80,000 毎月1日 → 今月分が即記帳される
const rent = A.catsOf('exp').find(c => c.name === '住居費');
elements.recCat = makeEl('recCat'); elements.recCat.value = rent.id;
elements.recAmount = makeEl('recAmount'); elements.recAmount.value = '80000';
elements.recDay = makeEl('recDay'); elements.recDay.value = '1';
elements.recMemo = makeEl('recMemo'); elements.recMemo.value = '家賃';
A.addRec();
const rentEntries = A.store.entries.filter(e => e.recId);
assert.strictEqual(rentEntries.length, 1, '今月分が自動記帳');
assert.strictEqual(rentEntries[0].date, ym + '-01');
assert.strictEqual(rentEntries[0].amount, 80000);
// 再適用しても重複しない
const before = A.store.entries.length;
A.applyRecurring();
assert.strictEqual(A.store.entries.length, before, '重複記帳なし');
console.log('OK 固定記帳（当月分の即時記帳・重複防止）');

// 10) 固定記帳: まだ来ていない日（今日+aの日）は記帳されない
const todayDay = Number(today.slice(8, 10));
if (todayDay < 28) {
  elements.recCat.value = rent.id;
  elements.recAmount.value = '5000';
  elements.recDay.value = String(todayDay + 1);
  elements.recMemo.value = '未来日テスト';
  A.addRec();
  assert(!A.store.entries.some(e => e.memo === '未来日テスト'), '未来日は未記帳');
  A.delRec(A.store.recurring[A.store.recurring.length - 1].id);
  console.log('OK 固定記帳（未到来日は記帳しない）');
} else {
  console.log('SKIP 未来日テスト（月末近く）');
}

// 11) 31日指定 → 月末にクランプ
assert.strictEqual(A.clampDateInYm('2026-02', 31), '2026-02-28', '2月は28日');
assert.strictEqual(A.clampDateInYm('2026-04', 31), '2026-04-30', '4月は30日');
console.log('OK 月末クランプ');

// 12) 編集・削除
const target = A.store.entries.find(e => e.memo === 'スーパー');
A.openEntry(target.id);
assert.strictEqual(A.state.amount, '1200', '編集プリフィル');
A.padBack(); A.padBack(); A.pad('5'); A.pad('0'); // 1200 → 12 → 1250
A.saveEntry();
assert.strictEqual(A.store.entries.find(e => e.id === target.id).amount, 1250, '金額更新');
assert.strictEqual(A.store.entries.filter(e => e.memo === 'スーパー').length, 1, '重複せず更新');
A.openEntry(target.id);
A.deleteEntry();
assert(!A.store.entries.some(e => e.id === target.id), '削除');
console.log('OK 記録の編集・削除');

// 13) CSV
const csv = A.buildCsv();
assert(csv.charCodeAt(0) === 0xFEFF, 'BOM付き');
assert(csv.includes('日付,種別,カテゴリ,金額,メモ'), 'ヘッダ');
assert(csv.includes(`${ym}-01,支出,住居費,80000,"家賃"`), '固定費行');
assert(csv.includes('収入,給料,280000'), '収入行');
console.log('OK CSVエクスポート内容');

// 14) カテゴリ管理: 追加・リネーム・非表示・並べ替え
elements.newCatName = makeEl('newCatName'); elements.newCatName.value = 'ペット';
A.setSetKind('exp');
A.addCat();
assert(A.catsOf('exp', true).some(c => c.name === 'ペット'), 'カテゴリ追加');
const pet = A.catsOf('exp', true).find(c => c.name === 'ペット');
A.renameCat(pet.id, 'ペット費');
assert.strictEqual(A.store.categories.find(c => c.id === pet.id).name, 'ペット費');
A.toggleCat(pet.id);
assert.strictEqual(A.store.categories.find(c => c.id === pet.id).hidden, true, '非表示');
assert(!A.catsOf('exp').some(c => c.id === pet.id), '入力画面から消える');
const expCatsBefore = A.catsOf('exp', true).map(c => c.id);
A.moveCat(expCatsBefore[1], -1);
const expCatsAfter = A.catsOf('exp', true).map(c => c.id);
assert.strictEqual(expCatsAfter[0], expCatsBefore[1], '並べ替え');
assert.strictEqual(expCatsAfter[1], expCatsBefore[0]);
// kindを跨いで並べ替えないこと
assert.deepStrictEqual(A.catsOf('inc', true).map(c => c.id), A.store.categories.filter(c => c.kind === 'inc').map(c => c.id));
console.log('OK カテゴリ管理（追加・リネーム・非表示・並べ替え）');

// 15) 月ナビゲーション
A.go('list');
A.chListYm(-1);
assert(elements.main.innerHTML.includes(A.shiftYm(ym, -1).split('-')[0] + '年'), '前月表示');
A.chListYm(1);
console.log('OK 月ナビゲーション');

// 15a-1) 年間レポート
A.go('report');
A.setRepMode('year');
let yearHtml = elements.main.innerHTML;
assert(yearHtml.includes(ym.slice(0, 4) + '年'), '年見出し');
assert(yearHtml.includes('月別内訳'), '月別内訳テーブル');
assert(yearHtml.includes('合計'), '合計行');
assert(yearHtml.includes('<svg'), '年間ドーナツ');
A.chRep(-1);
assert(elements.main.innerHTML.includes((Number(ym.slice(0, 4)) - 1) + '年'), '前年へ移動');
A.chRep(1);
A.setRepMode('month');
assert(elements.main.innerHTML.includes('カテゴリ別予算') || elements.main.innerHTML.includes('予算'), '月間モードに予算セクション');
console.log('OK 年間レポート（月別内訳・年送り・月間との切替）');

// 15a-2) 固定記帳の終了月（endYm）: 終了月までしか記帳されない
const beforeEnd = A.store.entries.length;
A.store.recurring.push({
  id: 'rEndTest', catId: A.catsOf('exp')[0].id, amount: 100, day: 1, memo: '終了テスト',
  lastApplied: A.shiftYm(ym, -4), endYm: A.shiftYm(ym, -2),
});
A.applyRecurring();
const endTestEntries = A.store.entries.filter(e => e.memo === '終了テスト');
assert.strictEqual(endTestEntries.length, 2, '終了月まで2ヶ月分のみ記帳（-3月と-2月）');
assert(endTestEntries.every(e => e.date.slice(0, 7) <= A.shiftYm(ym, -2)), '終了月以前のみ');
A.applyRecurring();
assert.strictEqual(A.store.entries.filter(e => e.memo === '終了テスト').length, 2, '再実行でも増えない');
A.store.recurring = A.store.recurring.filter(r => r.id !== 'rEndTest');
A.store.entries = A.store.entries.filter(e => e.memo !== '終了テスト');
lsData['kakeibo.v1'] = JSON.stringify(A.store); // テスト後始末を永続化にも反映
console.log('OK 固定記帳の終了月（endYm）');

// 15b) 入力タブを離れたら初期化される
A.go('input');
A.setKind('inc');
A.selectCat(salary.id);
A.pad('5'); A.pad('0');
A.state.memo = '途中入力';
A.setDate('2026-01-15');
A.go('cal');
assert.strictEqual(A.state.amount, '', '金額クリア');
assert.strictEqual(A.state.selCat, null, 'カテゴリ選択クリア');
assert.strictEqual(A.state.memo, '', 'メモクリア');
assert.strictEqual(A.state.kind, 'exp', '支出に戻る');
assert.strictEqual(A.state.editId, null, '編集モード解除');
assert.strictEqual(A.state.date, A.todayIso(), '日付が今日に戻る');
console.log('OK 入力タブ離脱時の初期化');

// 16) 永続化: 再ロードで一致
const saved = JSON.parse(lsData['kakeibo.v1']);
assert.strictEqual(saved.entries.length, A.store.entries.length);
assert.strictEqual(saved.recurring.length, A.store.recurring.length);
eval(bootstrap.replace('__api', '__api2'));
assert.strictEqual(globalThis.__api2.store.entries.length, saved.entries.length, '再ロード一致');
console.log('OK 永続化・再ロード');

// 17) クラウドバックアップ（fetchモック）
(async () => {
  const calls = [];
  global.fetch = async (url, opts = {}) => {
    calls.push({ url, method: opts.method || 'GET', body: opts.body });
    if (!opts.method) return { status: 200, ok: true, json: async () => ({ sha: 'abc' }) };
    return { ok: true, status: 200, json: async () => ({}) };
  };
  let r = await A.cloudBackup();
  assert.strictEqual(r.skipped, 'no-token', 'トークン未設定はスキップ');
  lsData['kakeibo.cloudToken'] = 'testtoken';
  r = await A.cloudBackup();
  assert(r.ok, 'バックアップ成功');
  assert.strictEqual(calls.length, 2, 'GET(sha取得)+PUT');
  assert(calls[1].url.includes('app-backups/contents/kakeibo.json'), 'アップロード先');
  assert(JSON.parse(calls[1].body).sha === 'abc', '既存ファイルのshaを指定');
  assert(JSON.parse(lsData['kakeibo.cloudMeta']).last, 'バックアップ日を記録');
  r = await A.cloudBackup();
  assert.strictEqual(r.skipped, 'done-today', '同日2回目はスキップ');
  r = await A.cloudBackup(true);
  assert(r.ok, 'force指定は同日でも実行');
  console.log('OK クラウドバックアップ（1日1回・sha更新・スキップ判定）');

  console.log('\n=== 全項目 PASS ===');
})().catch(e => { console.error(e); process.exit(1); });
