'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFile } = require('node:child_process');
const { test } = require('node:test');
const { marked } = require('marked');
const { createRequire } = require('node:module');
const requireFromCore = createRequire(path.resolve(__dirname, '../../packages/core/package.json'));
const { parseHTML } = (() => {
  try { return require('linkedom'); } catch (error) {
    if (error.code !== 'MODULE_NOT_FOUND') throw error;
    return requireFromCore('linkedom');
  }
})();
const { exportFeishuDocument, FeishuImportError, DEFAULT_CLI_PATH, DEFAULT_OUTPUT_ROOT } = require('../feishu-import');

const DOCUMENT_ID = 'DocxTestDocument0123456789';
const IMAGE_A = 'ImageTokenFirst0123456789';
const IMAGE_B = 'ImageTokenSecond012345678';
const WIKI_ID = 'WikiTestDocument0123456789';
const URL = `https://tenant.feishu.cn/docx/${DOCUMENT_ID}`;
const WIKI_URL = `https://tenant.feishu.cn/wiki/${WIKI_ID}`;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

// This same test file is also an actual child-process CLI fixture. No external
// services, credentials, config files, or real Feishu URLs are used by tests.
if (process.argv[2] === '--mock-cli') {
  const args = process.argv.slice(3);
  const value = flag => args[args.indexOf(flag) + 1];
  const reply = data => process.stdout.write(JSON.stringify({ ok: true, identity: 'user', data }));
  if (value('--doc') === 'SlowDocument0123456789') {
    setTimeout(() => reply({ document: { content: 'too late' } }), 5000);
  } else if (value('--doc') === 'ErrorDocument0123456789') {
    process.stderr.write('access_token=TEST_CREDENTIAL_DO_NOT_EXPOSE missing_scope');
    process.exitCode = 1;
  } else if (args.includes('+fetch')) {
    reply({ document: { document_id: value('--doc'), title: '子进程原稿', content: `前\n<img token="${IMAGE_A}"/>\n后` } });
  } else if (args.includes('+media-download')) {
    fs.writeFileSync(value('--output'), PNG);
    reply({ output: value('--output') });
  } else {
    process.exitCode = 2;
  }
} else {
  function setup(t) {
    // Canonical physical path avoids macOS /var -> /private/var aliases.
    const parent = fs.realpathSync(os.tmpdir());
    const directory = fs.mkdtempSync(path.join(parent, 'feishu-import-test-'));
    t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
    return { directory, outputRoot: path.join(directory, '中文 原稿', '导出') };
  }

  function cliMock({ content = '# 测试文档\n\n正文。\n', title = '测试文档', references = {}, node, fetchResponse, download, error, identity = 'user', stderr = '' } = {}) {
    const calls = [];
    const mock = (command, args, options, callback) => {
      calls.push({ command, args, options });
      queueMicrotask(async () => {
        try {
          assert.equal(command, DEFAULT_CLI_PATH);
          assert.equal(args[0], '--profile');
          assert.ok(['personal', 'enterprise-reader'].includes(args[1]));
          assert.deepEqual(args.slice(2, 4), ['--as', 'user']);
          assert.equal(options.shell, false);
          assert.equal(options.killSignal, 'SIGKILL');
          assert.ok(options.timeout > 0 && options.timeout <= 60000);
          assert.equal(options.encoding, 'utf8');
          const request = args.slice(4);
          if (error) throw error;
          let response;
          if (request[0] === 'wiki') {
            assert.deepEqual(request, ['wiki', 'spaces', 'get_node', '--token', WIKI_ID, '--format', 'json']);
            response = { ok: true, identity, data: { node: node ?? { obj_type: 'docx', obj_token: DOCUMENT_ID, title: 'Wiki 标题' } } };
          } else if (request[1] === '+fetch') {
            assert.deepEqual(request, ['docs', '+fetch', '--doc', DOCUMENT_ID, '--doc-format', 'markdown', '--scope', 'full', '--detail', 'simple']);
            response = fetchResponse ?? { ok: true, identity, data: { document: { document_id: DOCUMENT_ID, title, content, reference_map: references } } };
          } else {
            assert.deepEqual(request.slice(0, 3), ['docs', '+media-download', '--token']);
            assert.deepEqual(request.slice(6), ['--type', 'media', '--format', 'json']);
            assert.equal(request[4], '--output');
            assert.equal(request.includes('--overwrite'), false);
            assert.equal(path.basename(request[5]), request[5]);
            assert.equal(path.isAbsolute(request[5]), false);
            assert.ok(path.isAbsolute(options.cwd));
            assert.equal(path.basename(options.cwd), 'assets');
            const destination = path.join(options.cwd, request[5]);
            assert.match(destination, /assets\/image-\d{4}\.download$/);
            if (download) response = await download({ token: request[3], destination, calls });
            else fs.writeFileSync(destination, request[3] === IMAGE_B ? GIF : PNG);
            response ??= { ok: true, identity, data: { output: destination } };
          }
          callback(null, JSON.stringify(response), stderr);
        } catch (failure) {
          callback(failure, '', failure.stderr || '');
        }
      });
    };
    return { calls, execFile: mock };
  }

  async function rejectsCode(promise, code) {
    await assert.rejects(promise, error => {
      assert.ok(error instanceof FeishuImportError);
      assert.equal(error.code, code);
      assert.equal(error.cause, undefined);
      return true;
    });
  }

  function bundles(outputRoot) {
    return fs.existsSync(outputRoot) ? fs.readdirSync(outputRoot) : [];
  }

  test('exports a text-only document exactly, with explicit current CLI flags and default personal profile', async t => {
    const { outputRoot } = setup(t);
    const content = '# 原题\r\n\r\n原稿中英 mixed。\r\n\r\n保留换行。';
    const cli = cliMock({ content, title: '原题' });
    const result = await exportFeishuDocument({ url: `${URL}?from=share&access_token=IGNORE_THIS#share-selection`, outputRoot }, cli);
    assert.equal(result.title, '原题');
    assert.equal(result.markdown, content);
    assert.equal(fs.readFileSync(result.markdownPath, 'utf8'), content);
    assert.deepEqual(result.assets, []);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.source, { url: URL, documentId: DOCUMENT_ID, profile: 'personal' });
    assert.equal(path.dirname(result.bundleDir), outputRoot);
    assert.deepEqual(fs.readdirSync(result.bundleDir), ['original.md']);
    assert.equal(fs.statSync(result.bundleDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(result.markdownPath).mode & 0o777, 0o600);
    assert.equal(cli.calls.length, 1);
    assert.equal(cli.calls[0].args.includes('--offset'), false);
    assert.equal(cli.calls[0].args.includes('--limit'), false);
    assert.equal(JSON.stringify(cli.calls).includes('IGNORE_THIS'), false);
    assert.match(DEFAULT_OUTPUT_ROOT, /publisher-dashboard\/data\/feishu-imports$/);
  });

  test('downloads distinct original image bytes, preserves all positions, and reuses repeated resources', async t => {
    const { outputRoot } = setup(t);
    const content = `# 图文\n\n前段\n<image token="${IMAGE_A}" width="1" name="../中文 名.png"/>\n中段<img token='${IMAGE_B}' caption='A &amp; [B]'/>尾段\n<img token="${IMAGE_A}" alt="重复图"></img>\n结束\n`;
    const cli = cliMock({ content });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.assets.length, 2);
    assert.equal(cli.calls.filter(call => call.args.includes('+media-download')).length, 2);
    assert.equal(result.markdown, '# 图文\n\n前段\n![../中文 名.png](assets/image-0001.png)\n中段![A & \\[B\\]](assets/image-0002.gif)尾段\n![重复图](assets/image-0001.png)\n结束\n');
    for (const [index, bytes] of [PNG, GIF].entries()) {
      const asset = result.assets[index];
      assert.deepEqual(Object.keys(asset).sort(), ['absolutePath', 'filename', 'mimeType', 'relativePath', 'sha256']);
      assert.deepEqual(fs.readFileSync(asset.absolutePath), bytes);
      assert.equal(asset.absolutePath, path.join(result.bundleDir, asset.relativePath));
      assert.equal(asset.sha256, createHash('sha256').update(bytes).digest('hex'));
      assert.equal(fs.statSync(asset.absolutePath).mode & 0o777, 0o600);
    }
    assert.equal(result.assets[0].mimeType, 'image/png');
    assert.equal(result.assets[1].mimeType, 'image/gif');
    assert.equal(fs.readFileSync(result.markdownPath, 'utf8'), result.markdown);
    assert.ok(fs.readdirSync(path.join(result.bundleDir, 'assets')).every(name => !name.endsWith('.download')));
  });

  test('resolves img/image reference_map entries and direct src tokens', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({
      content: `<img ref="i1"/>\n<image token="i2"/>\n<img src="${IMAGE_A}"/>`,
      references: { img: { i1: { token: IMAGE_A } }, image: { i2: { file_token: IMAGE_B } } },
    });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.markdown, '![](assets/image-0001.png)\n![](assets/image-0002.gif)\n![](assets/image-0001.png)');
    assert.equal(result.assets.length, 2);
  });

  test('localizes current CLI Markdown file URLs without requesting URLs or changing alt text, captions and image positions', async t => {
    const { outputRoot } = setup(t);
    const content = `# 当前格式\n前\n![中文 [描述] 和 \\[转义\\]](https://feishu.cn/file/${IMAGE_A})\n<img token="${IMAGE_B}"/>\n![第二个位置](<https://tenant.larksuite.com/file/${IMAGE_A}> "标题(保持)")\n尾\n\`![伪图](https://evil.test/x)\``;
    const cli = cliMock({ content });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.markdown, content.replace(`https://feishu.cn/file/${IMAGE_A}`, 'assets/image-0001.png').replace(`<img token="${IMAGE_B}"/>`, '![](assets/image-0002.gif)').replace(`https://tenant.larksuite.com/file/${IMAGE_A}`, 'assets/image-0001.png'));
    assert.equal(result.assets.length, 2);
    assert.equal(cli.calls.length, 3);
    assert.ok(cli.calls.every(call => !call.args.some(arg => /^https?:/.test(arg))));
  });

  test('rejects spoofed Feishu file URLs, query strings and encoded path tricks', async t => {
    const { outputRoot } = setup(t);
    for (const destination of [
      `https://feishu.cn.evil.test/file/${IMAGE_A}`, `https://evil@feishu.cn/file/${IMAGE_A}`,
      `https://feishu.cn:443/file/${IMAGE_A}`, `http://feishu.cn/file/${IMAGE_A}`,
      `https://feishu.cn/file/${IMAGE_A}?url=http://127.0.0.1`, `https://feishu.cn/junk/../file/${IMAGE_A}`,
      `https://feishu.cn/file%2f${IMAGE_A}`, `https://feishu.cn./file/${IMAGE_A}`,
    ]) {
      const cli = cliMock({ content: `![图](${destination})` });
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_UNSUPPORTED_IMAGE');
      assert.equal(cli.calls.length, 1);
    }
  });

  function assertRenderedAssets(result, expectedSources = result.assets.map(asset => asset.relativePath)) {
    const { document } = parseHTML(marked.parse(result.markdown));
    const sources = [...document.querySelectorAll('img')].map(image => image.getAttribute('src'));
    assert.deepEqual(sources, expectedSources);
    for (const source of sources) {
      const asset = result.assets.find(item => item.relativePath === source);
      assert.ok(asset, `Rendered source has no downloaded asset: ${source}`);
      assert.ok(fs.existsSync(asset.absolutePath));
      assert.equal(createHash('sha256').update(fs.readFileSync(asset.absolutePath)).digest('hex'), asset.sha256);
    }
  }

  test('P2: downloads the six-space nested-list image and renders only its local asset', async t => {
    const { outputRoot } = setup(t);
    const content = `- 一级条目\n    - 二级条目\n\n      ![截图](https://tenant.feishu.cn/file/${IMAGE_A})\n`;
    assert.match(marked.parse(content), /<img src="https:\/\/tenant\.feishu\.cn\/file\//);
    const cli = cliMock({ content });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(cli.calls.length, 2);
    assert.equal(result.assets.length, 1);
    assert.equal(result.markdown, content.replace(`https://tenant.feishu.cn/file/${IMAGE_A}`, 'assets/image-0001.png'));
    assert.deepEqual(result.warnings, []);
    assertRenderedAssets(result);
  });

  test('handles nested ordered/task/quoted lists, CRLF, repeated images and lazy paragraph indentation', async t => {
    const { outputRoot } = setup(t);
    const image = `![截图](https://tenant.feishu.cn/file/${IMAGE_A})`;
    const samples = [
      `1. 一级\n   1. 二级\n\n      ${image}\n`,
      `- [x] 一级\n    - [ ] 二级\n\n      ${image}\n`,
      `> - 一级\n>     - 二级\n>\n>       ${image}\n`,
      `- 一级\r\n    - 二级\r\n\r\n      ${image}\r\n`,
      `正文\n    ${image}\n`,
      `- 一级\n    - 二级\n\n      ${image}\n\n      ${image}\n`,
      `- 一级\n    - 二级\n\n      <img token="${IMAGE_A}"/>\n`,
    ];
    for (const content of samples) {
      const cli = cliMock({ content });
      const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
      const count = (content.match(/!\[|<img /g) || []).length;
      assert.equal(cli.calls.length, 2);
      assert.equal(result.assets.length, 1);
      assertRenderedAssets(result, Array(count).fill('assets/image-0001.png'));
    }
  });

  test('preserves fenced and true indented code in and outside lists, while localizing an identical adjacent list image', async t => {
    const { outputRoot } = setup(t);
    const image = `![截图](https://tenant.feishu.cn/file/${IMAGE_A})`;
    const tag = `<img token="${IMAGE_A}"/>`;
    const codeSamples = [
      `\`\`\`markdown\n${image}\n${tag}\n\`\`\`\n`,
      `~~~markdown\n${image}\n${tag}\n~~~\n`,
      `    ${image}\n    ${tag}\n`,
      `\t${image}\n\t${tag}\n`,
      `- 一级\n    - 二级\n\n          ${image}\n          ${tag}\n`,
      `- 一级\n    - 二级\n\n      \`\`\`markdown\n      ${image}\n      ${tag}\n      \`\`\`\n`,
      `> - 一级\n>\n>       ${image}\n>       ${tag}\n`,
      `- 一级\n\n\t\t${image}\n\t\t${tag}\n`,
    ];
    for (const code of codeSamples) {
      const codeOnlyCli = cliMock({ content: code });
      const codeOnly = await exportFeishuDocument({ url: URL, outputRoot }, codeOnlyCli);
      assert.equal(codeOnly.markdown, code);
      assert.equal(codeOnlyCli.calls.length, 1);
      assertRenderedAssets(codeOnly, []);
      const content = `${code}\n---\n\n- 列表\n    - 正文\n\n      ${image}\n`;
      const cli = cliMock({ content });
      const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
      assert.ok(result.markdown.startsWith(code));
      assert.equal(cli.calls.length, 2);
      assertRenderedAssets(result);
    }
  });

  test('nested permission-gated images fail on missing_scope and external images are not silently retained', async t => {
    const { outputRoot } = setup(t);
    const content = `- 一级\n    - 二级\n\n      ![截图](https://tenant.feishu.cn/file/${IMAGE_A})\n`;
    const cli = cliMock({ content, download() { throw Object.assign(new Error('read denied'), { stderr: 'missing_scope' }); } });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_MISSING_SCOPE');
    assert.equal(cli.calls.length, 2);
    assert.deepEqual(bundles(outputRoot), []);
    const external = cliMock({ content: content.replace(`https://tenant.feishu.cn/file/${IMAGE_A}`, 'https://evil.test/image.png') });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, external), 'FEISHU_UNSUPPORTED_IMAGE');
    assert.equal(external.calls.length, 1);
  });

  test('render audit rejects live HTML images hidden in code/pre markup and removes the incomplete bundle', async t => {
    const { outputRoot } = setup(t);
    for (const content of [
      `<pre><img src="https://tenant.feishu.cn/file/${IMAGE_A}"></pre>`,
      `<code><img src="https://tenant.feishu.cn/file/${IMAGE_A}"></code>`,
    ]) {
      const cli = cliMock({ content });
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_IMAGE_REFERENCE_MISMATCH');
      assert.equal(cli.calls.length, 1);
      assert.deepEqual(bundles(outputRoot), []);
    }
  });

  test('resolves wiki type and obj_token before fetching, keeping enterprise read-only and user identity', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({ title: undefined });
    const result = await exportFeishuDocument({ url: WIKI_URL, outputRoot, profile: 'enterprise-reader' }, cli);
    assert.deepEqual(result.source, { url: WIKI_URL, documentId: DOCUMENT_ID, profile: 'enterprise-reader' });
    assert.equal(cli.calls.length, 2);
    assert.ok(cli.calls.every(call => call.args[1] === 'enterprise-reader'));
    assert.equal(cli.calls[1].args[7], DOCUMENT_ID);
  });

  test('refuses all non-docx wiki targets and malformed object identifiers', async t => {
    const { outputRoot } = setup(t);
    for (const obj_type of ['sheet', 'bitable', 'file', 'slides', 'mindnote', 'doc', undefined]) {
      const cli = cliMock({ node: { obj_type, obj_token: DOCUMENT_ID } });
      await rejectsCode(exportFeishuDocument({ url: WIKI_URL, outputRoot }, cli), 'FEISHU_UNSUPPORTED_DOCUMENT');
      assert.equal(cli.calls.length, 1);
    }
    const cli = cliMock({ node: { obj_type: 'docx', obj_token: '../../escape' } });
    await rejectsCode(exportFeishuDocument({ url: WIKI_URL, outputRoot }, cli), 'FEISHU_INVALID_RESPONSE');
    assert.equal(cli.calls.length, 1);
    assert.deepEqual(bundles(outputRoot), []);
  });

  test('rejects malicious hosts, URL normalization tricks, unsupported paths, lengths and non-string inputs before any CLI call', async t => {
    const { outputRoot } = setup(t);
    const urls = [
      null, 12, {}, '', ` ${URL}`, `${URL}\n`, URL.replace('https:', 'http:'),
      URL.replace('tenant.feishu.cn', 'localhost'), URL.replace('tenant.feishu.cn', '127.0.0.1'),
      URL.replace('tenant.feishu.cn', '[::1]'), URL.replace('tenant.feishu.cn', 'tenant.feishu.cn.evil.test'),
      URL.replace('tenant.feishu.cn', 'evilfeishu.cn'), URL.replace('tenant.feishu.cn', 'tenant.feishu.cn@evil.test'),
      URL.replace('tenant.feishu.cn', 'evil@tenant.feishu.cn'), URL.replace('tenant.feishu.cn', 'tenant.feishu.cn:443'),
      URL.replace('tenant.feishu.cn', 'tenant.feishu.cn.'), URL.replace('tenant.feishu.cn', 'tenant。feishu.cn'),
      URL.replace('tenant.feishu.cn', 'tenant%2efeishu.cn'), URL.replace('tenant.feishu.cn', '-tenant.feishu.cn'),
      URL.replace('tenant.feishu.cn', 'tenant..feishu.cn'), URL.replace('/docx/', '//docx/'),
      URL.replace('/docx/', '/junk/../docx/'), URL.replace('/docx/', '/docx%2f'),
      URL.replace('/docx/', '\\docx\\'), URL.replace('/docx/', '/sheets/'),
      `${URL}/other`, `${URL}%2f..`, `${URL}/../${DOCUMENT_ID}`, `${URL}?x=${'a'.repeat(2100)}`,
      `https://tenant.feishu.cn/docx/${'a'.repeat(129)}`, 'https://tenant.feishu.cn/docx/x',
      'https://tenant.feishu.cn/docx/$(touch%20/tmp/not-allowed)', `file://${URL}`, `\u0000${URL}`,
    ];
    const cli = cliMock();
    for (const url of urls) await rejectsCode(exportFeishuDocument({ url, outputRoot }, cli), 'INVALID_URL');
    assert.equal(cli.calls.length, 0);
    assert.equal(fs.existsSync(outputRoot), false);
  });

  test('accepts canonical Feishu and Lark hosts, removing query and selection fragments', async t => {
    const { outputRoot } = setup(t);
    for (const host of ['feishu.cn', 'larksuite.com', 'team-9.larksuite.com', 'a.feishu.cn']) {
      const cli = cliMock();
      const result = await exportFeishuDocument({ url: `https://${host}/docx/${DOCUMENT_ID}/?from=copy#share-a`, outputRoot }, cli);
      assert.equal(result.source.url, `https://${host}/docx/${DOCUMENT_ID}`);
    }
  });

  test('rejects profile aliases and shell injection instead of choosing another account', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock();
    for (const profile of ['bot', 'default', 'cli_fixture', 'personal; invalid-command', '--as bot', {}, null, '']) {
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot, profile }, cli), 'INVALID_PROFILE');
    }
    assert.equal(cli.calls.length, 0);
  });

  test('keeps fake tags in fenced, indented, quoted, inline, HTML code and comments byte-for-byte', async t => {
    const { outputRoot } = setup(t);
    const fake = '<img token="FakeImageToken0123456789"/>';
    const content = [
      '```xml', fake, '```', '', '~~~~', fake, '~~~', '~~~~', '',
      `    ${fake}`, `\t${fake}`, '', `inline \`${fake}\` suffix`, `double \`\`${fake} with \` inside\`\``,
      '> ```html', `> ${fake}`, '> ```', '', '- ```html', `  ${fake}`, '  ```', '',
      `<pre>&lt;${fake.slice(1, -1)}&gt;</pre>`, `<code>&lt;${fake.slice(1, -1)}&gt;</code>`, `<!-- ${fake} -->`,
      `\\${fake}`, '', `<img token="${IMAGE_A}"/>`, '', '```unclosed', fake,
    ].join('\n');
    const cli = cliMock({ content });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.markdown, content.replace(`<img token="${IMAGE_A}"/>`, '![](assets/image-0001.png)'));
    assert.equal(result.assets.length, 1);
    assert.equal(cli.calls.length, 2);
  });

  test('does not treat an escaped inline-code opener as protecting a real image', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({ content: `\\\` text <img token="${IMAGE_A}"/>` });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.assets.length, 1);
  });

  test('never downloads arbitrary URL images, unsafe tokens or unresolved sidecar references', async t => {
    const { outputRoot } = setup(t);
    for (const content of [
      '<img src="https://evil.test/track.png"/>', '<img href="http://127.0.0.1/private"/>',
      '<image url="https://tenant.feishu.cn/arbitrary.png"/>', '<img token="https://evil.test/a"/>',
      '<img token="../../escape"/>', '<img token="$(touch /tmp/oops)"/>', '<img token="--help"/>',
      '<img ref="__proto__"/>', '<img ref="missing"/>', '![remote](https://evil.test/x)',
      '![remote][id]\n[id]: https://evil.test/x', '<img token=unquoted>',
      `<img token="${IMAGE_A}" token="${IMAGE_B}"/>`, '<img token="broken"',
    ]) {
      const cli = cliMock({ content });
      await assert.rejects(exportFeishuDocument({ url: URL, outputRoot }, cli), error => /^FEISHU_(UNSUPPORTED|INVALID)_IMAGE$/.test(error.code));
      assert.equal(cli.calls.length, 1);
      assert.deepEqual(bundles(outputRoot), []);
    }
  });

  test('keeps attachments, executable attachment names and whiteboards without downloading them, with a warning', async t => {
    const { outputRoot } = setup(t);
    const content = '<file token="ExecutableToken012345678" name="danger.exe"/>\n<source token="ArchiveToken01234567890" name="archive.zip"/>\n<whiteboard token="BoardToken01234567890"/>\n[普通链接](https://example.com)';
    const cli = cliMock({ content });
    const result = await exportFeishuDocument({ url: URL, outputRoot }, cli);
    assert.equal(result.markdown, content);
    assert.equal(cli.calls.length, 1);
    assert.equal(result.warnings.length, 1);
    assert.deepEqual(result.assets, []);
  });

  test('refuses partial/paginated responses and never invokes obsolete continuation flags', async t => {
    const { outputRoot } = setup(t);
    const cases = [
      { ok: true, data: { document: { content: 'partial', has_more: true } } },
      { ok: true, data: { markdown: 'partial', has_more: true, next_offset: 50 } },
      { ok: true, has_more: 'true', data: { document: { content: 'partial' } } },
      { ok: true, data: { pagination: { next_page_token: 'NEXT_SECRET' }, document: { content: 'partial' } } },
      { ok: true, data: { document: { content: 'partial', truncated: true } } },
      { ok: true, data: { document: { content: 'partial', tips: 'content truncated' } } },
      { ok: true, data: { document: { content: '<fragment mode="range">partial</fragment>' } } },
    ];
    for (const fetchResponse of cases) {
      const cli = cliMock({ fetchResponse });
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_INCOMPLETE_DOCUMENT');
      assert.equal(cli.calls.length, 1);
      assert.deepEqual(bundles(outputRoot), []);
    }
  });

  test('supports unpaginated plain JSON envelope, empty documents, and title fallback', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({ fetchResponse: { title: '兼容 JSON', markdown: '正文', has_more: false } });
    assert.equal((await exportFeishuDocument({ url: URL, outputRoot }, cli)).markdown, '正文');
    const emptyCli = cliMock({ fetchResponse: { data: { document: { content: '' } } } });
    const empty = await exportFeishuDocument({ url: URL, outputRoot }, emptyCli);
    assert.equal(empty.markdown, '');
    assert.equal(empty.title, `飞书文档-${DOCUMENT_ID}`);
    const headingCli = cliMock({ fetchResponse: { data: { document: { content: '# 正文标题\n\n文字' } } } });
    assert.equal((await exportFeishuDocument({ url: URL, outputRoot }, headingCli)).title, '正文标题');
  });

  test('rejects wrong document IDs, missing content, wrong identity and dry-run data', async t => {
    const { outputRoot } = setup(t);
    const cases = [
      [{ data: { document: { content: '正文', document_id: 'WrongDoc0123456789' } } }, 'FEISHU_DOCUMENT_MISMATCH'],
      [{ data: { document: { title: '无内容' } } }, 'FEISHU_INVALID_DOCUMENT'],
      [{ identity: 'bot', data: { document: { content: '正文' } } }, 'FEISHU_WRONG_IDENTITY'],
      [{ ok: true, dry_run: true, data: { document: { content: '正文' } } }, 'FEISHU_INVALID_RESPONSE'],
    ];
    for (const [fetchResponse, code] of cases) {
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cliMock({ fetchResponse })), code);
    }
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cliMock({ stderr: '[identity: bot]' })), 'FEISHU_WRONG_IDENTITY');
  });

  test('missing_scope and expired authorization stop with redacted errors and no fallback or login', async t => {
    const { outputRoot } = setup(t);
    const secret = 'TEST_ONLY_SECRET_DO_NOT_EXPOSE';
    for (const profile of ['personal', 'enterprise-reader']) {
      for (const [signal, code] of [['missing_scope', 'FEISHU_MISSING_SCOPE'], ['needs_refresh', 'FEISHU_AUTH_REQUIRED'], ['permission_denied HTTP 403', 'FEISHU_PERMISSION_DENIED']]) {
        const cli = cliMock({ error: Object.assign(new Error(`Command failed: access_token=${secret}`), { stderr: `Authorization: Bearer ${secret}\n${signal}` }) });
        await assert.rejects(exportFeishuDocument({ url: URL, outputRoot, profile }, cli), error => {
          assert.equal(error.code, code);
          assert.doesNotMatch(`${error.stack} ${JSON.stringify(error)}`, new RegExp(secret));
          return true;
        });
        assert.equal(cli.calls.length, 1);
        assert.equal(cli.calls[0].args[1], profile);
      }
    }
    const cli = cliMock({ fetchResponse: { ok: false, error: { code: 'missing_scope', token: secret, hint: 'auth login --scope WRITE' } } });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_MISSING_SCOPE');
    assert.equal(cli.calls.length, 1);
  });

  test('download errors never report a successful or partially saved document', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({ content: `<img token="${IMAGE_A}"/>\n<img token="${IMAGE_B}"/>`, download({ token, destination }) {
      if (token === IMAGE_B) throw Object.assign(new Error('failed media'), { stderr: 'HTTP 403 SECRET_IN_STDERR' });
      fs.writeFileSync(destination, PNG);
    } });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_PERMISSION_DENIED');
    assert.equal(cli.calls.length, 3);
    assert.deepEqual(bundles(outputRoot), []);
  });

  test('ignores CLI-provided output destinations and fails when the expected file is absent', async t => {
    const { directory, outputRoot } = setup(t);
    const outside = path.join(directory, '用户原文件.png');
    fs.writeFileSync(outside, PNG);
    const cli = cliMock({ content: `<img token="${IMAGE_A}"/>`, download() { return { ok: true, data: { output: outside, filename: '../../owned.png' } }; } });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_IMAGE_DOWNLOAD_FAILED');
    assert.deepEqual(fs.readFileSync(outside), PNG);
    assert.deepEqual(bundles(outputRoot), []);
  });

  test('refuses executable/HTML/SVG payloads disguised as image downloads', async t => {
    const { outputRoot } = setup(t);
    const malicious = [Buffer.from('MZ\u0000fake executable'), Buffer.from('#!/bin/sh\necho danger'), Buffer.from('<svg><script>alert(1)</script></svg>'), Buffer.from('<html>login required</html>'), Buffer.from('PK\x03\x04archive'), Buffer.alloc(0)];
    for (const bytes of malicious) {
      const cli = cliMock({ content: `<img token="${IMAGE_A}"/>`, download({ destination }) { fs.writeFileSync(destination, bytes); } });
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_UNSAFE_MEDIA');
      assert.deepEqual(bundles(outputRoot), []);
    }
  });

  test('rejects downloaded symlinks, hardlinks and executable image mode, preserving original files', async t => {
    const { directory, outputRoot } = setup(t);
    const outside = path.join(directory, 'outside.png');
    fs.writeFileSync(outside, PNG);
    for (const kind of ['symlink', 'hardlink', 'executable']) {
      const cli = cliMock({ content: `<img token="${IMAGE_A}"/>`, download({ destination }) {
        if (kind === 'symlink') fs.symlinkSync(outside, destination);
        else if (kind === 'hardlink') fs.linkSync(outside, destination);
        else fs.writeFileSync(destination, PNG, { mode: 0o700 });
      } });
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), kind === 'symlink' ? 'FEISHU_IMAGE_DOWNLOAD_FAILED' : 'FEISHU_UNSAFE_MEDIA');
      assert.deepEqual(fs.readFileSync(outside), PNG);
      assert.deepEqual(bundles(outputRoot), []);
    }
  });

  test('rejects oversized assets and excessive image counts', async t => {
    const { outputRoot } = setup(t);
    const cli = cliMock({ content: `<img token="${IMAGE_A}"/>`, download({ destination }) {
      fs.writeFileSync(destination, PNG);
      fs.truncateSync(destination, 32 * 1024 * 1024 + 1);
    } });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'FEISHU_UNSAFE_MEDIA');
    assert.deepEqual(bundles(outputRoot), []);
    const many = cliMock({ content: Array.from({ length: 101 }, (_, i) => `<img token="ImageToken${String(i).padStart(12, '0')}"/>`).join('\n') });
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, many), 'FEISHU_TOO_MANY_IMAGES');
    assert.equal(many.calls.length, 1);
  });

  test('validates configured root and symlink ancestors before invoking the CLI', async t => {
    const { directory } = setup(t);
    const cli = cliMock();
    for (const outputRoot of ['relative/path', '/', os.homedir(), path.join(directory, '..', 'outside') + '/..', `${directory}\u0000evil`, null]) {
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'INVALID_OUTPUT_ROOT');
    }
    const target = path.join(directory, 'target');
    const link = path.join(directory, 'link');
    fs.mkdirSync(target);
    fs.symlinkSync(target, link);
    for (const outputRoot of [link, path.join(link, 'new-subdir')]) {
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cli), 'UNSAFE_OUTPUT_PATH');
    }
    assert.equal(cli.calls.length, 0);
    assert.deepEqual(fs.readdirSync(target), []);
  });

  test('never uses a remote title as a path; repeated and concurrent exports cannot overwrite earlier originals', async t => {
    const { outputRoot } = setup(t);
    const title = '../../用户原稿\u0000$(echo injected)';
    const results = await Promise.all(Array.from({ length: 3 }, (_, i) => exportFeishuDocument({ url: URL, outputRoot }, cliMock({ title, content: `第 ${i} 版` }))));
    assert.equal(new Set(results.map(result => result.bundleDir)).size, 3);
    results.forEach((result, i) => {
      assert.equal(path.dirname(result.bundleDir), outputRoot);
      assert.equal(path.basename(result.markdownPath), 'original.md');
      assert.equal(fs.readFileSync(result.markdownPath, 'utf8'), `第 ${i} 版`);
      assert.doesNotMatch(result.title, /\u0000/);
    });
  });

  test('enforces per-command and total timeout bounds and handles unavailable CLI safely', async t => {
    const { outputRoot } = setup(t);
    for (const deps of [{ timeoutMs: 0 }, { timeoutMs: 60001 }, { totalTimeoutMs: 300001 }, { totalTimeoutMs: NaN }, { cliPath: './relative-cli' }]) {
      await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, deps), 'INVALID_OPTIONS');
    }
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cliMock({ error: Object.assign(new Error('secret command'), { killed: true }) })), 'FEISHU_TIMEOUT');
    await rejectsCode(exportFeishuDocument({ url: URL, outputRoot }, cliMock({ error: Object.assign(new Error('secret command'), { code: 'ENOENT' }) })), 'FEISHU_CLI_UNAVAILABLE');
    const cli = cliMock({ content: `<img token="${IMAGE_A}"/>`, download: async ({ destination }) => {
      await new Promise(resolve => setTimeout(resolve, 30));
      fs.writeFileSync(destination, PNG);
    } });
    await exportFeishuDocument({ url: URL, outputRoot }, { ...cli, timeoutMs: 100, totalTimeoutMs: 200 });
    assert.ok(cli.calls.every(call => call.options.timeout <= 100));
  });

  test('real execFile runs a mock CLI with Unicode paths and verifies actual downloaded bytes', async t => {
    const { outputRoot } = setup(t);
    const calls = [];
    const deps = { cliPath: process.execPath, execFile(command, args, options, callback) {
      calls.push({ command, args, options });
      return execFile(command, [__filename, '--mock-cli', ...args], options, callback);
    } };
    const result = await exportFeishuDocument({ url: URL, outputRoot }, deps);
    assert.equal(result.markdown, '前\n![](assets/image-0001.png)\n后');
    assert.deepEqual(fs.readFileSync(result.assets[0].absolutePath), PNG);
    assert.equal(calls.length, 2);
    assert.ok(calls.every(call => call.options.shell === false));
  });

  test('real execFile kills a slow mock CLI and redacts failing subprocess stderr', async t => {
    const { outputRoot } = setup(t);
    const deps = { cliPath: process.execPath, execFile(command, args, options, callback) {
      return execFile(command, [__filename, '--mock-cli', ...args], options, callback);
    } };
    await rejectsCode(exportFeishuDocument({ url: URL.replace(DOCUMENT_ID, 'SlowDocument0123456789'), outputRoot }, { ...deps, timeoutMs: 150 }), 'FEISHU_TIMEOUT');
    await assert.rejects(exportFeishuDocument({ url: URL.replace(DOCUMENT_ID, 'ErrorDocument0123456789'), outputRoot }, deps), error => {
      assert.equal(error.code, 'FEISHU_MISSING_SCOPE');
      assert.doesNotMatch(error.stack, /TEST_CREDENTIAL_DO_NOT_EXPOSE/);
      return true;
    });
    assert.deepEqual(bundles(outputRoot), []);
  });
}
