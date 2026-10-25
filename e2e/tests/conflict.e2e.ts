import { expect, test } from '@playwright/test';
import { addNode, createProject, saveStatus, waitUntilSaved } from './helpers.js';

test('two tabs editing the same project get a conflict banner and can reload', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const first = await context.newPage();
  await createProject(first, 'Shared');
  const second = await context.newPage();
  await second.goto(first.url());
  await expect(second.locator('.react-flow__pane')).toBeVisible();

  // The first tab saves; the second still has the old version
  await addNode(first, 'Screen', { x: 300, y: 200 });
  await waitUntilSaved(first);
  await addNode(second, 'Endpoint', { x: 300, y: 400 });
  await expect(saveStatus(second)).toHaveText('Not saved: conflict', { timeout: 10_000 });

  await second.getByRole('button', { name: 'Reload latest' }).click();
  await expect(second.locator('.react-flow__node-screen')).toHaveCount(1);
  await expect(second.locator('.react-flow__node-endpoint')).toHaveCount(0);
  await expect(saveStatus(second)).toHaveText('Saved');
  await context.close();
});
