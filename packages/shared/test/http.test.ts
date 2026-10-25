import { describe, expect, it } from 'vitest';
import { CanvasDoc, CreateProject, SaveCanvas, emptyCanvas, toValidationIssues } from '../src';

describe('http schemas', () => {
  it('trims and requires project names', () => {
    expect(CreateProject.parse({ name: '  Shop  ' })).toEqual({ name: 'Shop' });
    expect(CreateProject.safeParse({ name: '   ' }).success).toBe(false);
    expect(CreateProject.safeParse({ name: 'x'.repeat(121) }).success).toBe(false);
  });

  it('validates the doc and a positive integer version on save', () => {
    expect(SaveCanvas.safeParse({ doc: emptyCanvas(), version: 1 }).success).toBe(true);
    expect(SaveCanvas.safeParse({ doc: emptyCanvas(), version: 0 }).success).toBe(false);
    expect(SaveCanvas.safeParse({ doc: emptyCanvas(), version: 1.5 }).success).toBe(false);
  });

  it('reports canvas integrity issues with paths into the body', () => {
    const doc = { ...emptyCanvas(), edges: [{ id: 'e', kind: 'calls', source: 'a', target: 'b' }] };
    const result = SaveCanvas.safeParse({ doc, version: 1 });
    expect(result.success).toBe(false);
    expect(toValidationIssues(result.error!.issues)).toEqual([
      { path: ['doc', 'edges', 0], message: 'Edge references a missing node' },
    ]);
  });

  it('fills document defaults', () => {
    const minimal = { schemaVersion: 1, nodes: [], edges: [], flows: [] };
    expect(CanvasDoc.parse(minimal)).toEqual(emptyCanvas());
  });
});
