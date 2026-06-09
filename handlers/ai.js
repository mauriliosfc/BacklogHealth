const { getAiCfg, saveAiConfig } = require('../config');
const { chatCompletion, testConnection } = require('../aiClient');
const { httpError } = require('./utils');

function getAiConfig() {
  const ai = getAiCfg();
  return {
    configured:  !!(ai?.endpoint && ai?.apiKey && ai?.model),
    endpoint:    ai?.endpoint   || '',
    apiKey:      ai?.apiKey     || '',
    model:       ai?.model      || '',
    apiVersion:  ai?.apiVersion || '',
  };
}

function saveAiCfg({ endpoint, apiKey, model, apiVersion } = {}) {
  if (!endpoint || !apiKey || !model)
    httpError(400, 'endpoint, apiKey e model são obrigatórios.');
  saveAiConfig({
    endpoint:   endpoint.trim(),
    apiKey:     apiKey.trim(),
    model:      model.trim(),
    apiVersion: (apiVersion || '').trim(),
  });
  return { ok: true };
}

async function testAiConnection({ endpoint, apiKey, model, apiVersion } = {}) {
  if (!endpoint || !apiKey || !model)
    httpError(400, 'Preencha todos os campos obrigatórios.');
  try {
    await testConnection({
      endpoint:   endpoint.trim(),
      apiKey:     apiKey.trim(),
      model:      model.trim(),
      apiVersion: (apiVersion || '').trim(),
    });
    return { ok: true };
  } catch (e) {
    // Return HTTP 200 with error in body — same as original, so front-end can parse message
    return { error: e.message };
  }
}

async function chat({ message, history = [], context = '' } = {}) {
  const ai = getAiCfg();
  if (!ai?.endpoint || !ai?.apiKey || !ai?.model)
    httpError(400, 'IA não configurada.');
  const systemPrompt = `You are Copilot Project, an AI assistant specialized in technology project management using Agile/Scrum methodology.

Your role is to help the team and project managers to:
- Analyze backlog health and identify risks (items without estimate, without assignee, excess open bugs)
- Monitor sprint progress and delivery capacity
- Suggest concrete and prioritized actions to improve project health
- Answer questions about sprints, User Stories, bugs and metrics from Azure DevOps
- Support daily standups, retrospectives and sprint planning with data-driven insights

Behavior guidelines:
- Always respond in the same language the user writes (Portuguese, English or Spanish)
- Be direct and objective — avoid long introductions
- When identifying a problem, always suggest a concrete action
- Use the dashboard data to support your answers with real numbers
- When data is insufficient to answer, say so clearly and suggest what information would be needed
- Do not invent data — only use what is provided in the context below

Current dashboard data:
${context || 'No project data available at this moment.'}`;

  const messages = [
    { role: 'system', content: systemPrompt },
    ...history,
    { role: 'user', content: message },
  ];
  const reply = await chatCompletion(ai, messages);
  return { reply };
}

module.exports = { getAiConfig, saveAiCfg, testAiConnection, chat };
