# Pink Final design-contract adoption

Status: **active consumer**  
Contract: **tbg-design-contract v1.0.1**  
Roadmap: `beautiful-game-manager#123`

The Pink Final consumes the governed visual contract from `davidmarsden/beautiful-game-manager` as a local, byte-for-byte copy. The immutable consumer file is `site/tbg-design-contract.css`; Pink Final-specific editorial mappings live separately in `public/pink-final-theme.css`.

## Integrity

`design-contract/tbg-design-contract.manifest.json` pins the source repository, source path, semantic version and Git blob SHA. `npm run design-contract:verify` recomputes the consumer file's Git blob identity and fails if its bytes or version drift.

The scouting-site build publishes both stylesheets at the site root and injects them into every built page after the page's legacy stylesheet. The shared navigation also receives the neutral `.tbg-nav` primitive while retaining Pink Final's `.nav` product class.

## Product boundary

The copied contract contains presentation tokens and neutral primitives only. It does not import Manager Portal rendering, authentication, canonical saves, manager commands, appointments or hidden world state. Pink Final remains a public editorial and research product.

## Upgrade

1. Review the new governed release in `beautiful-game-manager`.
2. Copy the exact released CSS bytes into `site/tbg-design-contract.css`.
3. Update the version and source blob SHA in the manifest.
4. Adjust `public/pink-final-theme.css` only where the release requires product mapping changes.
5. Run `npm test`, `npm run design-contract:verify` and `npm run build:scouting-site`.
6. Review the built front page and all seven public sections at desktop and compact widths.
7. Merge and deploy Pink Final independently.

## Rollback

Revert the consumer adoption or upgrade commit, or redeploy the previous GitHub Pages build. Do not modify the governed source merely to roll back Pink Final. After rollback, run the verifier to confirm that the local CSS and manifest again identify the same release.
