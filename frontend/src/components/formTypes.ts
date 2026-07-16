// Shared types for the config-driven CRUD forms (ResourceManager + EntityForm).

export interface Field {
  name: string;
  label: string;
  type?: 'text' | 'number' | 'textarea' | 'select' | 'date' | 'csv' | 'geo';
  options?: { value: string; label: string }[];
  /** Populate a select from a live API list (foreign-key pickers). */
  optionsEndpoint?: string;
  /** Append the current projectId to optionsEndpoint so the picker only lists this project's records. */
  scopeToProject?: boolean;
  optionLabel?: (row: Record<string, any>) => string;
  required?: boolean;
  placeholder?: string;
  /** Read-only display (e.g. an auto-generated code shown on the edit screen). */
  readOnly?: boolean;
  /** Hide this field on the create form (e.g. auto-generated or set-later fields). */
  hideOnCreate?: boolean;
  /** Hide this field on the edit form. */
  hideOnEdit?: boolean;
  /** Wizard step this field belongs to. When any visible field has a section, the
   *  form renders as a multi-step wizard grouped (in first-seen order) by section. */
  section?: string;
  /** For a foreign-key (optionsEndpoint) field: allow creating a new related record
   *  inline via a "＋ New" button that opens this entity's own form. */
  createConfig?: { endpoint: string; entityLabel: string; fields: Field[] };
}

/** Dropdown filter shown in the toolbar (maps to a backend filterField). */
export interface FilterDef {
  field: string;
  label: string;
  options: { value: string; label: string }[];
}

/** Summation card driven by backend `meta.sums` (or record count via key '__count'). */
export interface SummaryCardDef {
  key: string;
  label: string;
  money?: boolean;
}

export interface Column {
  key: string;
  label: string;
  render?: (row: Record<string, any>) => React.ReactNode;
  align?: 'left' | 'right';
  /** When true, header is clickable to sort (key must be a real scalar column). */
  sortable?: boolean;
}
