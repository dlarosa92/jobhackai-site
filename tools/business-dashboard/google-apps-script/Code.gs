/** Read-only Gmail status sync. Configure Script Properties before running installGmailSync. */
function installGmailSync() {
  syncTrackedMail(); // Do not install a recurring job until configuration and the first upload work.
  var triggers = ScriptApp.getProjectTriggers().filter(function (trigger) { return trigger.getHandlerFunction() === 'syncTrackedMail'; });
  if (!triggers.length) ScriptApp.newTrigger('syncTrackedMail').timeBased().everyMinutes(5).create();
  triggers.slice(1).forEach(function (trigger) { ScriptApp.deleteTrigger(trigger); });
  console.log('Gmail sync installed. Runs approximately every five minutes.');
}

function syncTrackedMail() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var startedAt = new Date().toISOString();
    var properties = PropertiesService.getScriptProperties();
    var url = properties.getProperty('SYNC_URL') || '';
    var secret = properties.getProperty('SYNC_SECRET') || '';
    var expectedMailbox = properties.getProperty('MAILBOX_EMAIL') || '';
    var labelName = properties.getProperty('TRACK_LABEL_NAME') || '0: JobHackAI / Track';
    if (!/^https:\/\/[a-z0-9.-]+\/sync$/.test(url) || secret.length < 32 || !expectedMailbox) throw new Error('Configure SYNC_URL, SYNC_SECRET and MAILBOX_EMAIL in Script Properties.');
    var profile = Gmail.Users.getProfile('me');
    if (profile.emailAddress.toLowerCase() !== expectedMailbox.toLowerCase()) throw new Error('This script is authorized for a different Gmail account.');
    var labels = Gmail.Users.Labels.list('me').labels || [];
    var label = labels.find(function (entry) { return entry.name === labelName; });
    if (!label) throw new Error('Tracking label not found. Previous dashboard data has been preserved.');
    var threads = [];
    var pageToken;
    do {
      var page = Gmail.Users.Threads.list('me', { labelIds: [label.id], maxResults: 100, pageToken: pageToken });
      threads = threads.concat(page.threads || []);
      if (threads.length > 200) throw new Error('More than 200 tracked conversations. Previous dashboard data has been preserved.');
      pageToken = page.nextPageToken;
    } while (pageToken);
    var rows = threads.map(function (entry) {
      var thread = Gmail.Users.Threads.get('me', entry.id, { format: 'metadata', metadataHeaders: ['From', 'Subject'] });
      var messages = (thread.messages || []).filter(function (message) { return !(message.labelIds || []).includes('DRAFT'); });
      messages.sort(function (a, b) { return Number(b.internalDate) - Number(a.internalDate) || b.id.localeCompare(a.id); });
      if (!messages.length) return null;
      var latest = messages[0];
      function header(name) {
        var found = ((latest.payload || {}).headers || []).find(function (value) { return value.name.toLowerCase() === name.toLowerCase(); });
        return found ? found.value : '';
      }
      return {
        threadId: thread.id,
        lastMessageId: latest.id,
        sender: cleanSyncText(header('From'), 320),
        subject: cleanSyncText(header('Subject'), 300),
        preview: cleanSyncText(latest.snippet || '', 320),
        state: (latest.labelIds || []).includes('SENT') ? 'waiting' : 'needs_review',
        lastMessageAt: new Date(Number(latest.internalDate)).toISOString()
      };
    }).filter(Boolean);
    var payload = {
      schemaVersion: 1, syncId: Utilities.getUuid(), mailbox: profile.emailAddress.toLowerCase(), labelId: label.id,
      startedAt: startedAt, completedAt: new Date().toISOString(), threads: rows
    };
    var body = JSON.stringify(payload);
    var timestamp = String(Math.floor(Date.now() / 1000));
    var signature = Utilities.computeHmacSha256Signature(timestamp + '.' + body, secret, Utilities.Charset.UTF_8)
      .map(function (byte) { return ('0' + ((byte + 256) % 256).toString(16)).slice(-2); }).join('');
    var response = UrlFetchApp.fetch(url, {
      method: 'post', contentType: 'application/json', payload: body, followRedirects: false, muteHttpExceptions: true,
      headers: { 'X-Sync-Timestamp': timestamp, 'X-Sync-Signature': signature }
    });
    if (response.getResponseCode() !== 200) throw new Error('Dashboard sync rejected the snapshot (HTTP ' + response.getResponseCode() + '). Previous data has been preserved.');
    console.log('Gmail sync completed: ' + rows.length + ' tracked conversations.');
  } finally {
    lock.releaseLock();
  }
}

function cleanSyncText(value, limit) {
  return String(value).replace(/[\u0000-\u001f]/g, ' ').slice(0, limit);
}
