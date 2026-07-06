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
  calSelect, chCalYm, chBudYm, chRep, setRepMode, setRepKind, setSetKind,
  renameCat, reorderCats, addCat, addRec, toggleRec, delRec,
  openBudgetEdit, closeBudgetEdit, chBudEditYm, setBudDraftTotal, setBudDraftCat, saveBudgetEdit, budgetForYm,
  applyRecurring, buildCsv, catsOf, inputCatsOf, sumBy, entriesOfYm, shiftYm, clampDateInYm, todayIso, cloudBackup,
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
for (const t of ['input', 'cal', 'budget', 'report', 'settings']) {
  A.go(t);
  assert(elements.main.innerHTML.length > 100, t + ' 画面描画');
}
console.log('OK 全タブ描画');

// 5) カレンダー: 今日のセルに支出・収入合計
A.go('cal');
assert(elements.main.innerHTML.includes('-1,200'), 'カレンダーに支出');
assert(elements.main.innerHTML.includes('+280,000'), 'カレンダーに収入');
console.log('OK カレンダーの日別合計表示');

// 6) カレンダー下部の月別明細（旧一覧タブ相当）
assert(elements.main.innerHTML.includes(`id="day-${today}"`), '日付アンカー');
assert(elements.main.innerHTML.includes('食費'), '明細にカテゴリ名');
assert(elements.main.innerHTML.includes('スーパー'), '明細にメモ');
assert(elements.main.innerHTML.includes('¥280,000'), '明細に金額');
A.calSelect(today); // スクロール呼び出しがエラーにならないこと
console.log('OK カレンダー下部の明細・日付タップ');

// 7) レポート: サマリカード+ドーナツ+割合
A.go('report');
assert(elements.main.innerHTML.includes('<svg'), 'ドーナツSVG');
assert(elements.main.innerHTML.includes('100.0%'), '食費100%');
assert(elements.main.innerHTML.includes('収支'), '収支サマリカード');
assert(elements.main.innerHTML.includes('-¥1,200') || elements.main.innerHTML.includes('¥1,200'), '支出サマリ');
A.setRepKind('inc');
assert(elements.main.innerHTML.includes('給料'), '収入レポート');
A.setRepKind('exp');
console.log('OK レポート（サマリカード・支出/収入切替・割合）');

// 8) 予算: 編集ビューで食費 40,000 を設定
A.go('budget');
assert(elements.main.innerHTML.includes('予算を設定'), '予算を設定ボタン');
A.openBudgetEdit();
assert(elements.main.innerHTML.includes('予算設定'), '予算編集ビュー表示');
assert(elements.main.innerHTML.includes('食費'), '編集ビューにカテゴリ行');
A.setBudDraftCat(food.id, '40000');
A.saveBudgetEdit();
assert.strictEqual(A.budgetForYm(ym).cats[food.id], 40000, '保存反映');
assert.strictEqual(A.state.budEdit, null, '保存後は通常表示へ');
let budHtml = elements.main.innerHTML;
assert(budHtml.includes('予算合計'), '予算合計行');
assert(budHtml.includes('残り ¥38,800'), '食費の残り 40000-1200');
assert(budHtml.includes('予算 ¥40,000'), '予算表示');
assert(budHtml.includes('未設定'), '未設定カテゴリ表示');
// 超過ケース
A.openBudgetEdit(); A.setBudDraftCat(food.id, '1000'); A.saveBudgetEdit();
assert(elements.main.innerHTML.includes('残り -¥200'), '超過時はマイナス表示');
// 予算合計を手動設定するとカテゴリ合計より優先される
A.openBudgetEdit(); A.setBudDraftCat(food.id, '40000'); A.setBudDraftTotal('100000'); A.saveBudgetEdit();
assert(elements.main.innerHTML.includes('残り ¥98,800'), '手動の予算合計 100000-1200');
A.openBudgetEdit(); A.setBudDraftTotal(''); A.saveBudgetEdit();
assert(elements.main.innerHTML.includes('残り ¥38,800'), '合計を未設定に戻すとカテゴリ合計');
console.log('OK 予算（編集ビュー・合計・残り・未設定・超過・手動合計）');

// 8b) 月別予算: 保存した月から先へ引き継ぎ、過去の月の適用分は変わらない
const nextBudYm = A.shiftYm(ym, 1);
assert.strictEqual(A.budgetForYm(nextBudYm).cats[food.id], 40000, '翌月へ引き継ぎ');
assert.strictEqual(A.budgetForYm(A.shiftYm(ym, -6)).cats[food.id], 40000, '最初の設定より前の月にも適用');
A.chBudYm(1);
A.openBudgetEdit(); A.setBudDraftCat(food.id, '50000'); A.saveBudgetEdit();
assert.strictEqual(A.budgetForYm(nextBudYm).cats[food.id], 50000, '翌月から変更');
assert.strictEqual(A.budgetForYm(ym).cats[food.id], 40000, '当月は不変');
assert.strictEqual(A.budgetForYm(A.shiftYm(ym, 6)).cats[food.id], 50000, 'さらに先は最新の設定');
A.chBudYm(-1);
console.log('OK 月別予算の引き継ぎ');

// 9) 固定記帳: 住居費 ¥80,000 今月1日開始 → 今月分が即記帳される
const rent = A.catsOf('exp').find(c => c.name === '住居費');
elements.recCat = makeEl('recCat'); elements.recCat.value = rent.id;
elements.recAmount = makeEl('recAmount'); elements.recAmount.value = '80000';
elements.recStart = makeEl('recStart'); elements.recStart.value = ym + '-01';
elements.recEnd = makeEl('recEnd'); elements.recEnd.value = '';
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
  elements.recStart.value = `${ym}-${String(todayDay + 1).padStart(2, '0')}`;
  elements.recEnd.value = '';
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
elements.newCatIcon = makeEl('newCatIcon'); elements.newCatIcon.value = '🎮';
elements.newCatColor = makeEl('newCatColor'); elements.newCatColor.value = '#123456';
A.setSetKind('exp');
A.addCat();
assert(A.catsOf('exp', true).some(c => c.name === 'ペット'), 'カテゴリ追加');
const pet = A.catsOf('exp', true).find(c => c.name === 'ペット');
assert.strictEqual(pet.icon, '🎮', '選んだアイコン');
assert.strictEqual(pet.color, '#123456', '選んだ色');
A.renameCat(pet.id, 'ペット費');
assert.strictEqual(A.store.categories.find(c => c.id === pet.id).name, 'ペット費');
// 並び替え（ドラッグ&ドロップ確定時に呼ばれるreorderCats）
const incBefore = A.catsOf('inc', true).map(c => c.id);
const expCatsBefore = A.catsOf('exp', true).map(c => c.id);
const newOrder = [expCatsBefore[1], expCatsBefore[0], ...expCatsBefore.slice(2)];
A.reorderCats('exp', newOrder);
assert.deepStrictEqual(A.catsOf('exp', true).map(c => c.id), newOrder, '並べ替え反映');
assert.deepStrictEqual(A.catsOf('inc', true).map(c => c.id), incBefore, '収入側は不変');
// 不整合なids（欠け）は無視される
A.reorderCats('exp', newOrder.slice(1));
assert.deepStrictEqual(A.catsOf('exp', true).map(c => c.id), newOrder, '不正な並びは無視');
console.log('OK カテゴリ管理（追加・リネーム・アイコン/色・並べ替え）');

// 14b) 入力タブの表示/非表示（カテゴリ管理の2セクション。noInputフラグ）
const expIds2 = A.catsOf('exp', true).map(c => c.id);
A.reorderCats('exp', expIds2, [rent.id]); // 住居費を「入力タブで非表示」へ
assert(A.catsOf('exp').some(c => c.id === rent.id), 'カテゴリとしては残る');
assert(!A.inputCatsOf('exp').some(c => c.id === rent.id), '入力タブ対象から除外');
A.go('input');
assert(!elements.main.innerHTML.includes(`selectCat('${rent.id}')`), '入力タブのタイルに出ない');
A.go('settings');
const setHtml = elements.main.innerHTML;
assert(setHtml.includes('入力タブで表示'), 'セクション見出し（表示）');
assert(setHtml.includes('入力タブで非表示'), 'セクション見出し（非表示）');
assert(setHtml.includes(`value="${rent.id}"`), '固定費のカテゴリ選択肢には残る');
// 非表示カテゴリの既存記録も編集時はタイルが出る（固定費で記帳された記録の修正用）
const rentEntry2 = A.store.entries.find(e => e.recId);
A.openEntry(rentEntry2.id);
assert(elements.main.innerHTML.includes(`selectCat('${rent.id}')`), '編集中は非表示カテゴリもタイル表示');
A.cancelEdit();
// 予算編集ビューには出る
A.go('budget');
A.openBudgetEdit();
assert(elements.main.innerHTML.includes('住居費'), '予算編集ビューには出る');
A.closeBudgetEdit();
// 表示に戻せる
A.reorderCats('exp', expIds2, []);
assert(A.inputCatsOf('exp').some(c => c.id === rent.id), '表示に戻せる');
console.log('OK 入力タブの表示/非表示（noInput・編集時例外・固定費選択肢）');

// 15) 月ナビゲーション（カレンダー・予算）
A.go('cal');
A.chCalYm(-1);
assert(elements.main.innerHTML.includes(A.shiftYm(ym, -1).split('-')[0] + '年'), 'カレンダー前月表示');
A.chCalYm(1);
A.go('budget');
A.chBudYm(-1);
assert(elements.main.innerHTML.includes(A.shiftYm(ym, -1).split('-')[0] + '年'), '予算前月表示');
A.chBudYm(1);
console.log('OK 月ナビゲーション（カレンダー・予算）');

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
assert(!elements.main.innerHTML.includes('月別内訳'), '月間モードに月別内訳は出ない');
assert(elements.main.innerHTML.includes('収支'), '月間モードのサマリカード');
console.log('OK 年間レポート（月別内訳・年送り・月間との切替）');

// 15a-2) 固定記帳の開始日〜終了日: 期間内だけ記帳される（過去開始は遡って記帳）
const beforeEnd = A.store.entries.length;
A.store.recurring.push({
  id: 'rEndTest', catId: A.catsOf('exp')[0].id, amount: 100, memo: '終了テスト',
  startDate: A.clampDateInYm(A.shiftYm(ym, -3), 1), endDate: A.clampDateInYm(A.shiftYm(ym, -2), 1), lastApplied: null,
});
A.applyRecurring();
const endTestEntries = A.store.entries.filter(e => e.memo === '終了テスト');
assert.strictEqual(endTestEntries.length, 2, '開始月〜終了月の2ヶ月分のみ記帳');
assert(endTestEntries.every(e => e.date.slice(0, 7) <= A.shiftYm(ym, -2)), '終了日以前のみ');
A.applyRecurring();
assert.strictEqual(A.store.entries.filter(e => e.memo === '終了テスト').length, 2, '再実行でも増えない');
A.store.recurring = A.store.recurring.filter(r => r.id !== 'rEndTest');
A.store.entries = A.store.entries.filter(e => e.memo !== '終了テスト');
lsData['kakeibo.v1'] = JSON.stringify(A.store); // テスト後始末を永続化にも反映
console.log('OK 固定記帳の開始日〜終了日');

// 15a-3) 入力タブ: フォーム型UI・テンキーの開閉・アイコン
A.go('input');
let inHtml = elements.main.innerHTML;
assert(inHtml.includes('支出を入力する'), '入力ボタン');
assert(inHtml.includes('cicon'), 'カテゴリタイルにアイコン');
assert(inHtml.includes('🍽️'), '食費アイコン');
assert(!elements.padhost.innerHTML.includes('padwrap'), '初期状態でテンキー非表示');
A.state.padOpen = true; A.render();
assert(elements.padhost.innerHTML.includes('padwrap'), '金額タップでテンキー表示（padhost側）');
assert(elements.padhost.innerHTML.includes('OK'), 'OKボタン');
A.state.padOpen = false; A.render();
assert(!elements.padhost.innerHTML.includes('padwrap'), '閉じると消える');
A.go('cal');
assert.strictEqual(elements.padhost.innerHTML, '', '他タブではテンキー領域が空');
A.go('input');
assert.strictEqual(A.catsOf('exp').find(c => c.name === '食費').icon, '🍽️', 'デフォルトアイコン補完');
console.log('OK 入力タブ（フォーム型・テンキー開閉・アイコン）');

// 15a-4) 入力タブ下部に当日の記録一覧を出さない（2026-07-07に表示を廃止）
A.go('input');
A.store.entries.push({ id: 'eNoList', date: A.state.date, catId: food.id, amount: 999, memo: '一覧非表示テスト' });
A.render();
assert(A.store.entries.some(e => e.date === A.state.date), '当日の記録は存在する');
assert(!elements.main.innerHTML.includes('entry-row'), '入力タブに明細行を出さない');
assert(!elements.main.innerHTML.includes('の記録'), '「◯◯の記録」見出しを出さない');
A.store.entries = A.store.entries.filter(e => e.id !== 'eNoList');
console.log('OK 入力タブに当日記録一覧を出さない');

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

// 16b) 旧形式データの移行（固定費day/endYm→startDate/endDate、旧予算マップ→月別、アイコン補完）
const savedAll = lsData['kakeibo.v1'];
lsData['kakeibo.v1'] = JSON.stringify({
  version: 1,
  categories: [{ id: 'e0', name: '食費', kind: 'exp', color: '#2a78d6' }],
  entries: [],
  budgets: { e0: 12345 },
  recurring: [{ id: 'r1', catId: 'e0', amount: 500, day: 28, memo: 'x', lastApplied: '2026-06', endYm: '2027-01' }],
});
eval(bootstrap.replace('__api', '__api3'));
const A3 = globalThis.__api3;
const mig = A3.store;
assert.strictEqual(mig.categories[0].icon, '🍽️', 'アイコン補完');
assert.strictEqual(mig.recurring[0].startDate, '2026-06-28', 'day/lastApplied→startDate');
assert.strictEqual(mig.recurring[0].endDate, '2027-01-28', 'endYm→endDate');
assert(!('day' in mig.recurring[0]) && !('endYm' in mig.recurring[0]), '旧フィールド削除');
assert(Object.keys(mig.budgets).every(k => /^\d{4}-\d{2}$/.test(k)), '予算キーが月形式へ移行');
assert.strictEqual(A3.budgetForYm(A3.todayIso().slice(0, 7)).cats.e0, 12345, '旧予算額を引き継ぎ');
assert.strictEqual(A3.budgetForYm('2020-01').cats.e0, 12345, '過去の月にも適用');
lsData['kakeibo.v1'] = savedAll;
console.log('OK 旧形式データの移行');

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
