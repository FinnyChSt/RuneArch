import { modelRefOf, type ApiModel } from '../api';

/** Models used by others first, doc order otherwise; in a cycle, doc order decides and one reference points forward */
export function dependencyOrder(models: readonly ApiModel[]): ApiModel[] {
  const byId = new Map(models.map((m) => [m.id, m]));
  const done = new Set<string>();
  const visiting = new Set<string>();
  const out: ApiModel[] = [];
  const visit = (m: ApiModel) => {
    if (done.has(m.id) || visiting.has(m.id)) return;
    visiting.add(m.id);
    for (const f of m.fields) {
      const dep = byId.get(modelRefOf(f.type) ?? '');
      if (dep) visit(dep);
    }
    visiting.delete(m.id);
    done.add(m.id);
    out.push(m);
  };
  models.forEach(visit);
  return out;
}
