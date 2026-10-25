import { expect, test } from '@playwright/test';
import { createProject, waitUntilSaved } from './helpers.js';

const spec = `openapi: 3.0.3
info: { title: Pet API, version: "1.0" }
paths:
  /pets:
    get:
      tags: [pets]
      responses: { "200": { description: Pets, content: { application/json: { schema: { type: array, items: { $ref: "#/components/schemas/Pet" } } } } } }
    post:
      tags: [pets]
      requestBody: { content: { application/json: { schema: { $ref: "#/components/schemas/Pet" } } } }
      responses: { "201": { description: Created } }
  /orders:
    get:
      tags: [store]
      responses: { "200": { description: Orders } }
components:
  schemas:
    Pet: { type: object, required: [name], properties: { name: { type: string }, age: { type: integer } } }
`;

test('imports an OpenAPI spec into tag frames, kept after a reload', async ({ page }) => {
  await createProject(page, 'Pets');
  await page.getByRole('button', { name: 'Import' }).click();
  const dialog = page.getByRole('dialog', { name: 'Import' });
  await dialog.getByRole('radio', { name: 'OpenAPI' }).click();
  await dialog.getByLabel('OpenAPI to import').fill(spec);
  await expect(dialog.getByRole('region', { name: 'Preview' })).toContainText('Endpoints: 3 new, 0 updated, 0 unchanged');
  await dialog.getByRole('button', { name: 'Import 3 endpoints' }).click();
  await expect(dialog).toBeHidden();

  await expect(page.locator('.react-flow__node-endpoint')).toHaveCount(3);
  await expect(page.locator('.react-flow__node-frame')).toHaveCount(2);
  await waitUntilSaved(page);

  await page.reload();
  await expect(page.locator('.react-flow__node-endpoint')).toHaveCount(3);
  await page.getByRole('button', { name: 'API Spec' }).click();
  await expect(page.getByRole('dialog')).toContainText('Pet API');
});
