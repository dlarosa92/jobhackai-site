/** Guarded outreach. Read checks use existing gmail.readonly permission.
 * Sending additionally needs the separately reviewed sender manifest and BOTH
 * the server flag and OUTREACH_SEND_ENABLED Script Property. Never enable by default.
 */
function outreachPollWork() {
  return outreachRequest({action:'poll',canSend:PropertiesService.getScriptProperties().getProperty('OUTREACH_SEND_ENABLED') === 'true'});
}
function syncOutreach(work) {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('OUTREACH_CHECKS_ENABLED') !== 'true') return;
  var canSend = props.getProperty('OUTREACH_SEND_ENABLED') === 'true';
  work = work || outreachPollWork();
  // Recover lost receipts by looking for the reserved transport Message-ID.
  // There is deliberately no re-send path for a reserved or uncertain attempt.
  (work.reconcile || []).forEach(function (attempt) {
    var key='OUTREACH_RECEIPT_'+attempt.attempt_id, saved=props.getProperty(key), accepted=saved?JSON.parse(saved):null;
    if(accepted && (!/^[a-f0-9]{1,64}$/.test(accepted.id||'') || !/^[a-f0-9]{1,64}$/.test(accepted.threadId||''))) throw new Error('Invalid saved provider receipt; manual reconciliation required.');
    var found = accepted ? [accepted] : outreachList('in:sent rfc822msgid:outreach.' + attempt.attempt_id + '@jobhackai.io');
    if (found.length !== 1) return;
    var message = Gmail.Users.Messages.get('me', found[0].id, { format: 'full' });
    if (!outreachVerifiedSent(message, attempt.packet.message, attempt.attempt_id, props.getProperty('MAILBOX_EMAIL'),accepted)) return;
    outreachRequest({action:'receipt',id:attempt.id,revision:attempt.revision,attemptId:attempt.attempt_id,outcome:'sent',messageId:message.id,threadId:message.threadId});
    props.deleteProperty(key);
    outreachLabelSent(message.threadId);
  });
  outreachDeliveryScan();
  (work.messages || []).forEach(function (entry) {
    var history;
    try { history = outreachHistory(entry.packet); }
    catch (error) {
      // A failing or oversized scan must not reuse yesterday's clean result.
      history = {complete:false,scope:'all-folders-all-history',checkedAt:new Date().toISOString(),sent:[],received:[],drafts:[],failures:[]};
    }
    var checked = outreachRequest({action:'check',id:entry.id,revision:entry.revision,history:history});
    if (!entry.queued || !canSend || !work.sendingEnabled || checked.issues.length) return;
    // Do not reuse the periodic check when another check/send took time.
    var immediate = outreachHistory(entry.packet);
    var ready = outreachRequest({action:'check',id:entry.id,revision:entry.revision,history:immediate});
    if (ready.issues.length) return;
    var claim = outreachRequest({action:'claim',id:entry.id,revision:entry.revision});
    if (!claim.attemptId || Date.parse(claim.expiresAt) <= Date.now()) throw new Error('Send reservation expired; no send attempted.');
    var outgoing = claim.packet.message;
    // MIME is generated from the immutable approved packet, never from an editable
    // Gmail draft. No cc/bcc/attachments or arbitrary extra headers are accepted.
    var formatApproved=!!claim.formatApproval && claim.formatApproval.id===entry.id && claim.formatApproval.revision===entry.revision;
    var raw = outreachMime(outgoing, claim.attemptId, props.getProperty('MAILBOX_EMAIL'),formatApproved);
    var result;
    try {
      var payload = { raw: raw };
      if (outgoing.threadId) payload.threadId = outgoing.threadId;
      result = Gmail.Users.Messages.send(payload, 'me');
      if(!/^[a-f0-9]{1,64}$/.test(result.id||'') || !/^[a-f0-9]{1,64}$/.test(result.threadId||'')) throw new Error('Missing provider send receipt.');
      // Persist the provider-returned IDs before reading Gmail or uploading the
      // receipt. Gmail may replace Message-ID; a lost upload must never resend.
      props.setProperty('OUTREACH_RECEIPT_'+claim.attemptId,JSON.stringify({id:result.id,threadId:result.threadId}));
      var nativeSent = Gmail.Users.Messages.get('me', result.id, {format:'full'});
      if (!outreachVerifiedSent(nativeSent, outgoing, claim.attemptId, props.getProperty('MAILBOX_EMAIL'),result)) throw new Error('Native Sent copy does not match the approved message.');
      result = nativeSent;
    } catch (error) {
      // The provider may have accepted a request before a timeout. Hold it; never
      // retry. A later read-only Message-ID reconciliation can confirm success.
      outreachRequest({action:'receipt',id:entry.id,revision:entry.revision,attemptId:claim.attemptId,outcome:'uncertain'});
      throw new Error('Send result requires Gmail reconciliation. Automatic retry is disabled.');
    }
    // If this upload fails, the record stays reserved. The next run reconciles it.
    outreachRequest({action:'receipt',id:entry.id,revision:entry.revision,attemptId:claim.attemptId,outcome:'sent',messageId:result.id,threadId:result.threadId});
    props.deleteProperty('OUTREACH_RECEIPT_'+claim.attemptId);
    outreachLabelSent(result.threadId);
  });
}

function outreachVerifiedSent(message, approved, attemptId, mailbox, accepted) {
  // A native read must match either the unique requested Message-ID or the
  // exact ID/thread pair returned by this reserved send, never copy alone.
  var identity=accepted ? /^[a-f0-9]{1,64}$/.test(accepted.id||'') && /^[a-f0-9]{1,64}$/.test(accepted.threadId||'') && message.id===accepted.id && message.threadId===accepted.threadId : outreachHeader(message,'Message-ID')==='<outreach.'+attemptId+'@jobhackai.io>';
  if ((message.labelIds||[]).indexOf('SENT')<0 || outreachAddress(outreachHeader(message,'From'))!==mailbox.toLowerCase() ||
    outreachAddress(outreachHeader(message,'To'))!==approved.recipient || outreachHeader(message,'Cc') || outreachHeader(message,'Bcc') ||
    outreachHeader(message,'Subject')!==approved.subject || !identity) return false;
  var plain=[],html=[],unsupported=false;
  function visit(part) {
    if(part.filename || (part.body&&part.body.attachmentId)) unsupported=true;
    if(part.mimeType==='text/plain')plain.push(outreachBody({body:part.body}));
    else if(part.mimeType==='text/html')html.push(outreachBody({body:part.body}));
    else if(!(part.parts||[]).length)unsupported=true;
    (part.parts||[]).forEach(visit);
  }
  visit(message.payload||{});
  return !unsupported && plain.length===1 && plain[0].replace(/\r\n/g,'\n')===approved.text &&
    (approved.html ? html.length===1 && html[0].replace(/\r\n/g,'\n')===approved.html : html.length===0) &&
    (!approved.threadId || message.threadId===approved.threadId) && outreachHeader(message,'In-Reply-To')===(approved.inReplyTo||'');
}

function outreachLabelSent(threadId) {
  if(PropertiesService.getScriptProperties().getProperty('OUTREACH_LABELS_ENABLED')!=='true')return;
  try {
    var thread=Gmail.Users.Threads.get('me',threadId,{format:'metadata',metadataHeaders:['From','Subject']});
    outreachLabelThread(thread,Gmail.Users.Labels.list('me').labels||[]);
  } catch(error) { console.warn('Outreach label update failed; verified send is retained and the next sync will retry labels only.'); }
}
function outreachLabelThread(thread, labels) {
  var props=PropertiesService.getScriptProperties();
  if(props.getProperty('OUTREACH_LABELS_ENABLED')!=='true')return;
  try {
    var messages=(thread.messages||[]).filter(function(m){return (m.labelIds||[]).indexOf('DRAFT')<0;});
    messages.sort(function(a,b){return Number(b.internalDate)-Number(a.internalDate)||b.id.localeCompare(a.id);});
    if(!messages.length)return;
    var names=[props.getProperty('TRACK_LABEL_NAME')||'0: JobHackAI / Track','1: To respond','6: Awaiting reply'];
    var ids=names.map(function(name){var label=labels.find(function(l){return l.name===name;});if(!label)throw new Error('Required workflow label missing.');return label.id;});
    var waiting=(messages[0].labelIds||[]).indexOf('SENT')>=0, desired=[ids[0],waiting?ids[2]:ids[1]], other=waiting?ids[1]:ids[2];
    if(messages.every(function(m){var current=m.labelIds||[];return desired.every(function(id){return current.indexOf(id)>=0;})&&current.indexOf(other)<0;}))return;
    // Only these three user labels are changed. Inbox, unread, importance,
    // handled labels and unrelated labels are preserved.
    Gmail.Users.Threads.modify({addLabelIds:desired,removeLabelIds:[other]},'me',thread.id);
  } catch(error) { console.warn('Outreach label update failed; conversation metadata is retained. Check Gmail label authorization/configuration.'); }
}

function outreachRequest(input) {
  var props=PropertiesService.getScriptProperties();
  var syncUrl=props.getProperty('SYNC_URL')||'';
  var secret=props.getProperty('SYNC_SECRET')||'';
  var mailbox=props.getProperty('MAILBOX_EMAIL')||'';
  if(!/^https:\/\/[a-z0-9.-]+\/sync$/.test(syncUrl)||secret.length<32||!mailbox)throw new Error('Outreach relay configuration unavailable.');
  input.mailbox=mailbox.toLowerCase();
  if(Gmail.Users.getProfile('me').emailAddress.toLowerCase()!==input.mailbox)throw new Error('Wrong Gmail account.');
  var body=JSON.stringify(input),timestamp=String(Math.floor(Date.now()/1000));
  var signature=Utilities.computeHmacSha256Signature(timestamp+'.'+body,secret,Utilities.Charset.UTF_8).map(function(b){return('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
  var response=UrlFetchApp.fetch(syncUrl.replace(/\/sync$/,'/outreach'),{method:'post',contentType:'application/json',payload:body,followRedirects:false,muteHttpExceptions:true,headers:{'X-Sync-Timestamp':timestamp,'X-Sync-Signature':signature}});
  if(response.getResponseCode()!==200)throw new Error('Outreach gate refused the request (HTTP '+response.getResponseCode()+'). Nothing may be retried automatically.');
  return JSON.parse(response.getContentText());
}
function outreachList(query) {
  var messages=[],pageToken;
  do {
    var page=Gmail.Users.Messages.list('me',{q:query,includeSpamTrash:true,maxResults:100,pageToken:pageToken});
    messages=messages.concat(page.messages||[]);
    if(messages.length>200)throw new Error('Gmail history exceeds this bounded check; hold for individual review.');
    pageToken=page.nextPageToken;
  } while(pageToken);
  return messages;
}
function outreachHeader(message,name) {
  var value=((message.payload||{}).headers||[]).find(function(h){return h.name.toLowerCase()===name.toLowerCase();});
  return value?value.value:'';
}
function outreachAddress(value) {
  var found=String(value).match(/[a-z0-9.!#$%&'*+\/=?^_`{|}~-]+@(?:[a-z0-9-]+\.)+[a-z]{2,63}/ig)||[];
  return found.length===1?found[0].toLowerCase():'';
}
function outreachBody(part) {
  var text='';
  if(part.body&&part.body.data){
    var raw=part.body.data;
    // Advanced Gmail exposes byte fields as signed byte arrays; the REST
    // representation is a base64url string. Handle each representation once.
    if(typeof raw==='object'&&typeof raw.length==='number'){
      var bytes=Array.from(raw);
      if(bytes.some(function(value){return !Number.isInteger(value)||value< -128||value>255;}))throw new Error('Invalid Gmail MIME bytes; hold for review.');
      text=Utilities.newBlob(bytes).getDataAsString('UTF-8');
    }else if(typeof raw==='string'){
      var data=raw.replace(/\s/g,'').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
      if(!/^[A-Za-z0-9_-]*$/.test(data)||data.length%4===1)throw new Error('Invalid Gmail MIME encoding; hold for review.');
      data+='='.repeat((4-data.length%4)%4);
      text=Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
    }else throw new Error('Unsupported Gmail MIME representation; hold for review.');
  }
  (part.parts||[]).forEach(function(child){text+='\n'+outreachBody(child);});
  if(text.length>200000)throw new Error('Delivery evidence exceeds the bounded read; review manually.');
  return text;
}
function outreachIsFailure(message) {
  return /mailer-daemon|postmaster|mail delivery subsystem/i.test(outreachHeader(message,'From'))||/delivery status notification|undeliverable|delivery failed|delivery failure/i.test(outreachHeader(message,'Subject'));
}
function outreachFailureKind(text) {
  // A forwarding failure is a route hold, not proof that the original mailbox
  // does not exist. Keep the native report for human review.
  return !/forward/i.test(text)&&/(?:Status:\s*5\.1\.1|550[ -]+5\.1\.1)/i.test(text)?'hard_bounce':'delivery_failure_review';
}
function outreachHistory(packet) {
  var target=packet.message.recipient.toLowerCase(),domain=packet.businessKey;
  var query='in:anywhere {from:'+target+' to:'+target+' "'+target+'" from:'+domain+' to:'+domain+'}';
  var ids=outreachList(query),sent=[],received=[],drafts=[],failures=[];
  ids.forEach(function(entry){
    var message=Gmail.Users.Messages.get('me',entry.id,{format:'full'});
    var labels=message.labelIds||[],from=outreachAddress(outreachHeader(message,'From'));
    var recipients=(outreachHeader(message,'To')+' '+outreachHeader(message,'Cc')+' '+outreachHeader(message,'Bcc')).toLowerCase();
    var direct=recipients.indexOf(target)>=0||recipients.indexOf('@'+domain)>=0;
    var evidence={messageId:message.id,threadId:message.threadId};
    if(outreachIsFailure(message)) {
      var text=outreachBody(message.payload||{});
      // A matching but unparseable DSN is a hold, never a clean-history result.
      failures.push({messageId:message.id,kind:outreachFailureKind(text)});
      return;
    }
    if(labels.indexOf('DRAFT')>=0){if(direct)drafts.push(evidence);return;}
    if(labels.indexOf('SENT')>=0&&direct){sent.push({messageId:message.id,threadId:message.threadId,rfcMessageId:outreachHeader(message,'Message-ID'),sentAt:new Date(Number(message.internalDate)).toISOString()});return;}
    if(from===target||from.endsWith('@'+domain))received.push(evidence);
  });
  return {complete:true,scope:'all-folders-all-history',checkedAt:new Date().toISOString(),sent:sent,received:received,drafts:drafts,failures:failures};
}
function outreachDeliveryScan() {
  // Failures are often outside the original thread and can be in Spam/Trash.
  var after=new Date(Date.now()-60*86400000).toISOString().slice(0,10).replace(/-/g,'/');
  outreachList('in:anywhere after:'+after+' {from:mailer-daemon from:postmaster subject:"Delivery Status Notification" subject:Undeliverable}').forEach(function(entry){
    var message=Gmail.Users.Messages.get('me',entry.id,{format:'full'});
    if(!outreachIsFailure(message))return;
    var text=outreachBody(message.payload||{}),matches=Array.from(text.matchAll(/(?:Final-Recipient|Original-Recipient):\s*rfc822;\s*([^\s<>;]+)/ig));
    var seen={};
    matches.forEach(function(match){var address=outreachAddress(match[1]);if(!address||seen[address])return;seen[address]=true;outreachRequest({action:'delivery',recipient:address,reason:outreachFailureKind(text),messageId:message.id});});
  });
}
function outreachMime(message,attemptId,mailbox,formatApproved) {
  if(message.html && formatApproved!==true)throw new Error('HTML requires the server-confirmed owner format decision for this exact email.');
  if(!/^[a-f0-9-]{36}$/.test(attemptId)||!outreachAddress(mailbox)||outreachAddress(message.recipient)!==message.recipient||/[\r\n]/.test(message.subject+message.inReplyTo+message.references))throw new Error('Invalid approved envelope.');
  // Each encoded word stays within RFC 2047's 75-character limit. Chunk by
  // Unicode code points, so neither UTF-8 bytes nor surrogate pairs are split.
  var subject=Array.from(message.subject),words=[];
  while(subject.length)words.push('=?UTF-8?B?'+Utilities.base64Encode(subject.splice(0,10).join(''),Utilities.Charset.UTF_8)+'?=');
  var headers=['From: '+mailbox,'To: '+message.recipient,'Subject: '+words.join('\r\n '),'Message-ID: <outreach.'+attemptId+'@jobhackai.io>','MIME-Version: 1.0'];
  if(message.inReplyTo)headers.push('In-Reply-To: '+message.inReplyTo);
  if(message.references)headers.push('References: '+message.references);
  var body;
  function encoded(value){return Utilities.base64Encode(value,Utilities.Charset.UTF_8).match(/.{1,76}/g).join('\r\n');}
  if(message.html){
    var boundary='outreach_'+attemptId.replace(/-/g,'');
    headers.push('Content-Type: multipart/alternative; boundary="'+boundary+'"');
    body='--'+boundary+'\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+encoded(message.text)+'\r\n--'+boundary+'\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n'+encoded(message.html)+'\r\n--'+boundary+'--\r\n';
  }else{headers.push('Content-Type: text/plain; charset=UTF-8','Content-Transfer-Encoding: base64');body=encoded(message.text);}
  return Utilities.base64EncodeWebSafe(headers.join('\r\n')+'\r\n\r\n'+body,Utilities.Charset.UTF_8).replace(/=+$/,'');
}
