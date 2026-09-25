import { AsyncLocalStorage } from 'node:async_hooks';

const tokenContext = new AsyncLocalStorage();

export function runWithOidcToken(token, callback) {
  return tokenContext.run(token, callback);
}

export function getRequestOidcToken() {
  return tokenContext.getStore();
}
