import { sidebarGroups } from './lib/navigation/registry.js';

const res = sidebarGroups(true, 'admin', { preset: 'completa' });
console.log("Grupos no sidebar:");
for (const g of res) {
  console.log(`[${g.group.label}]`);
  for (const item of g.items) {
    console.log(`  - ${item.label} (${item.href})`);
  }
}
