// 語音線：發 AssemblyAI 臨時 token 的伺服器路由（V1 防護＋第 5 項來源檢查）
//
// 白話：金鑰像公司的萬用鑰匙，只放在伺服器（.env.local，由大銘貼）。
// 瀏覽器每次要講話前，先打這支路由拿一張「一次性入場券」（token），
// 再拿入場券去連 AssemblyAI。金鑰永遠不會出現在瀏覽器裡。
// 把關順序（正式環境）：①沒設密語→500 ②來源不對→403 ③密語不對→401，
// 都不呼叫 AssemblyAI。開發模式（npm run dev）沒設密語不擋，方便本機測試。
// 每通最長 300 秒；回傳一律 Cache-Control: no-store；錯誤不帶金鑰、不寫 log。
// 規格見方案/完整規格書_v1_2026-09-17.md §4.5。

const TOKEN_URL = 'https://agents.assemblyai.com/v1/token';

// 通關密語判斷（純函式：只看傳進來的三個值，不讀環境、不連線，方便單測）。
// - expected 空（沒設）：開發模式放行；正式環境回 500（部署忘設要大聲報錯）。
// - expected 有設但對不上：回 401。
function checkPasscode(
  got: string | null,
  expected: string | undefined,
  isProduction: boolean,
): { ok: true } | { ok: false; status: 401 | 500; error: string } {
  if (!expected) {
    if (isProduction) {
      return { ok: false, status: 500, error: 'Demo passcode not configured' };
    }
    return { ok: true };
  }
  if (got !== expected) {
    return { ok: false, status: 401, error: 'wrong passcode' };
  }
  return { ok: true };
}

// 來源檢查（純函式）：正式環境的 Origin 主機名必須等於請求的 Host（去掉埠號）。
// 沒有 Origin 或解析失敗都算不通過（正式環境的瀏覽器請求一定會帶 Origin）。
function isAllowedOrigin(
  originHeader: string | null,
  hostHeader: string | null,
): boolean {
  if (!originHeader || !hostHeader) return false;
  let originHost: string;
  try {
    originHost = new URL(originHeader).hostname.toLowerCase();
  } catch {
    return false;
  }
  const hostOnly = hostHeader.split(':')[0].toLowerCase();
  if (!hostOnly) return false;
  return originHost === hostOnly;
}

const NO_STORE = { 'Cache-Control': 'no-store' };

function deny(status: number, error: string) {
  return Response.json({ error }, { status, headers: NO_STORE });
}

export async function GET(req: Request) {
  const isProduction = process.env.NODE_ENV === 'production';
  const pass = checkPasscode(
    new URL(req.url).searchParams.get('passcode'),
    process.env.DEMO_PASSCODE,
    isProduction,
  );

  // ① 正式環境沒設密語：先回 500（排在金鑰和來源檢查之前）。
  if (!pass.ok && pass.status === 500) {
    return deny(pass.status, pass.error);
  }
  // ② 正式環境才檢查來源；開發模式跳過，方便本機測試。
  if (
    isProduction &&
    !isAllowedOrigin(req.headers.get('origin'), req.headers.get('host'))
  ) {
    return deny(403, 'forbidden origin');
  }
  // ③ 密語對不上：回 401，而且不呼叫 AssemblyAI。
  if (!pass.ok) {
    return deny(pass.status, pass.error);
  }

  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return deny(503, 'voice service not configured');
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set('product', 'voice_agent');
  url.searchParams.set('expires_in_seconds', '60');
  // 300 秒＝每通最長 5 分鐘（V1 防護，已定案）。
  url.searchParams.set('max_session_duration_seconds', '300');

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // 金鑰和完整標頭不准寫進 log：這裡只送出，不記錄。
      headers: { Authorization: 'Bearer ' + key },
      cache: 'no-store',
    });
  } catch {
    return deny(502, 'token request failed');
  }
  if (!upstream.ok) {
    return deny(502, 'token request failed');
  }
  const data = (await upstream.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    return deny(502, 'token request failed');
  }
  // 只回傳 { token }，不加任何別的欄位；瀏覽器不准存，每次連線重拿。
  return Response.json({ token: data.token }, { headers: NO_STORE });
}
