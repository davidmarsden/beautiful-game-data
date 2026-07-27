const SAFE_CLUB_ID = /^[A-Za-z0-9._:-]{1,160}$/;

function requestedClubRoute() {
  const id = String(new URL(window.location.href).searchParams.get('id') || '').trim();
  return SAFE_CLUB_ID.test(id) ? id : null;
}

function transfermarktIdFromTbgRoute(id) {
  const match = String(id || '').match(/^tbg-club-(\d+)$/i);
  return match ? match[1] : null;
}

function matchingClub(id) {
  const transfermarktId = transfermarktIdFromTbgRoute(id);
  return state.clubs.find((club) =>
    club.club_id === id
    || String(club.transfermarkt_club_id || '') === id
    || (transfermarktId !== null && (
      String(club.club_id || '') === transfermarktId
      || String(club.transfermarkt_club_id || '') === transfermarktId
    ))
  ) || null;
}

function openRequestedClub() {
  const id = requestedClubRoute();
  if (!id || !state.clubs.length) return false;
  const club = matchingClub(id);
  if (!club) return true;
  state.selectedClubId = club.club_id;
  renderList();
  renderProfile();
  document.getElementById('clubProfile')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  return true;
}

const routeTimer = window.setInterval(() => {
  if (openRequestedClub()) window.clearInterval(routeTimer);
}, 50);
window.setTimeout(() => window.clearInterval(routeTimer), 10000);
