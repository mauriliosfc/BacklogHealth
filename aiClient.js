const https = require('https');
const http  = require('http');

// Azure AI Foundry (services.ai.azure.com) ou Azure OpenAI (openai.azure.com)
function isFoundry(endpoint) {
  return (endpoint || '').includes('services.ai.azure.com');
}

function isAzureOpenAI(endpoint) {
  return (endpoint || '').includes('openai.azure.com');
}

function buildUrl(aiCfg) {
  const endpoint = (aiCfg.endpoint || '').trim();
  if (isFoundry(endpoint)) return endpoint; // URL completa fornecida pelo Azure
  const base = endpoint.replace(/\/$/, '');
  if (isAzureOpenAI(base)) {
    const version = aiCfg.apiVersion || '2024-02-01';
    return `${base}/openai/deployments/${aiCfg.model}/chat/completions?api-version=${version}`;
  }
  return `${base}/chat/completions`;
}

function buildHeaders(aiCfg) {
  const endpoint = (aiCfg.endpoint || '');
  if (isFoundry(endpoint) || isAzureOpenAI(endpoint)) {
    return { 'Content-Type': 'application/json', 'api-key': aiCfg.apiKey };
  }
  return { 'Content-Type': 'application/json', 'Authorization': `Bearer ${aiCfg.apiKey}` };
}

function buildBody(aiCfg, messages) {
  if (isFoundry(aiCfg.endpoint || '')) {
    // Foundry agent não aceita instructions nem system role.
    // Injeta o system prompt como prefixo da última mensagem do usuário.
    const systemMsg = messages.find(m => m.role === 'system');
    const input = messages
      .filter(m => m.role !== 'system')
      .map((m, i, arr) => {
        if (systemMsg && m.role === 'user' && i === arr.length - 1) {
          return { ...m, content: systemMsg.content + '\n\n---\n\n' + m.content };
        }
        return m;
      });
    return { input };
  }
  const body = { messages, max_tokens: 1200, temperature: 0.7 };
  if (aiCfg.model) body.model = aiCfg.model;
  return body;
}

function extractContent(aiCfg, json) {
  if (isFoundry(aiCfg.endpoint || '')) {
    // Responses API: output[].content[] com type "output_text" ou "text"
    for (const item of (json.output || [])) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const c of item.content) {
          if ((c.type === 'output_text' || c.type === 'text') && c.text) return c.text;
        }
      }
    }
    // Fallback: campo text direto no item
    for (const item of (json.output || [])) {
      if (item.type === 'message' && typeof item.text === 'string') return item.text;
    }
    // Fallback: chat completions
    if (json.choices?.[0]?.message?.content) return json.choices[0].message.content;
    return '';
  }
  return json.choices?.[0]?.message?.content || '';
}

async function chatCompletion(aiCfg, messages) {
  return new Promise((resolve, reject) => {
    const url    = buildUrl(aiCfg);
    const parsed = new URL(url);
    const body   = JSON.stringify(buildBody(aiCfg, messages));
    const headers = { ...buildHeaders(aiCfg), 'Content-Length': Buffer.byteLength(body) };
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.request({ hostname: parsed.hostname, path: parsed.pathname + parsed.search, method: 'POST', headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode !== 200) return reject(new Error(json.error?.message || `HTTP ${res.statusCode}`));
          resolve(extractContent(aiCfg, json));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function testConnection(aiCfg) {
  const messages = [{ role: 'user', content: 'Respond with only: OK' }];
  const reply = await chatCompletion(aiCfg, messages);
  return !!reply;
}

module.exports = { chatCompletion, testConnection };
