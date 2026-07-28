const SAFE_CLUB_ID = /^[A-Za-z0-9._:-]{1,160}$/;

function requestedClubRoute() {
  const id = String(new URL(window.location.href).searchParams.get('id') || '').trim();
  return SAFE_CLUB_ID.test(id) ? id : null;
}

function tbgRouteIdentity(id) {
  const match = String(id || '').match(/^tbg-club-(\d+)$/i);
  if (!match) return { transfermarktId: null, universeSlot: null };
  const suffix = match[1];
  // Canonical publication builds historically emitted zero-padded universe IDs
  // such as tbg-club-048, plus the unpadded boundary value tbg-club-100.
  // Newer imports may emit tbg-club-${tmId}; provider identity therefore wins,
  // with slot 100 retained only as a compatibility fallback.
  if (/^0\d{2}$/.test(suffix)) return { transfermarktId: null, universeSlot: Number(suffix) };
  if (suffix === '100') return { transfermarktId: suffix, universeSlot: 100 };
  return { transfermarktId: suffix, universeSlot: null };
}

function matchingClub(id) {
  const { transfermarktId, universeSlot } = tbgRouteIdentity(id);
  const direct = state.clubs.find((club) => club.club_id === id || String(club.transfermarkt_club_id || '') === id);
  if (direct) return direct;

  if (transfermarktId !== null) {
    const provider = state.clubs.find((club) =>
      String(club.club_id || '') === transfermarktId
      || String(club.transfermarkt_club_id || '') === transfermarktId
    );
    if (provider) return provider;
  }

  if (universeSlot !== null) {
    return state.clubs.find((club) => Number(club.universe_slot) === universeSlot) || null;
  }
  return null;
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
