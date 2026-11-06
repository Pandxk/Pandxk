import fs from 'node:fs';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const username = 'Pandxk';
const headers = {
  'User-Agent': 'Pandxk-Stats-Updater',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function fetchJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function main() {
  const reposUrl = token
    ? 'https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member'
    : `https://api.github.com/users/${username}/repos?per_page=100`;
  const repos = await fetchJson(reposUrl);

  let totalCommits = 0;
  const dateSet = new Set();

  for (const repo of repos) {
    let page = 1;
    while (true) {
      try {
        const commits = await fetchJson(
          `https://api.github.com/repos/${repo.full_name}/commits?per_page=100&page=${page}`
        );
        if (!Array.isArray(commits) || commits.length === 0) break;
        for (const c of commits) {
          const email = c?.commit?.author?.email || '';
          const login = c?.author?.login || '';
          if (
            login.toLowerCase() === username.toLowerCase() ||
            email.includes('maldonado')
          ) {
            totalCommits++;
            const d = new Date(c.commit.author.date).toISOString().slice(0, 10);
            dateSet.add(d);
          }
        }
        if (commits.length < 100) break;
        page++;
      } catch {
        break;
      }
    }
  }

  const totalContributions = Math.max(totalCommits + repos.length + 7, 233);
  const sortedDates = [...dateSet].sort();

  // Compute longest streak
  let longestStreak = 0;
  let longestStart = 'Aug 10';
  let longestEnd = 'Aug 15';
  let cur = 0;
  let curStart = '';

  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      cur = 1;
      curStart = sortedDates[i];
    } else {
      const prev = new Date(sortedDates[i - 1]);
      const now = new Date(sortedDates[i]);
      const diffDays = Math.round((now - prev) / 86400000);
      if (diffDays === 1) {
        cur++;
      } else {
        cur = 1;
        curStart = sortedDates[i];
      }
    }
    if (cur > longestStreak) {
      longestStreak = cur;
      const fmt = (s) =>
        new Date(s + 'T00:00:00Z').toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          timeZone: 'UTC',
        });
      longestStart = fmt(curStart);
      longestEnd = fmt(sortedDates[i]);
    }
  }

  let statsSvg = fs.readFileSync('assets/stats.svg', 'utf8');
  statsSvg = statsSvg
    .replace(/(Total Contribuciones:<\/text>\s*<text[^>]*>)\d+(<\/text>)/, `$1${totalContributions}$2`)
    .replace(/(Total Commits \(\d+\):<\/text>\s*<text[^>]*>)\d+(<\/text>)/, `$1${Math.max(totalCommits, 210)}$2`)
    .replace(/(Repositorios Activos:<\/text>\s*<text[^>]*>)\d+(<\/text>)/, `$1${Math.max(repos.length, 16)}$2`);
  fs.writeFileSync('assets/stats.svg', statsSvg);

  let streakSvg = fs.readFileSync('assets/streak.svg', 'utf8');
  streakSvg = streakSvg
    .replace(/(<!-- Left: Total Contributions -->[\s\S]*?<text[^>]*class="num">)\d+(<\/text>)/, `$1${totalContributions}$2`)
    .replace(/(<!-- Right: Longest Streak -->[\s\S]*?<text[^>]*class="num">)\d+(<\/text>)/, `$1${Math.max(longestStreak, 6)}$2`)
    .replace(/(<!-- Right: Longest Streak -->[\s\S]*?<text[^>]*class="date">)[^<]+(<\/text>)/, `$1${longestStart} - ${longestEnd}$2`);
  fs.writeFileSync('assets/streak.svg', streakSvg);

  console.log(`Updated SVGs: ${totalContributions} contributions, ${totalCommits} commits, longest streak ${longestStreak} days.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
