'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

function scratch(t) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'creator-deployment-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('deployment CLI/profile configuration is passed unchanged with user identity', t => {
  const root = scratch(t);
  const script = `
    const assert = require('node:assert/strict');
    const { exportFeishuDocument } = require('./publisher-dashboard/feishu-import');
    exportFeishuDocument({ url: 'https://example.feishu.cn/docx/FixtureDocument1234567', outputRoot: process.argv[1] }, {
      execFile(command, args, options, callback) {
        assert.equal(command, '/fixture/custom-lark');
        assert.deepEqual(args.slice(0, 4), ['--profile', 'deployment-personal', '--as', 'user']);
        assert.equal(options.shell, false);
        callback(null, JSON.stringify({ ok: true, identity: 'user', data: { document: { content: 'fixture' } } }), '');
      }
    }).then(result => { assert.equal(result.source.profile, 'deployment-personal'); console.log('ok'); })
      .catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script, path.join(root, 'exports')], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8',
    env: { ...process.env, PUBLISHER_LARK_CLI: '/fixture/custom-lark', PUBLISHER_FEISHU_PROFILE: 'deployment-personal' },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});

test('missing PATH Lark and configured Codex fail clearly without launching replacement tools', async t => {
  const root = scratch(t);
  const script = `
    const assert = require('node:assert/strict');
    const { exportFeishuDocument, DEFAULT_CLI_PATH } = require('./publisher-dashboard/feishu-import');
    const { runCodexAnalysis } = require('./publisher-dashboard/topic-research');
    (async () => {
      assert.equal(DEFAULT_CLI_PATH, 'lark-cli');
      await assert.rejects(exportFeishuDocument({ url: 'https://example.feishu.cn/docx/FixtureDocument1234567', outputRoot: process.argv[1] }),
        error => error.code === 'FEISHU_CLI_UNAVAILABLE');
      await assert.rejects(runCodexAnalysis({ signals: [] }), error => error.statusCode === 503 && /Codex/.test(error.message));
      console.log('ok');
    })().catch(error => { console.error(error); process.exitCode = 1; });
  `;
  const result = spawnSync(process.execPath, ['-e', script, path.join(root, 'exports')], {
    cwd: path.resolve(__dirname, '../..'), encoding: 'utf8',
    env: { ...process.env, PATH: root, PUBLISHER_LARK_CLI: '', PUBLISHER_FEISHU_PROFILE: '',
      CREATOR_CODEX_CLI: path.join(root, 'not-installed-codex') },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'ok');
});
