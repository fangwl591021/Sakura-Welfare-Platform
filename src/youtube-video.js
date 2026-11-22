// Keep this function self-contained: the HTML builders embed it into browser scripts.
// Return only a validated video ID; never pass an arbitrary user URL to an iframe.
export function youtubeVideoId(value) {
  if (typeof value !== 'string' || value.length > 2000 || /[\u0000-\u001f\u007f]/.test(value)) return '';
  let u;
  try { u = new URL(value.trim()); } catch { return ''; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return '';
  const host = u.hostname.toLowerCase();
  let video = '';
  if (host === 'youtu.be') {
    const match = u.pathname.match(/^\/([A-Za-z0-9_-]{11})\/?$/);
    video = match?.[1] || '';
  } else if (['youtube.com','www.youtube.com','m.youtube.com','music.youtube.com'].includes(host)) {
    if (u.pathname === '/watch' && u.searchParams.getAll('v').length === 1) video = u.searchParams.get('v') || '';
    else video = u.pathname.match(/^\/(?:embed|shorts|live)\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || '';
  } else if (['youtube-nocookie.com','www.youtube-nocookie.com'].includes(host)) {
    video = u.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})\/?$/)?.[1] || '';
  }
  return /^[A-Za-z0-9_-]{11}$/.test(video) ? video : '';
}
