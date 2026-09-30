const { getCfg, getGithubCfg } = require('../config');
const { createIssue } = require('../githubClient');
const { httpError } = require('./utils');

let _builtin = null;
try { _builtin = require('../utils/feedbackCfg'); } catch (_) {}

async function submitFeedback({ type, title, description } = {}) {
  const configured = getGithubCfg();
  const builtin    = (_builtin?.token) ? _builtin : null;
  const gh         = configured || builtin;
  if (!gh?.token || !gh?.repo)
    httpError(400, 'GitHub feedback not configured.');
  if (!title?.trim() || !description?.trim())
    httpError(400, 'Title and description are required.');

  const labelMap  = { bug: 'bug', suggestion: 'enhancement', help: 'question' };
  const labels    = labelMap[type] ? [labelMap[type]] : [];
  const typeEmoji = { bug: '\uD83D\uDC1B', suggestion: '\uD83D\uDCA1', help: '\u2753', other: '\uD83D\uDCDD' }[type] || '\uD83D\uDCDD';
  const typeLabel = { bug: 'Bug Report', suggestion: 'Suggestion', help: 'Help Request', other: 'Other' }[type] || 'Feedback';
  const cfg       = getCfg();

  const issueTitle = `${typeEmoji} [${typeLabel}] ${title.trim()}`;
  const issueBody  = `## ${typeEmoji} ${typeLabel}\n\n${description.trim()}\n\n---\n*Sent via **Backlog Health Dashboard** \u00b7 ${new Date().toISOString().split('T')[0]} \u00b7 Org: \`${cfg.org || 'N/A'}\`*`;

  const issue = await createIssue({ token: gh.token, repo: gh.repo, title: issueTitle, body: issueBody, labels });
  return { ok: true, url: issue.html_url };
}

module.exports = { submitFeedback };
