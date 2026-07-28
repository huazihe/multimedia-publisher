const port = Number(process.argv[2] || process.env.WEIBOT_DOUYIN_CDP_PORT || 9333)
const imagePath = process.argv[3]
const targetUrl = 'https://creator.douyin.com/creator-micro/content/post/article?default-tab=5&enter_from=publish_page&media_type=article&type=new'

if (!imagePath) {
  console.error('Usage: node scripts/debug-douyin-upload.mjs <port> <image-path>')
  process.exit(1)
}

let seq = 0
const pending = new Map()
const listeners = new Map()

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
    if (payload.method) {
      for (const listener of listeners.get(payload.method) || []) listener(payload.params)
      return
    }
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

function waitForEvent(method, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    const listener = params => {
      clearTimeout(timeout)
      listeners.set(method, (listeners.get(method) || []).filter(item => item !== listener))
      resolve(params)
    }
    const timeout = setTimeout(() => {
      listeners.set(method, (listeners.get(method) || []).filter(item => item !== listener))
      reject(new Error(`${method} timed out`))
    }, timeoutMs)
    listeners.set(method, [...(listeners.get(method) || []), listener])
  })
}

async function evaluate(ws, expression, timeout = 30000) {
  const result = await send(ws, 'Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    timeout,
  }, timeout + 2000)
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || 'Runtime.evaluate failed')
  }
  return result.result?.value
}

async function waitForReady(ws) {
  const start = Date.now()
  while (Date.now() - start < 45000) {
    const ready = await evaluate(ws, `document.readyState === 'complete' || document.readyState === 'interactive'`).catch(() => false)
    if (ready) return
    await new Promise(resolve => setTimeout(resolve, 500))
  }
}

async function clickUpload(ws, label) {
  await send(ws, 'Page.setInterceptFileChooserDialog', { enabled: true }).catch(() => undefined)
  const target = await evaluate(ws, `(() => {
    const label = ${JSON.stringify(label)};
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    const leftForm = document.querySelector('.content-left-F3wKrk') || document.body;
    const items = Array.from(document.querySelectorAll('button, [role="button"], a, span, div'))
      .filter(el => visible(el) && leftForm.contains(el))
      .map(el => ({
        el,
        text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(),
        isButton: el.matches('button, [role="button"], a'),
        area: el.getBoundingClientRect().width * el.getBoundingClientRect().height,
        rect: Array.from({ length: 1 }, () => {
          const rect = el.getBoundingClientRect();
          return { x: Math.round(rect.left), y: Math.round(rect.top), w: Math.round(rect.width), h: Math.round(rect.height) };
        })[0]
      }))
      .filter(item => item.text && item.text.length <= 100 && item.text.includes(label))
      .sort((a, b) => {
        const buttonScore = Number(b.isButton) - Number(a.isButton);
        if (buttonScore) return buttonScore;
        return a.area - b.area;
      });
    const item = items[0];
    if (!item) return { ok: false, error: 'upload target not found', label };
    const target = item.isButton ? item.el : item.el.closest('button, [role="button"], a') || item.el;
    target.scrollIntoView({ block: 'center', inline: 'center' });
    const rect = target.getBoundingClientRect();
    return {
      ok: true,
      label,
      text: item.text,
      rect: item.rect,
      click: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
    };
  })()`)

  if (!target.ok || !target.click) {
    await send(ws, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
    return { target, chooser: { error: 'no click target' } }
  }

  const chooserPromise = waitForEvent('Page.fileChooserOpened', 10000).catch(error => ({ error: error.message }))
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: target.click.x, y: target.click.y }).catch(() => undefined)
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: target.click.x, y: target.click.y, button: 'left', clickCount: 1 })
  await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: target.click.x, y: target.click.y, button: 'left', clickCount: 1 })
  const chooser = await chooserPromise
  if (chooser.error || !chooser.backendNodeId) {
    await send(ws, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
    return { target, chooser }
  }

  await send(ws, 'DOM.setFileInputFiles', { backendNodeId: chooser.backendNodeId, files: [imagePath] }, 30000)
  await send(ws, 'Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => undefined)
  await new Promise(resolve => setTimeout(resolve, 2500))

  const confirm = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
    const modal = Array.from(document.querySelectorAll('[role="dialog"], .semi-modal, [class*="modal"], [class*="Modal"], [class*="crop"], [class*="Crop"]'))
      .filter(visible)
      .find(el => /(裁剪|封面|图片|上传|预览|确定|完成|保存)/.test(el.textContent || ''));
    if (!modal) return { clicked: false };
    const buttons = Array.from(modal.querySelectorAll('button, [role="button"]'))
      .filter(visible)
      .map(el => ({ el, text: (el.textContent || el.getAttribute('aria-label') || '').replace(/\\s+/g, '').trim() }))
      .filter(item => item.text);
    const target = buttons.find(item => /^(确定|完成|保存|应用)$/.test(item.text))
      || buttons.find(item => /(确定|完成|保存|应用)/.test(item.text));
    if (!target) return { clicked: false, buttons: buttons.map(item => item.text) };
    target.el.click();
    return { clicked: true, text: target.text };
  })()`).catch(error => ({ error: error.message }))
  await new Promise(resolve => setTimeout(resolve, 6000))
  return { target, chooser: { backendNodeId: chooser.backendNodeId, mode: chooser.mode }, confirm }
}

const ws = await connect(await getPageWebSocketUrl())
try {
  await send(ws, 'Runtime.enable')
  await send(ws, 'Page.enable')
  await send(ws, 'DOM.enable').catch(() => undefined)
  await send(ws, 'Page.navigate', { url: targetUrl })
  await waitForReady(ws)
  await new Promise(resolve => setTimeout(resolve, 5000))

  const first = await clickUpload(ws, '点击上传图片')
  const second = await clickUpload(ws, '点击上传封面图')
  const state = await evaluate(ws, `(() => {
    function visible(el) {
      if (!(el instanceof HTMLElement)) return false;
      const style = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0;
    }
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
      .slice(0, 30);
    return {
      url: location.href,
      text: (document.body?.innerText || '').replace(/\\s+/g, ' ').slice(0, 1500),
      images,
    };
  })()`)

  console.log(JSON.stringify({ imagePath, first, second, state }, null, 2))
} finally {
  ws.close()
}
