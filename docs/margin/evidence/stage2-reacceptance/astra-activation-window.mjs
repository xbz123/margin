import assert from 'node:assert/strict';
import { makeSandbox, readBlocked } from '/Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration/scripts/margin/isolation/env.mjs';
import { launchApp, windowWithQuery } from '/Users/mac/code/Natively/.claude/worktrees/margin-agpl-migration/tests/margin/launch-app.mjs';
const sandbox = makeSandbox('acceptance-activation');
const {app} = await launchApp(sandbox, {NODE_ENV:'production'});
try {
  const page = await windowWithQuery(app,'window=launcher',30000);
  const initial = await app.evaluate(async ({BrowserWindow}) => {
    const w=BrowserWindow.getAllWindows().find(w=>w.webContents.getURL().includes('window=launcher'));
    return w.webContents.executeJavaScript(`(() => {
      const button=document.createElement('button');button.id='acceptance-nonlink';button.textContent='Non-link control';
      Object.assign(button.style,{position:'fixed',left:'5px',top:'5px',zIndex:'2147483647'});document.body.append(button);
      const before=navigator.userActivation.isActive;
      const timer=setInterval(()=>{if(navigator.userActivation.isActive){clearInterval(timer);void window.electronAPI.openExternal('https://automatic.example/after-unrelated-click');}},25);
      return {active:before};
    })()`,false);
  });
  assert.equal(initial.active,false);
  await new Promise(r=>setTimeout(r,200));
  const before=readBlocked(sandbox).filter(r=>r.kind==='external-open').map(r=>r.detail);
  assert.deepEqual(before,[]);
  await page.locator('#acceptance-nonlink').click();
  await new Promise(r=>setTimeout(r,200));
  const after=readBlocked(sandbox).filter(r=>r.kind==='external-open').map(r=>r.detail);
  console.log(JSON.stringify({initialUserActivation:initial.active,openedBeforeClick:before,clicked:'non-link button without a URL or click handler',openedByTimerAfterClick:after,realBrowserOpened:false,realNetworkRequests:false},null,2));
} finally { await app.close(); }
