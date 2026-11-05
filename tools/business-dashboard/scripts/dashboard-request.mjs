import {allowed} from '../src/access.js';

export const dashboardOrigin='https://dashboard.jobhackai.io';
export function dashboardRequestUrl(identity,method,path){
  const target=new URL(path||'',dashboardOrigin);
  if(target.origin!==dashboardOrigin||target.username||target.password||target.hash||
    !allowed(identity,method,target.pathname)||(method==='POST'&&target.search)){
    throw new Error('Unsupported machine operation. Use GET or POST and an allowed /api/ path.');
  }
  return target;
}
