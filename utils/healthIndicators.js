const DEFAULT_INDICATORS = {
  completion:       { states: ['Closed', 'Done', 'Resolved'], color: '' },
  uat:              { states: ['UAT'], color: '' },
  bugRate:          { basis: 'hours', color: '' },
  estimateCoverage: { scope: 'all', color: '' },
  effortSaved:      { color: '' },
};

// typeDefaults.completionStates: estados "concluído" do tipo de item do projeto
// (somente tipos não legados — ver utils/workItemProfile.js)
function resolveIndicatorConfig(saved = {}, typeDefaults = {}) {
  const completionDefault = typeDefaults.completionStates?.length
    ? { ...DEFAULT_INDICATORS.completion, states: [...typeDefaults.completionStates] }
    : DEFAULT_INDICATORS.completion;
  return {
    completion:       { ...completionDefault,                   ...saved.completion },
    uat:              { ...DEFAULT_INDICATORS.uat,              ...saved.uat },
    bugRate:          { ...DEFAULT_INDICATORS.bugRate,          ...saved.bugRate },
    estimateCoverage: { ...DEFAULT_INDICATORS.estimateCoverage, ...saved.estimateCoverage },
    effortSaved:      { ...DEFAULT_INDICATORS.effortSaved,      ...saved.effortSaved },
  };
}

module.exports = { DEFAULT_INDICATORS, resolveIndicatorConfig };
