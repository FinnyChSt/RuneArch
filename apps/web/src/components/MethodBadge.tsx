import type { HttpMethod as Method } from '@flowcanvas/shared';

const METHOD_BG: Record<Method, string> = {
  GET: 'bg-method-get',
  POST: 'bg-method-post',
  PUT: 'bg-method-put',
  PATCH: 'bg-method-patch',
  DELETE: 'bg-method-delete',
};

export function MethodBadge({ method, className = '' }: { method: Method; className?: string }) {
  return (
    <span className={`rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold text-canvas ${METHOD_BG[method]} ${className}`}>
      {method}
    </span>
  );
}
