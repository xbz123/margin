import fs from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../../../', import.meta.url)).replace(/\/$/, '');
const original = fs.readFileSync(root + '/tests/margin/answer-regression.test.mjs', 'utf8');
let source = original.slice(0, original.indexOf("test('a typed question"))
  .replace("'./mock-openai.mjs'", JSON.stringify(new URL('./mock-openai-retry.mjs', import.meta.url).href))
  .replace("'./launch-app.mjs'", JSON.stringify(pathToFileURL(root + '/tests/margin/launch-app.mjs').href))
  .replace("'../../scripts/margin/isolation/env.mjs'", JSON.stringify(pathToFileURL(root + '/scripts/margin/isolation/env.mjs').href))
  .replaceAll('import.meta.url', JSON.stringify(pathToFileURL(root + '/tests/margin/answer-regression.test.mjs').href));
source += `
test('supported UI: Retry then Answer then Remove all must stop later screenshot sends', async () => {
  await pressScreenshotShortcut();
  await overlay.getByAltText('Screenshot 1', { exact: true }).waitFor();
  mock.setScript({ errorStatus: 400 });
  await ask('Initial screenshot question');
  await overlay.getByRole('button', { name: 'Retry', exact: true }).waitFor({ state: 'visible' });
  const beforeRetry = mock.chatRequests().length;
  mock.setScript({ errorStatus: 503 }); // Normal provider retry-after: 4 seconds.
  await overlay.getByRole('button', { name: 'Retry', exact: true }).click();
  for (let n = 0; n < 100 && mock.chatRequests().length === beforeRetry; n++) await new Promise(r => setTimeout(r, 20));
  assert.equal(mock.chatRequests().length, beforeRetry + 1);
  const answer = overlay.getByRole('button', { name: 'Answer', exact: true });
  assert.equal(await answer.isEnabled(), true);
  await answer.click();
  await overlay.getByRole('button', { name: 'Stop', exact: true }).waitFor();
  const remove = overlay.getByRole('button', { name: 'Remove all', exact: true });
  assert.equal(await remove.isEnabled(), true);
  await remove.click();
  await overlay.getByAltText('Screenshot 1', { exact: true }).waitFor({ state: 'hidden' });
  const afterRemoval = mock.chatRequests().length;
  mock.setScript({ errorStatus: 0, chunks: ['Queued original answer.'], delayMs: 5 });
  await new Promise(r => setTimeout(r, 4500));
  const later = mock.chatRequests().slice(afterRemoval);
  assert.equal(later.filter(entry => JSON.stringify(entry.body).includes('data:image/')).length, 0,
    'normal UI must not resend a removed screenshot after starting new dictation');
});
`;
await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
