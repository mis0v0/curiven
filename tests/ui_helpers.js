// Shared browser-test helpers for controls that now live in the settings dialog (profile · AI · Notion · data).
'use strict';
async function openSettings(page,tab='profile'){
 if(!await page.evaluate(()=>!!document.getElementById('settings')?.open))await page.click('#settingsBtn');
 await page.click(`#settingsTabs [data-settings-tab="${tab}"]`);
 await page.waitForSelector({profile:'#profileSettings',ai:'#aiSettings',notion:'#notionSettings',data:'#dataSettings'}[tab]);
}
async function closeSettings(page){if(await page.evaluate(()=>!!document.getElementById('settings')?.open))await page.click('#settingsBack')}
async function importFile(page,file){await openSettings(page,'data');await page.setInputFiles('#importData',file)}
async function clickExport(page){await openSettings(page,'data');await page.click('#exportData')}
module.exports={openSettings,closeSettings,importFile,clickExport};
