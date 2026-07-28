const port = Number(process.argv[2] || process.env.WEIBOT_DOUYIN_CDP_PORT || 9333)

let seq = 0
const pending = new Map()

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.douyin\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No page target found on port ${port}`)
  return page.webSocketDebuggerUrl
}

function connect(url) {
  const ws = new WebSocket(url)
  ws.addEventListener('message', event => {
    const payload = JSON.parse(String(event.data))
    if (!payload.id || !pending.has(payload.id)) return
    const item = pending.get(payload.id)
    pending.delete(payload.id)
    clearTimeout(item.timeout)
    if (payload.error) item.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
    else item.resolve(payload.result)
  })
  return new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve(ws), { once: true })
    ws.addEventListener('error', reject, { once: true })
  })
}

function send(ws, method, params = {}, timeoutMs = 30000) {
  const id = ++seq
  ws.send(JSON.stringify({ id, method, params }))
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    pending.set(id, { resolve, reject, timeout })
  })
}

async function evaluate(ws, expression) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

const ws = await connect(await getPageWebSocketUrl())
try {
  await send(ws, 'Runtime.enable')
  const state = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }

    const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
    const titleInput = leftForm.querySelector('input[placeholder*="文章标题"]');
    const summaryInput = leftForm.querySelector('input[placeholder*="摘要"], input[placeholder*="精彩"]');
    const editor = Array.from(leftForm.querySelectorAll('div.tiptap.ProseMirror[role="textbox"], div.tiptap.ProseMirror'))
      .filter(visible)
      .sort((a, b) => (b.getBoundingClientRect().width * b.getBoundingClientRect().height) - (a.getBoundingClientRect().width * a.getBoundingClientRect().height))[0];
    const publishButtons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim(),
          disabled: Boolean(el.disabled || el.getAttribute('aria-disabled') === 'true' || /disabled/.test(el.className || '')),
          className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter(item => item.text && /(发布|确定|确认|继续|知道了|暂存|离开)/.test(item.text));
    const visibleText = (document.body?.innerText || '').replace(/\\s+/g, ' ');
    const uploadHints = Array.from(leftForm.querySelectorAll('img, canvas, [style*="background-image"]'))
      .filter(visible)
      .map(el => {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          className: typeof el.className === 'string' ? el.className.slice(0, 120) : '',
          src: el.getAttribute('src') || '',
          style: el.getAttribute('style') || '',
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      })
      .filter(item => item.w >= 20 && item.h >= 20)
      .slice(0, 20);

    return {
      url: location.href,
      title: titleInput?.value || '',
      summary: summaryInput?.value || '',
      bodyText: (editor?.innerText || editor?.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 500),
      bodyLength: (editor?.innerText || editor?.textContent || '').trim().length,
      counters: Array.from(leftForm.querySelectorAll('div, span'))
        .filter(visible)
        .map(el => (el.textContent || '').replace(/\\s+/g, '').trim())
        .filter(text => /^\\d+\\/\\d+$/.test(text))
        .slice(0, 20),
      publishButtons,
      uploadHints,
      validationText: visibleText.match(/.{0,20}(请上传|请选择|不能为空|必填|失败|错误|审核|违规|封面|文章正文|文章标题).{0,80}/g) || [],
      tailText: visibleText.slice(-1000),
    };
  })()`)
  console.log(JSON.stringify(state, null, 2))
} finally {
  ws.close()
}
