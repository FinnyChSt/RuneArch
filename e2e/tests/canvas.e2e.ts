import { expect, test } from '@playwright/test';
import { addNode, connect, createProject, saveStatus, waitUntilSaved } from './helpers.js';

test('adds and connects nodes, autosaves, and keeps them after a reload', async ({ page }) => {
  await createProject(page, 'Checkout');
  const screen = await addNode(page, 'Screen', { x: 300, y: 200 });
  const endpoint = await addNode(page, 'Endpoint', { x: 300, y: 480 });
  await expect(saveStatus(page)).not.toHaveText('Saved');

  await connect(page, screen, endpoint);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await waitUntilSaved(page);

  await page.reload();
  await expect(page.locator('.react-flow__node-screen')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-endpoint')).toHaveCount(1);
  await expect(page.locator('.react-flow__edge')).toHaveCount(1);
  await expect(saveStatus(page)).toHaveText('Saved');
});

test('undoes and redoes canvas changes', async ({ page }) => {
  await createProject(page, 'Undo');
  await addNode(page, 'Table', { x: 300, y: 200 });
  await addNode(page, 'Endpoint', { x: 600, y: 200 });

  const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
  await page.keyboard.press(`${mod}+z`);
  await expect(page.locator('.react-flow__node')).toHaveCount(1);
  await expect(page.locator('.react-flow__node-table')).toHaveCount(1);
  await page.keyboard.press(`${mod}+Shift+z`);
  await expect(page.locator('.react-flow__node-endpoint')).toHaveCount(1);
});
