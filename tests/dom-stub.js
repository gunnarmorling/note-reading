// Just enough of a document for `staff.js` to build SVG outside a browser.
//
// Deliberately tiny, and it can stay tiny: none of the modules touch a browser
// API when they are imported — every reference to `document` is inside a
// function — so the only thing the assertions need is an element that accepts
// attributes, children and text. Anything beyond that belongs in
// tests/browser-stub.js, which is a much bigger fiction and is only used for
// booting the whole app.

class StubElement {
  constructor(tag) {
    this.tagName = tag;
    this.attributes = {};
    this.childNodes = [];
    this.textContent = "";
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  getAttribute(name) {
    return name in this.attributes ? this.attributes[name] : null;
  }

  appendChild(node) {
    this.childNodes.push(node);
    return node;
  }

  replaceChildren(...nodes) {
    this.childNodes = nodes;
  }

  get children() {
    return this.childNodes;
  }
}

/** Install the stub as a global, if the host has no document of its own. */
export function install(target = globalThis) {
  if (target.document) return target.document;
  target.document = {
    createElement: (tag) => new StubElement(tag),
    createElementNS: (_ns, tag) => new StubElement(tag),
  };
  return target.document;
}

export { StubElement };
