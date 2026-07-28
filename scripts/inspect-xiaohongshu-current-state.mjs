const port = Number(process.argv[2] || process.env.WEIBOT_XIAOHONGSHU_CDP_PORT || process.env.WEIBOT_XHS_CDP_PORT || 57303)

let seq = 0
const pending = new Map()

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /creator\.xiaohongshu\.com/.test(target.url))
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
    function info(el) {
      const rect = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
        placeholder: el.getAttribute('placeholder') || '',
        value: el.value || '',
        className: typeof el.className === 'string' ? el.className.slice(0, 160) : '',
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
      };
    }
    const fields = Array.from(document.querySelectorAll('input, textarea, [contenteditable="true"], [role="textbox"], .ProseMirror, .ql-editor'))
      .filter(visible)
      .map(info)
      .slice(0, 60);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"], div, span'))
      .filter(visible)
      .map(info)
      .filter(item => item.text && /(发布|上传|图文|视频|保存|草稿|确认|确定|取消|下一步|我知道了)/.test(item.text))
      .slice(0, 120);
    const images = Array.from(document.querySelectorAll('img, canvas, [style*="background-image"]'))
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
      .slice(0, 40);
    const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
    return {
      url: location.href,
      title: document.title,
      fields,
      buttons,
      images,
      validationText: text.match(/.{0,30}(请|失败|错误|至少|图片|标题|正文|内容|发布成功|发布中|审核).{0,80}/g) || [],
      tailText: text.slice(-1500),
    };
  })()`)
  console.log(JSON.stringify(state, null, 2))
} finally {
  ws.close()
}
