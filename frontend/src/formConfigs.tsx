// Shared, sectioned field configs for the entities whose create/edit form is
// used in more than one place (or benefits from the multi-step wizard).
// Imported by modules.tsx (Planning tabs) and Dashboard.tsx (quick New Project),
// so those forms are literally the same.

import { Field } from './components/formTypes';

const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

export const CLIENT_FIELDS: Field[] = [
  { name: 'name', label: 'Client Name', required: true, section: 'Client' },
  { name: 'clientType', label: 'Client Type', type: 'select', options: opt(['private', 'government', 'individual']), section: 'Client' },
  { name: 'taxNumber', label: 'Tax Number (TIN)', section: 'Client' },
  { name: 'contactName', label: 'Contact Person', section: 'Contact' },
  { name: 'phone', label: 'Phone', section: 'Contact' },
  { name: 'email', label: 'Email', section: 'Contact' },
  { name: 'address', label: 'Address', type: 'textarea', section: 'Contact' },
];

export const PROJECT_FIELDS: Field[] = [
  // ── Project ──
  { name: 'code', label: 'Project Code (auto-generated)', hideOnCreate: true, readOnly: true, section: 'Project' },
  { name: 'name', label: 'Project Name', required: true, section: 'Project' },
  { name: 'projectType', label: 'Project Type', section: 'Project' },
  { name: 'category', label: 'Category', section: 'Project' },
  { name: 'status', label: 'Status', type: 'select', options: opt(['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED']), section: 'Project' },
  { name: 'applicationNumber', label: 'Application Number', section: 'Project' },
  { name: 'permitNumber', label: 'Permit Number', section: 'Project' },
  { name: 'description', label: 'Description', type: 'textarea', section: 'Project' },
  // ── Location & Site ──
  { name: 'location', label: 'Location', type: 'geo', section: 'Location & Site' },
  { name: 'groundSurface', label: 'Ground Surface', type: 'number', section: 'Location & Site' },
  { name: 'groundSurfaceUnit', label: 'Ground Surface Unit', type: 'select', options: opt(['m²', 'are', 'ha', 'ft²', 'acre']), section: 'Location & Site' },
  { name: 'buildingSurface', label: 'Building Surface (m²)', type: 'number', section: 'Location & Site' },
  // ── Client & Team ──
  { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name, section: 'Client & Team', createConfig: { endpoint: '/clients', entityLabel: 'Client', fields: CLIENT_FIELDS } },
  { name: 'managerId', label: 'Project Manager', type: 'select', optionsEndpoint: '/users', optionLabel: (r) => r.fullName, section: 'Client & Team' },
  // ── Commercials & Schedule ──
  { name: 'budget', label: 'Contract Value', type: 'number', section: 'Commercials & Schedule' },
  { name: 'currency', label: 'Currency (e.g. RWF)', section: 'Commercials & Schedule' },
  { name: 'plannedProfitMargin', label: 'Planned Profit Margin %', type: 'number', placeholder: 'Percentage 0–100 (e.g. 15)', section: 'Commercials & Schedule' },
  { name: 'startDate', label: 'Start Date', type: 'date', section: 'Commercials & Schedule' },
  { name: 'endDate', label: 'Planned End Date', type: 'date', section: 'Commercials & Schedule' },
  { name: 'forecastFinishDate', label: 'Forecast Finish Date', type: 'date', hideOnCreate: true, section: 'Commercials & Schedule' },
  { name: 'actualEndDate', label: 'Actual End Date', type: 'date', hideOnCreate: true, section: 'Commercials & Schedule' },
];
