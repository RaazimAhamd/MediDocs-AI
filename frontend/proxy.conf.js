// Dev proxy: the browser only ever talks to the Angular dev server; /api is forwarded to the Express backend.
// start.bat sets MEDIDOCS_API_PORT from backend/.env; the default matches backend/.env.example.
const port = process.env.MEDIDOCS_API_PORT || '3000';

module.exports = {
  '/api': {
    target: `http://127.0.0.1:${port}`,
    secure: false,
    changeOrigin: false,
    logLevel: 'warn',
  },
};
