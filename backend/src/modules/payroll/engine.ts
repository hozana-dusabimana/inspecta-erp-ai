// Rwanda RRA PAYE / RSSB payroll engine.
// All rates are read from the admin-configurable, date-versioned `statutory_rates`
// table — never hardcoded here (per the schema reference note).

export interface PayeBand {
  bandFrom: number;
  bandTo: number | null; // null = unbounded top band
  employeePct: number;
}

export interface RssbRates {
  pensionEmployee: number;
  pensionEmployer: number;
  maternityEmployee: number;
  maternityEmployer: number;
  medicalEmployee: number;
  medicalEmployer: number;
  cbhiEmployee: number; // % of net (Rwanda community-based health insurance)
}

/** Progressive PAYE over monthly bands. Bands must be sorted by bandFrom asc. */
export function computePaye(gross: number, bands: PayeBand[]): number {
  if (gross <= 0 || bands.length === 0) return 0;
  let tax = 0;
  for (const b of bands) {
    const upper = b.bandTo == null ? gross : Math.min(gross, b.bandTo);
    if (gross > b.bandFrom) {
      const taxable = upper - b.bandFrom;
      if (taxable > 0) tax += (taxable * b.employeePct) / 100;
    }
  }
  return round2(tax);
}

export interface PayslipComputation {
  grossSalary: number;
  payeAmount: number;
  rssbPensionEmployee: number;
  rssbPensionEmployer: number;
  rssbMaternityEmployee: number;
  rssbMaternityEmployer: number;
  rssbMedicalEmployee: number;
  rssbMedicalEmployer: number;
  cbhiAmount: number;
  otherDeductions: number;
  netPay: number;
}

/**
 * Compute a single payslip. `medicalApplies` is false unless the employee's
 * medical_scheme is 'rama'. Net = gross − PAYE − all employee RSSB − CBHI − other.
 */
export function computePayslip(
  gross: number,
  bands: PayeBand[],
  rssb: RssbRates,
  medicalApplies: boolean,
  otherDeductions = 0,
): PayslipComputation {
  const paye = computePaye(gross, bands);
  const pensionEmp = round2((gross * rssb.pensionEmployee) / 100);
  const pensionEr = round2((gross * rssb.pensionEmployer) / 100);
  const maternityEmp = round2((gross * rssb.maternityEmployee) / 100);
  const maternityEr = round2((gross * rssb.maternityEmployer) / 100);
  const medicalEmp = medicalApplies ? round2((gross * rssb.medicalEmployee) / 100) : 0;
  const medicalEr = medicalApplies ? round2((gross * rssb.medicalEmployer) / 100) : 0;

  const netBeforeCbhi = gross - paye - pensionEmp - maternityEmp - medicalEmp - otherDeductions;
  const cbhi = round2((netBeforeCbhi * rssb.cbhiEmployee) / 100);
  const net = round2(netBeforeCbhi - cbhi);

  return {
    grossSalary: round2(gross),
    payeAmount: paye,
    rssbPensionEmployee: pensionEmp,
    rssbPensionEmployer: pensionEr,
    rssbMaternityEmployee: maternityEmp,
    rssbMaternityEmployer: maternityEr,
    rssbMedicalEmployee: medicalEmp,
    rssbMedicalEmployer: medicalEr,
    cbhiAmount: cbhi,
    otherDeductions: round2(otherDeductions),
    netPay: net,
  };
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}
