import { expect, type Locator, type Page } from '@playwright/test';

/** Creates a project from the projects page and waits for its empty canvas */
export async function createProject(page: Page, name: string): Promise<string> {
  await page.goto('/');
  await page.getByLabel('New project name').fill(name);
  await page.getByRole('button', { name: 'Create' }).click();
  await page.waitForURL(/\/p\/[^/]+$/);
  await expect(page.locator('.react-flow__pane')).toBeVisible();
  return page.url().split('/p/')[1]!;
}

/** Picks a toolbar tool ("Screen", "Endpoint", ...) and clicks the canvas at a point of the pane */
export async function addNode(page: Page, tool: string, at: { x: number; y: number }): Promise<Locator> {
  const before = await page.locator('.react-flow__node').count();
  await page.getByRole('navigation', { name: 'Tools' }).getByRole('button', { name: tool, exact: true }).click();
  await page.locator('.react-flow__pane').click({ position: at });
  await expect(page.locator('.react-flow__node')).toHaveCount(before + 1);
  // A new node is selected; pin the locator to its id (".selected" would follow the selection)
  const id = await page.locator('.react-flow__node.selected').getAttribute('data-id');
  return page.locator(`.react-flow__node[data-id="${id}"]`);
}

/** Drags from a node's bottom (source) handle to another node's top (target) handle */
export async function connect(page: Page, from: Locator, to: Locator) {
  // Handles show on hover
  await from.hover();
  const source = await from.locator('.react-flow__handle.source[data-handleid="b"]').boundingBox();
  const target = await to.locator('.react-flow__handle.target[data-handleid="t"]').boundingBox();
  if (!source || !target) throw new Error('Handle not visible');
  await page.mouse.move(source.x + source.width / 2, source.y + source.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 12 });
  await page.mouse.up();
}

/** The save state in the top bar ("Saved", "Unsaved changes", "Not saved: conflict", ...) */
export const saveStatus = (page: Page) => page.locator('header [role="status"]');

export async function waitUntilSaved(page: Page) {
  await expect(saveStatus(page)).toHaveText('Saved', { timeout: 10_000 });
}
