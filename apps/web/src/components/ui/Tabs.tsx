import * as RadixTabs from '@radix-ui/react-tabs';
import type { ReactNode } from 'react';

export const Tabs = RadixTabs.Root;

export function TabList({ children }: { children: ReactNode }) {
  return <RadixTabs.List className="-mt-1 mb-4 flex gap-1 border-b border-border">{children}</RadixTabs.List>;
}

/** Tab trigger; `alert` adds a dot when the tab holds validation errors */
export function Tab({ value, alert, children }: { value: string; alert?: boolean; children: ReactNode }) {
  return (
    <RadixTabs.Trigger
      value={value}
      className="-mb-px flex items-center gap-1.5 border-b-2 border-transparent px-3 py-1.5 text-text-muted hover:text-text data-[state=active]:border-accent data-[state=active]:text-text"
    >
      {children}
      {alert && <span aria-label="has errors" className="size-1.5 rounded-full bg-danger" />}
    </RadixTabs.Trigger>
  );
}

export function TabPanel({ value, children }: { value: string; children: ReactNode }) {
  return (
    <RadixTabs.Content value={value} className="outline-none">
      {children}
    </RadixTabs.Content>
  );
}
