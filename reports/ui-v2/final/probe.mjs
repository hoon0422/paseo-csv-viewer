// Run inside the isolated Space. Reads the official desktop DOM; no UI actions.
import { readFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const pages = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = pages.find(p => p.type === 'page' && p.url.startsWith('paseo://app/'));
if (!page) throw Error('Official Paseo page unavailable');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let id = 0;
const pending = new Map();
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.id) { const p = pending.get(data.id); pending.delete(data.id); data.error ? p.reject(data.error) : p.resolve(data.result); }
  if (data.method === 'Runtime.bindingCalled' && data.params.name === 'ticket20record') {
    const item = JSON.parse(data.params.payload);
    appendFileSync('/home/cua/ui-v2-final/ui-events.jsonl', JSON.stringify(item) + '\n');
    if (item.toast || item.drop || (item.status?.includes('Preparing') && !globalThis.preparingCaptured)) {
      if (item.status?.includes('Preparing')) globalThis.preparingCaptured = true;
      const name = `${Math.round(item.ms)}-${item.toast ? 'toast' : item.drop ? 'drop' : 'preparing'}.png`;
      spawn('import', ['-window', process.env.T20_WINDOW, '/home/cua/ui-v2-final/' + name], {env:{...process.env,DISPLAY:':1'}});
    }
  }
};
const send = (method, params = {}) => new Promise((resolve, reject) => { const key = ++id; pending.set(key,{resolve,reject}); ws.send(JSON.stringify({id:key,method,params})); });
const evaluate = async expression => {
  const r = await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails));
  return r.result.value;
};
const state = `(() => {
  const root=document.querySelector('[aria-label="CSV viewer"]');
  const rows=[...(root?.querySelectorAll('[role="row"]')||[])];
  const rect=el=>{const b=el.getBoundingClientRect();return {x:b.x,y:b.y,w:b.width,h:b.height}};
  return {utc:new Date().toISOString(),ms:performance.now(),title:document.title,url:location.href,
    status:root?.querySelector('[aria-label="Source status"]')?.textContent,
    alert:root?.querySelector('[role="alert"]')?.textContent,toast:root?.querySelector('[aria-label="Toast"]')?.textContent,
    drop:root?.textContent.includes('Drop to open'),
    path:root?.querySelector('input')?.value,focus:document.activeElement?.getAttribute('aria-label'),
    rows:rows.map(el=>({label:el.getAttribute('aria-label'),selected:el.getAttribute('aria-selected'),text:el.textContent,rect:rect(el)})),
    controls:[...(root?.querySelectorAll('button,select,input,[role="separator"],[role="menuitem"],[role="menuitemradio"]')||[])].filter(el=>!el.getAttribute('aria-label')?.startsWith('Copy cell row')).map(el=>({label:el.getAttribute('aria-label'),role:el.getAttribute('role'),value:el.value,title:el.title,disabled:el.disabled,expanded:el.getAttribute('aria-expanded'),invalid:el.getAttribute('aria-invalid'),width:el.getAttribute('aria-valuenow'),checked:el.checked,rect:rect(el)}))};
})()`;
if (process.argv[2] === 'monitor') {
  await send('Runtime.enable'); await send('Runtime.addBinding',{name:'ticket20record'});
  await evaluate(`(() => {
    window.ticket20stop?.();
    let previous='';
    const snapshot=()=>{
      const root=document.querySelector('[aria-label="CSV viewer"]');
      const rows=root?.querySelectorAll('[aria-label^="Select row "]');
      const item={ms:performance.now(),utc:new Date().toISOString(),
        status:root?.querySelector('[aria-label="Source status"]')?.textContent,
        toast:root?.querySelector('[aria-label="Toast"]')?.textContent,
        alert:root?.querySelector('[role="alert"]')?.textContent,
        drop:root?.textContent.includes('Drop to open'),path:root?.querySelector('input')?.value,
        mounted:rows?.length,first:rows?.[0]?.textContent,last:rows?.[rows.length-1]?.getAttribute('aria-label')};
      const key=JSON.stringify([item.status,item.toast,item.alert,item.drop,item.path,item.mounted,item.first,item.last]);
      if(key!==previous){previous=key;ticket20record(JSON.stringify({kind:'state',...item}));}
    };
    const input=e=>{if(!e.target.closest('[aria-label="CSV viewer"]'))return;const label=e.target.closest('[aria-label]')?.getAttribute('aria-label'); const item={kind:e.type,ms:performance.now(),utc:new Date().toISOString(),label,key:e.key,ctrl:e.ctrlKey};setTimeout(()=>ticket20record(JSON.stringify({...item,prevented:e.defaultPrevented,focus:document.activeElement?.getAttribute('aria-label')})),0)};
    for(const name of ['pointerdown','keydown','change','wheel'])document.addEventListener(name,input,true);
    const timer=setInterval(snapshot,25); snapshot();
    window.ticket20stop=()=>{clearInterval(timer);for(const name of ['pointerdown','keydown','change','wheel'])document.removeEventListener(name,input,true)};
    return 'monitor installed';
  })()`);
  console.log('monitor installed');
} else {
  const result = await evaluate(state);
  const text = JSON.stringify(result,null,2);
  if (process.argv[3]) writeFileSync(process.argv[3],text+'\n');
  console.log(text);
  ws.close();
}
