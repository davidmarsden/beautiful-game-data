import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../design-contract/tbg-design-contract.manifest.json', import.meta.url), 'utf8'));
const css = await readFile(new URL(`../${manifest.consumer.path}`, import.meta.url));
const blobHeader = Buffer.from(`blob ${css.byteLength}\0`);
const blobSha = createHash('sha1').update(blobHeader).update(css).digest('hex');
const text = css.toString('utf8');

if (blobSha !== manifest.governedSource.blobSha) {
  throw new Error(`Design contract blob mismatch: expected ${manifest.governedSource.blobSha}, got ${blobSha}`);
}
if (!text.includes(`TBG visual contract v${manifest.version}`)) {
  throw new Error(`Design contract version header does not match ${manifest.version}`);
}
for (const primitive of ['--tbg-colour-paper', '.tbg-nav', '.tbg-panel', '.tbg-card', '.tbg-table', '.tbg-rating', '.tbg-badge', '.tbg-player-link', '.tbg-club-link', ':focus-visible', 'prefers-reduced-motion']) {
  if (!text.includes(primitive)) throw new Error(`Design contract is missing required primitive: ${primitive}`);
}

console.log(`Verified ${manifest.contract} v${manifest.version} (${blobSha})`);
