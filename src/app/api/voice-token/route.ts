// 語音線：發 AssemblyAI 臨時 token 的伺服器路由（草案，未連線實測）
//
// 白話：金鑰像公司的萬用鑰匙，只放在伺服器（.env.local，由大銘貼）。
// 瀏覽器每次要講話前，先打這支路由拿一張「一次性入場券」（token），
// 再拿入場券去連 AssemblyAI。金鑰永遠不會出現在瀏覽器裡。
// 分工見交接/線_看板資料.md「資料夾分工」；規格見交接/線_語音.md 步驟 3。

const TOKEN_URL = 'https://agents.assemblyai.com/v1/token';

export async function GET(req: Request) {
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) {
    return Response.json({ error: 'voice service not configured' }, { status: 503 });
  }

  // V1 通關密語（待決）：DEMO_PASSCODE 沒設就不檢查，有設才比對。
  const passcode = process.env.DEMO_PASSCODE;
  if (passcode) {
    const got = new URL(req.url).searchParams.get('passcode');
    if (got !== passcode) {
      return Response.json({ error: 'wrong passcode' }, { status: 403 });
    }
  }

  const url = new URL(TOKEN_URL);
  url.searchParams.set('product', 'voice_agent');
  url.searchParams.set('expires_in_seconds', '60');
  // 300 秒＝每通最長 5 分鐘（V1 防護），等 V1 定案再調。
  url.searchParams.set('max_session_duration_seconds', '300');

  let upstream: Response;
  try {
    upstream = await fetch(url, {
      // 金鑰和完整標頭不准寫進 log：這裡只送出，不記錄。
      headers: { Authorization: 'Bearer ' + key },
      cache: 'no-store',
    });
  } catch {
    return Response.json({ error: 'token request failed' }, { status: 502 });
  }
  if (!upstream.ok) {
    return Response.json({ error: 'token request failed' }, { status: 502 });
  }
  const data = (await upstream.json()) as { token?: unknown };
  if (typeof data.token !== 'string' || data.token.length === 0) {
    return Response.json({ error: 'token request failed' }, { status: 502 });
  }
  // 只回傳 { token }，不加任何別的欄位；瀏覽器不准存，每次連線重拿。
  return Response.json({ token: data.token }, { headers: { 'Cache-Control': 'no-store' } });
}
