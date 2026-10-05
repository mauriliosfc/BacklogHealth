const DEFAULT_INDICATORS = {
  completion:       { states: ['Closed', 'Done', 'Resolved'], color: '' },
  uat:              { states: ['UAT'], color: '' },
  bugRate:          { basis: 'hours', color: '' },
  estimateCoverage: { scope: 'all', color: '' },
  effortSaved:      { color: '' },
};

function resolveIndicatorConfig(saved = {}) {
  return {
    completion:       { ...DEFAULT_INDICATORS.completion,       ...saved.completion },
    uat:              { ...DEFAULT_INDICATORS.uat,              ...saved.uat },
    bugRate:          { ...DEFAULT_INDICATORS.bugRate,          ...saved.bugRate },
    estimateCoverage: { ...DEFAULT_INDICATORS.estimateCoverage, ...saved.estimateCoverage },
    effortSaved:      { ...DEFAULT_INDICATORS.effortSaved,      ...saved.effortSaved },
  };
}

module.exports = { DEFAULT_INDICATORS, resolveIndicatorConfig };
