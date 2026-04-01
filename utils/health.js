function calcHealth(total, semEst, semResp, bugs) {
  const reasons = [];
  if (bugs > 10) reasons.push(`${bugs} bugs abertos (crítico: >10)`);
  else if (bugs > 5) reasons.push(`${bugs} bugs abertos (alerta: >5)`);
  if (total > 0 && semEst > total * 0.5) reasons.push(`${Math.round(semEst/total*100)}% das US sem estimativa (crítico: >50%)`);
  else if (total > 0 && semEst > total * 0.3) reasons.push(`${Math.round(semEst/total*100)}% das US sem estimativa (alerta: >30%)`);
  if (total > 0 && semResp > total * 0.2) reasons.push(`${Math.round(semResp/total*100)}% das US sem responsável (alerta: >20%)`);
  const tooltip = reasons.length ? reasons.join(" · ") : "Backlog bem estruturado";
  if (bugs > 10 || semEst > total * 0.5) return ["🔴 Crítico", "red", tooltip];
  if (semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5) return ["🟡 Atenção", "yellow", tooltip];
  return ["🟢 Saudável", "green", tooltip];
}
module.exports = { calcHealth };
