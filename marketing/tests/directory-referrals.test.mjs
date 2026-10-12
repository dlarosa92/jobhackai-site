import test from 'node:test';
import assert from 'node:assert/strict';
import {providerReferralUrl} from '../scripts/provider-referrals.mjs';
test('provider referrals preserve destination, query, fragment and existing campaign tags',()=>{
 const u=new URL(providerReferralUrl('https://example.com/quote?service=ev#start','ev-charger-installation','example','website'));
 assert.equal(u.pathname,'/quote'); assert.equal(u.hash,'#start'); assert.equal(u.searchParams.get('service'),'ev');
 assert.equal(u.searchParams.get('utm_source'),'jobhackai_local'); assert.equal(u.searchParams.get('utm_content'),'example_profile_website');
 const existing=new URL(providerReferralUrl('https://example.com/?utm_source=existing','junk-removal','example','source'));
 assert.equal(existing.searchParams.get('utm_source'),'existing');
 assert.throws(()=>providerReferralUrl('mailto:private@example.com','junk-removal','example','source'));
 assert.throws(()=>providerReferralUrl('https://example.com','junk-removal','private@example.com','source'));
});

import {readFileSync} from 'node:fs';
import {load} from 'cheerio';
test('every published provider website action has stable public referral context',()=>{
 for(const category of ['mobile-detailing','junk-removal','ev-charger-installation']){
  const data=JSON.parse(readFileSync(new URL('../data/directory/'+category+'.json',import.meta.url),'utf8'));
  for(const listing of data.listings){
   const $=load(readFileSync(new URL('../directory/'+category+'/'+listing.id+'.html',import.meta.url),'utf8'));
   const links=$('a[data-directory-contact]'); assert.ok(links.length>=2);
   links.each((_,a)=>{
    assert.equal($(a).attr('data-directory-contact'),listing.id);
    const href=$(a).attr('href');
    if(/^https?:/.test(href)){
     const u=new URL(href);
     assert.equal(u.searchParams.get('utm_source'),'jobhackai_local');
     assert.equal(u.searchParams.get('utm_medium'),'referral');
     assert.ok(u.searchParams.get('utm_content').startsWith(listing.id+'_profile_'));
     assert.ok(['website','source','booking'].includes($(a).attr('data-directory-link')));
    }
   });
  }
 }
});
