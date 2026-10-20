// Update server-owned markup in place. Keep edited form nodes, focus, selection,
// native file inputs and IME composition attached to the document.
export function updateLiveView(root, html) {
  const document = root.ownerDocument, template = document.createElement('template');
  template.innerHTML = html;
  const log = root.querySelector('#messages');
  const wasAtBottom = !log || log.scrollHeight - log.clientHeight - log.scrollTop < 80;
  const scroll = log?.scrollTop || 0;
  const key = node => node.nodeType === 1 ? node.id || node.getAttribute('data-message-id') || '' : '';
  function patch(parent, next) {
    let index = 0;
    while (index < next.childNodes.length || index < parent.childNodes.length) {
      const old = parent.childNodes[index], fresh = next.childNodes[index];
      if (!fresh) { old.remove(); continue; }
      if (!old) { parent.append(fresh.cloneNode(true)); index++; continue; }
      if (old.nodeType !== fresh.nodeType || old.nodeName !== fresh.nodeName || key(old) !== key(fresh)) {
        old.replaceWith(fresh.cloneNode(true)); index++; continue;
      }
      if (old.nodeType === 3) { if (old.data !== fresh.data) old.data = fresh.data; }
      else if (old.nodeType === 1) {
        if (old.tagName === 'FORM' && old.dataset.ticket === fresh.dataset.ticket && old.dataset.mode === fresh.dataset.mode &&
          (old.id === 'message-form' || old.dataset.edited || old.contains(document.activeElement))) { index++; continue; }
        for (const attribute of [...old.attributes]) if (!fresh.hasAttribute(attribute.name) && !(old.tagName === 'DETAILS' && attribute.name === 'open')) old.removeAttribute(attribute.name);
        for (const attribute of [...fresh.attributes]) if (old.getAttribute(attribute.name) !== attribute.value) old.setAttribute(attribute.name, attribute.value);
        patch(old, fresh);
      }
      index++;
    }
  }
  patch(root, template.content);
  const updated = root.querySelector('#messages');
  if (updated) updated.scrollTop = wasAtBottom ? updated.scrollHeight : scroll;
}
