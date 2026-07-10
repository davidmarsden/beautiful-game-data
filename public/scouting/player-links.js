const originalScoutingRender = render;
render = function renderWithPlayerLinks() {
  originalScoutingRender();
  const start = (state.page - 1) * state.perPage;
  const pageRows = state.filtered.slice(start, start + state.perPage);
  document.querySelectorAll("#playersTable tbody tr").forEach((row, index) => {
    const player = pageRows[index];
    const name = row.querySelector(".player-name");
    if (!player || !name) return;
    const id = encodeURIComponent(player.tbg_player_id || player.transfermarkt_player_id || player.player_name);
    const link = document.createElement("a");
    link.href = `../players/?id=${id}`;
    link.className = "player-profile-link";
    link.textContent = name.textContent;
    name.replaceWith(link);
  });
};