// かんたん設定コード用の暗号文（PIN_BLOB）を生成する。実行はローカルのみ。
// 使い方: node tools\make-pin-blob.js <6桁コード> <GitHubトークン>
// 出力されたbase64を index.html の `const PIN_BLOB = '...'` に貼る。
// 注意: コードとトークンをこのリポジトリ（公開）に絶対にコミットしないこと。
const [pin, token] = process.argv.slice(2);
if (!/^\d{6}$/.test(pin || '') || !token) {
  console.error('使い方: node tools\\make-pin-blob.js <6桁コード> <トークン>');
  process.exit(1);
}
(async () => {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const keyMat = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 310000, hash: 'SHA-256' },
    keyMat, { name: 'AES-GCM', length: 256 }, false, ['encrypt']);
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(token)));
  console.log(Buffer.concat([salt, iv, ct]).toString('base64'));
})();
