// Shared, sectioned field configs for the entities whose create/edit form is
// used in more than one place (or benefits from the multi-step wizard).
// Imported by modules.tsx (Planning tabs) and Dashboard.tsx (quick New Project),
// so those forms are literally the same.

import { Field } from './components/formTypes';

const opt = (vals: string[]) => vals.map((v) => ({ value: v, label: v.replace(/_/g, ' ') }));

// ── Preset option lists for open taxonomies (used with `creatable: true`, so a
//    user can still add a value that isn't listed). Reused across modules.tsx. ──
export const UNIT_OPTIONS = opt(['m³', 'm²', 'm', 'km', 'kg', 'ton', 'bag', 'pcs', 'set', 'roll', 'sheet', 'L', 'drum', 'trip', 'load', 'LS', 'day', 'hr', 'week', 'month']);
export const PROJECT_TYPE_OPTIONS = opt(['Residential', 'Commercial', 'Industrial', 'Institutional', 'Infrastructure', 'Mixed-Use', 'Renovation', 'Hospitality', 'Healthcare', 'Educational']);
export const PROJECT_CATEGORY_OPTIONS = opt(['Building Construction', 'Civil Engineering', 'Road & Highway', 'Water & Sanitation', 'Electrical & Mechanical', 'Finishing & Fit-out', 'Renovation & Maintenance', 'Landscaping', 'Bridges & Structures']);
export const MATERIAL_CATEGORY_OPTIONS = opt(['Cement & Concrete', 'Aggregates', 'Steel & Rebar', 'Timber', 'Blocks & Bricks', 'Roofing', 'Electrical', 'Plumbing', 'Paints & Finishes', 'Hardware', 'Sanitary', 'Tiles', 'Glass & Aluminium', 'Fuel & Lubricants', 'Safety / PPE']);
export const SUPPLIER_CATEGORY_OPTIONS = opt(['Cement & Concrete', 'Aggregates', 'Steel & Rebar', 'Timber', 'Electrical', 'Plumbing', 'Finishes', 'Hardware', 'Equipment Rental', 'Transport', 'Fuel', 'Professional Services', 'Subcontractor']);
export const BOQ_CATEGORY_OPTIONS = opt(['Preliminaries', 'Substructure', 'Superstructure', 'Concrete Works', 'Masonry', 'Roofing', 'Finishes', 'Joinery', 'Electrical', 'Plumbing', 'Painting', 'External Works']);
export const PPE_TYPE_OPTIONS = opt(['Helmet / Hard Hat', 'Safety Boots', 'Gloves', 'Hi-Vis Vest', 'Safety Goggles', 'Ear Protection', 'Dust Mask / Respirator', 'Full Body Harness', 'Face Shield', 'Overalls', 'Rain Gear']);
export const INSPECTION_TYPE_OPTIONS = opt(['Material Inspection', 'Work-in-Progress', 'Pre-Pour', 'Post-Pour', 'Dimensional', 'Structural', 'Finishing', 'Snagging', 'Handover', 'Safety']);
export const RISK_CATEGORY_OPTIONS = opt(['Safety', 'Financial', 'Schedule', 'Technical', 'Environmental', 'Contractual', 'Quality', 'Resource', 'Regulatory', 'Weather']);
export const DOCUMENT_CATEGORY_OPTIONS = opt(['Drawing', 'Contract', 'Permit', 'Report', 'Certificate', 'Invoice', 'Correspondence', 'Photo', 'Specification', 'Minutes']);

export const CLIENT_FIELDS: Field[] = [
  { name: 'name', label: 'Client Name', required: true, placeholder: 'e.g. Acme Construction Ltd', section: 'Client' },
  { name: 'clientType', label: 'Client Type', type: 'select', options: opt(['private', 'government', 'individual']), section: 'Client' },
  { name: 'taxNumber', label: 'Tax Number (TIN)', placeholder: 'e.g. 100123456', section: 'Client' },
  { name: 'contactName', label: 'Contact Person', placeholder: 'e.g. Jane Doe', section: 'Contact' },
  { name: 'phone', label: 'Phone', placeholder: 'e.g. +250 788 123 456', section: 'Contact' },
  { name: 'email', label: 'Email', placeholder: 'e.g. jane@acme.rw', section: 'Contact' },
  { name: 'address', label: 'Address', type: 'textarea', placeholder: 'Street, city, country', section: 'Contact' },
];

export const PROJECT_FIELDS: Field[] = [
  // ── Project ──
  { name: 'code', label: 'Project Code (auto-generated)', hideOnCreate: true, readOnly: true, section: 'Project' },
  { name: 'name', label: 'Project Name', required: true, placeholder: 'e.g. Skyline Tower B', section: 'Project' },
  { name: 'projectType', label: 'Project Type', type: 'select', creatable: true, options: PROJECT_TYPE_OPTIONS, section: 'Project' },
  { name: 'category', label: 'Category', type: 'select', creatable: true, options: PROJECT_CATEGORY_OPTIONS, section: 'Project' },
  { name: 'status', label: 'Status', type: 'select', options: opt(['PLANNING', 'ACTIVE', 'ON_HOLD', 'AT_RISK', 'COMPLETED', 'CANCELLED']), section: 'Project' },
  { name: 'applicationNumber', label: 'Application Number', placeholder: 'e.g. APP-2026-0142', section: 'Project' },
  { name: 'permitNumber', label: 'Permit Number', placeholder: 'e.g. BP-2026-0091', section: 'Project' },
  { name: 'description', label: 'Description', type: 'textarea', placeholder: 'Short summary of the project scope', section: 'Project' },
  // ── Location & Site ──
  { name: 'location', label: 'Location', type: 'geo', section: 'Location & Site' },
  { name: 'groundSurface', label: 'Ground Surface', type: 'number', placeholder: 'e.g. 1200', section: 'Location & Site' },
  { name: 'groundSurfaceUnit', label: 'Ground Surface Unit', type: 'select', options: opt(['m²', 'are', 'ha', 'ft²', 'acre']), section: 'Location & Site' },
  { name: 'buildingSurface', label: 'Building Surface (m²)', type: 'number', placeholder: 'e.g. 850', section: 'Location & Site' },
  // ── Client & Team ──
  { name: 'clientId', label: 'Client', type: 'select', optionsEndpoint: '/clients', optionLabel: (r) => r.name, section: 'Client & Team', createConfig: { endpoint: '/clients', entityLabel: 'Client', fields: CLIENT_FIELDS } },
  { name: 'managerId', label: 'Project Manager', type: 'select', optionsEndpoint: '/users', optionLabel: (r) => r.fullName, section: 'Client & Team' },
  // ── Commercials & Schedule ──
  { name: 'budget', label: 'Contract Value', type: 'number', placeholder: 'e.g. 250000000', section: 'Commercials & Schedule' },
  { name: 'currency', label: 'Currency', placeholder: 'e.g. RWF', section: 'Commercials & Schedule' },
  { name: 'plannedProfitMargin', label: 'Planned Profit Margin %', type: 'number', placeholder: 'Percentage 0–100 (e.g. 15)', section: 'Commercials & Schedule' },
  { name: 'startDate', label: 'Start Date', type: 'date', section: 'Commercials & Schedule' },
  { name: 'endDate', label: 'Planned End Date', type: 'date', section: 'Commercials & Schedule' },
  { name: 'forecastFinishDate', label: 'Forecast Finish Date', type: 'date', hideOnCreate: true, section: 'Commercials & Schedule' },
  { name: 'actualEndDate', label: 'Actual End Date', type: 'date', hideOnCreate: true, section: 'Commercials & Schedule' },
];
