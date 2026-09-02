import { createApp } from './app.js';
import { loadEnv } from './config/env.js';

const config = loadEnv();
const app = createApp({ config });

app.listen(config.port, () => {
  console.log(`GRE backend listening on port ${config.port}`);
});
