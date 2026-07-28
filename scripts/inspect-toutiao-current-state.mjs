const port = Number(process.argv[2] || process.env.WEIBOT_TOUTIAO_CDP_PORT || 28009)

let seq = 0
const pending = new Map()

async function getPageWebSocketUrl() {
  const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json())
  const page = targets.find(target => target.type === 'page' && /mp\.toutiao\.com/.test(target.url))
    || targets.find(target => target.type === 'page')
  if (!page?.webSocketDebuggerUrl) throw new Error(`No Toutiao page target found on port ${port}`)
  return page.webSocketDebuggerUrl
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

const ws = new WebSocket(await getPageWebSocketUrl())
ws.addEventListener('message', event => {
  const payload = JSON.parse(String(event.data))
  if (!payload.id || !pending.has(payload.id)) return
  const item = pending.get(payload.id)
  pending.delete(payload.id)
  clearTimeout(item.timeout)
  if (payload.error) item.reject(new Error(payload.error.message || JSON.stringify(payload.error)))
  else item.resolve(payload.result)
})

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true })
  ws.addEventListener('error', reject, { once: true })
})

try {
  await send(ws, 'Runtime.enable')
  const result = await send(ws, 'Runtime.evaluate', {
    expression: `(() => {
      function visible(el) {
        if (!(el instanceof HTMLElement)) return false;
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      }
      function hint(el) {
        return [
          el.getAttribute("placeholder") || "",
          el.getAttribute("aria-label") || "",
          el.getAttribute("role") || "",
          typeof el.className === "string" ? el.className : "",
          el.textContent || "",
          el.parentElement?.textContent || ""
        ].join(" ").replace(/\\s+/g, " ").slice(0, 500);
      }
      function info(el) {
        const rect = el.getBoundingClientRect();
        return {
          tag: el.tagName.toLowerCase(),
          text: (el.textContent || el.getAttribute("aria-label") || "").replace(/\\s+/g, " ").trim().slice(0, 180),
          placeholder: el.getAttribute("placeholder") || "",
          value: el.value || "",
          className: typeof el.className === "string" ? el.className.slice(0, 180) : "",
          role: el.getAttribute("role") || "",
          contenteditable: el.getAttribute("contenteditable") || "",
          hint: hint(el),
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
        };
      }
      const fields = Array.from(document.querySelectorAll("input, textarea, [contenteditable=true], [role=textbox], .ProseMirror, .DraftEditor-root, .public-DraftEditor-content, .byte-editor, .editor, iframe"))
        .filter(visible)
        .map(info)
        .slice(0, 120);
      const buttons = Array.from(document.querySelectorAll("button, [role=button], a, div, span"))
        .filter(visible)
        .map(info)
        .filter(item => item.text && /(发布|保存|草稿|预览|确认|确定|取消|封面|原创|声明|下一步|我知道了|创作助手|AI)/.test(item.text + item.hint))
        .slice(0, 180);
      const text = (document.body?.innerText || "").replace(/\\s+/g, " ");
      return {
        url: location.href,
        title: document.title,
        fields,
        buttons,
        validationText: text.match(/.{0,30}(失败|错误|至少|图片|标题|正文|内容|发布成功|发布中|审核|创作助手).{0,80}/g) || [],
        tailText: text.slice(-1800)
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log(JSON.stringify(result.result?.value, null, 2))
} finally {
  ws.close()
}
