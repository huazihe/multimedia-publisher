const port = Number(process.argv[2] || process.env.WEIBOT_DOUYIN_CDP_PORT || 30782)

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
  await send(ws, 'Page.enable').catch(() => undefined)
  await send(ws, 'Input.setIgnoreInputEvents', { ignore: false }).catch(() => undefined)

  const target = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
    const button = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(el => visible(el) && leftForm.contains(el))
      .find(el => (el.textContent || '').replace(/\\s+/g, '').trim() === '发布');
    if (!button) return { ok: false, error: 'publish button not found' };
    button.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = button.getBoundingClientRect();
    return {
      ok: true,
      text: (button.textContent || '').replace(/\\s+/g, '').trim(),
      disabled: Boolean(button.disabled || button.getAttribute('aria-disabled') === 'true' || /disabled/.test(button.className || '')),
      x: Math.round(rect.left + rect.width / 2),
      y: Math.round(rect.top + rect.height / 2),
    };
  })()`)

  if (!target.ok || target.disabled) {
    console.log(JSON.stringify({ target }, null, 2))
    process.exit(target.ok ? 2 : 1)
  }

  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.x, y: target.y }).catch(() => undefined)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.x, y: target.y, button: 'left', clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 5000))

  const state = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    const text = (document.body?.innerText || '').replace(/\\s+/g, ' ');
    const dialogs = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, [class*="modal"], [class*="Modal"], [class*="toast"], [class*="Toast"], [class*="message"], [class*="Message"]'))
      .filter(visible)
      .map(el => (el.textContent || '').replace(/\\s+/g, ' ').trim())
      .filter(Boolean)
      .slice(0, 20);
    const buttons = Array.from(document.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map(el => (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim())
      .filter(Boolean)
      .filter(text => /(确定|确认|发布|继续|知道了|取消|返回|查看|完成)/.test(text))
      .slice(0, 30);
    return {
      url: location.href,
      title: document.title,
      dialogs,
      buttons,
      hints: text.match(/.{0,30}(发布成功|发布中|审核|失败|错误|请|不能为空|封面|确认|确定|提交).{0,80}/g) || [],
      tailText: text.slice(-1200),
    };
  })()`)

  console.log(JSON.stringify({ target, state }, null, 2))
} finally {
  ws.close()
}
