const TOKEN_KEY = 'kb_token';

export const getToken = (): string | null => {
  try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
};
export const setToken = (token: string): void => {
  try { localStorage.setItem(TOKEN_KEY, token); } catch { /* storage unavailable */ }
};
export const clearToken = (): void => {
  try { localStorage.removeItem(TOKEN_KEY); } catch { /* storage unavailable */ }
};
