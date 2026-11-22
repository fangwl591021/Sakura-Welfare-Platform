function vendorContentRuntime() {
  const commands = [
    ['formatBlock', '標題', 'H2'], ['bold', '粗體', 'B'], ['italic', '斜體', 'I'],
    ['insertUnorderedList', '項目', '•'], ['insertOrderedList', '編號', '1.'],
    ['createLink', '連結', '↗'], ['removeFormat', '清除格式', 'Tx'],
  ];
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  function sanitize(value) {
    const source = String(value ?? '');
    const html = /<\/?[a-z][\s\S]*>/i.test(source) ? source : escape(source).replace(/\r\n|\r|\n/g, '<br>');
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    const allowed = new Set(['P', 'DIV', 'BR', 'H2', 'H3', 'B', 'STRONG', 'I', 'EM', 'U', 'UL', 'OL', 'LI', 'A']);
    function clean(node) {
      if (node.nodeType === Node.TEXT_NODE) return document.createTextNode(node.nodeValue || '');
      if (node.nodeType !== Node.ELEMENT_NODE || ['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'SVG', 'MATH'].includes(node.tagName)) return document.createDocumentFragment();
      const target = allowed.has(node.tagName) ? document.createElement(node.tagName.toLowerCase()) : document.createDocumentFragment();
      if (node.tagName === 'A') {
        const href = (node.getAttribute('href') || '').trim();
        if (/^(https?:|mailto:|tel:)/i.test(href)) {
          target.setAttribute('href', href);
          target.setAttribute('target', '_blank');
          target.setAttribute('rel', 'noopener noreferrer');
        }
      }
      for (const child of node.childNodes) target.appendChild(clean(child));
      return target;
    }
    const result = document.createElement('div');
    for (const child of parsed.body.childNodes) result.appendChild(clean(child));
    return result.innerHTML;
  }
  function sync(root = document) {
    root.querySelectorAll('[data-vendor-content]').forEach(field => {
      const value = field.querySelector('textarea');
      const editor = field.querySelector('[data-rich-editor]');
      if (value && editor) value.value = sanitize(editor.innerHTML);
    });
  }
  function set(value, content) {
    value.value = content ?? '';
    const editor = value.closest('[data-vendor-content]')?.querySelector('[data-rich-editor]');
    if (editor) editor.innerHTML = sanitize(value.value);
  }
  function mount(root = document) {
    root.querySelectorAll('[data-vendor-content]').forEach(field => {
      if (field.querySelector('[data-rich-editor]')) return;
      const value = field.querySelector('textarea');
      if (!value) return;
      const toolbar = document.createElement('div');
      toolbar.className = 'vendor-content-toolbar';
      if (value.dataset.toolbarId) toolbar.id = value.dataset.toolbarId;
      const editor = document.createElement('div');
      editor.className = 'vendor-content-editor';
      editor.id = value.dataset.editorId || 'vendor-content-' + value.name;
      editor.contentEditable = 'true';
      editor.dataset.richEditor = '';
      editor.setAttribute('role', 'textbox');
      editor.setAttribute('aria-multiline', 'true');
      editor.setAttribute('aria-required', String(value.required));
      const label = field.querySelector('label');
      if (label) { label.id ||= editor.id + '-label'; editor.setAttribute('aria-labelledby', label.id); }
      for (const [command, label, symbol] of commands) {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.richCommand = command;
        button.title = label;
        button.setAttribute('aria-label', label);
        button.textContent = symbol;
        button.onmousedown = event => event.preventDefault();
        button.onclick = () => {
          editor.focus();
          let argument = command === 'formatBlock' ? 'h2' : null;
          if (command === 'createLink') {
            const selection = window.getSelection();
            const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
            argument = prompt('請輸入完整網址（https://...）', 'https://');
            if (!argument) return;
            if (!/^https?:\/\//i.test(argument)) return alert('連結必須以 http:// 或 https:// 開頭');
            editor.focus();
            if (range && editor.contains(range.commonAncestorContainer)) { selection.removeAllRanges(); selection.addRange(range); }
          }
          document.execCommand(command, false, argument);
          editor.dispatchEvent(new Event('input', { bubbles: true }));
        };
        toolbar.append(button);
      }
      editor.oninput = () => { sync(field.parentElement); value.dispatchEvent(new Event('input', { bubbles: true })); };
      editor.onpaste = event => {
        event.preventDefault();
        document.execCommand('insertText', false, event.clipboardData.getData('text/plain'));
        editor.dispatchEvent(new Event('input', { bubbles: true }));
      };
      value.hidden = true;
      value.before(toolbar, editor);
      set(value, value.value);
    });
  }
  function markup(name, label, content) {
    return '<div class="field full" data-vendor-content="' + escape(name) + '"><label>' + escape(label) + '</label><textarea name="' + escape(name) + '">' + escape(content) + '</textarea></div>';
  }
  window.SakuraVendorContent = { mount, sync, set, sanitize, markup };
}

export function decorateVendorContentHtml(html) {
  const styles = `<style>
    [data-vendor-content]{min-width:0}
    .vendor-content-toolbar{display:flex;flex-wrap:wrap;gap:6px;padding:8px;border:1px solid #cfd8e6;border-bottom:0;border-radius:8px 8px 0 0;background:#f8fafc}
    .vendor-content-toolbar button{font:inherit;min-width:38px;height:38px;padding:0 10px;border:1px solid #cfd8e6;border-radius:6px;background:#fff;color:#17212b;cursor:pointer}
    .vendor-content-toolbar button[data-rich-command=bold]{font-weight:800}
    .vendor-content-toolbar button[data-rich-command=italic]{font-style:italic}
    .vendor-content-editor{min-height:150px;padding:12px;border:1px solid #cfd8e6;border-radius:0 0 8px 8px;background:#fff;line-height:1.65;overflow-wrap:anywhere}
    .vendor-content-editor:focus{outline:2px solid #2563eb;outline-offset:1px}
    .vendor-content-editor[aria-invalid=true]{border:2px solid #b91c1c;background:#fff7f7}
    .vendor-content-editor h2,.vendor-content-editor h3{font-size:18px;margin:8px 0}
    .vendor-content-editor p{margin:6px 0}
  </style>`;
  return html.replace('</head>', styles + '<script>(()=>{const __name=target=>target;(' + vendorContentRuntime.toString() + ')();})();</script></head>');
}
