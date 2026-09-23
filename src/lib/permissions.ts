/**
 * Permission catalogue + default role matrix.
 * Roles are rows in the DB (editable by a Super Admin); this file seeds them and provides typed keys.
 */
export const PERMISSIONS = [
  // group, key, description
  ['Dashboard', 'dashboard.view', 'View the executive dashboard'],
  ['Projects', 'projects.view', 'View projects (assigned projects only unless "view all")'],
  ['Projects', 'projects.viewAll', 'View every project, not only assigned ones'],
  ['Projects', 'projects.create', 'Create projects'],
  ['Projects', 'projects.edit', 'Edit projects, milestones and resource assignments'],
  ['Projects', 'projects.archive', 'Archive, cancel and restore projects'],
  ['Financials', 'profit.view', 'See revenue, profit, margins and receivables'],
  ['Financials', 'costs.view', 'See costs and budgets'],
  ['Financials', 'costs.create', 'Add cost entries'],
  ['Financials', 'costs.edit', 'Edit / void any cost entry'],
  ['Financials', 'costs.approve', 'Approve costs and override budget limits'],
  ['Financials', 'budgets.edit', 'Change project and category budgets'],
  ['Financials', 'payments.view', 'View invoices and payments'],
  ['Financials', 'payments.manage', 'Create invoices and record payments'],
  ['Clients', 'clients.view', 'View clients'],
  ['Clients', 'clients.manage', 'Create / edit / archive clients'],
  ['Resources', 'resources.view', 'View resources and vendors'],
  ['Resources', 'resources.manage', 'Create / edit resources and vendors'],
  ['Expenses', 'expenses.view', 'View company expenses'],
  ['Expenses', 'expenses.create', 'Add expenses'],
  ['Expenses', 'expenses.edit', 'Edit / void expenses'],
  ['Expenses', 'allocations.manage', 'Allocate expenses and employee costs'],
  ['Retainers', 'retainers.view', 'View retainers'],
  ['Retainers', 'retainers.manage', 'Create / renew / cancel retainers'],
  ['Deals', 'deals.view', 'View deals and quotations'],
  ['Deals', 'deals.manage', 'Create and edit deals'],
  ['Reports', 'reports.view', 'View reports, analytics and comparisons'],
  ['Reports', 'reports.export', 'Export data (CSV / Excel / PDF)'],
  ['Reports', 'forecast.view', 'View forecasts'],
  ['Governance', 'approvals.decide', 'Approve or reject approval requests'],
  ['Governance', 'audit.view', 'View the audit log'],
  ['Governance', 'import.run', 'Import CSV / Excel data'],
  ['Admin', 'users.manage', 'Manage users'],
  ['Admin', 'roles.manage', 'Manage roles and permissions'],
  ['Admin', 'settings.manage', 'Manage company settings, categories and thresholds'],
  ['Admin', 'backup.run', 'Create data exports / backups'],
] as const;

export type Perm = (typeof PERMISSIONS)[number][1];
export const ALL_PERMS: Perm[] = PERMISSIONS.map((p) => p[1]);

export const ROLE_KEYS = ['SUPER_ADMIN', 'ADMIN', 'FINANCE', 'PROJECT_MANAGER', 'TEAM_MEMBER', 'VIEWER'] as const;
export type RoleKey = (typeof ROLE_KEYS)[number];

const without = (list: Perm[], drop: Perm[]) => list.filter((p) => !drop.includes(p));

export const ROLE_DEFAULTS: Record<RoleKey, { name: string; description: string; perms: Perm[] }> = {
  SUPER_ADMIN: { name: 'Super Admin', description: 'Everything, including roles and backups.', perms: ALL_PERMS },
  ADMIN: { name: 'Admin', description: 'Everything except role editing and backups.', perms: without(ALL_PERMS, ['roles.manage', 'backup.run']) },
  FINANCE: {
    name: 'Finance',
    description: 'Financial data, expenses, payments and reports.',
    perms: [
      'dashboard.view', 'projects.view', 'projects.viewAll', 'profit.view', 'costs.view', 'costs.create', 'costs.edit', 'costs.approve',
      'budgets.edit', 'payments.view', 'payments.manage', 'clients.view', 'resources.view', 'expenses.view', 'expenses.create',
      'expenses.edit', 'allocations.manage', 'retainers.view', 'deals.view', 'reports.view', 'reports.export', 'forecast.view',
      'approvals.decide', 'import.run',
    ],
  },
  PROJECT_MANAGER: {
    name: 'Project Manager',
    description: 'Assigned projects, their costs, budgets and resources.',
    perms: ['dashboard.view', 'projects.view', 'projects.edit', 'costs.view', 'costs.create', 'clients.view', 'resources.view', 'retainers.view'],
  },
  TEAM_MEMBER: {
    name: 'Team Member',
    description: 'Assigned projects; can add cost entries.',
    perms: ['projects.view', 'costs.view', 'costs.create'],
  },
  VIEWER: {
    name: 'Viewer',
    description: 'Read-only access.',
    perms: [
      'dashboard.view', 'projects.view', 'projects.viewAll', 'profit.view', 'costs.view', 'payments.view', 'clients.view',
      'resources.view', 'expenses.view', 'retainers.view', 'deals.view', 'reports.view', 'forecast.view',
    ],
  },
};
