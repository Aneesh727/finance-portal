/** typed shortcuts to every route handler, so tests read like API calls */
import * as projects from '@/app/api/projects/route';
import * as projectById from '@/app/api/projects/[id]/route';
import * as projectStatus from '@/app/api/projects/[id]/status/route';
import * as projectBudgets from '@/app/api/projects/[id]/budgets/route';
import * as projectSchedule from '@/app/api/projects/[id]/schedule/route';
import * as projectMilestones from '@/app/api/projects/[id]/milestones/route';
import * as projectResources from '@/app/api/projects/[id]/resources/route';
import * as projectAdjustments from '@/app/api/projects/[id]/adjustments/route';
import * as projectHistory from '@/app/api/projects/[id]/history/route';
import * as projectArchive from '@/app/api/projects/[id]/archive/route';
import * as projectRestore from '@/app/api/projects/[id]/restore/route';
import * as milestoneById from '@/app/api/milestones/[id]/route';
import * as projectResourceById from '@/app/api/project-resources/[id]/route';
import * as adjustmentById from '@/app/api/adjustments/[id]/route';
import * as costs from '@/app/api/costs/route';
import * as costById from '@/app/api/costs/[id]/route';
import * as costVoid from '@/app/api/costs/[id]/void/route';
import * as costConvert from '@/app/api/costs/[id]/convert/route';
import * as invoices from '@/app/api/invoices/route';
import * as invoiceById from '@/app/api/invoices/[id]/route';
import * as invoiceIssue from '@/app/api/invoices/[id]/issue/route';
import * as invoiceCancel from '@/app/api/invoices/[id]/cancel/route';
import * as payments from '@/app/api/payments/route';
import * as paymentVoid from '@/app/api/payments/[id]/void/route';
import * as expenses from '@/app/api/expenses/route';
import * as expenseById from '@/app/api/expenses/[id]/route';
import * as expenseVoid from '@/app/api/expenses/[id]/void/route';
import * as expenseAlloc from '@/app/api/expenses/[id]/allocations/route';
import * as recurring from '@/app/api/recurring/route';
import * as recurringById from '@/app/api/recurring/[id]/route';
import * as recurringGen from '@/app/api/recurring/[id]/generate/route';
import * as empAlloc from '@/app/api/employee-allocations/route';
import * as retainers from '@/app/api/retainers/route';
import * as retainerById from '@/app/api/retainers/[id]/route';
import * as retainerRenew from '@/app/api/retainers/[id]/renew/route';
import * as retainerCancel from '@/app/api/retainers/[id]/cancel/route';
import * as retainerHours from '@/app/api/retainers/[id]/hours/route';
import * as retainerInvoices from '@/app/api/retainers/[id]/invoices/route';
import * as retainerOverage from '@/app/api/retainers/[id]/overage/route';
import * as deals from '@/app/api/deals/route';
import * as dealById from '@/app/api/deals/[id]/route';
import * as dealConvert from '@/app/api/deals/[id]/convert/route';
import * as dealLost from '@/app/api/deals/[id]/lost/route';
import * as approvals from '@/app/api/approvals/route';
import * as approvalDecide from '@/app/api/approvals/[id]/decide/route';
import * as approvalCancel from '@/app/api/approvals/[id]/cancel/route';
import * as notifications from '@/app/api/notifications/route';
import * as notificationsRead from '@/app/api/notifications/read/route';
import * as notificationsScan from '@/app/api/notifications/scan/route';
import * as dashboard from '@/app/api/dashboard/route';
import * as reportProfit from '@/app/api/reports/profitability/route';
import * as reportCompare from '@/app/api/reports/compare/route';
import * as reportRecv from '@/app/api/reports/receivables/route';
import * as reportPnl from '@/app/api/reports/pnl/route';
import * as reportForecast from '@/app/api/reports/forecast/route';
import * as clients from '@/app/api/clients/route';
import * as clientById from '@/app/api/clients/[id]/route';
import * as clientArchive from '@/app/api/clients/[id]/archive/route';
import * as vendors from '@/app/api/vendors/route';
import * as resources from '@/app/api/resources/route';
import * as resourceById from '@/app/api/resources/[id]/route';
import * as categories from '@/app/api/categories/route';
import * as users from '@/app/api/users/route';
import * as userById from '@/app/api/users/[id]/route';
import * as userReset from '@/app/api/users/[id]/reset-password/route';
import * as roles from '@/app/api/roles/route';
import * as roleById from '@/app/api/roles/[id]/route';
import * as settings from '@/app/api/settings/route';
import * as auditLog from '@/app/api/audit/route';
import * as attachments from '@/app/api/attachments/route';
import * as attachmentById from '@/app/api/attachments/[id]/route';
import * as exportDs from '@/app/api/export/[dataset]/route';
import * as importValidate from '@/app/api/import/validate/route';
import * as importCommit from '@/app/api/import/commit/route';
import * as importTemplate from '@/app/api/import/template/route';
import * as search from '@/app/api/search/route';
import * as backup from '@/app/api/backup/route';
import * as login from '@/app/api/auth/login/route';
import * as me from '@/app/api/auth/me/route';
import * as changePw from '@/app/api/auth/change-password/route';
import * as logout from '@/app/api/auth/logout/route';
import * as setup from '@/app/api/setup/route';

export const H = {
  projects, projectById, projectStatus, projectBudgets, projectSchedule, projectMilestones, projectResources, projectAdjustments, projectHistory, projectArchive, projectRestore,
  milestoneById, projectResourceById, adjustmentById, costs, costById, costVoid, costConvert, invoices, invoiceById, invoiceIssue, invoiceCancel, payments, paymentVoid,
  expenses, expenseById, expenseVoid, expenseAlloc, recurring, recurringById, recurringGen, empAlloc, retainers, retainerById, retainerRenew, retainerCancel, retainerHours, retainerInvoices, retainerOverage,
  deals, dealById, dealConvert, dealLost, approvals, approvalDecide, approvalCancel, notifications, notificationsRead, notificationsScan, dashboard,
  reportProfit, reportCompare, reportRecv, reportPnl, reportForecast, clients, clientById, clientArchive, vendors, resources, resourceById, categories, users, userById, userReset, roles, roleById,
  settings, auditLog, attachments, attachmentById, exportDs, importValidate, importCommit, importTemplate, search, backup, login, me, changePw, logout, setup,
};
