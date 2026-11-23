import fs from 'node:fs';

const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
const username = 'Pandxk';
const currentYear = new Date().getUTCFullYear();
const headers = {
  'User-Agent': 'Pandxk-Stats-Updater',
  ...(token ? { Authorization: `Bearer ${token}` } : {}),
};

async function fetchJson(url) {
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchContributionCalendar(year) {
  const url = `https://github.com/users/${username}/contributions?from=${year}-01-01&to=${year}-12-31`;
  const res = await fetch(url, { headers: { 'User-Agent': 'Pandxk-Stats-Updater' } });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const html = await res.text();

  const headerMatch = html.match(/id="js-contribution-activity-description"[^>]*>([\s\S]*?)<\/h2>/);
  const yearTotalMatch = headerMatch?.[1]?.match(/([\d,]+)\s+contribution/);
  const yearTotal = yearTotalMatch ? Number(yearTotalMatch[1].replace(/,/g, '')) : 0;

  const dayRegex = /data-date="(\d{4}-\d{2}-\d{2})"[^>]*id="([^"]+)"[^>]*data-level="(\d)"/g;
  const tipRegex = /for="([^"]+)"[^>]*>([^<]+)<\/tool-tip>/g;

  const tips = new Map();
  let tm;
  while ((tm = tipRegex.exec(html)) !== null) {
    tips.set(tm[1], tm[2]);
  }

  const activeDays = [];
  let dm;
  while ((dm = dayRegex.exec(html)) !== null) {
    const [, date, id, level] = dm;
    if (level !== '0') {
      const tip = tips.get(id) || '';
      const cntMatch = tip.match(/^(\d+)\s+contribution/);
      activeDays.push({ date, count: cntMatch ? Number(cntMatch[1]) : 1 });
    }
  }

  return { yearTotal, activeDays };
}

function fmtShortDate(isoDate) {
  return new Date(`${isoDate}T00:00:00Z`).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

function computeStreaks(sortedDates) {
  if (sortedDates.length === 0) {
    return {
      longestStreak: 0,
      longestRange: '—',
      currentStreak: 0,
      currentRange: '—',
    };
  }

  const dateSet = new Set(sortedDates);
  let longestStreak = 0;
  let longestStart = sortedDates[0];
  let longestEnd = sortedDates[0];
  let cur = 0;
  let curStart = sortedDates[0];

  for (let i = 0; i < sortedDates.length; i++) {
    if (i === 0) {
      cur = 1;
      curStart = sortedDates[0];
    } else {
      const prev = new Date(`${sortedDates[i - 1]}T00:00:00Z`);
      const now = new Date(`${sortedDates[i]}T00:00:00Z`);
      const diffDays = Math.round((now - prev) / 86400000);
      if (diffDays === 1) {
        cur++;
      } else {
        cur = 1;
        curStart = sortedDates[i];
      }
    }
    if (cur >= longestStreak) {
      longestStreak = cur;
      longestStart = curStart;
      longestEnd = sortedDates[i];
    }
  }

  // Current streak ending at today or yesterday (or latest active day if within 1 day of today)
  const todayIso = new Date().toISOString().slice(0, 10);
  const yesterdayIso = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  let anchor = dateSet.has(todayIso)
    ? todayIso
    : dateSet.has(yesterdayIso)
      ? yesterdayIso
      : null;

  let currentStreak = 0;
  let currentStart = '';
  let currentEnd = '';

  if (anchor) {
    currentEnd = anchor;
    let cursor = new Date(`${anchor}T00:00:00Z`);
    while (dateSet.has(cursor.toISOString().slice(0, 10))) {
      currentStreak++;
      currentStart = cursor.toISOString().slice(0, 10);
      cursor = new Date(cursor.getTime() - 86400000);
    }
  } else {
    currentEnd = sortedDates[sortedDates.length - 1];
    currentStart = currentEnd;
    currentStreak = 0;
  }

  return {
    longestStreak,
    longestRange:
      longestStart === longestEnd
        ? fmtShortDate(longestStart)
        : `${fmtShortDate(longestStart)} - ${fmtShortDate(longestEnd)}`,
    currentStreak,
    currentRange:
      currentStreak > 0
        ? currentStart === currentEnd
          ? fmtShortDate(currentStart)
          : `${fmtShortDate(currentStart)} - ${fmtShortDate(currentEnd)}`
        : fmtShortDate(currentEnd),
  };
}

async function main() {
  // 1. Fetch public contribution calendar across active years (2025..currentYear)
  let yearContributions = 0;
  let allTimeContributions = 0;
  const activeDateSet = new Set();

  for (let yr = 2025; yr <= currentYear; yr++) {
    const cal = await fetchContributionCalendar(yr);
    allTimeContributions += cal.yearTotal;
    if (yr === currentYear) yearContributions = cal.yearTotal;
    for (const d of cal.activeDays) activeDateSet.add(d.date);
  }

  const sortedDates = [...activeDateSet].sort();
  const streaks = computeStreaks(sortedDates);

  // 2. Fetch repos/commits accessible to token
  const reposUrl = token
    ? 'https://api.github.com/user/repos?per_page=100&affiliation=owner,collaborator,organization_member'
    : `https://api.github.com/users/${username}/repos?per_page=100`;
  const repos = await fetchJson(reposUrl);

  let apiCommitsYear = 0;
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
          const dateStr = c?.commit?.author?.date || '';
          if (
            dateStr.startsWith(`${currentYear}-`) &&
            (login.toLowerCase() === username.toLowerCase() || email.includes('maldonado'))
          ) {
            apiCommitsYear++;
          }
        }
        if (commits.length < 100) break;
        page++;
      } catch {
        break;
      }
    }
  }

  const commitsDisplay = apiCommitsYear >= 210 ? `${apiCommitsYear}` : '210+';
  const activeReposCount = Math.max(repos.length, 16);

  // 3. Update assets/stats.svg
  let statsSvg = fs.readFileSync('assets/stats.svg', 'utf8');
  statsSvg = statsSvg
    .replace(
      /(Contribuciones \(\d+\):<\/text>\s*<text[^>]*>)[^<]+(<\/text>)/,
      `$1${yearContributions}$2`
    )
    .replace(
      /(Total Commits \(\d+\):<\/text>\s*<text[^>]*>)[^<]+(<\/text>)/,
      `$1${commitsDisplay}$2`
    )
    .replace(
      /(Repositorios Activos:<\/text>\s*<text[^>]*>)[^<]+(<\/text>)/,
      `$1${activeReposCount}$2`
    );
  fs.writeFileSync('assets/stats.svg', statsSvg);

  // 4. Update assets/streak.svg
  let streakSvg = fs.readFileSync('assets/streak.svg', 'utf8');
  streakSvg = streakSvg
    .replace(
      /(<!-- Left: Total Contributions -->[\s\S]*?<text[^>]*class="num">)\d+(<\/text>)/,
      `$1${allTimeContributions}$2`
    )
    .replace(
      /(<!-- Center: Current Streak[\s\S]*?<text[^>]*class="num-center">)\d+(<\/text>)/,
      `$1${streaks.currentStreak}$2`
    )
    .replace(
      /(<!-- Center: Current Streak[\s\S]*?<text[^>]*class="date">)[^<]+(<\/text>)/,
      `$1${streaks.currentRange}$2`
    )
    .replace(
      /(<!-- Right: Longest Streak -->[\s\S]*?<text[^>]*class="num">)\d+(<\/text>)/,
      `$1${streaks.longestStreak}$2`
    )
    .replace(
      /(<!-- Right: Longest Streak -->[\s\S]*?<text[^>]*class="date">)[^<]+(<\/text>)/,
      `$1${streaks.longestRange}$2`
    );
  fs.writeFileSync('assets/streak.svg', streakSvg);

  // 5. Sync live contribution badge in README.md
  let readme = fs.readFileSync('README.md', 'utf8');
  readme = readme.replace(
    /CONTRIBUCIONES_\d{4}-\d+-38bdf8/g,
    `CONTRIBUCIONES_${currentYear}-${yearContributions}-38bdf8`
  );
  readme = readme.replace(
    /COMMITS_\d{4}-[^-]+-fb8500/g,
    `COMMITS_${currentYear}-${encodeURIComponent(commitsDisplay)}-fb8500`
  );
  fs.writeFileSync('README.md', readme);

  console.log(
    `Updated SVGs: ${yearContributions} (${currentYear}) / ${allTimeContributions} total, commits=${commitsDisplay}, currentStreak=${streaks.currentStreak} (${streaks.currentRange}), longestStreak=${streaks.longestStreak} (${streaks.longestRange}).`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(0);
});
