// Generated once for the directory, not real club event photographs.
export function clubDefaultCover(club = {}) {
  const known = { 'club-badminton': 'badminton', 'club-yoga': 'yoga', 'club-running': 'running' };
  let name = Object.hasOwn(known, club.id) ? known[club.id] : '';
  if (!name) {
    const title = String(club.title || '').toLowerCase();
    name = /羽球|羽毛球|badminton|bulu tangkis|แบดมินตัน/.test(title) ? 'badminton'
      : /瑜珈|瑜伽|yoga|โยคะ/.test(title) ? 'yoga'
      : /路跑|跑步|running|jogging|lari|วิ่ง/.test(title) ? 'running' : 'community';
  }
  return '/file/' + encodeURIComponent('club-default-covers/20261008-v1/' + name + '.jpg');
}

export function withClubCover(club) {
  return { ...club, cover_url: club.cover_media_id ? '/club-cover/' + encodeURIComponent(club.id) + '?v=' + club.revision : clubDefaultCover(club),
    cover_default_url: clubDefaultCover(club), cover_is_default: !club.cover_media_id };
}
