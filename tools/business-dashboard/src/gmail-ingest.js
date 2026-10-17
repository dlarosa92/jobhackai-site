import { receiveGmailSync } from './gmail-sync.js';

export default { fetch(request, env) { return receiveGmailSync(request, env); } };
