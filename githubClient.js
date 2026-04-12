const https = require('https');

function createIssue({ token, repo, title, body, labels }) {
  return new Promise((resolve, reject) => {
    const [owner, repoName] = repo.split('/');
    const payload = JSON.stringify({ title, body, labels });

    const options = {
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repoName}/issues`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'BacklogHealth-Dashboard',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (res.statusCode === 201) resolve(json);
          else reject(new Error(json.message || `GitHub API error: HTTP ${res.statusCode}`));
        } catch (e) {
          reject(new Error('Invalid response from GitHub API'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

module.exports = { createIssue };
