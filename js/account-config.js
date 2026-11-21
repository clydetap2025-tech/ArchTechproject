// On Vercel, build.mjs writes the endpoint from the public POCKETBASE_URL.
export const accountServer = ['localhost', '127.0.0.1'].includes(location.hostname)
  ? 'http://127.0.0.1:8090'
  : location.origin;
