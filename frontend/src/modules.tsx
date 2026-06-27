import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppView } from './types';
import { api } from './lib/api';
import { ModuleDef } from './components/ModuleWorkspace';

const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));
const money = (n: unknown) => Number(n ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 });
const num = (n: unknown) => Number(n ?? 0).toLocaleString();
const date = (d: unknown) => (d ? String(d).slice(0, 10) : '—');

const COST_CATEGORIES = opt(['LABOR', 'MATERIAL', 'EQUIPMENT', 'SUBCONTRACTOR', 'OVERHEAD', 'OTHER']);
const SEVERITY = opt(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'good' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'text-red-600' : tone === 'warn' ? 'text-amber-600' : 'text-brand-primary';
  return (
    <div className="bg-brand-surface-container-lowest p-4 rounded-xl border border-brand-outline-variant/20 shadow-sm">
      <p className="text-brand-on-surface-variant text-[10px] font-bold uppercase tracking-wider">{label}</p>
      <p className={`font-mono text-xl font-extrabold mt-1 ${color}`}>{value}</p>
    </div>
  );
}

// ── Summary banners (real aggregate endpoints) ────────────────
function FinanceSummary({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['finance-summary', projectId ?? 'all'],
    queryFn: () => api.get<any>(`/finance/summary${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label="Budget" value={money(s.budget)} />
      <StatCard label="Actual Cost" value={money(s.actualCost)} tone={s.actualCost > s.budget ? 'bad' : 'good'} />
      <StatCard label="Cost Variance" value={money(s.costVariance)} tone={s.costVariance < 0 ? 'bad' : 'good'} />
      <StatCard label="Outstanding" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'warn' : 'good'} />
      <StatCard label="Forecast Profit" value={money(s.forecastProfit)} tone={s.forecastProfit < 0 ? 'bad' : 'good'} />
    </div>
  );
}

function ProductionSummary({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['production-summary', projectId ?? 'all'],
    queryFn: () => api.get<any>(`/production/summary/metrics${projectId ? `?projectId=${projectId}` : ''}`),
  });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
      <StatCard label="Entries" value={num(s.entries)} />
      <StatCard label="Planned Qty" value={num(s.totalPlanned)} />
      <StatCard label="Actual Qty" value={num(s.totalActual)} />
      <StatCard label="Productivity Index" value={String(s.productivityIndex)} />
      <StatCard label="Variance %" value={`${s.variancePct}%`} tone={s.variancePct < 0 ? 'bad' : 'good'} />
    </div>
  );
}

function CpmPanel({ projectId }: { projectId?: string }) {
  const { data } = useQuery({
    queryKey: ['cpm', projectId ?? 'none'],
    queryFn: () => api.get<any>(`/scheduling/cpm?projectId=${projectId}`),
    enabled: Boolean(projectId),
  });
  if (!projectId) return <div className="text-xs text-brand-on-surface-variant">Select a project to compute the critical path.</div>;
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label="Activities" value={num(s.activities.length)} />
        <StatCard label="Project Duration (days)" value={num(s.projectDuration)} />
        <StatCard label="Critical Path" value={s.criticalPath.join(' → ') || '—'} tone={s.criticalPath.length ? 'warn' : 'good'} />
      </div>
      {s.activities.length > 0 && (
        <div className="bg-brand-surface-container-lowest rounded-xl border border-brand-outline-variant/20 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-brand-outline-variant/20 text-brand-on-surface-variant font-bold text-left">
                {['Code', 'Name', 'Dur', 'ES', 'EF', 'LS', 'LF', 'Float', 'Critical'].map((h) => <th key={h} className="px-4 py-2">{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {s.activities.map((a: any) => (
                <tr key={a.code} className={`border-b border-brand-outline-variant/10 ${a.critical ? 'bg-red-50/50' : ''}`}>
                  <td className="px-4 py-2 font-bold">{a.code}</td>
                  <td className="px-4 py-2">{a.name}</td>
                  <td className="px-4 py-2">{a.duration}</td>
                  <td className="px-4 py-2">{a.es}</td><td className="px-4 py-2">{a.ef}</td>
                  <td className="px-4 py-2">{a.ls}</td><td className="px-4 py-2">{a.lf}</td>
                  <td className="px-4 py-2 font-mono">{a.float}</td>
                  <td className="px-4 py-2">{a.critical ? <span className="text-red-600 font-bold">● Yes</span> : 'No'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InventorySummary() {
  const { data } = useQuery({ queryKey: ['inventory-stock'], queryFn: () => api.get<any>('/inventory/stock') });
  const s = data?.data;
  if (!s) return null;
  return (
    <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
      <StatCard label="Materials" value={num(s.materials.length)} />
      <StatCard label="Stock Value" value={money(s.totalValue)} />
      <StatCard label="Reorder Alerts" value={num(s.reorderCount)} tone={s.reorderCount > 0 ? 'bad' : 'good'} />
    </div>
  );
}

const productivity = (row: Record<string, any>) => {
  const lh = Number(row.laborHours ?? 0);
  return lh > 0 ? (Number(row.actualQty) / lh).toFixed(3) : '—';
};

export const MODULES: Record<string, ModuleDef> = {
  [AppView.PLANNING]: {
    view: AppView.PLANNING,
    title: 'Planning & Resources',
    subtitle: 'Project setup, WBS, BOQ & resource baseline (Module 1)',
    tabs: [
      {
        key: 'projects', label: 'Project Setup', endpoint: '/projects', entityLabel: 'Project',
        readPerm: 'project:read', writePerm: 'project:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' },
          { key: 'status', label: 'Status' },
          { key: 'budget', label: 'Contract Value', align: 'right', render: (r) => money(r.budget) },
          { key: 'progressPct', label: 'Progress', align: 'right', render: (r) => `${num(r.progressPct)}%` },
        ],
        fields: [
          { name: 'code', label: 'Project Code', required: true },
          { name: 'name', label: 'Project Name', required: true },
          { name: 'projectType', label: 'Project Type' },
          { name: 'category', label: 'Category' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']) },
          { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name },
          { name: 'managerId', label: 'Project Manager', type: 'select', optionsEndpoint: '/users', optionLabel: (r) => r.fullName },
          { name: 'budget', label: 'Contract Value', type: 'number' },
          { name: 'currency', label: 'Currency (e.g. USD)' },
          { name: 'plannedProfitMargin', label: 'Planned Profit Margin %', type: 'number' },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'endDate', label: 'Planned End Date', type: 'date' },
          { name: 'actualEndDate', label: 'Actual End Date', type: 'date' },
          { name: 'location', label: 'Location' },
          { name: 'timezone', label: 'Time Zone' },
          { name: 'gpsLat', label: 'GPS Latitude', type: 'number' },
          { name: 'gpsLng', label: 'GPS Longitude', type: 'number' },
          { name: 'description', label: 'Description', type: 'textarea' },
        ],
      },
      {
        key: 'clients', label: 'Clients', endpoint: '/clients', entityLabel: 'Client',
        readPerm: 'client:read', writePerm: 'client:write',
        columns: [
          { key: 'name', label: 'Name' }, { key: 'contactName', label: 'Contact' },
          { key: 'email', label: 'Email' }, { key: 'phone', label: 'Phone' },
        ],
        fields: [
          { name: 'name', label: 'Client Name', required: true },
          { name: 'contactName', label: 'Contact Person' },
          { name: 'phone', label: 'Phone' },
          { name: 'email', label: 'Email' },
          { name: 'taxNumber', label: 'Tax Number' },
          { name: 'address', label: 'Address', type: 'textarea' },
        ],
      },
      {
        key: 'contracts', label: 'Contracts', endpoint: '/contracts', entityLabel: 'Contract',
        readPerm: 'contract:read', writePerm: 'contract:write',
        columns: [
          { key: 'reference', label: 'Reference' },
          { key: 'type', label: 'Type', render: (r) => String(r.type).replace(/_/g, ' ') },
          { key: 'status', label: 'Status' },
          { key: 'value', label: 'Value', align: 'right', render: (r) => money(r.value) },
        ],
        fields: [
          { name: 'reference', label: 'Reference', required: true },
          { name: 'contractNumber', label: 'Contract Number' },
          { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name, required: true },
          { name: 'projectId', label: 'Project', type: 'select', optionsEndpoint: '/projects', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'type', label: 'Contract Type', type: 'select', options: opt(['LUMP_SUM', 'UNIT_PRICE', 'COST_PLUS', 'TIME_AND_MATERIAL']) },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'ACTIVE', 'CLOSED']) },
          { name: 'value', label: 'Contract Value', type: 'number' },
          { name: 'currency', label: 'Currency (e.g. USD)' },
          { name: 'contractDate', label: 'Contract Date', type: 'date' },
          { name: 'commencementDate', label: 'Commencement Date', type: 'date' },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'endDate', label: 'End Date', type: 'date' },
          { name: 'defectsLiabilityDays', label: 'Defects Liability (days)', type: 'number' },
          { name: 'retentionPct', label: 'Retention %', type: 'number' },
          { name: 'advancePayment', label: 'Advance Payment', type: 'number' },
          { name: 'documentsUrl', label: 'Contract Documents (URL)' },
        ],
      },
      {
        key: 'wbs', label: 'WBS', endpoint: '/planning/wbs', entityLabel: 'WBS Item',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Activity' },
          { key: 'level', label: 'Level' }, { key: 'unit', label: 'Unit' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => (r.quantity != null ? num(r.quantity) : '—') },
          { key: 'progressPct', label: 'Progress', align: 'right', render: (r) => `${num(r.progressPct)}%` },
          { key: 'weightPct', label: 'Weight %', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Activity Code', required: true },
          { name: 'name', label: 'Activity Name', required: true },
          { name: 'parentId', label: 'Parent (for hierarchy)', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'unit', label: 'Unit' },
          { name: 'quantity', label: 'Quantity', type: 'number' },
          { name: 'level', label: 'Level', type: 'number' },
          { name: 'weightPct', label: 'Weight %', type: 'number' },
          { name: 'progressPct', label: 'Progress %', type: 'number' },
        ],
      },
      {
        key: 'boq', label: 'BOQ', endpoint: '/planning/boq', entityLabel: 'BOQ Item',
        projectScoped: true, readPerm: 'planning:read', writePerm: 'planning:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'category', label: 'Category' },
          { key: 'description', label: 'Description' },
          { key: 'unit', label: 'Unit' }, { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
          { key: 'rate', label: 'Rate', align: 'right', render: (r) => money(r.rate) },
          { key: 'amount', label: 'Cost', align: 'right', render: (r) => money(r.amount) },
          { key: 'budget', label: 'Budget', align: 'right', render: (r) => money(r.budget) },
          { key: 'revision', label: 'Rev', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true },
          { name: 'category', label: 'Category' },
          { name: 'description', label: 'Description', required: true },
          { name: 'wbsItemId', label: 'WBS Activity', type: 'select', optionsEndpoint: '/planning/wbs', optionLabel: (r) => `${r.code} — ${r.name}` },
          { name: 'unit', label: 'Unit' },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'rate', label: 'Rate', type: 'number', required: true },
          { name: 'markupPct', label: 'Markup %', type: 'number' },
          { name: 'contingencyPct', label: 'Contingency %', type: 'number' },
        ],
      },
    ],
  },

  [AppView.PRODUCTION]: {
    view: AppView.PRODUCTION,
    title: 'Production Control',
    subtitle: 'Daily production, planned vs actual & productivity (Module 2)',
    summary: (pid) => <ProductionSummary projectId={pid} />,
    tabs: [
      {
        key: 'entries', label: 'Daily Entries', endpoint: '/production', entityLabel: 'Production Entry',
        projectScoped: true, readPerm: 'production:read', writePerm: 'production:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'wbsActivity', label: 'Activity' },
          { key: 'plannedQty', label: 'Planned', align: 'right', render: (r) => num(r.plannedQty) },
          { key: 'actualQty', label: 'Actual', align: 'right', render: (r) => num(r.actualQty) },
          { key: 'laborHours', label: 'Labor h', align: 'right', render: (r) => num(r.laborHours) },
          { key: 'prod', label: 'Productivity', align: 'right', render: productivity },
        ],
        fields: [
          { name: 'date', label: 'Date', type: 'date' },
          { name: 'wbsActivity', label: 'WBS Activity', required: true },
          { name: 'unit', label: 'Unit' },
          { name: 'plannedQty', label: 'Planned Qty', type: 'number', required: true },
          { name: 'actualQty', label: 'Actual Qty', type: 'number', required: true },
          { name: 'laborHours', label: 'Labor Hours', type: 'number' },
          { name: 'equipmentHours', label: 'Equipment Hours', type: 'number' },
          { name: 'weatherCondition', label: 'Weather' },
          { name: 'remarks', label: 'Remarks', type: 'textarea' },
        ],
      },
    ],
  },

  [AppView.FINANCE]: {
    view: AppView.FINANCE,
    title: 'Finance & Cost Control',
    subtitle: 'Budgets, actual costs, billing & payments (Module 3)',
    summary: (pid) => <FinanceSummary projectId={pid} />,
    tabs: [
      {
        key: 'budget', label: 'Budget', endpoint: '/finance/budget', entityLabel: 'Budget Line',
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'category', label: 'Category', type: 'select', options: COST_CATEGORIES },
          { name: 'description', label: 'Description', required: true },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
        ],
      },
      {
        key: 'costs', label: 'Actual Costs', endpoint: '/finance/costs', entityLabel: 'Cost Entry',
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'category', label: 'Category', type: 'select', options: COST_CATEGORIES },
          { name: 'description', label: 'Description', required: true },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
      {
        key: 'invoices', label: 'Invoices / IPC', endpoint: '/finance/invoices', entityLabel: 'Invoice',
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'number', label: 'Number' }, { key: 'description', label: 'Description' },
          { key: 'status', label: 'Status' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
          { key: 'issueDate', label: 'Issued', render: (r) => date(r.issueDate) },
        ],
        fields: [
          { name: 'number', label: 'Number', required: true },
          { name: 'description', label: 'Description' },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'SUBMITTED', 'APPROVED', 'PAID', 'REJECTED']) },
          { name: 'issueDate', label: 'Issue Date', type: 'date' },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
        ],
      },
      {
        key: 'payments', label: 'Payments', endpoint: '/finance/payments', entityLabel: 'Payment',
        projectScoped: true, readPerm: 'finance:read', writePerm: 'finance:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'reference', label: 'Reference' },
          { key: 'amount', label: 'Amount', align: 'right', render: (r) => money(r.amount) },
        ],
        fields: [
          { name: 'reference', label: 'Reference', required: true },
          { name: 'amount', label: 'Amount', type: 'number', required: true },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.INVENTORY]: {
    view: AppView.INVENTORY,
    title: 'Inventory Control',
    subtitle: 'Material register, stock ledger & reorder alerts (Module 4)',
    summary: () => <InventorySummary />,
    tabs: [
      {
        key: 'materials', label: 'Materials', endpoint: '/inventory/materials', entityLabel: 'Material',
        readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' }, { key: 'unit', label: 'Unit' },
          { key: 'reorderLevel', label: 'Reorder', align: 'right', render: (r) => num(r.reorderLevel) },
          { key: 'unitCost', label: 'Unit Cost', align: 'right', render: (r) => money(r.unitCost) },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
          { name: 'unit', label: 'Unit' }, { name: 'reorderLevel', label: 'Reorder Level', type: 'number' },
          { name: 'unitCost', label: 'Unit Cost', type: 'number' },
        ],
      },
      {
        key: 'movements', label: 'Stock Movements', endpoint: '/inventory/movements', entityLabel: 'Movement',
        readPerm: 'inventory:read', writePerm: 'inventory:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'material', label: 'Material', render: (r) => r.material?.name ?? '—' },
          { key: 'type', label: 'Type' },
          { key: 'quantity', label: 'Qty', align: 'right', render: (r) => num(r.quantity) },
          { key: 'reference', label: 'Reference' },
        ],
        fields: [
          { name: 'materialId', label: 'Material', optionsEndpoint: '/inventory/materials', optionLabel: (m) => `${m.code} — ${m.name}`, required: true },
          { name: 'type', label: 'Type', type: 'select', options: opt(['RECEIPT', 'ISSUE', 'ADJUSTMENT']), required: true },
          { name: 'quantity', label: 'Quantity', type: 'number', required: true },
          { name: 'unitCost', label: 'Unit Cost', type: 'number' },
          { name: 'reference', label: 'Reference (GRN/Issue No.)' },
          { name: 'note', label: 'Note', type: 'textarea' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.PROCUREMENT]: {
    view: AppView.PROCUREMENT,
    title: 'Procurement',
    subtitle: 'Suppliers & purchase orders (Module 17)',
    tabs: [
      {
        key: 'suppliers', label: 'Suppliers', endpoint: '/procurement/suppliers', entityLabel: 'Supplier',
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'name', label: 'Name' }, { key: 'contactName', label: 'Contact' },
          { key: 'rating', label: 'Rating', align: 'right' },
          { key: 'leadTimeDays', label: 'Lead (days)', align: 'right' },
        ],
        fields: [
          { name: 'name', label: 'Name', required: true }, { name: 'contactName', label: 'Contact Name' },
          { name: 'email', label: 'Email' }, { name: 'phone', label: 'Phone' },
          { name: 'rating', label: 'Rating (0-5)', type: 'number' }, { name: 'leadTimeDays', label: 'Lead Time (days)', type: 'number' },
        ],
      },
      {
        key: 'pos', label: 'Purchase Orders', endpoint: '/procurement/purchase-orders', entityLabel: 'Purchase Order',
        readPerm: 'procurement:read', writePerm: 'procurement:write',
        columns: [
          { key: 'number', label: 'Number' },
          { key: 'supplier', label: 'Supplier', render: (r) => r.supplier?.name ?? '—' },
          { key: 'status', label: 'Status' },
          { key: 'total', label: 'Total', align: 'right', render: (r) => money(r.total) },
        ],
        fields: [
          { name: 'number', label: 'PO Number', required: true },
          { name: 'supplierId', label: 'Supplier', optionsEndpoint: '/procurement/suppliers', optionLabel: (s) => s.name, required: true },
          { name: 'status', label: 'Status', type: 'select', options: opt(['DRAFT', 'ISSUED', 'PARTIAL', 'RECEIVED', 'CANCELLED']) },
          { name: 'expectedDate', label: 'Expected Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.QAQC]: {
    view: AppView.QAQC,
    title: 'QA / QC',
    subtitle: 'Inspections, testing & NCR register (Module 5)',
    tabs: [
      {
        key: 'inspections', label: 'Inspections', endpoint: '/qaqc/inspections', entityLabel: 'Inspection',
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'title', label: 'Title' }, { key: 'type', label: 'Type' },
          { key: 'result', label: 'Result' }, { key: 'inspector', label: 'Inspector' },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'type', label: 'Type' },
          { name: 'result', label: 'Result', type: 'select', options: opt(['PASS', 'FAIL', 'PENDING']) },
          { name: 'inspector', label: 'Inspector' }, { name: 'date', label: 'Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
      {
        key: 'ncrs', label: 'NCR Register', endpoint: '/qaqc/ncrs', entityLabel: 'NCR',
        projectScoped: true, readPerm: 'qaqc:read', writePerm: 'qaqc:write',
        columns: [
          { key: 'number', label: 'Number' }, { key: 'description', label: 'Description' },
          { key: 'severity', label: 'Severity' }, { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'number', label: 'NCR Number', required: true },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY },
          { name: 'status', label: 'Status', type: 'select', options: opt(['OPEN', 'IN_PROGRESS', 'CLOSED']) },
          { name: 'correctiveAction', label: 'Corrective Action', type: 'textarea' },
          { name: 'raisedBy', label: 'Raised By' },
        ],
      },
    ],
  },

  [AppView.HSE]: {
    view: AppView.HSE,
    title: 'HSE Operations',
    subtitle: 'Incidents & toolbox talks (Module 6)',
    tabs: [
      {
        key: 'incidents', label: 'Incidents', endpoint: '/hse/incidents', entityLabel: 'Incident',
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'type', label: 'Type' }, { key: 'severity', label: 'Severity' },
          { key: 'description', label: 'Description' }, { key: 'location', label: 'Location' },
        ],
        fields: [
          { name: 'type', label: 'Type', type: 'select', options: opt(['NEAR_MISS', 'FIRST_AID', 'MEDICAL', 'LOST_TIME', 'FATALITY', 'PROPERTY_DAMAGE']) },
          { name: 'severity', label: 'Severity', type: 'select', options: SEVERITY },
          { name: 'description', label: 'Description', type: 'textarea', required: true },
          { name: 'location', label: 'Location' }, { name: 'reportedBy', label: 'Reported By' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
      {
        key: 'talks', label: 'Toolbox Talks', endpoint: '/hse/toolbox-talks', entityLabel: 'Toolbox Talk',
        projectScoped: true, readPerm: 'hse:read', writePerm: 'hse:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'topic', label: 'Topic' }, { key: 'presenter', label: 'Presenter' },
          { key: 'attendees', label: 'Attendees', align: 'right' },
        ],
        fields: [
          { name: 'topic', label: 'Topic', required: true }, { name: 'presenter', label: 'Presenter' },
          { name: 'attendees', label: 'Attendees', type: 'number' }, { name: 'date', label: 'Date', type: 'date' },
          { name: 'notes', label: 'Notes', type: 'textarea' },
        ],
      },
    ],
  },

  [AppView.RISK]: {
    view: AppView.RISK,
    title: 'Risk Register',
    subtitle: 'Risk scoring & mitigation tracking (Module 24)',
    tabs: [
      {
        key: 'risks', label: 'Risks', endpoint: '/risk', entityLabel: 'Risk',
        projectScoped: true, readPerm: 'risk:read', writePerm: 'risk:write',
        columns: [
          { key: 'title', label: 'Title' }, { key: 'category', label: 'Category' },
          { key: 'probability', label: 'P', align: 'right' }, { key: 'impact', label: 'I', align: 'right' },
          { key: 'score', label: 'Score', align: 'right', render: (r) => <span className={`font-bold ${Number(r.score) >= 15 ? 'text-red-600' : Number(r.score) >= 8 ? 'text-amber-600' : 'text-emerald-600'}`}>{r.score}</span> },
          { key: 'status', label: 'Status' },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'category', label: 'Category' },
          { name: 'probability', label: 'Probability (1-5)', type: 'number', required: true },
          { name: 'impact', label: 'Impact (1-5)', type: 'number', required: true },
          { name: 'status', label: 'Status', type: 'select', options: opt(['OPEN', 'MITIGATING', 'CLOSED']) },
          { name: 'mitigation', label: 'Mitigation', type: 'textarea' }, { name: 'owner', label: 'Owner' },
        ],
      },
    ],
  },

  [AppView.SCHEDULING]: {
    view: AppView.SCHEDULING,
    title: 'Scheduling (CPM)',
    subtitle: 'Activities, dependencies & critical path (Module 13)',
    summary: (pid) => <CpmPanel projectId={pid} />,
    tabs: [
      {
        key: 'activities', label: 'Activities', endpoint: '/scheduling', entityLabel: 'Activity',
        projectScoped: true, readPerm: 'scheduling:read', writePerm: 'scheduling:write',
        columns: [
          { key: 'code', label: 'Code' }, { key: 'name', label: 'Name' },
          { key: 'milestone', label: 'Type', render: (r) => (r.milestone ? '◆ Milestone' : 'Task') },
          { key: 'durationDays', label: 'Duration', align: 'right' },
          { key: 'startDate', label: 'Start', render: (r) => date(r.startDate) },
          { key: 'finishDate', label: 'Finish', render: (r) => date(r.finishDate) },
          { key: 'predecessors', label: 'Predecessors', render: (r) => (r.predecessors ?? []).join(', ') || '—' },
          { key: 'progressPct', label: 'Progress %', align: 'right' },
        ],
        fields: [
          { name: 'code', label: 'Code', required: true }, { name: 'name', label: 'Name', required: true },
          { name: 'durationDays', label: 'Duration (days)', type: 'number', required: true },
          { name: 'startDate', label: 'Start Date', type: 'date' },
          { name: 'milestone', label: 'Milestone?', type: 'select', options: [{ value: 'false', label: 'Task' }, { value: 'true', label: 'Milestone' }] },
          { name: 'predecessors', label: 'Legacy predecessor codes (FS)', type: 'csv', placeholder: 'A10, A20' },
          { name: 'progressPct', label: 'Progress %', type: 'number' },
        ],
      },
      {
        key: 'dependencies', label: 'Dependencies', endpoint: '/scheduling/dependencies', entityLabel: 'Dependency',
        projectScoped: true, readPerm: 'scheduling:read', writePerm: 'scheduling:write',
        columns: [
          { key: 'activity', label: 'Activity', render: (r) => r.activity ? `${r.activity.code} — ${r.activity.name}` : '—' },
          { key: 'predecessor', label: 'Depends On', render: (r) => r.predecessor ? `${r.predecessor.code} — ${r.predecessor.name}` : '—' },
          { key: 'type', label: 'Type' },
          { key: 'lagDays', label: 'Lag (days)', align: 'right' },
        ],
        fields: [
          { name: 'activityId', label: 'Activity', type: 'select', optionsEndpoint: '/scheduling', optionLabel: (r) => `${r.code} — ${r.name}`, required: true },
          { name: 'predecessorId', label: 'Predecessor (depends on)', type: 'select', optionsEndpoint: '/scheduling', optionLabel: (r) => `${r.code} — ${r.name}`, required: true },
          { name: 'type', label: 'Relationship', type: 'select', options: [
            { value: 'FS', label: 'Finish → Start (FS)' },
            { value: 'SS', label: 'Start → Start (SS)' },
            { value: 'FF', label: 'Finish → Finish (FF)' },
            { value: 'SF', label: 'Start → Finish (SF)' },
          ] },
          { name: 'lagDays', label: 'Lag (days)', type: 'number' },
        ],
      },
    ],
  },

  [AppView.FIELDOPS]: {
    view: AppView.FIELDOPS,
    title: 'Field Operations',
    subtitle: 'Site diary, task assignment & attendance (Module 16)',
    tabs: [
      {
        key: 'diary', label: 'Site Diary', endpoint: '/fieldops/diary', entityLabel: 'Diary Entry',
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'weather', label: 'Weather' }, { key: 'workforce', label: 'Workforce', align: 'right' },
          { key: 'notes', label: 'Notes' },
        ],
        fields: [
          { name: 'date', label: 'Date', type: 'date' }, { name: 'weather', label: 'Weather' },
          { name: 'workforce', label: 'Workforce', type: 'number' },
          { name: 'notes', label: 'Notes', type: 'textarea', required: true },
        ],
      },
      {
        key: 'tasks', label: 'Tasks', endpoint: '/fieldops/tasks', entityLabel: 'Task',
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'title', label: 'Title' }, { key: 'assignee', label: 'Assignee' },
          { key: 'status', label: 'Status' }, { key: 'dueDate', label: 'Due', render: (r) => date(r.dueDate) },
        ],
        fields: [
          { name: 'title', label: 'Title', required: true }, { name: 'description', label: 'Description', type: 'textarea' },
          { name: 'assignee', label: 'Assignee' },
          { name: 'status', label: 'Status', type: 'select', options: opt(['TODO', 'IN_PROGRESS', 'DONE', 'BLOCKED']) },
          { name: 'dueDate', label: 'Due Date', type: 'date' },
        ],
      },
      {
        key: 'attendance', label: 'Attendance', endpoint: '/fieldops/attendance', entityLabel: 'Attendance',
        projectScoped: true, readPerm: 'fieldops:read', writePerm: 'fieldops:write',
        columns: [
          { key: 'date', label: 'Date', render: (r) => date(r.date) },
          { key: 'workerName', label: 'Worker' }, { key: 'trade', label: 'Trade' },
          { key: 'hoursWorked', label: 'Hours', align: 'right', render: (r) => num(r.hoursWorked) },
          { key: 'present', label: 'Present', render: (r) => (r.present ? 'Yes' : 'No') },
        ],
        fields: [
          { name: 'workerName', label: 'Worker Name', required: true }, { name: 'trade', label: 'Trade' },
          { name: 'hoursWorked', label: 'Hours Worked', type: 'number' },
          { name: 'date', label: 'Date', type: 'date' },
        ],
      },
    ],
  },

  [AppView.DOCUMENTS]: {
    view: AppView.DOCUMENTS,
    title: 'Documents',
    subtitle: 'Drawings, contracts & reports register (Module 7)',
    tabs: [
      {
        key: 'documents', label: 'Documents', endpoint: '/documents', entityLabel: 'Document',
        readPerm: 'document:read', writePerm: 'document:write',
        columns: [
          { key: 'name', label: 'Name' }, { key: 'category', label: 'Category' },
          { key: 'version', label: 'Ver.', align: 'right' },
          { key: 'url', label: 'Link', render: (r) => <a href={r.url} target="_blank" rel="noreferrer" className="text-brand-primary underline">open</a> },
        ],
        fields: [
          { name: 'name', label: 'Name', required: true }, { name: 'category', label: 'Category' },
          { name: 'url', label: 'File URL', required: true, placeholder: 'https://…' },
          { name: 'version', label: 'Version', type: 'number' },
        ],
      },
    ],
  },
};
