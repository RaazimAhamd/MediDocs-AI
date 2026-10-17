// Prints the backend port from backend/.env (used by the .bat launchers).
import 'dotenv/config';
import { loadConfig } from '../src/config/index.js';

try {
  console.log(loadConfig().port);
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
