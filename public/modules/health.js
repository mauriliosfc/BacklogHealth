export function calcHealth(total, semEst, semResp, bugs) {
  const reasons = [];
  if (bugs > 10) reasons.push(bugs + ' bugs abertos (cr\u00edtico: >10)');
  else if (bugs > 5) reasons.push(bugs + ' bugs abertos (alerta: >5)');
  if (total > 0 && semEst > total * 0.5) reasons.push(Math.round(semEst/total*100) + '% das US sem estimativa (cr\u00edtico: >50%)');
  else if (total > 0 && semEst > total * 0.3) reasons.push(Math.round(semEst/total*100) + '% das US sem estimativa (alerta: >30%)');
  if (total > 0 && semResp > total * 0.2) reasons.push(Math.round(semResp/total*100) + '% das US sem respons\u00e1vel (alerta: >20%)');
  const tooltip = reasons.length ? reasons.join(' \u00b7 ') : 'Backlog bem estruturado';
  if (bugs > 10 || semEst > total * 0.5) return ['\uD83D\uDD34 Cr\u00edtico', 'red', tooltip];
  if (semEst > total * 0.3 || semResp > total * 0.2 || bugs > 5) return ['\uD83D\uDFE1 Aten\u00e7\u00e3o', 'yellow', tooltip];
  return ['\uD83D\uDFE2 Saud\u00e1vel', 'green', tooltip];
}
