/**
 * The formulas behind the headline figures, worded for the people who read them (T1-04).
 * The server computes every figure in one place (backend/src/lib/project-metrics.ts);
 * these strings only explain it, as tooltips, so the two must say the same thing.
 */
export const TIP = {
  budget: 'Budget = total of the BOQ (quantity × rate + markup + contingency). The BOQ is the only cost budget; budget lines are a breakdown of it.',
  earnedValue: 'Earned value = progress % × budget. It is the budgeted cost of the work actually done.',
  cpi: 'CPI = earned value ÷ actual cost. Above 1.00: work costs less than budgeted; below 1.00: it costs more.',
  spi: 'SPI = earned value ÷ planned value (progress achieved ÷ progress planned to date).',
  etc: 'Cost to complete = budget − earned value, divided by CPI when CPI is below 1 (an overrun so far is assumed to continue).',
  eac: 'Estimate at completion = actual cost + cost to complete.',
  forecastMargin: 'Forecast margin = contract value − (actual cost + cost to complete). Every extra franc spent lowers it by at least a franc.',
  budgetUtil: 'Budget used = actual cost ÷ budget (BOQ total).',
  noBudget: 'No cost budget: this project has no BOQ lines, so earned value, CPI and the forecast cannot be measured. Add the BOQ in Planning.',
} as const;

export const NO_COST_BUDGET = 'No cost budget';
