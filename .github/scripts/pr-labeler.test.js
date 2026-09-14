'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findLinkedIssueNumbers,
  hasProgramSignal,
  selectLabels,
  run
} = require('./pr-labeler');

const availableLabels = [
  'level:beginner',
  'level:intermediate',
  'type:bug',
  'type:feature',
  'type:refactor',
  'type:security',
  'type:testing',
  'customer-app',
  'driver-app',
  'flutter',
  'backend',
  'type:api',
  'type:docs',
  'type:performance',
  'type:design',
  'type:devops',
  'type:accessibility',
  'dependencies'
];

test('findLinkedIssueNumbers extracts closing issue references only', () => {
  assert.deepEqual(
    findLinkedIssueNumbers('Fixes #320, relates to #12, resolves owner/repo#44 and closes #320'),
    [320, 44]
  );
});

test('hasProgramSignal detects active program mentions', () => {
  const rules = {
    programSignals: ['nsoc', 'nsoc26']
  };

  assert.equal(hasProgramSignal({ title: 'feat: add helper', body: 'nsoc26 PR', rules }), true);
  assert.equal(hasProgramSignal({ title: 'feat: add helper', body: 'regular maintenance', rules }), false);
});

test('selectLabels inherits approved labels from linked issue', () => {
  const labels = selectLabels({
    prTitle: 'feat: add customer dashboard',
    prBody: 'Fixes #320',
    changedFiles: ['apps/customer/lib/screens/dashboard.dart'],
    linkedIssueLabels: ['level:intermediate'],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, [
    'customer-app',
    'flutter',
    'level:intermediate',
    'type:feature'
  ]);
});

test('selectLabels does not add GSSoC or ECSoC labels even if mentioned in PR text', () => {
  const labels = selectLabels({
    prTitle: 'fix: guard auth token parsing [GSSoC]',
    prBody: 'Submitted under ECSoC 2026.',
    changedFiles: ['backend/api/src/middleware/auth.js'],
    linkedIssueLabels: [],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['backend', 'type:api', 'type:security']);
});

test('selectLabels selects labels for standard bug fix', () => {
  const labels = selectLabels({
    prTitle: 'fix: guard auth token parsing',
    prBody: 'Just fixing a regular bug.',
    changedFiles: ['backend/api/src/middleware/auth.js'],
    linkedIssueLabels: [],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['backend', 'type:api', 'type:security']);
});

test('selectLabels does not duplicate labels already present on the PR', () => {
  const labels = selectLabels({
    prTitle: 'test: cover shipment route',
    prBody: 'Fixes #99',
    changedFiles: ['backend/api/test/unit/shipment.test.js'],
    linkedIssueLabels: ['level:intermediate'],
    currentLabels: ['level:intermediate', 'backend'],
    availableLabels
  });

  assert.deepEqual(labels, ['type:api', 'type:testing']);
});

test('selectLabels ignores labels that do not exist in the repository', () => {
  const labels = selectLabels({
    prTitle: 'docs: update setup',
    prBody: 'Fixes #101',
    changedFiles: ['README.md'],
    linkedIssueLabels: ['level:critical'],
    currentLabels: [],
    availableLabels
  });

  assert.deepEqual(labels, ['type:docs']);
});

test('selectLabels matches performance, design, devops, and accessibility prefixes', () => {
  const labelsPerf = selectLabels({
    prTitle: 'perf: optimize load time',
    availableLabels
  });
  assert.deepEqual(labelsPerf, ['type:performance']);

  const labelsDesign = selectLabels({
    prTitle: 'ui: update dashboard layout',
    availableLabels
  });
  assert.deepEqual(labelsDesign, ['type:design']);

  const labelsDevOps = selectLabels({
    prTitle: 'ci: add test action',
    availableLabels
  });
  assert.deepEqual(labelsDevOps, ['type:devops']);

  const labelsA11y = selectLabels({
    prTitle: 'a11y: add screen reader labels',
    availableLabels
  });
  assert.deepEqual(labelsA11y, ['type:accessibility']);
});

test('run function adds merge conflicts label, removes merge ready label, and comments if PR is not mergeable', async () => {
  let commentCreated = false;
  let removeLabelCalled = false;
  let addLabelsCalled = false;

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) return [{ name: 'merge conflicts' }, { name: 'merge ready' }];
      if (fn === mockGithub.rest.pulls.listFiles) return [];
      if (fn === mockGithub.rest.issues.listComments) return [];
      return [];
    },
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 123,
            title: 'feat: new feature',
            body: 'GSSoC',
            user: { login: 'testuser' },
            labels: [{ name: 'merge ready' }],
            mergeable: false,
            mergeable_state: 'dirty'
          }
        }),
        listFiles: () => {}
      },
      issues: {
        get: async () => ({ data: { labels: [] } }),
        listLabelsForRepo: () => {},
        listComments: () => {},
        createLabel: async () => {},
        createComment: async ({ body }) => {
          assert.equal(body, '@testuser, please resolve the commit so that it will be merged soon ......');
          commentCreated = true;
        },
        addLabels: async ({ labels }) => {
          assert.equal(labels.includes('merge conflicts'), true);
          addLabelsCalled = true;
        },
        removeLabel: async ({ name }) => {
          assert.equal(name, 'merge ready');
          removeLabelCalled = true;
        }
      }
    }
  };

  const mockContext = {
    payload: {
      pull_request: {
        number: 123,
        user: { login: 'testuser' },
        labels: [{ name: 'merge ready' }]
      }
    },
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    rulesPath: undefined,
    dryRun: false
  });

  assert.equal(commentCreated, true);
  assert.equal(removeLabelCalled, true);
  assert.equal(addLabelsCalled, true);
});

test('run function removes merge conflicts label and adds merge ready label if PR is mergeable', async () => {
  let removeLabelCalled = false;
  let addLabelsCalled = false;

  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) return [{ name: 'merge conflicts' }, { name: 'merge ready' }];
      if (fn === mockGithub.rest.pulls.listFiles) return [];
      if (fn === mockGithub.rest.issues.listComments) return [];
      return [];
    },
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 123,
            title: 'feat: new feature',
            body: 'GSSoC',
            user: { login: 'testuser' },
            labels: [{ name: 'merge conflicts' }],
            mergeable: true,
            mergeable_state: 'clean'
          }
        }),
        listFiles: () => {}
      },
      issues: {
        get: async () => ({ data: { labels: [] } }),
        listLabelsForRepo: () => {},
        listComments: () => {},
        createLabel: async () => {},
        createComment: async () => {},
        addLabels: async ({ labels }) => {
          assert.equal(labels.includes('merge ready'), true);
          addLabelsCalled = true;
        },
        removeLabel: async ({ name }) => {
          assert.equal(name, 'merge conflicts');
          removeLabelCalled = true;
        }
      }
    }
  };

  const mockContext = {
    payload: {
      pull_request: {
        number: 123,
        user: { login: 'testuser' },
        labels: [{ name: 'merge conflicts' }]
      }
    },
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    rulesPath: undefined,
    dryRun: false
  });

  assert.equal(removeLabelCalled, true);
  assert.equal(addLabelsCalled, true);
});

test('run function labels PR based on linked issue and path rules without GSSoC/ECSoC comments', async () => {
  let addedLabels = [];
  let commentsCreated = [];
  const mockGithub = {
    paginate: async (fn, params) => {
      if (fn === mockGithub.rest.issues.listLabelsForRepo) return [{ name: 'customer-app' }, { name: 'flutter' }, { name: 'type:feature' }];
      if (fn === mockGithub.rest.pulls.listFiles) return [{ filename: 'apps/customer/lib/main.dart' }];
      return [];
    },
    rest: {
      pulls: {
        get: async () => ({
          data: {
            number: 320,
            title: 'feat: add feature',
            body: 'Fixes #105',
            labels: [],
            mergeable: true
          }
        }),
        listFiles: () => {}
      },
      issues: {
        get: async ({ issue_number }) => {
          if (issue_number === 105) {
            return {
              data: {
                number: 105,
                title: 'Customer issue',
                body: 'Regular task description.',
                labels: [{ name: 'level:beginner' }]
              }
            };
          }
          return { data: { labels: [] } };
        },
        listLabelsForRepo: () => {},
        createLabel: async () => {},
        createComment: async ({ body }) => {
          commentsCreated.push(body);
        },
        addLabels: async ({ labels }) => {
          addedLabels = labels;
        }
      }
    }
  };

  const mockContext = {
    payload: {
      pull_request: {
        number: 320,
        labels: []
      }
    },
    repo: { owner: 'owner', repo: 'repo' }
  };

  const mockCore = {
    info: () => {},
    warning: () => {}
  };

  await run({
    github: mockGithub,
    context: mockContext,
    core: mockCore,
    rulesPath: undefined,
    dryRun: false
  });

  // No automated comment asking about GSSoC or ECSoC should be created
  assert.equal(commentsCreated.length, 0);
  assert.equal(addedLabels.includes('customer-app'), true);
  assert.equal(addedLabels.includes('flutter'), true);
  assert.equal(addedLabels.includes('type:feature'), true);
});

test('pickDominantTypeLabel picks label with highest file-change score', () => {
  const { pickDominantTypeLabel, loadRules } = require('./pr-labeler');
  const rules = loadRules();
  const result = pickDominantTypeLabel({
    candidateLabels: ['backend', 'type:bug', 'type:testing', 'type:docs'],
    changedFiles: [
      'backend/api/test/unit/a.test.js',
      'backend/api/test/unit/b.test.js',
      'backend/api/test/unit/c.test.js',
      'docs/README.md'
    ],
    prTitle: 'test: add unit tests',
    rules
  });
  // type:testing gets 3 files (path) + 3 (title) = 6
  // type:docs gets 1 file (path) = 1
  // type:bug gets 0 = 0
  assert.deepEqual(result, ['backend', 'type:testing']);
});

test('pickDominantTypeLabel uses priority tiebreaker when scores are equal', () => {
  const { pickDominantTypeLabel, loadRules } = require('./pr-labeler');
  const rules = loadRules();
  const result = pickDominantTypeLabel({
    candidateLabels: ['type:bug', 'type:security'],
    changedFiles: [],
    prTitle: 'misc change',
    rules
  });
  // Both score 0, security has higher priority
  assert.deepEqual(result, ['type:security']);
});

test('pickDominantTypeLabel returns candidateLabels unchanged when 0 or 1 type labels', () => {
  const { pickDominantTypeLabel, loadRules } = require('./pr-labeler');
  const rules = loadRules();
  const result = pickDominantTypeLabel({
    candidateLabels: ['backend', 'type:bug'],
    changedFiles: [],
    prTitle: 'fix: something',
    rules
  });
  assert.deepEqual(result, ['backend', 'type:bug']);
});

test('selectLabels skips new type labels when PR already has one', () => {
  const labels = selectLabels({
    prTitle: 'fix: security issue in docs',
    changedFiles: ['docs/SECURITY.md'],
    linkedIssueLabels: [],
    currentLabels: ['type:bug'],
    availableLabels
  });
  // type:docs and type:security would normally be added, but PR already has type:bug
  assert.equal(labels.filter(l => l.startsWith('type:')).every(l => l === 'type:api' || !['type:bug','type:feature','type:docs','type:testing','type:security','type:performance','type:design','type:refactor','type:devops','type:accessibility'].includes(l)), true);
});
