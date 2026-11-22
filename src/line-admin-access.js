// LINE access tokens are verified on the server; client-supplied profile data is never trusted.
// This helper returns only a verified LINE identity, never the token or LINE response.
export async function verifyLineAdminAccessToken(channel, value, fetcher = fetch) {
  if (typeof value !== 'string' || !value || value.length > 8192 || /[\s\x00-\x1f\x7f]/.test(value)) return null;
  channel = String(channel || '');
  if (!/^\d+$/.test(channel)) return null;
  try {
    const url = new URL('https://api.line.me/oauth2/v2.1/verify');
    url.searchParams.set('access_token', value);
    const verified = await fetcher(url.href, {method:'GET', signal:AbortSignal.timeout(7000)});
    if (!verified.ok) return null;
    const info = await verified.json();
    if (info?.client_id !== channel || typeof info?.expires_in !== 'number' || !Number.isFinite(info.expires_in) || info.expires_in <= 0 || typeof info.scope !== 'string' || !info.scope.split(/\s+/).includes('openid')) return null;
    const response = await fetcher('https://api.line.me/oauth2/v2.1/userinfo', {method:'GET',headers:{Authorization:'Bearer '+value},signal:AbortSignal.timeout(7000)});
    if (!response.ok) return null;
    const profile = await response.json();
    if (typeof profile?.sub !== 'string' || !/^U[0-9a-f]{32}$/i.test(profile.sub)) return null;
    return {lineUserId:profile.sub};
  } catch { return null; }
}
