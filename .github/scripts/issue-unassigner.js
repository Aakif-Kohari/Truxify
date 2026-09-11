'use strict';

/**
 * Checks if a pull request exists in the issue's timeline or in PR search results.
 */
function hasLinkedPullRequest(issueNumber, timeline = [], searchItems = []) {
  // Check 1: cross-referenced events in timeline
  const inTimeline = timeline.some(event => {
    return event.event === 'cross-referenced' &&
      event.source &&
      event.source.issue &&
      Boolean(event.source.issue.pull_request);
  });

  if (inTimeline) return true;

  // Check 2: search items explicitly mentioning the issue number
  const issueRefPattern = new RegExp(`(?:#|issues/)${issueNumber}\\b`, 'i');
  return searchItems.some(pr => {
    const text = `${pr.title || ''}\n${pr.body || ''}`;
    return issueRefPattern.test(text);
  });
}

/**
 * Determines the timestamp of when the issue was last assigned.
 * Falls back to issue creation date if no assigned event is present.
 */
function getAssignmentTimestamp(issue, timeline = []) {
  const assignEvents = timeline
    .filter(e => e.event === 'assigned' && e.created_at)
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime());

  if (assignEvents.length > 0) {
    return new Date(assignEvents[assignEvents.length - 1].created_at).getTime();
  }

  return new Date(issue.created_at).getTime();
}

/**
 * Checks if any assigned contributor posted a comment or activity in the last daysThreshold days.
 */
function hasRecentContributorActivity(issue, timeline = [], now = Date.now(), daysThreshold = 7) {
  const assigneeLogins = new Set((issue.assignees || []).map(a => a.login.toLowerCase()));

  return timeline.some(event => {
    const author = (event.actor && event.actor.login) ||
                   (event.user && event.user.login);
    if (!author || !assigneeLogins.has(author.toLowerCase())) return false;

    // Count comments, reviews, or commits by contributor
    if (event.event && !['commented', 'committed', 'reviewed', 'line-commented'].includes(event.event)) {
      return false;
    }

    const eventTime = new Date(event.created_at).getTime();
    const daysSinceEvent = (now - eventTime) / (1000 * 60 * 60 * 24);
    return daysSinceEvent < daysThreshold;
  });
}

/**
 * Evaluates whether an issue meets the criteria to be auto-unassigned.
 */
function isEligibleForUnassign({
  issue,
  timeline = [],
  searchItems = [],
  now = Date.now(),
  daysThreshold = 7
}) {
  if (!issue || issue.pull_request || !issue.assignees || issue.assignees.length === 0) {
    return { eligible: false, reason: 'no-assignees-or-pr' };
  }

  // 1. If assigned less than 1 week (daysThreshold), do NOT unassign
  const assignedAt = getAssignmentTimestamp(issue, timeline);
  const daysSinceAssigned = (now - assignedAt) / (1000 * 60 * 60 * 24);

  if (daysSinceAssigned < daysThreshold) {
    return {
      eligible: false,
      reason: 'assigned-recently',
      daysSinceAssigned,
      daysThreshold
    };
  }

  // 2. If a linked PR exists, do NOT unassign
  const hasPR = hasLinkedPullRequest(issue.number, timeline, searchItems);
  if (hasPR) {
    return {
      eligible: false,
      reason: 'pr-exists',
      daysSinceAssigned
    };
  }

  // 3. If contributor has commented or provided updates in the last daysThreshold days, do NOT unassign
  const hasContributorComment = hasRecentContributorActivity(issue, timeline, now, daysThreshold);
  if (hasContributorComment) {
    return {
      eligible: false,
      reason: 'recent-contributor-comment',
      daysSinceAssigned
    };
  }

  return {
    eligible: true,
    daysSinceAssigned,
    assignees: issue.assignees.map(a => a.login)
  };
}

/**
 * Main execution function run via GitHub Actions or CLI.
 */
async function run({
  github,
  context,
  core = console,
  dryRun = false,
  daysThreshold = 7,
  mode = 'no_pr'
}) {
  const { owner, repo } = context.repo;

  core.info(`Running Issue Auto-Unassigner on ${owner}/${repo} (Mode: ${mode}, Threshold: ${daysThreshold} days, DryRun: ${dryRun})`);

  // Fetch all open issues in the repository
  const openIssues = await github.paginate(github.rest.issues.listForRepo, {
    owner,
    repo,
    state: 'open',
    per_page: 100
  });

  const assignedIssues = openIssues.filter(
    issue => !issue.pull_request && issue.assignees && issue.assignees.length > 0
  );

  core.info(`Found ${assignedIssues.length} open assigned issue(s) to evaluate.`);

  let unassignedCount = 0;

  for (const issue of assignedIssues) {
    try {
      // 1. Fetch timeline events to find assignment date and cross-referenced PRs
      let timeline = [];
      try {
        timeline = await github.paginate(github.rest.issues.listEventsForTimeline, {
          owner,
          repo,
          issue_number: issue.number,
          per_page: 100
        });
      } catch (err) {
        core.warning(`Could not fetch timeline for #${issue.number}: ${err.message}`);
      }

      // 2. Query search API for PRs mentioning this issue
      let searchItems = [];
      try {
        const searchRes = await github.rest.search.issuesAndPullRequests({
          q: `repo:${owner}/${repo} is:pr ${issue.number}`
        });
        searchItems = (searchRes && searchRes.data && searchRes.data.items) || [];
      } catch (err) {
        core.debug(`Search API query failed for #${issue.number}: ${err.message}`);
      }

      const evaluation = isEligibleForUnassign({
        issue,
        timeline,
        searchItems,
        now: Date.now(),
        daysThreshold,
        mode
      });

      if (!evaluation.eligible) {
        core.info(`Skipping #${issue.number}: ${evaluation.reason} (assigned: ${evaluation.daysSinceAssigned ? evaluation.daysSinceAssigned.toFixed(1) : 0}d, updated: ${evaluation.daysSinceUpdate ? evaluation.daysSinceUpdate.toFixed(1) : 0}d ago)`);
        continue;
      }

      const assignees = evaluation.assignees;
      core.info(`Issue #${issue.number} assigned to @${assignees.join(', @')} has had no PR or updates within ${daysThreshold} days.`);

      if (dryRun) {
        core.info(`[Dry Run] Would unassign @${assignees.join(', @')} from issue #${issue.number}`);
        unassignedCount++;
        continue;
      }

      // 3. Remove assignees
      await github.rest.issues.removeAssignees({
        owner,
        repo,
        issue_number: issue.number,
        assignees
      });

      // 4. Remove 'assigned' label if present
      const hasAssignedLabel = (issue.labels || []).some(
        l => (typeof l === 'string' ? l : l.name).toLowerCase() === 'assigned'
      );
      if (hasAssignedLabel) {
        try {
          await github.rest.issues.removeLabel({
            owner,
            repo,
            issue_number: issue.number,
            name: 'assigned'
          });
        } catch (err) {
          core.debug(`Could not remove 'assigned' label from #${issue.number}: ${err.message}`);
        }
      }

      // 5. Post notification comment
      const mentionText = assignees.map(u => `@${u}`).join(', ');
      const commentBody = `⚠️ ${mentionText} This issue has been automatically unassigned because there were no pull requests or updates in the last ${daysThreshold} days. It is now open for other contributors to claim!`;

      await github.rest.issues.createComment({
        owner,
        repo,
        issue_number: issue.number,
        body: commentBody
      });

      core.info(`Successfully unassigned @${assignees.join(', @')} from issue #${issue.number}`);
      unassignedCount++;
    } catch (err) {
      core.error(`Failed processing issue #${issue.number}: ${err.message}`);
    }
  }

  core.info(`Issue Auto-Unassigner finished. Total issues unassigned: ${unassignedCount}`);
  return { unassignedCount };
}

/**
 * Creates a lightweight Octokit-compatible wrapper around native fetch for CLI usage.
 */
function createFetchOctokit(token) {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'User-Agent': 'Truxify-Issue-Unassigner'
  };

  async function request(url, options = {}) {
    const res = await fetch(url, { ...options, headers: { ...headers, ...options.headers } });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`GitHub API HTTP ${res.status}: ${text}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }

  return {
    paginate: async (method, params) => {
      let page = 1;
      let results = [];
      while (true) {
        const items = await method({ ...params, page, per_page: params.per_page || 100 });
        if (!items || items.length === 0) break;
        results = results.concat(items);
        if (items.length < (params.per_page || 100)) break;
        page++;
      }
      return results;
    },
    rest: {
      issues: {
        listForRepo: async ({ owner, repo, state, page, per_page }) => {
          return request(`https://api.github.com/repos/${owner}/${repo}/issues?state=${state}&page=${page}&per_page=${per_page}`);
        },
        listEventsForTimeline: async ({ owner, repo, issue_number, page, per_page }) => {
          return request(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/timeline?page=${page}&per_page=${per_page}`);
        },
        removeAssignees: async ({ owner, repo, issue_number, assignees }) => {
          return request(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/assignees`, {
            method: 'DELETE',
            body: JSON.stringify({ assignees })
          });
        },
        removeLabel: async ({ owner, repo, issue_number, name }) => {
          return request(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/labels/${encodeURIComponent(name)}`, {
            method: 'DELETE'
          });
        },
        createComment: async ({ owner, repo, issue_number, body }) => {
          return request(`https://api.github.com/repos/${owner}/${repo}/issues/${issue_number}/comments`, {
            method: 'POST',
            body: JSON.stringify({ body })
          });
        }
      },
      search: {
        issuesAndPullRequests: async ({ q }) => {
          const data = await request(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}`);
          return { data };
        }
      }
    }
  };
}

// Standalone CLI execution support
if (require.main === module) {
  (async () => {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    if (!token) {
      console.error('Error: GITHUB_TOKEN or GH_TOKEN environment variable is required to run locally.');
      console.error('Usage: GITHUB_TOKEN=xxx [DRY_RUN=true] [DAYS_THRESHOLD=7] node .github/scripts/issue-unassigner.js');
      process.exit(1);
    }

    const repoSlug = process.env.GITHUB_REPOSITORY || 'KanishJebaMathewM/Truxify';
    const [owner, repo] = repoSlug.split('/');
    const dryRun = process.env.DRY_RUN === 'true' || process.argv.includes('--dry-run');
    const daysThreshold = parseFloat(process.env.DAYS_THRESHOLD || '7');
    const mode = process.env.MODE || 'no_pr_or_inactive';

    const github = createFetchOctokit(token);

    await run({
      github,
      context: { repo: { owner, repo } },
      core: console,
      dryRun,
      daysThreshold,
      mode
    });
  })().catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = {
  hasLinkedPullRequest,
  getAssignmentTimestamp,
  hasRecentContributorActivity,
  isEligibleForUnassign,
  createFetchOctokit,
  run
};
