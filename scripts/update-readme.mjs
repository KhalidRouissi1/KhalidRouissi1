import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(join(root, "profile.config.json"), "utf8"));
const readmePath = join(root, "README.md");
const token = process.env.GITHUB_TOKEN;

const headers = {
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "User-Agent": `${config.username}-profile-readme`
};

if (token) headers.Authorization = `Bearer ${token}`;

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, { headers });
  if (!response.ok) {
    throw new Error(`GitHub API ${response.status}: ${await response.text()}`);
  }
  return response.json();
}

async function getRepositories() {
  const repositories = [];
  for (let page = 1; ; page += 1) {
    const batch = await github(
      `/users/${config.username}/repos?type=owner&sort=updated&per_page=100&page=${page}`
    );
    repositories.push(...batch);
    if (batch.length < 100) break;
  }

  return repositories.filter((repo) => {
    if (!config.includeForks && repo.fork) return false;
    if (config.excluded.includes(repo.name)) return false;
    return repo.stargazers_count >= config.minimumStars;
  });
}

function escapeCell(value = "") {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ").trim();
}

function description(repo) {
  return config.descriptionOverrides[repo.name] || repo.description || "Open-source project by Khalid Rouissi.";
}

function projectRow(repo) {
  const language = repo.language || "Various";
  const stars = repo.stargazers_count ? ` ⭐ ${repo.stargazers_count}` : "";
  return `| [**${repo.name}**](${repo.html_url})${stars} | ${escapeCell(description(repo))} | ${language} |`;
}

function featuredSection(repositories) {
  const byName = new Map(repositories.map((repo) => [repo.name.toLowerCase(), repo]));
  const featured = config.featured
    .map((name) => byName.get(name.toLowerCase()))
    .filter(Boolean);

  return [
    "<!-- AUTO:FEATURED:START -->",
    "| Project | What it does | Stack |",
    "| --- | --- | --- |",
    ...featured.map(projectRow),
    "<!-- AUTO:FEATURED:END -->"
  ].join("\n");
}

function recentSection(repositories) {
  const featured = new Set(config.featured.map((name) => name.toLowerCase()));
  const recent = repositories
    .filter((repo) => !featured.has(repo.name.toLowerCase()))
    .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
    .slice(0, config.recentProjectLimit);

  const lines = recent.map((repo) => {
    const language = repo.language ? ` · ${repo.language}` : "";
    const stars = repo.stargazers_count ? ` · ⭐ ${repo.stargazers_count}` : "";
    return `- [**${repo.name}**](${repo.html_url})${language}${stars} — ${escapeCell(description(repo))}`;
  });

  return [
    "<!-- AUTO:RECENT:START -->",
    ...(lines.length ? lines : ["More projects are on the way."]),
    "<!-- AUTO:RECENT:END -->"
  ].join("\n");
}

function metricsSection(repositories) {
  const stars = repositories.reduce((total, repo) => total + repo.stargazers_count, 0);
  const forks = repositories.reduce((total, repo) => total + repo.forks_count, 0);
  const languages = new Set(repositories.map((repo) => repo.language).filter(Boolean));

  return [
    "<!-- AUTO:METRICS:START -->",
    `**${repositories.length}** original public repositories · **${stars}** stars · **${forks}** forks · **${languages.size}** primary languages`,
    "<!-- AUTO:METRICS:END -->"
  ].join("\n");
}

function recommendationsSection() {
  const recommendations = config.recommendations || [];
  const lines = recommendations.flatMap((item, index) => {
    const details = [item.role, item.relationship, item.date].filter(Boolean).join(" · ");
    return [
      `> “${item.quote}”`,
      ">",
      `> — **${item.name}**, ${details}`,
      ...(index < recommendations.length - 1 ? ["", "---", ""] : [])
    ];
  });

  return [
    "<!-- AUTO:RECOMMENDATIONS:START -->",
    ...(lines.length ? lines : ["Professional recommendations coming soon."]),
    "<!-- AUTO:RECOMMENDATIONS:END -->"
  ].join("\n");
}

function replaceSection(markdown, name, generated) {
  const pattern = new RegExp(
    `<!-- AUTO:${name}:START -->[\\s\\S]*?<!-- AUTO:${name}:END -->`,
    "m"
  );
  if (!pattern.test(markdown)) throw new Error(`Missing generated section: ${name}`);
  return markdown.replace(pattern, generated);
}

const repositories = await getRepositories();
let markdown = await readFile(readmePath, "utf8");
markdown = replaceSection(markdown, "FEATURED", featuredSection(repositories));
markdown = replaceSection(markdown, "RECENT", recentSection(repositories));
markdown = replaceSection(markdown, "METRICS", metricsSection(repositories));
markdown = replaceSection(markdown, "RECOMMENDATIONS", recommendationsSection());
await writeFile(readmePath, markdown);

console.log(`Updated README with ${repositories.length} repositories.`);
