// Just enough DOM for the content script and the fallback page to run in tests.
export class FakeElement {
  constructor(tag) {
    this.tagName = tag;
    this.style = { cssText: '' };
    this.attributes = {};
    this.children = [];
    this.listeners = {};
    this.isConnected = false;
    this.focused = false;
    this.value = '';
  }
  setAttribute(k, v) { this.attributes[k] = v; }
  attachShadow(opts) {
    this.shadowMode = opts.mode;
    this.shadow = new FakeElement('#shadow-root');
    this.shadow.isConnected = true;
    return this.shadow;
  }
  appendChild(child) {
    this.children.push(child);
    child.parent = this;
    child.isConnected = this.isConnected;
    for (const c of child.children) c.isConnected = this.isConnected;
    return child;
  }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  focus() { this.focused = true; }
  remove() {
    if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this);
    this.isConnected = false;
    this.parent = null;
    this.focused = false;
  }
  /** Fire an event; returns the event so tests can inspect stopPropagation etc. */
  fire(type, props = {}) {
    const event = {
      type,
      key: '',
      isComposing: false,
      keyCode: 0,
      propagationStopped: false,
      defaultPrevented: false,
      stopPropagation() { this.propagationStopped = true; },
      preventDefault() { this.defaultPrevented = true; },
      ...props,
    };
    for (const fn of this.listeners[type] ?? []) fn(event);
    return event;
  }
  find(pred) {
    if (pred(this)) return this;
    for (const c of [...this.children, ...(this.shadow ? [this.shadow] : [])]) {
      const hit = c.find(pred);
      if (hit) return hit;
    }
    return null;
  }
}

export function makeDocument() {
  const body = new FakeElement('body');
  body.isConnected = true;
  const documentElement = new FakeElement('html');
  documentElement.isConnected = true;
  return {
    body,
    documentElement,
    createElement: (tag) => new FakeElement(tag),
    getElementById: (id) => body.find((e) => e.id === id),
  };
}
