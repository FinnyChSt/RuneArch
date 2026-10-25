import type { FeatureRoles } from '../feature-scope';

/** A scoped export's feature marks (`ScopedDoc` fits): each class gets a comment with its role */
export type CodegenOptions = { roles?: FeatureRoles; featureName?: string };
