const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parsePlatformOutput,
  parseSyncResults,
  loginExported,
  generateCandidates,
  createPlansRange,
  updatePlan,
  contentToMarkdown,
  generateContent,
  updateContent,
  db,
} = require('../server');

test('parsePlatformOutput reads CLI platform list', () => {
  const output = [
    '',
    'Supported platforms (2):',
    '',
    '  zhihu           Zhihu',
    '  zip-download    Markdown ZIP',
  ].join('\n');

  assert.deepEqual(parsePlatformOutput(output), [
    { id: 'zhihu', name: 'Zhihu' },
    { id: 'zip-download', name: 'Markdown ZIP' },
  ]);
});

test('parseSyncResults reads success and failed rows', () => {
  const output = [
    'Sync results:',
    '',
    '  ✓ zip-download',
    '    Downloaded Test.zip',
    '  ✗ juejin',
    '    Not logged in',
    '',
    'Sync completed: 1 success, 1 failed',
  ].join('\n');

  assert.deepEqual(parseSyncResults(output), {
    'zip-download': {
      status: 'success',
      url: null,
      message: 'Downloaded Test.zip',
    },
    juejin: {
      status: 'failed',
      error: 'Not logged in',
    },
  });
});

test('parseSyncResults reads current CLI OK and FAIL rows', () => {
  const output = [
    'Sync results:',
    '',
    '  [OK] zhihu (draft)',
    '    https://www.zhihu.com/draft/123',
    '    Draft saved',
    '  [FAIL] xiaohongshu',
    '    Run weibot login xiaohongshu first',
    '',
    'Sync completed: 1 success, 1 failed',
  ].join('\n');

  assert.deepEqual(parseSyncResults(output), {
    zhihu: {
      status: 'success',
      url: 'https://www.zhihu.com/draft/123',
      message: 'Draft saved',
    },
    xiaohongshu: {
      status: 'failed',
      error: 'Run weibot login xiaohongshu first',
    },
  });
});

test('loginExported detects cookie export output', () => {
  assert.equal(loginExported('Exported 3 cookies to cookies.json'), true);
  assert.equal(loginExported('Open browser and log in'), false);
});

test('generateCandidates creates five candidates', () => {
  const candidates = generateCandidates('2026-06-19');
  assert.equal(candidates.length, 5);
  assert.equal(candidates[0].priority, 'P0');
});

test('contentToMarkdown includes front matter and h1', () => {
  const markdown = contentToMarkdown({ title: 'Test Title', body: '# Test Title\n\nBody text' });
  assert.match(markdown, /title: Test Title/);
  assert.match(markdown, /# Test Title/);
  assert.match(markdown, /Body text/);
});

test('plans can be created in range and edited', () => {
  db.prepare("DELETE FROM contents WHERE plan_date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  db.prepare("DELETE FROM weekly_plans WHERE date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  try {
    const result = createPlansRange('2099-01-01', '2099-01-03', { status: 'todo' });
    assert.equal(result.plans.length, 3);

    const plan = updatePlan('2099-01-02', {
      topic: 'Editable topic',
      type: 'Case review',
      audience: 'Content ops',
      materials: 'Customer cases',
      status: 'confirmed',
    });
    assert.equal(plan.topic, 'Editable topic');
    assert.equal(plan.status, 'confirmed');
  } finally {
    db.prepare("DELETE FROM weekly_plans WHERE date BETWEEN '2099-01-01' AND '2099-01-03'").run();
  }
});

test('content body can be updated', () => {
  let content;
  try {
    content = generateContent('2099-02-02');
    const updated = updateContent(content.id, {
      body: '# User Edited Title\n\nUser edited body.',
    });

    assert.equal(updated.title, 'User Edited Title');
    assert.match(updated.body, /User edited body/);
  } finally {
    if (content?.id) db.prepare('DELETE FROM contents WHERE id = ?').run(content.id);
    db.prepare("DELETE FROM weekly_plans WHERE date = '2099-02-02'").run();
  }
});
